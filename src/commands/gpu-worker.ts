import { execFile as realExecFile } from 'child_process';
import { homedir } from 'os';
import { delimiter, join, resolve } from 'path';
import { promisify } from 'util';
import { Command } from 'commander';
import {
  createGpuMediaWorkerServer,
  type GpuMediaRunnerConfig,
  type GpuMediaWorkerServerConfig,
} from '../gpu-worker/gpu-media-worker-server.js';
import type { GpuMediaWorkerCapabilities } from '../tools/gpu-media-worker.js';
import { logger } from '../utils/logger.js';

const execFile = promisify(realExecFile);

interface GpuWorkerCommandOptions {
  host: string;
  port: string;
  stateDir: string;
  root?: string[];
  workerId: string;
  maxConcurrency: string;
}

export function parseGpuRunnerArgs(value: string | undefined, name: string): string[] {
  if (!value?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} must be a JSON array of strings`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error(`${name} must be a JSON array of strings`);
  }
  return parsed;
}

function optionalRunner(
  command: string | undefined,
  rawArgs: string | undefined,
  name: string,
  revision: string | undefined,
): GpuMediaRunnerConfig | undefined {
  if (!command?.trim()) return undefined;
  const normalizedRevision = revision?.trim();
  if (normalizedRevision && !/^[a-f0-9]{64}$/u.test(normalizedRevision)) {
    throw new Error(`${name}_REVISION must be a lowercase SHA-256 digest`);
  }
  return {
    command: command.trim(),
    args: parseGpuRunnerArgs(rawArgs, `${name}_ARGS`),
    ...(normalizedRevision ? { revision: normalizedRevision } : {}),
  };
}

function integer(value: string, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function buildGpuWorkerConfig(
  options: GpuWorkerCommandOptions,
  env: NodeJS.ProcessEnv = process.env
): GpuMediaWorkerServerConfig {
  const token = env.CODEBUDDY_GPU_WORKER_TOKEN?.trim();
  if (!token) throw new Error('CODEBUDDY_GPU_WORKER_TOKEN is required');
  if (Buffer.byteLength(token, 'utf8') < 24) {
    throw new Error('CODEBUDDY_GPU_WORKER_TOKEN must contain at least 24 bytes');
  }
  const envRoots = env.CODEBUDDY_GPU_WORKER_ROOTS?.split(delimiter)
    .map((root) => root.trim())
    .filter(Boolean);
  const roots = (options.root?.length ? options.root : envRoots)?.map((root) => resolve(root));
  if (!roots?.length) {
    throw new Error('At least one --root or CODEBUDDY_GPU_WORKER_ROOTS entry is required');
  }
  const panoworld = optionalRunner(
    env.CODEBUDDY_PANOWORLD_RUNNER,
    env.CODEBUDDY_PANOWORLD_RUNNER_ARGS,
    'CODEBUDDY_PANOWORLD_RUNNER',
    env.CODEBUDDY_PANOWORLD_RUNNER_REVISION,
  );
  const longcat = optionalRunner(
    env.CODEBUDDY_LONGCAT_RUNNER,
    env.CODEBUDDY_LONGCAT_RUNNER_ARGS,
    'CODEBUDDY_LONGCAT_RUNNER',
    env.CODEBUDDY_LONGCAT_RUNNER_REVISION,
  );
  if (!panoworld && !longcat) {
    throw new Error('Configure CODEBUDDY_PANOWORLD_RUNNER or CODEBUDDY_LONGCAT_RUNNER');
  }
  const retentionDays = env.CODEBUDDY_GPU_WORKER_RETENTION_DAYS?.trim();
  const maxStoredJobs = env.CODEBUDDY_GPU_WORKER_MAX_TERMINAL_JOBS?.trim();
  return {
    host: options.host,
    port: integer(options.port, '--port', 0, 65_535),
    token,
    stateDir: resolve(options.stateDir),
    allowedRoots: roots,
    runners: {
      ...(panoworld ? { panoworld_reconstruct: panoworld } : {}),
      ...(longcat ? { avatar_video_render: longcat } : {}),
    },
    workerId: options.workerId,
    maxConcurrency: integer(options.maxConcurrency, '--max-concurrency', 1, 2),
    ...(retentionDays ? {
      terminalJobRetentionMs: integer(retentionDays, 'CODEBUDDY_GPU_WORKER_RETENTION_DAYS', 1, 3650) * 24 * 60 * 60 * 1000,
    } : {}),
    ...(maxStoredJobs ? {
      maxStoredTerminalJobs: integer(maxStoredJobs, 'CODEBUDDY_GPU_WORKER_MAX_TERMINAL_JOBS', 1, 100_000),
    } : {}),
  };
}

async function detectNvidiaGpus(): Promise<Pick<GpuMediaWorkerCapabilities, 'gpus'>> {
  try {
    const { stdout } = await execFile(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,memory.used', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 5_000 }
    );
    const gpus = stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const [name, total, used] = line.split(',').map((part) => part.trim());
        const vramMb = Number(total);
        const usedMb = Number(used);
        return name && Number.isFinite(vramMb)
          ? [{ name, vramMb, busy: Number.isFinite(usedMb) && usedMb > 1_024 }]
          : [];
      });
    return { gpus };
  } catch {
    return { gpus: [] };
  }
}

export function createGpuWorkerCommand(): Command {
  const command = new Command('gpu-worker')
    .description('Run the authenticated PanoWorld/LongCat GPU job worker')
    .option('--host <host>', 'Bind host (use a Tailscale address on Darkstar)', '127.0.0.1')
    .option('--port <port>', 'Bind port', '4310')
    .option(
      '--state-dir <path>',
      'Persistent queue and job artifacts',
      join(homedir(), '.codebuddy', 'gpu-worker')
    )
    .option('--root <path...>', 'Allowed input/output roots')
    .option('--worker-id <id>', 'Worker identifier', 'darkstar')
    .option('--max-concurrency <count>', 'Concurrent jobs (1–2)', '1')
    .action(async (options: GpuWorkerCommandOptions) => {
      const config = buildGpuWorkerConfig(options);
      const worker = createGpuMediaWorkerServer(config, { capabilities: detectNvidiaGpus });
      const address = await worker.listen();
      logger.info(
        `GPU media worker ${config.workerId} listening on ${address.host}:${address.port}`
      );
      logger.info(`Enabled jobs: ${Object.keys(config.runners).join(', ')}`);

      await new Promise<void>((resolvePromise) => {
        let closing = false;
        const close = (): void => {
          if (closing) return;
          closing = true;
          void worker.close().finally(resolvePromise);
        };
        process.once('SIGINT', close);
        process.once('SIGTERM', close);
      });
    });
  return command;
}
