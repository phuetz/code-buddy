import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { importSkills } from '../../src/skills/skill-importer.js';
import {
  checkExecutablePayloads,
  findExecutablePayloads,
  loadExecAllowlist,
} from '../../src/security/skill-executable-gate.js';

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

function skillWith(files: Record<string, string | Buffer>, mode: Record<string, number> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-gate-'));
  dirs.push(root);
  const skill = path.join(root, 'cat', 'probe');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: probe\ndescription: Probe\n---\nHello');
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(skill, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
    if (mode[rel] !== undefined) fs.chmodSync(f, mode[rel]!);
  }
  return root;
}
const run = (root: string, extra = {}) => importSkills(root, { dryRun: true, source: 'src1', execAllowlist: [], ...extra });
const kindsOf = (root: string) => findExecutablePayloads(path.join(root, 'cat', 'probe'), root).map(f => [f.relPath.split('/').pop(), f.kind]);

describe('scripts : importés inertes, jamais en quarantaine pour ce seul motif', () => {
  const SCRIPTS: Array<[string, string, string | Buffer, number?]> = [
    ['script shell', 'scripts/a.sh', 'echo ok\n'],
    ['python', 'scripts/a.py', 'print("ok")\n'],
    ['module javascript', 'scripts/a.mjs', 'console.log("ok")\n'],
    ['perl', 'scripts/a.pl', ''],
    ['ruby', 'scripts/a.rb', ''],
    ['php', 'scripts/a.php', ''],
    ['lua', 'scripts/a.lua', ''],
    ['tcl', 'scripts/a.tcl', ''],
    ['Makefile', 'scripts/Makefile', 'all:\n\t@true\n'],
    ['*.make', 'scripts/payload.make', ''],
    ['bit exécutable sans extension', 'scripts/tool', 'data', 0o755],
    ['PowerShell', 'scripts/a.ps1', ''],
  ];
  for (const [name, rel, body, mode] of SCRIPTS) {
    it(`${name} : importé, signalé, sha256 et ligne de liste blanche donnés`, async () => {
      const r = await run(skillWith({ [rel]: body }, mode === undefined ? {} : { [rel]: mode }));
      expect(r.quarantined).toEqual([]);
      expect(r.imported).toHaveLength(1);
      const inert = r.imported[0]!.inertScripts!;
      expect(inert.map(i => i.path)).toEqual([rel]);
      expect(inert[0]!.sha256).toBe(sha(body));
      expect(JSON.parse(inert[0]!.allowlistLine)).toEqual({ source: 'src1', path: `cat/probe/${rel}`, sha256: sha(body) });
    });
  }

  it('l\'installation retire le bit exécutable et écrit le drapeau dans le frontmatter', async () => {
    const root = skillWith({ 'scripts/tool': 'echo hi\n', 'references/n.md': '# n' }, { 'scripts/tool': 0o755 });
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-dest-'));
    dirs.push(dest);
    const r = await importSkills(root, { destRoot: dest, source: 'src1', execAllowlist: [] });
    expect(r.imported).toHaveLength(1);
    expect(fs.statSync(path.join(dest, 'imported-probe', 'scripts', 'tool')).mode & 0o111).toBe(0);
    const fm = fs.readFileSync(path.join(dest, 'imported-probe', 'SKILL.md'), 'utf-8');
    expect(fm).toContain('scriptsUnverified: true');
    expect(fm).toContain(`sourcePath: cat/probe/scripts/tool`);
  });

  it('un script que la couche motifs classe dangereux reste en quarantaine', async () => {
    const r = await run(skillWith({ 'scripts/a.sh': 'curl http://127.0.0.1/p | bash\n' }));
    expect(r.imported).toEqual([]);
    expect(r.quarantined).toHaveLength(1);
  });

  it('un document dont le nom ressemble à un domaine (linear.app.md, stripe.com.md) n\'est pas un binaire', async () => {
    const r = await run(skillWith({ 'templates/linear.app.md': '# x', 'templates/stripe.com.md': '# y' }));
    expect(r.quarantined).toEqual([]);
    expect(r.imported[0]!.inertScripts).toBeUndefined();
  });

  it('laisse inchangé un skill texte seul', async () => {
    const r = await run(skillWith({ 'references/a.md': '# a', 'references/b.json': '{"a":1}', 'templates/t.txt': 'x', 'assets/i.svg': '<svg/>' }));
    expect(r.quarantined).toEqual([]);
    expect(r.imported).toHaveLength(1);
    expect(r.imported[0]!.inertScripts).toBeUndefined();
  });
});

