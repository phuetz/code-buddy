import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBashCommand } from '../../src/security/bash-parser.js';
import { evaluateShellExecution } from '../../src/tools/bash/execution-policy.js';
import { getPermissionModeManager } from '../../src/security/permission-modes.js';

afterEach(() => { vi.unstubAllEnvs(); getPermissionModeManager().setMode('default'); });

describe('séquences du shell signalées par la relecture du harnais', () => {
  it.each(['\n', '\r\n'])('sépare les commandes non citées avec %j', (separator) => {
    const parsed = parseBashCommand(`git add package.json${separator}id > smuggled.txt`);
    expect(parsed.commands.map(command => command.command)).toEqual(['git', 'id']);
    expect(parsed.commands[0]?.args).toEqual(['add', 'package.json']);
  });
  it('traite les tabulations non citées comme des séparateurs d’arguments', () => {
    expect(parseBashCommand('git\tadd\tpackage.json').commands[0]).toMatchObject({ command: 'git', args: ['add', 'package.json'] });
  });
  it('conserve les retours cités d’un message de commit', () => {
    expect(parseBashCommand('git commit -m "titre\n\ncorps"').commands).toHaveLength(1);
    expect(parseBashCommand('git commit -m "titre\n\ncorps"').commands[0]?.args.at(-1)).toContain('titre\n\ncorps');
  });

  it('conserve les arguments entre apostrophes après chargement de la grammaire native', async () => {
    parseBashCommand("cd '/workspace'");
    await new Promise(resolve => setTimeout(resolve, 100));
    const parsed = parseBashCommand("cd '/workspace' && git commit '--amend'");
    expect(parsed.commands[0]?.args.map(arg => arg.replace(/^(['"])(.*)\1$/, '$2'))).toEqual(['/workspace']);
    expect(parsed.commands[1]?.args.map(arg => arg.replace(/^(['"])(.*)\1$/, '$2'))).toEqual(['commit', '--amend']);
    vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'git-local');
    getPermissionModeManager().setMode('dontAsk');
    expect((await evaluateShellExecution("git commit '--amend'", process.cwd())).action).not.toBe('sandbox');
  });
  it.each(["'--a'mend", '--a\\mend'])('garde l’option Git citée ou échappée %s', async (argument) => {
    vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'git-local');
    getPermissionModeManager().setMode('dontAsk');
    expect((await evaluateShellExecution(`git commit ${argument}`, process.cwd())).action).not.toBe('sandbox');
  });
  it('ne confère pas git-local à la commande npm suivante', async () => {
    vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'git-local');
    getPermissionModeManager().setMode('dontAsk');
    const decision = await evaluateShellExecution('git add package.json\nnpm publish', process.cwd());
    expect(decision.parsedSegments.map(segment => segment[0])).toEqual(['git', 'npm']);
    expect(decision.action).not.toBe('sandbox');
  });
});
