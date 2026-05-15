import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_COMMAND_COMPLETED_WITH_NO_OUTPUT,
  DEVICE_COMMAND_FAILED_WITH_NO_OUTPUT,
  DeviceTool,
} from '../../src/tools/device-tool.js';

const mocks = vi.hoisted(() => ({
  manager: {
    listDevices: vi.fn(),
    systemRun: vi.fn(),
  },
}));

vi.mock('../../src/nodes/device-node.js', () => ({
  DeviceNodeManager: {
    getInstance: () => mocks.manager,
  },
}));

describe('DeviceTool', () => {
  beforeEach(() => {
    mocks.manager.listDevices.mockReset();
    mocks.manager.systemRun.mockReset();
    mocks.manager.listDevices.mockReturnValue([]);
  });

  it('returns explicit output for successful device commands without stdout', async () => {
    mocks.manager.systemRun.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    const result = await new DeviceTool().execute({
      action: 'run',
      deviceId: 'dev-1',
      command: 'true',
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe(DEVICE_COMMAND_COMPLETED_WITH_NO_OUTPUT);
  });

  it('returns explicit output for failed device commands without stdout or stderr', async () => {
    mocks.manager.systemRun.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 1,
    });

    const result = await new DeviceTool().execute({
      action: 'run',
      deviceId: 'dev-1',
      command: 'false',
    });

    expect(result.success).toBe(false);
    expect(result.output).toBe(DEVICE_COMMAND_FAILED_WITH_NO_OUTPUT);
    expect(result.error).toBe(DEVICE_COMMAND_FAILED_WITH_NO_OUTPUT);
  });
});
