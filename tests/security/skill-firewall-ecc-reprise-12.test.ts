import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanSkillFirewall } from '../../src/security/skill-scanner.js';
import { importSkills } from '../../src/skills/skill-importer.js';
import { analyzeShellCommandWords, makefileRecipeText } from '../../src/security/shell-command-words.js';

/**
 * Reprise 12 : la contre-revue n° 2 de Grok (tête 69a4cd11). Chaque corps a été
 * exécuté sous Bash 5.2.21 (voir _qa/pare-feu-ecc/reprise-10/grok2.ts).
 */

const R = '-- ../payload.txt';
type Case = [string, string, Record<string, string>?];

/** Bloquant 1 : option d'enveloppe d'arité inconnue, et enveloppe absente de la table. */
const OPTIONS_INCONNUES: Case[] = [
  ['stdbuf --output L', `c=bash\nstdbuf --output L "$c" ${R}`],
  ['ionice --class 3', `c=bash\nionice --class 3 "$c" ${R}`],
  ['numactl --interleave all', `c=bash\nnumactl --interleave all "$c" ${R}`],
  ['setpriv --pdeathsig TERM', `c=bash\nsetpriv --pdeathsig TERM "$c" ${R}`],
  ['bwrap --argv0 fake', `c=bash\nbwrap --argv0 fake --ro-bind / / --dev /dev "$c" ${R}`],
  ['xargs --process-slot-var', `c=bash\necho x | xargs --process-slot-var SLOT "$c" ${R}`],
  ['xargs --max-chars', `c=bash\necho x | xargs --max-chars 4000 "$c" ${R}`],
  ['prlimit (hors table)', `c=bash\nprlimit --nofile=1024 "$c" ${R}`],
  ['enveloppe inconnue, option inconnue', `c=bash\nmonwrapper --opt valeur "$c" ${R}`],
  ['option inconnue sans variable connue', `stdbuf --output L "$1" ${R}`],
];

/** Bloquant 2 : copier le shell par une variable, par cat, dd if=, tee, redirection. */
const COPIES: Case[] = [
  ['cp /bin/$c', `c=bash\ncp /bin/$c 9bash\n./9bash ${R}`],
  ['ln -s /bin/$c', `c=bash\nln -s /bin/$c ./9bash\n./9bash ${R}`],
  ['install /bin/$c', `c=bash\ninstall /bin/$c ./9bash\n./9bash ${R}`],
  ['dd if=/bin/$c', `c=bash\ndd if=/bin/$c of=9bash\nchmod +x 9bash\n./9bash ${R}`],
  ['dd if=/bin/bash', `dd if=/bin/bash of=9bash\nchmod +x 9bash\n./9bash ${R}`],
  ['rsync', `c=bash\nrsync /bin/$c 9bash\n./9bash ${R}`],
  ['cat /bin/bash > x', `cat /bin/bash > 9bash\nchmod +x 9bash\n./9bash ${R}`],
  ['tee < /bin/bash', `tee 9bash < /bin/bash > /dev/null\nchmod +x 9bash\n./9bash ${R}`],
  ['variable réaffectée dans une branche', `c=ls\nif true; then c=bash; fi\ncp /bin/$c x`],
  ['variable dans un tableau', `shells=(ls bash)\ncp /bin/${'${shells[1]}'} x`],
  ['variable de boucle', `for c in ls bash; do cp /bin/$c x; done`],
  ['variable exportée', `export c=bash\ncp /bin/$c x`],
  ['variable via declare', `declare c=bash\ncp "/bin/$c" x`],
];

