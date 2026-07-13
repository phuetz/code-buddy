import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export interface ImageEditVersion {
  id: string;
  parentId: string | null;
  path: string;
  createdAt: number;
}

export interface ImageEditHistory {
  chainId: string;
  headVersionId: string;
  versions: ImageEditVersion[];
}

interface HistoryIndex {
  schemaVersion: 1;
  chains: ImageEditHistory[];
}

const MAX_CHAINS = 64;
export const MAX_IMAGE_EDIT_VERSIONS = 12;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const PRIVATE_DIR = '.design-view-history';
const INDEX_FILE = 'index.json';
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Private, bounded metadata store for Design View version chains. All paths
 * passed here must already be canonical and approved by MediaGenService. The
 * store never accepts a location from IPC and never persists prompts/masks.
 */
export class ImageEditHistoryStore {
  private readonly directory: string;
  private readonly indexPath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(mediaGenerationRoot: string) {
    this.directory = join(mediaGenerationRoot, PRIVATE_DIR);
    this.indexPath = join(this.directory, INDEX_FILE);
  }

  async findByPath(canonicalPath: string): Promise<ImageEditHistory | null> {
    await this.queue;
    const index = await this.readIndex();
    const chain = index.chains.find((candidate) => candidate.versions.some((version) => samePath(version.path, canonicalPath)));
    return chain ? cloneHistory(chain) : null;
  }

  record(sourcePath: string, outputPath: string, now = Date.now()): Promise<ImageEditHistory> {
    return this.serialize(async () => {
      const index = await this.readIndex();
      let chain = index.chains.find((candidate) => candidate.versions.some((version) => samePath(version.path, sourcePath)));
      if (!chain) {
        const source: ImageEditVersion = {
          id: randomUUID(),
          parentId: null,
          path: sourcePath,
          createdAt: now,
        };
        chain = { chainId: randomUUID(), headVersionId: source.id, versions: [source] };
        index.chains.push(chain);
      }

      const sourceVersion = chain.versions.find((version) => samePath(version.path, sourcePath));
      if (!sourceVersion) throw new Error('Design View source is not part of its version chain');
      const existingOutput = chain.versions.find((version) => samePath(version.path, outputPath));
      if (existingOutput) {
        chain.headVersionId = existingOutput.id;
      } else {
        const output: ImageEditVersion = {
          id: randomUUID(),
          parentId: sourceVersion.id,
          path: outputPath,
          createdAt: now,
        };
        chain.versions.push(output);
        chain.headVersionId = output.id;
      }
      chain.versions = boundVersions(chain.versions);

      // Most recently edited chains are retained. Image files remain in the
      // media library even after their metadata reference is pruned.
      index.chains = [
        ...index.chains.filter((candidate) => candidate.chainId !== chain!.chainId),
        chain,
      ].slice(-MAX_CHAINS);
      await this.writeIndex(index);
      return cloneHistory(chain);
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async ensurePrivateDirectory(): Promise<void> {
    try {
      await mkdir(this.directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const metadata = await lstat(this.directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('Design View history directory is not a private directory');
    }
    await chmod(this.directory, 0o700);
  }

  private async readIndex(): Promise<HistoryIndex> {
    await this.ensurePrivateDirectory();
    let metadata;
    try {
      metadata = await lstat(this.indexPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyIndex();
      throw error;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_INDEX_BYTES) {
      throw new Error('Design View history index is unsafe or too large');
    }

    const handle = await open(this.indexPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    try {
      const raw = await handle.readFile({ encoding: 'utf8' });
      const parsed: unknown = JSON.parse(raw);
      if (!isHistoryIndex(parsed)) throw new Error('Design View history index is invalid');
      await chmod(this.indexPath, 0o600);
      return parsed;
    } finally {
      await handle.close();
    }
  }

  private async writeIndex(index: HistoryIndex): Promise<void> {
    await this.ensurePrivateDirectory();
    const serialized = `${JSON.stringify(index)}\n`;
    if (Buffer.byteLength(serialized) > MAX_INDEX_BYTES) {
      throw new Error('Design View history index exceeds its private storage limit');
    }
    const temporaryPath = join(this.directory, `.${INDEX_FILE}.${process.pid}.${randomUUID()}.tmp`);
    const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0);
    const handle = await open(temporaryPath, flags, 0o600);
    try {
      await handle.writeFile(serialized, { encoding: 'utf8' });
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    await handle.close();
    try {
      await rename(temporaryPath, this.indexPath);
      await chmod(this.indexPath, 0o600);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}

function emptyIndex(): HistoryIndex {
  return { schemaVersion: 1, chains: [] };
}

function boundVersions(versions: ImageEditVersion[]): ImageEditVersion[] {
  if (versions.length <= MAX_IMAGE_EDIT_VERSIONS) return versions;
  const root = versions[0]!;
  const tail = versions.slice(-(MAX_IMAGE_EDIT_VERSIONS - 1)).map((version) => ({ ...version }));
  const retainedIds = new Set([root.id, ...tail.map((version) => version.id)]);
  for (const version of tail) {
    if (version.parentId && !retainedIds.has(version.parentId)) version.parentId = root.id;
  }
  return [root, ...tail];
}

function cloneHistory(history: ImageEditHistory): ImageEditHistory {
  return {
    chainId: history.chainId,
    headVersionId: history.headVersionId,
    versions: history.versions.map((version) => ({ ...version })),
  };
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isHistoryIndex(value: unknown): value is HistoryIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const index = value as Record<string, unknown>;
  if (index.schemaVersion !== 1 || !Array.isArray(index.chains) || index.chains.length > MAX_CHAINS) return false;
  return index.chains.every((rawChain) => {
    if (!rawChain || typeof rawChain !== 'object' || Array.isArray(rawChain)) return false;
    const chain = rawChain as Record<string, unknown>;
    if (typeof chain.chainId !== 'string' || !ID_PATTERN.test(chain.chainId)
      || typeof chain.headVersionId !== 'string' || !ID_PATTERN.test(chain.headVersionId)
      || !Array.isArray(chain.versions) || chain.versions.length === 0 || chain.versions.length > MAX_IMAGE_EDIT_VERSIONS) {
      return false;
    }
    const ids = new Set<string>();
    const validVersions = chain.versions.every((rawVersion, index) => {
      if (!rawVersion || typeof rawVersion !== 'object' || Array.isArray(rawVersion)) return false;
      const version = rawVersion as Record<string, unknown>;
      if (typeof version.id !== 'string' || !ID_PATTERN.test(version.id) || ids.has(version.id)
        || (version.parentId !== null && (typeof version.parentId !== 'string' || !ID_PATTERN.test(version.parentId)))
        || typeof version.path !== 'string' || version.path.length === 0 || version.path.length > 4_096
        || typeof version.createdAt !== 'number' || !Number.isFinite(version.createdAt) || version.createdAt < 0) {
        return false;
      }
      if ((index === 0 && version.parentId !== null)
        || (index > 0 && (typeof version.parentId !== 'string' || !ids.has(version.parentId)))) {
        return false;
      }
      ids.add(version.id);
      return true;
    });
    return validVersions && ids.has(chain.headVersionId as string);
  });
}
