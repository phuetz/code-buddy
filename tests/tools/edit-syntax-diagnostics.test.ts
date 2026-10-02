import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { appendEditSyntaxDiagnostics } from '../../src/tools/edit-syntax-diagnostics.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'syntax-diagnostics-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it('does not confuse missing dependencies or types with syntax errors', async () => {
  const file = join(root, 'component.tsx');
  writeFileSync(file, 'import { Widget } from "not-installed";\nexport const view = <Widget value={unknownVariable}/>;\nexport interface Options { optional?: string }\n');
  const result = { success: true, output: 'Written' };
  expect(await appendEditSyntaxDiagnostics(result, [file])).toBe(result);
});

it('preserves failed writes and skips deleted or unsupported files', async () => {
  const file = join(root, 'broken.ts');
  writeFileSync(file, 'export class Incomplete {');
  const failed = { success: false, error: 'Permission denied' };
  expect(await appendEditSyntaxDiagnostics(failed, [file])).toBe(failed);
  const text = join(root, 'notes.md');
  writeFileSync(text, 'Not JavaScript {');
  const success = { success: true, output: 'Applied' };
  expect(await appendEditSyntaxDiagnostics(success, [text, join(root, 'deleted.ts')])).toBe(success);
});
