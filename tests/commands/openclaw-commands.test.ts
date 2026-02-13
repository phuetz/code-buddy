/**
 * Tests for OpenClaw-inspired CLI Commands
 *
 * Tests covering all 5 command groups:
 * - registerHeartbeatCommands (start, stop, status, tick)
 * - registerHubCommands (search, install, uninstall, update, list, info, publish, sync)
 * - registerIdentityCommands (show, get, set, prompt)
 * - registerGroupCommands (status, list, block, unblock)
 * - registerAuthProfileCommands (list, add, remove, reset)
 */

import { Command } from 'commander';
import {
  registerHeartbeatCommands,
  registerHubCommands,
  registerIdentityCommands,
  registerGroupCommands,
  registerAuthProfileCommands,
} from '../../src/commands/cli/openclaw-commands';

// ============================================================================
// Mocks for dynamic imports
// ============================================================================

const mockEngine = {
  start: jest.fn(),
  stop: jest.fn(),
  getStatus: jest.fn(),
  tick: jest.fn(),
};

jest.mock('../../src/daemon/heartbeat.js', () => ({
  getHeartbeatEngine: jest.fn((_opts?: unknown) => mockEngine),
}));

const mockSkillsHub = {
  search: jest.fn(),
  install: jest.fn(),
  uninstall: jest.fn(),
  update: jest.fn(),
  list: jest.fn(),
  info: jest.fn(),
  publish: jest.fn(),
  sync: jest.fn(),
};

jest.mock('../../src/skills/hub.js', () => ({
  getSkillsHub: jest.fn(() => mockSkillsHub),
}));

const mockIdentityManager = {
  load: jest.fn(),
  getAll: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  getPromptInjection: jest.fn(),
};

jest.mock('../../src/identity/identity-manager.js', () => ({
  getIdentityManager: jest.fn(() => mockIdentityManager),
}));

const mockGroupSecurity = {
  getStats: jest.fn(),
  listGroups: jest.fn(),
  addToBlocklist: jest.fn(),
  removeFromBlocklist: jest.fn(),
};

jest.mock('../../src/channels/group-security.js', () => ({
  getGroupSecurity: jest.fn(() => mockGroupSecurity),
}));

const mockAuthProfileManager = {
  getStatus: jest.fn(),
  addProfile: jest.fn(),
  removeProfile: jest.fn(),
};

jest.mock('../../src/auth/profile-manager.js', () => ({
  getAuthProfileManager: jest.fn(() => mockAuthProfileManager),
  resetAuthProfileManager: jest.fn(),
}));

// ============================================================================
// Test helpers
// ============================================================================

let consoleLogSpy: jest.SpyInstance;
let consoleErrorSpy: jest.SpyInstance;
let processExitSpy: jest.SpyInstance;

function createProgram(): Command {
  const program = new Command();
  program.exitOverride(); // Prevent Commander from calling process.exit
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  return program;
}

function getLogOutput(): string {
  return consoleLogSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
}

function getErrorOutput(): string {
  return consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
}

// ============================================================================
// Tests
// ============================================================================

