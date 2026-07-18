/** Authenticated, persistent execution server for isolated GPU media runners. */

import { spawn as realSpawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createHash, timingSafeEqual, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'fs/promises';
import { isAbsolute, join, relative, resolve } from 'path';
import {
  parseAvatarVideoPayload,
  parsePanoWorldPayload,
  type AvatarVideoPayload,
  type GpuMediaJobKind,
  type GpuMediaJobView,
  type GpuMediaWorkerCapabilities,
  type PanoWorldPayload,
} from '../tools/gpu-media-worker.js';

type JobPayload = PanoWorldPayload | AvatarVideoPayload;

export interface GpuMediaRunnerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  /** SHA-256 of the deployed runner, adapter and pinned model contract. */
  revision?: string;
}

export interface GpuMediaWorkerServerConfig {
  host: string;
  port: number;
  token: string;
  stateDir: string;
  allowedRoots: string[];
  runners: Partial<Record<GpuMediaJobKind, GpuMediaRunnerConfig>>;
  workerId?: string;
  maxConcurrency?: number;
  terminalJobRetentionMs?: number;
  maxStoredTerminalJobs?: number;
}

interface StoredGpuMediaJob extends GpuMediaJobView {
  payload: JobPayload;
  updatedAt: string;
  requestHash: string;
  runnerRevision: string;
  attempt: number;
  retryOf?: string;
}

export interface GpuMediaWorkerServerDeps {
  spawn?: typeof realSpawn;
  now?: () => Date;
  capabilities?: () => Promise<Pick<GpuMediaWorkerCapabilities, 'gpus'>>;
}

export interface GpuMediaWorkerServer {
  server: Server;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
  getJob(id: string): StoredGpuMediaJob | undefined;
}

const BODY_LIMIT = 1024 * 1024;
const ASSET_BODY_LIMIT = 64 * 1024 * 1024;
const LOG_LIMIT = 1024 * 1024;
const ARTIFACT_LIMIT = 512 * 1024 * 1024;
const JOB_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const PROGRESS_LINE_PATTERN = /^CODEBUDDY_PROGRESS\s+([0-9]+(?:\.[0-9]+)?)\s*(.*)$/u;

function publicJob(job: StoredGpuMediaJob): GpuMediaJobView {
  const { payload: _payload, updatedAt: _updatedAt, ...view } = job;
  return view;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function authorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT) throw new Error('request body exceeds 1 MiB');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error('request body is not valid JSON');
  }
}

async function readBinaryBody(request: IncomingMessage): Promise<Buffer> {
  const declared = Number(request.headers['content-length']);
  if (!Number.isInteger(declared) || declared <= 0 || declared > ASSET_BODY_LIMIT) {
    throw new Error('asset content-length must be between 1 byte and 64 MiB');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > declared || size > ASSET_BODY_LIMIT) throw new Error('asset body exceeds declared limit');
    chunks.push(buffer);
  }
  if (size !== declared) throw new Error('asset body length mismatch');
  return Buffer.concat(chunks);
}

function isWithin(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function validatePayloadPaths(payload: JobPayload, allowedRoots: string[]): Promise<void> {
  const paths =
    'panoramas' in payload
      ? [...payload.panoramas.map((panorama) => panorama.imagePath), payload.outputDir]
      : [payload.audioPath, payload.referenceImagePath];
  const canonicalRoots = (await Promise.all(allowedRoots.map(async (root) => {
    try { return await realpath(root); } catch { return null; }
  }))).filter((root): root is string => Boolean(root));
  for (const path of paths) {
    if (!isAbsolute(path)) throw new Error(`worker path must be absolute: ${path}`);
    if (!allowedRoots.some((root) => isWithin(path, root))) {
      throw new Error(`worker path is outside configured roots: ${path}`);
    }
    const canonicalPath = await realpath(path);
    if (!canonicalRoots.some((root) => isWithin(canonicalPath, root))) {
      throw new Error(`worker path resolves outside configured roots: ${path}`);
    }
  }
  if ('turnId' in payload && payload.audioSha256 && payload.referenceImageSha256) {
    const [audioDigest, imageDigest] = await Promise.all([
      sha256File(await realpath(payload.audioPath)),
      sha256File(await realpath(payload.referenceImagePath)),
    ]);
    if (audioDigest !== payload.audioSha256 || imageDigest !== payload.referenceImageSha256) {
      throw new Error('avatar asset digest does not match the submitted payload');
    }
  }
}

async function sha256File(filename: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(filename);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolvePromise);
  });
  return hash.digest('hex');
}

