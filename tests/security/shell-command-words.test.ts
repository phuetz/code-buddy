import { describe, it, expect } from 'vitest';
import {
  analyzeShellCommandWords,
  interpreterNameOf,
  isLiteralCommandWord,
} from '../../src/security/shell-command-words.js';

const kinds = (src: string) => analyzeShellCommandWords(src).map(f => f.kind);
const words = (src: string) => analyzeShellCommandWords(src).map(f => f.word);

describe('shell-command-words : littéral et interpréteur', () => {
  it('ne reconnaît comme littéral que les mots sans expansion possible', () => {
    for (const ok of ['ls', './run.sh', '/usr/bin/env', 'a+b', '~/bin/x', '/project:infinite', '[', '[[', ':', 'v1.2-x']) {
      expect(isLiteralCommandWord(ok), ok).toBe(true);
    }
    for (const no of ['$x', '${x}', '"ls"', "'ls'", 'l\\s', "$'ls'", 'l*', 'l?', '[Run', '{a,b}', '~root/x', '=ls', '$(x)', '`x`', '', 'a b']) {
      expect(isLiteralCommandWord(no), no).toBe(false);
    }
  });

  it('compare le nom de base, sans .exe, à la liste des interpréteurs', () => {
    for (const name of ['bash', '/bin/bash', '/usr/bin/zsh', 'SH', 'dash', 'ksh', 'fish', 'bash.exe', 'pwsh', 'powershell.exe', 'osascript']) {
      expect(interpreterNameOf(name), name).not.toBeNull();
    }
    for (const name of ['ls', 'bashful', 'shot', 'cash', 'python3', 'node']) {
      expect(interpreterNameOf(name), name).toBeNull();
    }
  });
});

