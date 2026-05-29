/**
 * Tests for Confirmation Service
 */

import {
  ConfirmationService,
} from '../../src/utils/confirmation-service.js';

describe('ConfirmationService', () => {
  let service: ConfirmationService;

  beforeEach(() => {
    // Reset the singleton
    (ConfirmationService as unknown as { instance: ConfirmationService | undefined }).instance = undefined;
    service = ConfirmationService.getInstance();
    delete process.env.CODEBUDDY_AUTO_CONFIRM;
    delete process.env.CODEBUDDY_SELF_IMPROVEMENT;
  });

  afterEach(() => {
    if (service) {
      service.dispose();
    }
    (ConfirmationService as unknown as { instance: ConfirmationService | undefined }).instance = undefined;
    delete process.env.CODEBUDDY_AUTO_CONFIRM;
    delete process.env.CODEBUDDY_SELF_IMPROVEMENT;
  });

  describe('Singleton Pattern', () => {
    it('should return same instance', () => {
      const instance1 = ConfirmationService.getInstance();
      const instance2 = ConfirmationService.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe('Dry-Run Mode', () => {
    it('should be disabled by default', () => {
      expect(service.isDryRunMode()).toBe(false);
    });

    it('should enable dry-run mode', () => {
      service.setDryRunMode(true);
      expect(service.isDryRunMode()).toBe(true);
    });

    it('should disable dry-run mode', () => {
      service.setDryRunMode(true);
      expect(service.isDryRunMode()).toBe(true);

      service.setDryRunMode(false);
      expect(service.isDryRunMode()).toBe(false);
    });

    it('should return empty log initially', () => {
      const log = service.getDryRunLog();
      expect(Array.isArray(log)).toBe(true);
      expect(log.length).toBe(0);
    });

    it('should clear dry-run log', () => {
      service.setDryRunMode(true);
      service.clearDryRunLog();
      expect(service.getDryRunLog().length).toBe(0);
    });

    it('should format dry-run log', () => {
      const formatted = service.formatDryRunLog();
      expect(typeof formatted).toBe('string');
    });
  });

  describe('Pending State', () => {
    it('should not be pending initially', () => {
      expect(service.isPending()).toBe(false);
    });
  });

  describe('Session Management', () => {
    it('should reset session', () => {
      service.resetSession();
      // Should not throw
      expect(true).toBe(true);
    });

    it('should get session flags', () => {
      const flags = service.getSessionFlags();
      expect(flags).toBeDefined();
      expect(typeof flags.fileOperations).toBe('boolean');
      expect(typeof flags.bashCommands).toBe('boolean');
      expect(typeof flags.allOperations).toBe('boolean');
    });

    it('should set session flags', () => {
      service.setSessionFlag('fileOperations', true);
      const flags = service.getSessionFlags();
      expect(flags.fileOperations).toBe(true);
    });

    it('should set all operations flag', () => {
      service.setSessionFlag('allOperations', true);
      const flags = service.getSessionFlags();
      expect(flags.allOperations).toBe(true);
    });

    it('should set bash commands flag', () => {
      service.setSessionFlag('bashCommands', true);
      const flags = service.getSessionFlags();
      expect(flags.bashCommands).toBe(true);
    });
  });

  describe('Confirmation Response', () => {
    it('should confirm operation', () => {
      // When there's no pending confirmation, this should not throw
      service.confirmOperation(true);
      expect(true).toBe(true);
    });

    it('should confirm with dont ask again', () => {
      service.confirmOperation(true, true);
      expect(true).toBe(true);
    });

    it('should reject operation', () => {
      service.rejectOperation();
      expect(true).toBe(true);
    });

    it('should reject operation with feedback', () => {
      service.rejectOperation('Test feedback');
      expect(true).toBe(true);
    });
  });

  describe('Dispose', () => {
    it('should dispose without errors', () => {
      service.dispose();
      expect(true).toBe(true);
    });
  });

  describe('Event Emitter', () => {
    it('should be an event emitter', () => {
      expect(typeof service.on).toBe('function');
      expect(typeof service.emit).toBe('function');
    });
  });

  describe('PolicyEngine Integration', () => {
    afterEach(async () => {
      const { PolicyEngine } = await import('../../src/security/policy-engine.js');
      PolicyEngine.getInstance().releaseKillSwitch();
    });

    it('should auto-approve allowed operations (e.g. low risk fs:write:scoped)', async () => {
      const result = await service.requestConfirmation({
        operation: 'write_file',
        filename: 'somefile.txt',
        riskLevel: 'low' as any,
      }, 'file');
      expect(result.confirmed).toBe(true);
    });

    it('should deny denied operations (e.g. when kill switch is engaged)', async () => {
      const { PolicyEngine } = await import('../../src/security/policy-engine.js');
      PolicyEngine.getInstance().engageKillSwitch('Emergency');

      const result = await service.requestConfirmation({
        operation: 'write_file',
        filename: 'somefile.txt',
        riskLevel: 'low' as any,
      }, 'file');
      expect(result.confirmed).toBe(false);
      expect(result.feedback).toContain('Kill switch engaged');
    });

    it('should not let auto-confirm bypass self-improvement approval', async () => {
      process.env.CODEBUDDY_AUTO_CONFIRM = 'true';

      const pending = service.requestConfirmation({
        operation: 'self_improvement',
        filename: 'D:/CascadeProjects/grok-cli-weekend',
        riskLevel: 'high' as any,
      }, 'file');

      await new Promise((resolve) => setImmediate(resolve));
      expect(service.isPending()).toBe(true);

      service.rejectOperation('manual approval required');
      const result = await pending;

      expect(result.confirmed).toBe(false);
      expect(result.feedback).toBe('manual approval required');
    });

    it('should not let AUTO_CONFIRM or policy-allow bypass a restrictive permission mode (plan)', async () => {
      // Regression for the 0.2 hardening: shell:safe always evaluates to `allow`,
      // and CODEBUDDY_AUTO_CONFIRM short-circuits, so without the early permission-mode
      // deny check these would silently override `plan` mode (which blocks writes/bash).
      const { getPermissionModeManager, resetPermissionModeManager } = await import('../../src/security/permission-modes.js');
      getPermissionModeManager().setMode('plan');
      process.env.CODEBUDDY_AUTO_CONFIRM = 'true';
      try {
        const writeResult = await service.requestConfirmation({
          operation: 'write_file',
          filename: 'somefile.txt',
          riskLevel: 'low' as any,
        }, 'file');
        expect(writeResult.confirmed).toBe(false);
        expect(writeResult.feedback).toContain('plan mode');

        const bashResult = await service.requestConfirmation({
          operation: 'run_command',
          filename: 'echo hello',
          riskLevel: 'low' as any,
        }, 'bash');
        expect(bashResult.confirmed).toBe(false);
      } finally {
        resetPermissionModeManager();
      }
    });
  });
});
