/**
 * str_replace single-occurrence path used content.replace(oldStr, newStr) with
 * newStr as a plain string, so String.replace interpreted `$`-patterns in the
 * REPLACEMENT ($&, $$, $`, $', $n). Replacing with code containing "$&" inserted
 * the matched text, and "$`" the entire preceding file — corrupting the edit.
 * The fix passes a replacement function so newStr is inserted verbatim.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TextEditorTool } from '../../src/tools/text-editor.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';

describe('str_replace inserts $-patterns literally (no String.replace expansion)', () => {
  let dir: string;
  let editor: TextEditorTool;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-editor-dollar-'));
    (ConfirmationService as unknown as { instance?: ConfirmationService }).instance = undefined;
    ConfirmationService.getInstance().setSessionFlag('fileOperations', true);
    editor = new TextEditorTool();
    editor.setBaseDirectory(dir);
  });

  afterEach(() => {
    editor.dispose();
    (ConfirmationService as unknown as { instance?: ConfirmationService }).instance = undefined;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  function seed(content: string, name = 'f.ts'): string {
    const p = path.join(dir, name);
    fs.writeFileSync(p, content);
    return p;
  }

  it('keeps $$ literal (not collapsed to $)', async () => {
    const p = seed('const label = OLD;');
    const r = await editor.strReplace(p, 'OLD', '"$5 ($$ each)"');
    expect(r.success).toBe(true);
    expect(fs.readFileSync(p, 'utf-8')).toBe('const label = "$5 ($$ each)";');
  });

  it('keeps $& literal (does not insert the matched text)', async () => {
    const p = seed('const x = OLD;');
    const r = await editor.strReplace(p, 'OLD', 'y.replace(/a/, "$&!")');
    expect(r.success).toBe(true);
    expect(fs.readFileSync(p, 'utf-8')).toBe('const x = y.replace(/a/, "$&!");');
  });

  it('keeps $` literal (does not inject the preceding file content)', async () => {
    const p = seed('const x = OLD;');
    const r = await editor.strReplace(p, 'OLD', 'a$`b');
    expect(r.success).toBe(true);
    expect(fs.readFileSync(p, 'utf-8')).toBe('const x = a$`b;');
  });

  it('replaceAll path is also literal for $-patterns', async () => {
    const p = seed('A and A');
    const r = await editor.strReplace(p, 'A', '$&', true);
    expect(r.success).toBe(true);
    expect(fs.readFileSync(p, 'utf-8')).toBe('$& and $&');
  });
});
