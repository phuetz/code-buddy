import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { ResearchWorkerResult, WideResearchResult } from './wide-research.js';
import {
  assertNoSymlinkParents,
  resolveWideResearchFilePath,
  WideResearchFileSafetyError,
} from './wide-research-files.js';

export const WIDE_RESEARCH_CHECKPOINT_VERSION = 1 as const;
export const WIDE_RESEARCH_CHECKPOINT_KIND = 'codebuddy_wide_research_checkpoint' as const;

const MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024;
const MAX_CHECKPOINT_ITEMS = 250;
const MAX_CHECKPOINT_CONCURRENCY = 20;
const MAX_ERROR_LENGTH = 1_000;

export type WideResearchCheckpointState =
  | 'decomposed'
  | 'running'
  | 'aggregating'
  | 'completed'
  | 'failed';

export interface WideResearchCheckpointOptions {
  /** Deprecated compatibility mirror of `concurrency`. */
  workers: number;
  /** Total number of independent items in the run. */
  items: number;
  /** Maximum number of simultaneously active workers. */
  concurrency: number;
  maxRoundsPerWorker: number;
  workerTimeoutMs: number;
  overallTimeoutMs: number;
  decomposeTimeoutMs: number;
  aggregateTimeoutMs: number;
}

export interface WideResearchCheckpoint {
  kind: typeof WIDE_RESEARCH_CHECKPOINT_KIND;
  version: typeof WIDE_RESEARCH_CHECKPOINT_VERSION;
  state: WideResearchCheckpointState;
  topic: string;
  options: WideResearchCheckpointOptions;
  /** SHA-256 only; raw context/provider configuration is never persisted. */
  executionFingerprint: string;
  subtopics: string[];
  workerResults: ResearchWorkerResult[];
  createdAt: string;
  updatedAt: string;
}

export interface WideResearchCheckpointCompatibility {
  topic: string;
  options: WideResearchCheckpointOptions;
  executionFingerprint: string;
  /** Fingerprints emitted by compatible legacy schemas. */
  acceptedExecutionFingerprints?: string[];
}

export interface WideResearchCheckpointStore {
  /** Optional create-mode preflight; file store refuses any existing target. */
  assertCreatable?(path: string): Promise<void>;
  load(path: string): Promise<WideResearchCheckpoint>;
  save(path: string, checkpoint: WideResearchCheckpoint): Promise<void>;
}

interface CheckpointFileInfo {
  size: number;
  mode?: number;
  uid?: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface WideResearchCheckpointFileOperations {
  lstat(path: string): Promise<CheckpointFileInfo>;
  mkdir(path: string): Promise<unknown>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, payload: string): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  unlink(path: string): Promise<unknown>;
}

export class WideResearchCheckpointError extends Error {
  readonly code:
    | 'INVALID_PATH'
    | 'READ_FAILED'
    | 'INVALID_CHECKPOINT'
    | 'UNSUPPORTED_VERSION'
    | 'INCOMPATIBLE_CHECKPOINT'
    | 'WRITE_FAILED';

