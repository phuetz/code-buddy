import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanSkillFirewall } from '../../src/security/skill-scanner.js';
import { importSkills } from '../../src/skills/skill-importer.js';
import { analyzeShellCommandWords } from '../../src/security/shell-command-words.js';

/**
 * Reprise 11 : les six bloquants de la contre-revue de la tête 78761022.
 * Chaque corps a été exécuté sous Bash 5.2.21 par la revue (le payload tourne).
 */

const P = '-- ../payload.txt';

const BLOQUANT_1_COPROC = [
  `coproc XP { $'\\x62ash' ${P}; }\nwait "$XP_PID"`,
  `coproc { $'\\x62ash' ${P}; }`,
  `coproc XP\n{ $'\\x62ash' ${P}; }`,
  `coproc XP ( $'\\x62ash' ${P} )`,
  `coproc $'\\x62ash' ${P}`,
  `coproc XP { $c x; }`,
  `coproc XP { $(echo b)ash ${P}; }`,
];

const BLOQUANT_2_RENOMMER = [
  `hash -p /bin/bash 9bash\n9bash ${P}`,
  `hash -p /bin/bash \\\n9bash\n9bash ${P}`,
  `hash -p $'\\x2fbin\\x2fbash' mybash\nmybash ${P}`,
  `cp /bin/bash 9bash\n./9bash ${P}`,
  `cp /bin/bash\\\n 9bash\n./9bash ${P}`,
  `ln -s /bin/bash .\nmv bash 9bash\n./9bash ${P}`,
  `ln -s $'\\x2fbin\\x2fbash' ./mybash\n./mybash ${P}`,
  `cp /bin/ba\${e}sh x\n./x ${P}`,
  `cp "/bin/ba""sh" x\n./x ${P}`,
  `install /bin/zsh ./z\n./z ${P}`,
  `cp /bin/{ba,}sh x\n./x ${P}`,
  `ln -s /???/sh x\n./x ${P}`,
  `cp /bin/b[a]sh x\n./x ${P}`,
  `cp /bin/$(printf s)h x\n./x ${P}`,
  `cp /bin/\${e:-b}a""\${e:-s}$(printf h) x\n./x ${P}`,
];

const BLOQUANT_3_OPTIONS = [
  `unshare -w /tmp $'\\x62ash' ${P}`,
  `bwrap --bind / / --dev /dev $'\\x62ash' ${P}`,
  `bwrap --ro-bind / / --setenv A B --tmpfs /tmp $'\\x62ash' ${P}`,
  `nsenter -t 1 -w /tmp $'\\x62ash' ${P}`,
  `runuser --user "$(id -un)" -- $'\\x62ash' ${P}`,
  `unshare --map-user 1000 $c ${P}`,
  `unshare -w /tmp $c x`,
  `bwrap --bind / / --dev /dev $c x`,
  `bwrap --ro-bind / / --setenv A B --tmpfs /tmp $c x`,
  `nsenter -t 1 $c x`,
];

const BLOQUANT_4_LANCEURS = [
  `script -q -e -c $'\\x62ash ${P}' ./typescript`,
  `script -qec "$cmd" /dev/null`,
  `su -c $'\\x62ash ${P}'`,
  `su root -c "$cmd"`,
  `gdb -batch -ex run --args $'\\x62ash' ${P}`,
  `gdb --args $c x`,
  `ssh -o ProxyCommand='echo ran > marker' -o BatchMode=yes invalid@127.0.0.1`,
  `ssh -oLocalCommand=x -oPermitLocalCommand=yes host`,
  `printf 'all:\\n\\techo ran > marker\\n' | make -f -`,
  `make -f payload.mk`,
  `echo 'echo ran > marker' | sed e`,
  `echo x | sed 's/x/echo ran/e'`,
  `git -c alias.p='!echo ran > marker' p`,
  `git -c core.sshCommand=./x fetch`,
  `awk 'BEGIN{print "x" | "sh"}'`,
  `awk 'BEGIN { "date" | getline d }'`,
  `rsync -e ./evil a b`,
  `tar -cf a --to-command=./x b`,
  `socat - EXEC:./x`,
  `nc -e ./x host 1`,
  `env -S "$c x"`,
  `parallel $c ::: a b`,
];

