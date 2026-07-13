import { constants as fsConstants, type Stats } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  ComfyUIRecipeValidationError,
  MAX_COMFYUI_RECIPE_BYTES,
  isSafeComfyUIRelativePath,
  type ComfyUIRecipe,
  type ComfyUIRecipeSelector,
  validateComfyUIRecipe,
} from './comfyui-recipe-contract.js';

const MAX_RECIPE_FILES = 128;
const MAX_DIRECTORY_ENTRIES = 2048;
const MAX_DIRECTORY_DEPTH = 4;
const SAFE_RECIPE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SAFE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface ComfyUIRecipeLoaderLimits {
  maxBytes?: number;
  maxFiles?: number;
  maxEntries?: number;
  maxDepth?: number;
}

export interface LoadedComfyUIRecipe {
  recipe: ComfyUIRecipe;
  sourcePath: string;
}

interface DirectorySnapshot {
  path: string;
  stats: Stats;
}

/**
 * Read one recipe without following links. The root and every descendant are
 * checked before and after the descriptor-backed read to narrow rename races.
 */
export async function loadComfyUIRecipeFile(
  rootDirectory: string,
  relativeFile: string,
  limits: Pick<ComfyUIRecipeLoaderLimits, 'maxBytes'> = {},
): Promise<LoadedComfyUIRecipe> {
  const maxBytes = boundedInteger(limits.maxBytes, 1024, MAX_COMFYUI_RECIPE_BYTES, MAX_COMFYUI_RECIPE_BYTES);
  const root = await inspectRecipeRoot(rootDirectory);
  assertSafeRecipeFilePath(relativeFile);
  const absoluteFile = path.resolve(root.realPath, ...relativeFile.split('/'));
  assertContained(root.realPath, absoluteFile, 'Recipe path');

  const snapshots = await snapshotDescendants(root.realPath, relativeFile);
  const fileSnapshot = snapshots[snapshots.length - 1];
  if (!fileSnapshot?.stats.isFile()) {
    throw new ComfyUIRecipeValidationError('Recipe path is not a regular file');
  }
  if (fileSnapshot.stats.size > maxBytes) {
    throw new ComfyUIRecipeValidationError(`Recipe file exceeds ${maxBytes} bytes`);
  }

  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(absoluteFile, flags);
  let contents: Buffer;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(opened, fileSnapshot.stats)) {
      throw new ComfyUIRecipeValidationError('Recipe changed while it was being opened');
    }
    contents = await readFileHandleBounded(handle, maxBytes);
    const afterRead = await handle.stat();
    if (!sameSnapshot(opened, afterRead) || afterRead.size !== contents.length) {
      throw new ComfyUIRecipeValidationError('Recipe changed while it was being read');
    }
  } finally {
    await handle.close();
  }

  const canonicalFile = await realpath(absoluteFile);
  assertContained(root.realPath, canonicalFile, 'Recipe real path');
  await verifySnapshots(snapshots);
  await verifyRoot(root);

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(contents);
  } catch {
    throw new ComfyUIRecipeValidationError('Recipe file is not valid UTF-8');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    throw new ComfyUIRecipeValidationError(
      `Recipe file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { recipe: validateComfyUIRecipe(raw), sourcePath: canonicalFile };
}

/** Enumerate a bounded recipe tree. Any symlink or special file fails closed. */
export async function loadComfyUIRecipeDirectory(
  rootDirectory: string,
  limits: ComfyUIRecipeLoaderLimits = {},
): Promise<LoadedComfyUIRecipe[]> {
  const root = await inspectRecipeRoot(rootDirectory);
  const maxFiles = boundedInteger(limits.maxFiles, 1, MAX_RECIPE_FILES, MAX_RECIPE_FILES);
  const maxEntries = boundedInteger(limits.maxEntries, 1, MAX_DIRECTORY_ENTRIES, MAX_DIRECTORY_ENTRIES);
  const maxDepth = boundedInteger(limits.maxDepth, 0, MAX_DIRECTORY_DEPTH, MAX_DIRECTORY_DEPTH);
  const pending: Array<{ absolute: string; relative: string; depth: number }> = [
    { absolute: root.realPath, relative: '', depth: 0 },
  ];
  const files: string[] = [];
  let entryCount = 0;

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) break;
    const entries = await readdir(directory.absolute, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      entryCount += 1;
      if (entryCount > maxEntries) {
        throw new ComfyUIRecipeValidationError(`Recipe directory exceeds ${maxEntries} entries`);
      }
      if (entry.name === '.' || entry.name === '..' || entry.name.includes('/') || entry.name.includes('\\')) {
        throw new ComfyUIRecipeValidationError('Recipe directory contains an unsafe entry name');
      }
      const absolute = path.join(directory.absolute, entry.name);
      const relative = directory.relative ? `${directory.relative}/${entry.name}` : entry.name;
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) {
        throw new ComfyUIRecipeValidationError(`Recipe directory contains a symbolic link: ${relative}`);
      }
      if (metadata.isDirectory()) {
        if (directory.depth >= maxDepth) {
          throw new ComfyUIRecipeValidationError(`Recipe directory exceeds depth ${maxDepth}`);
        }
        pending.push({ absolute, relative, depth: directory.depth + 1 });
      } else if (metadata.isFile()) {
        if (entry.name.endsWith('.json')) {
          assertSafeRecipeFilePath(relative);
          files.push(relative);
          if (files.length > maxFiles) {
            throw new ComfyUIRecipeValidationError(`Recipe directory exceeds ${maxFiles} JSON files`);
          }
        }
      } else {
        throw new ComfyUIRecipeValidationError(`Recipe directory contains a special file: ${relative}`);
      }
    }
  }

  await verifyRoot(root);
  const loaded: LoadedComfyUIRecipe[] = [];
  for (const relativeFile of files.sort()) {
    loaded.push(await loadComfyUIRecipeFile(root.realPath, relativeFile, limits));
  }
  return loaded;
}

/**
 * Immutable, version-aware recipe inventory. The execution runtime only accepts
 * selectors resolved here; it never accepts an ad-hoc workflow from a caller.
 */
export class ComfyUIRecipeRegistry {
  private readonly recipes = new Map<string, ComfyUIRecipe>();
  private readonly versionsById = new Map<string, Set<string>>();

  constructor(initialRecipes: readonly unknown[] = []) {
    this.registerMany(initialRecipes);
  }

  register(recipe: unknown): ComfyUIRecipe {
    const [registered] = this.registerMany([recipe]);
    if (!registered) throw new ComfyUIRecipeValidationError('Recipe registration failed');
    return registered;
  }

  registerMany(recipes: readonly unknown[]): ComfyUIRecipe[] {
    const validated = recipes.map((recipe) => validateComfyUIRecipe(recipe));
    const incomingKeys = new Set<string>();
    for (const recipe of validated) {
      const key = recipeKey(recipe.id, recipe.version);
      if (this.recipes.has(key) || incomingKeys.has(key)) {
        throw new ComfyUIRecipeValidationError(`Duplicate ComfyUI recipe: ${key}`);
      }
      incomingKeys.add(key);
    }

    const frozen = validated.map((recipe) => deepFreeze(recipe));
    for (const recipe of frozen) {
      this.recipes.set(recipeKey(recipe.id, recipe.version), recipe);
      const versions = this.versionsById.get(recipe.id) ?? new Set<string>();
      versions.add(recipe.version);
      this.versionsById.set(recipe.id, versions);
    }
    return frozen;
  }

  async loadDirectory(
    rootDirectory: string,
    limits: ComfyUIRecipeLoaderLimits = {},
  ): Promise<LoadedComfyUIRecipe[]> {
    const loaded = await loadComfyUIRecipeDirectory(rootDirectory, limits);
    this.registerMany(loaded.map((entry) => entry.recipe));
    return loaded;
  }

  get(selector: string | ComfyUIRecipeSelector, version?: string): ComfyUIRecipe {
    const normalized = normalizeSelector(selector, version);
    const selectedVersion = normalized.version ?? this.latestVersion(normalized.id);
    const recipe = selectedVersion
      ? this.recipes.get(recipeKey(normalized.id, selectedVersion))
      : undefined;
    if (!recipe) {
      throw new ComfyUIRecipeValidationError(
        `Unknown ComfyUI recipe: ${normalized.id}${normalized.version ? `@${normalized.version}` : ''}`,
      );
    }
    return recipe;
  }

  has(selector: string | ComfyUIRecipeSelector, version?: string): boolean {
    try {
      this.get(selector, version);
      return true;
    } catch {
      return false;
    }
  }

  list(): readonly ComfyUIRecipe[] {
    return [...this.recipes.values()].sort((left, right) => {
      const idOrder = left.id.localeCompare(right.id);
      return idOrder !== 0 ? idOrder : compareSemver(right.version, left.version);
    });
  }

  resolveFallbackChain(
    selector: string | ComfyUIRecipeSelector,
    version?: string,
    maxRecipes = 16,
  ): readonly ComfyUIRecipe[] {
    const first = this.get(selector, version);
    const resolved: ComfyUIRecipe[] = [];
    const visited = new Set<string>();
    const active = new Set<string>();
    const visit = (recipe: ComfyUIRecipe): void => {
      const key = recipeKey(recipe.id, recipe.version);
      if (active.has(key)) {
        throw new ComfyUIRecipeValidationError(`Recipe fallback cycle at ${key}`);
      }
      if (visited.has(key)) return;
      active.add(key);
      visited.add(key);
      resolved.push(recipe);
      if (resolved.length > maxRecipes) {
        throw new ComfyUIRecipeValidationError(`Fallback chain exceeds ${maxRecipes} recipes`);
      }
      for (const fallback of recipe.fallback) {
        const fallbackRecipe = this.get({ id: fallback.id, ...(fallback.version ? { version: fallback.version } : {}) });
        visit(fallbackRecipe);
      }
      active.delete(key);
    };
    visit(first);
    return resolved;
  }

  private latestVersion(id: string): string | undefined {
    const versions = this.versionsById.get(id);
    if (!versions || versions.size === 0) return undefined;
    return [...versions].sort(compareSemver).at(-1);
  }
}

interface RootSnapshot {
  configuredPath: string;
  realPath: string;
  stats: Stats;
}

async function inspectRecipeRoot(rootDirectory: string): Promise<RootSnapshot> {
  if (!path.isAbsolute(rootDirectory)) {
    throw new ComfyUIRecipeValidationError('Recipe root must be an absolute path');
  }
  const configuredPath = path.resolve(rootDirectory);
  const stats = await lstat(configuredPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ComfyUIRecipeValidationError('Recipe root must be a real directory, not a symbolic link');
  }
  const canonical = await realpath(configuredPath);
  if (canonical !== configuredPath) {
    throw new ComfyUIRecipeValidationError('Recipe root contains a symbolic-link path component');
  }
  return { configuredPath, realPath: canonical, stats };
}

async function verifyRoot(root: RootSnapshot): Promise<void> {
  const current = await lstat(root.configuredPath);
  if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, root.stats)) {
    throw new ComfyUIRecipeValidationError('Recipe root changed during loading');
  }
  if (await realpath(root.configuredPath) !== root.realPath) {
    throw new ComfyUIRecipeValidationError('Recipe root identity changed during loading');
  }
}

async function snapshotDescendants(root: string, relativeFile: string): Promise<DirectorySnapshot[]> {
  const snapshots: DirectorySnapshot[] = [];
  let cursor = root;
  const segments = relativeFile.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) throw new ComfyUIRecipeValidationError('Recipe path contains an empty segment');
    cursor = path.join(cursor, segment);
    const stats = await lstat(cursor);
    if (stats.isSymbolicLink()) {
      throw new ComfyUIRecipeValidationError(`Recipe path contains a symbolic link: ${segment}`);
    }
    const isLast = index === segments.length - 1;
    if ((!isLast && !stats.isDirectory()) || (isLast && !stats.isFile())) {
      throw new ComfyUIRecipeValidationError('Recipe path has an unexpected file type');
    }
    snapshots.push({ path: cursor, stats });
  }
  return snapshots;
}

async function verifySnapshots(snapshots: readonly DirectorySnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    const current = await lstat(snapshot.path);
    if (current.isSymbolicLink() || !sameIdentity(current, snapshot.stats)) {
      throw new ComfyUIRecipeValidationError('Recipe path changed during loading');
    }
  }
}

async function readFileHandleBounded(
  handle: Awaited<ReturnType<typeof open>>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  let position = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maxBytes) throw new ComfyUIRecipeValidationError(`Recipe file exceeds ${maxBytes} bytes`);
    chunks.push(chunk.subarray(0, bytesRead));
    position += bytesRead;
  }
  return Buffer.concat(chunks, total);
}

function assertSafeRecipeFilePath(relativeFile: string): void {
  if (!isSafeComfyUIRelativePath(relativeFile) || !relativeFile.endsWith('.json')) {
    throw new ComfyUIRecipeValidationError('Recipe file must be a safe relative .json path');
  }
}

function assertContained(root: string, candidate: string, label: string): void {
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ComfyUIRecipeValidationError(`${label} escapes the recipe root`);
  }
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshot(left: Stats, right: Stats): boolean {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function boundedInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ComfyUIRecipeValidationError(`Loader limit must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function normalizeSelector(
  selector: string | ComfyUIRecipeSelector,
  explicitVersion?: string,
): ComfyUIRecipeSelector {
  const normalized = typeof selector === 'string'
    ? { id: selector, ...(explicitVersion ? { version: explicitVersion } : {}) }
    : { ...selector };
  if (!SAFE_RECIPE_ID.test(normalized.id)
    || (normalized.version !== undefined && !SAFE_VERSION.test(normalized.version))) {
    throw new ComfyUIRecipeValidationError('Invalid ComfyUI recipe selector');
  }
  return normalized;
}

function recipeKey(id: string, version: string): string {
  return `${id}@${version}`;
}

function compareSemver(left: string, right: string): number {
  const leftParsed = parseSemver(left);
  const rightParsed = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParsed.core[index] ?? 0) - (rightParsed.core[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (leftParsed.prerelease.length === 0 && rightParsed.prerelease.length > 0) return 1;
  if (rightParsed.prerelease.length === 0 && leftParsed.prerelease.length > 0) return -1;
  const length = Math.max(leftParsed.prerelease.length, rightParsed.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParsed.prerelease[index];
    const rightPart = rightParsed.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

function parseSemver(value: string): { core: number[]; prerelease: string[] } {
  const withoutBuild = value.split('+', 1)[0] ?? value;
  const separator = withoutBuild.indexOf('-');
  const core = (separator === -1 ? withoutBuild : withoutBuild.slice(0, separator))
    .split('.')
    .map(Number);
  const prerelease = separator === -1 ? [] : withoutBuild.slice(separator + 1).split('.');
  return { core, prerelease };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
