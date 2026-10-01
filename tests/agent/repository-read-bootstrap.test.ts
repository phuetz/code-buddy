import { mkdtemp, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CodeBuddyToolCall } from '../../src/codebuddy/client.js';
import { expect, it, vi } from 'vitest';
import { bootstrapRepositoryReads, needsRepositoryRead } from '../../src/agent/execution/repository-read-bootstrap.js';

it('does not infer access from a denied read, escape through main/symlinks, or read for unrelated chat', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bootstrap-boundary-'));
  const outside = `${root}-outside.js`;
  await writeFile(outside, 'SECRET_SENTINEL');
  try {
    await writeFile(path.join(root, 'package.json'), '{"main":"../outside.js"}');
    await symlink(outside, path.join(root, 'README.md'));
    const execute = vi.fn(async (_call: CodeBuddyToolCall) => ({ success: false, error: 'Permission denied' }));
    const results = [];
    for await (const result of bootstrapRepositoryReads('explain the entry point', root, execute)) results.push(result);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.parse(execute.mock.calls[0]![0].function.arguments).path).toBe('package.json');
    expect(results[0]?.toolResult).toEqual({ success: false, error: 'Permission denied' });
    for await (const _ of bootstrapRepositoryReads('say hello', root, execute)) throw new Error('Unexpected read');
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
});

it('recognises the developer orientation command without treating unrelated chat as a repository request', () => {
  expect(needsRepositoryRead('Analyse the repository. Critical entry points and important files')).toBe(true);
  expect(needsRepositoryRead('How are you?')).toBe(false);
});

it('reads the real project test script before a repair, without assuming a runner or reading the entry', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bootstrap-check-'));
  try {
    await writeFile(path.join(root, 'package.json'), '{"main":"index.js","scripts":{"test":"node --test"}}');
    await writeFile(path.join(root, 'index.js'), 'console.log(42)');
    const execute = vi.fn(async (_call: CodeBuddyToolCall) => ({ success: true, output: '1: {"main":"index.js","scripts":{"test":"node --test"}}' }));
    for await (const _ of bootstrapRepositoryReads('run tests and fix failures', root, execute)) { /* consume actual bootstrap */ }
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.parse(execute.mock.calls[0]![0].function.arguments).path).toBe('package.json');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('reads the literal edit target before the model and refuses escaped or symlink targets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bootstrap-edit-'));
  const outside = `${root}-outside.js`;
  try {
    await writeFile(path.join(root, 'salutation.js'), 'exports.hello = () => "hello";');
    await writeFile(outside, 'PRIVATE_SENTINEL');
    await symlink(outside, path.join(root, 'linked.js'));
    const execute = vi.fn(async (call: CodeBuddyToolCall) => {
      const args = JSON.parse(call.function.arguments) as { path: string };
      return { success: true, output: '1: ' + await readFile(path.join(root, args.path), 'utf8') };
    });
    const observations = [];
    for await (const item of bootstrapRepositoryReads('Dans salutation.js, remplace hello par salut.', root, execute)) observations.push(item);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(observations[0]?.toolResult.output).toContain('exports.hello');
    expect(JSON.parse(execute.mock.calls[0]![0].function.arguments)).toMatchObject({ path: 'salutation.js', start_line: 1 });
    for await (const _ of bootstrapRepositoryReads('Edit ../outside.js and linked.js', root, execute)) throw new Error('Unsafe read');
    expect(execute).toHaveBeenCalledTimes(1);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { force: true }); }
});
