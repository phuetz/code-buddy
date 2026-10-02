import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { generateDiff } from '../../src/utils/diff-generator.js';

function verifyPatch(oldLines: string[], newLines: string[], expected: { added: number; removed: number }) {
  const result = generateDiff(oldLines, newLines, 'fixture.ts');
  expect(result.addedLines).toBe(expected.added);
  expect(result.removedLines).toBe(expected.removed);
  expect(result.diff.length).toBeLessThan(2000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-banc-'));
  try {
    fs.writeFileSync(path.join(root, 'fixture.ts'), oldLines.join('\n') + '\n');
    const applied = spawnSync('git', ['apply', '-'], { cwd: root, input: result.diff + '\n', encoding: 'utf8' });
    expect(applied.status, applied.stderr).toBe(0);
    expect(fs.readFileSync(path.join(root, 'fixture.ts'), 'utf8')).toBe(newLines.join('\n') + '\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

it('une petite insertion ne réémet pas les milliers de lignes suivantes de A', () => {
  const oldLines = Array.from({ length: 7000 }, (_, index) => `const line${index} = ${index};`);
  const newLines = [...oldLines];
  newLines.splice(1367, 0, '// Human confirmation is required.');
  verifyPatch(oldLines, newLines, { added: 1, removed: 0 });
});

it('fusionne les changements voisins sans dupliquer le contexte et garde les décalages des suivants', () => {
  const oldLines = Array.from({ length: 100 }, (_, index) => `line ${index}`);
  const newLines = [...oldLines];
  newLines.splice(60, 1, 'replacement sixty');
  newLines.splice(14, 1);
  newLines.splice(10, 0, 'insert ten');
  verifyPatch(oldLines, newLines, { added: 2, removed: 2 });
});

it('aligne les suppressions avec des lignes vides et Unicode', () => {
  const oldLines = ['début', '', 'à retirer', '', 'gardé', '', 'fin', 'contexte'];
  verifyPatch(oldLines, oldLines.filter(line => line !== 'à retirer'), { added: 0, removed: 1 });
});
