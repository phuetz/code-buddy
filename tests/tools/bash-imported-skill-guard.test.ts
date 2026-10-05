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

  it('find -exec/-execdir/-ok, xargs, parallel, make sur un dossier qui contient ou recouvre le skill', async () => {
    await installProbe({ 'scripts/run.sh': writer(), 'scripts/Makefile': `all:\n\techo RAN > ${JSON.stringify(marker)}\n` });
    refuse();
    await expectGuarded('find . -name run.sh -exec bash {} +');
    await expectGuarded('find . -name run.sh -execdir bash {} \\;');
    await expectGuarded('find . -name run.sh -ok bash {} \\;');
    await expectGuarded(`find ${workspace} -name run.sh -exec bash {} +`);
    await expectGuarded('find . -name run.sh | xargs bash');
    await expectGuarded('echo run.sh | xargs -I{} bash {}');
    await expectGuarded('echo run.sh | parallel bash {}');
    await expectGuarded(`make -C ${workspace}`);
    await expectGuarded('make', workspace);
    // depuis un sous-dossier du skill ou du projet englobant : même résultat
    await expectGuarded('find .. -name run.sh -exec bash {} +', path.join(skill, 'scripts'));
  });

  it('chemin en flux (executeStreaming, celui de Cowork) : find . -exec confirmé aussi', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    bridge(() => false);
    const gen = new BashTool().executeStreaming('find . -name run.sh -exec bash {} +', 15000, workspace);
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    expect(step.value.success).toBe(false);
    expect(guardCalls()).toHaveLength(1);
    expect(ran()).toBe(false);
  });

  it('assignation littérale du dossier du skill : toujours confirmée', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    refuse();
    await expectGuarded(`D=${skill}; bash "$D/scripts/run.sh"`);
  });

  it('pas de faux positif : variables, find sans -exec, xargs/make hors du skill, skill sans script', async () => {
    refuse();
    expect((await run('D=/tmp; ls "$D"; echo $HOME')).success).toBe(true);
    await installProbe({ 'scripts/run.sh': writer() });
    // Heuristiques retirées (reprise 16) : variable, substitution, glob, concaténation ne demandent plus.
    for (const cmd of ['X=1; bash -c "echo $X"', 'D=/tmp; python3 -c "print(1)"', `find . -name '*.sh' -print`, 'echo hello', 'python3 -c "print(1+1)"']) {
      const r = await run(cmd);
      expect(r.success, `${cmd}: ${r.error}`).toBe(true);
    }
    // xargs / find -exec / make dans un dossier qui ne touche pas le skill
    const elsewhere = mk('pf15-else-');
    for (const cmd of ['echo a | xargs echo', 'find . -name x -exec echo {} +']) {
      const r = await run(cmd, elsewhere);
      expect(r.success, `${cmd}: ${r.error}`).toBe(true);
    }
    expect(guardCalls()).toHaveLength(0);
  });

  it('skill sans script : aucune règle ne se déclenche', async () => {
    await installProbe({ 'references/n.md': '# only documents' });
    refuse();
    const r = await run('find . -name x -exec echo {} +');
    expect(r.success, r.error).toBe(true);
    expect(guardCalls()).toHaveLength(0);
  });

  it('tous les scripts autorisés : find -exec sur le dossier ne demande plus', async () => {
    const entry = { source: 'src1', path: 'cat/probe/scripts/run.sh', sha256: sha(writer()) };
    await installProbe({ 'scripts/run.sh': writer() }, [entry]);
    const home = mk('pf15-home-');
    const prev = process.env.CODEBUDDY_HOME;
    process.env.CODEBUDDY_HOME = home;
    fs.writeFileSync(path.join(home, 'skill-exec-allowlist.json'), JSON.stringify({ entries: [entry] }));
    try {
      refuse();
      const r = await run('find . -name run.sh -exec echo {} +');
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

/**
 * Reprise 17 : contre-revue n° 7. La segmentation par regex est remplacée par le vrai analyseur
 * (tree-sitter-bash) ; enveloppes, glob/accolades du fichier d'origine, `execute_code` (shell et programme).
 */
describe('reprise 17 : vrai analyseur shell, enveloppes, glob, execute_code', () => {
  const refuse = () => bridge(() => false);
  const expectGuarded = async (cmd: string, cwd = workspace) => {
    calls = [];
    const r = await run(cmd, cwd);
    expect(r.success, cmd).toBe(false);
    expect(guardCalls().length, cmd).toBeGreaterThanOrEqual(1);
    expect(ran(), cmd).toBe(false);
  };

  it('parenthèses, sous-shell, substitution et continuation de ligne ne séparent plus find de -exec', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    refuse();
    await expectGuarded('find . \\( -name run.sh -exec bash {} + \\)');
    await expectGuarded('find . \\( -name run.sh \\) -exec bash {} +');
    await expectGuarded('find . -name run.sh \\\n  -exec bash {} +');
    await expectGuarded('( find . -name run.sh -exec bash {} + )');
    // `$( )` is refused earlier by the generic command filter in BashTool: check the guard's own parse.
    const { findImportedScriptHits } = await import('../../src/tools/bash/imported-skill-guard.js');
    expect(findImportedScriptHits('echo $(find . -name run.sh -exec bash {} +)', workspace, []).length).toBeGreaterThan(0);
    expect(findImportedScriptHits('echo `find . -name run.sh -exec bash {} +`', workspace, []).length).toBeGreaterThan(0);
    await expectGuarded('true && { find . -name run.sh -exec bash {} + ; }');
  });

  it('enveloppes devant find / xargs / make : env, command, exec, time, timeout, nice, stdbuf, busybox', async () => {
    await installProbe({ 'scripts/run.sh': writer(), 'scripts/Makefile': `all:\n\techo RAN > ${JSON.stringify(marker)}\n` });
    refuse();
    for (const w of ['env', 'command', 'exec', 'time', 'timeout 15', 'nice', 'nice -n 5', 'stdbuf -oL', 'busybox', 'env FOO=1']) {
      await expectGuarded(`${w} find . -name run.sh -exec bash {} +`);
    }
    await expectGuarded('find . -name run.sh | env xargs bash');
    await expectGuarded('env make', workspace);
  });

  it('glob et accolades du fichier d\'origine', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    refuse();
    await expectGuarded(`bash ${skillsRoot}/imported-*/scripts/run.sh`);
    await expectGuarded(`bash ${skillsRoot}/imported-probe/scripts/r?n.sh`);
    await expectGuarded(`bash ${skill}/scripts/{run,other}.sh`);
    await expectGuarded('bash skills/imported-*/scripts/run.sh');
    // un glob qui ne désigne rien du skill ne demande pas
    calls = [];
    const r = await run(`ls ${workspace}/*.nothing; echo ok`);
    expect(r.success, r.error).toBe(true);
    expect(guardCalls()).toHaveLength(0);
  });

  it('texte que l\'analyseur ne sait pas lire : fermé (confirmation) tant qu\'un skill a un script non autorisé', async () => {
    refuse();
    // aucun skill importé : rien à protéger, la commande part (et échoue d'elle-même)
    calls = [];
    await run('echo ok )');
    expect(guardCalls()).toHaveLength(0);
    await installProbe({ 'scripts/run.sh': writer() });
    await expectGuarded('echo ok )');
  });

  it('execute_code : shell `env find <projet> -exec`, et programme qui épelle find/-exec en arguments', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    bridge(() => false);
    const tool = new ExecuteCodeTool();
    const sh = await tool.execute({ code: `env find ${workspace} -name run.sh -exec bash {} +`, language: 'shell' }, { cwd: workspace } as never);
    expect(sh.success).toBe(false);
    expect(guardCalls()).toHaveLength(1);
    expect(ran()).toBe(false);
    calls = [];
    const py = await tool.execute({
      code: `import subprocess\nsubprocess.check_call(["find", ${JSON.stringify(workspace)}, "-name", "run.sh", "-exec", "bash", "{}", "+"])`,
      language: 'python',
    }, { cwd: workspace } as never);
    expect(py.success).toBe(false);
    expect(guardCalls()).toHaveLength(1);
    expect(ran()).toBe(false);
    // un programme sans rapport ne demande pas
    calls = [];
    const plain = await tool.execute({ code: 'print(2+2)', language: 'python' }, { cwd: workspace } as never);
    expect(plain.success, plain.error).toBe(true);
    expect(guardCalls()).toHaveLength(0);
  });
});

