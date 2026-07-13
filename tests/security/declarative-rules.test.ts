import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  checkDeclarativePermission,
  clearPermissionsCache,
  explainDeclarativePermissionFromPermissions,
  type DeclarativePermissions,
} from '../../src/security/declarative-rules.js';

function decide(command: string, permissions: DeclarativePermissions) {
  return explainDeclarativePermissionFromPermissions(
    'Bash',
    { command },
    permissions,
    '/workspace'
  );
}

describe('declarative permission rules', () => {
  afterEach(() => {
    clearPermissionsCache();
  });

  describe('compound Bash commands', () => {
    it('requires every command in a chain to be explicitly allowed', () => {
      const permissions = { allow: ['Bash(git status*)'] };

      expect(decide('git status && printf safe', permissions).decision).toBe('ask');
      expect(decide('git status || printf safe', permissions).decision).toBe('ask');
      expect(decide('git status; printf safe', permissions).decision).toBe('ask');
      expect(decide('git status\nprintf safe', permissions).decision).toBe('ask');
    });

    it('allows a chain when every command has a matching allow rule', () => {
      const permissions = {
        allow: ['Bash(git status*)', 'Bash(printf safe)'],
      };

      expect(decide('git status && printf safe', permissions).decision).toBe('allow');
    });

    it('does not let a pipe inherit the permission of its first command', () => {
      const permissions = { allow: ['Bash(git status*)'] };

      expect(decide('git status | bash', permissions).decision).toBe('ask');
    });

    it('does not split control-operator text inside quotes', () => {
      const permissions = { allow: ['Bash(echo *)'] };

      expect(decide('echo "safe | still text && no command"', permissions).decision).toBe('allow');
    });
  });

  describe('shell substitutions', () => {
    it.each(['echo $(printf injected)', 'echo `printf injected`', 'cat <(printf injected)'])(
      'never auto-allows executable substitution: %s',
      (command) => {
        expect(decide(command, { allow: ['Bash(*)'] }).decision).toBe('ask');
      }
    );

    it('keeps substitution-looking text literal inside single quotes', () => {
      expect(decide("echo '$(printf literal)'", { allow: ['Bash(echo *)'] }).decision).toBe(
        'allow'
      );
    });

    it('applies deny rules to commands nested in substitutions', () => {
      const result = decide('echo $(rm -rf /tmp/codebuddy-sentinel)', {
        allow: ['Bash(*)'],
        deny: ['Bash(rm *)'],
      });

      expect(result).toEqual({ decision: 'deny', matchedRule: 'Bash(rm *)' });
    });
  });

  describe('strict deny precedence', () => {
    it('denies the whole chain when any segment matches a deny rule', () => {
      const result = decide('echo safe | rm -rf /tmp/codebuddy-sentinel', {
        allow: ['Bash(*)'],
        deny: ['Bash(rm *)'],
      });

      expect(result).toEqual({ decision: 'deny', matchedRule: 'Bash(rm *)' });
    });

    it('checks deny rules against the raw command before splitting it', () => {
      const result = decide('git status && echo safe', {
        allow: ['Bash(git status)', 'Bash(echo safe)'],
        deny: ['Bash(git status && *)'],
      });

      expect(result).toEqual({ decision: 'deny', matchedRule: 'Bash(git status && *)' });
    });
  });

  it('resolves project-relative path rules against the supplied project root', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'codebuddy-declarative-rules-'));
    const settingsDir = join(projectRoot, '.codebuddy');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({
        permissions: {
          allow: ['Read(/src/**)'],
          deny: ['Read(/src/private/**)'],
        },
      })
    );

    try {
      expect(
        checkDeclarativePermission(
          'Read',
          { file_path: join(projectRoot, 'src', 'index.ts') },
          projectRoot
        )
      ).toBe('allow');
      expect(
        checkDeclarativePermission(
          'Read',
          { file_path: join(projectRoot, 'src', 'private', 'secret.ts') },
          projectRoot
        )
      ).toBe('deny');
      expect(
        checkDeclarativePermission(
          'Read',
          { file_path: join(projectRoot, 'outside.ts') },
          projectRoot
        )
      ).toBe('ask');
    } finally {
      clearPermissionsCache();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