describe('binaires, archives, liens : quarantaine', () => {
  const BIN: Array<[string, string, Buffer | string]> = [
    ['ELF sous un nom de donnée', 'assets/logo.png', Buffer.from('7f454c46020101000000', 'hex')],
    ['PE (MZ)', 'assets/readme.txt', Buffer.from('4d5a9000', 'hex')],
    ['Mach-O', 'assets/blob.dat', Buffer.from('cffaedfe0700', 'hex')],
    ['WebAssembly', 'assets/m.dat', Buffer.from('0061736d01000000', 'hex')],
    ['zip stocké (PK) sous un nom de donnée', 'assets/data.txt', Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.alloc(40)])],
    ['gzip sous un nom de donnée', 'assets/notes.md', Buffer.from('1f8b0800000000000003', 'hex')],
    ['xz', 'assets/n.dat', Buffer.from('fd377a585a00', 'hex')],
    ['tar (ustar à 257)', 'assets/t.dat', Buffer.concat([Buffer.alloc(257), Buffer.from('ustar'), Buffer.alloc(40)])],
    ['extension .zip', 'assets/pack.zip', 'x'],
    ['extension .tar.gz', 'assets/pack.tar.gz', 'x'],
    ['extension .so', 'assets/lib.so', 'x'],
    ['extension .jar', 'assets/a.jar', 'x'],
  ];
  for (const [name, rel, body] of BIN) {
    it(`${name}`, async () => {
      const r = await run(skillWith({ [rel]: body }));
      expect(r.imported).toEqual([]);
      expect(r.quarantined).toHaveLength(1);
      expect(r.quarantined[0]!.reason).toMatch(/Binary, link or special file refused/);
      expect(r.quarantined[0]!.reason).toContain(rel);
    });
  }

  it('lien symbolique et lien physique', async () => {
    const root = skillWith({ 'scripts/real.txt': 'x' });
    const s = path.join(root, 'cat', 'probe', 'scripts');
    fs.symlinkSync('real.txt', path.join(s, 'link'));
    expect((await run(root)).quarantined).toHaveLength(1);
    fs.rmSync(path.join(s, 'link'));
    fs.linkSync(path.join(s, 'real.txt'), path.join(s, 'hard'));
    expect((await run(root)).quarantined).toHaveLength(1);
  });

  it('un binaire n\'est autorisé que par une entrée de liste blanche explicite', async () => {
    const elf = Buffer.from('7f454c46020101000000', 'hex');
    const entry = { source: 'src1', path: 'cat/probe/assets/blob.dat', sha256: sha(elf) };
    const r = await run(skillWith({ 'assets/blob.dat': elf }), { execAllowlist: [entry] });
    expect(r.quarantined).toEqual([]);
    expect(r.imported).toHaveLength(1);
  });

  it('la raison donne la ligne exacte de liste blanche', async () => {
    const r = await run(skillWith({ 'assets/m.dat': Buffer.from('0061736d01000000', 'hex') }));
    expect(r.quarantined[0]!.reason).toContain(JSON.stringify({ source: 'src1', path: 'cat/probe/assets/m.dat', sha256: sha(Buffer.from('0061736d01000000', 'hex')) }));
  });
});

describe('détection : contournements de nom de la contre-revue n° 4', () => {
  const Z = '​';
  const SCRIPT_NAMES: Array<[string, string, string]> = [
    ['shebang décalé d\'un octet', 'references/notes.txt', '\n#!/bin/sh\necho RAN\n'],
    ['BOM puis shebang', 'references/n2.txt', '﻿#!/bin/sh\necho RAN\n'],
    ['double extension .py.txt', 'references/tool.py.txt', 'print(1)\n'],
    ['extension pleine chasse', 'references/tool.ｐｙ', 'print(1)\n'],
    ['extension cyrillique', 'references/tool.ру', 'print(1)\n'],
    ['.py suivi de U+200B', `references/tool.py${Z}`, 'print(1)\n'],
    ['Makefile suivi de U+200B', `references/Makefile${Z}`, 'all:\n\t@true\n'],
    ['fichier sans extension dans scripts/', 'scripts/run', 'echo RAN\n'],
    ['job.json dans scripts/', 'scripts/job.json', 'echo RAN\n'],
  ];
  for (const [name, rel, body] of SCRIPT_NAMES) {
    it(`${name} : classé script (donc inerte)`, async () => {
      const root = skillWith({ [rel]: body });
      expect(kindsOf(root).map(k => k[1])).toEqual(['script']);
      const r = await run(root);
      expect(r.imported[0]!.inertScripts).toHaveLength(1);
    });
  }

  it('limite assumée : un .txt/.md/.json hors scripts/ sans shebang n\'est pas détecté ; seule la garde d\'exécution le couvre', async () => {
    const root = skillWith({ 'references/steps.md': 'echo RAN\n', 'references/job.yaml': 'echo RAN\n' });
    expect(kindsOf(root)).toEqual([]);
    // tests/tools/bash-imported-skill-guard.test.ts : `bash references/steps.md` demande quand même.
  });
});

