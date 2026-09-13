import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getMemoryManager, resetMemoryManagerForTests } from '../../src/memory/persistent-memory.js';
import { RememberTool, RecallTool, MemoryProposeTool } from '../../src/tools/registry/memory-tools.js';
import { getMemoryCandidateQueue, resetMemoryCandidateQueues } from '../../src/memory/memory-candidate-queue.js';
import { handleMemory } from '../../src/commands/handlers/memory-handlers.js';

const hooks = vi.hoisted(() => ({ execute: vi.fn(async () => ({ allowed: true })) }));
vi.mock('../../src/hooks/hermes-lifecycle-hooks.js', () => ({ executeHermesLifecycleHook: hooks.execute }));
let dir: string;
beforeEach(async () => {
  resetMemoryManagerForTests();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-project-memory-'));
  getMemoryManager({ projectMemoryPath: path.join(dir, 'process.md'), userMemoryPath: path.join(dir, 'user.md') });
  for (const name of ['a', 'b']) {
    const cwd = path.join(dir, name);
    await fs.mkdir(cwd);
    getMemoryManager({ userMemoryPath: path.join(dir, 'user.md') }, undefined, cwd);
  }
});
afterEach(async () => {
  resetMemoryManagerForTests(); resetMemoryCandidateQueues(); vi.clearAllMocks(); vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});
it('keeps two projects separate and exposes the same manager to prompt readers', async () => {
  const a = path.join(dir, 'a'), b = path.join(dir, 'b');
  await Promise.all([new RememberTool().execute({ key: 'project', value: 'alpha' }, { cwd: a }), new RememberTool().execute({ key: 'project', value: 'beta' }, { cwd: b })]);
  expect((await new RecallTool().execute({ key: 'project' }, { cwd: a })).output).toContain('alpha');
  expect((await new RecallTool().execute({ key: 'project' }, { cwd: b })).output).toContain('beta');
  expect(getMemoryManager(undefined, undefined, a).getContextForPrompt()).toContain('alpha');
  expect(getMemoryManager(undefined, undefined, a).getContextForPrompt()).not.toContain('beta');
  expect(await fs.readFile(path.join(b, '.codebuddy/CODEBUDDY_MEMORY.md'), 'utf8')).toContain('beta');
  expect(hooks.execute.mock.calls.map((call: unknown[]) => call[0])).toEqual(expect.arrayContaining([a, b]));
});
it('queues and accepts a candidate in the same project', async () => {
  const cwd = path.join(dir, 'b');
  expect((await new MemoryProposeTool().execute({ key: 'candidate', value: 'scoped candidate' }, { cwd })).success).toBe(true);
  const queue = getMemoryCandidateQueue(cwd);
  const candidate = queue.list()[0]!;
  expect(candidate).toBeDefined();
  await queue.accept(candidate.id, { reviewedBy: 'audit-test' });
  expect(getMemoryManager(undefined, undefined, cwd).get('candidate', 'project')?.value).toBe('scoped candidate');
  expect(getMemoryManager(undefined, undefined, path.join(dir, 'a')).get('candidate', 'project')).toBeUndefined();
});

it('accepts a bot proposal via slash in the same bot and project context', async () => {
  vi.stubEnv('HOME', path.join(dir, 'home'));
  const context = { cwd: path.join(dir, 'b'), botId: 'audit-bot' };
  await new MemoryProposeTool().execute({ key: 'bot-note', value: 'isolated bot fact' }, context);
  const candidate = getMemoryCandidateQueue(context.cwd, context.botId).list()[0]!;
  expect(candidate).toBeDefined();
  const result = await handleMemory(['accept', candidate.id], context);
  expect(result.entry?.content).toContain('Accepted');
  expect(getMemoryManager(undefined, context.botId, context.cwd).get('bot-note', 'project')?.value).toBe('isolated bot fact');
  expect(getMemoryManager(undefined, undefined, context.cwd).get('bot-note', 'project')).toBeUndefined();
  expect(getMemoryCandidateQueue(context.cwd).list()).toHaveLength(0);
});
