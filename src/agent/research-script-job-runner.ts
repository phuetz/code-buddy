import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import type { ResearchScriptJobArtifact } from './research-script-job-artifact.js';
import {
  resolveResearchScriptJobFiles,
  resolveResearchScriptPathInsideRoot,
} from './research-script-job-materializer.js';

export type ResearchScriptJobRunStatus = 'completed' | 'failed' | 'timed_out';

export interface RunMaterializedResearchScriptJobOptions {
  allowNetwork?: boolean;
  allowedExecutables?: string[];
  inheritEnv?: boolean;
  rootDir: string;
  timeoutMs?: number;
}

export interface ResearchScriptJobRunResult {
  commandPreview: string;
  durationMs: number;
  exitCode: number | null;
  jobId: string;
  outputPath: string;
  signal: NodeJS.Signals | null;
  status: ResearchScriptJobRunStatus;
  stderrPath: string;
  stdoutPath: string;
  summaryPath: string;
  timedOut: boolean;
}

const DEFAULT_ALLOWED_EXECUTABLES = new Set([
  'bash',
  'node',
  'node.exe',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
  'python',
  'python.exe',
  'python3',
  'python3.exe',
  'sh',
  'tsx',
  'tsx.cmd',
]);

export async function runMaterializedResearchScriptJob(
  job: ResearchScriptJobArtifact,
  options: RunMaterializedResearchScriptJobOptions,
): Promise<ResearchScriptJobRunResult> {
  const provider = job.sandboxPolicy.provider;
  if (
    provider !== 'local'
    && provider !== 'docker'
    && provider !== 'wsl'
    && provider !== 'remote'
    && provider !== 'daytona'
    && provider !== 'vercel-sandbox'
  ) {
    throw new Error(`Research script runner only supports local, docker, wsl, remote, daytona, and vercel-sandbox providers: ${provider}`);
  }
  if (job.sandboxPolicy.network !== 'disabled' && !options.allowNetwork) {
    throw new Error(`Research script job requires network policy ${job.sandboxPolicy.network}; pass allowNetwork to run it locally.`);
  }
  assertExecutableAllowed(job.command.executable, options.allowedExecutables);

  const rootDir = path.resolve(options.rootDir);
  const absoluteFiles = resolveResearchScriptJobFiles(rootDir, job.files);
  const artifactRoot = resolveResearchScriptPathInsideRoot(rootDir, job.artifactRoot);
  const cwd = resolveCommandCwd(rootDir, artifactRoot, job.command.cwd);
  const args = job.command.args.map((arg) => resolveCommandArg(rootDir, job, absoluteFiles.script, arg));
  const env = buildChildEnv(job, absoluteFiles, options.inheritEnv === true);
  const timeoutMs = normalizeTimeout(options.timeoutMs ?? job.sandboxPolicy.timeoutMs);
  const commandPreview = [job.command.executable, ...job.command.args].join(' ');
  const startedAt = Date.now();

  await Promise.all([
    fs.mkdir(cwd, { recursive: true }),
    fs.mkdir(path.dirname(absoluteFiles.stdout), { recursive: true }),
    fs.mkdir(path.dirname(absoluteFiles.stderr), { recursive: true }),
  ]);

  let spawnExecutable = job.command.executable;
  let spawnArgs = args;

  if (provider === 'docker') {
    const cleanExec = path.basename(job.command.executable).replace(/\.(exe|cmd)$/i, '');
    let image = 'node:20';
    if (job.language === 'python') {
      image = 'python:3';
    } else if (job.language === 'shell') {
      image = 'ubuntu:22.04';
    }

    spawnExecutable = 'docker';
    spawnArgs = [
      'run',
      '--rm',
      '-v', `${cwd}:/workspace`,
      '-w', '/workspace',
    ];
    if (job.sandboxPolicy.network === 'disabled') {
      spawnArgs.push('--network', 'none');
    }
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) {
        spawnArgs.push('-e', `${key}=${value}`);
      }
    }
    spawnArgs.push(image, cleanExec);
    const normalizeDockerArg = (arg: string): string => {
      const resolvedArg = path.resolve(arg);
      if (resolvedArg.startsWith(cwd)) {
        return resolvedArg.replace(cwd, '/workspace').replace(/\\/g, '/');
      }
      return arg;
    };
    spawnArgs.push(...args.map(normalizeDockerArg));
  } else if (provider === 'wsl') {
    const cleanExec = path.basename(job.command.executable).replace(/\.(exe|cmd)$/i, '');
    const wslExecutable = job.command.executable.includes('\\') || job.command.executable.includes('/')
      ? toWslPath(job.command.executable)
      : cleanExec;

    spawnExecutable = 'wsl';
    spawnArgs = [
      '--cd', cwd,
      '--exec', 'env',
    ];
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) {
        spawnArgs.push(`${key}=${toWslPath(value)}`);
      }
    }
    spawnArgs.push(wslExecutable, ...args.map(toWslPath));
  } else if (provider === 'remote' || provider === 'daytona') {
    ({ spawnExecutable, spawnArgs } = buildDaytonaSpawn(job, env, args));
  } else if (provider === 'vercel-sandbox') {
    ({ spawnExecutable, spawnArgs } = buildVercelSandboxSpawn(job, env, args));
  }

  const result = await spawnAndCapture(spawnExecutable, spawnArgs, {
    cwd,
    env,
    timeoutMs,
  });
  const durationMs = Date.now() - startedAt;
  const status: ResearchScriptJobRunStatus = result.timedOut
    ? 'timed_out'
    : result.exitCode === 0
      ? 'completed'
      : 'failed';

  await Promise.all([
    fs.writeFile(absoluteFiles.stdout, result.stdout, 'utf8'),
    fs.writeFile(absoluteFiles.stderr, result.stderr, 'utf8'),
    fs.writeFile(
      absoluteFiles.summary,
      renderRunSummary({
        commandPreview,
        durationMs,
        exitCode: result.exitCode,
        job,
        signal: result.signal,
        status,
        timedOut: result.timedOut,
      }),
      'utf8',
    ),
  ]);

  return {
    commandPreview,
    durationMs,
    exitCode: result.exitCode,
    jobId: job.id,
    outputPath: absoluteFiles.output,
    signal: result.signal,
    status,
    stderrPath: absoluteFiles.stderr,
    stdoutPath: absoluteFiles.stdout,
    summaryPath: absoluteFiles.summary,
    timedOut: result.timedOut,
  };
}

