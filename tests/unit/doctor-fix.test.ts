import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, execFileSync } from 'child_process';
import { runDoctorChecks, runFixes } from '../../src/doctor/index.js';
import type { DoctorCheck, FixResult } from '../../src/doctor/index.js';
import type { EnvironmentSnapshot } from '../../src/wizard/environment-detection.js';

// Mock external commands so doctor checks don't depend on system state
vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
  execFileSync: vi.fn(() => ''),
  spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '' })),
}));

// Probe and settings doubles keep installation guidance and provider selection
// deterministic, without downloading or writing the real user's profile.
const { mockDetectEnvironment, mockSaveUserSettings, mockReadUserSettingsIfPresent } = vi.hoisted(
  () => ({
    mockDetectEnvironment: vi.fn(),
    mockSaveUserSettings: vi.fn(),
    mockReadUserSettingsIfPresent: vi.fn(),
  })
);

vi.mock('../../src/wizard/environment-detection.js', () => ({
  detectEnvironment: mockDetectEnvironment,
}));

vi.mock('../../src/utils/settings-manager.js', () => ({
  getSettingsManager: () => ({
    saveUserSettings: mockSaveUserSettings,
    readUserSettingsIfPresent: mockReadUserSettingsIfPresent,
  }),
}));
vi.mock('../../src/doctor/local-context-cap.js', () => ({ persistDoctorLocalContextCap: vi.fn(() => 32768), readDoctorLocalContextCap: vi.fn(() => undefined) }));

const EMPTY_ENVIRONMENT: EnvironmentSnapshot = { capabilities: [], ready: false };

const OLLAMA_WITHOUT_MODEL: EnvironmentSnapshot = {
  capabilities: [
    {
      id: 'ollama',
      label: 'Ollama',
      kind: 'local',
      free: true,
      available: true,
      detail: 'running - 0 models',
      models: [],
      baseURL: 'http://127.0.0.1:11434',
    },
  ],
  ready: false,
};

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
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // ignore cleanup errors
  }
}

describe('doctor --fix', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    vi.mocked(execSync).mockReset().mockReturnValue('');
    mockSaveUserSettings.mockReset();
    mockReadUserSettingsIfPresent.mockReset().mockReturnValue(undefined);
    mockDetectEnvironment.mockReset().mockResolvedValue(EMPTY_ENVIRONMENT);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  describe('Ollama running without a model', () => {
    beforeEach(() => {
      mockDetectEnvironment.mockResolvedValue(OLLAMA_WITHOUT_MODEL);
    });

    it('proposes the exact install command and size without downloading on --fix', async () => {
      vi.mocked(execFileSync).mockClear();
      const checks = await runDoctorChecks(tmpDir);
      const providerCheck = checks.find(c => c.name === 'AI provider ready');
      expect(providerCheck?.status).toBe('warn');
      expect(providerCheck?.fixable).not.toBe(true);
      expect(providerCheck?.message).toContain('ollama pull qwen3.5:4b');
      expect(providerCheck?.message).toContain('3,4 Go');
      await runFixes(checks);
      expect(execFileSync).not.toHaveBeenCalledWith('ollama', expect.anything(), expect.anything());
      expect(mockSaveUserSettings).not.toHaveBeenCalled();
    });
  });

  it('selects an installed tool fallback, warns visibly, and persists the actual local endpoint', async () => {
    mockDetectEnvironment.mockResolvedValue({ capabilities: [{ ...OLLAMA_WITHOUT_MODEL.capabilities[0], models: ['qwen3:4b-instruct'], modelDetails: [{ name: 'qwen3:4b-instruct', sizeBytes: 2497293819 }] }], ready: true });
    const checks = await runDoctorChecks(tmpDir);
    const check = checks.find(c => c.name === 'AI provider ready')!;
    expect(check.fixable).toBe(true);
    expect(check.message).toContain('modèle de repli, qualité réduite');
    const results = await runFixes([check]);
    expect(results[0].success).toBe(true);
    expect(results[0].message).toContain('installez qwen3.5:4b');
    expect(mockSaveUserSettings).toHaveBeenCalledWith({ provider: 'ollama', model: 'qwen3:4b-instruct', defaultModel: 'qwen3:4b-instruct', baseURL: 'http://127.0.0.1:11434/v1' });
  });

  it('repairs an already-selected preferred local model whose context cap is missing', async () => {
    mockDetectEnvironment.mockResolvedValue({ capabilities: [{ ...OLLAMA_WITHOUT_MODEL.capabilities[0], models: ['qwen3.5:4b'] }], ready: true });
    mockReadUserSettingsIfPresent.mockReturnValue({ provider: 'ollama', model: 'qwen3.5:4b', defaultModel: 'qwen3.5:4b' });
    const checks = await runDoctorChecks(tmpDir);
    const check = checks.find(c => c.name === 'AI provider ready');
    expect(check?.status).toBe('warn');
    expect(check?.message).toContain('32768');
    expect(check?.fixable).toBe(true);
    await runFixes([check!]);
    expect(mockSaveUserSettings).toHaveBeenCalledWith(expect.objectContaining({ model: 'qwen3.5:4b' }));
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

  describe('profile permission portability', () => {
    it.each(['linux', 'win32'])('interprets profile mode bits only on POSIX (%s)', async (platform) => {
      const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
      const profile = path.join(tmpDir, '.codebuddy');
      fs.mkdirSync(profile, { recursive: true });
      fs.chmodSync(profile, 0o777);
      vi.stubEnv('HOME', tmpDir);
      vi.stubEnv('USERPROFILE', tmpDir);
      Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
      try {
        const checks = await runDoctorChecks(tmpDir);
        const permissions = checks.find(check => check.name === 'Profile permissions');
        expect(permissions).toBeDefined();
        expect(permissions!.status).toBe(platform === 'win32' ? 'ok' : 'warn');
        expect(Boolean(permissions!.fixable)).toBe(platform !== 'win32');
        if (platform === 'win32') {
          expect(permissions!.message).toContain('writable');
          expect(permissions!.message).not.toMatch(/chmod|world-writable|mode /);
          expect(await runFixes([permissions!])).toEqual([]);
        }
      } finally {
        Object.defineProperty(process, 'platform', descriptor);
        vi.unstubAllEnvs();
      }
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
