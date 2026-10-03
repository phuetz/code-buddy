import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fg from '../../src/utils/safe-fast-glob.js';

const nested = '{'.repeat(1500) + 'a,b' + '}'.repeat(1500);
let root: string | undefined;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('fast-glob : borner les motifs avant le parsing récursif', () => {
  it.each(['glob', 'async', 'sync', 'globSync', 'stream', 'globStream', 'generateTasks', 'isDynamicPattern'] as const)(
    'refuse le motif imbriqué sur %s', (method) => {
      expect(() => fg[method](nested)).toThrow('Glob pattern too complex');
    }
  );

  it('refuse aussi les motifs négatifs et ignore, avant de lire le disque', () => {
    expect(() => fg('!' + nested)).toThrow('Glob pattern too complex');
    expect(() => fg('**/*', { ignore: [nested] })).toThrow('Glob pattern too complex');
    expect(() => fg.sync('**/*', { ignore: [nested] })).toThrow('Glob pattern too complex');
    expect(() => fg.generateTasks('**/*', { ignore: [nested] })).toThrow('Glob pattern too complex');
  });

  it('borne longueur, nombre de motifs et groupes parenthésés', () => {
    expect(() => fg('a'.repeat(4097))).toThrow('Glob pattern too long');
    expect(() => fg(Array.from({ length: 1025 }, () => '**/*'))).toThrow('Too many glob patterns');
    expect(() => fg('('.repeat(65) + 'a' + ')'.repeat(65))).toThrow('Glob pattern too complex');
  });

  it('conserve les alternatives, négations, statistiques et les APIs sync/stream', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'cb-safe-glob-'));
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'a.ts'), 'export {};');
    await writeFile(path.join(root, 'src', 'b.js'), '');
    await writeFile(path.join(root, 'src', 'skip.ts'), '');
    const patterns = ['src/*.{ts,js}', '!**/skip.*'];
    const options = { cwd: root, ignore: ['**/b.js'] };
    expect(await fg(patterns, options)).toEqual(['src/a.ts']);
    expect(fg.sync(patterns, options)).toEqual(['src/a.ts']);
    const entries = await fg(patterns, { ...options, objectMode: true, stats: true });
    expect(entries[0]?.path).toBe('src/a.ts');
    expect(entries[0]?.stats?.size).toBe(10);
    const streamed: unknown[] = [];
    for await (const entry of fg.stream(patterns, options)) streamed.push(entry);
    expect(streamed).toEqual(['src/a.ts']);
    expect(fg.generateTasks(patterns, options).length).toBeGreaterThan(0);
  });
});