  constructor(code: WideResearchCheckpointError['code'], message: string) {
    super(message);
    this.name = 'WideResearchCheckpointError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function parseOptions(value: unknown): WideResearchCheckpointOptions {
  if (!isRecord(value)) {
    throw new WideResearchCheckpointError('INVALID_CHECKPOINT', 'Checkpoint options are missing.');
  }
  const readOption = (key: keyof WideResearchCheckpointOptions): number => {
    const candidate = value[key];
    if (!isFiniteInteger(candidate, 1)) {
      throw new WideResearchCheckpointError(
        'INVALID_CHECKPOINT',
        `Checkpoint option "${key}" is invalid.`,
      );
    }
    return candidate;
  };
  const workers = readOption('workers');
  const readOptionalOption = (
    key: 'items' | 'concurrency',
    fallback: number,
  ): number => {
    if (value[key] === undefined) return fallback;
    const candidate = value[key];
    if (!isFiniteInteger(candidate, 1)) {
      throw new WideResearchCheckpointError(
        'INVALID_CHECKPOINT',
        `Checkpoint option "${key}" is invalid.`,
      );
    }
    return candidate;
  };
  const options: WideResearchCheckpointOptions = {
    workers,
    items: readOptionalOption('items', workers),
    concurrency: readOptionalOption('concurrency', workers),
    maxRoundsPerWorker: readOption('maxRoundsPerWorker'),
    workerTimeoutMs: readOption('workerTimeoutMs'),
    overallTimeoutMs: readOption('overallTimeoutMs'),
    decomposeTimeoutMs: readOption('decomposeTimeoutMs'),
    aggregateTimeoutMs: readOption('aggregateTimeoutMs'),
  };
  if (options.items > MAX_CHECKPOINT_ITEMS) {
    throw new WideResearchCheckpointError(
      'INVALID_CHECKPOINT',
      `Checkpoint item count exceeds ${MAX_CHECKPOINT_ITEMS}.`,
    );
  }
  if (
    options.workers > MAX_CHECKPOINT_CONCURRENCY ||
    options.concurrency > MAX_CHECKPOINT_CONCURRENCY ||
    options.concurrency > options.items ||
    (value.concurrency !== undefined && options.workers !== options.concurrency)
  ) {
    throw new WideResearchCheckpointError(
      'INVALID_CHECKPOINT',
      `Checkpoint concurrency exceeds ${MAX_CHECKPOINT_CONCURRENCY} or is inconsistent.`,
    );
  }
  return options;
}

export function redactWideResearchText(
  value: string,
  sensitiveValues: string[] = [],
): string {
  let redacted = value;
  for (const sensitive of sensitiveValues.filter((item) => item.length > 0)) {
    redacted = redacted.split(sensitive).join('[REDACTED]');
  }
  return redacted
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(?:sk-(?:or-v1-)?|xai-|gsk_|gh[pousr]_|github_pat_)[a-z0-9_-]{12,}\b/gi,
      '[REDACTED]',
    )
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, '[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED]')
    .replace(
      /\b((?:[a-z0-9]+[_-])*(?:api[_-]?key|apikey|access[_-]?token|token|secret|password|authorization))\b\s*["']?\s*[:=]\s*(["'])[^"'\r\n]*\2/gi,
      '$1=[REDACTED]',
    )
    .replace(
      /\b((?:[a-z0-9]+[_-])*(?:api[_-]?key|apikey|access[_-]?token|token|secret|password|authorization))\b\s*["']?\s*[:=]\s*["']?[^\s,"';}]+/gi,
      '$1=[REDACTED]',
    );
}

function redactError(error: string, sensitiveValues: string[] = []): string {
  return redactWideResearchText(error, sensitiveValues)
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, MAX_ERROR_LENGTH);
}

function parseWorkerResults(value: unknown, subtopics: string[]): ResearchWorkerResult[] {
  if (!Array.isArray(value) || value.length > subtopics.length) {
    throw new WideResearchCheckpointError(
      'INVALID_CHECKPOINT',
      'Checkpoint worker results are invalid.',
    );
  }
  const seen = new Set<number>();
  const results: ResearchWorkerResult[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      throw new WideResearchCheckpointError(
        'INVALID_CHECKPOINT',
        'Checkpoint contains a malformed worker result.',
      );
    }
    const workerIndex = item.workerIndex;
    if (
      !isFiniteInteger(workerIndex) ||
      workerIndex >= subtopics.length ||
      seen.has(workerIndex) ||
      typeof item.subtopic !== 'string' ||
      item.subtopic !== subtopics[workerIndex] ||
      typeof item.output !== 'string' ||
      typeof item.success !== 'boolean' ||
      !isFiniteInteger(item.durationMs)
    ) {
      throw new WideResearchCheckpointError(
        'INVALID_CHECKPOINT',
        'Checkpoint contains an incompatible worker result.',
      );
    }
    seen.add(workerIndex);
    const result: ResearchWorkerResult = {
      subtopic: item.subtopic,
      workerIndex,
      output: redactWideResearchText(item.output),
      success: item.success,
      durationMs: item.durationMs,
    };
    if (!item.success && typeof item.error === 'string') {
      result.error = redactError(item.error);
    }
    results.push(result);
  }
  return results.sort((left, right) => left.workerIndex - right.workerIndex);
}

