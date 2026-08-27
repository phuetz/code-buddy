/**
 * Alignement prompt/exécution — volet outil.
 *
 * Depuis la centralisation du shell (getShellConfiguration), l'hôte Windows
 * exécute PowerShell alors que la description du tool `bash` continuait
 * d'annoncer « Execute a bash command » : le modèle choisissait sa syntaxe
 * sur un texte faux. La description doit être dérivée de la configuration
 * réellement exécutée (pattern gemini-cli), et rester identique à l'octet
 * sur un hôte POSIX.
 */
import { describe, expect, it } from 'vitest';
import {
  getShellCommandParamDescription,
  getShellToolDescription,
  type ShellConfiguration,
} from '../../src/utils/shell-configuration.js';
import { BASH_TOOL } from '../../src/codebuddy/tool-definitions/core-tools.js';

const bashConfiguration: ShellConfiguration = {
  executable: 'bash',
  argsPrefix: ['-c'],
  shell: 'bash',
};

const powershellConfiguration: ShellConfiguration = {
  executable: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  argsPrefix: ['-NoProfile', '-NonInteractive', '-Command'],
  shell: 'powershell',
};

describe('getShellToolDescription', () => {
  it('garde le texte bash historique identique à l’octet sur un hôte POSIX', () => {
    expect(getShellToolDescription(bashConfiguration)).toBe(
      'Execute a bash command. Prefer it to check facts and state you can verify (git status, test output, file existence, exit codes) rather than assuming.',
    );
  });

  it('nomme PowerShell et l’invocation réelle sur un hôte PowerShell', () => {
    const description = getShellToolDescription(powershellConfiguration);
    expect(description).toContain('PowerShell');
    expect(description).toContain('pwsh.exe -NoProfile -NonInteractive -Command <command>');
    expect(description).not.toContain('Execute a bash command');
  });

  it('avertit explicitement que la syntaxe POSIX bash ne s’applique pas sous PowerShell', () => {
    expect(getShellToolDescription(powershellConfiguration)).toMatch(/not POSIX bash/);
  });

  it('réduit l’exécutable à son nom de base même donné en chemin Windows complet', () => {
    const description = getShellToolDescription(powershellConfiguration);
    expect(description).not.toContain('Program Files');
  });
});

describe('getShellCommandParamDescription', () => {
  it('garde le texte bash historique identique à l’octet sur un hôte POSIX', () => {
    expect(getShellCommandParamDescription(bashConfiguration)).toBe('The bash command to execute');
  });

  it('nomme PowerShell sur un hôte PowerShell', () => {
    expect(getShellCommandParamDescription(powershellConfiguration)).toBe(
      'The PowerShell command to execute',
    );
  });
});

describe('BASH_TOOL — câblage réel', () => {
  it('la description vue par le modèle vient du builder, pour l’hôte courant', () => {
    expect(BASH_TOOL.function.description).toBe(getShellToolDescription());
  });

  it('la description du paramètre command vient du builder, pour l’hôte courant', () => {
    const properties = BASH_TOOL.function.parameters['properties'] as Record<
      string,
      { description?: string }
    >;
    expect(properties['command']?.description).toBe(getShellCommandParamDescription());
  });
});
