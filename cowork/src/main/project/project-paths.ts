import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { basename, extname, isAbsolute, join, relative } from 'path';
import { createHash, randomUUID } from 'crypto';

const MAX_PROJECT_KNOWLEDGE_BYTES = 2 * 1024 * 1024;
const PROJECT_KNOWLEDGE_EXTENSIONS = new Set([
  '.css', '.csv', '.html', '.js', '.json', '.jsx', '.md', '.py', '.rs',
  '.toml', '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);
const SENSITIVE_PROJECT_FILE_NAMES = new Set([
  '.env', 'credentials', 'credentials.json', 'id_ed25519', 'id_rsa',
  'secrets', 'secrets.json',
]);

function isContained(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== '' && !child.startsWith('..') && !isAbsolute(child);
}

function existingDirectory(path: string): boolean {
  return !lstatSync(path).isSymbolicLink() && statSync(path).isDirectory();
}

function normalizeKnowledgeRelativePath(requestedPath: string): string | null {
  if (
    typeof requestedPath !== 'string'
    || !requestedPath.trim()
    || requestedPath.includes('\0')
    || isAbsolute(requestedPath)
    || /^[a-z]:[\\/]/i.test(requestedPath)
    || requestedPath.startsWith('\\\\')
  ) {
    return null;
  }
  const segments = requestedPath.trim().split(/[\\/]+/);
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  const fileName = segments[segments.length - 1]?.toLowerCase() ?? '';
  if (
    SENSITIVE_PROJECT_FILE_NAMES.has(fileName)
    || fileName.startsWith('.env.')
    || ['.key', '.p12', '.pem', '.pfx'].includes(extname(fileName))
    || segments.some((segment) => ['.git', '.codebuddy', 'node_modules'].includes(segment.toLowerCase()))
    || !PROJECT_KNOWLEDGE_EXTENSIONS.has(extname(fileName))
  ) {
    return null;
  }
  return segments.join('/');
}

interface ProjectKnowledgeTarget {
  root: string;
  workspaceFingerprint: string;
  parent: string;
  absolutePath: string;
  relativePath: string;
  exists: boolean;
}

function fingerprintWorkspaceRoot(root: string): string {
  return createHash('sha256').update(root, 'utf-8').digest('hex');
}

function resolveProjectKnowledgeTarget(
  workspacePath: string,
  requestedPath: string
): ProjectKnowledgeTarget | null {
  const relativePath = normalizeKnowledgeRelativePath(requestedPath);
  if (!relativePath) return null;
  try {
    const root = realpathSync(workspacePath);
    if (!statSync(root).isDirectory()) return null;
    const segments = relativePath.split('/');
    const fileName = segments.pop();
    if (!fileName) return null;

    let parent = root;
    for (const segment of segments) {
      const candidate = join(parent, segment);
      if (!existsSync(candidate) || !existingDirectory(candidate)) return null;
      parent = realpathSync(candidate);
      if (!isContained(root, parent)) return null;
    }

    const absolutePath = join(parent, fileName);
    if (!existsSync(absolutePath)) {
      return {
        root,
        workspaceFingerprint: fingerprintWorkspaceRoot(root),
        parent,
        absolutePath,
        relativePath,
        exists: false,
      };
    }
    const metadata = lstatSync(absolutePath);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_PROJECT_KNOWLEDGE_BYTES) {
      return null;
    }
    const resolved = realpathSync(absolutePath);
    if (!isContained(root, resolved)) return null;
    return {
      root,
      workspaceFingerprint: fingerprintWorkspaceRoot(root),
      parent,
      absolutePath: resolved,
      relativePath,
      exists: true,
    };
  } catch {
    return null;
  }
}

export interface ProjectKnowledgeFileSnapshot {
  relativePath: string;
  workspaceFingerprint: string;
  exists: boolean;
  content: string;
}

/** Inspect a bounded text knowledge file without following symlinks. */
export function inspectProjectKnowledgeFile(
  workspacePath: string,
  requestedPath: string
): ProjectKnowledgeFileSnapshot {
  const target = resolveProjectKnowledgeTarget(workspacePath, requestedPath);
  if (!target) throw new Error('Unsafe or unsupported Project knowledge path');
  if (!target.exists) {
    return {
      relativePath: target.relativePath,
      workspaceFingerprint: target.workspaceFingerprint,
      exists: false,
      content: '',
    };
  }

  let fd: number | undefined;
  try {
    fd = openSync(target.absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = fstatSync(fd);
    if (!metadata.isFile() || metadata.size > MAX_PROJECT_KNOWLEDGE_BYTES) {
      throw new Error('Project knowledge file is too large or not a regular file');
    }
    const content = readFileSync(fd, 'utf-8');
    if (content.includes('\0')) throw new Error('Binary Project knowledge files are not supported');
    return {
      relativePath: target.relativePath,
      workspaceFingerprint: target.workspaceFingerprint,
      exists: true,
      content,
    };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Atomically write an approved knowledge-file revision.
 *
 * `expectedBefore` closes ordinary stale-write races: `null` means the file
 * must still be absent, while a string must exactly match the current text.
 */
export function writeProjectKnowledgeFile(
  workspacePath: string,
  requestedPath: string,
  content: string,
  expectedBefore: string | null,
  expectedWorkspaceFingerprint?: string,
): string {
  if (Buffer.byteLength(content, 'utf-8') > MAX_PROJECT_KNOWLEDGE_BYTES || content.includes('\0')) {
    throw new Error('Project knowledge content is too large or binary');
  }
  const target = resolveProjectKnowledgeTarget(workspacePath, requestedPath);
  if (!target) throw new Error('Unsafe or unsupported Project knowledge path');
  if (
    expectedWorkspaceFingerprint
    && target.workspaceFingerprint !== expectedWorkspaceFingerprint
  ) {
    throw new Error('Project workspace changed since the proposal was reviewed');
  }
  const current = inspectProjectKnowledgeFile(workspacePath, target.relativePath);
  if (
    (expectedBefore === null && current.exists)
    || (expectedBefore !== null && (!current.exists || current.content !== expectedBefore))
  ) {
    throw new Error('Project knowledge file changed since the proposal was created');
  }

  const temporary = join(
    target.parent,
    `.${basename(target.absolutePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  let fd: number | undefined;
  let temporaryExists = false;
  try {
    fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600
    );
    temporaryExists = true;
    writeFileSync(fd, content, { encoding: 'utf-8' });
    fchmodSync(fd, 0o600);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;

    const revalidated = resolveProjectKnowledgeTarget(workspacePath, target.relativePath);
    if (
      !revalidated
      || revalidated.parent !== target.parent
      || (
        expectedWorkspaceFingerprint
        && revalidated.workspaceFingerprint !== expectedWorkspaceFingerprint
      )
    ) {
      throw new Error('Project knowledge path changed during write');
    }
    const latest = inspectProjectKnowledgeFile(workspacePath, target.relativePath);
    if (
      (expectedBefore === null && latest.exists)
      || (expectedBefore !== null && (!latest.exists || latest.content !== expectedBefore))
    ) {
      throw new Error('Project knowledge file changed during write');
    }
    renameSync(temporary, revalidated.absolutePath);
    temporaryExists = false;
    return revalidated.absolutePath;
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (temporaryExists) {
      try {
        unlinkSync(temporary);
      } catch {
        // Best-effort cleanup after a refused or failed atomic write.
      }
    }
  }
}

/** Remove a just-created knowledge file during an explicit rollback. */
export function removeProjectKnowledgeFile(
  workspacePath: string,
  requestedPath: string,
  expectedContent: string,
  expectedWorkspaceFingerprint?: string,
): void {
  const target = resolveProjectKnowledgeTarget(workspacePath, requestedPath);
  if (!target?.exists) throw new Error('Project knowledge file is missing or unsafe');
  if (
    expectedWorkspaceFingerprint
    && target.workspaceFingerprint !== expectedWorkspaceFingerprint
  ) {
    throw new Error('Project workspace changed since the proposal was reviewed');
  }
  const current = inspectProjectKnowledgeFile(workspacePath, target.relativePath);
  if (!current.exists || current.content !== expectedContent) {
    throw new Error('Project knowledge file changed after the proposal was applied');
  }
  unlinkSync(target.absolutePath);
}

/** Resolve an existing project memory directory without following an escape symlink. */
export function resolveProjectMemoryDirectory(workspacePath: string): string | null {
  try {
    const root = realpathSync(workspacePath);
    if (!statSync(root).isDirectory()) return null;
    const requested = join(root, '.codebuddy', 'memory');
    if (!existsSync(requested) || lstatSync(requested).isSymbolicLink()) return null;
    const resolved = realpathSync(requested);
    if (!isContained(root, resolved) || !statSync(resolved).isDirectory()) return null;
    return resolved;
  } catch {
    return null;
  }
}

/** Create the managed directory while refusing symlinked intermediate components. */
export function ensureProjectMemoryDirectory(workspacePath: string): string | null {
  try {
    const root = realpathSync(workspacePath);
    if (!statSync(root).isDirectory()) return null;

    const metadataDir = join(root, '.codebuddy');
    if (existsSync(metadataDir)) {
      if (!existingDirectory(metadataDir)) return null;
    } else {
      mkdirSync(metadataDir, { mode: 0o700 });
    }

    const memoryDir = join(metadataDir, 'memory');
    if (existsSync(memoryDir)) {
      if (!existingDirectory(memoryDir)) return null;
    } else {
      mkdirSync(memoryDir, { mode: 0o700 });
    }

    const resolved = realpathSync(memoryDir);
    return isContained(root, resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/** Resolve a managed regular file; existing symlinks are always rejected. */
export function resolveProjectMemoryFile(
  workspacePath: string,
  fileName: string,
  options: { createDirectory?: boolean; mustExist?: boolean } = {}
): string | null {
  if (!fileName || basename(fileName) !== fileName || fileName.includes('\0')) return null;
  const memoryDir = options.createDirectory
    ? ensureProjectMemoryDirectory(workspacePath)
    : resolveProjectMemoryDirectory(workspacePath);
  if (!memoryDir) return null;

  const requested = join(memoryDir, fileName);
  if (!existsSync(requested)) return options.mustExist ? null : requested;
  try {
    if (lstatSync(requested).isSymbolicLink()) return null;
    const resolved = realpathSync(requested);
    if (!isContained(memoryDir, resolved) || !statSync(resolved).isFile()) return null;
    return resolved;
  } catch {
    return null;
  }
}

/**
 * Read a managed file through a descriptor opened with O_NOFOLLOW where the
 * platform supports it. This closes the final-component symlink race between
 * path validation and readFileSync(path).
 */
export function readProjectMemoryFile(
  workspacePath: string,
  fileName: string
): string | null {
  const filePath = resolveProjectMemoryFile(workspacePath, fileName, { mustExist: true });
  if (!filePath) return null;

  let fd: number | undefined;
  try {
    fd = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    if (!fstatSync(fd).isFile()) return null;
    return readFileSync(fd, 'utf-8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Atomically replace a managed file with private permissions.
 *
 * A fresh 0600 temporary file is renamed over the destination, so a final
 * symlink installed after validation is replaced rather than followed. Node
 * does not expose openat(2), therefore callers should still treat workspace
 * directory replacement by another local process as a residual TOCTOU risk.
 */
export function writeProjectMemoryFile(
  workspacePath: string,
  fileName: string,
  content: string
): string {
  if (!fileName || basename(fileName) !== fileName || fileName.includes('\0')) {
    throw new Error('Invalid project memory file name');
  }

  const memoryDir = ensureProjectMemoryDirectory(workspacePath);
  if (!memoryDir) throw new Error('Unsafe project memory path');

  const destination = join(memoryDir, fileName);
  if (existsSync(destination)) {
    const stat = lstatSync(destination);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('Unsafe project memory file');
    }
  }

  const temporary = join(memoryDir, `.${fileName}.${process.pid}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  let temporaryExists = false;
  try {
    fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600
    );
    temporaryExists = true;
    writeFileSync(fd, content, { encoding: 'utf-8' });
    fchmodSync(fd, 0o600);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;

    // Refuse to publish if an intermediate directory changed after creation.
    const revalidatedDir = resolveProjectMemoryDirectory(workspacePath);
    if (revalidatedDir !== memoryDir || realpathSync(temporary) !== temporary) {
      throw new Error('Project memory path changed during write');
    }

    if (existsSync(destination) && lstatSync(destination).isDirectory()) {
      throw new Error('Unsafe project memory destination');
    }

    // rename replaces a final symlink itself; it never writes through its target.
    renameSync(temporary, destination);
    temporaryExists = false;
    return destination;
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (temporaryExists) {
      try {
        unlinkSync(temporary);
      } catch {
        // Best-effort cleanup after a refused or failed atomic write.
      }
    }
  }
}
