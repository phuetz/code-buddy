import { describe, expect, it, vi, beforeEach } from 'vitest';
import { spawnSync } from 'child_process';

import {
  executeBackendLifecycleAction,
  buildBackendLifecycleStatusReport,
  renderBackendLifecycleAction,
  renderBackendLifecycleStatusReport,
  type BackendLifecycleAction,
  type BackendLifecycleStatusReport,
} from '../../src/agent/hermes-runtime-lifecycle.js';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

const mockedSpawnSync = vi.mocked(spawnSync);

function mockSpawnOk(stdout = ''): void {
  mockedSpawnSync.mockReturnValueOnce({
    status: 0,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(''),
    pid: 1234,
    output: [null, Buffer.from(stdout), Buffer.from('')],
    signal: null,
    error: undefined as unknown as Error,
  });
}

function mockSpawnFail(stderr = 'command failed', exitCode = 1): void {
  mockedSpawnSync.mockReturnValueOnce({
    status: exitCode,
    stdout: Buffer.from(''),
    stderr: Buffer.from(stderr),
    pid: 1234,
    output: [null, Buffer.from(''), Buffer.from(stderr)],
    signal: null,
    error: undefined as unknown as Error,
  });
}

const frozenEnv: NodeJS.ProcessEnv = { PATH: '/usr/bin' };

