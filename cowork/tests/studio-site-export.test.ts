/**
 * « Exporter le site » — tests réels : vrai `npm run build` (script sans
 * dépendance), vraie copie sur disque. Seule la boîte de dialogue est simulée.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SiteExportService } from '../src/main/studio/site-export-service';

describe('SiteExportService', () => {
  let base: string;
  let root: string;
  let outParent: string;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'studio-site-')));
    root = path.join(base, 'mon-app');
    outParent = path.join(base, 'exports');
    mkdirSync(root);
    mkdirSync(outParent);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('projet npm : lance le vrai `npm run build` et copie dist/', async () => {
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'mon-app', scripts: { build: 'node build.cjs' } }),
    );
    writeFileSync(
      path.join(root, 'build.cjs'),
      "const fs=require('fs');fs.mkdirSync('dist/assets',{recursive:true});fs.writeFileSync('dist/index.html','<h1>ok</h1>');fs.writeFileSync('dist/assets/a.js','1');console.log('construit');",
    );
    const service = new SiteExportService({ chooseDirectory: async () => outParent });
    const res = await service.exportSite({ root });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.kind).toBe('build');
    expect(res.data.savedTo).toBe(path.join(outParent, 'mon-app-site'));
    expect(res.data.files).toBe(2);
    expect(readFileSync(path.join(res.data.savedTo, 'index.html'), 'utf8')).toBe('<h1>ok</h1>');
    expect(res.data.buildLog?.join('\n')).toContain('construit');
    // Deuxième export : pas d'écrasement, suffixe.
    const again = await service.exportSite({ root });
    expect(again.ok && again.data.savedTo).toBe(path.join(outParent, 'mon-app-site-2'));
  }, 60_000);

  it('build en échec : erreur + journal, rien de copié', async () => {
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', scripts: { build: 'node -e "process.exit(3)"' } }));
    const service = new SiteExportService({ chooseDirectory: async () => outParent });
    const res = await service.exportSite({ root });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('code 3');
    expect(existsSync(path.join(outParent, 'mon-app-site'))).toBe(false);
  }, 60_000);

  it('site statique : copie les fichiers sans node_modules ni .codebuddy', async () => {
    writeFileSync(path.join(root, 'index.html'), '<h1>statique</h1>');
    writeFileSync(path.join(root, 'app.js'), '1');
    mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
    writeFileSync(path.join(root, 'node_modules', 'x', 'i.js'), '1');
    mkdirSync(path.join(root, '.codebuddy'));
    writeFileSync(path.join(root, '.codebuddy', 'studio-locks.json'), '{}');
    const service = new SiteExportService({ chooseDirectory: async () => outParent });
    const res = await service.exportSite({ root });
    expect(res.ok && res.data.kind).toBe('static');
    if (!res.ok) return;
    expect(res.data.files).toBe(2);
    expect(existsSync(path.join(res.data.savedTo, 'node_modules'))).toBe(false);
    expect(existsSync(path.join(res.data.savedTo, '.codebuddy'))).toBe(false);
  });

  it('annulation, dossier dans le projet, racine hors confiance, rien à exporter', async () => {
    writeFileSync(path.join(root, 'index.html'), 'x');
    expect(await new SiteExportService({ chooseDirectory: async () => null }).exportSite({ root })).toMatchObject({ ok: false, canceled: true });
    const inside = await new SiteExportService({ chooseDirectory: async () => root }).exportSite({ root });
    expect(inside.ok).toBe(false);
    const untrusted = await new SiteExportService({ trustedRoots: () => [outParent], chooseDirectory: async () => outParent }).exportSite({ root });
    expect(untrusted).toMatchObject({ ok: false, error: 'project is outside trusted workspaces' });
    rmSync(path.join(root, 'index.html'));
    const empty = await new SiteExportService({ chooseDirectory: async () => outParent }).exportSite({ root });
    expect(empty.ok).toBe(false);
  });
});
