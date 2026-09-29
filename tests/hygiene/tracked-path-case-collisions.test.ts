import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

it('ne suit pas deux chemins qui désignent le même fichier sur Windows', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot })
    .toString('utf8').split('\0').filter(Boolean);
  const byCaseInsensitivePath = new Map<string, string[]>();
  for (const file of tracked) {
    const key = file.normalize('NFC').toLowerCase();
    const names = byCaseInsensitivePath.get(key) ?? [];
    names.push(file);
    byCaseInsensitivePath.set(key, names);
  }
  const collisions = [...byCaseInsensitivePath.values()].filter((names) => names.length > 1);
  expect(collisions).toEqual([]);
});