/**
 * Reprise 18 : contre-revue n° 8, régressions de la reprise 17 par rapport à 58e0dfc6.
 * Chaque cas que le parent arrêtait (bash -c d'un chemin, liste `for`, classe POSIX) a son test ;
 * `find -exec` sous -c/eval/enveloppes à option à argument aussi.
 */
describe('reprise 18 : récursion -c/eval, listes for, classes POSIX, enveloppes à arguments', () => {
  const refuse = () => bridge(() => false);
  const expectGuarded = async (cmd: string, cwd = workspace) => {
    calls = [];
    const r = await run(cmd, cwd);
    expect(r.success, cmd).toBe(false);
    expect(guardCalls().length, cmd).toBeGreaterThanOrEqual(1);
    expect(ran(), cmd).toBe(false);
  };

  it('régression 1 : le corps de bash -c / sh -c / eval est réanalysé (chemin littéral)', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    refuse();
    const f = path.join(skill, 'scripts', 'run.sh');
    await expectGuarded(`bash -c "bash ${f}"`);
    await expectGuarded(`sh -c 'bash ${f}'`);
    await expectGuarded(`bash -lc "bash ${f}"`);
    await expectGuarded(`eval 'bash ${f}'`);
    await expectGuarded(`env -S 'bash ${f}'`);
    await expectGuarded(`env -u FOO bash -c "bash ${f}"`);
    await expectGuarded(`flock -n . sh -c 'bash ${f}'`);
    await expectGuarded(`nice -n +5 bash -c "bash ${f}"`);
    await expectGuarded(`stdbuf -o L bash -c "bash ${f}"`);
    await expectGuarded(`bash -c "bash -c 'bash ${f}'"`);
    // `python -c "…subprocess…"` is refused earlier by BashTool's generic filter: check the guard's own recursion.
    const { findImportedScriptHits } = await import('../../src/tools/bash/imported-skill-guard.js');
    expect(findImportedScriptHits(`python3 -c "import subprocess; subprocess.call(['bash', '${f}'])"`, workspace, []).length).toBeGreaterThan(0);
  });

  it('régression 1 : liste for dont un littéral est un fichier du skill', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    refuse();
    const f = path.join(skill, 'scripts', 'run.sh');
    await expectGuarded(`for f in "${f}"; do bash "$f"; done`);
    await expectGuarded(`for f in ${f} /tmp/x; do bash "$f"; done`);
    await expectGuarded(`for f in ${skillsRoot}/imported-*/scripts/*.sh; do bash "$f"; done`);
  });

  it('régression 2 : classes POSIX et négations dans un glob du fichier d\'origine', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    refuse();
    await expectGuarded(`bash ${skill}/scripts/r[[:alpha:]]n.sh`);
    await expectGuarded(`bash ${skill}/scripts/r[[:lower:]]n.sh`);
    await expectGuarded(`bash ${skill}/scripts/r[!0-9]n.sh`);
    await expectGuarded(`bash ${skill}/scripts/[[:alnum:]][[:alpha:]]?.sh`);
    await expectGuarded(`bash ${skill}/**/run.sh`);
  });

  it('find -exec depuis le projet sous -c, sh -c, eval, env -u, nice -n +5, stdbuf -o L, flock -n .', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    refuse();
    const F = 'find . -name run.sh -exec bash {} +';
    await expectGuarded(`bash -c '${F}'`);
    await expectGuarded(`sh -c '${F}'`);
    await expectGuarded(`eval '${F}'`);
    await expectGuarded(`env -u FOO ${F}`);
    await expectGuarded(`env -i -u FOO ${F}`);
    await expectGuarded(`nice -n +5 ${F}`);
    await expectGuarded(`nice -n 5 ${F}`);
    await expectGuarded(`stdbuf -o L ${F}`);
    await expectGuarded(`stdbuf -oL ${F}`);
    await expectGuarded(`flock -n . ${F}`);
    await expectGuarded(`timeout -s KILL 5 ${F}`);
    await expectGuarded(`ionice -c 3 ${F}`);
    await expectGuarded(`sudo -u nobody ${F}`);
  });

  it('enveloppe inconnue : find -exec / make / xargs sont vus où qu\'ils soient dans la commande', async () => {
    await installProbe({ 'scripts/run.sh': writer(), 'scripts/Makefile': `all:\n\techo RAN > ${JSON.stringify(marker)}\n` });
    refuse();
    await expectGuarded('systemd-run --user find . -name run.sh -exec bash {} +');
    await expectGuarded('weirdwrap --opt value make', workspace);
    await expectGuarded('nosuchtool a b | weirdwrap xargs bash');
  });

  it('mot de commande que l\'analyseur ne résout pas : fermé tant qu\'un skill a un script non autorisé', async () => {
    refuse();
    // sans skill : rien à protéger
    calls = [];
    await run('cmd=echo; $cmd ok');
    expect(guardCalls()).toHaveLength(0);
    await installProbe({ 'scripts/run.sh': writer() });
    await expectGuarded('cmd=echo; $cmd ok');
    await expectGuarded('e?ho ok');
  });

  it('pas de faux positif ajouté : -c sans skill visé, for sans skill, wrappers ordinaires', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    refuse();
    for (const cmd of ['bash -c "echo hello"', 'sh -c "ls /tmp"', 'eval "echo ok"', 'for f in a b c; do echo $f; done',
      'env -u FOO echo hi', 'nice -n 5 echo hi', 'stdbuf -o L echo hi', 'timeout 5 echo hi', 'flock -n /tmp/x.lock echo hi']) {
      const r = await run(cmd, mk('pf18-else-'));
      expect(r.success, `${cmd}: ${r.error}`).toBe(true);
    }
    expect(guardCalls()).toHaveLength(0);
  });
});