describe('Hermes runtime lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSpawnSync.mockReset();
  });

  // -----------------------------------------------------------------------
  // Unsupported backends
  // -----------------------------------------------------------------------

  describe('unsupported backends', () => {
    for (const backendId of ['local', 'wsl', 'os-sandbox', 'singularity', 'vercel-sandbox']) {
      it(`${backendId} returns unsupported for hibernate`, () => {
        const result = executeBackendLifecycleAction(backendId, 'hibernate', { env: frozenEnv });
        expect(result.result).toBe('unsupported');
        expect(result.state).toBe('unsupported');
        expect(result.durationMs).toBe(0);
      });

      it(`${backendId} returns unsupported for wake`, () => {
        const result = executeBackendLifecycleAction(backendId, 'wake', { env: frozenEnv });
        expect(result.result).toBe('unsupported');
        expect(result.state).toBe('unsupported');
      });

      it(`${backendId} returns unsupported for status`, () => {
        const result = executeBackendLifecycleAction(backendId, 'status', { env: frozenEnv });
        expect(result.result).toBe('unsupported');
        expect(result.state).toBe('unsupported');
      });
    }
  });

  // -----------------------------------------------------------------------
  // Unknown backend
  // -----------------------------------------------------------------------

  it('returns failed for an unknown backend', () => {
    const result = executeBackendLifecycleAction('nonexistent', 'status', { env: frozenEnv });
    expect(result.result).toBe('failed');
    expect(result.detail).toContain('Unknown backend');
  });

  // -----------------------------------------------------------------------
  // Docker lifecycle
  // -----------------------------------------------------------------------

  describe('docker lifecycle', () => {
    it('hibernates a container successfully', () => {
      mockSpawnOk();
      const result = executeBackendLifecycleAction('docker', 'hibernate', {
        containerId: 'my-container',
        env: frozenEnv,
      });
      expect(result).toMatchObject({
        backendId: 'docker',
        action: 'hibernate',
        result: 'success',
        state: 'hibernated',
      });
      expect(result.detail).toContain('my-container');
      expect(mockedSpawnSync).toHaveBeenCalledWith(
        'docker',
        ['pause', 'my-container'],
        expect.objectContaining({ env: frozenEnv }),
      );
    });

    it('wakes a container successfully', () => {
      mockSpawnOk();
      const result = executeBackendLifecycleAction('docker', 'wake', {
        containerId: 'my-container',
        env: frozenEnv,
      });
      expect(result).toMatchObject({
        backendId: 'docker',
        action: 'wake',
        result: 'success',
        state: 'running',
      });
      expect(mockedSpawnSync).toHaveBeenCalledWith(
        'docker',
        ['unpause', 'my-container'],
        expect.objectContaining({ env: frozenEnv }),
      );
    });

    it('reports status as running', () => {
      mockSpawnOk('running\n');
      const result = executeBackendLifecycleAction('docker', 'status', {
        containerId: 'my-container',
        env: frozenEnv,
      });
      expect(result).toMatchObject({
        backendId: 'docker',
        action: 'status',
        result: 'success',
        state: 'running',
      });
    });

    it('reports status as hibernated when paused', () => {
      mockSpawnOk('paused\n');
      const result = executeBackendLifecycleAction('docker', 'status', {
        containerId: 'my-container',
        env: frozenEnv,
      });
      expect(result.state).toBe('hibernated');
    });

    it('maps exited docker state to stopping', () => {
      mockSpawnOk('exited\n');
      const result = executeBackendLifecycleAction('docker', 'status', {
        containerId: 'my-container',
        env: frozenEnv,
      });
      expect(result.state).toBe('stopping');
    });

    it('maps restarting docker state to starting', () => {
      mockSpawnOk('restarting\n');
      const result = executeBackendLifecycleAction('docker', 'status', {
        containerId: 'my-container',
        env: frozenEnv,
      });
      expect(result.state).toBe('starting');
    });

    it('fails hibernate when docker command fails', () => {
      mockSpawnFail('Error: No such container: abc');
      const result = executeBackendLifecycleAction('docker', 'hibernate', {
        containerId: 'abc',
        env: frozenEnv,
      });
      expect(result.result).toBe('failed');
      expect(result.state).toBe('unknown');
      expect(result.detail).toContain('No such container');
    });

    it('fails when containerId is missing', () => {
      const result = executeBackendLifecycleAction('docker', 'hibernate', {
        env: frozenEnv,
      });
      expect(result.result).toBe('failed');
      expect(result.detail).toContain('containerId is required');
    });

    it('reads containerId from CODEBUDDY_DOCKER_CONTAINER env var', () => {
      mockSpawnOk('running\n');
      const env = { ...frozenEnv, CODEBUDDY_DOCKER_CONTAINER: 'env-container' };
      const result = executeBackendLifecycleAction('docker', 'status', { env });
      expect(result.result).toBe('success');
      expect(mockedSpawnSync).toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining(['env-container']),
        expect.any(Object),
      );
    });
  });

  // -----------------------------------------------------------------------
  // SSH lifecycle
  // -----------------------------------------------------------------------

  describe('ssh lifecycle', () => {
    it('hibernate returns success immediately (connection release)', () => {
      const result = executeBackendLifecycleAction('ssh', 'hibernate', {
        sshHost: 'user@host',
        env: frozenEnv,
      });
      expect(result).toMatchObject({
        backendId: 'ssh',
        action: 'hibernate',
        result: 'success',
        state: 'hibernated',
      });
      // Should NOT spawn a subprocess — hibernate is a no-op
      expect(mockedSpawnSync).not.toHaveBeenCalled();
    });

    it('wake verifies SSH connectivity', () => {
      mockSpawnOk();
      const result = executeBackendLifecycleAction('ssh', 'wake', {
        sshHost: 'user@host',
        env: frozenEnv,
      });
      expect(result).toMatchObject({
        backendId: 'ssh',
        action: 'wake',
        result: 'success',
        state: 'running',
      });
      expect(mockedSpawnSync).toHaveBeenCalledWith(
        'ssh',
        ['-T', '-o', 'ConnectTimeout=10', 'user@host', 'true'],
        expect.any(Object),
      );
    });

    it('wake fails when host unreachable', () => {
      mockSpawnFail('Connection refused');
      const result = executeBackendLifecycleAction('ssh', 'wake', {
        sshHost: 'user@badhost',
        env: frozenEnv,
      });
      expect(result.result).toBe('failed');
      expect(result.detail).toContain('Connection refused');
    });

    it('status reports running when host reachable', () => {
      mockSpawnOk();
      const result = executeBackendLifecycleAction('ssh', 'status', {
        sshHost: 'user@host',
        env: frozenEnv,
      });
      expect(result.state).toBe('running');
    });

    it('status reports hibernated when host unreachable', () => {
      mockSpawnFail('Connection timed out');
      const result = executeBackendLifecycleAction('ssh', 'status', {
        sshHost: 'user@host',
        env: frozenEnv,
      });
      expect(result.state).toBe('hibernated');
    });

    it('fails wake when sshHost is missing', () => {
      const result = executeBackendLifecycleAction('ssh', 'wake', { env: frozenEnv });
      expect(result.result).toBe('failed');
      expect(result.detail).toContain('sshHost is required');
    });
  });

  // -----------------------------------------------------------------------
  // Modal lifecycle
  // -----------------------------------------------------------------------

  describe('modal lifecycle', () => {
    it('hibernates a modal app', () => {
      mockSpawnOk();
      const result = executeBackendLifecycleAction('modal', 'hibernate', {
        modalApp: 'my-app',
        env: frozenEnv,
      });
      expect(result).toMatchObject({
        backendId: 'modal',
        action: 'hibernate',
        result: 'success',
        state: 'hibernated',
      });
      expect(mockedSpawnSync).toHaveBeenCalledWith(
        'modal',
        ['app', 'stop', 'my-app'],
        expect.any(Object),
      );
    });

    it('wakes a modal app', () => {
      mockSpawnOk();
      const result = executeBackendLifecycleAction('modal', 'wake', {
        modalApp: 'my-app',
        env: frozenEnv,
      });
      expect(result).toMatchObject({
        result: 'success',
        state: 'running',
      });
      expect(mockedSpawnSync).toHaveBeenCalledWith(
        'modal',
        ['run', 'my-app'],
        expect.any(Object),
      );
    });

    it('reports modal app status as running when found in list', () => {
      mockSpawnOk('my-app   running\nother-app  stopped');
      const result = executeBackendLifecycleAction('modal', 'status', {
        modalApp: 'my-app',
        env: frozenEnv,
      });
      expect(result.state).toBe('running');
    });

    it('reports modal app status as hibernated when not in list', () => {
      mockSpawnOk('other-app  running');
      const result = executeBackendLifecycleAction('modal', 'status', {
        modalApp: 'my-app',
        env: frozenEnv,
      });
      expect(result.state).toBe('hibernated');
    });

    it('fails when modalApp is missing', () => {
      const result = executeBackendLifecycleAction('modal', 'hibernate', { env: frozenEnv });
      expect(result.result).toBe('failed');
      expect(result.detail).toContain('modalApp is required');
    });
  });

  // -----------------------------------------------------------------------
  // Daytona lifecycle
  // -----------------------------------------------------------------------

  describe('daytona lifecycle', () => {
    it('hibernates a daytona workspace', () => {
      mockSpawnOk();
      const result = executeBackendLifecycleAction('daytona', 'hibernate', {
        daytonaWorkspace: 'my-ws',
        env: frozenEnv,
      });
      expect(result).toMatchObject({
        result: 'success',
        state: 'hibernated',
      });
      expect(mockedSpawnSync).toHaveBeenCalledWith(
        'daytona',
        ['workspace', 'stop', 'my-ws'],
        expect.any(Object),
      );
    });

    it('wakes a daytona workspace', () => {
      mockSpawnOk();
      const result = executeBackendLifecycleAction('daytona', 'wake', {
        daytonaWorkspace: 'my-ws',
        env: frozenEnv,
      });
      expect(result).toMatchObject({
        result: 'success',
        state: 'running',
      });
      expect(mockedSpawnSync).toHaveBeenCalledWith(
        'daytona',
        ['workspace', 'start', 'my-ws'],
        expect.any(Object),
      );
    });

    it('reports workspace status', () => {
      mockSpawnOk('my-ws  RUNNING\nother  STOPPED');
      const result = executeBackendLifecycleAction('daytona', 'status', {
        daytonaWorkspace: 'my-ws',
        env: frozenEnv,
      });
      expect(result.state).toBe('running');
    });

    it('fails when daytonaWorkspace is missing', () => {
      const result = executeBackendLifecycleAction('daytona', 'wake', { env: frozenEnv });
      expect(result.result).toBe('failed');
      expect(result.detail).toContain('daytonaWorkspace is required');
    });
  });

  // -----------------------------------------------------------------------
  // Lifecycle status report
  // -----------------------------------------------------------------------

  describe('buildBackendLifecycleStatusReport', () => {
    it('builds a report with all backends', () => {
      // Mock spawnSync for each lifecycle-supported backend that will call status:
      // docker, ssh, modal, daytona (4 calls)
      mockSpawnFail('not available'); // docker inspect
      mockSpawnFail('not available'); // ssh
      mockSpawnFail('not available'); // modal app list
      mockSpawnFail('not available'); // daytona workspace list

      const fixedDate = new Date('2026-06-13T12:00:00Z');
      const report = buildBackendLifecycleStatusReport({
        env: frozenEnv,
        now: () => fixedDate,
      });

      expect(report).toMatchObject({
        kind: 'hermes_runtime_lifecycle_status',
        schemaVersion: 1,
        generatedAt: '2026-06-13T12:00:00.000Z',
      });
      expect(report.backends.length).toBe(9);

      // Check unsupported backends
      const local = report.backends.find((b) => b.backendId === 'local');
      expect(local?.lifecycleSupported).toBe(false);
      expect(local?.state).toBe('unsupported');

      const wsl = report.backends.find((b) => b.backendId === 'wsl');
      expect(wsl?.lifecycleSupported).toBe(false);

      // Check lifecycle-supported backends
      const docker = report.backends.find((b) => b.backendId === 'docker');
      expect(docker?.lifecycleSupported).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  describe('renderBackendLifecycleAction', () => {
    it('renders a single action result', () => {
      const action: BackendLifecycleAction = {
        backendId: 'docker',
        action: 'hibernate',
        result: 'success',
        state: 'hibernated',
        detail: 'Container abc paused.',
        durationMs: 123,
      };
      const rendered = renderBackendLifecycleAction(action);
      expect(rendered).toContain('hibernate');
      expect(rendered).toContain('docker');
      expect(rendered).toContain('success');
      expect(rendered).toContain('hibernated');
      expect(rendered).toContain('123ms');
    });
  });

  describe('renderBackendLifecycleStatusReport', () => {
    it('renders a status report', () => {
      const report: BackendLifecycleStatusReport = {
        kind: 'hermes_runtime_lifecycle_status',
        schemaVersion: 1,
        generatedAt: '2026-06-13T12:00:00.000Z',
        platform: 'linux',
        arch: 'x64',
        backends: [
          {
            backendId: 'local',
            label: 'Local process',
            lifecycleSupported: false,
            state: 'unsupported',
            detail: 'Local process does not support managed lifecycle operations.',
          },
          {
            backendId: 'docker',
            label: 'Docker sandbox',
            lifecycleSupported: true,
            state: 'running',
            detail: 'Container abc status: running.',
          },
        ],
      };
      const rendered = renderBackendLifecycleStatusReport(report);
      expect(rendered).toContain('Hermes runtime lifecycle status');
      expect(rendered).toContain('local: unsupported (no-lifecycle)');
      expect(rendered).toContain('docker: running (lifecycle)');
    });
  });

  // -----------------------------------------------------------------------
  // CLI command wiring types
  // -----------------------------------------------------------------------

  describe('CLI command type contracts', () => {
    it('executeBackendLifecycleAction returns expected shape for hibernate', () => {
      const result = executeBackendLifecycleAction('local', 'hibernate', { env: frozenEnv });
      expect(result).toHaveProperty('backendId');
      expect(result).toHaveProperty('action');
      expect(result).toHaveProperty('result');
      expect(result).toHaveProperty('state');
      expect(result).toHaveProperty('detail');
      expect(result).toHaveProperty('durationMs');
    });

    it('executeBackendLifecycleAction returns expected shape for wake', () => {
      const result = executeBackendLifecycleAction('local', 'wake', { env: frozenEnv });
      expect(result).toHaveProperty('backendId');
      expect(result).toHaveProperty('action');
      expect(result).toHaveProperty('result');
      expect(result).toHaveProperty('state');
      expect(result).toHaveProperty('detail');
      expect(result).toHaveProperty('durationMs');
    });

    it('buildBackendLifecycleStatusReport returns expected shape', () => {
      // Mock the 4 lifecycle-supported backends
      mockSpawnFail();
      mockSpawnFail();
      mockSpawnFail();
      mockSpawnFail();

      const report = buildBackendLifecycleStatusReport({ env: frozenEnv });
      expect(report).toHaveProperty('kind', 'hermes_runtime_lifecycle_status');
      expect(report).toHaveProperty('schemaVersion', 1);
      expect(report).toHaveProperty('generatedAt');
      expect(report).toHaveProperty('platform');
      expect(report).toHaveProperty('arch');
      expect(report).toHaveProperty('backends');
      expect(Array.isArray(report.backends)).toBe(true);
    });
  });
});
