/**
 * Registry file tools must resolve RELATIVE paths against the execution
 * context's cwd (the embedded engine's session workingDirectory), not the
 * host process cwd. Regression for the live Cowork incident: an App Studio
 * generation scoped to /tmp/e2e-meteo3 wrote `index.html` into the Electron
 * launch dir and overwrote cowork's own vite entry.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import {
  CreateFileTool,
  StrReplaceEditorTool,
  ViewFileTool,
  resetTextEditorInstance,
} from '../../src/tools/registry/text-editor-tools.js';

let sessionCwd: string;

beforeEach(() => {
  ConfirmationService.getInstance().setSessionFlag('fileOperations', true);
  sessionCwd = mkdtempSync(join(tmpdir(), 'tools-cwd-test-'));
});

afterEach(() => {
  rmSync(sessionCwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  resetTextEditorInstance();
});

// Nom témoin unique : le dépôt a désormais un index.html à sa racine (GitHub Pages),
// un nom générique ferait échouer l'assertion « pas créé dans process.cwd() » à tort.
const PROBE = `meteo-cristal-${process.pid}.html`;

describe('registry file tools honor context.cwd for relative paths', () => {
  it('applies a batch atomically in the session cwd', async () => {
    const file = join(sessionCwd, 'batch.txt');
    writeFileSync(file, 'first old\nsecond old\n');
    const tool = new StrReplaceEditorTool();
    const args = { path: 'batch.txt', operations: [
      { pattern: 'first old', replacement: 'first new' },
      { old_string: 'second old', new_string: 'second new' },
    ] };
    expect(tool.validate(args).valid).toBe(true);
    expect((await tool.execute(args, { cwd: sessionCwd })).success).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('first new\nsecond new\n');
  });
  it('does not apply an earlier edit when a later batch edit fails', async () => {
    const file = join(sessionCwd, 'rollback.txt');
    writeFileSync(file, 'keep this\n');
    const result = await new StrReplaceEditorTool().execute({ file_path: 'rollback.txt', changes: [
      { find: 'keep this', replace: 'changed' },
      { find: 'absent', replace: 'invented' },
    ] }, { cwd: sessionCwd });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No changes were applied');
    expect(readFileSync(file, 'utf8')).toBe('keep this\n');
  });
  it('retains omission protection for every edit in a batch', async () => {
    const file = join(sessionCwd, 'omission.txt');
    writeFileSync(file, 'first\nsecond\n');
    const result = await new StrReplaceEditorTool().execute({ path: 'omission.txt', operations: [
      { old_str: 'first', new_str: 'changed' },
      { old_str: 'second', new_str: '// ... remaining code' },
    ] }, { cwd: sessionCwd });
    expect(result.success).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe('first\nsecond\n');
  });
  it('treats pattern/replacement as literal text', async () => {
    const file = join(sessionCwd, 'literal.txt');
    writeFileSync(file, 'a.b axb\n');
    expect((await new StrReplaceEditorTool().execute({ path: 'literal.txt', pattern: 'a.b', replacement: 'done' }, { cwd: sessionCwd })).success).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('done axb\n');
  });
  it('create_file writes a relative path into the session cwd, not process.cwd()', async () => {
    const tool = new CreateFileTool();
    const result = await tool.execute(
      { path: PROBE, content: '<h1>Météo Cristal</h1>' },
      { cwd: sessionCwd }
    );
    expect(result.success).toBe(true);
    expect(existsSync(join(sessionCwd, PROBE))).toBe(true);
    expect(existsSync(join(process.cwd(), PROBE))).toBe(false);
  });

  it('str_replace_editor edits the file in the session cwd', async () => {
    writeFileSync(join(sessionCwd, PROBE), '<h1>Météo Cristal</h1>');
    const tool = new StrReplaceEditorTool();
    const result = await tool.execute(
      { path: PROBE, old_str: 'Météo Cristal', new_str: 'Météo Cristal v2' },
      { cwd: sessionCwd }
    );
    expect(result.success).toBe(true);
    expect(readFileSync(join(sessionCwd, PROBE), 'utf8')).toContain('Météo Cristal v2');
  });

  it('view_file reads through the session cwd', async () => {
    writeFileSync(join(sessionCwd, PROBE), '<h1>Météo Cristal v2</h1>');
    const tool = new ViewFileTool();
    const result = await tool.execute({ path: PROBE }, { cwd: sessionCwd });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Météo Cristal v2');
  });

  it('absolute paths and missing context keep the historical behavior', async () => {
    const absolute = join(sessionCwd, 'abs.txt');
    const tool = new CreateFileTool();
    const withContext = await tool.execute({ path: absolute, content: 'abs' }, { cwd: '/nonexistent-base' });
    expect(withContext.success).toBe(true);
    expect(existsSync(absolute)).toBe(true);

    // No context → resolve against process.cwd() (CLI behavior) — write into
    // a real subdir of the repo cwd? NO: keep the test hermetic by asserting
    // only that the path stays UNRESOLVED (we point at an absolute temp file).
    const legacy = await tool.execute({ path: join(sessionCwd, 'legacy.txt'), content: 'ok' });
    expect(legacy.success).toBe(true);
    expect(readFileSync(join(sessionCwd, 'legacy.txt'), 'utf8')).toBe('ok');
  });
});
