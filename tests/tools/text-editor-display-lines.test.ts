import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TextEditorTool } from '../../src/tools/text-editor.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';

describe('display line labels are not approximate source text', () => {
  let directory: string;
  let editor: TextEditorTool;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'editor-display-lines-'));
    ConfirmationService.getInstance().setSessionFlag('fileOperations', true);
    editor = new TextEditorTool();
    editor.setBaseDirectory(directory);
  });
  afterEach(() => {
    editor.dispose();
    ConfirmationService.getInstance().setSessionFlag('fileOperations', false);
    rmSync(directory, { recursive: true, force: true });
  });
  const source = "const title = 'initial';\nconst status = 'ready';\nconsole.log(title, status);\n";
  it.each([true, false])('refuses copied display labels before fuzzy matching (first line numbered: %s)', async numberedFirst => {
    const file = join(directory, 'sample.js');
    writeFileSync(file, source);
    const decorated = source.split('\n').map((line, i) => i === 0 && !numberedFirst ? line : `${i + 1}: ${line}`).join('\n');
    const result = await editor.strReplace(file, decorated, decorated.replace("'ready'", "'done'"));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/line numbers|line labels/i);
    expect(readFileSync(file, 'utf8')).toBe(source);
  });
  it('recognizes display labels despite line-ending differences', async () => {
    const file = join(directory, 'sample.js');
    const original = source.replaceAll('\n', '\r\n');
    writeFileSync(file, original);
    const decorated = source.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');
    const result = await editor.strReplace(file, decorated, decorated.replace("'ready'", "'done'"));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/line numbers|line labels/i);
    expect(readFileSync(file, 'utf8')).toBe(original);
  });
  it('recognizes a copied source location even if another search line varies in whitespace', async () => {
    const file = join(directory, 'sample.js');
    writeFileSync(file, source);
    const decorated = "2: const status='ready';\n3: console.log(title, status);";
    const result = await editor.strReplace(file, decorated, decorated.replace("'ready'", "'done'"));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/line numbers|line labels/i);
    expect(readFileSync(file, 'utf8')).toBe(source);
  });
  it('still edits real numbered records literally', async () => {
    const file = join(directory, 'records.txt');
    writeFileSync(file, '1: first\n2: second\n');
    const result = await editor.strReplace(file, '2: second', '2: changed');
    expect(result.success).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('1: first\n2: changed\n');
  });
  it('still supports a normal literal edit after a rejected display copy', async () => {
    const file = join(directory, 'sample.js');
    writeFileSync(file, source);
    await editor.strReplace(file, source.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n'), 'bad');
    const result = await editor.strReplace(file, "const status = 'ready';", "const status = 'done';");
    expect(result.success).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(source.replace("'ready'", "'done'"));
  });
});