/** Bloquant 3 : code qui n'est pas sur la ligne surveillée. */
const CODE_AILLEURS: Case[] = [
  ['awk print > fichier', `MARKER=marker awk 'BEGIN{print "RAN" > ENVIRON["MARKER"]}'`],
  ['awk -f', 'awk -f p.awk', { 'p.awk': 'BEGIN{print "RAN" > "marker"}\n' }],
  ['sed -f avec e', 'echo x | sed -f s.sed', { 's.sed': '1e echo RAN\n' }],
  ['make + Makefile ($(c))', 'make', { Makefile: 'c = bash\nall:\n\t$(c) ../payload.txt\n' }],
  ['make + Makefile (recette claire)', 'make', { Makefile: 'all:\n\tbash ../payload.txt\n' }],
  ['make + Makefile ($(SHELL))', 'make', { Makefile: 'all:\n\t$(SHELL) ../payload.txt\n' }],
  ['make + Makefile ($(shell …))', 'make', { Makefile: 'all:\n\t@echo $(shell $(c) x)\n' }],
  ['git config alias', "git config alias.p '!echo RAN'\ngit p"],
  ['git config core.sshCommand', 'git config core.sshCommand ./x'],
  ['capsh -- -c', "capsh -- -c 'echo RAN'"],
  ['docker --entrypoint', 'c=bash\ndocker run --entrypoint "$c" img x'],
];

/** Bloquant 4 : fichier du langage lui-même, dont le nom est construit ou la donnée codée. */
const FICHIERS_DU_LANGAGE: Case[] = [
  ['node helper.js', 'node helper.js', { 'helper.js': "const cp = require('no'+'de:child'+'_process');\ncp['exec'+'Sync']('echo RAN');\n" }],
  ['node globalThis', 'node helper.js', { 'helper.js': "globalThis['ev'+'al']('1')\n" }],
  ['node process.binding', 'node helper.js', { 'helper.js': "process.binding('spawn_sync')\n" }],
  ['perl helper.pl', 'perl helper.pl', { 'helper.pl': 'exec {"/bin/sh"} "sh", "-c", "echo RAN";\n' }],
  ['perl sub dynamique', 'perl helper.pl', { 'helper.pl': 'my $f = "sys"."tem"; &$f("id");\n' }],
  ['python exec xor', 'python3 loader.py', { 'loader.py': "d=open('a.dat','rb').read()\nexec(bytes(b^7 for b in d))\n" }],
  ['python import_module construit', 'python3 loader.py', { 'loader.py': "import importlib\nimportlib.import_module('o'+'s')\n" }],
];

/** Scripts ordinaires : à ne pas mettre en quarantaine. */
const ORDINAIRES: Case[] = [
  ['sudo -n cp', 'sudo -n cp "$a" "$b"'], ['sudo -u root cp', 'sudo -u root cp "$a" "$b"'], ['strace -f ls', 'strace -f ls "$d"'],
  ['xargs -0 -n1', 'find . -print0 | xargs -0 -n1 echo "$x"'], ['xargs -I', 'ls | xargs -I{} cp {} "$d"'], ['timeout', 'timeout 5 sleep "$n"'],
  ['nice -n', 'nice -n 5 make "$t"'], ['cat', 'cat a b > c'], ['cat fichier', 'cat file'], ['dd', 'dd if=in of=out bs=1M'], ['tee', 'echo x | tee log'],
  ['tee <', 'tee log < input'], ['awk simple', "awk '{print $1}' f"], ['awk stderr', "awk '{print > \"/dev/stderr\"}' f"], ['awk -F', "awk -F: '{print $2}' /etc/passwd"],
  ['awk comparaison', "awk '$1 > 5 {print}' f"], ['sed -n', "sed -n '1,5p' f"], ['sed -i', "sed -i 's/a/b/' f"], ['git config user', 'git config user.name x'],
  ['git config alias simple', 'git config --global alias.co checkout'], ['docker run', 'docker run --rm img ls'],
  ['variable non-shell', 'c=ls\necho "$c"'], ['variable shell lue par echo', 'x=bash\necho "$x"'], ['variable shell dans grep', 'name=bash\ngrep "$name" f'],
  ['variable dans printf', "name=bash\nprintf '%s\\n' \"$name\""], ['boucle ordinaire', 'for f in a b; do echo "$f"; done'], ['export', 'export PATH="$HOME/bin:$PATH"'],
  ['make sans Makefile', 'make'], ['make avec Makefile ordinaire', 'make', { Makefile: 'CC = cc\nall: a.o\n\t$(CC) -o app a.o\n\t@echo built\n\trm -f a.o\n.PHONY: all\n' }],
  ['make install ordinaire', 'make install', { Makefile: 'install:\n\tinstall -m 755 app $(DESTDIR)/usr/bin/app\n\tmkdir -p $(DESTDIR)/etc\n' }],
  ['node fichier propre', 'node helper.js', { 'helper.js': "const fs = require('fs');\nconsole.log(fs.readFileSync('a.txt', 'utf8'));\n" }],
  ['python fichier propre', 'python3 helper.py', { 'helper.py': "print('ok')\n" }],
  ['perl fichier propre', 'perl helper.pl', { 'helper.pl': 'print "ok\\n";\n' }],
];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function skillWith(body: string, files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-reprise-12-'));
  dirs.push(root);
  const skill = path.join(root, 'skills', 'probe');
  fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: probe\ndescription: Probe\n---\nHello');
  fs.writeFileSync(path.join(skill, 'scripts', 'run.sh'), body + '\n');
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(skill, 'scripts', f), c);
  return root;
}

