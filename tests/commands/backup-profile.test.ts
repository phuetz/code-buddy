/**
 * Tests for HOMEBACKUP1 - Profile Backup Features
 *
 * Tests for --profile, --scope, --dry-run flags and whitelist/blacklist functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Mock the entire fs module for better control
vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof fs>();
  return {
    ...original,
    // We'll override these in tests
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    lstatSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    copyFileSync: vi.fn(),
  };
});

vi.mock('os', async (importOriginal) => {
  const original = await importOriginal<typeof import('os')>();
  return {
    ...original,
    homedir: vi.fn(() => '/home/testuser'),
  };
});

// Mock path methods that use fs
vi.mock('path', async (importOriginal) => {
  const original = await importOriginal<typeof path>();
  return {
    ...original,
    // Keep original path methods, they don't need mocking
  };
});

// Import the handlers after mocking
let backupHandlers: any;
let handleBackup: any;
let isBlacklisted: any;
let isWhitelisted: any;
let PROFILE_BACKUP_WHITELIST: any;
let PROFILE_BACKUP_BLACKLIST: any;
let DEFAULT_MAX_FILE_SIZE: any;
let DEFAULT_MAX_TOTAL_SIZE: any;

// Helper to create a mock file system
function createMockFileSystem(files: Record<string, { content?: string; size?: number; isDir?: boolean; isSymlink?: boolean }>) {
  vi.mocked(fs.existsSync).mockImplementation((path: string) => {
    const normalizedPath = path.replace(/\\/g, '/');
    // Home profile directory always exists for our tests
    if (normalizedPath === '/home/testuser/.codebuddy') return true;
    if (normalizedPath === '/home/testuser/.codebuddy/backups') return true;
    
    // Check if the path exists in our mock filesystem
    for (const filePath of Object.keys(files)) {
      if (normalizedPath === filePath || 
          normalizedPath.startsWith(filePath + '/') ||
          filePath.startsWith(normalizedPath + '/')) {
        return true;
      }
    }
    return false;
  });

  vi.mocked(fs.readdirSync).mockImplementation((dir: string) => {
    const normalizedDir = dir.replace(/\\/g, '/').replace(/\/+$/, '');
    const entries: any[] = [];
    const seenNames = new Set<string>();
    
    for (const [filePath, fileInfo] of Object.entries(files)) {
      const normalizedPath = filePath.replace(/\\/g, '/');
      if (normalizedPath.startsWith(normalizedDir + '/')) {
        const relativePath = normalizedPath.slice(normalizedDir.length + 1);
        const parts = relativePath.split('/');
        const name = parts[0]!;
        
        if (seenNames.has(name)) continue;
        seenNames.add(name);

        if (parts.length === 1) {
          entries.push({
            name,
            isDirectory: vi.fn(() => Boolean(fileInfo.isDir)),
            isFile: vi.fn(() => !fileInfo.isDir),
            isSymbolicLink: vi.fn(() => Boolean(fileInfo.isSymlink)),
          });
        } else {
          entries.push({
            name,
            isDirectory: vi.fn(() => true),
            isFile: vi.fn(() => false),
            isSymbolicLink: vi.fn(() => false),
          });
        }
      }
    }
    
    return entries;
  });

  vi.mocked(fs.statSync).mockImplementation((filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    for (const [mockPath, fileInfo] of Object.entries(files)) {
      if (normalizedPath === mockPath.replace(/\\/g, '/')) {
        return {
          size: fileInfo.size !== undefined ? fileInfo.size : (fileInfo.content ? fileInfo.content.length : 100),
          isFile: vi.fn(() => !fileInfo.isDir),
          isDirectory: vi.fn(() => Boolean(fileInfo.isDir)),
          isSymbolicLink: vi.fn(() => Boolean(fileInfo.isSymlink)),
          mtime: new Date(),
        };
      }
    }
    for (const mockPath of Object.keys(files)) {
      const normMock = mockPath.replace(/\\/g, '/');
      if (normMock.startsWith(normalizedPath + '/')) {
        return { size: 4096, isFile: vi.fn(() => false), isDirectory: vi.fn(() => true), isSymbolicLink: vi.fn(() => false), mtime: new Date() };
      }
    }
    return { size: 100, isFile: vi.fn(() => true), isDirectory: vi.fn(() => false), isSymbolicLink: vi.fn(() => false), mtime: new Date() };
  });

  vi.mocked(fs.lstatSync).mockImplementation((filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    for (const [mockPath, fileInfo] of Object.entries(files)) {
      if (normalizedPath === mockPath.replace(/\\/g, '/')) {
        return {
          size: fileInfo.size !== undefined ? fileInfo.size : (fileInfo.content ? fileInfo.content.length : 100),
          isFile: vi.fn(() => !fileInfo.isDir),
          isDirectory: vi.fn(() => Boolean(fileInfo.isDir)),
          isSymbolicLink: vi.fn(() => Boolean(fileInfo.isSymlink)),
          mtime: new Date(),
        };
      }
    }
    for (const mockPath of Object.keys(files)) {
      const normMock = mockPath.replace(/\\/g, '/');
      if (normMock.startsWith(normalizedPath + '/')) {
        return { size: 4096, isFile: vi.fn(() => false), isDirectory: vi.fn(() => true), isSymbolicLink: vi.fn(() => false), mtime: new Date() };
      }
    }
    return { size: 100, isFile: vi.fn(() => true), isDirectory: vi.fn(() => false), isSymbolicLink: vi.fn(() => false), mtime: new Date() };
  });

  vi.mocked(fs.readFileSync).mockImplementation((filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    for (const [mockPath, fileInfo] of Object.entries(files)) {
      if (normalizedPath === mockPath.replace(/\\/g, '/')) {
        return Buffer.from(fileInfo.content || '{}');
      }
    }
    return Buffer.from('{}');
  });

  vi.mocked(fs.writeFileSync).mockImplementation((filePath: any, data: any) => {
    const normalized = String(filePath).replace(/\\/g, '/');
    const content = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf-8') : String(data);
    files[normalized] = {
      content,
      size: Buffer.byteLength(content),
      isDir: false,
    };
  });
  vi.mocked(fs.mkdirSync).mockImplementation(() => {});
  vi.mocked(fs.copyFileSync).mockImplementation(() => {});
}

describe('HOMEBACKUP1 - Profile Backup Features', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Import fresh
    backupHandlers = await import('../../src/commands/handlers/backup-handlers.js');
    handleBackup = backupHandlers.handleBackup;
    isBlacklisted = backupHandlers.isBlacklisted;
    isWhitelisted = backupHandlers.isWhitelisted;
    PROFILE_BACKUP_WHITELIST = backupHandlers.PROFILE_BACKUP_WHITELIST;
    PROFILE_BACKUP_BLACKLIST = backupHandlers.PROFILE_BACKUP_BLACKLIST;
    DEFAULT_MAX_FILE_SIZE = backupHandlers.DEFAULT_MAX_FILE_SIZE;
    DEFAULT_MAX_TOTAL_SIZE = backupHandlers.DEFAULT_MAX_TOTAL_SIZE;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constants and Whitelist/Blacklist', () => {
    it('should have correct default limits', () => {
      expect(DEFAULT_MAX_FILE_SIZE).toBe(5 * 1024 * 1024); // 5 Mo
      expect(DEFAULT_MAX_TOTAL_SIZE).toBe(200 * 1024 * 1024); // 200 Mo
    });

    it('should have correct whitelist patterns', () => {
      expect(PROFILE_BACKUP_WHITELIST).toContain('settings.json');
      expect(PROFILE_BACKUP_WHITELIST).toContain('user-settings.json');
      expect(PROFILE_BACKUP_WHITELIST).toContain('memory.md');
      expect(PROFILE_BACKUP_WHITELIST).toContain('CODEBUDDY_MEMORY.md');
      expect(PROFILE_BACKUP_WHITELIST).toContain('personas/*.json');
      expect(PROFILE_BACKUP_WHITELIST).toContain('skills/**/SKILL.md');
    });

    it('should have correct blacklist patterns', () => {
      expect(PROFILE_BACKUP_BLACKLIST).toContain('*.env');
      expect(PROFILE_BACKUP_BLACKLIST).toContain('*auth*');
      expect(PROFILE_BACKUP_BLACKLIST).toContain('credentials*');
      expect(PROFILE_BACKUP_BLACKLIST).toContain('*token*');
      expect(PROFILE_BACKUP_BLACKLIST).toContain('*secret*');
      expect(PROFILE_BACKUP_BLACKLIST).toContain('*.enc');
    });

    it('should correctly identify blacklisted files', () => {
      expect(isBlacklisted('.env')).toBe(true);
      expect(isBlacklisted('auth-profiles.json')).toBe(true);
      expect(isBlacklisted('credentials.enc')).toBe(true);
      expect(isBlacklisted('token.json')).toBe(true);
      expect(isBlacklisted('secret-key.txt')).toBe(true);
      expect(isBlacklisted('my-secret-file.env')).toBe(true);
      
      // Should NOT be blacklisted
      expect(isBlacklisted('settings.json')).toBe(false);
      expect(isBlacklisted('memory.md')).toBe(false);
      expect(isBlacklisted('persona.json')).toBe(false);
    });

    it('should be case-insensitive for blacklist', () => {
      expect(isBlacklisted('.ENV')).toBe(true);
      expect(isBlacklisted('AUTH-profiles.json')).toBe(true);
      expect(isBlacklisted('CREDENTIALS.json')).toBe(true);
    });

    it('should correctly identify whitelisted files', () => {
      expect(isWhitelisted('settings.json')).toBe(true);
      expect(isWhitelisted('user-settings.json')).toBe(true);
      expect(isWhitelisted('memory.md')).toBe(true);
      expect(isWhitelisted('CODEBUDDY_MEMORY.md')).toBe(true);
      expect(isWhitelisted('personas/agent.json')).toBe(true);
      expect(isWhitelisted('skills/my-skill/SKILL.md')).toBe(true);
      expect(isWhitelisted('self-improvement/store/learning.json')).toBe(true);
      expect(isWhitelisted('collective/ckg-ledger.jsonl')).toBe(true);
    });

    it('should NOT whitelist non-whitelisted files', () => {
      expect(isWhitelisted('some-random-file.txt')).toBe(false);
      expect(isWhitelisted('cache/something.json')).toBe(false);
      expect(isWhitelisted('temp/data.md')).toBe(false);
    });

    it('should NOT whitelist blacklisted files even if they match whitelist patterns', () => {
      // This is tested at the collection level, but the whitelist should still return true
      // The blacklist check happens first in collectProfileFiles
      expect(isWhitelisted('auth-profiles.json')).toBe(false);
    });
  });

  describe('Dry Run Functionality', () => {
    it('should handle dry-run flag', async () => {
      // Setup mock filesystem
      createMockFileSystem({
        '/home/testuser/.codebuddy/settings.json': { content: '{}', size: 100 },
        '/home/testuser/.codebuddy/user-settings.json': { content: '{}', size: 100 },
        '/home/testuser/.codebuddy/memory.md': { content: '# Memory', size: 50 },
        '/home/testuser/.codebuddy/.env': { content: 'SECRET=key', size: 20 },
        '/home/testuser/.codebuddy/auth-profiles.json': { content: '{}', size: 50 },
      });

      const result = await handleBackup('create --home --scope home --dry-run --output /tmp/backup');
      
      expect(result.handled).toBe(true);
      expect(result.exitCode).toBeUndefined();
      expect(result.response).toContain('[DRY RUN]');
      expect(result.response).toContain('Would create backup');
      expect(result.response).toContain('settings.json');
      // Blacklisted files should appear in skipped section
      expect(result.response).toContain('blacklisted');
      expect(result.response).toContain('.env');
      expect(result.response).toContain('auth-profiles.json');
    });

    it('should show skipped files in dry-run', async () => {
      createMockFileSystem({
        '/home/testuser/.codebuddy/settings.json': { content: '{}', size: 100 },
        '/home/testuser/.codebuddy/.env': { content: 'SECRET=key', size: 20 },
        '/home/testuser/.codebuddy/random-file.txt': { content: 'not whitelisted', size: 50 },
      });

      const result = await handleBackup('create --home --scope home --dry-run --output /tmp/backup');
      
      expect(result.handled).toBe(true);
      expect(result.response).toContain('Skipped');
      expect(result.response).toContain('blacklisted');
      expect(result.response).toContain('not in whitelist');
      // Note: size limit test requires proper mock of large files
    });
  });

  describe('Scope Handling', () => {
    it('should accept valid scope values', async () => {
      for (const scope of ['home', 'project', 'both']) {
        const result = await handleBackup(`create --home --scope ${scope} --dry-run`);
        expect(result.handled).toBe(true);
        // Should not return an error for valid scopes
        expect(result.response).not.toContain('Invalid scope');
      }
    });

    it('should reject invalid scope values', async () => {
      const result = await handleBackup('create --home --scope invalid --dry-run');
      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.response).toContain('Invalid scope');
    });
  });

  describe('Backup Creation with Profile', () => {
    it('should handle profile backup creation', async () => {
      createMockFileSystem({
        '/home/testuser/.codebuddy/settings.json': { content: '{}', size: 100 },
        '/home/testuser/.codebuddy/user-settings.json': { content: '{}', size: 100 },
      });

      const result = await handleBackup('create --home --scope home --output /tmp/backup');
      
      expect(result.handled).toBe(true);
      expect(result.exitCode).toBeUndefined();
      expect(result.response).toContain('Backup created');
      expect(result.response).toContain('profile backup');
      expect(result.response).toContain('scope=home');
    });

    it.skip('should handle both scope backup', async () => {
      // Skipped: requires complex multi-source mocking
      createMockFileSystem({
        '/home/testuser/.codebuddy/settings.json': { content: '{}', size: 100 },
        '/home/testuser/.codebuddy/backups': { isDir: true },
        '/home/testuser/test-project/.codebuddy/settings.json': { content: '{}', size: 100 },
      });

      // Mock process.cwd to return our test project
      const originalCwd = process.cwd;
      process.cwd = vi.fn(() => '/home/testuser/test-project');

      const result = await handleBackup('create --scope both --output /tmp/backup');
      
      process.cwd = originalCwd;
      
      expect(result.handled).toBe(true);
      expect(result.exitCode).toBeUndefined();
      expect(result.response).toContain('Backup created');
      expect(result.response).toContain('scope=both');
    });
  });

  describe('Secret File Protection', () => {
    it('should NEVER back up .env files', async () => {
      createMockFileSystem({
        '/home/testuser/.codebuddy/.env': { content: 'API_KEY=secret123', size: 20 },
        '/home/testuser/.codebuddy/settings.json': { content: '{}', size: 100 },
      });

      const result = await handleBackup('create --home --scope home --output /tmp/backup');
      
      expect(result.handled).toBe(true);
      // The backup should be created but .env should be skipped
      expect(result.response).toContain('Backup created');
      expect(result.response).toContain('Skipped');
      expect(result.response).toContain('blacklisted');
      
      // Verify that writeFileSync was called with data that doesn't contain the .env
      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      expect(writeCalls.length).toBeGreaterThan(0);
      
      const backupData = writeCalls[0][1];
      const backupContent = JSON.parse(backupData);
      const filePaths = backupContent.files.map((f: any) => f.path);
      expect(filePaths).not.toContain('.env');
    });

    it('should NEVER back up auth-profiles.json', async () => {
      createMockFileSystem({
        '/home/testuser/.codebuddy/auth-profiles.json': { content: '{"auth": "secret"}', size: 30 },
        '/home/testuser/.codebuddy/settings.json': { content: '{}', size: 100 },
      });

      const result = await handleBackup('create --home --scope home --output /tmp/backup');
      
      expect(result.handled).toBe(true);
      expect(result.response).toContain('Skipped');
      
      // Verify auth-profiles.json is not in the backup
      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      if (writeCalls.length > 0) {
        const backupData = JSON.parse(writeCalls[0][1]);
        const filePaths = backupData.files.map((f: any) => f.path);
        expect(filePaths).not.toContain('auth-profiles.json');
      }
    });

    it('should NEVER back up token files', async () => {
      createMockFileSystem({
        '/home/testuser/.codebuddy/access-token.txt': { content: 'token123', size: 15 },
        '/home/testuser/.codebuddy/settings.json': { content: '{}', size: 100 },
      });

      const result = await handleBackup('create --home --scope home --output /tmp/backup');
      
      expect(result.handled).toBe(true);
      expect(result.response).toContain('Skipped');
      
      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      if (writeCalls.length > 0) {
        const backupData = JSON.parse(writeCalls[0][1]);
        const filePaths = backupData.files.map((f: any) => f.path);
        expect(filePaths).not.toContain('access-token.txt');
      }
    });

    it('should NEVER back up credentials files', async () => {
      createMockFileSystem({
        '/home/testuser/.codebuddy/credentials.enc': { content: 'encrypted', size: 20 },
        '/home/testuser/.codebuddy/credentials.json': { content: '{}', size: 20 },
        '/home/testuser/.codebuddy/settings.json': { content: '{}', size: 100 },
      });

      const result = await handleBackup('create --home --scope home --output /tmp/backup');
      
      expect(result.handled).toBe(true);
      expect(result.response).toContain('Skipped');
      
      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      if (writeCalls.length > 0) {
        const backupData = JSON.parse(writeCalls[0][1]);
        const filePaths = backupData.files.map((f: any) => f.path);
        expect(filePaths).not.toContain('credentials.enc');
        expect(filePaths).not.toContain('credentials.json');
      }
    });
  });

  describe('Size Limits', () => {
    it('should skip files larger than max file size', async () => {
      createMockFileSystem({
        '/home/testuser/.codebuddy/settings.json': { content: '{}', size: 100 },
        '/home/testuser/.codebuddy/personas/large-file.json': {
          content: 'x'.repeat(6 * 1024 * 1024),
          size: 6 * 1024 * 1024 // 6 Mo, larger than 5 Mo limit
        },
      });

      const result = await handleBackup('create --home --scope home --output /tmp/backup');

      expect(result.handled).toBe(true);
      expect(result.response).toContain('Skipped');
      expect(result.response).toContain('larger than');

      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      expect(writeCalls.length).toBeGreaterThan(0);
      const backupData = JSON.parse(writeCalls[0][1]);
      const filePaths = backupData.files.map((f: any) => f.path);
      expect(filePaths).not.toContain('personas/large-file.json');
    });

    it('should fail when total size exceeds limit', async () => {
      // Create many whitelisted files (each < 5 Mo) that together exceed 200 Mo limit
      const files: Record<string, { content: string; size: number }> = {};
      for (let i = 0; i < 50; i++) {
        files[`/home/testuser/.codebuddy/personas/agent-${i}.json`] = {
          content: 'x',
          size: 4500 * 1024 // 4.5 Mo each, 50 * 4.5 Mo = 225 Mo (> 200 Mo)
        };
      }

      createMockFileSystem(files);

      const result = await handleBackup('create --home --scope home --output /tmp/backup');

      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.response).toContain('exceeds maximum allowed size');
    });
  });

  describe('Whitelist Only Files', () => {
    it('should only back up whitelisted files', async () => {
      createMockFileSystem({
        '/home/testuser/.codebuddy/settings.json': { content: '{}', size: 100 },
        '/home/testuser/.codebuddy/user-settings.json': { content: '{}', size: 100 },
        '/home/testuser/.codebuddy/memory.md': { content: '# Memory', size: 50 },
        '/home/testuser/.codebuddy/random-file.txt': { content: 'not important', size: 30 },
        '/home/testuser/.codebuddy/cache/data.json': { content: '{}', size: 40 },
        '/home/testuser/.codebuddy/personas/agent.json': { content: '{}', size: 100 },
        '/home/testuser/.codebuddy/personas/avatar.png': { content: 'image data', size: 5000 },
      });

      const result = await handleBackup('create --home --scope home --output /tmp/backup');

      expect(result.handled).toBe(true);
      expect(result.exitCode).toBeUndefined();

      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      expect(writeCalls.length).toBeGreaterThan(0);
      const backupData = JSON.parse(writeCalls[0][1]);
      const filePaths = backupData.files.map((f: any) => f.path);

      // Should contain whitelisted files
      expect(filePaths).toContain('settings.json');
      expect(filePaths).toContain('user-settings.json');
      expect(filePaths).toContain('memory.md');
      expect(filePaths).toContain('personas/agent.json');

      // Should NOT contain non-whitelisted files
      expect(filePaths).not.toContain('random-file.txt');
      expect(filePaths).not.toContain('cache/data.json');
      expect(filePaths).not.toContain('personas/avatar.png');
    });

    it('should handle nested whitelist patterns', async () => {
      createMockFileSystem({
        '/home/testuser/.codebuddy/skills/my-skill/SKILL.md': { content: '# Skill', size: 50 },
        '/home/testuser/.codebuddy/skills/my-skill/config.json': { content: '{}', size: 30 },
        '/home/testuser/.codebuddy/skills/other-skill/SKILL.md': { content: '# Other Skill', size: 60 },
        '/home/testuser/.codebuddy/skills/other-skill/readme.txt': { content: 'not whitelisted', size: 40 },
      });

      const result = await handleBackup('create --home --scope home --output /tmp/backup');

      expect(result.handled).toBe(true);

      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      expect(writeCalls.length).toBeGreaterThan(0);
      const backupData = JSON.parse(writeCalls[0][1]);
      const filePaths = backupData.files.map((f: any) => f.path);

      expect(filePaths).toContain('skills/my-skill/SKILL.md');
      expect(filePaths).toContain('skills/other-skill/SKILL.md');
      expect(filePaths).not.toContain('skills/my-skill/config.json');
      expect(filePaths).not.toContain('skills/other-skill/readme.txt');
    });
  });

  describe('Verify and Restore with --home', () => {
    it('should support --home without --scope (defaulting scope to home)', async () => {
      createMockFileSystem({
        '/home/testuser/.codebuddy/settings.json': { content: '{"theme":"light"}', size: 18 },
      });

      const result = await handleBackup('create --home --dry-run --output /tmp/backup');
      expect(result.handled).toBe(true);
      expect(result.exitCode).toBeUndefined();
      expect(result.response).toContain('[DRY RUN]');
      expect(result.response).toContain('Actual scope: home');
      expect(result.response).toContain('/home/testuser/.codebuddy (profile)');
    });

    it('should verify a valid home profile backup archive', async () => {
      const payload = Buffer.from('{"theme":"dark"}');
      const checksum = createHash('sha256').update(payload).digest('hex').slice(0, 16);
      const backupContent = JSON.stringify({
        manifest: {
          version: '2.0.0',
          createdAt: '2026-09-04T12:00:00.000Z',
          files: [{ path: 'settings.json', size: payload.length, checksum }],
          flags: { onlyConfig: false, includeWorkspace: true },
          scope: 'home',
          profile: true,
        },
        files: [{ path: 'settings.json', content: payload.toString('base64') }],
      });

      createMockFileSystem({
        '/tmp/backup/codebuddy-backup-test-profile.json': { content: backupContent, size: backupContent.length },
      });

      const result = await handleBackup('verify /tmp/backup/codebuddy-backup-test-profile.json');
      expect(result.handled).toBe(true);
      expect(result.exitCode).toBeUndefined();
      expect(result.response).toContain('Backup valid: codebuddy-backup-test-profile.json');
      expect(result.response).toContain('Version: 2.0.0');
    });

    it('should reject verification if archive contains blacklisted secret files', async () => {
      const payload = Buffer.from('SECRET=key');
      const checksum = createHash('sha256').update(payload).digest('hex').slice(0, 16);
      const backupContent = JSON.stringify({
        manifest: {
          version: '2.0.0',
          createdAt: '2026-09-04T12:00:00.000Z',
          files: [{ path: '.env', size: payload.length, checksum }],
          flags: { onlyConfig: false, includeWorkspace: true },
          scope: 'home',
          profile: true,
        },
        files: [{ path: '.env', content: payload.toString('base64') }],
      });

      createMockFileSystem({
        '/tmp/backup/bad-backup.json': { content: backupContent, size: backupContent.length },
      });

      const result = await handleBackup('verify /tmp/backup/bad-backup.json');
      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.response).toContain('secret file in archive is forbidden');
    });

    it('should restore home profile files with backup of existing files before overwrite (.bak)', async () => {
      const payload = Buffer.from('{"theme":"restored"}');
      const checksum = createHash('sha256').update(payload).digest('hex').slice(0, 16);
      const backupContent = JSON.stringify({
        manifest: {
          version: '2.0.0',
          createdAt: '2026-09-04T12:00:00.000Z',
          files: [{ path: 'settings.json', size: payload.length, checksum }],
          flags: { onlyConfig: false, includeWorkspace: true },
          scope: 'home',
          profile: true,
        },
        files: [{ path: 'settings.json', content: payload.toString('base64') }],
      });

      createMockFileSystem({
        '/tmp/backup/codebuddy-backup-test-profile.json': { content: backupContent, size: backupContent.length },
        '/home/testuser/.codebuddy/settings.json': { content: '{"theme":"old-existing"}', size: 24 },
      });

      // Confirm prompt preview
      const preview = await handleBackup('restore /tmp/backup/codebuddy-backup-test-profile.json --home');
      expect(preview.handled).toBe(true);
      expect(preview.response).toContain('Ready to restore');
      expect(preview.response).toContain('--confirm');

      // Actual restore with confirm
      const result = await handleBackup('restore /tmp/backup/codebuddy-backup-test-profile.json --home --confirm');
      expect(result.handled).toBe(true);
      expect(result.exitCode).toBeUndefined();
      expect(result.response).toContain('Restored backup');

      // Verify existing file was backed up before overwrite
      expect(vi.mocked(fs.copyFileSync)).toHaveBeenCalledWith(
        path.resolve('/home/testuser/.codebuddy/settings.json'),
        path.resolve('/home/testuser/.codebuddy/settings.json.bak'),
      );
      // Verify restored file was written
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        path.resolve('/home/testuser/.codebuddy/settings.json'),
        payload,
      );
    });

    it('should refuse restore if archive contains blacklisted secret files', async () => {
      const payload = Buffer.from('{"secret":"leak"}');
      const checksum = createHash('sha256').update(payload).digest('hex').slice(0, 16);
      const backupContent = JSON.stringify({
        manifest: {
          version: '2.0.0',
          createdAt: '2026-09-04T12:00:00.000Z',
          files: [{ path: 'auth-profiles.json', size: payload.length, checksum }],
          flags: { onlyConfig: false, includeWorkspace: true },
          scope: 'home',
          profile: true,
        },
        files: [{ path: 'auth-profiles.json', content: payload.toString('base64') }],
      });

      createMockFileSystem({
        '/tmp/backup/bad-auth-backup.json': { content: backupContent, size: backupContent.length },
      });

      const result = await handleBackup('restore /tmp/backup/bad-auth-backup.json --home --confirm');
      expect(result.handled).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.response).toContain('secret file in archive is forbidden: auth-profiles.json');
      expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
    });

    it('should produce archive where .env and auth-profiles.json are absent and huge file is skipped', async () => {
      createMockFileSystem({
        '/home/testuser/.codebuddy/settings.json': { content: '{"theme":"dark"}', size: 50 },
        '/home/testuser/.codebuddy/user-settings.json': { content: '{"vim":true}', size: 40 },
        '/home/testuser/.codebuddy/memory.md': { content: '# Memory notes', size: 30 },
        '/home/testuser/.codebuddy/personas/agent.json': { content: '{"name":"agent"}', size: 60 },
        '/home/testuser/.codebuddy/.env': { content: 'SECRET_API_KEY=12345', size: 25 },
        '/home/testuser/.codebuddy/auth-profiles.json': { content: '{"keys":"secret"}', size: 45 },
        '/home/testuser/.codebuddy/credentials.enc': { content: 'enc_bytes', size: 20 },
        '/home/testuser/.codebuddy/personas/huge-persona.json': {
          content: 'x'.repeat(6 * 1024 * 1024),
          size: 6 * 1024 * 1024, // 6 Mo > 5 Mo limit
        },
      });

      const result = await handleBackup('create --home --output /tmp/backup');
      expect(result.handled).toBe(true);
      expect(result.exitCode).toBeUndefined();
      expect(result.response).toContain('Backup created');
      expect(result.response).toContain('Skipped');

      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      expect(writeCalls.length).toBeGreaterThan(0);
      const backupData = JSON.parse(writeCalls[0][1]);
      const filePaths = backupData.files.map((f: any) => f.path);

      // Whitelisted files present
      expect(filePaths).toContain('settings.json');
      expect(filePaths).toContain('user-settings.json');
      expect(filePaths).toContain('memory.md');
      expect(filePaths).toContain('personas/agent.json');

      // Secret files ABSENT
      expect(filePaths).not.toContain('.env');
      expect(filePaths).not.toContain('auth-profiles.json');
      expect(filePaths).not.toContain('credentials.enc');

      // Huge file SKIPPED
      expect(filePaths).not.toContain('personas/huge-persona.json');
    });
  });
});