function appendBounded(current: string, chunk: Buffer): string {
  if (current.length >= LOG_LIMIT) return current;
  return `${current}${chunk.toString('utf8')}`.slice(0, LOG_LIMIT);
}

function runnerErrorSummary(stderr: string): string | undefined {
  const lines = stderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidate = [...lines]
    .reverse()
    .find(
      (line) =>
        !line.startsWith('Traceback (') &&
        !line.startsWith('File "') &&
        !/^\^+$/u.test(line)
    );
  if (!candidate) return undefined;
  const printable = [...candidate]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
  return printable ? printable.slice(0, 512) : undefined;
}

function consumeProgressLines(
  pending: string,
  chunk: Buffer,
  onProgress: (progress: number, message?: string) => void
): string {
  const combined = `${pending}${chunk.toString('utf8')}`;
  const lines = combined.split(/\r?\n/u);
  const remainder = lines.pop() ?? '';
  for (const line of lines) {
    const match = line.trim().match(PROGRESS_LINE_PATTERN);
    if (!match) continue;
    const numeric = Number(match[1]);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) continue;
    const message = match[2]?.trim().slice(0, 256);
    onProgress(Math.min(numeric, 0.99), message || undefined);
  }
  return remainder.slice(-1024);
}

function wasCancelled(job: StoredGpuMediaJob): boolean {
  return job.status === 'cancelled';
}

function waitForChild(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
  onLog: (stream: 'stdout' | 'stderr', chunk: Buffer) => void
): Promise<{ code: number | null; timedOut: boolean }> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (code: number | null, timedOut: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code, timedOut });
    };
    child.stdout.on('data', (chunk: Buffer) => onLog('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => onLog('stderr', chunk));
    child.once('error', () => finish(null, false));
    child.once('close', (code) => finish(code, false));
    const timer = setTimeout(() => {
      child.kill();
      finish(null, true);
    }, timeoutMs);
  });
}

