import fs from 'fs';
import path from 'path';
import os from 'os';
import { runDoctorChecks, runFixes } from '../../src/doctor/index.js';
import type { DoctorCheck, FixResult } from '../../src/doctor/index.js';

// Mock external commands so doctor checks don't depend on system state
vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-fix-test-'));
}

function cleanupDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

describe('doctor --fix', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  describe('missing .codebuddy directory', () => {
    it('should detect missing .codebuddy directory as fixable', async () => {
      const checks = await runDoctorChecks(tmpDir);
      const dirCheck = checks.find(c => c.name === '.codebuddy directory');

      expect(dirCheck).toBeDefined();
      expect(dirCheck!.status).toBe('warn');
      expect(dirCheck!.fixable).toBe(true);
      expect(dirCheck!.fix).toBeInstanceOf(Function);
    });

    it('should create missing .codebuddy directory with --fix', async () => {
      const checks = await runDoctorChecks(tmpDir);
      const results = await runFixes(checks);

      const dirFix = results.find(r => r.action === 'create-codebuddy-dir');
      expect(dirFix).toBeDefined();
      expect(dirFix!.success).toBe(true);

      const codeBuddyDir = path.join(tmpDir, '.codebuddy');
      expect(fs.existsSync(codeBuddyDir)).toBe(true);
    });

    it('should not mark existing .codebuddy directory as fixable', async () => {
      fs.mkdirSync(path.join(tmpDir, '.codebuddy'), { recursive: true });

      const checks = await runDoctorChecks(tmpDir);
      const dirCheck = checks.find(c => c.name === '.codebuddy directory');

      expect(dirCheck).toBeDefined();
      expect(dirCheck!.status).toBe('ok');
      expect(dirCheck!.fixable).toBeFalsy();
    });
  });

  describe('stale lock files', () => {
    it('should detect stale lock files as fixable', async () => {
      const codeBuddyDir = path.join(tmpDir, '.codebuddy');
      fs.mkdirSync(codeBuddyDir, { recursive: true });

      // Create a lock file and set its mtime to 2 hours ago
      const lockFile = path.join(codeBuddyDir, 'test.lock');
      fs.writeFileSync(lockFile, 'lock');
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(lockFile, twoHoursAgo, twoHoursAgo);

      const checks = await runDoctorChecks(tmpDir);
      const lockCheck = checks.find(c => c.name === 'Stale lock files');

      expect(lockCheck).toBeDefined();
      expect(lockCheck!.status).toBe('warn');
      expect(lockCheck!.fixable).toBe(true);
      expect(lockCheck!.message).toContain('1 stale lock file');
    });

    it('should delete stale lock files with --fix', async () => {
      const codeBuddyDir = path.join(tmpDir, '.codebuddy');
      fs.mkdirSync(codeBuddyDir, { recursive: true });

      const lockFile = path.join(codeBuddyDir, 'test.lock');
      fs.writeFileSync(lockFile, 'lock');
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(lockFile, twoHoursAgo, twoHoursAgo);

      const checks = await runDoctorChecks(tmpDir);
      const results = await runFixes(checks);

      const lockFix = results.find(r => r.action === 'delete-stale-locks');
      expect(lockFix).toBeDefined();
      expect(lockFix!.success).toBe(true);
      expect(fs.existsSync(lockFile)).toBe(false);
    });

    it('should not mark recent lock files as stale', async () => {
      const codeBuddyDir = path.join(tmpDir, '.codebuddy');
      fs.mkdirSync(codeBuddyDir, { recursive: true });

      // Create a fresh lock file (current time)
      const lockFile = path.join(codeBuddyDir, 'fresh.lock');
      fs.writeFileSync(lockFile, 'lock');

      const checks = await runDoctorChecks(tmpDir);
      const lockCheck = checks.find(c => c.name === 'Stale lock files');

      expect(lockCheck).toBeDefined();
      expect(lockCheck!.status).toBe('ok');
      expect(lockCheck!.fixable).toBeFalsy();
    });
  });

  describe('corrupted settings.json', () => {
    it('should detect corrupted settings.json as fixable', async () => {
      const codeBuddyDir = path.join(tmpDir, '.codebuddy');
      fs.mkdirSync(codeBuddyDir, { recursive: true });
      fs.writeFileSync(path.join(codeBuddyDir, 'settings.json'), '{invalid json!!!');

      const checks = await runDoctorChecks(tmpDir);
      const settingsCheck = checks.find(c => c.name === 'settings.json');

      expect(settingsCheck).toBeDefined();
      expect(settingsCheck!.status).toBe('error');
      expect(settingsCheck!.fixable).toBe(true);
      expect(settingsCheck!.message).toContain('corrupted');
    });

    it('should recreate corrupted settings.json with defaults', async () => {
      const codeBuddyDir = path.join(tmpDir, '.codebuddy');
      fs.mkdirSync(codeBuddyDir, { recursive: true });
      fs.writeFileSync(path.join(codeBuddyDir, 'settings.json'), '{bad json');

      const checks = await runDoctorChecks(tmpDir);
      const results = await runFixes(checks);

      const settingsFix = results.find(r => r.action === 'recreate-settings');
      expect(settingsFix).toBeDefined();
      expect(settingsFix!.success).toBe(true);

      const content = JSON.parse(
        fs.readFileSync(path.join(codeBuddyDir, 'settings.json'), 'utf-8')
      );
      expect(content.maxRounds).toBe(30);
      expect(content.autonomyLevel).toBe('confirm');
      expect(content.enableRAG).toBe(true);
    });
  });

  describe('settings.json schema migration', () => {
    it('should not flag current minimal project settings as fixable', async () => {
      const codeBuddyDir = path.join(tmpDir, '.codebuddy');
      fs.mkdirSync(codeBuddyDir, { recursive: true });
      fs.writeFileSync(
        path.join(codeBuddyDir, 'settings.json'),
        JSON.stringify({ model: 'grok-3', thinkingLevel: 'high' })
      );

      const checks = await runDoctorChecks(tmpDir);
      const schemaCheck = checks.find(c => c.name === 'settings.json schema');

      expect(schemaCheck).toBeUndefined();
    });

    it('should migrate legacy maxToolRounds while preserving existing values', async () => {
      const codeBuddyDir = path.join(tmpDir, '.codebuddy');
      fs.mkdirSync(codeBuddyDir, { recursive: true });
      fs.writeFileSync(
        path.join(codeBuddyDir, 'settings.json'),
        JSON.stringify({ model: 'grok-3', maxToolRounds: 400, customKey: 'keep-me' })
      );

      const checks = await runDoctorChecks(tmpDir);
      const schemaCheck = checks.find(c => c.name === 'settings.json schema');
      expect(schemaCheck).toBeDefined();
      expect(schemaCheck!.status).toBe('warn');
      expect(schemaCheck!.fixable).toBe(true);

      const results = await runFixes(checks);

      const migrateFix = results.find(r => r.action === 'migrate-settings-schema');
      expect(migrateFix).toBeDefined();
      expect(migrateFix!.success).toBe(true);

      const content = JSON.parse(
        fs.readFileSync(path.join(codeBuddyDir, 'settings.json'), 'utf-8')
      );
      // Existing value preserved
      expect(content.model).toBe('grok-3');
      expect(content.customKey).toBe('keep-me');
      // Legacy value migrated
      expect(content.maxRounds).toBe(400);
      expect(content.maxToolRounds).toBeUndefined();
    });
  });

  describe('non-fixable checks', () => {
    it('should not attempt to fix non-fixable checks', async () => {
      // With .codebuddy existing, most config checks are non-fixable
      const codeBuddyDir = path.join(tmpDir, '.codebuddy');
      fs.mkdirSync(codeBuddyDir, { recursive: true });
      fs.writeFileSync(
        path.join(codeBuddyDir, 'settings.json'),
        JSON.stringify({ model: 'grok-code-fast-1', maxRounds: 30, thinkingLevel: 'high' })
      );

      const checks = await runDoctorChecks(tmpDir);
      const results = await runFixes(checks);

      // With everything healthy, no fixes should be attempted
      expect(results.length).toBe(0);
    });
  });

  describe('diagnostic-only mode (without --fix)', () => {
    it('should detect issues but not fix them when runFixes is not called', async () => {
      // No .codebuddy directory
      const checks = await runDoctorChecks(tmpDir);
      const dirCheck = checks.find(c => c.name === '.codebuddy directory');

      expect(dirCheck!.status).toBe('warn');
      expect(dirCheck!.fixable).toBe(true);

      // Verify .codebuddy was NOT created (no fix ran)
      expect(fs.existsSync(path.join(tmpDir, '.codebuddy'))).toBe(false);
    });
  });

  describe('fix failure reporting', () => {
    it('should report failure gracefully when fix throws', async () => {
      const failingCheck: DoctorCheck = {
        name: 'Test check',
        status: 'error',
        message: 'broken',
        fixable: true,
        fix: async () => {
          throw new Error('Permission denied');
        },
      };

      const results = await runFixes([failingCheck]);

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(false);
      expect(results[0].message).toContain('Permission denied');
    });

    it('should report failure from fix function itself', async () => {
      const failingCheck: DoctorCheck = {
        name: 'Test check',
        status: 'error',
        message: 'broken',
        fixable: true,
        fix: async (): Promise<FixResult> => ({
          success: false,
          message: 'Could not write file',
          action: 'test-fix',
        }),
      };

      const results = await runFixes([failingCheck]);

      expect(results.length).toBe(1);
      expect(results[0].success).toBe(false);
      expect(results[0].message).toBe('Could not write file');
    });
  });

  describe('runFixes edge cases', () => {
    it('should skip checks without fixable flag', async () => {
      const checks: DoctorCheck[] = [
        { name: 'Check 1', status: 'ok', message: 'fine' },
        { name: 'Check 2', status: 'warn', message: 'warning but not fixable' },
      ];

      const results = await runFixes(checks);
      expect(results.length).toBe(0);
    });

    it('should skip checks with fixable=true but no fix function', async () => {
      const checks: DoctorCheck[] = [
        { name: 'Check 1', status: 'warn', message: 'fixable but no fn', fixable: true },
      ];

      const results = await runFixes(checks);
      expect(results.length).toBe(0);
    });
  });
});