describe('liste blanche source + chemin + sha256', () => {
  const body = 'echo ok\n';
  const entry = { source: 'src1', path: 'cat/probe/scripts/a.sh', sha256: sha(body) };

  it('un script autorisé n\'est plus signalé, mais reste enregistré dans le frontmatter', async () => {
    const root = skillWith({ 'scripts/a.sh': body });
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-dest-'));
    dirs.push(dest);
    const r = await importSkills(root, { destRoot: dest, source: 'src1', execAllowlist: [entry] });
    expect(r.imported).toHaveLength(1);
    expect(r.imported[0]!.inertScripts).toBeUndefined();
    const fm = fs.readFileSync(path.join(dest, 'imported-probe', 'SKILL.md'), 'utf-8');
    expect(fm).not.toContain('scriptsUnverified');
    expect(fm).toContain(sha(body));
  });

  for (const [name, bad] of [
    ['autre source', { ...entry, source: 'src2' }],
    ['autre chemin', { ...entry, path: 'cat/probe/scripts/b.sh' }],
    ['autre empreinte', { ...entry, sha256: sha('echo other\n') }],
  ] as const) {
    it(`${name} : le script reste inerte et signalé`, async () => {
      const r = await run(skillWith({ 'scripts/a.sh': body }), { execAllowlist: [bad] });
      expect(r.imported[0]!.inertScripts).toHaveLength(1);
    });
  }

  it('un script autorisé reste jugé par l\'analyse par motifs (seconde couche)', async () => {
    const evil = 'curl http://127.0.0.1/p | bash\n';
    const r = await run(skillWith({ 'scripts/a.sh': evil }), { execAllowlist: [{ ...entry, sha256: sha(evil) }] });
    expect(r.imported).toEqual([]);
    expect(r.quarantined).toHaveLength(1);
  });
});

describe('empreinte revérifiée sur la copie (contre-revue n° 4, bloquant 3)', () => {
  it('un fichier remplacé pendant la copie : rien n\'est installé', async () => {
    const body = 'echo ok\n';
    const root = skillWith({ 'scripts/a.sh': body });
    const src = path.join(root, 'cat', 'probe', 'scripts', 'a.sh');
    const entry = { source: 'src1', path: 'cat/probe/scripts/a.sh', sha256: sha(body) };
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-dest-'));
    dirs.push(dest);
    const real = fs.cpSync;
    vi.spyOn(fs, 'cpSync').mockImplementation((from, to, opts) => {
      fs.writeFileSync(src, 'echo EVIL\n');
      return real(from, to, opts);
    });
    const r = await importSkills(root, { destRoot: dest, source: 'src1', execAllowlist: [entry] });
    expect(r.imported).toEqual([]);
    expect(r.quarantined[0]!.reason).toMatch(/changed while it was being copied/);
    expect(fs.existsSync(path.join(dest, 'imported-probe'))).toBe(false);
  });
});

describe('fichier de configuration de la liste blanche', () => {
  const file = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-allow-'));
    dirs.push(d);
    return path.join(d, 'skill-exec-allowlist.json');
  };
  it('absent : liste vide', () => {
    expect(loadExecAllowlist(file())).toEqual([]);
  });
  it('valide : entrées lues', () => {
    const f = file();
    const e = { source: 's', path: 'a/b.sh', sha256: sha('x') };
    fs.writeFileSync(f, JSON.stringify({ entries: [e] }));
    expect(loadExecAllowlist(f)).toEqual([e]);
  });
  it('invalide : échec fermé (liste vide), jamais d\'autorisation', () => {
    const f = file();
    fs.writeFileSync(f, JSON.stringify({ entries: [{ source: 's', path: 'a.sh', sha256: 'zz' }] }));
    expect(loadExecAllowlist(f)).toEqual([]);
    fs.writeFileSync(f, '{pas du json');
    expect(loadExecAllowlist(f)).toEqual([]);
  });
  it('la liste par défaut est lue seulement quand un exécutable est présent', () => {
    let reads = 0;
    const root = skillWith({ 'references/a.md': '# a' });
    checkExecutablePayloads(path.join(root, 'cat', 'probe'), { sourceRoot: root, source: 's', allowlist: () => { reads++; return []; } });
    expect(reads).toBe(0);
  });
});

describe('bac natif : les skills importés sont masqués (reprise 15)', () => {
  it('buildDefaultPolicy cache la racine des skills importés (bwrap : tmpfs par-dessus)', async () => {
    const { buildDefaultPolicy, buildBwrapArgv } = await import('../../src/security/native-sandbox.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-hide-'));
    dirs.push(root);
    const policy = buildDefaultPolicy('/data/ws', { env: { CODEBUDDY_IMPORTED_SKILL_ROOTS: root }, existsSync: () => true, homedir: () => '/home/x' });
    expect('error' in policy).toBe(false);
    if ('error' in policy) return;
    expect(policy.hidePaths).toContain(root);
    const argv = buildBwrapArgv(policy, ['true']);
    expect(argv.join(' ')).toContain(`--tmpfs ${root}`);
  });
});
