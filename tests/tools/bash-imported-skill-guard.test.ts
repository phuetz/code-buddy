import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { ConfirmationService, type ConfirmationOptions } from '../../src/utils/confirmation-service.js';
import { getPermissionModeManager, resetPermissionModeManager } from '../../src/security/permission-modes.js';
import { importSkills } from '../../src/skills/skill-importer.js';

/**
 * Chemin bash RÉEL (BashTool.execute -> garde -> ConfirmationService -> spawn),
 * pas la fonction pure : « un test unitaire ne prouve pas le câblage ».
 */
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const tmp: string[] = [];
let skillsRoot = '';
let workspace = '';
let skill = '';
let marker = '';
let calls: ConfirmationOptions[] = [];

function mk(prefix: string): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmp.push(d);
  return d;
}

async function installProbe(files: Record<string, string>, allowlist: Array<{ source: string; path: string; sha256: string }> = []): Promise<void> {
  const src = mk('pf14-src-');
  const dir = path.join(src, 'cat', 'probe');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: probe\ndescription: Probe\n---\nHello');
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  const report = await importSkills(src, { destRoot: skillsRoot, source: 'src1', execAllowlist: allowlist });
  expect(report.imported.map(i => i.name)).toEqual(['imported-probe']);
  skill = path.join(skillsRoot, 'imported-probe');
}

function bridge(decide: (o: ConfirmationOptions) => boolean | Promise<boolean>): void {
  ConfirmationService.getInstance().setInteractiveBridge(async (o) => {
    calls.push(o);
    return (await decide(o)) ? { confirmed: true } : { confirmed: false, feedback: 'refused by test' };
  });
}
const guardCalls = () => calls.filter(c => /imported skill/i.test(c.operation));
const ran = () => fs.existsSync(marker);