/**
 * Reprise 19 : contre-revue n° 9. Un interpréteur qui lit son programme sur l'entrée standard
 * (here-document, here-string, entrée redirigée, tube) est traité comme `-c`.
 */
describe('reprise 19 : here-documents, here-strings, entrée redirigée, tubes', () => {
  const refuse = () => bridge(() => false);
  const expectGuarded = async (cmd: string, cwd = workspace) => {
    calls = [];
    const r = await run(cmd, cwd);
    expect(r.success, cmd).toBe(false);
    expect(guardCalls().length, cmd).toBeGreaterThanOrEqual(1);
    expect(ran(), cmd).toBe(false);
  };

  it('bash/sh <<EOF, <<\'EOF\', -s, < fichier, while read, xargs : le texte lu est réanalysé comme un -c', async () => {
    await installProbe({ 'scripts/run.sh': writer(), 'scripts/notes.txt': writer() });
    refuse();
    const f = path.join(skill, 'scripts', 'run.sh');
    await expectGuarded(`bash <<EOF\nbash ${f}\nEOF`);
    await expectGuarded(`bash <<'EOF'\nbash ${f}\nEOF`);
    await expectGuarded(`sh <<EOF\nbash ${f}\nEOF`);
    await expectGuarded(`bash -s <<'EOF'\nbash ${f}\nEOF`);
    await expectGuarded(`bash < ${path.join(skill, 'scripts', 'notes.txt')}`);
    await expectGuarded(`printf '%s\\n' ${f} | xargs bash`);
    await expectGuarded(`echo ${f} | xargs -n1 bash`);
    await expectGuarded(`while read x; do bash "$x"; done <<EOF\n${f}\nEOF`);
  });

  it('here-string et tube vers un shell : BashTool les refuse déjà (filtre générique) ; la garde les voit aussi, par execute_code en shell', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    bridge(() => false);
    const f = path.join(skill, 'scripts', 'run.sh');
    for (const cmd of [`bash <<< "bash ${f}"`, `echo "bash ${f}" | bash`, `printf '%s\\n' "bash ${f}" | sh`]) {
      const r = await run(cmd);
      expect(r.success, cmd).toBe(false);
      expect(ran(), cmd).toBe(false);
      calls = [];
      const viaTool = await new ExecuteCodeTool().execute({ code: cmd, language: 'shell' }, { cwd: workspace } as never);
      expect(viaTool.success, cmd).toBe(false);
      expect(guardCalls().length, cmd).toBe(1);
      expect(ran(), cmd).toBe(false);
    }
  });

  it('langages lisant leur programme sur l\'entrée standard (python, node)', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    const { findImportedScriptHits } = await import('../../src/tools/bash/imported-skill-guard.js');
    const f = path.join(skill, 'scripts', 'run.sh');
    // BashTool's generic filter refuses `subprocess`/`child_process` earlier: check the guard's own analysis.
    for (const cmd of [
      `python3 <<'PY'\nimport subprocess\nsubprocess.check_call(["bash", "${f}"])\nPY`,
      `node <<'JS'\nrequire("x").execFileSync("bash", ["${f}"])\nJS`,
      `python3 - <<< 'import os; os.system("bash ${f}")'`,
      `echo 'os.system("bash ${f}")' | python3`,
    ]) {
      expect(findImportedScriptHits(cmd, workspace, []).length, cmd).toBeGreaterThan(0);
    }
  });

  it('pas de faux positif : documents en here-doc, cat <<EOF, tubes ordinaires', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    refuse();
    for (const cmd of ['cat <<EOF\nhello\nEOF', 'bash <<EOF\necho hi\nEOF', 'echo hi | cat', 'printf "%s" a | wc -c',
      `cat <<EOF\nbash ${path.join(skill, 'scripts', 'run.sh')}\nEOF`]) {
      const r = await run(cmd, mk('pf19-else-'));
      expect(r.success, `${cmd}: ${r.error}`).toBe(true);
    }
    expect(guardCalls()).toHaveLength(0);
  });
});

