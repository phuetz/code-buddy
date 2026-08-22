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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import {
  CreateFileTool,
  StrReplaceEditorTool,
  ViewFileTool,
  resetTextEditorInstance,
} from '../../src/tools/registry/text-editor-tools.js';

let sessionCwd: string;

beforeAll(() => {
  ConfirmationService.getInstance().setSessionFlag('fileOperations', true);
  sessionCwd = mkdtempSync(join(tmpdir(), 'tools-cwd-test-'));
});

afterAll(() => {
  rmSync(sessionCwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  resetTextEditorInstance();
});

describe('registry file tools honor context.cwd for relative paths', () => {
  it('create_file writes a relative path into the session cwd, not process.cwd()', async () => {
    const tool = new CreateFileTool();
    const result = await tool.execute(
      { path: 'index.html', content: '<h1>Météo Cristal</h1>' },
      { cwd: sessionCwd }
    );
    expect(result.success).toBe(true);
    expect(existsSync(join(sessionCwd, 'index.html'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'index.html'))).toBe(false);
  });

  it('str_replace_editor edits the file in the session cwd', async () => {
    const tool = new StrReplaceEditorTool();
    const result = await tool.execute(
      { path: 'index.html', old_str: 'Météo Cristal', new_str: 'Météo Cristal v2' },
      { cwd: sessionCwd }
    );
    expect(result.success).toBe(true);
    expect(readFileSync(join(sessionCwd, 'index.html'), 'utf8')).toContain('Météo Cristal v2');
  });

  it('view_file reads through the session cwd', async () => {
    const tool = new ViewFileTool();
    const result = await tool.execute({ path: 'index.html' }, { cwd: sessionCwd });
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
