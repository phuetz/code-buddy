/** Paired execution of curated file tasks. Candidate text never supplies its own grader. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ToolHarness } from '../../harness/tool-harness.js';
import type { CodeBuddyTool } from '../../codebuddy/tool-definitions/types.js';

export interface SkillBehaviorTask {
  id: string;
  prompt: string;
  files: Record<string, string>;
  expectedFiles: Record<string, string>;
  absentFiles?: string[];
  /** Exact sequence of effects, for safety ordering such as backup before removal. */
  effects?: string[];
}
export interface SkillBehaviorResult {
  accepted: boolean;
  wins: number;
  losses: number;
  tested: number;
  cases: { id: string; before: boolean; after: boolean }[];
  error?: string;
}
export interface SkillBehaviorClient {
  chat(messages: Array<{ role: string; content: string }>, tools?: unknown[]): Promise<{ choices?: Array<{ message?: { content?: string | null } }> }>;
}
const DEFINITIONS: CodeBuddyTool[] = ['read_file', 'write_file', 'delete_file', 'list_files'].map(name => ({
  type: 'function', function: { name, description: `${name} in the task fixture; args: {path, content?}`, parameters: { type: 'object', required: [], properties: { path: { type: 'string' }, content: { type: 'string' } } } },
}));

async function runArm(client: SkillBehaviorClient, task: SkillBehaviorTask, skill?: string): Promise<boolean> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-skill-behavior-'));
  const effects: string[] = [];
  const resolve = (value: unknown): string => {
    if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) throw new Error('Invalid fixture path');
    return path.join(root, value);
  };
  const harness = new ToolHarness({ cwd: root, tools: DEFINITIONS, dispatch: async (name, args) => {
    if (name === 'list_files') return { success: true, data: await fs.readdir(root) };
    const file = resolve(args.path);
    if (name === 'read_file') return { success: true, output: await fs.readFile(file, 'utf8') };
    if (name === 'write_file') {
      if (typeof args.content !== 'string') throw new Error('content must be a string');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, args.content);
    } else if (name === 'delete_file') await fs.unlink(file);
    else throw new Error('Unavailable fixture tool');
    effects.push(`${name}:${String(args.path)}`);
    return { success: true };
  } });
  try {
    for (const [name, content] of Object.entries(task.files)) {
      const file = resolve(name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content);
    }
    const result = await client.chat([
      { role: 'system', content: 'Return ONLY JavaScript, no markdown fences. Use await tools.read_file({path}), tools.write_file({path,content}), tools.delete_file({path}), tools.list_files({}). Results are {success,output?,data?}; check success. No imports or other tools. Modify the fixture to complete the task.' + (skill ? `\nRelevant skill:\n${skill}` : '') },
      { role: 'user', content: `${task.prompt}\nAvailable files: ${Object.keys(task.files).join(', ')}` },
    ], []);
    const code = result.choices?.[0]?.message?.content?.trim();
    if (!code || !(await harness.exec(code, { timeoutMs: 5000 })).success) return false;
    for (const [name, content] of Object.entries(task.expectedFiles)) if (await fs.readFile(resolve(name), 'utf8') !== content) return false;
    for (const name of task.absentFiles ?? []) {
      try { await fs.stat(resolve(name)); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
    if (entries.filter(entry => entry.isFile()).length !== Object.keys(task.expectedFiles).length) return false;
    return !task.effects || (effects.length === task.effects.length && effects.every((effect, index) => effect === task.effects![index]));
  } catch { return false; }
  finally { await harness.dispose(); await fs.rm(root, { recursive: true, force: true }); }
}

export async function evaluateSkillBehavior(content: string, tasks: readonly SkillBehaviorTask[], client?: SkillBehaviorClient): Promise<SkillBehaviorResult> {
  const cases: SkillBehaviorResult['cases'] = [];
  if (!tasks.length) return { accepted: false, wins: 0, losses: 0, tested: 0, cases, error: 'No curated behavioral tasks for this scenario' };
  if (!client) {
    const { detectProviderFromEnv } = await import('../../utils/provider-detector.js');
    const provider = detectProviderFromEnv();
    if (!provider) return { accepted: false, wins: 0, losses: 0, tested: 0, cases, error: 'Behavioral validation requires a configured provider' };
    const { CodeBuddyClient } = await import('../../codebuddy/client.js');
    client = new CodeBuddyClient(provider.apiKey, provider.defaultModel, provider.baseURL) as unknown as SkillBehaviorClient;
  }
  for (const task of tasks) {
    const before = await runArm(client, task);
    const after = await runArm(client, task, content);
    cases.push({ id: task.id, before, after });
  }
  const wins = cases.filter(c => !c.before && c.after).length;
  const losses = cases.filter(c => c.before && !c.after).length;
  return { accepted: wins > 0 && losses === 0 && cases.every(c => c.after), wins, losses, tested: cases.length, cases };
}
