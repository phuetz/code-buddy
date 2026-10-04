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
  it.each([
    "1: const title='initial';\n2: const status='ready';\n3: console.log(title,status);",
    "1: const title='initial';",
    "1. const title='initial';\n2. const status='ready';\n3. console.log(title,status);",
    "1- const title='initial';\n2- const status='ready';",
    "1] const title='initial';\n2] const status='ready';",
    "1) const title='initial';\n2) const status='ready';",
    "  1 | const title = 'initial';\n  2 | const status = 'ready';",
  ])('rejects entirely drifted display labels: %s', async decorated => {
    const file = join(directory, 'sample.js');
    writeFileSync(file, source);
    const result = await editor.strReplace(file, decorated, decorated.replace('initial', 'changed'));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/line numbers|line labels/i);
    expect(readFileSync(file, 'utf8')).toBe(source);
  });
  it.each([':', '|', '.', ')', '-', ']'])('still edits real numbered records literally (%s)', async label => {
    const file = join(directory, 'records.txt');
    writeFileSync(file, `1${label} first\n2${label} second\n`);
    const result = await editor.strReplace(file, `2${label} second`, `2${label} changed`);
    expect(result.success).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(`1${label} first\n2${label} changed\n`);
  });
  it('still supports a normal literal edit after a rejected display copy', async () => {
    const file = join(directory, 'sample.js');
    writeFileSync(file, source);
    await editor.strReplace(file, source.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n'), 'bad');
    const result = await editor.strReplace(file, "const status = 'ready';", "const status = 'done';");
    expect(result.success).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(source.replace("'ready'", "'done'"));
  });
  it('does not diagnose a version string as display line labels', async () => {
    const file = join(directory, 'version.txt');
    writeFileSync(file, '2.3.0');
    const result = await editor.strReplace(file, '1.0.0', '1.0.1');
    expect(result.success).toBe(false);
    expect(result.error).not.toMatch(/line numbers|line labels/i);
    expect(readFileSync(file, 'utf8')).toBe('2.3.0');
  });

  it.each(['1.2', '1.0', '1.0.0'])('refuses numeric prefixes followed by source (%s)', async prefix => {
    const file = join(directory, 'sample.js');
    for (const firstOnly of [true, false]) {
      writeFileSync(file, source);
      const decorated = source.split('\n').map((line, i) => i === 0 || !firstOnly ? `${prefix} ${line}` : line).join('\n');
      const result = await editor.strReplace(file, decorated, decorated.replace('initial', 'changed'));
      expect(result.success).toBe(false);
      expect(readFileSync(file, 'utf8')).toBe(source);
    }
  });
  it('still edits a literal version record', async () => {
    const file = join(directory, 'versions.txt');
    writeFileSync(file, '1.2 initial\n');
    expect((await editor.strReplace(file, '1.2 initial', '1.2 changed')).success).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('1.2 changed\n');
  });
  it.each(['1-', '1]', '1.2', '1:'])('does not insert a display-prefixed source line (%s)', async prefix => {
    const file = join(directory, 'sample.js');
    writeFileSync(file, source);
    const result = await editor.insert(file, 1, `${prefix} const title = 'changed';`);
    expect(result.success).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(source);
  });
  it('allows literal numbered prose on insertion', async () => {
    const file = join(directory, 'notes.md');
    writeFileSync(file, '# Notes\n');
    expect((await editor.insert(file, 2, '1.2 changed')).success).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('1.2 changed');
  });


  it.each(['1.2', '1.2:', '1.2\u00a0'])('rejects decimal prefixes without an ASCII separator: %s', async prefix => {
    const file = join(directory, 'sample.js');
    writeFileSync(file, source);
    const decorated = prefix + source;
    expect((await editor.strReplace(file, decorated, decorated.replace('initial', 'changed'))).success).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(source);
  });
  it('rejects labels introduced only by new_str', async () => {
    const file = join(directory, 'sample.js');
    writeFileSync(file, source);
    expect((await editor.strReplace(file, "const title = 'initial';", "1.2 const title = 'changed';")).success).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(source);
  });
  it.each(['vue', 'php'])('guards insertions in .%s source', async extension => {
    const file = join(directory, `sample.${extension}`);
    writeFileSync(file, source);
    expect((await editor.insert(file, 1, "1.2 const title = 'changed';")).success).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(source);
  });
  it('guards direct line replacement too', async () => {
    const file = join(directory, 'sample.js');
    writeFileSync(file, source);
    expect((await editor.replaceLines(file, 1, 1, "1.2 const title = 'changed';")).success).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(source);
  });
  it.each(['1.2. const', '1.2.const'])('rejects dotted display labels in old_str: %s', async prefix => {
    const file = join(directory, 'sample.js');
    writeFileSync(file, source);
    const decorated = prefix + " title = 'initial';";
    expect((await editor.strReplace(file, decorated, decorated.replace('initial', 'changed'))).success).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(source);
  });
  it('rejects a dotted label introduced only by new_str or replaceLines', async () => {
    const file = join(directory, 'sample.js');
    writeFileSync(file, source);
    expect((await editor.strReplace(file, "const title = 'initial';", "1.2. const title = 'changed';")).success).toBe(false);
    expect((await editor.replaceLines(file, 1, 1, "1.2. const title = 'changed';")).success).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(source);
  });
  it.each(['html', 'kt'])('guards display-labelled insertions in .%s source', async extension => {
    const file = join(directory, `sample.${extension}`);
    writeFileSync(file, source);
    expect((await editor.insert(file, 1, "1.2 const title = 'changed';")).success).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(source);
  });
});
