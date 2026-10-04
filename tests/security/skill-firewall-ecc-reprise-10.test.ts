import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanSkillContent, scanSkillFirewall } from '../../src/security/skill-scanner.js';
import { importSkills } from '../../src/skills/skill-importer.js';

/**
 * Reprise 10 : le pare-feu ne tient plus une liste d'orthographes interdites.
 * Il découpe le script en commandes simples et refuse tout mot de commande qui
 * n'est pas un littéral simple (fermé par défaut).
 */

const PAYLOAD = '-- ../payload.txt';

/** Corps listés par la revue de la reprise 9 (son bloquant) : Bash les exécute tous. */
const REVUE_REPRISE_9 = [
  `$'\\x62ash' ${PAYLOAD}`,
  `$'\\x62\\x61\\x73\\x68' ${PAYLOAD}`,
  `$'\\142ash' ${PAYLOAD}`,
  `$'\\142\\141\\163\\150' ${PAYLOAD}`,
  `$'\\u0062ash' ${PAYLOAD}`,
  `$'b\\x61sh' ${PAYLOAD}`,
  `/bin/$'\\x62ash' ${PAYLOAD}`,
  `a=\nba\${a}sh ${PAYLOAD}`,
  `cmd=bash\n$cmd ${PAYLOAD}`,
];

/** Corps de la reprise 8 et de la revue de la reprise 9 (quotes et antislashs dans le nom). */
const REPRISE_8 = [
  `''bash ${PAYLOAD}`, `""bash ${PAYLOAD}`, `bash'' ${PAYLOAD}`, `bash"" ${PAYLOAD}`, `\\bash ${PAYLOAD}`,
  `\\b\\a\\s\\h ${PAYLOAD}`, `ba\\sh ${PAYLOAD}`, `$'bash' ${PAYLOAD}`, `bash$'' ${PAYLOAD}`, `''sh ${PAYLOAD}`,
  `''dash ${PAYLOAD}`, `bash \\\n'' ${PAYLOAD}`, `b''ash ${PAYLOAD}`, `ba''sh ${PAYLOAD}`, `bas''h ${PAYLOAD}`,
  `b"a"sh ${PAYLOAD}`, `$'b'$'ash' ${PAYLOAD}`, `b\\ash ${PAYLOAD}`, `s''h ${PAYLOAD}`, `$"bash" ${PAYLOAD}`,
  `bash ''-- ../payload.txt`, `bash \\-- ../payload.txt`, `$(bash ''-- ../payload.txt)`, `$bash --flag`,
];

/** Même défaut, d'autres positions de commande : séparateurs, enveloppes, structures. */
const AUTRES_POSITIONS = [
  'c=bash\necho hi; $c x', 'c=bash\necho hi && $c x', 'c=bash\necho hi || $c x', 'c=bash\ncat f | $c', 'c=bash\n$c x &',
  'c=bash\nx=$($c a)', 'c=bash\necho `$c a`', 'c=bash\necho "$($c a)"', 'c=bash\necho ${y:-$($c)}',
  'c=bash\nsudo $c x', 'c=bash\nsudo -u root $c x', 'c=bash\nenv A=1 $c x', 'c=bash\nxargs -I{} $c {}',
  'c=bash\ncommand $c x', 'c=bash\nbuiltin $c x', 'c=bash\nexec $c x', 'c=bash\ntime $c x', 'c=bash\nnohup $c x',
  'c=bash\ntimeout 5 $c x', 'c=bash\neval "$c x"', 'c=bash\neval $c', 'c=bash\neval ba"$x"sh', "c=bash\ntrap '$c x' EXIT",
  'c=bash\nfind . -exec $c {} \x5c;', 'c=bash\nif $c x; then :; fi', 'c=bash\nwhile $c x; do :; done',
  'c=bash\nfor i in 1; do $c x; done', 'c=bash\ncase 1 in 1) $c x;; esac', 'c=bash\n( $c x )', 'c=bash\n{ $c x; }',
  'c=bash\nf() { $c x; }\nf', 'c=bash\ncat <<EOF\n$($c x)\nEOF', 'c=bash\n[[ -f x ]] && $c x', 'c=bash\n! $c x',
  'c=bash\n"$c" x', 'c=bash\n${c} x', 'c=bash\n$(echo bash) x', 'c=bash\n`echo bash` x', 'c=bash\n$((1)) x',
  'c=bash\ndiff <($c a) b', 'source ../payload.txt', '. ../payload.txt', 'sudo sh x', 'xargs -I{} bash {}',
];