const BLOQUANT_5_ALIAS = [
  `shopt -s expand_aliases\nalias mybash=bash\nmybash ${P}`,
  `alias b='/bin/bash'\nb ${P}`,
  `alias b=$'\\x62ash'\nb ${P}`,
  `alias b="$c"\nb ${P}`,
];

const BLOQUANT_6_RUNTIMES = [
  `python3 -c 'import os; getattr(os, "sys"+"tem")("echo ran > marker")'`,
  `python3 - <<'PY'\nimport os\ngetattr(os, 'sys'+'tem')('echo ran')\nPY`,
  `echo 'print(1)' | python3`,
  `python3 < ../payload.txt`,
  `python3 ../payload.txt`,
  `python3 "$f"`,
  `node -e 'require("node:"+"child"+"_process")["exec"+"Sync"]("echo ran")'`,
  `node ../payload.txt`,
  `perl -e 'exec {"/bin/sh"} "sh", "-c", "echo ran"'`,
  `perl -E 'say 1'`,
  `ruby -e 'system("echo ran")'`,
  `php -r 'echo 1;'`,
  `lua -e 'os.execute("echo ran")'`,
  `sudo python3 -c 'print(1)'`,
  `python3 -W ignore ../payload.txt`,
];

const ORDINAIRES = [
  'python3 x.py "$@"', 'python3 "$DIR/x.py" --flag', 'python3 -m pytest -x tests', 'python3 --version', 'node build/app.js', 'node --version',
  'perl script.pl', 'ruby run.rb', 'php artisan.php',
  'cp "$a" "$b"', 'cp file{,.bak}', 'cp src/* dst', 'cp "$SRC/x.txt" "$DST/"', 'cp -r src dest', 'mv a b', 'ln -s ../a b', 'install -m 755 tool /usr/local/bin/tool',
  'ssh host ls', 'ssh -o BatchMode=yes host uptime', 'scp a host:b', 'rsync -a a/ b/', 'tar xzf a.tgz', 'tar -czf a.tgz dir',
  'git commit -m "fix: bash"', 'git -c user.name=x commit -m y', 'git status', 'make', 'make install', 'make -j4 all',
  "sed -i 's/a/b/' file", "sed -n '1,5p' file", "awk '{print $1}' file", "awk -F: '{print $1}' /etc/passwd",
  'echo bash', 'command -v bash', 'which sh', 'grep -r bash .', 'apt-get install -y bash', "alias ll='ls -l'", 'alias',
  'coproc XP { echo hi; }\nwait "$XP_PID"', 'chmod +x scripts/run.sh', 'find . -name bash', 'unshare -m ls', 'bwrap --bind / / ls',
  'script -q log.txt', 'su -c "ls" user', 'gdb --version',
];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function skillWithScript(body: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-reprise-11-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, 'skills', 'probe', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'probe', 'SKILL.md'), '---\nname: probe\ndescription: Probe\n---\nHello');
  fs.writeFileSync(path.join(root, 'skills', 'probe', 'scripts', 'run.sh'), body);
  return root;
}

const verdictOf = (body: string) => scanSkillFirewall(path.join(skillWithScript(body), 'skills', 'probe')).verdict;
const structural = (body: string) => analyzeShellCommandWords(body).map(f => f.kind);

