/**
 * Les secrets d'un projet App Studio ne sortent JAMAIS : ni vers le renderer,
 * ni dans le dossier du projet (donc ni vers l'agent), ni dans un journal, ni
 * dans une version (vrai git), ni dans l'export zip (vrai archiver), ni dans un
 * site construit (export refusé). Le prompt est couvert par
 * studio-iterate/studio-view-request-context.test.tsx.
 */
import archiver from 'archiver';
import { execFileSync } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, symlinkSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { guardSiteExport, ProjectSecretsService, parseDotenv, redactText, REDACTED } from '../src/main/studio/project-secrets-service';
import { STUDIO_ZIP_IGNORE } from '../src/main/studio/studio-export-excludes';
import { StudioVersionsService } from '../src/main/studio/studio-versions-service';

const SECRET = 'sk-test-VALEUR-SECRETE-0123456789';
const DOTENV_SECRET = 'dotenv-SECRET-abcdef987654';

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function allFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...allFiles(abs));
    else out.push(abs);
  }
  return out;
}

describe('secrets du projet App Studio', () => {
  let base: string;
  let root: string;
  let store: string;
  let service: ProjectSecretsService;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'studio-secrets-')));
    root = path.join(base, 'projet');
    store = path.join(base, 'donnees-cowork', 'studio-secrets');
    mkdirSync(path.join(root, 'src'), { recursive: true });
    writeFileSync(path.join(root, 'index.html'), '<div id="root"></div>\n');
    writeFileSync(path.join(root, 'src', 'main.ts'), 'console.log(import.meta.env.VITE_API_KEY);\n');
    service = new ProjectSecretsService({ storeDir: store, trustedRoots: () => [base] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(base, { recursive: true, force: true });
  });

  it("n'expose que les noms au renderer et range la valeur HORS du projet (0600)", async () => {
    const res = await service.set(root, 'VITE_API_KEY', SECRET);
    expect(res).toEqual({ ok: true, data: [{ key: 'VITE_API_KEY', length: SECRET.length }] });
    expect(JSON.stringify(await service.list(root))).not.toContain(SECRET);
    // Rien dans le projet : l'agent, qui lit le projet, ne peut pas le voir.
    for (const file of allFiles(root)) expect(readFileSync(file, 'utf8')).not.toContain(SECRET);
    const stored = allFiles(store);
    expect(stored).toHaveLength(1);
    expect(readFileSync(stored[0] as string, 'utf8')).toContain(SECRET);
    if (process.platform !== 'win32') expect(statSync(stored[0] as string).mode & 0o777).toBe(0o600);
    expect(await service.envFor(root)).toEqual({ VITE_API_KEY: SECRET });
  });

  it('refuse une racine hors des espaces de confiance et un nom invalide', async () => {
    const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'hors-confiance-')));
    try {
      expect((await service.set(outside, 'VITE_X', SECRET)).ok).toBe(false);
      expect((await service.set(root, 'BAD-NAME', SECRET)).ok).toBe(false);
      expect((await service.set(root, 'VITE_X', 'a\nb')).ok).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("masque les secrets rangés ET ceux d'un .env du projet, sans jamais les journaliser", async () => {
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'debug'),
    ];
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');
    await service.set(root, 'VITE_API_KEY', SECRET);
    await service.set(root, 'VITE_API_KEY', `${SECRET}-2`);
    await service.set(root, 'VITE_API_KEY', SECRET);
    writeFileSync(path.join(root, '.env.local'), `# commentaire\nOTHER_TOKEN="${DOTENV_SECRET}"\n`);
    const res = await service.redact(root, `erreur: clé ${SECRET} et ${DOTENV_SECRET} refusées`);
    expect(res).toEqual({ ok: true, data: `erreur: clé ${REDACTED} et ${REDACTED} refusées` });
    await service.set(root, 'BAD-NAME', SECRET);
    await service.remove(root, 'VITE_API_KEY');
    const logged = [...spies, stdout, stderr].flatMap((spy) => spy.mock.calls.map((c) => c.map(String).join(' '))).join('\n');
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(DOTENV_SECRET);
  });

  it('parseDotenv et redactText', () => {
    expect(parseDotenv('A=1\nexport B="x y"\n# c\nC=z # note\n')).toEqual({ A: '1', B: 'x y', C: 'z' });
    expect(redactText('abcd abcdef', ['abcd', 'abcdef', 'ab'])).toBe(`${REDACTED} ${REDACTED}`);
  });

  it.skipIf(!hasGit())("n'entre dans aucune version (vrai git) : ni le secret rangé, ni un .env du projet", async () => {
    await service.set(root, 'VITE_API_KEY', SECRET);
    writeFileSync(path.join(root, '.env.local'), `VITE_OTHER=${DOTENV_SECRET}\n`);
    const versions = new StudioVersionsService({ trustedRoots: () => [base] });
    const snap = await versions.snapshot(root, 'Tour : test');
    expect(snap.ok).toBe(true);
    const gitDir = path.join(root, '.codebuddy', 'studio-versions.git');
    const objects = execFileSync('git', ['--git-dir', gitDir, 'rev-list', '--all', '--objects'], { encoding: 'utf8' });
    const blobs = objects
      .split('\n')
      .map((l) => l.split(' ')[0])
      .filter((id): id is string => Boolean(id));
    expect(blobs.length).toBeGreaterThan(0);
    for (const id of blobs) {
      const type = execFileSync('git', ['--git-dir', gitDir, 'cat-file', '-t', id], { encoding: 'utf8' }).trim();
      if (type !== 'blob') continue;
      const content = execFileSync('git', ['--git-dir', gitDir, 'cat-file', '-p', id], { encoding: 'utf8' });
      expect(content).not.toContain(SECRET);
      expect(content).not.toContain(DOTENV_SECRET);
    }
    expect(objects).not.toContain('.env.local');
  });

  it.skipIf(!hasGit())('libellé de version tapé dans le chat : masqué avant le commit et à la relecture (vrai git)', async () => {
    await service.set(root, 'VITE_API_KEY', SECRET);
    const redact = async (r: string, t: string) => {
      const res = await service.redact(r, t);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    };
    const gitDir = path.join(root, '.codebuddy', 'studio-versions.git');
    const allObjects = () => {
      const ids = execFileSync('git', ['--git-dir', gitDir, 'rev-list', '--all', '--objects'], { encoding: 'utf8' })
        .split('\n').map((l) => l.split(' ')[0]).filter((id): id is string => Boolean(id));
      return ids.map((id) => execFileSync('git', ['--git-dir', gitDir, 'cat-file', '-p', id], { encoding: 'utf8' })).join('\n');
    };
    // 1. Écriture : le commit ne porte jamais la valeur.
    const versions = new StudioVersionsService({ trustedRoots: () => [base], redact });
    writeFileSync(path.join(root, 'src', 'main.ts'), 'console.log(1);\n');
    const snap = await versions.snapshot(root, `Tour : Utilise la clé ${SECRET}`);
    expect(snap.ok && snap.data.changed).toBe(true);
    expect(allObjects()).not.toContain(SECRET);
    expect(allObjects()).toContain(`Tour : Utilise la clé ${REDACTED}`);
    // 2. Relecture : une version écrite AVANT le correctif (sans masquage) est masquée dans la liste IPC.
    const legacy = new StudioVersionsService({ trustedRoots: () => [base] });
    writeFileSync(path.join(root, 'src', 'main.ts'), 'console.log(2);\n');
    await legacy.snapshot(root, `Tour : ancienne ${SECRET}`);
    expect(allObjects()).toContain(SECRET); // l'ancien historique la contient bien
    const list = await versions.list(root);
    expect(list.ok).toBe(true);
    expect(JSON.stringify(list)).not.toContain(SECRET);
    expect(list.ok && list.data[0]?.label).toBe(`Tour : ancienne ${REDACTED}`);
    // 3. Masquage impossible : libellé neutre, jamais le texte brut.
    const broken = new StudioVersionsService({ trustedRoots: () => [base], redact: async () => { throw new Error('boom'); } });
    const brokenList = await broken.list(root);
    expect(JSON.stringify(brokenList)).not.toContain(SECRET);
  });

  it("n'entre pas dans l'export zip (vrai archiver, mêmes exclusions que Cowork)", async () => {
    await service.set(root, 'VITE_API_KEY', SECRET);
    writeFileSync(path.join(root, '.env'), `A=${DOTENV_SECRET}\n`);
    mkdirSync(path.join(root, 'sous', 'node_modules', 'x'), { recursive: true });
    writeFileSync(path.join(root, 'sous', '.env.production'), `B=${DOTENV_SECRET}\n`);
    writeFileSync(path.join(root, 'sous', 'node_modules', 'x', 'index.js'), 'x');
    const zipPath = path.join(base, 'export.zip');
    const names: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 1 } });
      archive.on('entry', (entry) => names.push(entry.name));
      output.on('close', () => resolve());
      archive.on('error', reject);
      archive.pipe(output);
      archive.glob('**/*', { cwd: root, dot: true, follow: false, ignore: [...STUDIO_ZIP_IGNORE] });
      void archive.finalize();
    });
    expect(names.filter((n) => !n.endsWith('/')).sort()).toEqual(['index.html', 'src/main.ts']);
    expect(readFileSync(zipPath).includes(Buffer.from(DOTENV_SECRET))).toBe(false);
  });

  it('export zip : sorties de build exclues, secret en clair dans un fichier source = refus', async () => {
    await service.set(root, 'VITE_API_KEY', SECRET);
    writeFileSync(path.join(root, '.env.local'), `VITE_API_KEY=${SECRET}\n`);
    mkdirSync(path.join(root, 'dist', 'assets'), { recursive: true });
    writeFileSync(path.join(root, 'dist', 'assets', 'index.js'), `const k="${SECRET}";`);
    expect(await service.findZipLeaks(root)).toEqual([]); // .env et dist ne partent pas dans le zip
    writeFileSync(path.join(root, 'src', 'config.ts'), `export const KEY = '${SECRET}';\n`);
    expect(await service.findZipLeaks(root)).toEqual([path.join('src', 'config.ts')]);
  });

  it('refuse une valeur trop courte pour être masquée ; racine hors confiance : .env non lus', async () => {
    expect((await service.set(root, 'PIN', '123')).ok).toBe(false);
    const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'hors-confiance-')));
    try {
      writeFileSync(path.join(outside, '.env'), `X=${DOTENV_SECRET}\n`);
      expect(await service.valuesFor(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('réserves vague 2 : .env de sous-dossier masqué, lien symbolique fouillé, médias du zip fouillés', async () => {
    mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
    writeFileSync(path.join(root, 'apps', 'web', '.env.local'), `API_TOKEN=${DOTENV_SECRET}\n`);
    const red = await service.redact(root, `jeton ${DOTENV_SECRET}`);
    expect(red).toEqual({ ok: true, data: `jeton ${REDACTED}` });
    // Lien symbolique vers un fichier contenant le secret, dans un site exporté.
    const site = path.join(base, 'site');
    mkdirSync(site, { recursive: true });
    const outsideFile = path.join(base, 'config-dehors.js');
    writeFileSync(outsideFile, `const t="${DOTENV_SECRET}";`);
    symlinkSync(outsideFile, path.join(site, 'config.js'));
    expect(await service.findLeaks(root, site)).toEqual(['config.js']);
    // Média généré (réinclus dans le zip) contenant la valeur.
    mkdirSync(path.join(root, '.codebuddy', 'media-generation', 'images'), { recursive: true });
    writeFileSync(path.join(root, '.codebuddy', 'media-generation', 'images', 'a.png'), Buffer.from(`PNG${DOTENV_SECRET}`));
    expect(await service.findZipLeaks(root)).toEqual([path.join('.codebuddy', 'media-generation', 'images', 'a.png')]);
  });

  it('repère un secret intégré à un site construit (export refusé par Cowork)', async () => {
    await service.set(root, 'VITE_API_KEY', SECRET);
    const dist = path.join(base, 'site-exporte');
    mkdirSync(path.join(dist, 'assets'), { recursive: true });
    writeFileSync(path.join(dist, 'index.html'), '<script src="assets/index.js"></script>');
    writeFileSync(path.join(dist, 'assets', 'index.js'), `const k="${SECRET}";`);
    expect(await service.findLeaks(root, dist)).toEqual([path.join('assets', 'index.js')]);
    // Le garde branché sur l'IPC studio.exportSite : export refusé ET dossier supprimé.
    const refused = await guardSiteExport(service, root, { ok: true, data: { savedTo: dist, kind: 'build', files: 2 } });
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).not.toContain(SECRET);
    expect(existsSync(dist)).toBe(false);
    mkdirSync(path.join(dist, 'assets'), { recursive: true });
    writeFileSync(path.join(dist, 'assets', 'index.js'), 'const k=import.meta.env;');
    expect(await service.findLeaks(root, dist)).toEqual([]);
    const kept = await guardSiteExport(service, root, { ok: true, data: { savedTo: dist, kind: 'build', files: 1 } });
    expect(kept.ok).toBe(true);
    expect(existsSync(dist)).toBe(true);
  });
});