export function createGpuMediaWorkerServer(
  config: GpuMediaWorkerServerConfig,
  deps: GpuMediaWorkerServerDeps = {}
): GpuMediaWorkerServer {
  if (Buffer.byteLength(config.token.trim(), 'utf8') < 24) {
    throw new Error('GPU worker token must contain at least 24 bytes');
  }
  if (config.allowedRoots.length === 0) throw new Error('At least one GPU worker root is required');
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65_535) {
    throw new Error('GPU worker port is invalid');
  }
  for (const [kind, runner] of Object.entries(config.runners)) {
    if (runner?.revision !== undefined && !/^[a-f0-9]{64}$/u.test(runner.revision)) {
      throw new Error(`Runner revision for ${kind} must be a lowercase SHA-256 digest`);
    }
  }

  const spawn = deps.spawn ?? realSpawn;
  const now = deps.now ?? (() => new Date());
  const jobs = new Map<string, StoredGpuMediaJob>();
  const running = new Map<string, ChildProcessWithoutNullStreams>();
  const executions = new Set<Promise<void>>();
  const maxConcurrency = Math.max(1, Math.min(config.maxConcurrency ?? 1, 2));
  let initialized = false;
  let processing = false;

  const jobDir = (id: string): string => join(config.stateDir, 'jobs', id);
  const jobFile = (id: string): string => join(jobDir(id), 'job.json');

  const persist = async (job: StoredGpuMediaJob): Promise<void> => {
    job.updatedAt = now().toISOString();
    await mkdir(jobDir(job.id), { recursive: true });
    const destination = jobFile(job.id);
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  };

  const initialize = async (): Promise<void> => {
    if (initialized) return;
    initialized = true;
    const root = join(config.stateDir, 'jobs');
    await mkdir(root, { recursive: true });
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !JOB_ID_PATTERN.test(entry.name)) continue;
      try {
        const job = JSON.parse(await readFile(jobFile(entry.name), 'utf8')) as StoredGpuMediaJob;
        if (
          job.id !== entry.name || !JOB_ID_PATTERN.test(job.id) ||
          (job.kind !== 'panoworld_reconstruct' && job.kind !== 'avatar_video_render') ||
          !['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(job.status)
        ) continue;
        const payload = job.kind === 'panoworld_reconstruct'
          ? parsePanoWorldPayload(job.payload)
          : parseAvatarVideoPayload(job.payload);
        const persistedRevision = /^[a-f0-9]{64}$/u.test(job.runnerRevision ?? '')
          ? job.runnerRevision
          : runnerRevision(job.kind);
        const computedHash = payloadHash(job.kind, payload, persistedRevision);
        if (job.requestHash && job.requestHash !== computedHash) continue;
        job.payload = payload;
        job.requestHash = computedHash;
        job.runnerRevision = persistedRevision;
        job.attempt = Number.isInteger(job.attempt) && job.attempt > 0 ? job.attempt : 1;
        if (job.status === 'queued' || job.status === 'running') {
          const validationRoots = 'panoramas' in job.payload
            ? config.allowedRoots
            : [...config.allowedRoots, join(config.stateDir, 'uploads')];
          await validatePayloadPaths(job.payload, validationRoots);
        }
        if (job.status === 'running') {
          job.status = 'failed';
          job.error = 'GPU worker restarted while the job was running';
          job.completedAt = now().toISOString();
          await persist(job);
        }
        jobs.set(job.id, job);
      } catch {
        // Ignore corrupt job directories; they remain on disk for manual audit.
      }
    }
    const terminal = [...jobs.values()]
      .filter((job) => ['succeeded', 'failed', 'cancelled'].includes(job.status))
      .sort((left, right) => Date.parse(right.completedAt ?? right.updatedAt) - Date.parse(left.completedAt ?? left.updatedAt));
    const cutoff = config.terminalJobRetentionMs && config.terminalJobRetentionMs > 0
      ? now().getTime() - config.terminalJobRetentionMs
      : null;
    const keep = config.maxStoredTerminalJobs && config.maxStoredTerminalJobs > 0
      ? config.maxStoredTerminalJobs
      : Number.POSITIVE_INFINITY;
    for (const [index, job] of terminal.entries()) {
      const timestamp = Date.parse(job.completedAt ?? job.updatedAt);
      if (index < keep && (cutoff === null || !Number.isFinite(timestamp) || timestamp >= cutoff)) continue;
      jobs.delete(job.id);
      await rm(jobDir(job.id), { recursive: true, force: true });
    }
  };

  const executeJob = async (job: StoredGpuMediaJob): Promise<void> => {
    const runner = config.runners[job.kind];
    if (!runner) {
      job.status = 'failed';
      job.error = `No runner configured for ${job.kind}`;
      job.completedAt = now().toISOString();
      await persist(job);
      return;
    }
    const directory = jobDir(job.id);
    const requestPath = join(directory, 'request.json');
    const resultPath = join(directory, 'result.json');
    job.status = 'running';
    job.startedAt = now().toISOString();
    job.progress = 0;
    await writeFile(
      requestPath,
      `${JSON.stringify({ id: job.id, kind: job.kind, payload: job.payload }, null, 2)}\n`,
      'utf8'
    );
    await persist(job);

    const child = spawn(runner.command, [...(runner.args ?? []), requestPath], {
      cwd: directory,
      env: {
        ...process.env,
        ...runner.env,
        CODEBUDDY_GPU_ALLOWED_ROOTS_JSON: JSON.stringify(config.allowedRoots),
        CODEBUDDY_GPU_JOB_ID: job.id,
        CODEBUDDY_GPU_JOB_REQUEST: requestPath,
        CODEBUDDY_GPU_JOB_RESULT: resultPath,
      },
      shell: false,
      windowsHide: true,
    });
    running.set(job.id, child);
    let stdout = '';
    let stderr = '';
    let pendingProgressLine = '';
    let progressWrites = Promise.resolve();
    const recordProgress = (progress: number, message?: string): void => {
      if (wasCancelled(job) || progress < (job.progress ?? 0)) return;
      job.progress = progress;
      if (message) job.progressMessage = message;
      progressWrites = progressWrites.then(async () => {
        await Promise.all([
          persist(job),
          writeFile(join(directory, 'stdout.log'), stdout, 'utf8'),
          writeFile(join(directory, 'stderr.log'), stderr, 'utf8'),
        ]);
      });
    };
    const result = await waitForChild(
      child,
      Math.max(1_000, Math.min(runner.timeoutMs ?? 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000)),
      (stream, chunk) => {
        if (stream === 'stdout') {
          stdout = appendBounded(stdout, chunk);
          pendingProgressLine = consumeProgressLines(
            pendingProgressLine,
            chunk,
            recordProgress
          );
        } else {
          stderr = appendBounded(stderr, chunk);
        }
      }
    );
    running.delete(job.id);
    await progressWrites;
    await Promise.all([
      writeFile(join(directory, 'stdout.log'), stdout, 'utf8'),
      writeFile(join(directory, 'stderr.log'), stderr, 'utf8'),
    ]);
    // The DELETE handler may mutate this shared job while the child is running.
    if (wasCancelled(job)) {
      await persist(job);
      return;
    }
    if (result.timedOut || result.code !== 0) {
      job.status = 'failed';
      if (result.timedOut) {
        job.error = 'GPU runner timed out';
      } else {
        const summary = runnerErrorSummary(stderr);
        job.error = `GPU runner exited with code ${result.code ?? 'unknown'}${summary ? `: ${summary}` : ''}`;
      }
    } else {
      try {
        const output = JSON.parse(await readFile(resultPath, 'utf8')) as unknown;
        if (!output || typeof output !== 'object' || Array.isArray(output)) {
          throw new Error('result manifest must be an object');
        }
        job.status = 'succeeded';
        job.output = output as Record<string, unknown>;
        job.progress = 1;
        job.progressMessage = 'completed';
      } catch (error) {
        job.status = 'failed';
        job.error = `GPU runner result is invalid: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    job.completedAt = now().toISOString();
    await persist(job);
  };

  const processQueue = async (): Promise<void> => {
    if (processing) return;
    processing = true;
    try {
      while (executions.size < maxConcurrency) {
        const next = [...jobs.values()].find((job) => job.status === 'queued');
        if (!next) break;
        // Reserve synchronously so a concurrency >1 loop cannot select the
        // same queued job twice before its first filesystem await.
        next.status = 'running';
        const execution = executeJob(next)
          .catch(async (error) => {
            next.status = 'failed';
            next.error = error instanceof Error ? error.message : String(error);
            next.completedAt = now().toISOString();
            await persist(next);
          })
          .finally(() => {
            executions.delete(execution);
            processing = false;
            void processQueue();
          });
        executions.add(execution);
        if (maxConcurrency === 1) break;
      }
    } finally {
      if (
        executions.size >= maxConcurrency ||
        ![...jobs.values()].some((job) => job.status === 'queued')
      ) {
        processing = false;
      }
    }
  };

  const runnerRevision = (kind: GpuMediaJobKind): string => {
    const configured = config.runners[kind]?.revision;
    if (configured !== undefined) {
      if (!/^[a-f0-9]{64}$/u.test(configured)) {
        throw new Error(`Runner revision for ${kind} must be a lowercase SHA-256 digest`);
      }
      return configured;
    }
    return createHash('sha256')
      .update(JSON.stringify({ kind, runner: config.runners[kind] ?? null }))
      .digest('hex');
  };

  const payloadHash = (
    kind: GpuMediaJobKind,
    payload: JobPayload,
    revision = runnerRevision(kind),
  ): string => {
    const identity = kind === 'avatar_video_render' && 'turnId' in payload &&
      payload.audioSha256 && payload.referenceImageSha256
      ? {
          turnId: payload.turnId,
          audioSha256: payload.audioSha256,
          referenceImageSha256: payload.referenceImageSha256,
          prompt: payload.prompt,
          resolution: payload.resolution,
          channelTarget: payload.channelTarget,
        }
      : payload;
    return createHash('sha256')
      .update(JSON.stringify({ kind, payload: identity, runnerRevision: revision }))
      .digest('hex');
  };

  const submit = async (
    kind: GpuMediaJobKind,
    rawPayload: unknown,
    retryTerminal = false,
  ): Promise<StoredGpuMediaJob> => {
    if (!config.runners[kind]) throw new Error(`No runner configured for ${kind}`);
    const payload =
      kind === 'panoworld_reconstruct'
        ? parsePanoWorldPayload(rawPayload)
        : parseAvatarVideoPayload(rawPayload);
    const validationRoots = 'panoramas' in payload
      ? config.allowedRoots
      : [...config.allowedRoots, join(config.stateDir, 'uploads')];
    await validatePayloadPaths(payload, validationRoots);
    const requestHash = payloadHash(kind, payload);
    let retryOf: StoredGpuMediaJob | undefined;
    if (kind === 'avatar_video_render' && 'turnId' in payload) {
      const matchingTurns = [...jobs.values()]
        .filter((job) => job.kind === 'avatar_video_render' && 'turnId' in job.payload && job.payload.turnId === payload.turnId)
        .sort((left, right) => right.attempt - left.attempt);
      if (matchingTurns.some((job) => job.requestHash !== requestHash)) {
        throw new Error(`turnId collision with different payload: ${payload.turnId}`);
      }
      const existing = matchingTurns[0];
      if (existing) {
        const terminalRetry = retryTerminal && ['succeeded', 'failed', 'cancelled'].includes(existing.status);
        if (!terminalRetry) {
          if (existing.status === 'queued') void processQueue();
          return existing;
        }
        retryOf = existing;
      }
    }
    const timestamp = now().toISOString();
    const job: StoredGpuMediaJob = {
      id: `gpu-${randomUUID()}`,
      kind,
      status: 'queued',
      progress: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      payload,
      requestHash,
      runnerRevision: runnerRevision(kind),
      attempt: (retryOf?.attempt ?? 0) + 1,
      ...(retryOf ? { retryOf: retryOf.id } : {}),
    };
    await persist(job);
    jobs.set(job.id, job);
    void processQueue();
    return job;
  };

  const server = createServer(async (request, response) => {
    try {
      await initialize();
      if (!authorized(request, config.token)) {
        response.setHeader('www-authenticate', 'Bearer');
        json(response, 401, { error: 'unauthorized' });
        return;
      }
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      if (request.method === 'GET' && url.pathname === '/v1/capabilities') {
        const extra = deps.capabilities ? await deps.capabilities() : {};
        json(response, 200, {
          protocolVersion: 1,
          workerId: config.workerId ?? 'codebuddy-gpu-worker',
          jobs: Object.keys(config.runners),
          queueDepth: [...jobs.values()].filter((job) => job.status === 'queued').length,
          activeJobs: [...jobs.values()].filter((job) => job.status === 'running').length,
          availableSlots: Math.max(0, maxConcurrency - [...jobs.values()].filter((job) => job.status === 'running').length),
          runnerRevisions: Object.fromEntries(Object.keys(config.runners).map((kind) => [kind, runnerRevision(kind as GpuMediaJobKind)])),
          ...extra,
        });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/assets') {
        const name = url.searchParams.get('name') ?? '';
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/u.test(name)) throw new Error('asset name is invalid');
        const contentType = String(request.headers['content-type'] ?? '').split(';', 1)[0] ?? '';
        const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'audio/wav']);
        if (!allowedTypes.has(contentType)) throw new Error('asset content-type is not allowed');
        const bytes = await readBinaryBody(request);
        const directory = join(config.stateDir, 'uploads', randomUUID());
        await mkdir(directory, { recursive: true });
        const path = join(directory, name);
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
        json(response, 201, { path, bytes: bytes.byteLength });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/jobs') {
        const body = await readJsonBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body))
          throw new Error('job body must be an object');
        const input = body as Record<string, unknown>;
        if (input.kind !== 'panoworld_reconstruct' && input.kind !== 'avatar_video_render') {
          throw new Error('job kind is invalid');
        }
        const job = await submit(input.kind, input.payload, input.retryTerminal === true);
        json(response, 202, publicJob(job));
        return;
      }
      const artifactMatch = url.pathname.match(
        /^\/v1\/jobs\/([A-Za-z0-9._-]{1,128})\/artifacts\/(avatar\.mp4)$/u
      );
      if (request.method === 'GET' && artifactMatch) {
        const id = artifactMatch[1]!;
        const artifactName = artifactMatch[2]!;
        const job = jobs.get(id);
        if (!job) {
          json(response, 404, { error: 'job not found' });
          return;
        }
        if (job.kind !== 'avatar_video_render' || job.status !== 'succeeded') {
          json(response, 409, { error: 'avatar artifact is not ready' });
          return;
        }
        const directory = await realpath(jobDir(id));
        const artifactPath = await realpath(join(directory, 'artifacts', artifactName));
        if (!isWithin(artifactPath, directory)) {
          throw new Error('artifact resolves outside its job directory');
        }
        const artifactStat = await stat(artifactPath);
        if (!artifactStat.isFile() || artifactStat.size <= 0 || artifactStat.size > ARTIFACT_LIMIT) {
          throw new Error('artifact is empty, invalid, or exceeds 512 MiB');
        }
        response.writeHead(200, {
          'content-type': 'video/mp4',
          'content-length': artifactStat.size,
          'content-disposition': 'attachment; filename="avatar.mp4"',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        const stream = createReadStream(artifactPath);
        stream.once('error', () => response.destroy());
        stream.pipe(response);
        return;
      }
      const match = url.pathname.match(/^\/v1\/jobs\/([A-Za-z0-9._-]{1,128})$/u);
      if (match) {
        const id = match[1]!;
        const job = jobs.get(id);
        if (!job) {
          json(response, 404, { error: 'job not found' });
          return;
        }
        if (request.method === 'GET') {
          json(response, 200, publicJob(job));
          return;
        }
        if (request.method === 'DELETE') {
          if (job.status === 'queued' || job.status === 'running') {
            job.status = 'cancelled';
            job.completedAt = now().toISOString();
            running.get(job.id)?.kill();
            await persist(job);
          }
          json(response, 200, publicJob(job));
          return;
        }
      }
      json(response, 404, { error: 'not found' });
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  return {
    server,
    async listen() {
      await initialize();
      return new Promise((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          server.off('error', reject);
          const address = server.address();
          resolvePromise({
            host: config.host,
            port: typeof address === 'object' && address ? address.port : config.port,
          });
          void processQueue();
        });
      });
    },
    async close() {
      for (const child of running.values()) child.kill();
      await Promise.allSettled([...executions]);
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      });
    },
    getJob(id) {
      return jobs.get(id);
    },
  };
}
