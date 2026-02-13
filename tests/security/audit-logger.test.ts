import { auditLogger } from '../../src/security/audit-logger.js';

describe('Audit Logger', () => {
  beforeEach(() => {
    auditLogger.clear();
  });

  it('should log entries', () => {
    auditLogger.log({
      action: 'code_validation',
      decision: 'allow',
      source: 'test',
      target: 'test.ts',
    });
    expect(auditLogger.getEntries().length).toBe(1);
  });

  it('should log code validation', () => {
    auditLogger.logCodeValidation({
      target: 'test.ts',
      safe: true,
      findingsCount: 0,
    });
    const entries = auditLogger.getEntriesByAction('code_validation');
    expect(entries.length).toBe(1);
    expect(entries[0].decision).toBe('allow');
  });

  it('should log command validation', () => {
    auditLogger.logCommandValidation({
      command: 'ls -la',
      valid: true,
    });
    const entries = auditLogger.getEntriesByAction('command_validation');
    expect(entries.length).toBe(1);
  });

  it('should log blocked commands', () => {
    auditLogger.logCommandValidation({
      command: 'rm -rf /',
      valid: false,
      reason: 'Dangerous command',
    });
    const entries = auditLogger.getEntries();
    expect(entries[0].decision).toBe('block');
  });

  it('should generate summary', () => {
    auditLogger.log({ action: 'code_validation', decision: 'allow', source: 'test' });
    auditLogger.log({ action: 'command_validation', decision: 'block', source: 'test' });
    auditLogger.log({ action: 'file_write', decision: 'warn', source: 'test' });

    const summary = auditLogger.getSummary();
    expect(summary.total).toBe(3);
    expect(summary.blocked).toBe(1);
    expect(summary.warnings).toBe(1);
  });

  it('should format summary as text', () => {
    auditLogger.log({ action: 'code_validation', decision: 'allow', source: 'test' });
    const text = auditLogger.formatSummary();
    expect(text).toContain('Audit Log Summary');
    expect(text).toContain('1 entries');
  });

  it('should enforce max entries limit', () => {
    auditLogger.init({ maxEntries: 10 });
    for (let i = 0; i < 20; i++) {
      auditLogger.log({ action: 'code_validation', decision: 'allow', source: 'test' });
    }
    expect(auditLogger.getEntries().length).toBeLessThanOrEqual(20);
  });

  it('should log confirmation events', () => {
    auditLogger.logConfirmation({
      operation: 'file_write',
      target: 'test.ts',
      granted: true,
    });
    const entries = auditLogger.getEntriesByAction('confirmation_granted');
    expect(entries.length).toBe(1);
  });

  it('should clear entries', () => {
    auditLogger.log({ action: 'code_validation', decision: 'allow', source: 'test' });
    auditLogger.clear();
    expect(auditLogger.getEntries().length).toBe(0);
  });
});
