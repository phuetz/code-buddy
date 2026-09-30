import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GhostSnapshotManager } from '../src/checkpoints/ghost-snapshot.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ghost-index-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init'); git('config', 'user.name', 'Snapshot Test'); git('config', 'user.email', 'snapshot@example.invalid');
  mkdirSync(join(root, 'project'));
  writeFileSync(join(root, 'project/file.txt'), 'before');
  writeFileSync(join(root, 'sibling.txt'), 'original');
  git('add', 'project/file.txt'); git('add', 'sibling.txt'); git('commit', '-m', 'fixture');
  return { root, git };
}

describe('ghost snapshots preserve the user repository', () => {
  it('keeps the exact index and branch reflog while capturing working changes', async () => {
    const { root, git } = fixture();
    try {
      writeFileSync(join(root, 'project/file.txt'), 'staged'); git('add', 'project/file.txt');
      writeFileSync(join(root, 'project/file.txt'), 'working');
      const index = readFileSync(join(root, '.git/index'));
      const reflog = git('reflog', 'show', 'HEAD');
      const snapshot = await new GhostSnapshotManager(root).createSnapshot('before turn');
      expect(snapshot).not.toBeNull();
      expect(readFileSync(join(root, '.git/index'))).toEqual(index);
      expect(git('reflog', 'show', 'HEAD')).toBe(reflog);
      expect(git('show', `${snapshot!.commitHash}:project/file.txt`)).toBe('working');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('captures only the chosen workspace when it is below a larger repository', async () => {
    const { root, git } = fixture();
    try {
      writeFileSync(join(root, 'project/file.txt'), 'changed');
      writeFileSync(join(root, 'sibling.txt'), 'private sibling change');
      const snapshot = await new GhostSnapshotManager(join(root, 'project')).createSnapshot();
      expect(snapshot).not.toBeNull();
      expect(git('show', `${snapshot!.commitHash}:project/file.txt`)).toBe('changed');
      expect(git('show', `${snapshot!.commitHash}:sibling.txt`)).toBe('original');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
