/**
 * BackupBridge — `.codebuddy/` backups from Cowork through the same core
 * handler as `buddy backup` (create/verify/list/restore + fail-closed
 * validation and clean degradation).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import {
  createBackupForReview,
  listBackupsForReview,
  restoreBackupForReview,
  verifyBackupForReview,
} from '../src/main/tools/backup-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
  resolveCoreEntry: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

function stubHandler() {
  const calls: string[] = [];
  mockedLoadCoreModule.mockImplementation(async (path: string) => {
    if (path !== 'commands/handlers/backup-handlers.js') return null;
    return {
      handleBackup: async (args: string) => {
        calls.push(args);
        return { handled: true, response: `OK: ${args}` };
      },
    };
  });
  return calls;
}

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('backup bridge', () => {
  it('drives create/list/verify/restore through the core handler', async () => {
    const calls = stubHandler();

    expect((await createBackupForReview()).output).toBe('OK: create');
    expect((await createBackupForReview({ onlyConfig: true })).output).toBe('OK: create --only-config');
    expect((await listBackupsForReview()).output).toBe('OK: list');
    expect((await verifyBackupForReview(' /tmp/b.tar.gz ')).output).toBe('OK: verify /tmp/b.tar.gz');
    expect((await restoreBackupForReview('/tmp/b.tar.gz')).output).toBe('OK: restore /tmp/b.tar.gz');

    expect(calls).toEqual([
      'create',
      'create --only-config',
      'list',
      'verify /tmp/b.tar.gz',
      'restore /tmp/b.tar.gz',
    ]);
  });

  it('refuses verify/restore without a file, before touching the core', async () => {
    expect((await verifyBackupForReview('  ')).ok).toBe(false);
    expect((await restoreBackupForReview('')).ok).toBe(false);
    expect(mockedLoadCoreModule).not.toHaveBeenCalled();
  });

  it('degrades cleanly when the core module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    const review = await listBackupsForReview();

    expect(review.ok).toBe(false);
    expect(review.error).toContain('unavailable');
  });
});
