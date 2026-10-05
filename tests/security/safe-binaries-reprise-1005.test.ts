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
