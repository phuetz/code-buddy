import { randomUUID } from 'node:crypto';
import * as fsSync from 'node:fs';
import {
  lstat,
  mkdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';

export class WideResearchFileSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WideResearchFileSafetyError';
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      String(error.code) === 'ENOENT',
  );
}

export function resolveWideResearchFilePath(input: string, cwd = process.cwd()): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes('\0')) {
    throw new WideResearchFileSafetyError('Research file path is empty or invalid.');
  }
  return resolve(cwd, trimmed);
}

/** Refuse an existing symlink anywhere between filesystem root and parent. */
export async function assertNoSymlinkParents(path: string): Promise<void> {
  const resolvedPath = resolveWideResearchFilePath(path);
  const parent = dirname(resolvedPath);
  const root = parse(parent).root;
  const components = relative(root, parent).split(sep).filter(Boolean);
  let current = root;
  for (const component of components) {
    current = join(current, component);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new WideResearchFileSafetyError(
          `Research file path crosses symbolic-link parent: ${current}`,
        );
      }
      if (!info.isDirectory()) {
        throw new WideResearchFileSafetyError(
          `Research file parent component is not a directory: ${current}`,
        );
      }
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }
}

function assertNoSymlinkParentsSync(path: string): void {
  const resolvedPath = resolveWideResearchFilePath(path);
  const parent = dirname(resolvedPath);
  const root = parse(parent).root;
  const components = relative(root, parent).split(sep).filter(Boolean);
  let current = root;
  for (const component of components) {
    current = join(current, component);
    try {
      const info = fsSync.lstatSync(current);
      if (info.isSymbolicLink()) {
        throw new WideResearchFileSafetyError(
          `Research file path crosses symbolic-link parent: ${current}`,
        );
      }
      if (!info.isDirectory()) {
        throw new WideResearchFileSafetyError(
          `Research file parent component is not a directory: ${current}`,
        );
      }
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }
}

async function canonicalPlannedPath(path: string): Promise<string> {
  const resolvedPath = resolveWideResearchFilePath(path);
  try {
    return await realpath(resolvedPath);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  const suffix = [basename(resolvedPath)];
  let ancestor = dirname(resolvedPath);
  while (true) {
    try {
      return join(await realpath(ancestor), ...suffix);
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) return resolvedPath;
      suffix.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}

/** Detect lexical aliases, parent symlink aliases, target symlinks and hardlinks. */
export async function assertWideResearchFilesDistinct(
  firstPath: string,
  secondPath: string,
): Promise<void> {
  const first = resolveWideResearchFilePath(firstPath);
  const second = resolveWideResearchFilePath(secondPath);
  const [canonicalFirst, canonicalSecond] = await Promise.all([
    canonicalPlannedPath(first),
    canonicalPlannedPath(second),
  ]);
  if (canonicalFirst === canonicalSecond) {
    throw new WideResearchFileSafetyError(
      'Checkpoint and Markdown report resolve to the same file; choose distinct paths.',
    );
  }

  try {
    const [firstInfo, secondInfo] = await Promise.all([stat(first), stat(second)]);
    if (firstInfo.dev === secondInfo.dev && firstInfo.ino === secondInfo.ino) {
      throw new WideResearchFileSafetyError(
        'Checkpoint and Markdown report are hardlinks to the same inode; choose distinct files.',
      );
    }
  } catch (error) {
    if (error instanceof WideResearchFileSafetyError) throw error;
    if (!isMissing(error)) throw error;
  }
}

async function assertSafeAtomicTarget(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new WideResearchFileSafetyError(
        'Research output target must be a regular file, not a directory or symbolic link.',
      );
    }
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
}

function assertSafeAtomicTargetSync(path: string): void {
  try {
    const info = fsSync.lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new WideResearchFileSafetyError(
        'Research output target must be a regular file, not a directory or symbolic link.',
      );
    }
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
}

export async function writeWideResearchTextAtomic(path: string, content: string): Promise<string> {
  const resolvedPath = resolveWideResearchFilePath(path);
  await assertNoSymlinkParents(resolvedPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await assertNoSymlinkParents(resolvedPath);
  await assertSafeAtomicTarget(resolvedPath);
  const tempPath = join(
    dirname(resolvedPath),
    `.${basename(resolvedPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(tempPath, resolvedPath);
    return resolvedPath;
  } catch {
    await unlink(tempPath).catch(() => undefined);
    throw new WideResearchFileSafetyError(
      `Unable to atomically write research output at ${resolvedPath}; previous file preserved.`,
    );
  }
}

/** Synchronous equivalent for the CLI hard-stop callback. */
export function writeWideResearchTextAtomicSync(path: string, content: string): string {
  const resolvedPath = resolveWideResearchFilePath(path);
  assertNoSymlinkParentsSync(resolvedPath);
  fsSync.mkdirSync(dirname(resolvedPath), { recursive: true });
  assertNoSymlinkParentsSync(resolvedPath);
  assertSafeAtomicTargetSync(resolvedPath);
  const tempPath = join(
    dirname(resolvedPath),
    `.${basename(resolvedPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    fsSync.writeFileSync(tempPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fsSync.renameSync(tempPath, resolvedPath);
    return resolvedPath;
  } catch {
    try {
      fsSync.unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup in a process termination path.
    }
    throw new WideResearchFileSafetyError(
      `Unable to atomically write research output at ${resolvedPath}; previous file preserved.`,
    );
  }
}
