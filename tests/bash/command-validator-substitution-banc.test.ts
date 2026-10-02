import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import * as parser from '../../src/security/bash-parser.js';
import { hasShellBypassFeatures, validateCommand } from '../../src/tools/bash/command-validator.js';

beforeAll(async () => { parser.parseBashCommand(':'); await new Promise(resolve => setTimeout(resolve, 100)); });
afterEach(() => vi.restoreAllMocks());

it('ne confond pas la fonction fléchée de l’audit B avec une substitution de processus', context => {
  if (!parser.parseBashCommand(':').usedTreeSitter) context.skip();
  const command = `npm audit --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(Object.entries(j.vulnerabilities||{}).map(([n,x])=>({n,sev:x.severity})));})'`;
  expect(validateCommand(command)).toMatchObject({ valid: true });
});

it.each([
  'cat <(printf data)',
  'printf data > >(cat)',
  'echo "$(cat <(printf data))"',
  'cat <(printf data',
])('refuse la vraie substitution, y compris imbriquée ou incomplète : %s', command => {
  expect(hasShellBypassFeatures(command)).toMatchObject({ bypass: true, reason: 'Process substitution detected' });
});

it('garde le repli conservateur sans preuve du parseur natif', () => {
  vi.spyOn(parser, 'parseBashCommand').mockReturnValue({ commands: [], usedTreeSitter: false, warnings: [] });
  expect(hasShellBypassFeatures(`node -e 'console.log([1].map(x=>({x})))'`).bypass).toBe(true);
});