beforeEach(() => {
  workspace = mk('pf14-ws-');
  // Inside the workspace: the native sandbox only sees the cwd.
  skillsRoot = path.join(workspace, 'skills');
  fs.mkdirSync(skillsRoot);
  marker = path.join(workspace, 'RAN');
  process.env.CODEBUDDY_IMPORTED_SKILL_ROOTS = skillsRoot;
  delete process.env.CODEBUDDY_NATIVE_SANDBOX;
  calls = [];
  resetPermissionModeManager();
  ConfirmationService.getInstance().resetSession();
  ConfirmationService.getInstance().setInteractiveBridge(null);
});
afterEach(() => {
  delete process.env.CODEBUDDY_IMPORTED_SKILL_ROOTS;
  delete process.env.CODEBUDDY_AUTO_CONFIRM;
  ConfirmationService.getInstance().setInteractiveBridge(null);
  ConfirmationService.getInstance().resetSession();
  resetPermissionModeManager();
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const run = (cmd: string, cwd = workspace) => new BashTool().execute(cmd, 15000, cwd);
const writer = () => `echo RAN > ${JSON.stringify(marker)}\n`;

describe('scripts de skills importés : inertes, lancement soumis à confirmation (chemin bash réel)', () => {
  it('le script est importé inerte : sans bit exécutable, drapeau et sha256 dans le frontmatter', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    const f = path.join(skill, 'scripts', 'run.sh');
    expect(fs.statSync(f).mode & 0o111).toBe(0);
    const fm = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf-8');
    expect(fm).toContain('scriptsUnverified: true');
    expect(fm).toContain(sha(writer()));
  });

  it('sans humain (headless) : refus, le script ne tourne pas', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    const r = await run(`bash ${path.join(skill, 'scripts', 'run.sh')}`);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/interactive terminal|approval/i);
    expect(ran()).toBe(false);
  });

  it('jamais d\'auto-approbation : AUTO_CONFIRM, bypassPermissions, drapeaux de session', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    process.env.CODEBUDDY_AUTO_CONFIRM = 'true';
    getPermissionModeManager().setMode('bypassPermissions');
    ConfirmationService.getInstance().setSessionFlag('allOperations', true);
    ConfirmationService.getInstance().setSessionFlag('bashCommands', true);
    const r = await run(`bash ${path.join(skill, 'scripts', 'run.sh')}`);
    expect(r.success).toBe(false);
    expect(ran()).toBe(false);
    getPermissionModeManager().setMode('dontAsk');
    expect((await run(`bash ${path.join(skill, 'scripts', 'run.sh')}`)).success).toBe(false);
    expect(ran()).toBe(false);
  });

  it('humain qui approuve : la confirmation est forcée, puis le script tourne', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    bridge(() => true);
    const r = await run(`bash ${path.join(skill, 'scripts', 'run.sh')}`);
    expect(r.success, r.error).toBe(true);
    expect(guardCalls()).toHaveLength(1);
    expect(guardCalls()[0]!.forcePrompt).toBe(true);
    expect(guardCalls()[0]!.content).toContain(sha(writer()));
    expect(ran()).toBe(true);
  });

  it('humain qui refuse : le script ne tourne pas', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    bridge(() => false);
    const r = await run(`bash ${path.join(skill, 'scripts', 'run.sh')}`);
    expect(r.success).toBe(false);
    expect(ran()).toBe(false);
  });

  it('un fichier que la détection ne reconnaît pas (.txt, .md, .json) lancé par un interpréteur demande aussi', async () => {
    await installProbe({ 'references/steps.md': writer(), 'references/notes.txt': writer(), 'references/job.json': writer() });
    bridge(() => false);
    for (const f of ['references/steps.md', 'references/notes.txt', 'references/job.json']) {
      calls = [];
      const r = await run(`bash ${path.join(skill, f)}`);
      expect(r.success, f).toBe(false);
      expect(guardCalls().length, f).toBe(1);
      expect(ran(), f).toBe(false);
    }
    calls = [];
    await run(`make -f ${path.join(skill, 'references', 'notes.txt')}`);
    await run(`awk -f ${path.join(skill, 'references', 'notes.txt')}`);
    expect(guardCalls()).toHaveLength(2);
  });

  it('`bash -c` / `python3 -c` lancés avec un cwd sous le dossier du skill', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    bridge(() => false);
    const r = await run(`bash -c 'echo RAN > ${marker}'`, skill);
    expect(r.success).toBe(false);
    expect(guardCalls()).toHaveLength(1);
    expect(ran()).toBe(false);
    calls = [];
    await run(`python3 -c "open('${marker}','w')"`, skill);
    expect(guardCalls()).toHaveLength(1);
    expect(ran()).toBe(false);
  });

  it('script sur la liste blanche (empreinte du fichier courant) : pas de confirmation', async () => {
    const entry = { source: 'src1', path: 'cat/probe/scripts/run.sh', sha256: sha(writer()) };
    await installProbe({ 'scripts/run.sh': writer() }, [entry]);
    const file = path.join(os.tmpdir(), `pf14-allow-${process.pid}.json`);
    tmp.push(file);
    fs.writeFileSync(file, JSON.stringify({ entries: [entry] }));
    const { findImportedScriptHits } = await import('../../src/tools/bash/imported-skill-guard.js');
    const hits = findImportedScriptHits(`bash ${path.join(skill, 'scripts', 'run.sh')}`, workspace, [entry]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.allowed).toBe(true);
    // chemin réel : la liste est lue dans ~/.codebuddy ; on la pointe vers un HOME isolé.
    const home = mk('pf14-home-');
    const prev = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = home;
    fs.writeFileSync(path.join(home, 'skill-exec-allowlist.json'), JSON.stringify({ entries: [entry] }));
    try {
      bridge(() => false);
      const r = await run(`bash ${path.join(skill, 'scripts', 'run.sh')}`);
      expect(r.success, r.error).toBe(true);
      expect(guardCalls()).toHaveLength(0);
      expect(ran()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CODEBUDDY_HOME; else process.env.CODEBUDDY_HOME = prev;
    }
  });

  it('liste blanche + fichier modifié ensuite : l\'empreinte courante ne correspond plus, confirmation exigée', async () => {
    const entry = { source: 'src1', path: 'cat/probe/scripts/run.sh', sha256: sha(writer()) };
    await installProbe({ 'scripts/run.sh': writer() }, [entry]);
    fs.appendFileSync(path.join(skill, 'scripts', 'run.sh'), 'echo changed\n');
    const home = mk('pf14-home-');
    const prev = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = home;
    fs.writeFileSync(path.join(home, 'skill-exec-allowlist.json'), JSON.stringify({ entries: [entry] }));
    try {
      bridge(() => false);
      const r = await run(`bash ${path.join(skill, 'scripts', 'run.sh')}`);
      expect(r.success).toBe(false);
      expect(guardCalls()).toHaveLength(1);
      expect(ran()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.CODEBUDDY_HOME; else process.env.CODEBUDDY_HOME = prev;
    }
  });

  it('TOCTOU : le fichier change pendant la confirmation, la commande est refusée', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    const f = path.join(skill, 'scripts', 'run.sh');
    bridge(() => {
      fs.writeFileSync(f, `echo EVIL > ${JSON.stringify(marker)}\n`);
      return true;
    });
    const r = await run(`bash ${f}`);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/changed after it was approved/i);
    expect(ran()).toBe(false);
  });

  it('les autres usages de bash ne sont pas touchés', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    bridge(() => false);
    const a = await run('echo hello');
    expect(a.success, a.error).toBe(true);
    const b = await run(`ls ${path.join(skill, 'scripts')}`);
    expect(b.success, b.error).toBe(true);
    const c = await run(`cat ${path.join(skill, 'SKILL.md')}`);
    expect(c.success, c.error).toBe(true);
    expect(guardCalls()).toHaveLength(0);
  });
});