function buildDaytonaSpawn(
  job: ResearchScriptJobArtifact,
  env: NodeJS.ProcessEnv,
  args: string[],
): {
  spawnArgs: string[];
  spawnExecutable: string;
} {
  const cleanExec = path.basename(job.command.executable).replace(/\.(exe|cmd)$/i, '');
  const spawnArgs = [
    'exec',
    '-w', job.sandboxPolicy.target ?? job.id,
    '--',
    'env',
  ];
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      spawnArgs.push(`${key}=${value}`);
    }
  }
  spawnArgs.push(cleanExec, ...args);
  return {
    spawnExecutable: 'daytona',
    spawnArgs,
  };
}

function buildVercelSandboxSpawn(
  job: ResearchScriptJobArtifact,
  env: NodeJS.ProcessEnv,
  args: string[],
): {
  spawnArgs: string[];
  spawnExecutable: string;
} {
  const cleanExec = path.basename(job.command.executable).replace(/\.(exe|cmd)$/i, '');
  const spawnArgs = [
    'exec',
  ];
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      spawnArgs.push('--env', `${key}=${value}`);
    }
  }
  spawnArgs.push(job.sandboxPolicy.target ?? job.id, cleanExec, ...args);
  return {
    spawnExecutable: 'sandbox',
    spawnArgs,
  };
}

