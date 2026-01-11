/**
 * Approval Modes Tests
 *
 * Tests for the three-tier approval system:
 * - Mode configuration and switching
 * - Operation classification
 * - Approval checking logic
 * - Session approval memory
 * - Statistics tracking
 * - Event emission
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

// Mock the json-validator
jest.mock('../../src/utils/json-validator.js', () => ({
  parseJSONSafe: jest.fn().mockImplementation((content: string) => {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }),
  ApprovalModeConfigSchema: {},
}));

import {
  ApprovalModeManager,
  getApprovalModeManager,
  resetApprovalModeManager,
  type ApprovalMode,
  type OperationType,
  type OperationRequest,
} from '../../src/security/approval-modes.js';

describe('ApprovalModeManager', () => {
  let manager: ApprovalModeManager;

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    manager = new ApprovalModeManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('Constructor', () => {
    it('should create manager with default mode', () => {
      expect(manager).toBeInstanceOf(ApprovalModeManager);
      expect(manager.getMode()).toBe('auto');
    });

    it('should be an EventEmitter', () => {
      expect(manager).toBeInstanceOf(EventEmitter);
    });

    it('should use custom config path', () => {
      const customPath = '/custom/path/config.json';
      const customManager = new ApprovalModeManager(customPath);
      expect(customManager.getMode()).toBe('auto');
      customManager.dispose();
    });

    it('should load mode from config file if exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('{"mode": "read-only"}');

      const loadedManager = new ApprovalModeManager();
      expect(loadedManager.getMode()).toBe('read-only');
      loadedManager.dispose();
    });

    it('should use default mode on invalid config', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid json');

      const loadedManager = new ApprovalModeManager();
      expect(loadedManager.getMode()).toBe('auto');
      loadedManager.dispose();
    });
  });

  describe('Mode Management', () => {
    it('should set mode to read-only', () => {
      manager.setMode('read-only');
      expect(manager.getMode()).toBe('read-only');
    });

    it('should set mode to auto', () => {
      manager.setMode('read-only');
      manager.setMode('auto');
      expect(manager.getMode()).toBe('auto');
    });

    it('should set mode to full-access', () => {
      manager.setMode('full-access');
      expect(manager.getMode()).toBe('full-access');
    });

    it('should emit mode:changed event', () => {
      const handler = jest.fn();
      manager.on('mode:changed', handler);

      manager.setMode('full-access');

      expect(handler).toHaveBeenCalledWith({
        previousMode: 'auto',
        newMode: 'full-access',
      });
    });

    it('should clear session approvals on mode change', () => {
      const request: OperationRequest = {
        type: 'file-write',
        tool: 'write',
        target: '/test.txt',
      };

      manager.rememberApproval(request, true);
      manager.setMode('full-access');

      // Session approvals are cleared
      const result = manager.checkApproval(request);
      expect(result.reason).not.toBe('Previously approved this session');
    });

    it('should get mode configuration', () => {
      const config = manager.getModeConfig();

      expect(config.mode).toBe('auto');
      expect(config.description).toContain('Auto mode');
      expect(config.autoApproveTypes).toContain('file-read');
      expect(config.requireConfirmTypes).toContain('file-write');
    });
  });

  describe('Config Persistence', () => {
    it('should save config to file', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      manager.saveConfig();

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should create directory if not exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      manager.saveConfig();

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it('should emit config:saved event on success', () => {
      const handler = jest.fn();
      manager.on('config:saved', handler);
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      manager.saveConfig();

      expect(handler).toHaveBeenCalledWith('auto');
    });

    it('should emit config:error event on failure', () => {
      const handler = jest.fn();
      manager.on('config:error', handler);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Write error');
      });

      manager.saveConfig();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Approval Checking - Read-Only Mode', () => {
    beforeEach(() => {
      manager.setMode('read-only');
    });

    it('should auto-approve file reads', () => {
      const result = manager.checkApproval({
        type: 'file-read',
        tool: 'view_file',
        target: '/test.ts',
      });

      expect(result.approved).toBe(true);
      expect(result.autoApproved).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
    });

    it('should auto-approve searches', () => {
      const result = manager.checkApproval({
        type: 'search',
        tool: 'search',
      });

      expect(result.approved).toBe(true);
      expect(result.autoApproved).toBe(true);
    });

    it('should auto-approve network fetches', () => {
      const result = manager.checkApproval({
        type: 'network-fetch',
        tool: 'web_fetch',
        target: 'https://example.com',
      });

      expect(result.approved).toBe(true);
      expect(result.autoApproved).toBe(true);
    });

    it('should block file writes', () => {
      const result = manager.checkApproval({
        type: 'file-write',
        tool: 'write',
        target: '/test.ts',
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('should block file creates', () => {
      const result = manager.checkApproval({
        type: 'file-create',
        tool: 'create_file',
        target: '/new.ts',
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('should block file deletes', () => {
      const result = manager.checkApproval({
        type: 'file-delete',
        tool: 'delete',
        target: '/test.ts',
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('should block all commands', () => {
      const result = manager.checkApproval({
        type: 'command-safe',
        tool: 'bash',
        command: 'ls',
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toContain('blocked');
    });
  });

  describe('Approval Checking - Auto Mode', () => {
    beforeEach(() => {
      manager.setMode('auto');
    });

    it('should auto-approve file reads', () => {
      const result = manager.checkApproval({
        type: 'file-read',
        tool: 'view_file',
      });

      expect(result.approved).toBe(true);
      expect(result.autoApproved).toBe(true);
    });

    it('should auto-approve safe commands', () => {
      const result = manager.checkApproval({
        type: 'command-safe',
        tool: 'bash',
        command: 'ls -la',
      });

      expect(result.approved).toBe(true);
      expect(result.autoApproved).toBe(true);
    });

    it('should require confirmation for file writes', () => {
      const result = manager.checkApproval({
        type: 'file-write',
        tool: 'write',
        target: '/test.ts',
      });

      expect(result.approved).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should require confirmation for file creates', () => {
      const result = manager.checkApproval({
        type: 'file-create',
        tool: 'create_file',
      });

      expect(result.approved).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should require confirmation for file deletes', () => {
      const result = manager.checkApproval({
        type: 'file-delete',
        tool: 'delete',
      });

      expect(result.approved).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should require confirmation for network commands', () => {
      const result = manager.checkApproval({
        type: 'command-network',
        tool: 'bash',
        command: 'npm install',
      });

      expect(result.approved).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should require confirmation for system commands', () => {
      const result = manager.checkApproval({
        type: 'command-system',
        tool: 'bash',
        command: 'docker build',
      });

      expect(result.approved).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should block destructive commands', () => {
      const result = manager.checkApproval({
        type: 'command-destructive',
        tool: 'bash',
        command: 'rm -rf /',
      });

      expect(result.approved).toBe(false);
      expect(result.requiresConfirmation).toBe(false);
      expect(result.reason).toContain('blocked');
    });
  });

  describe('Approval Checking - Full Access Mode', () => {
    beforeEach(() => {
      manager.setMode('full-access');
    });

    it('should auto-approve file reads', () => {
      const result = manager.checkApproval({
        type: 'file-read',
        tool: 'view_file',
      });

      expect(result.approved).toBe(true);
      expect(result.autoApproved).toBe(true);
    });

    it('should auto-approve file writes', () => {
      const result = manager.checkApproval({
        type: 'file-write',
        tool: 'write',
      });

      expect(result.approved).toBe(true);
      expect(result.autoApproved).toBe(true);
    });

    it('should auto-approve file creates', () => {
      const result = manager.checkApproval({
        type: 'file-create',
        tool: 'create_file',
      });

      expect(result.approved).toBe(true);
      expect(result.autoApproved).toBe(true);
    });

    it('should auto-approve file deletes', () => {
      const result = manager.checkApproval({
        type: 'file-delete',
        tool: 'delete',
      });

      expect(result.approved).toBe(true);
      expect(result.autoApproved).toBe(true);
    });

    it('should auto-approve network commands', () => {
      const result = manager.checkApproval({
        type: 'command-network',
        tool: 'bash',
        command: 'npm install',
      });

      expect(result.approved).toBe(true);
      expect(result.autoApproved).toBe(true);
    });

    it('should auto-approve system commands', () => {
      const result = manager.checkApproval({
        type: 'command-system',
        tool: 'bash',
        command: 'docker build',
      });

      expect(result.approved).toBe(true);
      expect(result.autoApproved).toBe(true);
    });

    it('should require confirmation for destructive commands', () => {
      const result = manager.checkApproval({
        type: 'command-destructive',
        tool: 'bash',
        command: 'rm -rf /',
      });

      expect(result.approved).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
    });
  });

  describe('Operation Classification', () => {
    it('should classify view_file as file-read', () => {
      const result = manager.checkApproval({
        type: 'unknown',
        tool: 'view_file',
      });

      // Verify through history
      const history = manager.getOperationHistory();
      expect(history[history.length - 1].type).toBe('file-read');
    });

    it('should classify read as file-read', () => {
      manager.checkApproval({ type: 'unknown', tool: 'read' });

      const history = manager.getOperationHistory();
      expect(history[history.length - 1].type).toBe('file-read');
    });

    it('should classify create_file as file-create', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      manager.checkApproval({
        type: 'unknown',
        tool: 'create_file',
        target: '/new.ts',
      });

      const history = manager.getOperationHistory();
      expect(history[history.length - 1].type).toBe('file-create');
    });

    it('should classify search as search', () => {
      manager.checkApproval({ type: 'unknown', tool: 'search' });

      const history = manager.getOperationHistory();
      expect(history[history.length - 1].type).toBe('search');
    });

    it('should classify grep as search', () => {
      manager.checkApproval({ type: 'unknown', tool: 'grep' });

      const history = manager.getOperationHistory();
      expect(history[history.length - 1].type).toBe('search');
    });

    it('should classify web_fetch as network-fetch', () => {
      manager.checkApproval({ type: 'unknown', tool: 'web_fetch' });

      const history = manager.getOperationHistory();
      expect(history[history.length - 1].type).toBe('network-fetch');
    });

    it('should classify bash with safe command as command-safe', () => {
      manager.checkApproval({
        type: 'unknown',
        tool: 'bash',
        command: 'ls',
      });

      const history = manager.getOperationHistory();
      expect(history[history.length - 1].type).toBe('command-safe');
    });

    it('should classify bash with network command as command-network', () => {
      manager.checkApproval({
        type: 'unknown',
        tool: 'bash',
        command: 'curl https://example.com',
      });

      const history = manager.getOperationHistory();
      expect(history[history.length - 1].type).toBe('command-network');
    });

    it('should classify bash with system command as command-system', () => {
      manager.checkApproval({
        type: 'unknown',
        tool: 'bash',
        command: 'docker ps',
      });

      const history = manager.getOperationHistory();
      expect(history[history.length - 1].type).toBe('command-system');
    });

    it('should classify rm -rf / as command-destructive', () => {
      manager.checkApproval({
        type: 'unknown',
        tool: 'bash',
        command: 'rm -rf /',
      });

      const history = manager.getOperationHistory();
      expect(history[history.length - 1].type).toBe('command-destructive');
    });

    it('should classify sudo rm as command-destructive', () => {
      manager.checkApproval({
        type: 'unknown',
        tool: 'bash',
        command: 'sudo rm -rf /tmp',
      });

      const history = manager.getOperationHistory();
      expect(history[history.length - 1].type).toBe('command-destructive');
    });

    it('should classify git status as command-safe', () => {
      manager.checkApproval({
        type: 'unknown',
        tool: 'bash',
        command: 'git status',
      });

      const history = manager.getOperationHistory();
      expect(history[history.length - 1].type).toBe('command-safe');
    });

    it('should classify git commit as command-system', () => {
      manager.checkApproval({
        type: 'unknown',
        tool: 'bash',
        command: 'git commit -m "test"',
      });

      const history = manager.getOperationHistory();
      expect(history[history.length - 1].type).toBe('command-system');
    });
  });

  describe('Session Approvals', () => {
    it('should remember approval for session', () => {
      const request: OperationRequest = {
        type: 'file-write',
        tool: 'write',
        target: '/test.ts',
      };

      manager.rememberApproval(request, true);

      const result = manager.checkApproval(request);
      expect(result.approved).toBe(true);
      expect(result.autoApproved).toBe(true);
      expect(result.reason).toContain('Previously approved');
    });

    it('should remember denial for session', () => {
      const request: OperationRequest = {
        type: 'file-write',
        tool: 'write',
        target: '/test.ts',
      };

      manager.rememberApproval(request, false);

      const result = manager.checkApproval(request);
      expect(result.approved).toBe(false);
    });

    it('should emit session:approval-remembered event', () => {
      const handler = jest.fn();
      manager.on('session:approval-remembered', handler);

      manager.rememberApproval({ type: 'file-write', tool: 'write' }, true);

      expect(handler).toHaveBeenCalled();
    });

    it('should clear session approvals', () => {
      const request: OperationRequest = {
        type: 'file-write',
        tool: 'write',
        target: '/test.ts',
      };

      manager.rememberApproval(request, true);
      manager.clearSessionApprovals();

      const result = manager.checkApproval(request);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should emit session:approvals-cleared event', () => {
      const handler = jest.fn();
      manager.on('session:approvals-cleared', handler);

      manager.clearSessionApprovals();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Operation History', () => {
    it('should track operation history', () => {
      manager.checkApproval({ type: 'file-read', tool: 'view_file' });
      manager.checkApproval({ type: 'search', tool: 'search' });
      manager.checkApproval({ type: 'file-write', tool: 'write' });

      const history = manager.getOperationHistory();
      expect(history).toHaveLength(3);
    });

    it('should return copy of history', () => {
      manager.checkApproval({ type: 'file-read', tool: 'view_file' });

      const history1 = manager.getOperationHistory();
      const history2 = manager.getOperationHistory();

      expect(history1).not.toBe(history2);
    });
  });

  describe('Statistics', () => {
    it('should track total operations', () => {
      manager.checkApproval({ type: 'file-read', tool: 'view_file' });
      manager.checkApproval({ type: 'search', tool: 'search' });
      manager.checkApproval({ type: 'file-write', tool: 'write' });

      const stats = manager.getStats();
      expect(stats.totalOperations).toBe(3);
    });

    it('should track operations by type', () => {
      manager.checkApproval({ type: 'file-read', tool: 'view_file' });
      manager.checkApproval({ type: 'file-read', tool: 'view_file' });
      manager.checkApproval({ type: 'search', tool: 'search' });

      const stats = manager.getStats();
      expect(stats.byType['file-read']).toBe(2);
      expect(stats.byType['search']).toBe(1);
    });

    it('should track auto-approved count', () => {
      manager.checkApproval({ type: 'file-read', tool: 'view_file' });
      manager.checkApproval({ type: 'search', tool: 'search' });

      const stats = manager.getStats();
      expect(stats.autoApproved).toBe(2);
    });

    it('should track blocked count in read-only mode', () => {
      manager.setMode('read-only');
      manager.checkApproval({ type: 'file-write', tool: 'write' });
      manager.checkApproval({ type: 'command-safe', tool: 'bash' });

      const stats = manager.getStats();
      expect(stats.blocked).toBe(2);
    });
  });

  describe('Available Modes', () => {
    it('should return all available modes', () => {
      const modes = manager.getAvailableModes();

      expect(modes).toHaveLength(3);
      expect(modes.map((m) => m.mode)).toContain('read-only');
      expect(modes.map((m) => m.mode)).toContain('auto');
      expect(modes.map((m) => m.mode)).toContain('full-access');
    });
  });

  describe('Format Mode', () => {
    it('should format read-only mode', () => {
      const formatted = manager.formatMode('read-only');
      expect(formatted).toContain('read-only');
      expect(formatted).toContain('Read-only');
    });

    it('should format auto mode', () => {
      const formatted = manager.formatMode('auto');
      expect(formatted).toContain('auto');
      expect(formatted).toContain('Auto');
    });

    it('should format full-access mode', () => {
      const formatted = manager.formatMode('full-access');
      expect(formatted).toContain('full-access');
      expect(formatted).toContain('Full');
    });
  });

  describe('Help Text', () => {
    it('should return help text', () => {
      const help = manager.getHelpText();

      expect(help).toContain('Approval Modes');
      expect(help).toContain('read-only');
      expect(help).toContain('auto');
      expect(help).toContain('full-access');
      expect(help).toContain('/mode');
    });
  });

  describe('Events', () => {
    it('should emit operation:auto-approved on auto approval', () => {
      const handler = jest.fn();
      manager.on('operation:auto-approved', handler);

      manager.checkApproval({ type: 'file-read', tool: 'view_file' });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Dispose', () => {
    it('should remove all listeners on dispose', () => {
      const handler = jest.fn();
      manager.on('mode:changed', handler);

      manager.dispose();

      expect(manager.listenerCount('mode:changed')).toBe(0);
    });
  });
});

describe('Singleton Management', () => {
  beforeEach(() => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    resetApprovalModeManager();
  });

  afterEach(() => {
    resetApprovalModeManager();
  });

  it('should return same instance on multiple calls', () => {
    const instance1 = getApprovalModeManager();
    const instance2 = getApprovalModeManager();

    expect(instance1).toBe(instance2);
  });

  it('should create new instance after reset', () => {
    const instance1 = getApprovalModeManager();
    resetApprovalModeManager();
    const instance2 = getApprovalModeManager();

    expect(instance1).not.toBe(instance2);
  });

  it('should use custom config path', () => {
    const manager = getApprovalModeManager('/custom/path.json');
    expect(manager).toBeInstanceOf(ApprovalModeManager);
  });
});

describe('Edge Cases', () => {
  let manager: ApprovalModeManager;

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    manager = new ApprovalModeManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  it('should handle unknown operation type', () => {
    const result = manager.checkApproval({
      type: 'unknown',
      tool: 'custom_tool',
    });

    expect(result.requiresConfirmation).toBe(true);
    expect(result.reason).toContain('Unknown');
  });

  it('should handle empty command', () => {
    const result = manager.checkApproval({
      type: 'unknown',
      tool: 'bash',
      command: '',
    });

    // Empty command defaults to system command
    const history = manager.getOperationHistory();
    expect(history[history.length - 1].type).toBe('command-system');
  });

  it('should handle fork bomb pattern', () => {
    // Fork bomb without spaces to match regex pattern exactly
    manager.checkApproval({
      type: 'unknown',
      tool: 'bash',
      command: ':(){:|:&};:',
    });

    const history = manager.getOperationHistory();
    expect(history[history.length - 1].type).toBe('command-destructive');
  });

  it('should handle dd command', () => {
    manager.checkApproval({
      type: 'unknown',
      tool: 'bash',
      command: 'dd if=/dev/zero of=/dev/sda',
    });

    const history = manager.getOperationHistory();
    expect(history[history.length - 1].type).toBe('command-destructive');
  });

  it('should preserve request type if not unknown', () => {
    manager.checkApproval({
      type: 'file-read',
      tool: 'custom_tool',
    });

    const history = manager.getOperationHistory();
    expect(history[history.length - 1].type).toBe('file-read');
  });
});
