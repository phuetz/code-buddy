/**
 * Agent Workspace Tests
 */

import * as path from 'path';
import * as os from 'os';
import fs from 'fs-extra';
import {
  AgentWorkspace,
  WorkspaceManager,
  resetWorkspaceManager,
} from '../../../src/agent/isolation/agent-workspace.js';
import { createAgentConfig } from '../../../src/agent/isolation/agent-config.js';
import type { AgentConfig } from '../../../src/agent/isolation/agent-config.js';

describe('Agent Workspace', () => {
  const testBaseDir = path.join(os.tmpdir(), 'codebuddy-test-workspaces');
  let agentConfig: AgentConfig;

  beforeEach(async () => {
    await resetWorkspaceManager();
    await fs.remove(testBaseDir);
    agentConfig = createAgentConfig('test-agent', 'coding', 'Test Agent');
  });

  afterEach(async () => {
    await resetWorkspaceManager();
    await fs.remove(testBaseDir);
  });

  describe('AgentWorkspace', () => {
    it('should create and initialize workspace', async () => {
      const workspace = new AgentWorkspace(agentConfig, 'session-1', {
        baseDir: testBaseDir,
      });

      await workspace.initialize();

      expect(workspace.getSession().agentId).toBe('test-agent');
      expect(workspace.getSession().sessionId).toBe('session-1');

      // Workspace directory should exist
      const exists = await fs.pathExists(workspace.getWorkspaceDir());
      expect(exists).toBe(true);
    });

    it('should track working directory', async () => {
      const workspace = new AgentWorkspace(agentConfig, 'session-1', {
        baseDir: testBaseDir,
      });
      await workspace.initialize();

      expect(workspace.getWorkingDirectory()).toBe(process.cwd());

      workspace.setWorkingDirectory('/tmp');
      expect(workspace.getWorkingDirectory()).toBe('/tmp');
    });

    it('should manage environment variables', async () => {
      const workspace = new AgentWorkspace(agentConfig, 'session-1', {
        baseDir: testBaseDir,
      });
      await workspace.initialize();

      workspace.setEnvironmentVariable('TEST_VAR', 'test_value');

      const env = workspace.getEnvironment();
      expect(env.TEST_VAR).toBe('test_value');
    });

    it('should track file access', async () => {
      const workspace = new AgentWorkspace(agentConfig, 'session-1', {
        baseDir: testBaseDir,
        trackFileAccess: true,
      });
      await workspace.initialize();

      workspace.trackFile('/path/to/file1.ts');
      workspace.trackFile('/path/to/file2.ts');

      const files = workspace.getActiveFiles();
      expect(files).toContain('/path/to/file1.ts');
      expect(files).toContain('/path/to/file2.ts');
    });

    it('should manage custom state', async () => {
      const workspace = new AgentWorkspace(agentConfig, 'session-1', {
        baseDir: testBaseDir,
      });
      await workspace.initialize();

      workspace.setState('myKey', { foo: 'bar' });

      const state = workspace.getState<{ foo: string }>('myKey');
      expect(state?.foo).toBe('bar');
    });

    it('should check session expiry', async () => {
      const shortTimeoutConfig = createAgentConfig('test', 'coding', 'Test', {
        sessionTimeoutMs: 100, // 100ms timeout
      });

      const workspace = new AgentWorkspace(shortTimeoutConfig, 'session-1', {
        baseDir: testBaseDir,
      });
      await workspace.initialize();

      expect(workspace.isExpired()).toBe(false);

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(workspace.isExpired()).toBe(true);
    });

    it('should save and load state', async () => {
      const workspace = new AgentWorkspace(agentConfig, 'session-1', {
        baseDir: testBaseDir,
      });
      await workspace.initialize();

      workspace.setWorkingDirectory('/custom/dir');
      workspace.setEnvironmentVariable('MY_VAR', 'my_value');
      workspace.setState('custom', { data: 123 });

      await workspace.saveState();

      // Create new workspace and load state
      const workspace2 = new AgentWorkspace(agentConfig, 'session-1', {
        baseDir: testBaseDir,
      });
      const loaded = await workspace2.loadState();

      expect(loaded).toBe(true);
      expect(workspace2.getWorkingDirectory()).toBe('/custom/dir');
      expect(workspace2.getEnvironment().MY_VAR).toBe('my_value');
      expect(workspace2.getState<{ data: number }>('custom')?.data).toBe(123);
    });
  });

  describe('WorkspaceManager', () => {
    let manager: WorkspaceManager;

    beforeEach(() => {
      manager = new WorkspaceManager({ baseDir: testBaseDir });
    });

    afterEach(async () => {
      await manager.dispose();
    });

    it('should create workspace', async () => {
      const workspace = await manager.createWorkspace(agentConfig);

      expect(workspace).toBeInstanceOf(AgentWorkspace);
      expect(manager.getWorkspace(workspace.getSession().key)).toBe(workspace);
    });

    it('should get workspace by agent ID', async () => {
      await manager.createWorkspace(agentConfig);

      const workspace = manager.getWorkspaceByAgent('test-agent');
      expect(workspace).toBeDefined();
      expect(workspace?.getAgentConfig().id).toBe('test-agent');
    });

    it('should get all workspaces for agent', async () => {
      await manager.createWorkspace(agentConfig, 'session-1');
      await manager.createWorkspace(agentConfig, 'session-2');

      const workspaces = manager.getWorkspacesForAgent('test-agent');
      expect(workspaces.length).toBe(2);
    });

    it('should remove workspace', async () => {
      const workspace = await manager.createWorkspace(agentConfig);
      const key = workspace.getSession().key;

      const removed = await manager.removeWorkspace(key);

      expect(removed).toBe(true);
      expect(manager.getWorkspace(key)).toBeUndefined();
    });

    it('should cleanup expired workspaces', async () => {
      const shortTimeoutConfig = createAgentConfig('test', 'coding', 'Test', {
        sessionTimeoutMs: 100,
      });

      await manager.createWorkspace(shortTimeoutConfig);

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 150));

      const cleaned = await manager.cleanupExpired();
      expect(cleaned).toBe(1);
      expect(manager.getActiveWorkspaces().length).toBe(0);
    });

    it('should list active workspaces', async () => {
      const config1 = createAgentConfig('agent-1', 'coding', 'Agent 1');
      const config2 = createAgentConfig('agent-2', 'research', 'Agent 2');

      await manager.createWorkspace(config1);
      await manager.createWorkspace(config2);

      const active = manager.getActiveWorkspaces();
      expect(active.length).toBe(2);
    });

    it('should clear all workspaces', async () => {
      await manager.createWorkspace(agentConfig, 'session-1');
      await manager.createWorkspace(agentConfig, 'session-2');

      await manager.clearAll();

      expect(manager.getActiveWorkspaces().length).toBe(0);
    });
  });
});