/** Texte qu'on ne sait pas découper sûrement : jamais `allow`. */
const ILLISIBLES = ["echo 'x", 'echo "x', 'echo `x', 'echo $(x', 'echo ${x', 'echo x)', 'a ( b', 'echo x;;', '[[ -f x'];

/** Scripts ordinaires : les arguments non littéraux sont permis. */
const ORDINAIRES = [
  'echo "$HOME"', 'ls -la "$dir"', 'grep -r "x" .', 'cd "$(dirname "$0")"',
  '#!/usr/bin/env bash\nset -euo pipefail\nDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\nfor f in "$DIR"/*.txt; do\n  [ -f "$f" ] || continue\n  wc -l < "$f"\ndone',
  'if [[ "$x" =~ ^(a|b)$ ]]; then echo ok; fi', 'case "$1" in\n  start|stop) echo "$1";;\n  *) exit 1;;\nesac',
  'cat <<\'EOF\'\n$c\nEOF', 'x=$((1+2)); echo "$x"', 'arr=(a "b c" $d)\necho "${arr[@]}"', 'readonly O=(--fail --silent)',
  'f() { echo hi; }\nf', 'cp "$a" "$b" && git commit -m "x"', 'sudo -u "$user" cp "$a" "$b"', 'find . -name "*.sh" -exec rm {} \x5c;',
  'trap \'cleanup "$tmp"\' EXIT', 'export PATH="$HOME/bin:$PATH"', '. "$(dirname "$0")/lib/common.sh"', 'python3 x.py "$@"',
];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function skillWithScript(body: string, file = 'run.sh'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-reprise-10-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, 'skills', 'probe', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'probe', 'SKILL.md'), '---\nname: probe\ndescription: Probe\n---\nHello');
  fs.writeFileSync(path.join(root, 'skills', 'probe', 'scripts', file), body);
  return root;
}

function activeHigh(body: string, file = 'scripts/run.sh') {
  return scanSkillContent(body, file, true).findings.filter(f => !f.documentary && f.severity === 'high');
}

