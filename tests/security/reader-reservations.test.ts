import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = vi.hoisted(() => {
  const root = `${process.cwd()}/_qa/securite-reprise-readers`;
  const previousHome = process.env.HOME;
  process.env.HOME = `${root}/home`;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, home: `${root}/home`, previousHome };
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TodoScanTool } from '../../src/tools/todo-scan-tool.js';
import { executeResolveConflicts, resolveAllConflicts } from '../../src/tools/merge-conflict-tool.js';
import { scanFile } from '../../src/tools/bug-finder-tool.js';
import { CodeStatsTool } from '../../src/tools/code-stats-tool.js';
import { BundleAnalyzeTool } from '../../src/tools/bundle-analyze-tool.js';
import { LspSymbolsTool, type LspReadClient } from '../../src/tools/lsp-navigation-tools.js';

const fake = 'FAKE-READER-SECRET-259';
let work: string;

beforeAll(() => {
  fs.rmSync(qa.root, { recursive: true, force: true });
  fs.mkdirSync(qa.home, { recursive: true });
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-reader-secret-'));
  fs.writeFileSync(path.join(work, 'prod.env'), `API_KEY=${fake}\n`);
  fs.writeFileSync(path.join(work, 'notes.txt'), 'TODO: vérifier la livraison\n');
  fs.mkdirSync(path.join(qa.home, '.codebuddy'), { recursive: true });
  fs.writeFileSync(path.join(qa.home, '.codebuddy', 'auth.ts'), 'eval(\'FAKE\');\n');
  fs.writeFileSync(path.join(work, 'secrets.json'), [
    '<<<<<<< HEAD',
    `{"api_key":"${fake}"}`,
    '=======',
    '{}',
    '>>>>>>> main',
  ].join('\n'));
});

afterAll(() => {
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (work) fs.rmSync(work, { recursive: true, force: true });
  if (qa.previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previousHome;
});

describe('réserves des lecteurs de projet', () => {
  it('todo_scan ne renvoie pas la valeur d’un secret par un marqueur choisi', async () => {
    const secret = await new TodoScanTool().execute({ root: work, markers: ['API_KEY'] });
    expect(secret.success).toBe(true);
    expect(JSON.stringify(secret.data)).not.toContain(fake);
    expect((secret.data as { total: number }).total).toBe(0);

    const ordinary = await new TodoScanTool().execute({ root: work });
    expect(ordinary.success).toBe(true);
    expect((ordinary.data as { total: number }).total).toBe(1);
  });

  it('resolve_conflicts ne révèle ni ne réécrit un secret de projet', async () => {
    const previous = process.cwd();
    process.chdir(work);
    try {
      const result = await executeResolveConflicts({ file_path: 'secrets.json', strategy: 'ai' });
      expect(result.success).toBe(false);
      expect(result.output ?? '').not.toContain(fake);
      expect(result.error).toMatch(/credential\/secret/i);
      await expect(resolveAllConflicts(path.join(work, 'secrets.json'))).rejects.toThrow(/credential\/secret/i);
      expect(fs.readFileSync(path.join(work, 'secrets.json'), 'utf8')).toContain(fake);
    } finally {
      process.chdir(previous);
    }
  });

  it('bug_finder ne lit pas un fichier d’identifiants TypeScript', () => {
    expect(scanFile(path.join(qa.home, '.codebuddy', 'auth.ts'))).toEqual([]);
  });

  it('code_stats exclut les fichiers secrets des métriques', async () => {
    const stats = await new CodeStatsTool().execute({ root: work });
    expect(stats.success).toBe(true);
    const files = (stats.data as { largestFiles: Array<{ file: string }> }).largestFiles.map((item) => item.file);
    expect(files).not.toContain('prod.env');
    expect(files).not.toContain('secrets.json');
    expect(files).toContain('notes.txt');
  });

  it('bundle_analyze exclut les fichiers secrets des tailles', async () => {
    const bundle = await new BundleAnalyzeTool().execute({ root: work, distDir: '.' });
    expect(bundle.success).toBe(true);
    const bundleFiles = (bundle.data as { files: Array<{ file: string }> }).files.map((item) => item.file);
    expect(bundleFiles).not.toContain('prod.env');
    expect(bundleFiles).not.toContain('secrets.json');
    expect(bundleFiles).toContain('notes.txt');
  });

  it('la navigation LSP refuse un fichier d’identifiants avant l’appel au serveur', async () => {
    const ensureServerForFile = vi.fn(async () => true);
    const client: LspReadClient = {
      detectLanguage: () => 'typescript',
      getServerConfig: (language) => ({ language, command: 'typescript-language-server', args: ['--stdio'] }),
      ensureServerForFile,
      goToDefinition: async () => [],
      findReferences: async () => [],
      hover: async () => null,
      getDocumentSymbols: async () => [],
      getDiagnostics: async () => [],
    };
    const result = await new LspSymbolsTool({ client, commandExists: async () => true })
      .execute({ file: '.codebuddy/auth.ts' }, { cwd: qa.home });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/credential\/secret/i);
    expect(ensureServerForFile).not.toHaveBeenCalled();
  });
});