export function parseWideResearchCheckpoint(raw: string): WideResearchCheckpoint {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new WideResearchCheckpointError(
      'INVALID_CHECKPOINT',
      'Checkpoint is not valid JSON; the file was left untouched.',
    );
  }
  if (!isRecord(value) || value.kind !== WIDE_RESEARCH_CHECKPOINT_KIND) {
    throw new WideResearchCheckpointError(
      'INVALID_CHECKPOINT',
      'File is not a Code Buddy Wide Research checkpoint.',
    );
  }
  if (value.version !== WIDE_RESEARCH_CHECKPOINT_VERSION) {
    throw new WideResearchCheckpointError(
      'UNSUPPORTED_VERSION',
      `Unsupported Wide Research checkpoint version: ${String(value.version)}.`,
    );
  }
  const states: WideResearchCheckpointState[] = [
    'decomposed',
    'running',
    'aggregating',
    'completed',
    'failed',
  ];
  if (!states.includes(value.state as WideResearchCheckpointState)) {
    throw new WideResearchCheckpointError(
      'INVALID_CHECKPOINT',
      'Checkpoint state is invalid.',
    );
  }
  if (typeof value.topic !== 'string' || value.topic.trim().length === 0) {
    throw new WideResearchCheckpointError(
      'INVALID_CHECKPOINT',
      'Checkpoint topic is missing.',
    );
  }
  const options = parseOptions(value.options);
  if (
    !Array.isArray(value.subtopics) ||
    value.subtopics.length > MAX_CHECKPOINT_ITEMS ||
    value.subtopics.length > options.items ||
    (value.state === 'completed' && value.subtopics.length === 0) ||
    !value.subtopics.every((subtopic) => typeof subtopic === 'string' && subtopic.length > 0)
  ) {
    throw new WideResearchCheckpointError(
      'INVALID_CHECKPOINT',
      'Checkpoint subtopics are invalid.',
    );
  }
  if (
    typeof value.executionFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.executionFingerprint)
  ) {
    throw new WideResearchCheckpointError(
      'INVALID_CHECKPOINT',
      'Checkpoint execution fingerprint is invalid.',
    );
  }
  if (!isIsoDate(value.createdAt) || !isIsoDate(value.updatedAt)) {
    throw new WideResearchCheckpointError(
      'INVALID_CHECKPOINT',
      'Checkpoint timestamps are invalid.',
    );
  }
  const subtopics = [...value.subtopics];
  return {
    kind: WIDE_RESEARCH_CHECKPOINT_KIND,
    version: WIDE_RESEARCH_CHECKPOINT_VERSION,
    state: value.state as WideResearchCheckpointState,
    topic: value.topic,
    options,
    executionFingerprint: value.executionFingerprint,
    subtopics,
    workerResults: parseWorkerResults(value.workerResults, subtopics),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function resolveWideResearchCheckpointPath(input: string, cwd = process.cwd()): string {
  try {
    return resolveWideResearchFilePath(input, cwd);
  } catch {
    throw new WideResearchCheckpointError('INVALID_PATH', 'Checkpoint path is empty or invalid.');
  }
}

export function createWideResearchExecutionFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function assertWideResearchCheckpointCompatible(
  checkpoint: WideResearchCheckpoint,
  expected: WideResearchCheckpointCompatibility,
): void {
  const mismatches: string[] = [];
  if (checkpoint.topic !== expected.topic) mismatches.push('topic');
  for (const key of Object.keys(expected.options) as Array<keyof WideResearchCheckpointOptions>) {
    if (checkpoint.options[key] !== expected.options[key]) mismatches.push(`options.${key}`);
  }
  const acceptedFingerprints = new Set([
    expected.executionFingerprint,
    ...(expected.acceptedExecutionFingerprints ?? []),
  ]);
  if (!acceptedFingerprints.has(checkpoint.executionFingerprint)) {
    mismatches.push('execution fingerprint');
  }
  if (mismatches.length > 0) {
    throw new WideResearchCheckpointError(
      'INCOMPATIBLE_CHECKPOINT',
      `Checkpoint is incompatible with this run (${mismatches.join(', ')}). ` +
        'Use the original topic/options or start a new --checkpoint file.',
    );
  }
}

export function redactWideResearchCheckpointResults(
  results: ResearchWorkerResult[],
  sensitiveValues: string[] = [],
): ResearchWorkerResult[] {
  return results.map((result) => ({
    subtopic: result.subtopic,
    workerIndex: result.workerIndex,
    output: redactWideResearchText(result.output, sensitiveValues),
    success: result.success,
    ...(result.error ? { error: redactError(result.error, sensitiveValues) } : {}),
    durationMs: result.durationMs,
  }));
}

export function redactWideResearchResult(
  result: WideResearchResult,
  sensitiveValues: string[] = [],
): WideResearchResult {
  return {
    topic: redactWideResearchText(result.topic, sensitiveValues),
    subtopics: result.subtopics.map((subtopic) =>
      redactWideResearchText(subtopic, sensitiveValues),
    ),
    workerResults: redactWideResearchCheckpointResults(result.workerResults, sensitiveValues).map(
      (worker) => ({
        ...worker,
        subtopic: redactWideResearchText(worker.subtopic, sensitiveValues),
      }),
    ),
    report: redactWideResearchText(result.report, sensitiveValues),
    durationMs: result.durationMs,
    successCount: result.successCount,
  };
}

const defaultFileOperations: WideResearchCheckpointFileOperations = {
  lstat,
  mkdir: (path) => mkdir(path, { recursive: true }),
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, payload) =>
    writeFile(path, payload, { encoding: 'utf8', flag: 'wx', mode: 0o600 }),
  rename,
  unlink,
};