describe('shell-command-words : découpage en commandes simples', () => {
  it('juge chaque position de commande, quel que soit le séparateur', () => {
    const c = '$c';
    for (const body of [
      `${c} x`, `echo a; ${c}`, `a && ${c}`, `a || ${c}`, `a | ${c}`, `a & ${c}`, `a\n${c}`, `a \\\n; ${c}`,
      `x=$(${c} a)`, `echo \`${c} a\``, `echo "$(${c} a)"`, `echo \${y:-$(${c})}`, `( ${c} )`, `{ ${c}; }`, `a=1 ${c}`,
      `if ${c}; then :; fi`, `while ${c}; do :; done`, `for i in 1; do ${c}; done`, `case $x in a) ${c};; esac`,
      `f() { ${c}; }`, `function g { ${c}; }`, `cat <<EOF\n$(${c})\nEOF`, `[[ -f x ]] && ${c}`, `! ${c}`,
      `x=(a $(${c}))`, `diff <(${c} a) b`, `echo $(( $(${c}) + 1 ))`,
    ]) {
      expect(kinds(body), body).toContain('non-literal-command-word');
    }
  });

  it('suit les enveloppes : sudo, env, xargs, command, eval, find -exec…', () => {
    for (const body of [
      'sudo $c x', 'sudo -u root $c x', 'env A=1 $c', 'env -u A $c', 'xargs -I{} $c {}', 'command $c', 'builtin $c', 'exec $c',
      'time $c', 'nohup $c &', 'timeout 5 $c', 'nice -n 5 $c', 'find . -exec $c {} \x5c;', 'find . -name x -exec echo {} \x5c; -exec $c {} \x5c;',
      'eval "$c"', 'eval $c', 'eval ba"$x"sh', "trap '$c' EXIT", 'sudo env A=1 nohup $c',
    ]) {
      expect(kinds(body), body).toContain('non-literal-command-word');
    }
  });

  it('ne juge pas les arguments : seul le mot de commande compte', () => {
    for (const body of [
      'echo "$HOME"', 'ls -la "$dir"', 'grep -r "x" .', 'cd "$(dirname "$0")"', 'cp "$a" "$b"', 'rm -rf "${TMPDIR:?}/x"',
      'sudo -u "$user" cp "$a" "$b"', 'env A="$x" make', 'xargs -I{} cp {} "$d"', 'find . -name "*.sh" -exec rm {} \x5c;',
      'echo $((1+2))', 'echo $(( $(date +%s) - 5 ))', 'x=$(date); echo "$x"', 'export PATH="$HOME/bin:$PATH"',
      'trap \'rm -rf "$tmp"\' EXIT', 'trap "rm -f $f" EXIT', 'eval echo "$x"', 'FOO="$BAR" BAZ=$(date) make',
      'if [ -f "$f" ]; then echo ok; fi', 'if [[ "$x" =~ ^(a|b)$ ]]; then echo ok; fi', 'while read -r l; do echo "$l"; done < f',
      'case "$1" in\n  a|b) echo "$1";;\n  *) exit 1;;\nesac', 'for ((i=0;i<3;i++)); do echo $i; done', 'for f in "$d"/*; do echo "$f"; done',
      '(cd "$d" && make)', 'f() { echo hi; }\nf', 'function g { echo hi; }\ng', 'arr=(a "b c" $d)\necho "${arr[@]}"',
      'readonly O=(--fail --silent)', 'declare -a x=(1 2)', 'echo a>b 2>&1; ls &>/dev/null', 'exec > >(tee log) 2>&1',
      'cat <<\'EOF\'\n$c\nEOF\necho done', 'cat <<-EOF\n\thello $USER\n\tEOF', 'git commit -m "x" && git push', '~/bin/tool --x',
      'if ! command -v git >/dev/null; then exit 1; fi', 'python3 x.py "$@"', 'node x.js "$@"', 'python3 -m pytest -x tests', 'python3 --version', 'echo bash', 'command -v bash', 'which sh', 'grep -r bash .', 'apt-get install -y bash', 'cp "$a" "$b"', 'git commit -m "fix"', 'chmod +x scripts/run.sh', '# $c\necho ok', 'echo # $c',
    ]) {
      expect(analyzeShellCommandWords(body), body).toEqual([]);
    }
  });

  it('un interpréteur littéral est un finding, quelle que soit sa place', () => {
    for (const body of [
      'bash x', '/bin/bash x', 'a | sh', 'a && zsh -c x', 'sudo bash x', 'sudo -u root bash x', 'env A=1 dash x', 'xargs ksh',
      'find . -exec bash {} \x5c;', 'if bash x; then :; fi', 'x=$(bash y)', 'timeout 5 sh x', 'nohup fish &', 'eval bash',
      "trap 'bash x' EXIT", 'powershell.exe -c x', 'source ../payload.txt', '. ../payload.txt', 'source "$f"',
    ]) {
      expect(kinds(body), body).toContain('interpreter-command-word');
    }
  });

  it('traite source et . comme bash : toute cible, suffixe .sh compris', () => {
    for (const body of ['. "$(dirname "$0")/lib/common.sh"', 'source ./env.bash', 'source "$REMOTE/x.sh"', '. ./x.sh', 'sudo source x', 'if . x; then :; fi']) {
      expect(kinds(body), body).toContain('interpreter-command-word');
    }
    expect(analyzeShellCommandWords('echo "source $x" . y')).toEqual([]);
  });

  it('refuse (échec fermé) tout texte qu\'il ne sait pas découper', () => {
    for (const body of ["echo 'x", 'echo "x', 'echo `x', 'echo $(x', 'echo ${x', 'echo x)', 'a ( b', 'cat <<', 'echo x;;', '[[ -f x', 'echo $(( 1 + 2', "echo $'x"]) {
      expect(kinds(body), body).toContain('unparseable-shell');
    }
  });

  it('numérote les lignes depuis baseLine, continuations comprises', () => {
    const found = analyzeShellCommandWords('echo a \\\n  b\necho c\n$x y', 10);
    expect(found).toEqual([{ kind: 'non-literal-command-word', line: 13, word: '$x' }]);
    expect(words('a\\\nb x')).toEqual([]);
  });

  it('suit aussi les lanceurs de commandes moins courants', () => {
    for (const body of ['strace -f $c', 'nsenter -t 1 $c', 'unshare $c', 'systemd-run -u x $c', 'faketime 2020 $c', 'fakeroot $c', 'rlwrap $c', 'bwrap $c']) {
      expect(kinds(body), body).toContain('non-literal-command-word');
    }
  });

  it('échoue fermé sur une imbrication démesurée ou un travail quadratique', () => {
    expect(kinds('echo ' + '$('.repeat(500) + 'x' + ')'.repeat(500))).toContain('unparseable-shell');
    const started = Date.now();
    expect(kinds('echo ' + '$(('.repeat(20000))).toContain('unparseable-shell');
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
