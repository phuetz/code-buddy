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

interface SpawnInvocation {
  args: string[];
  executable: string;
}

type RemoteResearchScriptFiles = ReturnType<typeof resolveResearchScriptJobFiles> & {
  root: string;
};

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
  const preRunSteps: SpawnInvocation[] = [];
  const postRunSteps: SpawnInvocation[] = [];

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
    const plan = buildVercelSandboxSpawn(job, absoluteFiles);
    spawnExecutable = plan.spawnExecutable;
    spawnArgs = plan.spawnArgs;
    preRunSteps.push(...plan.preRunSteps);
    postRunSteps.push(...plan.postRunSteps);
  }

  for (const step of preRunSteps) {
    const preRunResult = await spawnAndCapture(step.executable, step.args, {
      cwd,
      env,
      timeoutMs,
    });
    assertRemoteStepSucceeded(step, preRunResult, 'setup');
  }

  let result = await spawnAndCapture(spawnExecutable, spawnArgs, {
    cwd,
    env,
    timeoutMs,
  });

  if (result.exitCode === 0 && !result.timedOut) {
    for (const step of postRunSteps) {
      const postRunResult = await spawnAndCapture(step.executable, step.args, {
        cwd,
        env,
        timeoutMs,
      });
      result.stdout += postRunResult.stdout;
      result.stderr += postRunResult.stderr;
      if (postRunResult.timedOut || postRunResult.exitCode !== 0) {
        result = {
          ...result,
          exitCode: postRunResult.exitCode ?? 1,
          signal: postRunResult.signal,
          stderr: `${result.stderr}\nRemote artifact sync failed: ${formatSpawnInvocation(step)}`.trim(),
          timedOut: result.timedOut || postRunResult.timedOut,
        };
        break;
      }
    }
  }
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
  absoluteFiles: ReturnType<typeof resolveResearchScriptJobFiles>,
): {
  postRunSteps: SpawnInvocation[];
  preRunSteps: SpawnInvocation[];
  spawnArgs: string[];
  spawnExecutable: string;
} {
  const target = job.sandboxPolicy.target ?? job.id;
  const cleanExec = path.basename(job.command.executable).replace(/\.(exe|cmd)$/i, '');
  const remoteFiles = buildVercelRemoteFiles(job);
  const remoteEnv = buildRemoteEnv(job, remoteFiles);
  const remoteArgs = job.command.args.map((arg) => resolveRemoteCommandArg(job, remoteFiles, arg));
  const spawnArgs = [
    'exec',
    '--workdir', remoteFiles.root,
  ];
  for (const [key, value] of Object.entries(remoteEnv)) {
    spawnArgs.push('--env', `${key}=${value}`);
  }
  spawnArgs.push(target, cleanExec, ...remoteArgs);
  return {
    preRunSteps: [
      {
        executable: 'sandbox',
        args: ['exec', target, 'mkdir', '-p', remoteFiles.root],
      },
      {
        executable: 'sandbox',
        args: ['copy', absoluteFiles.script, `${target}:${remoteFiles.script}`],
      },
      {
        executable: 'sandbox',
        args: ['copy', absoluteFiles.input, `${target}:${remoteFiles.input}`],
      },
    ],
    postRunSteps: [
      {
        executable: 'sandbox',
        args: ['copy', `${target}:${remoteFiles.output}`, absoluteFiles.output],
      },
    ],
    spawnExecutable: 'sandbox',
    spawnArgs,
  };
}

function buildVercelRemoteFiles(job: ResearchScriptJobArtifact): RemoteResearchScriptFiles {
  const root = `/home/sandbox/codebuddy-research/${sanitizeRemotePathSegment(job.id)}`;
  return {
    root,
    manifest: `${root}/manifest.json`,
    readme: `${root}/README.md`,
    script: `${root}/${path.basename(job.files.script)}`,
    input: `${root}/input.json`,
    output: `${root}/output.json`,
    stdout: `${root}/stdout.log`,
    stderr: `${root}/stderr.log`,
    summary: `${root}/summary.md`,
  };
}

function buildRemoteEnv(
  job: ResearchScriptJobArtifact,
  remoteFiles: RemoteResearchScriptFiles,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(job.command.env)
      .map(([key, value]) => [key, resolveRemoteEnvValue(job, remoteFiles, value)] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0),
  );
}

function resolveRemoteEnvValue(
  job: ResearchScriptJobArtifact,
  remoteFiles: RemoteResearchScriptFiles,
  value: string,
): string {
  const fileEntries = Object.entries(job.files) as Array<[keyof typeof job.files, string]>;
  const matchedFile = fileEntries.find(([, relativePath]) => relativePath === value);
  if (matchedFile) {
    return remoteFiles[matchedFile[0]];
  }
  if (value === 'input.json') return remoteFiles.input;
  if (value === 'output.json') return remoteFiles.output;
  return value;
}

function resolveRemoteCommandArg(
  job: ResearchScriptJobArtifact,
  remoteFiles: RemoteResearchScriptFiles,
  arg: string,
): string {
  if (arg === job.files.script) {
    return remoteFiles.script;
  }
  const fileEntries = Object.entries(job.files) as Array<[keyof typeof job.files, string]>;
  const matchedFile = fileEntries.find(([, relativePath]) => relativePath === arg);
  if (matchedFile) {
    return remoteFiles[matchedFile[0]];
  }
  return arg;
}

function assertRemoteStepSucceeded(
  step: SpawnInvocation,
  result: Awaited<ReturnType<typeof spawnAndCapture>>,
  phase: string,
): void {
  if (!result.timedOut && result.exitCode === 0) {
    return;
  }
  const detail = result.stderr || result.stdout || `exitCode=${result.exitCode ?? 'null'}`;
  throw new Error(`Research script remote ${phase} failed: ${formatSpawnInvocation(step)}\n${detail}`);
}

function formatSpawnInvocation(invocation: SpawnInvocation): string {
  return [invocation.executable, ...invocation.args].join(' ');
}

function sanitizeRemotePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'job';
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
