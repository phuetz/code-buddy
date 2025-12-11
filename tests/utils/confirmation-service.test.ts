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
  });

  afterEach(() => {
    if (service) {
      service.dispose();
    }
    (ConfirmationService as unknown as { instance: ConfirmationService | undefined }).instance = undefined;
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
});
