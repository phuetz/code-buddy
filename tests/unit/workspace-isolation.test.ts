/**
 * Tests for Workspace Isolation Module
 */

import * as path from 'path';
import * as os from 'os';
import {
  WorkspaceIsolation,
  getWorkspaceIsolation,
  resetWorkspaceIsolation,
  initializeWorkspaceIsolation,
  validateWorkspacePath,
  isPathInWorkspace,
} from '../../src/workspace/workspace-isolation';

describe('WorkspaceIsolation', () => {
  const testWorkspace = '/home/user/project';
  let isolation: WorkspaceIsolation;

  beforeEach(() => {
    resetWorkspaceIsolation();
    isolation = new WorkspaceIsolation({
      workspaceRoot: testWorkspace,
      enabled: true,
    });
  });

  afterEach(() => {
    resetWorkspaceIsolation();
  });

  describe('Path Validation', () => {
    it('should allow paths within workspace', () => {
      const result = isolation.validatePath('/home/user/project/src/file.ts');
      expect(result.valid).toBe(true);
      expect(result.resolved).toBe('/home/user/project/src/file.ts');
    });

    it('should allow the workspace root itself', () => {
      const result = isolation.validatePath('/home/user/project');
      expect(result.valid).toBe(true);
    });

    it('should block paths outside workspace', () => {
      const result = isolation.validatePath('/home/user/other-project/file.ts');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('outside_workspace');
    });

    it('should block path traversal attempts', () => {
      const result = isolation.validatePath('/home/user/project/../other/file.ts');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('outside_workspace');
    });

    it('should block access to sensitive paths', () => {
      const sshPath = path.join(os.homedir(), '.ssh', 'id_rsa');
      const result = isolation.validatePath(sshPath);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('blocked_path');
    });

    it('should block access to AWS credentials', () => {
      const awsPath = path.join(os.homedir(), '.aws', 'credentials');
      const result = isolation.validatePath(awsPath);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('blocked_path');
    });

    it('should block /etc/passwd', () => {
      const result = isolation.validatePath('/etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('blocked_path');
    });
  });

  describe('System Whitelist', () => {
    it('should allow access to tmp directory', () => {
      const tmpPath = path.join(os.tmpdir(), 'test-file.txt');
      const result = isolation.validatePath(tmpPath);
      expect(result.valid).toBe(true);
    });

    it('should allow access to npm cache', () => {
      const npmPath = path.join(os.homedir(), '.npm', 'some-package');
      const result = isolation.validatePath(npmPath);
      expect(result.valid).toBe(true);
    });

    it('should allow access to CodeBuddy config', () => {
      const configPath = path.join(os.homedir(), '.codebuddy', 'settings.json');
      const result = isolation.validatePath(configPath);
      expect(result.valid).toBe(true);
    });

    it('should block CodeBuddy credentials even though .codebuddy is whitelisted', () => {
      const credsPath = path.join(os.homedir(), '.codebuddy', 'credentials.enc');
      const result = isolation.validatePath(credsPath);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('blocked_path');
    });
  });

  describe('Configuration', () => {
    it('should allow all paths when disabled', () => {
      isolation.setEnabled(false);
      const result = isolation.validatePath('/some/random/path');
      expect(result.valid).toBe(true);
    });

    it('should update workspace root', () => {
      isolation.setWorkspaceRoot('/new/workspace');
      const result = isolation.validatePath('/new/workspace/file.ts');
      expect(result.valid).toBe(true);

      const oldResult = isolation.validatePath('/home/user/project/file.ts');
      expect(oldResult.valid).toBe(false);
    });

    it('should add additional allowed paths', () => {
      isolation.addAllowedPath('/custom/allowed/path');
      const result = isolation.validatePath('/custom/allowed/path/file.ts');
      expect(result.valid).toBe(true);
    });
  });

  describe('Convenience Functions', () => {
    it('isSafe should return boolean', () => {
      expect(isolation.isSafe('/home/user/project/file.ts')).toBe(true);
      expect(isolation.isSafe('/etc/passwd')).toBe(false);
    });

    it('resolveOrThrow should throw for invalid paths', () => {
      expect(() => {
        isolation.resolveOrThrow('/etc/shadow');
      }).toThrow();
    });

    it('resolveOrThrow should return resolved path for valid paths', () => {
      const resolved = isolation.resolveOrThrow('/home/user/project/file.ts');
      expect(resolved).toBe('/home/user/project/file.ts');
    });
  });

  describe('Blocked Access Logging', () => {
    it('should log blocked access attempts', () => {
      isolation.validatePath('/etc/passwd', 'read file');
      const log = isolation.getBlockedAccessLog();
      expect(log.length).toBe(1);
      expect(log[0].operation).toBe('read file');
      expect(log[0].reason).toContain('blocked_path');
    });

    it('should clear blocked access log', () => {
      isolation.validatePath('/etc/passwd');
      isolation.clearBlockedAccessLog();
      expect(isolation.getBlockedAccessLog().length).toBe(0);
    });

    it('should keep only last 100 entries', () => {
      for (let i = 0; i < 110; i++) {
        isolation.validatePath(`/blocked/path/${i}`);
      }
      expect(isolation.getBlockedAccessLog().length).toBe(100);
    });
  });

  describe('Multiple Path Validation', () => {
    it('should validate multiple paths at once', () => {
      const result = isolation.validatePaths([
        '/home/user/project/a.ts',
        '/home/user/project/b.ts',
        '/etc/passwd',
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.results.size).toBe(3);
    });

    it('should return valid when all paths are valid', () => {
      const result = isolation.validatePaths([
        '/home/user/project/a.ts',
        '/home/user/project/b.ts',
      ]);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });
});

describe('Singleton Functions', () => {
  beforeEach(() => {
    resetWorkspaceIsolation();
  });

  afterEach(() => {
    resetWorkspaceIsolation();
  });

  it('getWorkspaceIsolation should return singleton', () => {
    const a = getWorkspaceIsolation();
    const b = getWorkspaceIsolation();
    expect(a).toBe(b);
  });

  it('initializeWorkspaceIsolation should configure correctly', () => {
    const isolation = initializeWorkspaceIsolation({
      allowOutside: true,
      directory: '/test/dir',
    });
    expect(isolation.getConfig().enabled).toBe(false);
    expect(isolation.getConfig().workspaceRoot).toBe('/test/dir');
  });

  it('validateWorkspacePath should use singleton', () => {
    initializeWorkspaceIsolation({ directory: '/workspace' });
    const result = validateWorkspacePath('/workspace/file.ts');
    expect(result.valid).toBe(true);
  });

  it('isPathInWorkspace should use singleton', () => {
    initializeWorkspaceIsolation({ directory: '/workspace' });
    expect(isPathInWorkspace('/workspace/file.ts')).toBe(true);
    expect(isPathInWorkspace('/other/file.ts')).toBe(false);
  });
});
