/**
 * L4 — the diff-review gate (CODEBUDDY_DIFF_REVIEW) must cover insert and
 * replace_lines too, not just str_replace/create. Before this, those two
 * commands wrote directly and silently bypassed the gate.
 *
 * Real modules, no mocks: a benign edit is accepted+applied through the gate;
 * an edit carrying an omission/truncation marker is rejected and NOT written.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TextEditorTool } from '../../src/tools/text-editor.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';

describe('diff-review gate covers insert/replace_lines (L4)', () => {
  let dir: string;
  let editor: TextEditorTool;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-editor-gate-'));
    (ConfirmationService as unknown as { instance?: ConfirmationService }).instance = undefined;
    ConfirmationService.getInstance().setSessionFlag('fileOperations', true);
    editor = new TextEditorTool();
    editor.setBaseDirectory(dir);
    process.env.CODEBUDDY_DIFF_REVIEW = 'static';
  });

  afterEach(() => {
    delete process.env.CODEBUDDY_DIFF_REVIEW;
    editor.dispose();
    (ConfirmationService as unknown as { instance?: ConfirmationService }).instance = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seed(name = 'f.ts'): string {
    const p = path.join(dir, name);
    fs.writeFileSync(p, 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
    return p;
  }

  it('insert: routes an accepted edit through the gate and applies it', async () => {
    const p = seed();
    const result = await editor.insert(p, 2, 'const inserted = 99;');
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/review accepted/i); // proves the GATE ran, not the legacy write
    expect(fs.readFileSync(p, 'utf-8')).toContain('const inserted = 99;');
  });

  it('insert: rejects an omission-marker edit and does NOT write', async () => {
    const p = seed();
    const before = fs.readFileSync(p, 'utf-8');
    const result = await editor.insert(p, 2, '// ... rest of code unchanged ...');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/review|omission/i);
    expect(fs.readFileSync(p, 'utf-8')).toBe(before); // unchanged — gate blocked the write
  });

  it('replaceLines: routes an accepted edit through the gate and applies it', async () => {
    const p = seed();
    const result = await editor.replaceLines(p, 2, 2, 'const b = 22;');
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/review accepted/i);
    expect(fs.readFileSync(p, 'utf-8')).toContain('const b = 22;');
  });

  it('replaceLines: rejects an omission-marker edit and does NOT write', async () => {
    const p = seed();
    const before = fs.readFileSync(p, 'utf-8');
    const result = await editor.replaceLines(p, 2, 2, '// ... rest of code unchanged ...');
    expect(result.success).toBe(false);
    expect(fs.readFileSync(p, 'utf-8')).toBe(before);
  });
});
