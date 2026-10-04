import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { ConfirmationService, type ConfirmationOptions } from '../../src/utils/confirmation-service.js';
import { getPermissionModeManager, resetPermissionModeManager } from '../../src/security/permission-modes.js';
import { importSkills } from '../../src/skills/skill-importer.js';
import { ExecuteCodeTool } from '../../src/tools/registry/execute-code-tools.js';
import { CodeExecTool } from '../../src/tools/code-exec-tool.js';
import { InteractiveBashTool } from '../../src/tools/interactive-bash.js';

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

/**
 * Reprise 15 : contre-revue n° 5. Les bloquants 2 et 3 (lecture exemptée puis lancement, `make` nu,
 * chemin assemblé dans le shell) et le bloquant 1 (`execute_code` hors garde), par les vrais outils.
 */
describe('reprise 15 : lecture puis lancement, make nu, chemin assemblé (bash réel)', () => {
  const refuse = () => bridge(() => false);
  const expectGuarded = async (cmd: string, cwd = workspace) => {
    calls = [];
    const r = await run(cmd, cwd);
    expect(r.success, cmd).toBe(false);
    expect(guardCalls().length, cmd).toBeGreaterThanOrEqual(1);
    expect(ran(), cmd).toBe(false);
  };

  it('cat/head/tee/grep d\'un SCRIPT puis lancement de la copie', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    refuse();
    const f = path.join(skill, 'scripts', 'run.sh');
    const copy = path.join(workspace, 'in-copy.sh');
    await expectGuarded(`cat ${f} > ${copy} && bash ${copy}`);
    await expectGuarded(`head -n 20 ${f} > ${copy} && bash ${copy}`);
    await expectGuarded(`cat ${f} | tee ${copy} >/dev/null; bash ${copy}`);
    await expectGuarded(`grep -h . ${f} > ${copy} && bash ${copy}`);
    await expectGuarded(`ls ${f} | xargs -r bash`);
    // La copie seule, lancée dans une commande ultérieure qui ne nomme plus le skill : c'est la lecture qui demande.
    await expectGuarded(`cat ${f} > ${copy}`);
    await expectGuarded(`cp ${f} ${copy}`);
    const doc = await run(`cat ${path.join(skill, 'SKILL.md')}`);
    expect(doc.success, doc.error).toBe(true);
  });

  it('`make` nu et lancements depuis le dossier du skill', async () => {
    await installProbe({ 'scripts/Makefile': `all:\n\techo RAN > ${JSON.stringify(marker)}\n` });
    refuse();
    await expectGuarded('make', path.join(skill, 'scripts'));
    await expectGuarded(`cd ${path.join(skill, 'scripts')} && make`);
  });

  it('chemin assemblé dans le shell : variable, substitution, concaténation node, glob, xargs', async () => {
    await installProbe({ 'scripts/run.sh': writer(), 'scripts/run.js': `require('fs').writeFileSync(${JSON.stringify(marker)}, 'RAN')\n` });
    refuse();
    const d = skill;
    await expectGuarded(`D=$(printf '%s' '${d}'); bash "$D/scripts/run.sh"`);
    await expectGuarded(`D=${d}; bash "$D/scripts/run.sh"`);
    await expectGuarded(`node -e 'require("/"+"${path.join(skill, 'scripts', 'run.js').slice(1)}")'`);
    await expectGuarded(`bash ${skillsRoot}/imported-*/scripts/run.sh`);
    await expectGuarded(`echo ${path.join(skill, 'scripts', 'run.sh')} | xargs bash`);
  });

  it('pas de faux positif : commandes ordinaires, ou aucun skill à scripts installé', async () => {
    refuse();
    const a = await run('D=/tmp; ls "$D"; echo $HOME');
    expect(a.success, a.error).toBe(true);
    const b = await run('X=1; bash -c "echo $X"');
    expect(b.success, b.error).toBe(true); // aucun skill importé installé : rien à protéger
    expect(guardCalls()).toHaveLength(0);
    await installProbe({ 'references/n.md': '# only documents' });
    const c = await run('X=1; bash -c "echo $X"');
    expect(c.success, c.error).toBe(true); // un skill sans script ne déclenche pas la règle dynamique
    expect(guardCalls()).toHaveLength(0);
  });

  it('tous les scripts autorisés : la règle « nom calculé » ne demande plus', async () => {
    const entry = { source: 'src1', path: 'cat/probe/scripts/run.sh', sha256: sha(writer()) };
    await installProbe({ 'scripts/run.sh': writer() }, [entry]);
    const home = mk('pf15-home-');
    const prev = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = home;
    fs.writeFileSync(path.join(home, 'skill-exec-allowlist.json'), JSON.stringify({ entries: [entry] }));
    try {
      refuse();
      const r = await run('X=1; bash -c "echo $X"');
      expect(r.success, r.error).toBe(true);
      expect(guardCalls()).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.CODEBUDDY_HOME; else process.env.CODEBUDDY_HOME = prev;
    }
  });
});

