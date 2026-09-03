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

async function readTextCandidate(
  filePath: string,
  fileSystem: AtomicWriteFileSystem,
): Promise<string | undefined> {
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
  try {
    contents = await fsPromises.readFile(filePath, 'utf8');
  } catch (error) {
    if (!isMissing(error)) {
      warnUnreadable(filePath, String(error));
    }
    contents = '';
  }

  if (contents.trim()) {
    try {
      const value: unknown = JSON.parse(contents);
      if (isValidValue(value, options)) {
        return value;
      }
    } catch {
      // Fall through to one warning, recovery, and the caller's fallback.
    }
  }

  warnUnreadable(filePath, 'empty or invalid JSON');
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  for (const candidate of await recoveryCandidates(filePath, fileSystem)) {
    const candidateContents = await readTextCandidate(candidate, fileSystem);
    if (!candidateContents) {
      continue;
    }
    try {
      const value: unknown = JSON.parse(candidateContents);
      if (!isValidValue(value, options)) {
        continue;
      }
      await writeJsonAtomic(filePath, value, options);
      return value;
    } catch {
      // Try the next recovery candidate.
    }
  }
  return fallback;
}

/** Read text state defensively, recovering a valid .bak or temporary file. */
export async function readTextAtomic(
  filePath: string,
  fallback: string,
  options: AtomicWriteOptions = {},
): Promise<string> {
  let contents: string | undefined;
  try {
    contents = await fsPromises.readFile(filePath, 'utf8');
  } catch (error) {
    if (!isMissing(error)) {
      warnUnreadable(filePath, String(error));
    }
  }
  if (contents?.trim()) {
    return contents;
  }

  warnUnreadable(filePath, 'empty or invalid text');
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  for (const candidate of await recoveryCandidates(filePath, fileSystem)) {
    const candidateContents = await readTextCandidate(candidate, fileSystem);
    if (candidateContents) {
      await writeFileAtomic(filePath, candidateContents, options);
      return candidateContents;
    }
  }
  return fallback;
}

/** Reset the process-local warning guard; intended for isolated tests. */
export function resetAtomicReadWarningsForTests(): void {
  warnedReadPaths.clear();
}