async function assertSafeTarget(
  path: string,
  fileOperations: WideResearchCheckpointFileOperations,
): Promise<CheckpointFileInfo | null> {
  try {
    const info = await fileOperations.lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new WideResearchCheckpointError(
        'INVALID_PATH',
        'Checkpoint target must be a regular file, not a directory or symbolic link.',
      );
    }
    return info;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      String(error.code) === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
}

async function assertSafeCheckpointParents(path: string): Promise<void> {
  try {
    await assertNoSymlinkParents(path);
  } catch (error) {
    if (error instanceof WideResearchFileSafetyError) {
      throw new WideResearchCheckpointError('INVALID_PATH', error.message);
    }
    throw error;
  }
}

function assertPrivateCheckpointFile(info: CheckpointFileInfo): void {
  if (process.platform === 'win32') return;
  if (info.mode !== undefined && (info.mode & 0o077) !== 0) {
    throw new WideResearchCheckpointError(
      'INVALID_PATH',
      'Checkpoint permissions are too broad; use chmod 600 before --resume.',
    );
  }
  if (
    typeof process.getuid === 'function' &&
    info.uid !== undefined &&
    info.uid !== process.getuid()
  ) {
    throw new WideResearchCheckpointError(
      'INVALID_PATH',
      'Checkpoint is not owned by the current user.',
    );
  }
}

export class FileWideResearchCheckpointStore implements WideResearchCheckpointStore {
  private readonly fileOperations: WideResearchCheckpointFileOperations;

  constructor(fileOperations: Partial<WideResearchCheckpointFileOperations> = {}) {
    this.fileOperations = { ...defaultFileOperations, ...fileOperations };
  }

