import { promises as fsPromises } from 'node:fs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { logger } from './logger.js';

type AtomicData = string | Uint8Array;

export interface AtomicWriteFileHandle {
  writeFile(data: AtomicData, options?: { encoding?: BufferEncoding }): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Small injectable filesystem surface. The seam makes interruption tests
 * deterministic without replacing the process-wide fs implementation.
 */
export interface AtomicWriteFileSystem {
  mkdir(directory: string, options: { recursive?: boolean }): Promise<void>;
  open(filePath: string, flags: string, mode: number): Promise<AtomicWriteFileHandle>;
  rename(from: string, to: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  chmod(filePath: string, mode: number): Promise<void>;
  readdir(directory: string): Promise<string[]>;
  stat(filePath: string): Promise<{ mtimeMs: number }>;
}

export interface AtomicWriteOptions {
  /** State files default to owner-only permissions. */
  mode?: number;
  fileSystem?: AtomicWriteFileSystem;
}

export interface AtomicReadOptions<T> extends AtomicWriteOptions {
  isValid?: (value: unknown) => value is T;
}

const DEFAULT_MODE = 0o600;
const warnedReadPaths = new Set<string>();

const defaultFileSystem: AtomicWriteFileSystem = {
  mkdir: async (directory, options) => {
    await fsPromises.mkdir(directory, options);
  },
  open: async (filePath, flags, mode): Promise<AtomicWriteFileHandle> => {
    const handle = await fsPromises.open(filePath, flags, mode);
    return handle;
  },
  rename: (from, to) => fsPromises.rename(from, to),
  unlink: filePath => fsPromises.unlink(filePath),
  chmod: (filePath, mode) => fsPromises.chmod(filePath, mode),
  readdir: directory => fsPromises.readdir(directory, { encoding: 'utf8' }),
  stat: async filePath => {
    const fileStat = await fsPromises.stat(filePath);
    return { mtimeMs: fileStat.mtimeMs };
  },
};

function createTemporaryPath(filePath: string): string {
  return `${filePath}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}

function isIgnorableDirectorySyncError(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'EBADF' || code === 'EISDIR' || code === 'ENOTSUP' || code === 'EPERM';
}

async function syncDirectory(filePath: string, fileSystem: AtomicWriteFileSystem): Promise<void> {
  let directoryHandle: AtomicWriteFileHandle | undefined;
  try {
    directoryHandle = await fileSystem.open(path.dirname(filePath), 'r', DEFAULT_MODE);
    await directoryHandle.sync();
  } catch (error) {
    if (!isIgnorableDirectorySyncError(error)) {
      throw error;
    }
  } finally {
    await directoryHandle?.close().catch(() => undefined);
  }
}

/** Write a file through a same-directory temporary file and durable rename. */
export async function writeFileAtomic(
  filePath: string,
  data: AtomicData,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const mode = options.mode ?? DEFAULT_MODE;
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const directory = path.dirname(filePath);
  const temporaryPath = createTemporaryPath(filePath);
  let fileHandle: AtomicWriteFileHandle | undefined;
  let closed = false;

  await fileSystem.mkdir(directory, { recursive: true });
  try {
    fileHandle = await fileSystem.open(temporaryPath, 'w', mode);
    await fileHandle.writeFile(data, typeof data === 'string' ? { encoding: 'utf8' } : undefined);
    await fileHandle.sync();
    await fileHandle.close();
    closed = true;
    await fileSystem.rename(temporaryPath, filePath);
    await syncDirectory(filePath, fileSystem);
    await fileSystem.chmod(filePath, mode);
  } catch (error) {
    if (fileHandle && !closed) {
      await fileHandle.close().catch(() => undefined);
    }
    await fileSystem.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function writeJsonAtomic<T>(
  filePath: string,
  value: T,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

function writeFileAtomicSyncImpl(filePath: string, data: AtomicData, mode: number): void {
  const directory = path.dirname(filePath);
  const temporaryPath = createTemporaryPath(filePath);
  let descriptor: number | undefined;
  let closed = false;

  fs.mkdirSync(directory, { recursive: true });
  try {
    descriptor = fs.openSync(temporaryPath, 'w', mode);
    fs.writeFileSync(descriptor, data);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    closed = true;
    fs.renameSync(temporaryPath, filePath);
    try {
      const directoryDescriptor = fs.openSync(directory, 'r');
      try {
        fs.fsyncSync(directoryDescriptor);
      } finally {
        fs.closeSync(directoryDescriptor);
      }
    } catch (error) {
      if (!isIgnorableDirectorySyncError(error)) {
        throw error;
      }
    }
    fs.chmodSync(filePath, mode);
  } catch (error) {
    if (descriptor !== undefined && !closed) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the original write error.
      }
    }
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // The rename may already have consumed the temporary file.
    }
    throw error;
  }
}

/** Synchronous counterpart for legacy companion/configuration code paths. */
export function writeFileAtomicSync(
  filePath: string,
  data: AtomicData,
  options: Pick<AtomicWriteOptions, 'mode'> = {},
): void {
  writeFileAtomicSyncImpl(filePath, data, options.mode ?? DEFAULT_MODE);
}

export function writeJsonAtomicSync<T>(
  filePath: string,
  value: T,
  options: Pick<AtomicWriteOptions, 'mode'> = {},
): void {
  writeFileAtomicSyncImpl(filePath, `${JSON.stringify(value, null, 2)}\n`, options.mode ?? DEFAULT_MODE);
}

function warnUnreadable(filePath: string, reason: string): void {
  if (warnedReadPaths.has(filePath)) {
    return;
  }
  warnedReadPaths.add(filePath);
  logger.warn(`State file ${filePath} is empty or unreadable; using fallback`, { path: filePath, reason });
}

function isValidValue<T>(value: unknown, options: AtomicReadOptions<T>): value is T {
  return options.isValid ? options.isValid(value) : true;
}

async function recoveryCandidates(filePath: string, fileSystem: AtomicWriteFileSystem): Promise<string[]> {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  let entries: string[];
  try {
    entries = await fileSystem.readdir(directory);
  } catch {
    return [];
  }

  const temporaryPaths = await Promise.all(
    entries
      .filter(entry => entry === `${basename}.tmp` || entry.startsWith(`${basename}.tmp.`))
      .map(async entry => {
        const candidate = path.join(directory, entry);
        try {
          const fileStat = await fileSystem.stat(candidate);
          return { candidate, mtimeMs: fileStat.mtimeMs };
        } catch {
          return undefined;
        }
      }),
  );
  temporaryPaths.sort((left, right) => (right?.mtimeMs ?? 0) - (left?.mtimeMs ?? 0));
  return [
    `${filePath}.bak`,
    ...temporaryPaths.flatMap(item => item ? [item.candidate] : []),
  ];
}

async function readTextCandidate(filePath: string): Promise<string | undefined> {
  try {
    const contents = await fsPromises.readFile(filePath, 'utf8');
    return contents.trim() ? contents : undefined;
  } catch {
    return undefined;
  }
}

/** Read JSON state defensively, recovering a valid .bak or temporary file. */
export async function readJsonAtomic<T>(
  filePath: string,
  fallback: T,
  options: AtomicReadOptions<T> = {},
): Promise<T> {
  let contents: string;
  let mainFileMissing = false;
  try {
    contents = await fsPromises.readFile(filePath, 'utf8');
  } catch (error) {
    if (!isMissing(error)) {
      warnUnreadable(filePath, String(error));
    } else {
      mainFileMissing = true;
    }
    contents = '';
  }

  if (contents.trim()) {
    try {
      const value: unknown = JSON.parse(contents);
      if (isValidValue(value, options)) {
        return value as T;
      }
    } catch {
      // Fall through to one warning, recovery, and the caller's fallback.
    }
  }

  if (!mainFileMissing) {
    warnUnreadable(filePath, 'empty or invalid JSON');
  }
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  for (const candidate of await recoveryCandidates(filePath, fileSystem)) {
    const candidateContents = await readTextCandidate(candidate);
    if (!candidateContents) {
      continue;
    }
    try {
      const value: unknown = JSON.parse(candidateContents);
      if (!isValidValue(value, options)) {
        continue;
      }
      await writeJsonAtomic(filePath, value, options);
      return value as T;
    } catch {
      // Try the next recovery candidate.
    }
  }
  return fallback;
}

function recoveryCandidatesSync(filePath: string): string[] {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  let entries: string[];
  try {
    entries = fs.readdirSync(directory, { encoding: 'utf8' });
  } catch {
    return [];
  }
  const temporaryPaths = entries
    .filter(entry => entry === `${basename}.tmp` || entry.startsWith(`${basename}.tmp.`))
    .map(candidate => {
      const candidatePath = path.join(directory, candidate);
      try {
        return { candidatePath, mtimeMs: fs.statSync(candidatePath).mtimeMs };
      } catch {
        return undefined;
      }
    })
    .filter((item): item is { candidatePath: string; mtimeMs: number } => Boolean(item))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .map(item => item.candidatePath);
  return [`${filePath}.bak`, ...temporaryPaths];
}

function readTextCandidateSync(filePath: string): string | undefined {
  try {
    const contents = fs.readFileSync(filePath, 'utf8');
    return contents.trim() ? contents : undefined;
  } catch {
    return undefined;
  }
}

/** Synchronous JSON reader with the same empty/corrupt recovery policy. */
export function readJsonAtomicSync<T>(
  filePath: string,
  fallback: T,
  options: Pick<AtomicReadOptions<T>, 'mode' | 'isValid'> = {},
): T {
  const contents = readTextCandidateSync(filePath);
  if (contents) {
    try {
      const value: unknown = JSON.parse(contents);
      if (!options.isValid || options.isValid(value)) {
        return value as T;
      }
    } catch {
      // Fall through to one warning, recovery, and the caller's fallback.
    }
  } else if (!fs.existsSync(filePath)) {
    return fallback;
  }

  warnUnreadable(filePath, 'empty or invalid JSON');
  for (const candidate of recoveryCandidatesSync(filePath)) {
    const candidateContents = readTextCandidateSync(candidate);
    if (!candidateContents) {
      continue;
    }
    try {
      const value: unknown = JSON.parse(candidateContents);
      if (options.isValid && !options.isValid(value)) {
        continue;
      }
      writeJsonAtomicSync(filePath, value, { mode: options.mode });
      return value as T;
    } catch {
      // Try the next recovery candidate.
    }
  }
  return fallback;
}

/** Synchronous text reader with the same empty/corrupt recovery policy. */
export function readTextAtomicSync(
  filePath: string,
  fallback: string,
  options: Pick<AtomicWriteOptions, 'mode'> = {},
): string {
  const contents = readTextCandidateSync(filePath);
  if (contents) {
    return contents;
  }
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  warnUnreadable(filePath, 'empty or invalid text');
  for (const candidate of recoveryCandidatesSync(filePath)) {
    const candidateContents = readTextCandidateSync(candidate);
    if (candidateContents) {
      writeFileAtomicSync(filePath, candidateContents, options);
      return candidateContents;
    }
  }
  return fallback;
}

/** Synchronous counterpart for append-only JSONL state files. */
export function readJsonLinesAtomicSync<T>(
  filePath: string,
  fallback: T[],
  isValid: (value: unknown) => value is T,
): T[] {
  const contents = readTextAtomicSync(filePath, '');
  if (!contents) return fallback;
  const values: T[] = [];
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isValid(value)) values.push(value);
      else warnUnreadable(filePath, 'invalid JSONL entry');
    } catch {
      warnUnreadable(filePath, 'truncated or invalid JSONL entry');
    }
  }
  return values;
}

/** Read text state defensively, recovering a valid .bak or temporary file. */
export async function readTextAtomic(
  filePath: string,
  fallback: string,
  options: AtomicWriteOptions = {},
): Promise<string> {
  let contents: string | undefined;
  let mainFileMissing = false;
  try {
    contents = await fsPromises.readFile(filePath, 'utf8');
  } catch (error) {
    if (!isMissing(error)) {
      warnUnreadable(filePath, String(error));
    } else {
      mainFileMissing = true;
    }
  }
  if (contents?.trim()) {
    return contents;
  }

  if (!mainFileMissing) {
    warnUnreadable(filePath, 'empty or invalid text');
  }
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  for (const candidate of await recoveryCandidates(filePath, fileSystem)) {
    const candidateContents = await readTextCandidate(candidate);
    if (candidateContents) {
      await writeFileAtomic(filePath, candidateContents, options);
      return candidateContents;
    }
  }
  return fallback;
}

/** Read an append-only JSONL state file, skipping a torn/invalid line once. */
export async function readJsonLinesAtomic<T>(
  filePath: string,
  fallback: T[],
  isValid: (value: unknown) => value is T,
): Promise<T[]> {
  let contents: string;
  try {
    contents = await fsPromises.readFile(filePath, 'utf8');
  } catch (error) {
    if (isMissing(error)) return fallback;
    warnUnreadable(filePath, String(error));
    return fallback;
  }
  if (!contents.trim()) {
    warnUnreadable(filePath, 'empty JSONL');
    return fallback;
  }

  const values: T[] = [];
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isValid(value)) values.push(value);
      else warnUnreadable(filePath, 'invalid JSONL entry');
    } catch {
      warnUnreadable(filePath, 'truncated or invalid JSONL entry');
    }
  }
  return values;
}

/** Reset the process-local warning guard; intended for isolated tests. */
export function resetAtomicReadWarningsForTests(): void {
  warnedReadPaths.clear();
}
