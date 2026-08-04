import { createHash, randomUUID } from 'crypto';
import { constants as fsConstants, createReadStream } from 'fs';
import { access, copyFile, lstat, mkdir, readFile, realpath, stat } from 'fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { pathToFileURL } from 'url';
import type {
  CreativeAsset,
  CreativeAssetKind,
  CreativeAssetListInput,
  CreativeAssetListResult,
  CreativeAssetMaterializeInput,
  CreativeAssetMaterializeResult,
  CreativeContentTier,
} from '../../shared/creative-assets';
import { kindOf, scanMediaLibrary } from '../media-library';

const MAX_LIST_LIMIT = 500;
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;
const SAFE_DIRECTORY_NAME = /^(?!\.\.?$)[A-Za-z0-9.][A-Za-z0-9_.-]{0,199}$/;
const MEDIA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov', '.wav', '.mp3', '.ogg', '.flac']);

interface MySoulmateManifestAsset {
  id?: unknown;
  profileId?: unknown;
  contentTier?: unknown;
  style?: unknown;
  qaStatus?: unknown;
  sha256?: unknown;
  bytes?: unknown;
  width?: unknown;
  height?: unknown;
  path?: unknown;
}

interface RegistryOptions {
  roots: () => string[];
  activeRoot: () => string;
  mySoulmateRoot?: string;
  environment?: NodeJS.ProcessEnv;
}

export class CreativeAssetRegistry {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly knownPaths = new Map<string, string>();
  private readonly knownAssets = new Map<string, CreativeAsset>();
  private readonly knownDigests = new Map<string, string>();

  constructor(private readonly options: RegistryOptions) {
    this.environment = options.environment ?? process.env;
  }

  allowedTiers(): CreativeContentTier[] {
    return isEnabled(this.environment.CODEBUDDY_CREATIVE_ADULT_ASSETS)
      ? ['safe', 'sensual', 'explicit']
      : ['safe'];
  }

  async list(input: CreativeAssetListInput = {}): Promise<CreativeAssetListResult> {
    try {
      const allowedTiers = this.allowedTiers();
      const requestedTier = input.contentTier ?? 'safe';
      const tier = requestedTier === 'all' ? 'all' : allowedTiers.includes(requestedTier) ? requestedTier : 'safe';
      const limit = clampInt(input.limit, 1, MAX_LIST_LIMIT, 200);
      const query = input.query?.trim().toLocaleLowerCase('fr') ?? '';
      const [workspaceAssets, mySoulmateAssets] = await Promise.all([
        this.workspaceAssets(),
        this.mySoulmateAssets(allowedTiers),
      ]);
      const all = [...workspaceAssets, ...mySoulmateAssets]
        .filter((asset) => !input.kind || asset.kind === input.kind)
        .filter((asset) => tier === 'all' ? allowedTiers.includes(asset.contentTier) : asset.contentTier === tier)
        .filter((asset) => !input.companionId || asset.companionId === input.companionId)
        .filter((asset) => !query || `${asset.name} ${asset.companionId ?? ''} ${asset.style ?? ''}`.toLocaleLowerCase('fr').includes(query))
        .sort((left, right) => right.mtimeMs - left.mtimeMs);
      return { ok: true, assets: all.slice(0, limit), allowedTiers, truncated: all.length > limit };
    } catch (error) {
      return { ok: false, assets: [], allowedTiers: this.allowedTiers(), truncated: false, error: cleanError(error) };
    }
  }

  async registerTrustedPath(path: string, metadata: Partial<CreativeAsset> = {}): Promise<CreativeAsset> {
    const canonical = await this.resolveTrustedPath(path);
    const info = await stat(canonical);
    const kind = kindOf(canonical);
    if (!kind || !info.isFile()) throw new Error('Le fichier ne correspond pas à un média créatif pris en charge.');
    const id = mediaAssetId(canonical);
    this.knownPaths.set(id, canonical);
    const asset: CreativeAsset = {
      id,
      name: metadata.name ?? basename(canonical, extname(canonical)),
      kind,
      source: metadata.source ?? 'workspace',
      url: pathToFileURL(canonical).href,
      size: info.size,
      mtimeMs: info.mtimeMs,
      contentTier: metadata.contentTier ?? 'safe',
      qaStatus: metadata.qaStatus ?? 'pending',
      ...(metadata.companionId ? { companionId: metadata.companionId } : {}),
      ...(metadata.style ? { style: metadata.style } : {}),
      ...(metadata.prompt ? { prompt: metadata.prompt } : {}),
      ...(metadata.provider ? { provider: metadata.provider } : {}),
      ...(metadata.model ? { model: metadata.model } : {}),
    };
    this.knownAssets.set(id, asset);
    return asset;
  }

