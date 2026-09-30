import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CodeBuddyToolCall } from '../../src/codebuddy/client.js';
import { expect, it, vi } from 'vitest';
import { bootstrapRepositoryReads } from '../../src/agent/execution/repository-read-bootstrap.js';

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
