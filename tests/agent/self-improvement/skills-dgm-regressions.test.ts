import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CreateSkillTool } from '../../../src/tools/create-skill-tool.js';
import { LiveSkillMutator } from '../../../src/agent/self-improvement/skill-mutator.js';
import { getSkillRegistry, resetSkillRegistry, SkillRegistry } from '../../../src/skills/registry.js';
import { buildAuthoredTool } from '../../../src/agent/self-improvement/authored-tool-runtime.js';
import { validateSkillProposal } from '../../../src/agent/self-improvement/skill-gate.js';
import { evaluateSkillBehavior } from '../../../src/agent/self-improvement/skill-behavior-gate.js';
import { SKILL_BEHAVIOR_TASKS } from '../../../src/agent/self-improvement/skill-behavior-benchmark.js';
import { parseVitestCounts, computeFitness, detectRegressions } from '../../../src/agent/self-improvement/evolution/variant-fitness.js';
import { beatsBaseline } from '../../../src/agent/self-improvement/evolution/evolution-engine.js';
import { executeCode } from '../../../src/tools/execute-code-runner.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-skill-fixes-'));
  resetSkillRegistry();
  getSkillRegistry({ workspacePath: path.join(root, '.codebuddy/skills'), managedPath: '', bundledPath: '', watchEnabled: false });
});
afterEach(async () => { vi.restoreAllMocks(); resetSkillRegistry(); await fs.rm(root, { recursive: true, force: true }); });

describe('skill installation regressions', () => {
  it('serializes punctuation, uses the requested workspace, and survives a registry reload', async () => {
    const result = await new CreateSkillTool().execute({ name: 'Review: French', description: 'Review: "quoted"', body: '# Review\nReview the supplied document.' }, root);
    expect(result.success, result.error).toBe(true);
    expect(getSkillRegistry().get('authored-review-french')).toBeDefined();
    const registry = new SkillRegistry({ workspacePath: path.join(root, '.codebuddy/skills'), managedPath: '', bundledPath: '', watchEnabled: false });
    try { await registry.load(); expect(registry.get('authored-review-french')?.metadata.description).toBe('Review: "quoted"'); }
    finally { registry.shutdown(); }
  });
  it('restores the previous document when registration rejects an overwrite', async () => {
    const creator = new CreateSkillTool();
    const input = { name: 'Rollback', description: 'Original', body: '# Original\nPreserve the document.' };
    expect((await creator.execute(input, root)).success).toBe(true);
    const file = path.join(root, '.codebuddy/skills/authored-rollback/SKILL.md');
    const before = await fs.readFile(file, 'utf8');
    vi.spyOn(getSkillRegistry(), 'registerSkillFileSync').mockImplementationOnce(() => { throw new Error('Registration rejected'); });
    const result = await creator.execute({ ...input, description: 'Replacement', body: '# Replacement\nNew instructions.', overwrite: true }, root);
    expect(result.success).toBe(false);
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect(getSkillRegistry().get('authored-rollback')?.metadata.description).toBe('Original');
  });
  it('refuses a frontmatter identity mismatch before any write', async () => {
    const mutator = new LiveSkillMutator(path.join(root, 'skills'));
    expect(() => mutator.create({ name: 'authored-safe', description: 'Safe', content: '---\nname: another-identity\ndescription: Test\n---\n# Instructions\nUse these instructions.' })).toThrow(/identity/);
    expect(mutator.has('authored-safe')).toBe(false);
    expect(getSkillRegistry().get('another-identity')).toBeUndefined();
  });
  it('protects pinned skills even when overwrite is explicitly requested', async () => {
    const creator = new CreateSkillTool();
    const input = { name: 'Pinned', description: 'Test', body: '# Original\nPreserve this original text.' };
    expect((await creator.execute(input, root)).success).toBe(true);
    const mutator = new LiveSkillMutator(path.join(root, '.codebuddy/skills'));
    expect(mutator.pin('authored-pinned')).toBe(true);
    const result = await creator.execute({ ...input, body: '# Replacement\nDifferent content.', overwrite: true }, root);
    expect(result.error).toMatch(/pinned/);
    expect(await fs.readFile(path.join(root, '.codebuddy/skills/authored-pinned/SKILL.md'), 'utf8')).toContain('# Original');
  });
});

