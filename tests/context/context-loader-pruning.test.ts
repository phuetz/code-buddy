import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const globMock = vi.hoisted(() => vi.fn(async (_patterns: unknown, _options: unknown) => []));
vi.mock('fast-glob', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fast-glob')>();
  return { ...actual, default: { ...actual.default, glob: globMock } };
});
import { ContextLoader } from '../../src/context/context-loader.js';

describe('context discovery prunes ignored root directories before walking', () => {
  it('skips a gitignored profile/cache tree while preserving a re-included directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'context-prune-'));
    try {
      await mkdir(join(root, 'private'));
      await mkdir(join(root, 'visible'));
      await writeFile(join(root, '.gitignore'), 'private/\nvisible/\n!visible/\n');
      await new ContextLoader(root).loadFiles();
      const options = globMock.mock.calls.at(-1)?.[1] as { ignore: string[] };
      expect(options.ignore).toContain('private/**');
      expect(options.ignore).not.toContain('visible/**');
      await new ContextLoader(root, { respectGitignore: false }).loadFiles();
      const unrestricted = globMock.mock.calls.at(-1)?.[1] as { ignore: string[] };
      expect(unrestricted.ignore).not.toContain('private/**');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
