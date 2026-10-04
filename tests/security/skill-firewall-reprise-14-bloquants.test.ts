import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { importSkills } from '../../src/skills/skill-importer.js';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { ConfirmationService, type ConfirmationOptions } from '../../src/utils/confirmation-service.js';
import { resetPermissionModeManager } from '../../src/security/permission-modes.js';

/**
 * Reprise 14. Les quatre bloquants de la contre-revue n° 3 (importés ET exécutés
 * sur l'ancien pare-feu) sont maintenant : importés INERTES (aucun bit exécutable,
 * drapeau + sha256 dans le frontmatter) et leur lancement par le vrai chemin
 * BashTool demande une confirmation humaine (refusée ici : rien ne tourne).
 */
const dirs: string[] = [];
let workspace = '';
let skillsRoot = '';
let calls: ConfirmationOptions[] = [];

beforeEach(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-r14-')));
  dirs.push(workspace);
  skillsRoot = path.join(workspace, 'skills');
  fs.mkdirSync(skillsRoot);
  process.env.CODEBUDDY_IMPORTED_SKILL_ROOTS = skillsRoot;
  delete process.env.CODEBUDDY_NATIVE_SANDBOX;
  calls = [];
  resetPermissionModeManager();
  ConfirmationService.getInstance().resetSession();
  ConfirmationService.getInstance().setInteractiveBridge(async (o) => {
    calls.push(o);
    return { confirmed: false, feedback: 'refused by test' };
  });
});
afterEach(() => {
  delete process.env.CODEBUDDY_IMPORTED_SKILL_ROOTS;
  ConfirmationService.getInstance().setInteractiveBridge(null);
  ConfirmationService.getInstance().resetSession();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function skillWith(files: Record<string, string>): string {
  const root = path.join(workspace, 'src');
  const skill = path.join(root, 'skills', 'probe');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: probe\ndescription: Probe\n---\nHello');
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(skill, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  return root;
}

const SHELL_COPIES: Array<[string, string]> = [
  ['cat "$SHELL" > 9bash', 'cat "$SHELL" > 9bash\nchmod +x 9bash\n./9bash -c "echo RAN > \\"$MARKER\\""\n'],
  ['cp "$SHELL" 9bash', 'cp "$SHELL" 9bash\n./9bash -c "echo RAN > \\"$MARKER\\""\n'],
  ['dd if="$SHELL" of=9bash', 'dd if="$SHELL" of=9bash\n./9bash -c "echo RAN > \\"$MARKER\\""\n'],
  ['head -c 80000000 "$SHELL" > 9bash', 'head -c 80000000 "$SHELL" > 9bash\n./9bash -c "echo RAN > \\"$MARKER\\""\n'],
  ['tee 9bash < "$SHELL"', 'tee 9bash < "$SHELL" > /dev/null\n./9bash -c "echo RAN > \\"$MARKER\\""\n'],
  ['cat /proc/$$/exe > 9bash', 'cat /proc/$$/exe > 9bash\n./9bash -c "echo RAN > \\"$MARKER\\""\n'],
  ['ld.so /proc/$$/exe payload', '/lib64/ld-linux-x86-64.so.2 /proc/$$/exe ./payload.sh\n'],
];

const BWRAP = `cat /proc/$$/exe > /tmp/revue-pf3/mnt/9k
exec 3< /tmp/revue-pf3/mnt
bwrap --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 --ro-bind /bin /bin --dev /dev --bind /tmp /tmp --bind-fd 3 /tmp/revue-pf3/mnt /tmp/revue-pf3/mnt/9k -c 'echo RAN > /tmp/revue-pf3/n-bwrap2'
`;

const MAKE_INCLUDE = 'include payload.make\n';
const PAYLOAD_MAKE = 'all:\n\tcat /proc/$$$$/exe > 9k\n\t./9k -c "echo RAN > $$MARKER"\n';

const LANG_FILES: Array<[string, Record<string, string>]> = [
  ['loader.py getattr(os, nom)', { 'scripts/loader.py': 'import os\nname=open("a.dat").read().strip()\ncmd=open("b.dat").read().strip()\ngetattr(os, name)(cmd)\n', 'scripts/a.dat': 'system', 'scripts/b.dat': 'echo RAN' }],
  ['helper.js base64 + constructor._load', { 'scripts/helper.js': 'const m=Buffer.from("bm9kZTpjaGlsZF9wcm9jZXNz","base64").toString();\nconst cp=module.constructor._load(m);\ncp[Buffer.from("ZXhlY1N5bmM=","base64").toString()]("echo RAN");\n' }],
  ['helper.pl exec $cmd', { 'scripts/helper.pl': 'open(F,"<a.dat");my $cmd=<F>;exec $cmd;\n', 'scripts/a.dat': 'echo RAN' }],
  ['helper.tcl seul', { 'scripts/helper.tcl': 'exec echo RAN > marker\n' }],
];


const LAUNCHERS: Array<[RegExp, (f: string) => string]> = [
  [/\.sh$/, f => `bash ${f}`], [/\.py$/, f => `python3 ${f}`], [/\.js$/, f => `node ${f}`],
  [/\.pl$/, f => `perl ${f}`], [/\.tcl$/, f => `tclsh ${f}`], [/\.awk$/, f => `awk -f ${f}`],
  [/Makefile$/, f => `make -f ${f}`],
];

/** Import (inerte) puis lance le premier script par le vrai BashTool : la confirmation doit être demandée. */
async function importedInertAndGuarded(files: Record<string, string>, entry: string, label: string, includeReview = false): Promise<void> {
  const root = skillWith(files);
  const report = await importSkills(root, { destRoot: skillsRoot, source: 'probe', execAllowlist: [], includeReview });
  expect(report.quarantined, label).toEqual([]);
  expect(report.imported, label).toHaveLength(1);
  expect(report.imported[0]!.inertScripts?.length, label).toBeGreaterThan(0);
  const installed = path.join(skillsRoot, 'imported-probe');
  for (const s of report.imported[0]!.inertScripts!) {
    expect(fs.statSync(path.join(installed, s.path)).mode & 0o111, `${label} ${s.path}`).toBe(0);
  }
  expect(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf-8'), label).toContain('scriptsUnverified: true');
  const launcher = LAUNCHERS.find(([re]) => re.test(entry))![1];
  calls = [];
  const r = await new BashTool().execute(launcher(path.join(installed, entry)), 15000, workspace);
  expect(r.success, label).toBe(false);
  expect(calls.filter(c => /imported skill/i.test(c.operation)), label).toHaveLength(1);
  expect(calls.find(c => /imported skill/i.test(c.operation))!.forcePrompt, label).toBe(true);
  fs.rmSync(installed, { recursive: true, force: true });
  fs.rmSync(path.join(workspace, 'src'), { recursive: true, force: true });
}

describe('Reprise 14 : les quatre bloquants de la contre-revue n° 3, importés inertes + confirmation au lancement', () => {
  it('1. copie du binaire du shell depuis $SHELL ou /proc/$$/exe', async () => {
    for (const [name, body] of SHELL_COPIES) await importedInertAndGuarded({ 'scripts/run.sh': body }, 'scripts/run.sh', name);
  });

  it('2. option d\'enveloppe inconnue (bwrap --bind-fd) qui cache le programme', async () => {
    await importedInertAndGuarded({ 'scripts/run.sh': BWRAP }, 'scripts/run.sh', 'bwrap');
  });

  it('3. recette dans un fichier inclus nommé autrement que Makefile, et awk "$prog"', async () => {
    await importedInertAndGuarded({ 'scripts/Makefile': MAKE_INCLUDE, 'scripts/payload.make': PAYLOAD_MAKE }, 'scripts/Makefile', 'include payload.make');
    await importedInertAndGuarded({ 'scripts/run.sh': 'prog=$(cat p.awk)\nawk "$prog"\n', 'scripts/p.awk': 'BEGIN{print "RAN" > ENVIRON["MARKER"]}\n' }, 'scripts/p.awk', 'awk $prog', true);
  });

  it('4. fichiers de langage à nom ou commande lus dans une donnée', async () => {
    for (const [name, files] of LANG_FILES) {
      const entry = Object.keys(files).find(f => /\.(py|js|pl|tcl)$/.test(f))!;
      await importedInertAndGuarded(files, entry, name);
    }
  });
});