  async resolveAssetPath(id: string): Promise<string> {
    if (typeof id !== 'string' || id.length < 8 || id.length > 300 || id.includes('\0')) {
      throw new Error('Identifiant d’asset invalide.');
    }
    const known = this.knownPaths.get(id);
    if (known) return this.verifyKnownAsset(id, await this.resolveTrustedPath(known));
    await this.list({ contentTier: 'all', limit: MAX_LIST_LIMIT });
    const refreshed = this.knownPaths.get(id);
    if (!refreshed) throw new Error('Asset introuvable ou non autorisé par la politique active.');
    return this.verifyKnownAsset(id, await this.resolveTrustedPath(refreshed));
  }

  async resolveAsset(id: string): Promise<CreativeAsset> {
    await this.resolveAssetPath(id);
    const asset = this.knownAssets.get(id);
    if (!asset) throw new Error('Asset metadata is unavailable.');
    return asset;
  }

  async importPaths(paths: readonly string[]): Promise<CreativeAsset[]> {
    const root = await this.resolveActiveRoot();
    const destination = await ensureConfinedDirectory(root, '.codebuddy/media-generation/images', 0o700);
    const imported: CreativeAsset[] = [];
    for (const raw of paths.slice(0, 20)) {
      if (!isAbsolute(raw) || raw.includes('\0')) throw new Error('Chemin d’import invalide.');
      const rawInfo = await lstat(raw);
      if (rawInfo.isSymbolicLink()) throw new Error('Les imports par lien symbolique sont interdits.');
      const source = await realpath(raw);
      const sourceInfo = await lstat(source);
      const extension = extname(source).toLowerCase();
      if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile() || sourceInfo.size <= 0 || sourceInfo.size > MAX_IMPORT_BYTES) {
        throw new Error('Chaque image importée doit être un fichier régulier de moins de 50 Mo.');
      }
      if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new Error('Format d’image importé non pris en charge.');
      const name = `import-${randomUUID()}${extension}`;
      const target = join(destination, name);
      await copyFile(source, target, fsConstants.COPYFILE_EXCL);
      imported.push(await this.registerTrustedPath(target));
    }
    return imported;
  }

  async materialize(input: CreativeAssetMaterializeInput): Promise<CreativeAssetMaterializeResult> {
    try {
      if (!Array.isArray(input.ids) || input.ids.length === 0 || input.ids.length > 50) {
        throw new Error('Sélection d’assets invalide.');
      }
      const targetRoot = await this.resolveMaterializationRoot(input.targetRoot);
      const destinationRelative = destinationForStack(input.stack);
      const destination = await ensureConfinedDirectory(targetRoot, destinationRelative, 0o755);
      const outputs = [];
      for (const id of [...new Set(input.ids)]) {
        const source = await this.resolveAssetPath(id);
        const extension = extname(source).toLowerCase();
        if (!MEDIA_EXTENSIONS.has(extension)) throw new Error('Extension d’asset non prise en charge.');
        const [idDigest, sourceDigest] = await Promise.all([
          Promise.resolve(createHash('sha256').update(id).digest('hex').slice(0, 8)),
          fileSha256(source),
        ]);
        const targetName = `${safeStem(basename(source, extension))}-${idDigest}-${sourceDigest.slice(0, 16)}${extension}`;
        const target = join(destination, targetName);
        try {
          await copyFile(source, target, fsConstants.COPYFILE_EXCL);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        const targetInfo = await lstat(target);
        if (targetInfo.isSymbolicLink() || !targetInfo.isFile()) {
          throw new Error('L’asset matérialisé doit être un fichier régulier sans lien symbolique.');
        }
        if (await fileSha256(target) !== sourceDigest) {
          throw new Error('L’asset matérialisé existe avec un contenu différent de la source approuvée.');
        }
        const asset = this.knownAssets.get(id);
        outputs.push({
          id,
          name: asset?.name ?? basename(source, extension),
          relativePath: `${destinationRelative}/${targetName}`,
          kind: kindOf(source) as CreativeAssetKind,
          contentTier: asset?.contentTier ?? 'safe',
        });
      }
      return { ok: true, assets: outputs };
    } catch (error) {
      return { ok: false, error: cleanError(error) };
    }
  }

  private async workspaceAssets(): Promise<CreativeAsset[]> {
    const roots = await this.canonicalRoots();
    return scanMediaLibrary(roots, MAX_LIST_LIMIT).map((item) => {
      const id = mediaAssetId(item.path);
      this.knownPaths.set(id, item.path);
      const asset = {
        id,
        name: basename(item.path, extname(item.path)),
        kind: item.kind,
        source: item.path.includes(`${sep}avatar-`) ? 'avatar-bible' : 'workspace',
        url: pathToFileURL(item.path).href,
        size: item.size,
        mtimeMs: item.mtimeMs,
        contentTier: 'safe',
        qaStatus: 'pending',
        ...(item.prompt ? { prompt: item.prompt } : {}),
        ...(item.model ? { model: item.model } : {}),
        ...(item.provider ? { provider: item.provider } : {}),
        ...(item.sessionId ? { sessionId: item.sessionId } : {}),
      } satisfies CreativeAsset;
      this.knownAssets.set(id, asset);
      return asset;
    });
  }

  private async mySoulmateAssets(allowedTiers: CreativeContentTier[]): Promise<CreativeAsset[]> {
    const configured = this.environment.MYSOULMATE_IMAGE_CATALOG_ROOT?.trim();
    const root = configured || this.options.mySoulmateRoot;
    if (!root || !isAbsolute(root)) return [];
    const canonicalRoot = await optionalRealpath(root);
    if (!canonicalRoot) return [];
    const manifestPath = join(canonicalRoot, 'manifest.json');
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
    } catch {
      return [];
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const assets = (parsed as { assets?: unknown }).assets;
    if (!Array.isArray(assets)) return [];
    const manifestInfo = await stat(manifestPath);
    const out: CreativeAsset[] = [];
    for (const raw of assets.slice(0, 50_000)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const candidate = raw as MySoulmateManifestAsset;
      const tier = creativeTier(candidate.contentTier);
      if (!tier || !allowedTiers.includes(tier) || typeof candidate.path !== 'string') continue;
      if (candidate.qaStatus !== 'approved') continue;
      if (typeof candidate.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(candidate.sha256)) continue;
      const segments = candidate.path.split(/[\\/]/u);
      if (!segments.length || segments.some((segment) => !SAFE_NAME.test(segment) || segment === '..')) continue;
      const path = join(canonicalRoot, ...segments);
      const canonical = await optionalRealpath(path);
      if (!canonical || !isWithin(canonical, canonicalRoot)) continue;
      const fileInfo = await stat(canonical);
      if (!fileInfo.isFile() || fileInfo.size <= 0) continue;
      const manifestId = typeof candidate.id === 'string' && candidate.id.length <= 220 ? candidate.id : createHash('sha256').update(candidate.path).digest('hex');
      const id = `mysoulmate:${manifestId}`;
      this.knownPaths.set(id, canonical);
      this.knownDigests.set(id, candidate.sha256);
      const asset: CreativeAsset = {
        id,
        name: `${stringValue(candidate.profileId, 'Compagnon')} · ${stringValue(candidate.style, basename(canonical, extname(canonical)))}`,
        kind: 'image',
        source: 'mysoulmate',
        url: pathToFileURL(canonical).href,
        size: typeof candidate.bytes === 'number' ? candidate.bytes : fileInfo.size,
        mtimeMs: manifestInfo.mtimeMs,
        contentTier: tier,
        qaStatus: 'approved',
        ...(typeof candidate.profileId === 'string' ? { companionId: candidate.profileId } : {}),
        ...(typeof candidate.style === 'string' ? { style: candidate.style } : {}),
        ...(typeof candidate.width === 'number' ? { width: candidate.width } : {}),
        ...(typeof candidate.height === 'number' ? { height: candidate.height } : {}),
      };
      this.knownAssets.set(id, asset);
      out.push(asset);
    }
    return out;
  }

  private async resolveTrustedPath(path: string): Promise<string> {
    if (!isAbsolute(path) || path.includes('\0')) throw new Error('Chemin média invalide.');
    const canonical = await realpath(path);
    const roots = await this.allTrustedRoots();
    if (!roots.some((root) => isWithin(canonical, root))) throw new Error('Le média est hors des racines créatives autorisées.');
    return canonical;
  }

  private async resolveActiveRoot(): Promise<string> {
    const root = this.options.activeRoot();
    if (!root || !isAbsolute(root)) throw new Error('Aucun workspace actif pour les médias.');
    await mkdir(root, { recursive: true });
    return realpath(root);
  }

  private async resolveMaterializationRoot(value: string): Promise<string> {
    if (!value || !isAbsolute(value) || value.includes('\0')) throw new Error('Dossier projet invalide.');
    const candidate = resolve(value);
    const roots = await this.canonicalRoots();
    if (!roots.some((root) => isWithin(candidate, root))) throw new Error('Le projet cible est hors des workspaces autorisés.');
    await mkdir(candidate, { recursive: true });
    const canonical = await realpath(candidate);
    if (!roots.some((root) => isWithin(canonical, root))) {
      throw new Error('Le projet cible traverse un lien symbolique hors des workspaces autorisés.');
    }
    return canonical;
  }

  private async verifyKnownAsset(id: string, path: string): Promise<string> {
    const expected = this.knownDigests.get(id);
    if (!expected) return path;
    const actual = createHash('sha256').update(await readFile(path)).digest('hex');
    if (actual !== expected) {
      this.knownPaths.delete(id);
      this.knownAssets.delete(id);
      this.knownDigests.delete(id);
      throw new Error('L’empreinte de l’asset MySoulmate ne correspond plus au manifeste approuvé.');
    }
    return path;
  }

  private async canonicalRoots(): Promise<string[]> {
    const out: string[] = [];
    for (const root of [...new Set([...this.options.roots(), this.options.activeRoot()])]) {
      if (!root || !isAbsolute(root)) continue;
      const canonical = await optionalRealpath(root);
      if (canonical) out.push(canonical);
    }
    return out;
  }

  private async allTrustedRoots(): Promise<string[]> {
    const roots = await this.canonicalRoots();
    const mySoulmateRoot = this.environment.MYSOULMATE_IMAGE_CATALOG_ROOT?.trim() || this.options.mySoulmateRoot;
    const catalog = mySoulmateRoot ? await optionalRealpath(mySoulmateRoot) : null;
    return catalog ? [...roots, catalog] : roots;
  }
}

