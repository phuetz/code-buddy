/**
 * Tests for Backup CLI Handlers
 *
 * Phase 6: backup create/verify/list/restore
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

// Mock fs module
vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>();
  return {
    ...original,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
    statSync: vi.fn().mockReturnValue({ size: 1024, mtime: new Date() }),
    readFileSync: vi.fn().mockReturnValue(Buffer.from('test')),
    writeFileSync: vi.fn(),
  };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Backup Handlers', () => {
  let handleBackup: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../src/commands/handlers/backup-handlers.js');
    handleBackup = mod.handleBackup;
  });

  it('should handle unknown subcommand', async () => {
    const result = await handleBackup('unknown');
    expect(result.handled).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.response).toContain('Unknown backup subcommand');
  });

  it('should default to list subcommand', async () => {
    const result = await handleBackup('');
    expect(result.handled).toBe(true);
  });

  describe('backup create', () => {
    it('should create backup when .codebuddy/ exists', async () => {
      const { existsSync, readdirSync, readFileSync, statSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        { name: 'settings.json', isDirectory: () => false, isFile: () => true } as any,
      ]);
      vi.mocked(readFileSync).mockReturnValue(Buffer.from('{"key": "value"}'));
      vi.mocked(statSync).mockReturnValue({ size: 100, mtime: new Date() } as any);

      const result = await handleBackup('create');
      expect(result.handled).toBe(true);
      expect(result.response).toContain('Backup created');
    });

    it('should report missing .codebuddy/', async () => {
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await handleBackup('create');
      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.response).toContain('No .codebuddy/ directory');
      expect(result.response).toContain('.codebuddy');
      expect(result.response).toContain('buddy --init');
    });

    it('should support --only-config flag', async () => {
      const { existsSync, readdirSync, readFileSync, statSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([]);

      const result = await handleBackup('create --only-config');
      expect(result.handled).toBe(true);
      expect(result.response).toContain('config only');
    });
  });

  describe('backup verify', () => {
    it('should verify valid backup', async () => {
      const { existsSync, readFileSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      const payload = Buffer.from('test');
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        manifest: {
          version: '1.0.0',
          createdAt: '2026-03-18T00:00:00Z',
          files: [{
            path: 'settings.json',
            size: payload.length,
            checksum: createHash('sha256').update(payload).digest('hex').slice(0, 16),
          }],
          flags: { onlyConfig: false, includeWorkspace: true },
        },
        files: [{ path: 'settings.json', content: payload.toString('base64') }],
      }));

      const result = await handleBackup('verify test-backup.json');
      expect(result.handled).toBe(true);
      expect(result.response).toContain('Backup valid');
    });

    it('should report missing file', async () => {
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await handleBackup('verify nonexistent.json');
      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.response).toContain('not found');
    });

    it('should require file argument', async () => {
      const result = await handleBackup('verify');
      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.response).toContain('Usage');
    });

    it.each(['verify', 'restore'])('should name a directory that cannot be read by backup %s', async (action) => {
      const { existsSync, readFileSync } = await import('fs');
      const directoryPath = process.cwd();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementationOnce(() => {
        throw new Error('EISDIR: illegal operation on a directory, read');
      });

      const result = await handleBackup(`${action} ${directoryPath}`);

      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.response).toContain('EISDIR');
      expect(result.response).toContain(directoryPath);
    });
  });

  describe('backup list', () => {
    it('should list available backups', async () => {
      const { existsSync, readdirSync, statSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        'codebuddy-backup-2026-03-18.json',
        'codebuddy-backup-2026-03-17.json',
      ] as any);
      vi.mocked(statSync).mockReturnValue({ size: 2048, mtime: new Date() } as any);

      const result = await handleBackup('list');
      expect(result.handled).toBe(true);
      expect(result.response).toContain('codebuddy-backup-');
    });

    it('should report no backups', async () => {
      const { existsSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await handleBackup('list');
      expect(result.handled).toBe(true);
      expect(result.response).toContain('No backups found');
    });
  });

  describe('backup restore', () => {
    it('should require file argument', async () => {
      const result = await handleBackup('restore');
      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.response).toContain('Usage');
    });

    it('should show confirmation prompt', async () => {
      const { existsSync, readFileSync } = await import('fs');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        manifest: {
          version: '1.0.0',
          createdAt: '2026-03-18T00:00:00Z',
          files: [{ path: 'settings.json', size: 100, checksum: 'abc' }],
          flags: { onlyConfig: false, includeWorkspace: true },
        },
      }));

      const result = await handleBackup('restore test.json');
      expect(result.handled).toBe(true);
      expect(result.response).toContain('Ready to restore');
      expect(result.response).toContain('--confirm');
    });
  });
});