describe('reprise 15 : outils qui exécutent du code (execute_code, code_exec, shell interactif)', () => {
  const py = () => `exec(open(${JSON.stringify(path.join(skill, 'scripts', 'run.py'))}).read())`;
  const PY_BODY = () => `open(${JSON.stringify(marker)}, 'w').write('RAN')\n`;

  it('execute_code : refusé sans humain, même avec AUTO_CONFIRM + bypass + drapeaux de session', async () => {
    await installProbe({ 'scripts/run.py': PY_BODY() });
    process.env.CODEBUDDY_AUTO_CONFIRM = 'true';
    getPermissionModeManager().setMode('bypassPermissions');
    ConfirmationService.getInstance().setSessionFlag('allOperations', true);
    const r = await new ExecuteCodeTool().execute({ code: py(), language: 'python' }, { cwd: workspace } as never);
    expect(r.success).toBe(false);
    expect(ran()).toBe(false);
  });

  it('execute_code : chemin construit (concaténation, base64) refusé aussi', async () => {
    await installProbe({ 'scripts/run.py': PY_BODY() });
    bridge(() => false);
    const p = path.join(skill, 'scripts', 'run.py');
    const code = `import os\nexec(open("/"+${JSON.stringify(p.slice(1))}).read())`;
    const r = await new ExecuteCodeTool().execute({ code, language: 'python' }, { cwd: workspace } as never);
    expect(r.success).toBe(false);
    expect(guardCalls()).toHaveLength(1);
    expect(ran()).toBe(false);
  });

  it('execute_code : humain qui approuve (forcePrompt) puis le programme tourne ; sans lien avec un skill, aucune garde', async () => {
    await installProbe({ 'scripts/run.py': PY_BODY() });
    bridge(() => true);
    const r = await new ExecuteCodeTool().execute({ code: py(), language: 'python' }, { cwd: workspace } as never);
    expect(r.success, r.error).toBe(true);
    expect(guardCalls()).toHaveLength(1);
    expect(guardCalls()[0]!.forcePrompt).toBe(true);
    expect(ran()).toBe(true);
    calls = [];
    const plain = await new ExecuteCodeTool().execute({ code: 'print(1+1)', language: 'python' }, { cwd: workspace } as never);
    expect(plain.success, plain.error).toBe(true);
    expect(guardCalls()).toHaveLength(0);
  });

  it('code_exec (JS) : son bac n\'ouvre pas de fichier, mais la garde est câblée (un nom de script de skill y demande)', async () => {
    await installProbe({ 'scripts/run.js': `require('fs').writeFileSync(${JSON.stringify(marker)}, 'RAN')\n` });
    bridge(() => false);
    const code = `const target = ${JSON.stringify(path.join(skill, 'scripts', 'run.js'))}; target.length`;
    const r = await new CodeExecTool().execute({ code }, { cwd: workspace } as never);
    expect(r.success).toBe(false);
    expect(guardCalls()).toHaveLength(1);
    expect(ran()).toBe(false);
  });

  it('shell interactif : refusé', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    bridge(() => false);
    const out = await new InteractiveBashTool().executeInteractive(`bash ${path.join(skill, 'scripts', 'run.sh')}`, { cwd: workspace });
    expect(out.output).toMatch(/^Error:/);
    expect(guardCalls()).toHaveLength(1);
    expect(ran()).toBe(false);
  });
});
