import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { importSkills } from '../../src/skills/skill-importer.js';

/**
 * Reprise 13, refus par défaut. Les quatre bloquants de la contre-revue n° 3
 * (importés ET exécutés sur l'ancien pare-feu) deviennent une quarantaine par
 * construction : le skill embarque un fichier exécutable ou interprétable, et
 * aucune liste blanche ne le couvre. Ce fichier n'importe que `importSkills` :
 * il tourne tel quel contre l'ancienne logique (preuve « échoue avant »).
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function skillWith(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-r13-'));
  dirs.push(root);
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

async function imported(root: string) {
  return importSkills(root, { dryRun: true, source: 'probe' });
}

describe('Reprise 13 : les quatre bloquants de la contre-revue n° 3 sont en quarantaine', () => {
  it('1. copie du binaire du shell depuis $SHELL ou /proc/$$/exe', async () => {
    for (const [name, body] of SHELL_COPIES) {
      const r = await imported(skillWith({ 'scripts/run.sh': body }));
      expect(r.imported.length, name).toBe(0);
      expect(r.quarantined.length, name).toBe(1);
    }
  });

  it('2. option d\'enveloppe inconnue (bwrap --bind-fd) qui cache le programme', async () => {
    const r = await imported(skillWith({ 'scripts/run.sh': BWRAP }));
    expect(r.imported.length).toBe(0);
    expect(r.quarantined.length).toBe(1);
  });

  it('3. recette dans un fichier inclus nommé autrement que Makefile, et awk "$prog"', async () => {
    const mk = await imported(skillWith({ Makefile: MAKE_INCLUDE, 'payload.make': PAYLOAD_MAKE }));
    expect(mk.imported.length).toBe(0);
    expect(mk.quarantined.length).toBe(1);
    const awk = await imported(skillWith({
      'scripts/run.sh': 'prog=$(cat p.awk)\nawk "$prog"\n',
      'scripts/p.awk': 'BEGIN{print "RAN" > ENVIRON["MARKER"]}\n',
    }));
    expect(awk.imported.length).toBe(0);
    expect(awk.quarantined.length).toBe(1);
  });

  it('4. fichiers de langage à nom ou commande lus dans une donnée', async () => {
    for (const [name, files] of LANG_FILES) {
      const r = await imported(skillWith(files));
      expect(r.imported.length, name).toBe(0);
      expect(r.quarantined.length, name).toBe(1);
    }
  });
});
