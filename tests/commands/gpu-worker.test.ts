import { describe, expect, it } from 'vitest';

import {
  buildGpuWorkerConfig,
  createGpuWorkerCommand,
  parseGpuRunnerArgs,
} from '../../src/commands/gpu-worker.js';

const options = {
  host: '100.73.222.64',
  port: '4310',
  stateDir: '/tmp/gpu-worker-state',
  root: ['/tmp/gpu-data'],
  workerId: 'darkstar',
  maxConcurrency: '1',
};

describe('gpu-worker command', () => {
  it('builds a bounded runner configuration from secret environment references', () => {
    const config = buildGpuWorkerConfig(options, {
      CODEBUDDY_GPU_WORKER_TOKEN: 'a-secret-token-longer-than-24-bytes',
      CODEBUDDY_PANOWORLD_RUNNER: 'python',
      CODEBUDDY_PANOWORLD_RUNNER_ARGS: '["D:/DEV/PanoWorld/codebuddy_runner.py"]',
      CODEBUDDY_LONGCAT_RUNNER: 'python',
      CODEBUDDY_LONGCAT_RUNNER_ARGS: '["D:/DEV/LongCat/codebuddy_runner.py"]',
      CODEBUDDY_LONGCAT_RUNNER_REVISION: 'd'.repeat(64),
      CODEBUDDY_GPU_WORKER_RETENTION_DAYS: '30',
      CODEBUDDY_GPU_WORKER_MAX_TERMINAL_JOBS: '500',
    });
    expect(config).toMatchObject({
      host: '100.73.222.64',
      port: 4310,
      workerId: 'darkstar',
      maxConcurrency: 1,
      terminalJobRetentionMs: 30 * 24 * 60 * 60 * 1000,
      maxStoredTerminalJobs: 500,
      runners: {
        panoworld_reconstruct: {
          command: 'python',
          args: ['D:/DEV/PanoWorld/codebuddy_runner.py'],
        },
        avatar_video_render: {
          command: 'python',
          args: ['D:/DEV/LongCat/codebuddy_runner.py'],
          revision: 'd'.repeat(64),
        },
      },
    });
  });

  it('fails closed without a token, roots, or runners', () => {
    expect(() => buildGpuWorkerConfig(options, {})).toThrow(/TOKEN is required/);
    expect(() =>
      buildGpuWorkerConfig(
        { ...options, root: undefined },
        {
          CODEBUDDY_GPU_WORKER_TOKEN: 'a-secret-token-longer-than-24-bytes',
          CODEBUDDY_PANOWORLD_RUNNER: 'python',
        }
      )
    ).toThrow(/root/);
    expect(() =>
      buildGpuWorkerConfig(options, {
        CODEBUDDY_GPU_WORKER_TOKEN: 'a-secret-token-longer-than-24-bytes',
      })
    ).toThrow(/RUNNER/);
    expect(() => buildGpuWorkerConfig(options, {
      CODEBUDDY_GPU_WORKER_TOKEN: 'a-secret-token-longer-than-24-bytes',
      CODEBUDDY_PANOWORLD_RUNNER: 'python',
      CODEBUDDY_GPU_WORKER_RETENTION_DAYS: '0',
    })).toThrow(/RETENTION_DAYS/);
    expect(() => buildGpuWorkerConfig(options, {
      CODEBUDDY_GPU_WORKER_TOKEN: 'a-secret-token-longer-than-24-bytes',
      CODEBUDDY_PANOWORLD_RUNNER: 'python',
      CODEBUDDY_PANOWORLD_RUNNER_REVISION: 'not-a-digest',
    })).toThrow(/REVISION/);
  });

  it('validates runner argument JSON and exposes the CLI command', () => {
    expect(parseGpuRunnerArgs('["runner.py", "--safe"]', 'ARGS')).toEqual(['runner.py', '--safe']);
    expect(() => parseGpuRunnerArgs('{"bad":true}', 'ARGS')).toThrow(/JSON array/);
    expect(createGpuWorkerCommand().name()).toBe('gpu-worker');
  });
});
