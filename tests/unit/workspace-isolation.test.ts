/**
 * Tests for Workspace Isolation Module
 */

import * as path from 'path';
import * as os from 'os';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
      const filePath = path.join(testWorkspace, 'src', 'file.ts');
      const result = isolation.validatePath(filePath);
      expect(result.valid).toBe(true);
      expect(result.resolved).toBe(path.resolve(filePath));
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

    it('should scope an embedded actor workspace to its async turn', async () => {
      const parent = mkdtempSync(path.join(process.cwd(), '.codebuddy-scoped-workspace-'));
      const voiceRoot = path.join(parent, 'voice-repo');
      mkdirSync(voiceRoot);
      const target = path.join(voiceRoot, 'package.json');
      try {
        expect(isolation.validatePath(target).valid).toBe(false);
        await isolation.withWorkspaceRootAsync(voiceRoot, async () => {
          expect(isolation.validatePath(target).valid).toBe(true);
          await Promise.resolve();
          expect(isolation.validatePath(target).valid).toBe(true);
        });
        expect(isolation.validatePath(target).valid).toBe(false);
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    });

    it('should keep canonical containment for a symlinked scoped workspace', async () => {
      const parent = mkdtempSync(path.join(process.cwd(), '.codebuddy-symlink-workspace-'));
      const realRoot = path.join(parent, 'real');
      const linkedRoot = path.join(parent, 'linked');
      mkdirSync(realRoot);
      symlinkSync(realRoot, linkedRoot, 'dir');
      try {
        await isolation.withWorkspaceRootAsync(linkedRoot, async () => {
          expect(isolation.validatePath(path.join(linkedRoot, 'inside.ts')).valid).toBe(true);
          expect(isolation.validatePath(path.join(realRoot, 'inside.ts')).valid).toBe(true);
        });
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    });

    it('should reject a symlink escape below a scoped workspace', async () => {
      const parent = mkdtempSync(path.join(process.cwd(), '.codebuddy-symlink-escape-'));
      const voiceRoot = path.join(parent, 'voice');
      const outsideRoot = path.join(parent, 'outside');
      mkdirSync(voiceRoot);
      mkdirSync(outsideRoot);
      writeFileSync(path.join(outsideRoot, 'secret.txt'), 'private');
      symlinkSync(outsideRoot, path.join(voiceRoot, 'escape'), 'dir');
      try {
        await isolation.withWorkspaceRootAsync(voiceRoot, async () => {
          const result = isolation.validatePath(path.join(voiceRoot, 'escape', 'secret.txt'));
          expect(result.valid).toBe(false);
          expect(result.reason).toBe('symlink_escape');
        });
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    });

    it('should reject creating a missing file through a symlinked parent', () => {
      const parent = mkdtempSync(path.join(process.cwd(), '.codebuddy-create-symlink-escape-'));
      const workspace = path.join(parent, 'workspace');
      const outside = path.join(parent, 'outside');
      mkdirSync(workspace);
      mkdirSync(outside);
      symlinkSync(outside, path.join(workspace, 'escape'), 'dir');
      const scoped = new WorkspaceIsolation({ workspaceRoot: workspace });

      try {
        const target = path.join(workspace, 'escape', 'new-file.txt');
        const result = scoped.validatePath(target, 'create file');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('symlink_escape');
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    });

    it('should keep the global bot workspace blocked while a voice turn is active', async () => {
      const parent = mkdtempSync(path.join(process.cwd(), '.codebuddy-concurrent-workspace-'));
      const voiceRoot = path.join(parent, 'code-buddy');
      mkdirSync(voiceRoot);
      const voiceFile = path.join(voiceRoot, 'package.json');
      let releaseVoice!: () => void;
      const gate = new Promise<void>((resolve) => { releaseVoice = resolve; });
      let reportStarted!: () => void;
      const started = new Promise<void>((resolve) => { reportStarted = resolve; });
      try {
        const voice = isolation.withWorkspaceRootAsync(voiceRoot, async () => {
          reportStarted();
          expect(isolation.validatePath(voiceFile).valid).toBe(true);
          await gate;
        });
        await started;
        expect(isolation.validatePath(voiceFile).valid).toBe(false);
        releaseVoice();
        await voice;
      } finally {
        releaseVoice?.();
        rmSync(parent, { recursive: true, force: true });
      }
    });

    it('should reject protected and unavailable scoped workspace roots', async () => {
      await expect(
        isolation.withWorkspaceRootAsync(path.join(os.homedir(), '.ssh'), async () => undefined)
      ).rejects.toThrow(/protected/i);
      await expect(
        isolation.withWorkspaceRootAsync(
          path.join(process.cwd(), '.workspace-that-does-not-exist'),
          async () => undefined
        )
      ).rejects.toThrow(/unavailable/i);
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
      const filePath = path.join(testWorkspace, 'file.ts');
      const resolved = isolation.resolveOrThrow(filePath);
      expect(resolved).toBe(path.resolve(filePath));
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
    const testDir = path.resolve('/test/dir');
    const isolation = initializeWorkspaceIsolation({
      allowOutside: true,
      directory: '/test/dir',
    });
    expect(isolation.getConfig().enabled).toBe(false);
    expect(isolation.getConfig().workspaceRoot).toBe(testDir);
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
