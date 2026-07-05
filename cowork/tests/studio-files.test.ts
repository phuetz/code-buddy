import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readProjectFile, safeJoin, writeProjectFile } from '../src/main/studio/studio-files';

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
});
