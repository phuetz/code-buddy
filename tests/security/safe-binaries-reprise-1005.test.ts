import { describe, expect, it } from 'vitest';
import { SafeBinariesChecker } from '../../src/security/safe-binaries.js';

/** Reprise CB-PERMISSIONS-MATRICE : le mode plan reste en lecture seule. */
describe('SAFE_BINARIES étendu : aucun binaire capable d\'exécuter ou d\'écrire', () => {
  const c = new SafeBinariesChecker();
  it.each([
    'awk \'BEGIN{system("touch /tmp/PWNED")}\'',
    'awk \'BEGIN{"id" | getline x; print x}\'',
    'man -P "sh -c id" ls',
    'less /etc/hosts',
    'more /etc/hosts',
    'iconv -f utf8 -t latin1 -o out.txt in.txt',
    'xxd in.bin out.hex',
    'ptx in.txt out.txt',
  ])('%s n\'est pas sûr', (cmd) => {
    // ÉCHOUE sur l'ancienne extension : awk, man, less étaient « sûrs ».
    expect(c.isSafe(cmd)).toBe(false);
  });
  it.each(['jq . package.json', 'ps aux', 'lsof -i', 'xxd in.bin', 'iconv -f utf8 -t latin1 in.txt', 'python3 --version', 'strings a.out', 'tree -L 2'])(
    '%s reste sûr',
    (cmd) => {
      expect(c.isSafe(cmd)).toBe(true);
    },
  );
});

describe('reprise 2 : contournements par citation et écritures classées sûres', () => {
  const c = new SafeBinariesChecker();
  it.each([
    "sort $'-o' /tmp/x /etc/hostname",
    "find . $'-exec' /bin/touch {} ;",
    "base64 $'-o' /tmp/x /etc/hostname",
    'sort -\\o /tmp/x /etc/hostname',
    "iconv $'-o' /tmp/x -f utf-8 -t utf-8 /etc/hostname",
    'go env -w GOPROXY=https://evil',
    'go env -u GOPROXY',
    'tree -o /tmp/out.txt',
    'history -w /tmp/h',
  ])('%s n\'est pas sûr', (cmd) => {
    // ÉCHOUE sur l'ancienne logique : ces formes étaient classées sûres (écriture / exécution en mode plan).
    expect(c.isSafe(cmd)).toBe(false);
  });
  it.each(['go env GOPATH', 'go env', "grep 'a\\|b' file.txt", 'sort file.txt', 'find . -name "*.ts"', 'tree -L 2', 'history', 'history 20', 'ls -la'])(
    '%s reste sûr',
    (cmd) => {
      expect(c.isSafe(cmd)).toBe(true);
    },
  );
});

describe('reprise 3 : abréviation, bundling, accolades, variables', () => {
  const c = new SafeBinariesChecker();
  it.each([
    'sort --out=/tmp/x /etc/hostname',
    'sort --o /tmp/x /etc/hostname',
    'iconv --out=/tmp/x -f utf-8 -t utf-8 /etc/hostname',
    'sort -bo /tmp/x /etc/hostname',
    'sort -{,o} /tmp/x /etc/hostname',
    'printf -v x o; sort -$x /tmp/x /etc/hostname',
    'sort -${x} /tmp/x /etc/hostname',
    'sort --compress-prog=/bin/sh /etc/hostname',
  ])('%s n\'est pas sûr', (cmd) => {
    // ÉCHOUE sur l'ancienne logique : classés sûrs alors que bash/getopt écrit ou exécute.
    expect(c.isSafeChain(cmd)).toBe(false);
  });
  it.each(['sort -k1,1 /etc/hostname', 'sort -n -r file.txt', 'sort file.txt', 'iconv -f utf-8 -t latin1 file.txt', 'find . -name "*.ts"', "grep 'a\\|b' f", 'cat "$HOME_UNSET"x'.replace('"$HOME_UNSET"x', 'file.txt')])(
    '%s reste sûr',
    (cmd) => {
      expect(c.isSafeChain(cmd)).toBe(true);
    },
  );
});
