/**
 * Registry file tools must resolve RELATIVE paths against the execution
 * context's cwd (the embedded engine's session workingDirectory), not the
 * host process cwd. Regression for the live Cowork incident: an App Studio
 * generation scoped to /tmp/e2e-meteo3 wrote `index.html` into the Electron
 * launch dir and overwrote cowork's own vite entry.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs';
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
let localCwd: string;

beforeAll(() => {
  ConfirmationService.getInstance().setSessionFlag('fileOperations', true);
  sessionCwd = mkdtempSync(join(tmpdir(), 'tools-cwd-test-'));
  mkdirSync(join(process.cwd(), '_qa'), { recursive: true });
  localCwd = mkdtempSync(join(process.cwd(), '_qa', 'tools-cwd-'));
});

afterAll(() => {
  rmSync(sessionCwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(localCwd, { recursive: true, force: true });
  resetTextEditorInstance();
});

// Nom témoin unique : le dépôt a désormais un index.html à sa racine (GitHub Pages),
// un nom générique ferait échouer l'assertion « pas créé dans process.cwd() » à tort.
const PROBE = `meteo-cristal-${process.pid}.html`;

describe('registry file tools honor context.cwd for relative paths', () => {
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
    const tool = new StrReplaceEditorTool();
    const result = await tool.execute(
      { path: PROBE, old_str: 'Météo Cristal', new_str: 'Météo Cristal v2' },
      { cwd: sessionCwd }
    );
    expect(result.success).toBe(true);
    expect(readFileSync(join(sessionCwd, PROBE), 'utf8')).toContain('Météo Cristal v2');
  });

  it('view_file reads through the session cwd', async () => {
    const tool = new ViewFileTool();
    const result = await tool.execute({ path: PROBE }, { cwd: sessionCwd });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Météo Cristal v2');
  });

  it('keeps independent bases for concurrent calls on the shared adapter', async () => {
    const tool = new CreateFileTool();
    const results = await Promise.all([
      tool.execute({ path: 'parallel-a.txt', content: 'session-a' }, { cwd: sessionCwd }),
      tool.execute({ path: 'parallel-b.txt', content: 'session-b' }, { cwd: localCwd }),
    ]);
    expect(results.map(result => result.success)).toEqual([true, true]);
    expect(readFileSync(join(sessionCwd, 'parallel-a.txt'), 'utf8')).toBe('session-a');
    expect(readFileSync(join(localCwd, 'parallel-b.txt'), 'utf8')).toBe('session-b');
    expect(existsSync(join(sessionCwd, 'parallel-b.txt'))).toBe(false);
    expect(existsSync(join(localCwd, 'parallel-a.txt'))).toBe(false);
  });

  it('absolute paths retain their location within the explicit session base', async () => {
    const absolute = join(sessionCwd, 'abs.txt');
    const tool = new CreateFileTool();
    const withContext = await tool.execute({ path: absolute, content: 'abs' }, { cwd: sessionCwd });
    expect(withContext.success).toBe(true);
    expect(readFileSync(absolute, 'utf8')).toBe('abs');
  });

  it('an absolute path cannot bypass the explicit session base', async () => {
    const absolute = join(sessionCwd, 'outside.txt');
    const result = await new CreateFileTool().execute({ path: absolute, content: 'outside' }, { cwd: localCwd });
    expect(result.success).toBe(false);
    expect(existsSync(absolute)).toBe(false);
  });

  it('missing context uses the process base and refuses a whitelisted path outside it', async () => {
    const tool = new CreateFileTool();
    const local = join(localCwd, 'legacy.txt');
    expect((await tool.execute({ path: local, content: 'ok' })).success).toBe(true);
    expect(readFileSync(local, 'utf8')).toBe('ok');
    const outside = join(sessionCwd, 'legacy-outside.txt');
    expect((await tool.execute({ path: outside, content: 'outside' })).success).toBe(false);
    expect(existsSync(outside)).toBe(false);
  });
});
