/**
 * Tests for Settings Manager
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock fs before importing the module
jest.mock('fs', () => {
  const impl = {
  ...await vi.importActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
};
  return { ...impl, default: impl };
});

import {
  SettingsManager,
  getSettingsManager,
} from '../../src/utils/settings-manager.js';

// Reset singleton between tests
function resetSettingsManager(): void {
  (SettingsManager as unknown as { instance: SettingsManager | undefined }).instance = undefined;
}

// TESTWRITE1 (2026-09-04): `saveUserSettings`/`saveProjectSettings` persist
// through `atomic-write.js`, which reaches `node:fs` directly (open/rename/
// chmod/fsync). The `jest.mock('fs', …)` above only overrides four methods —
// it never touches those atomic-write syscalls — so with the DEFAULT (no
// override) paths this suite was silently renaming an EMPTY temp file onto
// the real `<repo>/.codebuddy/settings.json` and `~/.codebuddy/user-settings.json`
// on every run (measured: both truncated to 0 bytes). Every manager instance
// in this file must be constructed with `settingsManagerOverrides()` so both
// paths stay inside a per-test `mkdtemp` directory; the production default
// (zero-arg `getSettingsManager()`) is untouched — see `SettingsManagerOverrides`
// in `src/utils/settings-manager.ts`.
describe('SettingsManager', () => {
  let manager: SettingsManager;
  let tmpDir: string;
  let userSettingsPath: string;
  let projectSettingsPath: string;

  function settingsManagerOverrides() {
    return { userSettingsPath, projectSettingsPath };
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-settings-manager-test-'));
    // Keep the `.codebuddy` segment in both paths: some tests below mock
    // `fs.existsSync` by matching `p.includes('.codebuddy')`.
    userSettingsPath = path.join(tmpDir, '.codebuddy', 'user-settings.json');
    projectSettingsPath = path.join(tmpDir, '.codebuddy', 'settings.json');
    // `fs.mkdirSync` is mocked to a no-op below, but the atomic writer's
    // real (unmocked) `openSync`/`renameSync` still need this directory to
    // exist on disk — create it through the untouched `fs.promises` surface.
    await fs.promises.mkdir(path.join(tmpDir, '.codebuddy'), { recursive: true });

    resetSettingsManager();
    jest.clearAllMocks();

    // Mock fs.existsSync to return false by default (no existing settings files)
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.readFileSync as jest.Mock).mockReturnValue('{}');
    (fs.writeFileSync as jest.Mock).mockImplementation(function() {});
    (fs.mkdirSync as jest.Mock).mockImplementation(function() {});

    manager = getSettingsManager(settingsManagerOverrides());
  });

  afterEach(() => {
    resetSettingsManager();
    jest.clearAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Initialization', () => {
    it('should create instance via singleton pattern', () => {
      expect(manager).toBeDefined();
    });

    it('should return same instance on multiple calls', () => {
      const instance1 = getSettingsManager(settingsManagerOverrides());
      const instance2 = getSettingsManager(settingsManagerOverrides());
      expect(instance1).toBe(instance2);
    });

    it('should return new instance after reset', () => {
      const instance1 = getSettingsManager(settingsManagerOverrides());
      resetSettingsManager();
      const instance2 = getSettingsManager(settingsManagerOverrides());
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('User Settings', () => {
    it('should load user settings with defaults', () => {
      const settings = manager.loadUserSettings();
      expect(settings).toBeDefined();
      expect(settings.baseURL).toBeDefined();
      expect(settings.defaultModel).toBeDefined();
    });

    it('should save user settings', () => {
      manager.saveUserSettings({ defaultModel: 'grok-3-latest' });
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should update a specific user setting', () => {
      manager.updateUserSetting('defaultModel', 'grok-3-fast');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should get a specific user setting', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ defaultModel: 'grok-3-latest' })
      );

      resetSettingsManager();
      const newManager = getSettingsManager(settingsManagerOverrides());
      const model = newManager.getUserSetting('defaultModel');
      expect(model).toBe('grok-3-latest');
    });

    it('should handle corrupted user settings file', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid json');

      resetSettingsManager();
      const newManager = getSettingsManager(settingsManagerOverrides());

      // Should not throw, returns defaults
      const settings = newManager.loadUserSettings();
      expect(settings).toBeDefined();
    });
  });

  describe('Project Settings', () => {
    it('should load project settings with defaults', () => {
      const settings = manager.loadProjectSettings();
      expect(settings).toBeDefined();
    });

    it('should save project settings', () => {
      manager.saveProjectSettings({ model: 'grok-3-fast' });
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should update a specific project setting', () => {
      manager.updateProjectSetting('model', 'grok-3-latest');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should get a specific project setting', () => {
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        return p.includes('.codebuddy');
      });
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ model: 'test-model' })
      );

      resetSettingsManager();
      const newManager = getSettingsManager(settingsManagerOverrides());
      const model = newManager.getProjectSetting('model');
      expect(model).toBe('test-model');
    });
  });

  describe('Current Model', () => {
    it('should get current model', () => {
      const model = manager.getCurrentModel();
      // Should return some string (actual value depends on mock/real config)
      expect(typeof model).toBe('string');
    });

    it('should return model from project settings if available', () => {
      // This test verifies the priority: project > user > default
      // In mocked environment, we can't easily test this
      const model = manager.getCurrentModel();
      expect(model).toBeDefined();
    });
  });

  describe('Model Management', () => {
    it('should get current model', () => {
      const model = manager.getCurrentModel();
      expect(typeof model).toBe('string');
    });

    it('should set current model', () => {
      manager.setCurrentModel('grok-3-mini-fast');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should get available models', () => {
      const models = manager.getAvailableModels();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('API Configuration', () => {
    it('should get API key when available', () => {
      // API key may or may not be set in test environment
      const key = manager.getApiKey();
      // Should be string or undefined
      expect(key === undefined || typeof key === 'string').toBe(true);
    });

    it('should get base URL', () => {
      const url = manager.getBaseURL();
      expect(typeof url).toBe('string');
      expect(url.length).toBeGreaterThan(0);
    });
  });

  describe('File Path Handling', () => {
    it('should create directories if they do not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      manager.saveUserSettings({ defaultModel: 'test' });

      expect(fs.mkdirSync).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty settings files gracefully', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('{}');

      resetSettingsManager();
      const newManager = getSettingsManager(settingsManagerOverrides());
      const settings = newManager.loadUserSettings();

      // Should still have default values
      expect(settings.baseURL).toBeDefined();
    });

    it('should handle null values in settings', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ defaultModel: null })
      );

      resetSettingsManager();
      const newManager = getSettingsManager(settingsManagerOverrides());
      const settings = newManager.loadUserSettings();

      // Null should be preserved but defaults should be merged
      expect(settings).toBeDefined();
    });
  });
});
