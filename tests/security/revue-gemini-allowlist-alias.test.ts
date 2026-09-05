import { describe, expect, it } from 'vitest';
import {
  explainDeclarativePermissionFromPermissions,
  type DeclarativePermissions,
} from '../../src/security/declarative-rules.js';
import { PermissionModeManager } from '../../src/security/permission-modes.js';

describe('Revue G6 - Trou 3 : Allowlist et règles déclaratives contournées par alias de commande (terminal)', () => {
  it('doit appliquer la règle deny Bash(*) lorsque le tool invoqué est l’alias terminal', () => {
    const permissions: DeclarativePermissions = {
      deny: ['Bash(*)'],
    };

    // Vérification sur le nom canonique Bash
    const bashResult = explainDeclarativePermissionFromPermissions(
      'Bash',
      { command: 'rm -rf /' },
      permissions,
      '/workspace',
    );
    expect(bashResult.decision).toBe('deny');

    // VULNÉRABILITÉ : ALIAS_LOOKUP dans declarative-rules.ts ne contient que ['shell_exec', 'bash'].
    // L'alias standard "terminal" (défini dans tool-alias-map.ts) n'est pas reconnu comme alias de Bash.
    // L'attaquant contourne la règle d'interdiction deny: ['Bash(*)'] en invoquant 'terminal' !
    const terminalResult = explainDeclarativePermissionFromPermissions(
      'terminal',
      { command: 'rm -rf /' },
      permissions,
      '/workspace',
    );
    expect(terminalResult.decision).toBe('deny');
  });

  it('doit considérer l’alias terminal comme outil destructeur dans PermissionModeManager', () => {
    const manager = new PermissionModeManager({ mode: 'dontAsk' });

    // Le tool canonique bash exige une confirmation humaine (prompted: true)
    const bashDecision = manager.checkPermission('execute', 'bash');
    expect(manager.isDestructiveTool('bash')).toBe(true);
    expect(bashDecision.prompted).toBe(true);

    // VULNÉRABILITÉ : DESTRUCTIVE_TOOLS dans permission-modes.ts omet l'alias 'terminal' et 'shell_exec'.
    // En mode dontAsk, l'exécution via 'terminal' est auto-approuvée sans aucune confirmation !
    expect(manager.isDestructiveTool('terminal')).toBe(true);
    const terminalDecision = manager.checkPermission('execute', 'terminal');
    expect(terminalDecision.prompted).toBe(true);
  });
});
