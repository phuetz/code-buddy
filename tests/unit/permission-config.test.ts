/**
 * Comprehensive Unit Tests for Permission Configuration System
 *
 * Tests the permission management system including:
 * - Configuration loading and saving
 * - File system permissions (read, write, create, delete)
 * - Command execution permissions
 * - Tool permissions
 * - Network permissions
 * - Path pattern matching
 * - Operation counting and limits
 * - Sandbox and dry-run modes
 */

import {
  PermissionManager,
  PermissionConfig,
  PermissionCheckResult,
  getPermissionManager,
  resetPermissionManager,
} from '../../src/security/permission-config';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs module
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('PermissionManager', () => {
  let manager: PermissionManager;
  const testConfigPath = '/test/.codebuddy/permissions.json';

  beforeEach(() => {
    jest.resetAllMocks();
    resetPermissionManager();
    mockFs.existsSync.mockReturnValue(false);
    manager = new PermissionManager(testConfigPath);
  });

  afterEach(() => {
    if (manager) {
      manager.dispose();
    }
    resetPermissionManager();
  });

  // ============================================================
  // Section 1: Configuration Loading and Initialization
  // ============================================================
  describe('Configuration Loading', () => {
    it('should initialize with default configuration when no file exists', () => {
      mockFs.existsSync.mockReturnValue(false);
      const defaultManager = new PermissionManager();

      const config = defaultManager.getConfig();

      expect(config.version).toBe('1.0.0');
      expect(config.fileSystem.allowedReadPaths).toEqual(['**/*']);
      expect(config.fileSystem.allowedWritePaths).toEqual(['**/*']);
      expect(config.commands.allowedCommands.length).toBeGreaterThan(0);
      expect(config.safety.sandboxMode).toBe(false);

      defaultManager.dispose();
    });

    it('should load configuration from file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        version: '1.0.0',
        fileSystem: {
          allowedReadPaths: ['/custom/read'],
          maxFileSize: 5 * 1024 * 1024,
        },
        commands: {
          allowedCommands: ['custom-command'],
        },
        safety: {
          sandboxMode: true,
        },
      }));

      const loadedManager = new PermissionManager(testConfigPath);
      const config = loadedManager.getConfig();

      expect(config.fileSystem.allowedReadPaths).toContain('/custom/read');
      expect(config.fileSystem.maxFileSize).toBe(5 * 1024 * 1024);
      expect(config.commands.allowedCommands).toContain('custom-command');
      expect(config.safety.sandboxMode).toBe(true);

      loadedManager.dispose();
    });

    it('should merge loaded config with defaults for missing fields', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        version: '1.0.0',
        fileSystem: {
          maxFileSize: 1024,
        },
      }));

      const loadedManager = new PermissionManager(testConfigPath);
      const config = loadedManager.getConfig();

      // Loaded value
      expect(config.fileSystem.maxFileSize).toBe(1024);
      // Default values for missing fields
      expect(config.commands.allowedCommands.length).toBeGreaterThan(0);
      expect(config.network.allowOutgoing).toBe(true);
      expect(config.tools.disabled).toEqual([]);

      loadedManager.dispose();
    });

    it('should handle invalid JSON gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json {');

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const loadedManager = new PermissionManager(testConfigPath);
      const config = loadedManager.getConfig();

      // Should fall back to defaults
      expect(config.version).toBe('1.0.0');
      expect(config.safety.sandboxMode).toBe(false);

      consoleSpy.mockRestore();
      loadedManager.dispose();
    });

    it('should handle file read errors gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Read error');
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const loadedManager = new PermissionManager(testConfigPath);
      const config = loadedManager.getConfig();

      // Should fall back to defaults
      expect(config.version).toBe('1.0.0');

      consoleSpy.mockRestore();
      loadedManager.dispose();
    });
  });

  // ============================================================
  // Section 2: Configuration Saving
  // ============================================================
  describe('Configuration Saving', () => {
    it('should save configuration to file', () => {
      mockFs.existsSync.mockReturnValue(true);

      manager.saveConfig();

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        testConfigPath,
        expect.any(String)
      );
    });

    it('should create directory if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      manager.saveConfig();

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        path.dirname(testConfigPath),
        { recursive: true }
      );
    });

    it('should emit config:saved event on success', () => {
      mockFs.existsSync.mockReturnValue(true);
      const listener = jest.fn();
      manager.on('config:saved', listener);

      manager.saveConfig();

      expect(listener).toHaveBeenCalledWith(testConfigPath);
    });

    it('should emit config:error event on failure', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Write error');
      });
      const listener = jest.fn();
      manager.on('config:error', listener);

      manager.saveConfig();

      expect(listener).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Section 3: Read Permission Checks
  // ============================================================
  describe('Read Permission Checks', () => {
    it('should allow reading files matching allowed paths', () => {
      const result = manager.checkReadPermission(path.resolve('/project/src/index.ts'));

      expect(result.allowed).toBe(true);
    });

    it('should block reading node_modules', () => {
      const result = manager.checkReadPermission(path.resolve('/project/node_modules/lodash/index.js'));

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('should block reading .env files', () => {
      const result = manager.checkReadPermission(path.resolve('/project/.env'));

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('should block reading secrets directory', () => {
      const result = manager.checkReadPermission(path.resolve('/project/secrets/api-key.txt'));

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
    });
  });

  // ============================================================
  // Section 4: Write Permission Checks
  // ============================================================
  describe('Write Permission Checks', () => {
    beforeEach(() => {
      manager.resetOperationCount();
    });

    it('should allow writing to files matching allowed paths', () => {
      const result = manager.checkWritePermission(path.resolve('/project/src/index.ts'));

      expect(result.allowed).toBe(true);
    });

    it('should block writing to node_modules', () => {
      const result = manager.checkWritePermission(path.resolve('/project/node_modules/pkg/index.js'));

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('should allow file creation when allowCreate is true', () => {
      const result = manager.checkWritePermission(path.resolve('/project/src/new-file.ts'), true);

      expect(result.allowed).toBe(true);
    });

    it('should block file creation when allowCreate is false', () => {
      manager.updateConfig({
        fileSystem: { ...manager.getConfig().fileSystem, allowCreate: false },
      });

      const result = manager.checkWritePermission(path.resolve('/project/src/new-file.ts'), true);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('creation is disabled');
    });

    it('should block writes when max operations exceeded', () => {
      manager.updateConfig({
        safety: { ...manager.getConfig().safety, maxOperationsPerSession: 2 },
      });

      manager.recordOperation();
      manager.recordOperation();

      const result = manager.checkWritePermission(path.resolve('/project/src/file.ts'));

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Maximum operations');
    });
  });

  // ============================================================
  // Section 5: Command Permission Checks
  // ============================================================
  describe('Command Permission Checks', () => {
    it('should allow git commands', () => {
      const result = manager.checkCommandPermission('git status');

      expect(result.allowed).toBe(true);
    });

    it('should allow npm commands', () => {
      const result = manager.checkCommandPermission('npm install');

      expect(result.allowed).toBe(true);
    });

    it('should block rm -rf /', () => {
      const result = manager.checkCommandPermission('rm -rf /');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('should block fork bomb', () => {
      const result = manager.checkCommandPermission(':(){:|:&};:');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('should block sudo commands by default', () => {
      const result = manager.checkCommandPermission('sudo apt-get update');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Sudo');
    });

    it('should block arbitrary commands by default', () => {
      const result = manager.checkCommandPermission('some-random-command');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not in allowed list');
    });

    it('should allow arbitrary commands when enabled', () => {
      manager.updateConfig({
        commands: { ...manager.getConfig().commands, allowArbitraryCommands: true },
      });

      const result = manager.checkCommandPermission('some-random-command');

      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
    });
  });

  // ============================================================
  // Section 6: Tool Permission Checks
  // ============================================================
  describe('Tool Permission Checks', () => {
    it('should auto-approve view_file tool', () => {
      const result = manager.checkToolPermission('view_file');

      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
    });

    it('should require confirmation for bash tool', () => {
      const result = manager.checkToolPermission('bash');

      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should block disabled tools', () => {
      manager.updateConfig({
        tools: { ...manager.getConfig().tools, disabled: ['dangerous_tool'] },
      });

      const result = manager.checkToolPermission('dangerous_tool');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('disabled');
    });
  });

  // ============================================================
  // Section 7: Network Permission Checks
  // ============================================================
  describe('Network Permission Checks', () => {
    it('should allow outgoing requests by default', () => {
      const result = manager.checkNetworkPermission('api.example.com');

      expect(result.allowed).toBe(true);
    });

    it('should block outgoing requests when disabled', () => {
      manager.updateConfig({
        network: { ...manager.getConfig().network, allowOutgoing: false },
      });

      const result = manager.checkNetworkPermission('api.example.com');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Outgoing network requests are disabled');
    });

    it('should allow localhost by default', () => {
      expect(manager.checkNetworkPermission('localhost').allowed).toBe(true);
      expect(manager.checkNetworkPermission('127.0.0.1').allowed).toBe(true);
    });

    it('should block localhost when disabled', () => {
      manager.updateConfig({
        network: { ...manager.getConfig().network, allowLocalhost: false },
      });

      const result = manager.checkNetworkPermission('localhost');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Localhost access is disabled');
    });
  });

  // ============================================================
  // Section 8: Sandbox Mode
  // ============================================================
  describe('Sandbox Mode', () => {
    it('should enable sandbox mode', () => {
      manager.enableSandbox();

      expect(manager.isSandboxed()).toBe(true);
    });

    it('should disable arbitrary commands in sandbox mode', () => {
      manager.enableSandbox();

      const config = manager.getConfig();
      expect(config.commands.allowArbitraryCommands).toBe(false);
    });

    it('should disable sudo in sandbox mode', () => {
      manager.enableSandbox();

      const config = manager.getConfig();
      expect(config.commands.allowSudo).toBe(false);
    });

    it('should emit sandbox:enabled event', () => {
      const listener = jest.fn();
      manager.on('sandbox:enabled', listener);

      manager.enableSandbox();

      expect(listener).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Section 9: Dry-Run Mode
  // ============================================================
  describe('Dry-Run Mode', () => {
    it('should enable dry-run mode', () => {
      manager.enableDryRun();

      expect(manager.isDryRun()).toBe(true);
    });

    it('should emit dryrun:enabled event', () => {
      const listener = jest.fn();
      manager.on('dryrun:enabled', listener);

      manager.enableDryRun();

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('Dry-Run Mode Default State', () => {
    // This test needs completely fresh state
    let freshManager: PermissionManager;

    beforeEach(() => {
      jest.resetAllMocks();
      mockFs.existsSync.mockReturnValue(false);
    });

    afterEach(() => {
      if (freshManager) {
        freshManager.dispose();
      }
    });

    it('should not be in dry-run mode by default', () => {
      freshManager = new PermissionManager('/fresh/config/path');
      expect(freshManager.isDryRun()).toBe(false);
    });
  });

  // ============================================================
  // Section 10: Configuration Updates
  // ============================================================
  describe('Configuration Updates', () => {
    it('should update configuration', () => {
      manager.updateConfig({
        fileSystem: { ...manager.getConfig().fileSystem, maxFileSize: 1024 },
      });

      const config = manager.getConfig();
      expect(config.fileSystem.maxFileSize).toBe(1024);
    });

    it('should emit config:updated event', () => {
      const listener = jest.fn();
      manager.on('config:updated', listener);

      manager.updateConfig({ version: '2.0.0' });

      expect(listener).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Section 11: Singleton Pattern
  // ============================================================
  describe('Singleton Pattern', () => {
    it('should return same instance from getPermissionManager', () => {
      resetPermissionManager();
      const instance1 = getPermissionManager();
      const instance2 = getPermissionManager();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getPermissionManager();
      resetPermissionManager();
      const instance2 = getPermissionManager();

      expect(instance1).not.toBe(instance2);
    });
  });

  // ============================================================
  // Section 12: Default Configuration Values
  // ============================================================
  describe('Default Configuration Values', () => {
    // These tests use a completely fresh describe block with its own beforeEach
    let freshManager: PermissionManager;

    beforeEach(() => {
      // Completely reset mock state before each test
      jest.resetAllMocks();
      mockFs.existsSync.mockReturnValue(false);
    });

    afterEach(() => {
      if (freshManager) {
        freshManager.dispose();
      }
    });

    it('should have correct default file system config', () => {
      freshManager = new PermissionManager('/fresh/config/defaults');
      const config = freshManager.getConfig();

      expect(config.fileSystem.allowedReadPaths).toEqual(['**/*']);
      expect(config.fileSystem.allowedWritePaths).toEqual(['**/*']);
      expect(config.fileSystem.blockedPaths).toContain('**/node_modules/**');
      expect(config.fileSystem.maxFileSize).toBe(10 * 1024 * 1024);
      expect(config.fileSystem.allowCreate).toBe(true);
      expect(config.fileSystem.allowDelete).toBe(true);
    });

    it('should have correct default safety config', () => {
      // Double-check that existsSync returns false
      expect(mockFs.existsSync('/fresh/config/safety')).toBe(false);

      freshManager = new PermissionManager('/fresh/config/safety');
      const config = freshManager.getConfig();

      expect(config.safety.sandboxMode).toBe(false);
      expect(config.safety.confirmDestructive).toBe(true);
      expect(config.safety.dryRunMode).toBe(false);
      expect(config.safety.maxOperationsPerSession).toBe(1000);
    });
  });

  // ============================================================
  // Section 13: Edge Cases
  // ============================================================
  describe('Edge Cases', () => {
    it('should handle empty path', () => {
      const result = manager.checkReadPermission('');

      expect(result).toBeDefined();
    });

    it('should handle empty command', () => {
      const result = manager.checkCommandPermission('');

      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // Section 14: Dispose
  // ============================================================
  describe('Dispose', () => {
    it('should remove all listeners on dispose', () => {
      const listener = jest.fn();
      manager.on('config:updated', listener);

      manager.dispose();

      expect(manager.listenerCount('config:updated')).toBe(0);
    });
  });
});
