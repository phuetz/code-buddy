import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import {
  getPermissionModeManager,
  resetPermissionModeManager,
} from '../../src/security/permission-modes.js';

// Real permission and policy paths; stdin is explicitly absent, as in Colab.
describe('dontAsk without a terminal and without AUTO_CONFIRM', () => {
  let service: ConfirmationService;
  const tty = process.stdin.isTTY;
  beforeEach(() => {
    resetPermissionModeManager();
    getPermissionModeManager().setMode('dontAsk');
    vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'false');
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    service = ConfirmationService.getInstance();
    service.resetSession();
  });
  afterEach(() => {
    service.dispose();
    resetPermissionModeManager();
    vi.unstubAllEnvs();
    Object.defineProperty(process.stdin, 'isTTY', { value: tty, configurable: true });
  });
  it.each(['ls .', 'pwd', 'echo hello'])(
    'approves a proven read-only expression: %s',
    async (command) => {
      const result = await service.requestConfirmation(
        {
          operation: 'Run command outside the workspace sandbox',
          filename: command,
          riskLevel: 'high',
          approvalKey: 'isolated-test',
        },
        'bash'
      );
      expect(result.confirmed).toBe(true);
    }
  );
  it.each(['rm local.txt', 'ls . && rm local.txt', 'find . -exec sh -c "echo unsafe" \\;'])(
    'still refuses destructive or ambiguous expressions: %s',
    async (command) => {
      expect(
        (
          await service.requestConfirmation(
            {
              operation: 'Run command outside the workspace sandbox',
              filename: command,
              riskLevel: 'high',
              approvalKey: 'isolated-test',
            },
            'bash'
          )
        ).confirmed
      ).toBe(false);
    }
  );
  it('retains explicit escalation confirmation even for a read-only expression', async () => {
    expect(
      (
        await service.requestConfirmation(
          { operation: 'Run', filename: 'ls .', riskLevel: 'high', forcePrompt: true },
          'bash'
        )
      ).confirmed
    ).toBe(false);
  });
});