describe('Skill Firewall ECC reprise 10 : mot de commande, fermé par défaut', () => {
  it.each([['revue reprise 9', REVUE_REPRISE_9], ['reprise 8 et orthographes voisines', REPRISE_8], ['autres positions de commande', AUTRES_POSITIONS]])(
    'met en quarantaine (%s)',
    (_label, bodies) => {
      for (const body of bodies) {
        const report = scanSkillFirewall(path.join(skillWithScript(body), 'skills', 'probe'));
        expect(report.verdict, `quarantaine attendue pour: ${JSON.stringify(body)}`).toBe('quarantine');
      }
    },
  );

  it('le verdict vient du découpeur structurel pour chaque corps de la revue de la reprise 9', () => {
    for (const body of REVUE_REPRISE_9) {
      const patterns = activeHigh(body).map(f => f.pattern);
      expect(patterns, JSON.stringify(body)).toContain('non-literal-command-word');
    }
  });

  it('refuse à l\'import (importSkills, dry-run) chacun des corps de la revue de la reprise 9', async () => {
    for (const body of [...REVUE_REPRISE_9, ...AUTRES_POSITIONS.slice(0, 8)]) {
      const report = await importSkills(skillWithScript(body), { dryRun: true });
      expect(report.imported.length, `ne doit pas être importé: ${JSON.stringify(body)}`).toBe(0);
      expect(report.quarantined.length, JSON.stringify(body)).toBe(1);
    }
  });

  it('refuse à l\'import chaque corps de la reprise 8', async () => {
    for (const body of REPRISE_8) {
      const report = await importSkills(skillWithScript(body), { dryRun: true });
      expect(report.imported.length, JSON.stringify(body)).toBe(0);
      expect(report.quarantined.length, JSON.stringify(body)).toBe(1);
    }
  });

  it('échoue fermé sur un texte qu\'il ne sait pas découper', async () => {
    for (const body of ILLISIBLES) {
      expect(activeHigh(body).map(f => f.pattern), JSON.stringify(body)).toContain('unparseable-shell');
      const report = await importSkills(skillWithScript(body), { dryRun: true });
      expect(report.imported.length, JSON.stringify(body)).toBe(0);
    }
  });

  it('n\'applique pas la règle aux scripts ordinaires (arguments non littéraux permis)', async () => {
    for (const body of ORDINAIRES) {
      expect(activeHigh(body).filter(f => ['non-literal-command-word', 'interpreter-command-word', 'unparseable-shell'].includes(f.pattern)), JSON.stringify(body)).toEqual([]);
      const report = await importSkills(skillWithScript(body), { dryRun: true });
      expect(report.quarantined.length, `ne doit pas être en quarantaine: ${JSON.stringify(body)}`).toBe(0);
    }
  });

  it('ne traite pas comme du shell un script d\'un autre langage', () => {
    expect(activeHigh('$user = User::factory()->create();', 'scripts/run.php')).toEqual([]);
    expect(activeHigh('for sh in shots:\n    pass', 'scripts/run.py')).toEqual([]);
    expect(activeHigh('const x = `${a}`;', 'scripts/run.js')).toEqual([]);
  });

  it('analyse un script dont le shebang dit shell, quelle que soit son extension', () => {
    const body = '#!/bin/bash\n$cmd x';
    expect(activeHigh(body, 'scripts/run.py').map(f => f.pattern)).toContain('non-literal-command-word');
  });

  it('un bloc shell d\'un document reste documentaire (revue), un script est actif', () => {
    const doc = '# Doc\n\n```bash\n$cmd x\n```\n\nProse avec `$cmd` seulement.\n';
    const found = scanSkillContent(doc, 'SKILL.md').findings.filter(f => f.pattern === 'non-literal-command-word');
    expect(found.length).toBe(1);
    expect(found[0]!.documentary).toBe(true);
    expect(found[0]!.line).toBe(4);
    const notShell = '```python\n$cmd x\n```\n';
    expect(scanSkillContent(notShell, 'SKILL.md').findings.filter(f => f.pattern === 'non-literal-command-word')).toEqual([]);
  });

  it('lit comme du shell un fichier exécutable de nature inconnue, pas un fichier inerte', () => {
    const root = skillWithScript('$cmd x\n', 'run');
    const file = path.join(root, 'skills', 'probe', 'scripts', 'run');
    expect(scanSkillFirewall(path.join(root, 'skills', 'probe')).verdict).toBe('allow');
    fs.chmodSync(file, 0o755);
    expect(scanSkillFirewall(path.join(root, 'skills', 'probe')).verdict).toBe('quarantine');
  });

  it('quarantaine pour 600 orthographes aléatoires de bash/sh/dash, dans 28 positions de commande', () => {
    // Même générateur que le banc différentiel contre un vrai Bash (_qa, 1761
    // exécutions réelles, 0 manquée) ; ici sans exécuter, donc portable.
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;
    const hex = (c: string) => c.charCodeAt(0).toString(16).padStart(2, '0');
    const oct = (c: string) => c.charCodeAt(0).toString(8).padStart(3, '0');
    const spell = (c: string): string => pick([
      () => c, () => `\\${c}`, () => `'${c}'`, () => `"${c}"`, () => `$'\\x${hex(c)}'`, () => `$'\\${oct(c)}'`, () => `$'\\u00${hex(c)}'`,
      () => `\${e}${c}`, () => `$(printf ${c})`, () => '`printf ' + c + '`', () => `''${c}`, () => `\${e:-${c}}`, () => `$e${c}`,
    ])();
    const wraps: Array<(c: string) => string> = [
      c => c, c => `true && ${c}`, c => `false || ${c}`, c => `true; ${c}`, c => `echo x | ${c}`, c => `if ${c}; then :; fi`, c => `(${c})`,
      c => `{ ${c}; }`, c => `x=$(${c})`, c => `echo "$(${c})"`, c => `command ${c}`, c => `exec ${c}`, c => `env A=1 ${c}`, c => `nohup ${c}`,
      c => `time ${c}`, c => `xargs -I{} ${c}`, c => `for i in 1; do ${c}; done`, c => `f() { ${c}; }; f`, c => `case 1 in 1) ${c};; esac`,
      c => `eval '${c}'`, c => `eval "${c}"`, c => `find . -maxdepth 0 -exec ${c} \x5c;`, c => `while ${c}; do break; done`, c => `[[ 1 ]] && ${c}`,
      c => `! ${c}`, c => `a=b ${c}`, c => `echo <(${c})`, c => `cat <<EOF\n$(${c})\nEOF`,
    ];
    for (let i = 0; i < 600; i++) {
      const name = pick(['bash', 'sh', 'dash']);
      const spelled = pick(['', '/bin/', '/usr/bin/']) + [...name].map(spell).join('');
      const body = 'e=\n' + pick(wraps)(`${spelled} ../payload.txt`) + '\n';
      const verdict = scanSkillFirewall(path.join(skillWithScript(body), 'skills', 'probe')).verdict;
      expect(verdict, JSON.stringify(body)).toBe('quarantine');
      fs.rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });
});
