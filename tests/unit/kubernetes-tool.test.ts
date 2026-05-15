import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';

const spawnState = vi.hoisted(() => ({
  mode: 'ready' as 'ready' | 'error' | 'exit',
  spawnMock: vi.fn(),
}));

class MockStream extends EventEmitter {
  destroy = vi.fn();
}

interface MockProcess extends EventEmitter {
  stdout: MockStream;
  stderr: MockStream;
  pid: number;
  kill: ReturnType<typeof vi.fn>;
  unref: ReturnType<typeof vi.fn>;
}

vi.mock('child_process', () => ({
  spawn: spawnState.spawnMock.mockImplementation((): MockProcess => {
    const proc = new EventEmitter() as MockProcess;
    proc.stdout = new MockStream();
    proc.stderr = new MockStream();
    proc.pid = 4321;
    proc.kill = vi.fn();
    proc.unref = vi.fn();

    process.nextTick(() => {
      if (spawnState.mode === 'ready') {
        proc.stdout.emit('data', Buffer.from('Forwarding from 127.0.0.1:8080 -> 80\n'));
      } else if (spawnState.mode === 'error') {
        proc.emit('error', new Error('spawn kubectl ENOENT'));
      } else {
        proc.stderr.emit('data', Buffer.from('pod not found\n'));
        proc.emit('exit', 1);
      }
    });

    return proc;
  }),
}));

const { KubernetesTool } = await import('../../src/tools/kubernetes-tool.js');

describe('KubernetesTool', () => {
  beforeEach(() => {
    spawnState.mode = 'ready';
    spawnState.spawnMock.mockClear();
    ConfirmationService.getInstance().setSessionFlag('bashCommands', true);
  });

  it('reports port-forward success only after kubectl readiness output', async () => {
    const tool = new KubernetesTool();

    const result = await tool.portForward('services', 'web', 8080, 80);

    expect(result.success).toBe(true);
    expect(result.output).toContain('Port-forward started');
    expect(result.output).toContain('PID: 4321');
  });

  it('reports spawn errors instead of claiming the port-forward started', async () => {
    spawnState.mode = 'error';
    const tool = new KubernetesTool();

    const result = await tool.portForward('pods', 'api', 8080, 80);

    expect(result.success).toBe(false);
    expect(result.error).toContain('spawn kubectl ENOENT');
  });

  it('reports early kubectl exit instead of claiming the port-forward started', async () => {
    spawnState.mode = 'exit';
    const tool = new KubernetesTool();

    const result = await tool.portForward('pods', 'api', 8080, 80);

    expect(result.success).toBe(false);
    expect(result.error).toContain('pod not found');
  });
});
