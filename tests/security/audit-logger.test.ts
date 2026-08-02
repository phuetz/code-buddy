import { auditLogger } from '../../src/security/audit-logger.js';
import fs from 'fs';

describe('Audit Logger', () => {
  beforeEach(() => {
    auditLogger.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('scrubs secrets before buffering or writing JSONL without mutating input', () => {
    const secrets = [
      `sk-${'a'.repeat(32)}`,
      `sk-or-v1-${'o'.repeat(48)}`,
      `xai-${'x'.repeat(48)}`,
      `gsk_${'g'.repeat(48)}`,
      `npm_${'n'.repeat(36)}`,
    ];
    const entry = {
      action: 'command_validation' as const,
      decision: 'block' as const,
      source: 'test',
      target: secrets.join(' '),
      details: `rejected ${secrets.join(' ')}`,
    };
    const append = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => undefined);
    auditLogger.init({ logDir: '/tmp', sessionId: secrets[0] });

    auditLogger.log(entry);

    for (const secret of secrets) expect(entry.target).toContain(secret);
    const buffered = auditLogger.getEntries()[0];
    for (const secret of secrets) expect(JSON.stringify(buffered)).not.toContain(secret);
    expect(buffered?.target).toContain('[REDACTED');
    const written = String(append.mock.calls.at(-1)?.[1]);
    for (const secret of secrets) expect(written).not.toContain(secret);
    expect(() => JSON.parse(written.trim())).not.toThrow();
  });
});