  async assertCreatable(path: string): Promise<void> {
    const resolvedPath = resolveWideResearchCheckpointPath(path);
    await assertSafeCheckpointParents(resolvedPath);
    const existing = await assertSafeTarget(resolvedPath, this.fileOperations);
    if (existing) {
      throw new WideResearchCheckpointError(
        'WRITE_FAILED',
        'Checkpoint already exists and was preserved; use --resume or choose a new path.',
      );
    }
  }

  async load(path: string): Promise<WideResearchCheckpoint> {
    const resolvedPath = resolveWideResearchCheckpointPath(path);
    try {
      await assertSafeCheckpointParents(resolvedPath);
      const info = await this.fileOperations.lstat(resolvedPath);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new WideResearchCheckpointError(
          'INVALID_PATH',
          'Checkpoint source must be a regular file, not a directory or symbolic link.',
        );
      }
      if (info.size > MAX_CHECKPOINT_BYTES) {
        throw new WideResearchCheckpointError(
          'INVALID_CHECKPOINT',
          `Checkpoint exceeds the ${MAX_CHECKPOINT_BYTES}-byte safety limit.`,
        );
      }
      assertPrivateCheckpointFile(info);
      return parseWideResearchCheckpoint(await this.fileOperations.readFile(resolvedPath));
    } catch (error) {
      if (error instanceof WideResearchCheckpointError) throw error;
      throw new WideResearchCheckpointError(
        'READ_FAILED',
        `Unable to read checkpoint at ${resolvedPath}; no file was modified.`,
      );
    }
  }

  async save(path: string, checkpoint: WideResearchCheckpoint): Promise<void> {
    const resolvedPath = resolveWideResearchCheckpointPath(path);
    // Parsing our own serialized value closes the schema before it reaches disk:
    // unknown fields such as provider config, headers, or credentials are dropped.
    const normalized = parseWideResearchCheckpoint(JSON.stringify(checkpoint));
    const payload = `${JSON.stringify(normalized, null, 2)}\n`;
    if (Buffer.byteLength(payload, 'utf8') > MAX_CHECKPOINT_BYTES) {
      throw new WideResearchCheckpointError(
        'WRITE_FAILED',
        `Checkpoint exceeds the ${MAX_CHECKPOINT_BYTES}-byte safety limit.`,
      );
    }

    await assertSafeCheckpointParents(resolvedPath);
    await this.fileOperations.mkdir(dirname(resolvedPath));
    await assertSafeCheckpointParents(resolvedPath);
    const existingInfo = await assertSafeTarget(resolvedPath, this.fileOperations);
    if (existingInfo) {
      if (existingInfo.size > MAX_CHECKPOINT_BYTES) {
        throw new WideResearchCheckpointError(
          'WRITE_FAILED',
          'Existing checkpoint exceeds the safety limit and was preserved.',
        );
      }
      let existing: WideResearchCheckpoint;
      try {
        existing = parseWideResearchCheckpoint(
          await this.fileOperations.readFile(resolvedPath),
        );
      } catch {
        throw new WideResearchCheckpointError(
          'WRITE_FAILED',
          'Existing target is not a valid Wide Research checkpoint and was preserved.',
        );
      }
      assertPrivateCheckpointFile(existingInfo);
      assertWideResearchCheckpointCompatible(existing, {
        topic: normalized.topic,
        options: normalized.options,
        executionFingerprint: normalized.executionFingerprint,
      });
      if (normalized.state === 'decomposed') {
        throw new WideResearchCheckpointError(
          'WRITE_FAILED',
          'Checkpoint already exists and was preserved; use --resume or choose a new path.',
        );
      }
    }
    const tempPath = resolve(
      dirname(resolvedPath),
      `.${basename(resolvedPath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await this.fileOperations.writeFile(tempPath, payload);
      await this.fileOperations.rename(tempPath, resolvedPath);
    } catch {
      await this.fileOperations.unlink(tempPath).catch(() => undefined);
      throw new WideResearchCheckpointError(
        'WRITE_FAILED',
        `Unable to atomically write checkpoint at ${resolvedPath}; the previous file was preserved.`,
      );
    }
  }
}