function destinationForStack(stack?: string): string {
  if (stack === 'react-vite' || stack === 'vue-vite') return 'public/generated';
  return 'assets/generated';
}

function mediaAssetId(path: string): string {
  return `media:${createHash('sha256').update(resolve(path)).digest('hex')}`;
}

function safeStem(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').replace(/[^A-Za-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || 'asset';
}

function isWithin(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function optionalRealpath(path: string): Promise<string | null> {
  try {
    await access(path);
    return await realpath(path);
  } catch {
    return null;
  }
}

async function ensureConfinedDirectory(root: string, relativePath: string, mode: number): Promise<string> {
  let current = root;
  for (const segment of relativePath.split('/')) {
    if (!SAFE_DIRECTORY_NAME.test(segment)) throw new Error('Dossier média invalide.');
    current = join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error('Le dossier média traverse un lien symbolique ou un fichier.');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try {
        await mkdir(current, { mode });
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
        const info = await lstat(current);
        if (info.isSymbolicLink() || !info.isDirectory()) {
          throw new Error('Le dossier média traverse un lien symbolique ou un fichier.');
        }
      }
    }
    const canonical = await realpath(current);
    if (!isWithin(canonical, root)) {
      throw new Error('Le dossier média traverse un lien symbolique hors du workspace.');
    }
  }
  return realpath(current);
}

async function fileSha256(filename: string): Promise<string> {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filename);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveDigest(hash.digest('hex')));
  });
}

function creativeTier(value: unknown): CreativeContentTier | null {
  return value === 'safe' || value === 'sensual' || value === 'explicit' ? value : null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function isEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value!)));
}

function cleanError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