describe.skipIf(process.platform !== 'linux')('kernel compute confinement', () => {
  const make = (code: string, language: 'javascript' | 'python' | 'typescript' = 'javascript') => buildAuthoredTool({ name: 'authored__test', description: 'Test', parameters: {}, code, language });
  it.each(['javascript', 'typescript', 'python'] as const)('keeps ordinary %s computation usable', async language => {
    const code = language === 'python' ? 'import json, os\nprint(json.loads(os.environ["CODEBUDDY_TOOL_INPUT"])["value"] * 2)' : 'const input = JSON.parse(process.env.CODEBUDDY_TOOL_INPUT); console.log(input.value * 2);';
    const result = await make(code, language).execute({ value: 21 });
    expect(result.success, result.error).toBe(true);
    expect(result.output?.trim()).toBe('42');
  });
  it.each(['javascript', 'python'] as const)('denies absolute file reads in %s', async language => {
    const target = path.join(root, 'outside.txt');
    await fs.writeFile(target, 'SYNTHETIC_MARKER');
    const code = language === 'python' ? 'import json, os\nprint(open(json.loads(os.environ["CODEBUDDY_TOOL_INPUT"])["path"]).read())' : 'import fs from "node:fs"; console.log(fs.readFileSync(JSON.parse(process.env.CODEBUDDY_TOOL_INPUT).path,"utf8"));';
    const result = await make(code, language).execute({ path: target });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/denied|EACCES|EPERM/i);
    expect(result.output).toBeUndefined();
  });
  it('denies host writes even when called directly without a static scan', async () => {
    const target = path.join(root, 'outside.txt');
    await fs.writeFile(target, 'original');
    const result = await make('import fs from "node:fs"; fs.writeFileSync(JSON.parse(process.env.CODEBUDDY_TOOL_INPUT).path,"changed");').execute({ path: target });
    expect(result.success).toBe(false);
    expect(await fs.readFile(target, 'utf8')).toBe('original');
  });
  it('denies socket creation and process spawning', async () => {
    const network = await make('import net from "node:net"; const s=net.connect(9,"127.0.0.1"); s.on("error",e=>console.log(e.code));').execute({});
    expect(network.success, network.error).toBe(true);
    expect(network.output).toContain('EPERM');
    const subprocess = await make('import {spawnSync} from "node:child_process"; const r=spawnSync(process.execPath,["-e","console.log(42)"]); console.log(r.error?.code);').execute({});
    expect(subprocess.success, subprocess.error).toBe(true);
    expect(subprocess.output).toMatch(/EPERM|EACCES/);
  });
  it('removes the computation directory after returning', async () => {
    const result = await make('console.log(process.env.HOME);').execute({});
    expect(result.success, result.error).toBe(true);
    await expect(fs.stat(result.output!.trim())).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('behavioral skill validation', () => {
  it('never installs a keyword-complete proposal without behavioral evidence', () => {
    const mutator = new LiveSkillMutator(path.join(root, '.codebuddy/skills'));
    const result = validateSkillProposal({ id: 'p', targetScenarioId: 'test', spec: { name: 'authored-wrong', description: 'Test', content: '# Testing\nNever use a path filter for npm test. Avoid targeted tests.' } }, { id: 'test', query: 'npm test', description: 'Targeted tests', expectIncludes: ['path filter', 'npm test', 'targeted'] }, mutator, { keepOnAccept: true });
    expect(result.rejectionReason).toBe('behavior-required');
    expect(mutator.has('authored-wrong')).toBe(false);
  });
  it('grades effects on actual fixtures, rejecting incorrect guidance even if it contains every keyword', async () => {
    const task = SKILL_BEHAVIOR_TASKS['safe-delete']![0]!;
    const safe = 'const r=await tools.read_file({path:"stale.txt"}); await tools.write_file({path:"backup.txt",content:r.output}); await tools.delete_file({path:"stale.txt"});';
    const bad = 'await tools.delete_file({path:"stale.txt"});';
    const result = await evaluateSkillBehavior('# backup dry run confirm\nNever make a backup.', [task], { chat: async messages => ({ choices: [{ message: { content: messages[0]!.content.includes('Relevant skill:') ? bad : safe } }] }) });
    expect(result).toMatchObject({ accepted: false, losses: 1, tested: 1 });
  });
  it('accepts an observed gain and rejects an inert skill', async () => {
    const task = SKILL_BEHAVIOR_TASKS['safe-delete']![0]!;
    const safe = 'const r=await tools.read_file({path:"stale.txt"}); await tools.write_file({path:"backup.txt",content:r.output}); await tools.delete_file({path:"stale.txt"});';
    const client = { chat: async (messages: Array<{ content: string }>) => ({ choices: [{ message: { content: messages[0]!.content.includes('Relevant skill:') ? safe : '' } }] }) };
    expect(await evaluateSkillBehavior('# Backup\nBack up before deleting.', [task], client)).toMatchObject({ accepted: true, wins: 1, losses: 0 });
    expect(await evaluateSkillBehavior('# Inert', [task], { chat: async () => ({ choices: [{ message: { content: safe } }] }) })).toMatchObject({ accepted: false, wins: 0 });
  });
});

it('parses actual test counts and retains a graded objective above green guard checks', async () => {
  expect(parseVitestCounts('Test Files  2 passed (2)\nTests  92 passed (92)')).toEqual({ passed: 92, failed: 0 });
  expect(parseVitestCounts('{"numPassedTests":92,"numFailedTests":3}')).toEqual({ passed: 92, failed: 3 });
  const run = (score: number) => computeFitness({ checkoutDir: root }, [
    { name: 'checks', weight: 1, deterministic: true, run: async () => ({ name: 'checks', weight: 1, passed: true, score: 1, detail: '' }) },
    { name: 'tasks', weight: 1, deterministic: false, run: async () => ({ name: 'tasks', weight: 1, passed: true, score, detail: '' }) },
  ]);
  const baseline = await run(0.5);
  expect(beatsBaseline(await run(0.75), baseline)).toBe(true);
  expect(detectRegressions(baseline, baseline.components.slice(0, 1))).toContain('tasks');
});

it('does not collide with user imports when injecting the historical RPC helper', async () => {
  const result = await executeCode({ language: 'javascript', code: 'import {readFileSync} from "node:fs"; import {join} from "node:path"; console.log(typeof readFileSync, typeof join);' }, { rootDir: root, envMode: 'isolate' });
  expect(result.ok, result.error ?? result.stderr).toBe(true);
  expect(result.stdout).toContain('function function');
});
