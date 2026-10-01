import { mkdtemp, readFile, symlink, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deleteEntry, readProjectFile, safeJoin, writeProjectFile } from '../src/main/studio/studio-files';

describe('studio file operations', () => {
  it('rejects unsafe paths', () => {
    const root = path.join(tmpdir(), 'studio-root');
    expect(safeJoin(root, '../outside.txt')).toBeNull();
    expect(safeJoin(root, path.join(path.parse(root).root, 'outside.txt'))).toBeNull();
    expect(safeJoin(root, 'src/a\0b.ts')).toBeNull();
  });

  it('accepts normal relative paths', () => {
    const root = path.join(tmpdir(), 'studio-root');
    expect(safeJoin(root, 'src/App.tsx')).toBe(path.join(root, 'src/App.tsx'));
  });

  it('round-trips read and write within a temp project', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'studio-files-'));
    const written = await writeProjectFile(root, 'src/App.tsx', 'export const App = 1;');
    const read = await readProjectFile(root, 'src/App.tsx');
    expect(written).toEqual({ ok: true, data: { path: 'src/App.tsx' } });
    expect(read).toEqual({ ok: true, data: 'export const App = 1;' });
    await expect(readFile(path.join(root, 'src/App.tsx'), 'utf8')).resolves.toBe('export const App = 1;');
  });

  it('rejects access via symlinks pointing outside root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'studio-files-symlink-root-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'studio-files-symlink-outside-'));
    const externalFile = path.join(outside, 'secret.txt');
    await writeFile(externalFile, 'secret content', 'utf8');

    try {
      await symlink(outside, path.join(root, 'lien'), 'junction');
    } catch {
      // Ignore if symlink creation fails (e.g. Windows without admin rights)
      return;
    }

    const read = await readProjectFile(root, 'lien/secret.txt');
    expect(read.ok).toBe(false);

    const write = await writeProjectFile(root, 'lien/hacked.txt', 'hacked');
    expect(write.ok).toBe(false);

    const del = await deleteEntry(root, 'lien');
    expect(del.ok).toBe(false);
  });

  it('rejects writes through a dangling symlink', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'studio-files-dangling-root-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'studio-files-dangling-outside-'));
    const missing = path.join(outside, 'missing.txt');
    try {
      await symlink(missing, path.join(root, 'lien'));
    } catch {
      return;
    }
    const result = await writeProjectFile(root, 'lien', 'hacked');
    expect(result.ok).toBe(false);
    await expect(stat(missing)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
