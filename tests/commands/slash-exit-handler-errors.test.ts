/**
 * Exceptions de /lint et /secrets-scan : le drapeau failed manquait.
 * Les modules lourds sont bouchonnés : aucun linter ni parcours disque.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/tools/lint-runner.js', () => ({
  createLintRunner: vi.fn(),
  formatLintResults: vi.fn(() => 'lint-rendered'),
  formatDetectedLinters: vi.fn(() => 'detected'),
}));

vi.mock('../../src/security/secrets-detector.js', () => ({
  scanForSecrets: vi.fn(),
  formatFindings: vi.fn(() => 'findings'),
}));

import { EnhancedCommandHandler } from '../../src/commands/enhanced-command-handler.js';
import { scanForSecrets } from '../../src/security/secrets-detector.js';
import { createLintRunner } from '../../src/tools/lint-runner.js';

describe('échecs /lint et /secrets-scan', () => {
  beforeEach(() => {
    vi.mocked(createLintRunner).mockReset();
    vi.mocked(scanForSecrets).mockReset();
  });

  it('/lint : une exception pose failed', async () => {
    vi.mocked(createLintRunner).mockImplementation(() => {
      throw new Error('lint-boom');
    });
    const handler = new EnhancedCommandHandler();
    const result = await handler.handleCommand('__LINT__', ['run'], '/lint run');
    const text = result.entry?.content ?? '';
    expect(text, text).toContain('Lint error: lint-boom');
    expect(result.failed, text).toBe(true);
  });

  it('/lint : un linter en échec pose failed', async () => {
    vi.mocked(createLintRunner).mockReturnValue({
      detect: async () => [{ name: 'eslint', available: true }],
      run: async () => ({
        success: false,
        linter: 'eslint',
        duration: 1,
        issueCount: 1,
        issues: [],
      }),
      fix: async () => ({
        success: true,
        linter: 'eslint',
        duration: 1,
        issueCount: 0,
        issues: [],
      }),
    } as never);
    const handler = new EnhancedCommandHandler();
    const result = await handler.handleCommand('__LINT__', ['run'], '/lint run');
    expect(result.failed, result.entry?.content ?? '').toBe(true);
  });

  it('/secrets-scan : une exception pose failed', async () => {
    vi.mocked(scanForSecrets).mockRejectedValue(new Error('scan-boom'));
    const handler = new EnhancedCommandHandler();
    const result = await handler.handleCommand('__SECRETS_SCAN__', [], '/secrets-scan');
    const text = result.entry?.content ?? '';
    expect(text, text).toContain('Secrets scan error: scan-boom');
    expect(result.failed, text).toBe(true);
  });
});