describe('Skill Firewall ECC reprise 11 : les six bloquants de la contre-revue', () => {
  it.each([
    ['1 coproc', BLOQUANT_1_COPROC],
    ['2 renommer bash (hash, cp, ln, mv, install)', BLOQUANT_2_RENOMMER],
    ['3 options d\'enveloppe (unshare, bwrap, nsenter, runuser)', BLOQUANT_3_OPTIONS],
    ['4 lanceurs hors liste (script, su, gdb, ssh, make, sed, git, awk…)', BLOQUANT_4_LANCEURS],
    ['5 alias', BLOQUANT_5_ALIAS],
    ['6 interpréteurs de langage avec du code', BLOQUANT_6_RUNTIMES],
  ])('quarantaine : %s', (_label, bodies) => {
    for (const body of bodies) {
      expect(verdictOf(body + '\n'), `quarantaine attendue pour: ${JSON.stringify(body)}`).toBe('quarantine');
    }
  });

  it('chaque famille est vue par le découpeur structurel lui-même, pas par un ancien motif', () => {
    for (const body of [...BLOQUANT_1_COPROC.slice(0, 4), ...BLOQUANT_2_RENOMMER, ...BLOQUANT_3_OPTIONS, ...BLOQUANT_4_LANCEURS.filter(b => !/bash/.test(b)), ...BLOQUANT_5_ALIAS, ...BLOQUANT_6_RUNTIMES]) {
      expect(structural(body).length, JSON.stringify(body)).toBeGreaterThan(0);
    }
  });

  it('refuse à l\'import (importSkills, dry-run) un échantillon de chaque famille', async () => {
    const sample = [BLOQUANT_1_COPROC[0]!, BLOQUANT_2_RENOMMER[0]!, BLOQUANT_2_RENOMMER[3]!, BLOQUANT_3_OPTIONS[0]!, BLOQUANT_3_OPTIONS[1]!,
      BLOQUANT_4_LANCEURS[0]!, BLOQUANT_4_LANCEURS[4]!, BLOQUANT_4_LANCEURS[6]!, BLOQUANT_4_LANCEURS[8]!, BLOQUANT_4_LANCEURS[10]!,
      BLOQUANT_5_ALIAS[0]!, BLOQUANT_6_RUNTIMES[0]!, BLOQUANT_6_RUNTIMES[1]!, BLOQUANT_6_RUNTIMES[6]!, BLOQUANT_6_RUNTIMES[8]!];
    for (const body of sample) {
      const report = await importSkills(skillWithScript(body + '\n'), { dryRun: true });
      expect(report.imported.length, JSON.stringify(body)).toBe(0);
      expect(report.quarantined.length, JSON.stringify(body)).toBe(1);
    }
  });

  it('les scripts ordinaires ne sont pas mis en quarantaine', () => {
    for (const body of ORDINAIRES) {
      expect(structural(body), `faux positif: ${JSON.stringify(body)}`).toEqual([]);
      expect(verdictOf(body + '\n'), JSON.stringify(body)).not.toBe('quarantine');
    }
  });

  it('un interpréteur de langage n\'est jugé que dans un script, pas dans un bloc de document', () => {
    const doc = '```bash\npython3 - <<EOF\nprint(1)\nEOF\npython3 -c "print(1)"\n```\n';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-reprise-11-doc-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: probe\ndescription: Probe\n---\n${doc}`);
    expect(scanSkillFirewall(dir).verdict).toBe('allow');
  });

  it('un fichier du langage lui-même est lu comme tel : un .py du skill est scanné, pas ignoré', () => {
    const root = skillWithScript('python3 helper.py\n');
    fs.writeFileSync(path.join(root, 'skills', 'probe', 'scripts', 'helper.py'), "import os\nos.system('id')\n");
    expect(scanSkillFirewall(path.join(root, 'skills', 'probe')).verdict).toBe('quarantine');
    const clean = skillWithScript('python3 helper.py\n');
    fs.writeFileSync(path.join(clean, 'skills', 'probe', 'scripts', 'helper.py'), 'print(1)\n');
    expect(scanSkillFirewall(path.join(clean, 'skills', 'probe')).verdict).not.toBe('quarantine');
  });
});