/**
 * Reprise 20 : contre-revue n° 10. tree-sitter place `| env bash` DANS le here-document de `cat` :
 * le texte lu doit être rattaché à la commande réelle (après enveloppes), et execute_code en shell passe
 * par la même analyse que BashTool.
 */
describe('reprise 20 : cat <<EOF | consommateur, et une seule analyse pour BashTool et execute_code', () => {
  const refuse = () => bridge(() => false);
  const f = () => path.join(skill, 'scripts', 'run.sh');
  const BODY = () => `bash ${f()}`;

  it('BashTool : cat <<EOF | env bash / python3 / node / nice / timeout / stdbuf / flock', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    refuse();
    for (const consumer of ['env bash', 'env -u FOO bash', 'nice -n 5 sh', 'timeout 5 bash', 'stdbuf -oL bash', 'flock -n /tmp/pf20.lock bash', 'python3', 'node', 'env python3 -', 'tee /dev/null | env bash']) {
      calls = [];
      const r = await run(`cat <<'EOF' | ${consumer}\n${BODY()}\nEOF`);
      expect(r.success, consumer).toBe(false);
      expect(guardCalls().length, consumer).toBeGreaterThanOrEqual(1);
      expect(ran(), consumer).toBe(false);
    }
    // plusieurs étages après le délimiteur
    await (async () => {
      calls = [];
      const r = await run(`cat <<EOF | tr a b | env sh && echo done\n${BODY()}\nEOF`);
      expect(r.success).toBe(false);
      expect(guardCalls().length).toBeGreaterThanOrEqual(1);
      expect(ran()).toBe(false);
    })();
  });

  it('execute_code (shell) : mêmes compositions, y compris | bash que le filtre de BashTool bloque seul', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    refuse();
    const tool = new ExecuteCodeTool();
    for (const consumer of ['bash', 'env bash', 'python3', 'node', 'sh']) {
      calls = [];
      const r = await tool.execute({ code: `cat <<'EOF' | ${consumer}\n${BODY()}\nEOF`, language: 'shell' }, { cwd: workspace } as never);
      expect(r.success, consumer).toBe(false);
      expect(guardCalls(), consumer).toHaveLength(1);
      expect(ran(), consumer).toBe(false);
    }
  });

  it('une seule analyse : BashTool et execute_code (shell) demandent sur les mêmes commandes, et se taisent sur les mêmes', async () => {
    await installProbe({ 'scripts/run.sh': writer() });
    refuse();
    const tool = new ExecuteCodeTool();
    const must = [`bash ${f()}`, `bash -c "bash ${f()}"`, `bash <<EOF\n${BODY()}\nEOF`, `cat <<'EOF' | env python3\n${BODY()}\nEOF`, `env -u X nice -n 5 bash ${f()}`,
      `find ${workspace} -name run.sh -exec bash {} +`, `for p in ${f()}; do bash "$p"; done`];
    const mustNot = ['echo hello', 'ls', 'cat <<EOF\nhello\nEOF', 'bash <<EOF\necho hi\nEOF', 'echo hi | cat'];
    for (const cmd of must) {
      calls = [];
      await run(cmd);
      const viaBash = guardCalls().length;
      calls = [];
      await tool.execute({ code: cmd, language: 'shell' }, { cwd: workspace } as never);
      const viaExec = guardCalls().length;
      expect(viaBash, `bash: ${cmd}`).toBeGreaterThanOrEqual(1);
      expect(viaExec, `execute_code: ${cmd}`).toBeGreaterThanOrEqual(1);
    }
    for (const cmd of mustNot) {
      calls = [];
      await run(cmd, mk('pf20-else-'));
      const viaBash = guardCalls().length;
      await tool.execute({ code: cmd, language: 'shell' }, { cwd: workspace } as never);
      expect(viaBash + guardCalls().length, cmd).toBe(0);
    }
  });
});