describe('OpenClaw CLI Commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      // Do not actually exit
    }) as unknown as (code?: string | number | null | undefined) => never);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  // ==========================================================================
  // Heartbeat Commands
  // ==========================================================================

  describe('registerHeartbeatCommands', () => {
    let program: Command;

    beforeEach(() => {
      program = createProgram();
      registerHeartbeatCommands(program);
    });

    describe('heartbeat start', () => {
      it('should start engine with default interval', async () => {
        await program.parseAsync(['node', 'test', 'heartbeat', 'start']);

        const { getHeartbeatEngine } = require('../../src/daemon/heartbeat.js');
        expect(getHeartbeatEngine).toHaveBeenCalledWith({ intervalMs: 1800000 });
        expect(mockEngine.start).toHaveBeenCalled();
        expect(getLogOutput()).toContain('Heartbeat started (interval: 1800s)');
      });

      it('should start engine with custom interval', async () => {
        await program.parseAsync(['node', 'test', 'heartbeat', 'start', '--interval', '60000']);

        const { getHeartbeatEngine } = require('../../src/daemon/heartbeat.js');
        expect(getHeartbeatEngine).toHaveBeenCalledWith({ intervalMs: 60000 });
        expect(mockEngine.start).toHaveBeenCalled();
        expect(getLogOutput()).toContain('Heartbeat started (interval: 60s)');
      });
    });

    describe('heartbeat stop', () => {
      it('should stop the engine', async () => {
        await program.parseAsync(['node', 'test', 'heartbeat', 'stop']);

        expect(mockEngine.stop).toHaveBeenCalled();
        expect(getLogOutput()).toContain('Heartbeat stopped');
      });
    });

    describe('heartbeat status', () => {
      it('should display full status with all fields', async () => {
        const lastRun = new Date('2025-01-15T10:00:00Z');
        const nextRun = new Date('2025-01-15T10:30:00Z');
        mockEngine.getStatus.mockReturnValue({
          running: true,
          enabled: true,
          totalTicks: 42,
          totalSuppressions: 3,
          consecutiveSuppressions: 1,
          lastRunTime: lastRun,
          nextRunTime: nextRun,
          lastResult: 'All tasks completed successfully',
        });

        await program.parseAsync(['node', 'test', 'heartbeat', 'status']);

        const output = getLogOutput();
        expect(output).toContain('Heartbeat Engine');
        expect(output).toContain('Running: YES');
        expect(output).toContain('Enabled: YES');
        expect(output).toContain('Total ticks: 42');
        expect(output).toContain('Suppressions: 3 (consecutive: 1)');
        expect(output).toContain('Last run: 2025-01-15T10:00:00.000Z');
        expect(output).toContain('Next run: 2025-01-15T10:30:00.000Z');
        expect(output).toContain('Last result: All tasks completed successfully');
      });

      it('should display minimal status when not running', async () => {
        mockEngine.getStatus.mockReturnValue({
          running: false,
          enabled: false,
          totalTicks: 0,
          totalSuppressions: 0,
          consecutiveSuppressions: 0,
          lastRunTime: null,
          nextRunTime: null,
          lastResult: null,
        });

        await program.parseAsync(['node', 'test', 'heartbeat', 'status']);

        const output = getLogOutput();
        expect(output).toContain('Running: NO');
        expect(output).toContain('Enabled: NO');
        expect(output).toContain('Total ticks: 0');
        expect(output).not.toContain('Last run:');
        expect(output).not.toContain('Next run:');
        expect(output).not.toContain('Last result:');
      });

      it('should truncate lastResult to 200 chars', async () => {
        const longResult = 'A'.repeat(300);
        mockEngine.getStatus.mockReturnValue({
          running: true,
          enabled: true,
          totalTicks: 1,
          totalSuppressions: 0,
          consecutiveSuppressions: 0,
          lastRunTime: null,
          nextRunTime: null,
          lastResult: longResult,
        });

        await program.parseAsync(['node', 'test', 'heartbeat', 'status']);

        const output = getLogOutput();
        // The code does status.lastResult.slice(0, 200)
        expect(output).toContain('Last result: ' + 'A'.repeat(200));
        expect(output).not.toContain('A'.repeat(201));
      });
    });

    describe('heartbeat tick', () => {
      it('should display result when tick completes normally', async () => {
        mockEngine.tick.mockResolvedValue({
          skipped: false,
          suppressed: false,
          agentResponse: 'Processed 5 pending items',
        });

        await program.parseAsync(['node', 'test', 'heartbeat', 'tick']);

        const output = getLogOutput();
        expect(output).toContain('Running heartbeat tick...');
        expect(output).toContain('Result:\nProcessed 5 pending items');
      });

      it('should display skip reason when tick is skipped', async () => {
        mockEngine.tick.mockResolvedValue({
          skipped: true,
          skipReason: 'Agent is busy',
        });

        await program.parseAsync(['node', 'test', 'heartbeat', 'tick']);

        const output = getLogOutput();
        expect(output).toContain('Running heartbeat tick...');
        expect(output).toContain('Skipped: Agent is busy');
      });

      it('should display suppression message when suppressed', async () => {
        mockEngine.tick.mockResolvedValue({
          skipped: false,
          suppressed: true,
        });

        await program.parseAsync(['node', 'test', 'heartbeat', 'tick']);

        const output = getLogOutput();
        expect(output).toContain('Running heartbeat tick...');
        expect(output).toContain('Suppressed (HEARTBEAT_OK)');
      });

      it('should display "No response" when agentResponse is null', async () => {
        mockEngine.tick.mockResolvedValue({
          skipped: false,
          suppressed: false,
          agentResponse: null,
        });

        await program.parseAsync(['node', 'test', 'heartbeat', 'tick']);

        const output = getLogOutput();
        expect(output).toContain('Result:\nNo response');
      });
    });
  });

  // ==========================================================================
  // Hub Commands
  // ==========================================================================

  describe('registerHubCommands', () => {
    let program: Command;

    beforeEach(() => {
      program = createProgram();
      registerHubCommands(program);
    });

    describe('hub search', () => {
      it('should search with query and display results', async () => {
        mockSkillsHub.search.mockResolvedValue({
          total: 2,
          skills: [
            { name: 'git-helper', version: '1.0.0', description: 'Git automation', tags: ['git', 'devops'] },
            { name: 'docker-deploy', version: '2.1.0', description: 'Docker deployment', tags: [] },
          ],
        });

        await program.parseAsync(['node', 'test', 'hub', 'search', 'git']);

        expect(mockSkillsHub.search).toHaveBeenCalledWith('git', {
          tags: undefined,
          limit: 20,
        });
        const output = getLogOutput();
        expect(output).toContain('Found 2 skill(s):');
        expect(output).toContain('git-helper v1.0.0');
        expect(output).toContain('Git automation');
        expect(output).toContain('Tags: git, devops');
        expect(output).toContain('docker-deploy v2.1.0');
        expect(output).toContain('Docker deployment');
      });

      it('should search with tags and limit options', async () => {
        mockSkillsHub.search.mockResolvedValue({
          total: 1,
          skills: [
            { name: 'k8s-tool', version: '0.5.0', description: 'K8s management', tags: ['k8s'] },
          ],
        });

        await program.parseAsync(['node', 'test', 'hub', 'search', 'kubernetes', '-t', 'devops,k8s', '-l', '5']);

        expect(mockSkillsHub.search).toHaveBeenCalledWith('kubernetes', {
          tags: ['devops', 'k8s'],
          limit: 5,
        });
      });

      it('should display message when no skills found', async () => {
        mockSkillsHub.search.mockResolvedValue({ total: 0, skills: [] });

        await program.parseAsync(['node', 'test', 'hub', 'search', 'nonexistent']);

        expect(getLogOutput()).toContain('No skills found.');
      });
    });

    describe('hub install', () => {
      it('should install a skill by name', async () => {
        mockSkillsHub.install.mockResolvedValue({ name: 'my-skill', version: '1.2.0' });

        await program.parseAsync(['node', 'test', 'hub', 'install', 'my-skill']);

        expect(mockSkillsHub.install).toHaveBeenCalledWith('my-skill', undefined);
        expect(getLogOutput()).toContain('Installed my-skill v1.2.0');
      });

      it('should install a skill with specific version', async () => {
        mockSkillsHub.install.mockResolvedValue({ name: 'my-skill', version: '0.9.0' });

        await program.parseAsync(['node', 'test', 'hub', 'install', 'my-skill', '-v', '0.9.0']);

        expect(mockSkillsHub.install).toHaveBeenCalledWith('my-skill', '0.9.0');
        expect(getLogOutput()).toContain('Installed my-skill v0.9.0');
      });

      it('should handle install failure', async () => {
        mockSkillsHub.install.mockRejectedValue(new Error('Network timeout'));

        await program.parseAsync(['node', 'test', 'hub', 'install', 'bad-skill']);

        expect(getErrorOutput()).toContain('Failed to install: Network timeout');
        expect(processExitSpy).toHaveBeenCalledWith(1);
      });

      it('should handle non-Error install failure', async () => {
        mockSkillsHub.install.mockRejectedValue('string error');

        await program.parseAsync(['node', 'test', 'hub', 'install', 'bad-skill']);

        expect(getErrorOutput()).toContain('Failed to install: string error');
        expect(processExitSpy).toHaveBeenCalledWith(1);
      });
    });

    describe('hub uninstall', () => {
      it('should uninstall an existing skill', async () => {
        mockSkillsHub.uninstall.mockResolvedValue(true);

        await program.parseAsync(['node', 'test', 'hub', 'uninstall', 'old-skill']);

        expect(mockSkillsHub.uninstall).toHaveBeenCalledWith('old-skill');
        expect(getLogOutput()).toContain('Uninstalled old-skill');
      });

      it('should handle uninstalling a non-existent skill', async () => {
        mockSkillsHub.uninstall.mockResolvedValue(false);

        await program.parseAsync(['node', 'test', 'hub', 'uninstall', 'missing-skill']);

        expect(getLogOutput()).toContain('Skill not found: missing-skill');
      });
    });

    describe('hub update', () => {
      it('should update all skills', async () => {
        mockSkillsHub.update.mockResolvedValue([
          { name: 'skill-a', version: '2.0.0' },
          { name: 'skill-b', version: '1.1.0' },
        ]);

        await program.parseAsync(['node', 'test', 'hub', 'update']);

        expect(mockSkillsHub.update).toHaveBeenCalledWith(undefined);
        const output = getLogOutput();
        expect(output).toContain('Updated 2 skill(s):');
        expect(output).toContain('skill-a -> v2.0.0');
        expect(output).toContain('skill-b -> v1.1.0');
      });

      it('should update a specific skill by name', async () => {
        mockSkillsHub.update.mockResolvedValue([
          { name: 'target-skill', version: '3.0.0' },
        ]);

        await program.parseAsync(['node', 'test', 'hub', 'update', 'target-skill']);

        expect(mockSkillsHub.update).toHaveBeenCalledWith('target-skill');
        expect(getLogOutput()).toContain('Updated 1 skill(s):');
      });

      it('should report when all skills are up to date', async () => {
        mockSkillsHub.update.mockResolvedValue([]);

        await program.parseAsync(['node', 'test', 'hub', 'update']);

        expect(getLogOutput()).toContain('All skills are up to date.');
      });
    });

    describe('hub list', () => {
      it('should list installed skills', async () => {
        mockSkillsHub.list.mockReturnValue([
          { name: 'skill-x', version: '1.0.0', installedAt: '2025-03-15T12:00:00Z' },
          { name: 'skill-y', version: '2.5.0', installedAt: '2025-04-01T08:30:00Z' },
        ]);

        await program.parseAsync(['node', 'test', 'hub', 'list']);

        const output = getLogOutput();
        expect(output).toContain('Installed skills (2):');
        expect(output).toContain('skill-x v1.0.0');
        expect(output).toContain('skill-y v2.5.0');
      });

      it('should display message when no skills installed', async () => {
        mockSkillsHub.list.mockReturnValue([]);

        await program.parseAsync(['node', 'test', 'hub', 'list']);

        expect(getLogOutput()).toContain('No skills installed from the hub.');
      });
    });

    describe('hub info', () => {
      it('should display skill info when found', async () => {
        const installedAt = '2025-06-01T09:00:00Z';
        mockSkillsHub.info.mockReturnValue({
          installed: {
            name: 'cool-skill',
            version: '3.2.1',
            installedAt,
            path: '/home/user/.codebuddy/skills/cool-skill',
          },
          integrityOk: true,
        });

        await program.parseAsync(['node', 'test', 'hub', 'info', 'cool-skill']);

        expect(mockSkillsHub.info).toHaveBeenCalledWith('cool-skill');
        const output = getLogOutput();
        expect(output).toContain('cool-skill v3.2.1');
        expect(output).toContain('Integrity: OK');
        expect(output).toContain('Installed: 2025-06-01T09:00:00.000Z');
        expect(output).toContain('Path: /home/user/.codebuddy/skills/cool-skill');
      });

      it('should display integrity mismatch', async () => {
        mockSkillsHub.info.mockReturnValue({
          installed: {
            name: 'tampered-skill',
            version: '1.0.0',
            installedAt: '2025-01-01T00:00:00Z',
            path: '/path/to/skill',
          },
          integrityOk: false,
        });

        await program.parseAsync(['node', 'test', 'hub', 'info', 'tampered-skill']);

        expect(getLogOutput()).toContain('Integrity: MISMATCH');
      });

      it('should display not found message for unknown skill', async () => {
        mockSkillsHub.info.mockReturnValue(null);

        await program.parseAsync(['node', 'test', 'hub', 'info', 'unknown-skill']);

        expect(getLogOutput()).toContain('Skill not found: unknown-skill');
      });
    });

    describe('hub publish', () => {
      it('should publish a skill from a path', async () => {
        mockSkillsHub.publish.mockResolvedValue({ name: 'new-skill', version: '1.0.0' });

        await program.parseAsync(['node', 'test', 'hub', 'publish', './skills/new-skill']);

        expect(mockSkillsHub.publish).toHaveBeenCalledWith('./skills/new-skill');
        expect(getLogOutput()).toContain('Published new-skill v1.0.0');
      });

      it('should handle publish failure', async () => {
        mockSkillsHub.publish.mockRejectedValue(new Error('Authentication required'));

        await program.parseAsync(['node', 'test', 'hub', 'publish', './skills/bad-skill']);

        expect(getErrorOutput()).toContain('Failed to publish: Authentication required');
        expect(processExitSpy).toHaveBeenCalledWith(1);
      });

      it('should handle non-Error publish failure', async () => {
        mockSkillsHub.publish.mockRejectedValue(42);

        await program.parseAsync(['node', 'test', 'hub', 'publish', './skills/x']);

        expect(getErrorOutput()).toContain('Failed to publish: 42');
        expect(processExitSpy).toHaveBeenCalledWith(1);
      });
    });

    describe('hub sync', () => {
      it('should display sync results with changes', async () => {
        mockSkillsHub.sync.mockResolvedValue({
          removed: ['old-skill'],
          mismatched: ['broken-skill'],
          updated: ['stale-skill'],
        });

        await program.parseAsync(['node', 'test', 'hub', 'sync']);

        const output = getLogOutput();
        expect(output).toContain('Sync complete:');
        expect(output).toContain('Removed: old-skill');
        expect(output).toContain('Mismatched: broken-skill');
        expect(output).toContain('Updated: stale-skill');
      });

      it('should display "everything in sync" when no changes', async () => {
        mockSkillsHub.sync.mockResolvedValue({
          removed: [],
          mismatched: [],
          updated: [],
        });

        await program.parseAsync(['node', 'test', 'hub', 'sync']);

        const output = getLogOutput();
        expect(output).toContain('Sync complete:');
        expect(output).toContain('Everything in sync.');
      });

      it('should display partial sync results', async () => {
        mockSkillsHub.sync.mockResolvedValue({
          removed: [],
          mismatched: ['skill-a', 'skill-b'],
          updated: [],
        });

        await program.parseAsync(['node', 'test', 'hub', 'sync']);

        const output = getLogOutput();
        expect(output).toContain('Mismatched: skill-a, skill-b');
        expect(output).not.toContain('Removed:');
        expect(output).not.toContain('Updated:');
        expect(output).not.toContain('Everything in sync.');
      });
    });
  });

  // ==========================================================================
  // Identity Commands
  // ==========================================================================

  describe('registerIdentityCommands', () => {
    let program: Command;

    beforeEach(() => {
      program = createProgram();
      registerIdentityCommands(program);
      mockIdentityManager.load.mockResolvedValue(undefined);
    });

    describe('identity show', () => {
      it('should display loaded identity files', async () => {
        mockIdentityManager.getAll.mockReturnValue([
          {
            name: 'SOUL.md',
            source: 'project',
            path: '/project/.codebuddy/SOUL.md',
            content: 'I am a helpful coding assistant.',
            lastModified: new Date('2025-05-10T14:30:00Z'),
          },
          {
            name: 'USER.md',
            source: 'global',
            path: '/home/user/.codebuddy/USER.md',
            content: 'Prefers concise responses.',
            lastModified: new Date('2025-04-20T08:00:00Z'),
          },
        ]);

        await program.parseAsync(['node', 'test', 'identity', 'show']);

        expect(mockIdentityManager.load).toHaveBeenCalledWith(process.cwd());
        const output = getLogOutput();
        expect(output).toContain('Identity files (2):');
        expect(output).toContain('SOUL.md (project)');
        expect(output).toContain('Path: /project/.codebuddy/SOUL.md');
        expect(output).toContain('Size: 32 chars');
        expect(output).toContain('Modified: 2025-05-10T14:30:00.000Z');
        expect(output).toContain('USER.md (global)');
      });

      it('should display message when no identity files loaded', async () => {
        mockIdentityManager.getAll.mockReturnValue([]);

        await program.parseAsync(['node', 'test', 'identity', 'show']);

        const output = getLogOutput();
        expect(output).toContain('No identity files loaded.');
        expect(output).toContain('Create .codebuddy/SOUL.md');
      });
    });

    describe('identity get', () => {
      it('should display content of a found identity file', async () => {
        mockIdentityManager.get.mockImplementation((name: string) => {
          if (name === 'SOUL.md') {
            return {
              name: 'SOUL.md',
              source: 'project',
              path: '/project/.codebuddy/SOUL.md',
              content: 'You are a helpful assistant.',
            };
          }
          return null;
        });

        await program.parseAsync(['node', 'test', 'identity', 'get', 'SOUL.md']);

        expect(mockIdentityManager.load).toHaveBeenCalledWith(process.cwd());
        const output = getLogOutput();
        expect(output).toContain('--- SOUL.md (project: /project/.codebuddy/SOUL.md) ---');
        expect(output).toContain('You are a helpful assistant.');
      });

      it('should try variations of the name (with .md, uppercase)', async () => {
        // All return null except the uppercase+.md variant
        mockIdentityManager.get.mockImplementation((name: string) => {
          if (name === 'SOUL.md') {
            return {
              name: 'SOUL.md',
              source: 'project',
              path: '/project/.codebuddy/SOUL.md',
              content: 'content here',
            };
          }
          return null;
        });

        await program.parseAsync(['node', 'test', 'identity', 'get', 'soul']);

        // The code tries: mgr.get(name) ?? mgr.get(`${name}.md`) ?? mgr.get(name.toUpperCase()) ?? mgr.get(`${name.toUpperCase()}.md`)
        // name='soul' -> 'soul' (null), 'soul.md' (null), 'SOUL' (null), 'SOUL.md' (found)
        expect(mockIdentityManager.get).toHaveBeenCalledWith('soul');
        expect(mockIdentityManager.get).toHaveBeenCalledWith('soul.md');
        expect(mockIdentityManager.get).toHaveBeenCalledWith('SOUL');
        expect(mockIdentityManager.get).toHaveBeenCalledWith('SOUL.md');
        expect(getLogOutput()).toContain('SOUL.md');
      });

      it('should display not found message for unknown identity file', async () => {
        mockIdentityManager.get.mockReturnValue(null);

        await program.parseAsync(['node', 'test', 'identity', 'get', 'MISSING']);

        expect(getLogOutput()).toContain('Identity file not found: MISSING');
      });
    });

    describe('identity set', () => {
      it('should set content for an identity file', async () => {
        await program.parseAsync(['node', 'test', 'identity', 'set', 'soul', 'Be helpful and concise.']);

        expect(mockIdentityManager.load).toHaveBeenCalledWith(process.cwd());
        expect(mockIdentityManager.set).toHaveBeenCalledWith('SOUL.md', 'Be helpful and concise.');
        expect(getLogOutput()).toContain('Updated SOUL.md');
      });

      it('should handle name that already ends in .MD (toUpperCase quirk)', async () => {
        // Note: The source does name.toUpperCase().endsWith('.md') which is always false
        // because toUpperCase() produces '.MD' not '.md'. So 'USER.MD' becomes 'USER.MD.md'.
        // The check only works for lowercase '.md' input (e.g., 'user.md' -> 'USER.MD' which does NOT endsWith '.md').
        // This test documents the actual behavior.
        await program.parseAsync(['node', 'test', 'identity', 'set', 'USER.md', 'User preferences']);

        // 'USER.md'.toUpperCase() = 'USER.MD' which does NOT endsWith('.md'), so '.md' is appended
        expect(mockIdentityManager.set).toHaveBeenCalledWith('USER.MD.md', 'User preferences');
        expect(getLogOutput()).toContain('Updated USER.MD.md');
      });

      it('should uppercase the filename', async () => {
        await program.parseAsync(['node', 'test', 'identity', 'set', 'custom', 'Custom content']);

        expect(mockIdentityManager.set).toHaveBeenCalledWith('CUSTOM.md', 'Custom content');
        expect(getLogOutput()).toContain('Updated CUSTOM.md');
      });
    });

    describe('identity prompt', () => {
      it('should display the combined identity prompt', async () => {
        mockIdentityManager.getPromptInjection.mockReturnValue('You are a helpful assistant.\nUser prefers TypeScript.');

        await program.parseAsync(['node', 'test', 'identity', 'prompt']);

        expect(mockIdentityManager.load).toHaveBeenCalledWith(process.cwd());
        const output = getLogOutput();
        expect(output).toContain('--- Identity Prompt ---');
        expect(output).toContain('You are a helpful assistant.');
        expect(output).toContain('User prefers TypeScript.');
      });

      it('should display message when no identity content loaded', async () => {
        mockIdentityManager.getPromptInjection.mockReturnValue(null);

        await program.parseAsync(['node', 'test', 'identity', 'prompt']);

        expect(getLogOutput()).toContain('No identity content loaded.');
      });

      it('should handle empty string prompt injection', async () => {
        mockIdentityManager.getPromptInjection.mockReturnValue('');

        await program.parseAsync(['node', 'test', 'identity', 'prompt']);

        // Empty string is falsy, so it should show "No identity content loaded."
        expect(getLogOutput()).toContain('No identity content loaded.');
      });
    });
  });

  // ==========================================================================
  // Group Commands
  // ==========================================================================

  describe('registerGroupCommands', () => {
    let program: Command;

    beforeEach(() => {
      program = createProgram();
      registerGroupCommands(program);
    });

    describe('groups status', () => {
      it('should display full group security status', async () => {
        mockGroupSecurity.getStats.mockReturnValue({
          enabled: true,
          defaultMode: 'allowlist',
          totalGroups: 5,
          blocklistSize: 2,
          globalAllowlistSize: 10,
          groupsByMode: {
            allowlist: 3,
            open: 2,
          },
        });

        await program.parseAsync(['node', 'test', 'groups', 'status']);

        const output = getLogOutput();
        expect(output).toContain('Group Security');
        expect(output).toContain('Enabled: YES');
        expect(output).toContain('Default mode: allowlist');
        expect(output).toContain('Groups configured: 5');
        expect(output).toContain('Blocklist: 2 users');
        expect(output).toContain('Global allowlist: 10 users');
        expect(output).toContain('Groups by mode:');
        expect(output).toContain('allowlist: 3');
        expect(output).toContain('open: 2');
      });

      it('should handle disabled group security with no groups by mode', async () => {
        mockGroupSecurity.getStats.mockReturnValue({
          enabled: false,
          defaultMode: 'open',
          totalGroups: 0,
          blocklistSize: 0,
          globalAllowlistSize: 0,
          groupsByMode: {},
        });

        await program.parseAsync(['node', 'test', 'groups', 'status']);

        const output = getLogOutput();
        expect(output).toContain('Enabled: NO');
        expect(output).toContain('Groups configured: 0');
        expect(output).not.toContain('Groups by mode:');
      });
    });

    describe('groups list', () => {
      it('should list configured groups', async () => {
        mockGroupSecurity.listGroups.mockReturnValue([
          {
            activationMode: 'allowlist',
            channelType: 'telegram',
            groupId: 'tg-group-123',
            allowedUsers: ['user1', 'user2'],
          },
          {
            activationMode: 'open',
            channelType: 'discord',
            groupId: 'dc-server-456',
            allowedUsers: [],
          },
        ]);

        await program.parseAsync(['node', 'test', 'groups', 'list']);

        const output = getLogOutput();
        expect(output).toContain('Configured groups (2):');
        expect(output).toContain('[allowlist] telegram:tg-group-123');
        expect(output).toContain('Allowed: user1, user2');
        expect(output).toContain('[open] discord:dc-server-456');
      });

      it('should display message when no groups configured', async () => {
        mockGroupSecurity.listGroups.mockReturnValue([]);

        await program.parseAsync(['node', 'test', 'groups', 'list']);

        expect(getLogOutput()).toContain('No groups configured.');
      });
    });

    describe('groups block', () => {
      it('should add user to blocklist', async () => {
        await program.parseAsync(['node', 'test', 'groups', 'block', 'baduser123']);

        expect(mockGroupSecurity.addToBlocklist).toHaveBeenCalledWith('baduser123');
        expect(getLogOutput()).toContain('Blocked user: baduser123');
      });
    });

    describe('groups unblock', () => {
      it('should unblock a user that is in the blocklist', async () => {
        mockGroupSecurity.removeFromBlocklist.mockReturnValue(true);

        await program.parseAsync(['node', 'test', 'groups', 'unblock', 'user456']);

        expect(mockGroupSecurity.removeFromBlocklist).toHaveBeenCalledWith('user456');
        expect(getLogOutput()).toContain('Unblocked user: user456');
      });

      it('should display message when user not in blocklist', async () => {
        mockGroupSecurity.removeFromBlocklist.mockReturnValue(false);

        await program.parseAsync(['node', 'test', 'groups', 'unblock', 'unknownuser']);

        expect(getLogOutput()).toContain('User not in blocklist: unknownuser');
      });
    });
  });

  // ==========================================================================
  // Auth Profile Commands
  // ==========================================================================

  describe('registerAuthProfileCommands', () => {
    let program: Command;

    beforeEach(() => {
      program = createProgram();
      registerAuthProfileCommands(program);
    });

    describe('auth-profile list', () => {
      it('should list configured auth profiles', async () => {
        mockAuthProfileManager.getStatus.mockReturnValue([
          {
            profileId: 'grok-primary',
            provider: 'grok',
            healthy: true,
            failureCount: 0,
            type: 'api-key',
            priority: 10,
            inCooldown: false,
            cooldownRemainingMs: 0,
            lastError: null,
          },
          {
            profileId: 'claude-backup',
            provider: 'claude',
            healthy: false,
            failureCount: 3,
            type: 'api-key',
            priority: 5,
            inCooldown: true,
            cooldownRemainingMs: 45000,
            lastError: 'Rate limit exceeded',
          },
        ]);

        await program.parseAsync(['node', 'test', 'auth-profile', 'list']);

        const output = getLogOutput();
        expect(output).toContain('Auth profiles (2):');
        expect(output).toContain('[HEALTHY] grok-primary (grok)');
        expect(output).toContain('Type: api-key, Priority: 10');
        expect(output).toContain('[COOLDOWN (3 failures)] claude-backup (claude)');
        expect(output).toContain('Cooldown remaining: 45s');
        expect(output).toContain('Last error: Rate limit exceeded');
      });

      it('should display message when no profiles configured', async () => {
        mockAuthProfileManager.getStatus.mockReturnValue([]);

        await program.parseAsync(['node', 'test', 'auth-profile', 'list']);

        const output = getLogOutput();
        expect(output).toContain('No auth profiles configured.');
        expect(output).toContain('Use auth-profile add to register one.');
      });

      it('should not show cooldown line when healthy (cooldownRemainingMs is 0)', async () => {
        mockAuthProfileManager.getStatus.mockReturnValue([
          {
            profileId: 'healthy-profile',
            provider: 'grok',
            healthy: true,
            failureCount: 0,
            type: 'api-key',
            priority: 1,
            inCooldown: false,
            cooldownRemainingMs: 0,
            lastError: null,
          },
        ]);

        await program.parseAsync(['node', 'test', 'auth-profile', 'list']);

        const output = getLogOutput();
        expect(output).not.toContain('Cooldown remaining:');
        expect(output).not.toContain('Last error:');
      });
    });

    describe('auth-profile add', () => {
      it('should add a profile with API key option', async () => {
        await program.parseAsync([
          'node', 'test', 'auth-profile', 'add', 'my-grok', 'grok',
          '-k', 'xai-abc123',
          '-p', '10',
          '-m', 'grok-3-latest',
          '-u', 'https://api.x.ai/v1',
        ]);

        expect(mockAuthProfileManager.addProfile).toHaveBeenCalledWith({
          id: 'my-grok',
          provider: 'grok',
          type: 'api-key',
          credentials: { apiKey: 'xai-abc123' },
          priority: 10,
          metadata: {
            model: 'grok-3-latest',
            baseURL: 'https://api.x.ai/v1',
          },
        });
        expect(getLogOutput()).toContain('Added profile: my-grok (grok)');
      });

      it('should fall back to env var when no API key provided', async () => {
        const originalEnv = process.env.GROK_API_KEY;
        process.env.GROK_API_KEY = 'env-key-xyz';

        await program.parseAsync(['node', 'test', 'auth-profile', 'add', 'env-grok', 'grok']);

        expect(mockAuthProfileManager.addProfile).toHaveBeenCalledWith(
          expect.objectContaining({
            credentials: { apiKey: 'env-key-xyz' },
          }),
        );

        // Restore
        if (originalEnv !== undefined) {
          process.env.GROK_API_KEY = originalEnv;
        } else {
          delete process.env.GROK_API_KEY;
        }
      });

      it('should use default priority 0 when not specified', async () => {
        await program.parseAsync(['node', 'test', 'auth-profile', 'add', 'simple', 'openai', '-k', 'sk-123']);

        expect(mockAuthProfileManager.addProfile).toHaveBeenCalledWith(
          expect.objectContaining({
            priority: 0,
          }),
        );
      });

      it('should set metadata fields to undefined when not provided', async () => {
        await program.parseAsync(['node', 'test', 'auth-profile', 'add', 'bare', 'grok', '-k', 'key']);

        expect(mockAuthProfileManager.addProfile).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: {
              model: undefined,
              baseURL: undefined,
            },
          }),
        );
      });
    });

    describe('auth-profile remove', () => {
      it('should remove an existing profile', async () => {
        mockAuthProfileManager.removeProfile.mockReturnValue(true);

        await program.parseAsync(['node', 'test', 'auth-profile', 'remove', 'old-profile']);

        expect(mockAuthProfileManager.removeProfile).toHaveBeenCalledWith('old-profile');
        expect(getLogOutput()).toContain('Removed profile: old-profile');
      });

      it('should handle removing a non-existent profile', async () => {
        mockAuthProfileManager.removeProfile.mockReturnValue(false);

        await program.parseAsync(['node', 'test', 'auth-profile', 'remove', 'ghost-profile']);

        expect(getLogOutput()).toContain('Profile not found: ghost-profile');
      });
    });

    describe('auth-profile reset', () => {
      it('should reset the auth profile manager', async () => {
        await program.parseAsync(['node', 'test', 'auth-profile', 'reset']);

        const { resetAuthProfileManager } = require('../../src/auth/profile-manager.js');
        expect(resetAuthProfileManager).toHaveBeenCalled();
        expect(getLogOutput()).toContain('Auth profile manager reset. All cooldowns cleared.');
      });
    });
  });
});