function assertExecutableAllowed(executable: string, allowedExecutables: string[] | undefined): void {
  const allowed = new Set([
    ...DEFAULT_ALLOWED_EXECUTABLES,
    ...(allowedExecutables ?? []).map((value) => value.toLowerCase()),
  ]);
  const executableName = path.basename(executable).toLowerCase();
  if (!allowed.has(executableName) && !allowed.has(executable.toLowerCase())) {
    throw new Error(`Research script executable is not allowed: ${executable}`);
  }
}

function resolveCommandCwd(rootDir: string, artifactRoot: string, cwd: string): string {
  const normalized = cwd.trim();
  if (!normalized || normalized === '.') {
    return artifactRoot;
  }
  return resolveResearchScriptPathInsideRoot(rootDir, normalized);
}

function resolveCommandArg(
  rootDir: string,
  job: ResearchScriptJobArtifact,
  absoluteScriptPath: string,
  arg: string,
): string {
  if (arg === job.files.script) {
    return absoluteScriptPath;
  }
  if (arg.includes('/') || arg.includes('\\')) {
    return resolveResearchScriptPathInsideRoot(rootDir, arg);
  }
  return arg;
}

function buildChildEnv(
  job: ResearchScriptJobArtifact,
  absoluteFiles: ReturnType<typeof resolveResearchScriptJobFiles>,
  inheritEnv: boolean,
): NodeJS.ProcessEnv {
  const baseEnv: NodeJS.ProcessEnv = inheritEnv ? { ...process.env } : pickMinimalEnv();
  for (const [key, value] of Object.entries(job.command.env)) {
    baseEnv[key] = resolveEnvValue(job, absoluteFiles, value);
  }
  return baseEnv;
}

function pickMinimalEnv(): NodeJS.ProcessEnv {
  const keys = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE'];
  return Object.fromEntries(
    keys
      .map((key) => [key, process.env[key]] as const)
      .filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string'),
  );
}

function resolveEnvValue(
  job: ResearchScriptJobArtifact,
  absoluteFiles: ReturnType<typeof resolveResearchScriptJobFiles>,
  value: string,
): string {
  const fileEntries = Object.entries(job.files) as Array<[keyof typeof job.files, string]>;
  const matchedFile = fileEntries.find(([, relativePath]) => relativePath === value);
  if (matchedFile) {
    return absoluteFiles[matchedFile[0]];
  }
  if (value === 'input.json') return absoluteFiles.input;
  if (value === 'output.json') return absoluteFiles.output;
  return value;
}

function normalizeTimeout(value: number): number {
  if (!Number.isFinite(value)) {
    return 120000;
  }
  return Math.min(3_600_000, Math.max(100, Math.trunc(value)));
}

function spawnAndCapture(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  },
): Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function renderRunSummary(input: {
  commandPreview: string;
  durationMs: number;
  exitCode: number | null;
  job: ResearchScriptJobArtifact;
  signal: NodeJS.Signals | null;
  status: ResearchScriptJobRunStatus;
  timedOut: boolean;
}): string {
  return [
    `# Research Script Run: ${input.job.title}`,
    '',
    `Job id: ${input.job.id}`,
    `Status: ${input.status}`,
    `Exit code: ${input.exitCode ?? 'null'}`,
    `Signal: ${input.signal ?? 'none'}`,
    `Timed out: ${input.timedOut ? 'yes' : 'no'}`,
    `Duration: ${input.durationMs}ms`,
    `Command: ${input.commandPreview}`,
    '',
    '## Assertions',
    ...input.job.assertions.map((assertion) => `- [${assertion.required ? 'required' : 'optional'}] ${assertion.description}`),
    '',
  ].join('\n');
}

function toWslPath(val: string): string {
  if (typeof val !== 'string') return val;
  let res = val.replace(/^([a-zA-Z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`);
  res = res.replace(/\\/g, '/');
  return res;
}
