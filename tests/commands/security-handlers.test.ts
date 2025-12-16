/**
 * Tests for Security Command Handlers
 */

import {
  handleSecurity,
  handleDryRun,
  handleGuardian,
  handleSecurityReview,
  CommandHandlerResult,
} from '../../src/commands/handlers/security-handlers.js';
import { resetSecurityManager } from '../../src/security/index.js';

describe('Security Handlers', () => {
  beforeEach(() => {
    resetSecurityManager();
  });

  describe('handleSecurity', () => {
    it('should return status by default', () => {
      const result = handleSecurity([]);

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry?.content).toContain('Security');
    });

    it('should show status with explicit action', () => {
      const result = handleSecurity(['status']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toBeDefined();
    });

    it('should set approval mode to read-only', () => {
      const result = handleSecurity(['mode', 'read-only']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content?.toUpperCase()).toContain('READ-ONLY');
      expect(result.entry?.content?.toLowerCase()).toContain('security mode set');
    });

    it('should set approval mode to auto', () => {
      const result = handleSecurity(['mode', 'auto']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content?.toUpperCase()).toContain('AUTO');
    });

    it('should set approval mode to full-access', () => {
      const result = handleSecurity(['mode', 'full-access']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content?.toUpperCase()).toContain('FULL-ACCESS');
    });

    it('should show usage for invalid mode', () => {
      const result = handleSecurity(['mode', 'invalid']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Usage:');
      expect(result.entry?.content).toContain('read-only');
      expect(result.entry?.content).toContain('auto');
      expect(result.entry?.content).toContain('full-access');
    });

    it('should reset security stats', () => {
      const result = handleSecurity(['reset']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('reset');
    });

    it('should show no events when empty', () => {
      const result = handleSecurity(['events']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('No security events');
    });
  });

  describe('handleDryRun', () => {
    it('should enable dry-run mode', () => {
      const result = handleDryRun(['on']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('ENABLED');
      expect(result.entry?.content).toContain('Dry-Run');
    });

    it('should disable dry-run mode', () => {
      // First enable
      handleDryRun(['on']);

      // Then disable
      const result = handleDryRun(['off']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('DISABLED');
    });

    it('should show dry-run log', () => {
      handleDryRun(['on']);
      const result = handleDryRun(['log']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toBeDefined();
    });

    it('should show status by default', () => {
      const result = handleDryRun([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Dry-Run');
    });
  });

  describe('handleGuardian', () => {
    it('should return guardian status by default', async () => {
      const result = await handleGuardian([]);

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
    });

    it('should enable guardian with mode', async () => {
      const result = await handleGuardian(['enable', 'strict']);

      expect(result.handled).toBe(true);
    });

    it('should disable guardian', async () => {
      const result = await handleGuardian(['disable']);

      expect(result.handled).toBe(true);
    });

    it('should show guardian stats', async () => {
      const result = await handleGuardian(['stats']);

      expect(result.handled).toBe(true);
    });

    it('should reset guardian stats', async () => {
      const result = await handleGuardian(['reset']);

      expect(result.handled).toBe(true);
    });

    it('should show guardian rules', async () => {
      const result = await handleGuardian(['rules']);

      expect(result.handled).toBe(true);
    });
  });

  describe('handleSecurityReview', () => {
    it('should require a path', async () => {
      const result = await handleSecurityReview([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Usage');
    });

    it('should accept a path argument', async () => {
      const result = await handleSecurityReview(['src/']);

      expect(result.handled).toBe(true);
      // Should either start scanning or return an error
      expect(result.entry).toBeDefined();
    });

    it('should accept quick option', async () => {
      const result = await handleSecurityReview(['src/', '--quick']);

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
    });

    it('should accept format option', async () => {
      const result = await handleSecurityReview(['src/', '--format', 'json']);

      expect(result.handled).toBe(true);
    });
  });
});

describe('CommandHandlerResult', () => {
  it('should have correct structure', () => {
    const result: CommandHandlerResult = {
      handled: true,
      entry: {
        type: 'assistant',
        content: 'test',
        timestamp: new Date(),
      },
      passToAI: false,
      prompt: undefined,
    };

    expect(result.handled).toBe(true);
    expect(result.entry?.type).toBe('assistant');
    expect(result.passToAI).toBe(false);
  });
});
