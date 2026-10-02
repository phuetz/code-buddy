import { describe, expect, it } from 'vitest';
import { validateCommand as validateBash } from '../../src/tools/bash/command-validator.js';
import { validateCommand as validateInput } from '../../src/utils/input-validation/command-validator.js';
import { DANGEROUS_BASH_PATTERNS } from '../../src/security/dangerous-patterns.js';

const validators = [
  { name: 'BashTool', accepts: (command: string) => validateBash(command).valid },
  { name: 'input validation', accepts: (command: string) => validateInput(command).valid },
  { name: 'catalogue des substitutions', accepts: (command: string) => !DANGEROUS_BASH_PATTERNS
    .filter(pattern => pattern.name === 'subst-dangerous' || pattern.name === 'backtick-dangerous')
    .some(pattern => pattern.pattern.test(command)) },
];
const wrap = (body: string, backticks: boolean): string => backticks
  ? 'echo `' + body + '`'
  : 'echo "$(' + body + ')"';

describe.each(validators)('substitutions et identifiants du banc — $name', ({ accepts }) => {
  it.each(['normalizeDialogText', 'addressTable', 'functionName', 'shellIntegration', 'executePlan'])('accepte la lecture de %s sans confondre un fragment avec une commande', (identifier) => {
    for (const backticks of [false, true]) {
      expect(accepts(wrap(`grep -n '${identifier}' src/fixture.ts | cut -d: -f1`, backticks))).toBe(true);
    }
  });

  it.each(['rm', 'dd', 'mkfs', 'chmod', 'chown', 'curl', 'wget', 'nc', 'netcat', 'bash', 'sh', 'eval', 'exec'])('refuse toujours la vraie commande %s en substitution', (binary) => {
    for (const backticks of [false, true]) {
      expect(accepts(wrap(`${binary} argument`, backticks))).toBe(false);
      expect(accepts(wrap(`/usr/bin/${binary} argument`, backticks))).toBe(false);
      expect(accepts(wrap(`'${binary}' argument`, backticks))).toBe(false);
      expect(accepts(wrap(`printf ok; ${binary} argument`, backticks))).toBe(false);
    }
  });

  it('reproduit la lecture sed/grep du banc', () => {
    expect(accepts(`sed -n "$(grep -n 'private normalizeDialogText' src/fixture.ts | cut -d: -f1),+15p" src/fixture.ts`)).toBe(true);
  });
});