const verdictOf = ([, body, files]: Case) => scanSkillFirewall(path.join(skillWith(body, files), 'skills', 'probe')).verdict;

describe('Skill Firewall ECC reprise 12 : contre-revue n° 2', () => {
  it.each([
    ['1 option d\'enveloppe d\'arité inconnue', OPTIONS_INCONNUES],
    ['2 copier le shell (variable, cat, dd if=, tee)', COPIES],
    ['3 code hors de la ligne surveillée', CODE_AILLEURS],
    ['4 fichier du langage à nom construit ou donnée codée', FICHIERS_DU_LANGAGE],
  ])('quarantaine : %s', (_label, cases) => {
    for (const c of cases as Case[]) expect(verdictOf(c), `quarantaine attendue pour: ${c[0]}`).toBe('quarantine');
  });

  it('refuse à l\'import (importSkills, dry-run) un échantillon de chaque famille', async () => {
    const sample = [OPTIONS_INCONNUES[0]!, OPTIONS_INCONNUES[7]!, COPIES[0]!, COPIES[4]!, COPIES[7]!, CODE_AILLEURS[0]!, CODE_AILLEURS[1]!, CODE_AILLEURS[3]!, CODE_AILLEURS[7]!, FICHIERS_DU_LANGAGE[0]!, FICHIERS_DU_LANGAGE[3]!];
    for (const [name, body, files] of sample) {
      const report = await importSkills(skillWith(body, files), { dryRun: true });
      expect(report.imported.length, name).toBe(0);
      expect(report.quarantined.length, name).toBe(1);
    }
  });

  it('les scripts ordinaires ne sont pas mis en quarantaine', () => {
    for (const c of ORDINAIRES) expect(verdictOf(c), `faux positif: ${c[0]}`).not.toBe('quarantine');
  });

  it('une variable réaffectée garde toutes ses valeurs (fermé) et une valeur inconnue ne dit rien', () => {
    expect(analyzeShellCommandWords('c=bash\nc=ls\ncp /bin/$c x').length).toBeGreaterThan(0);
    expect(analyzeShellCommandWords('c=$(date)\ncp /bin/$c x')).toEqual([]);
    expect(analyzeShellCommandWords('cp /bin/$c x')).toEqual([]);
  });

  it('une option connue sans argument n\'ouvre pas de doute, une option inconnue en ouvre un pour deux mots', () => {
    expect(analyzeShellCommandWords('sudo -n cp "$a" "$b"')).toEqual([]);
    expect(analyzeShellCommandWords('stdbuf --output L "$c" x').map(f => f.kind)).toContain('non-literal-command-word');
    expect(analyzeShellCommandWords('monwrapper --opt v "$c" x').length).toBe(0); // enveloppe inconnue : ni table ni doute
  });

  it('traduit les recettes d\'un Makefile en shell, ligne pour ligne', () => {
    const text = makefileRecipeText('CC = cc\nall:\n\t@$(CC) -o $@ $<\n\techo $$HOME $(shell date)\n');
    expect(text.split('\n')).toEqual(['', '', 'cc -o $AUTO $AUTO', 'echo $HOME $(date)', '']);
  });
});
