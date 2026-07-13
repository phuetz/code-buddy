import { createHash, randomUUID } from 'crypto';
import { constants as fsConstants } from 'fs';
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from 'fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { pathToFileURL } from 'url';
import {
  AVATAR_BIBLE_CONSENT,
  AVATAR_BIBLE_RIGHTS,
  AVATAR_BIBLE_ROLES,
  type AvatarBibleConsent,
  type AvatarBibleEntry,
  type AvatarBibleMetadataInput,
  type AvatarBibleRights,
  type AvatarBibleRole,
  type AvatarBibleSnapshot,
  type AvatarBibleUpdateInput,
} from '../../shared/avatar-bible';

const MAX_AVATARS = 128;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MIN_IMAGE_DIMENSION = 16;
const MAX_IMAGE_DIMENSION = 8_192;
const MAX_IMAGE_PIXELS = 40_000_000;
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ASSET_NAME = /^[0-9a-f-]{36}\.(png|jpg|webp)$/u;
const ROLE_SET = new Set<string>(AVATAR_BIBLE_ROLES);
const RIGHTS_SET = new Set<string>(AVATAR_BIBLE_RIGHTS);
const CONSENT_SET = new Set<string>(AVATAR_BIBLE_CONSENT);

interface StoredAvatarBibleEntry extends AvatarBibleEntry {
  fileName: string;
}

interface StoredAvatarBibleManifest {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  masterId?: string;
  avatars: StoredAvatarBibleEntry[];
}

interface AvatarBibleStorage {
  workspaceRoot: string;
  bibleRoot: string;
  assetsRoot: string;
  manifestPath: string;
}

interface ParsedImage {
  format: 'png' | 'jpg' | 'webp';
  mime: AvatarBibleEntry['mime'];
  width: number;
  height: number;
}

export interface AvatarBibleServiceOptions {
  getWorkspace: () => string | null | undefined;
  selectImage: () => Promise<string | null>;
  now?: () => Date;
}

/**
 * Owns the project-local avatar bible. The only operation which ever accepts
 * a source path is fed by Electron's main-process file dialog, never IPC.
 */
export class AvatarBibleService {
  private readonly now: () => Date;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: AvatarBibleServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async list(): Promise<AvatarBibleSnapshot> {
    const storage = await this.resolveStorage();
    return publicSnapshot(await this.readManifest(storage));
  }

  async importFromDialog(input: AvatarBibleMetadataInput): Promise<{
    canceled: boolean;
    avatar?: AvatarBibleEntry;
    snapshot: AvatarBibleSnapshot;
  }> {
    const metadata = validateMetadata(input);
    const initialStorage = await this.resolveStorage();
    const sourcePath = await this.options.selectImage();
    if (!sourcePath) {
      return {
        canceled: true,
        snapshot: publicSnapshot(await this.readManifest(initialStorage)),
      };
    }
    const currentStorage = await this.resolveStorage();
    if (!samePath(initialStorage.workspaceRoot, currentStorage.workspaceRoot)) {
      throw new Error('Le projet actif a changé pendant la sélection de l’image. Réessayez.');
    }
    return this.mutate(async () => {
      const content = await readAndValidateImport(sourcePath);
      const manifest = await this.readManifest(currentStorage);
      if (manifest.avatars.length >= MAX_AVATARS) {
        throw new Error(`La bibliothèque est limitée à ${MAX_AVATARS} avatars par projet.`);
      }

      const id = randomUUID();
      const fileName = `${randomUUID()}.${content.image.format}`;
      const assetPath = join(currentStorage.assetsRoot, fileName);
      await writeExclusiveFile(assetPath, content.bytes);
      const timestamp = this.now().toISOString();
      const avatar: StoredAvatarBibleEntry = {
        id,
        ...metadata,
        sha256: createHash('sha256').update(content.bytes).digest('hex'),
        mime: content.image.mime,
        bytes: content.bytes.length,
        width: content.image.width,
        height: content.image.height,
        createdAt: timestamp,
        updatedAt: timestamp,
        fileName,
      };
      const avatars = metadata.role === 'master'
        ? [...manifest.avatars.map(demoteMaster), avatar]
        : [...manifest.avatars, avatar];
      const next = bumpManifest({
        ...manifest,
        avatars,
        ...(metadata.role === 'master' ? { masterId: id } : {}),
      }, timestamp);
      try {
        await this.writeManifest(currentStorage, next);
      } catch (error) {
        await rm(assetPath, { force: true }).catch(() => undefined);
        throw error;
      }
      return {
        canceled: false,
        avatar: publicEntry(avatar),
        snapshot: publicSnapshot(next),
      };
    });
  }

  async update(input: AvatarBibleUpdateInput): Promise<{
    avatar: AvatarBibleEntry;
    snapshot: AvatarBibleSnapshot;
  }> {
    const id = validateId(input?.id);
    const metadata = validateMetadata(input);
    return this.mutate(async () => {
      const storage = await this.resolveStorage();
      const manifest = await this.readManifest(storage);
      const existing = manifest.avatars.find((avatar) => avatar.id === id);
      if (!existing) throw new Error('Avatar introuvable dans le projet actif.');
      const timestamp = this.now().toISOString();
      const updated: StoredAvatarBibleEntry = { ...existing, ...metadata, updatedAt: timestamp };
      const avatars = manifest.avatars.map((avatar) => {
        if (avatar.id === id) return updated;
        return metadata.role === 'master' ? demoteMaster(avatar) : avatar;
      });
      const nextMasterId = metadata.role === 'master'
        ? id
        : manifest.masterId === id ? undefined : manifest.masterId;
      const next = bumpManifest({
        ...manifest,
        avatars,
        masterId: nextMasterId,
      }, timestamp);
      await this.writeManifest(storage, next);
      return { avatar: publicEntry(updated), snapshot: publicSnapshot(next) };
    });
  }

  async setMaster(idValue: unknown): Promise<AvatarBibleSnapshot> {
    const id = validateId(idValue);
    return this.mutate(async () => {
      const storage = await this.resolveStorage();
      const manifest = await this.readManifest(storage);
      if (!manifest.avatars.some((avatar) => avatar.id === id)) {
        throw new Error('Avatar introuvable dans le projet actif.');
      }
      const timestamp = this.now().toISOString();
      const next = bumpManifest({
        ...manifest,
        masterId: id,
        avatars: manifest.avatars.map((avatar) => avatar.id === id
          ? { ...avatar, role: 'master', updatedAt: timestamp }
          : demoteMaster(avatar)),
      }, timestamp);
      await this.writeManifest(storage, next);
      return publicSnapshot(next);
    });
  }

  async remove(idValue: unknown): Promise<{ removedId: string; snapshot: AvatarBibleSnapshot }> {
    const id = validateId(idValue);
    return this.mutate(async () => {
      const storage = await this.resolveStorage();
      const manifest = await this.readManifest(storage);
      const existing = manifest.avatars.find((avatar) => avatar.id === id);
      if (!existing) throw new Error('Avatar introuvable dans le projet actif.');
      const assetPath = await this.resolveStoredAsset(storage, existing);
      const timestamp = this.now().toISOString();
      const next = bumpManifest({
        ...manifest,
        avatars: manifest.avatars.filter((avatar) => avatar.id !== id),
        ...(manifest.masterId === id ? { masterId: undefined } : {}),
      }, timestamp);
      await this.writeManifest(storage, next);
      // The manifest is the authority. A failed best-effort unlink can only
      // leave an unreachable orphan; it must not turn a committed removal
      // into a renderer-visible failure.
      await unlink(assetPath).catch(() => undefined);
      return { removedId: id, snapshot: publicSnapshot(next) };
    });
  }

  async preview(idValue: unknown): Promise<{ id: string; dataUrl: string }> {
    const id = validateId(idValue);
    const storage = await this.resolveStorage();
    const manifest = await this.readManifest(storage);
    const avatar = manifest.avatars.find((candidate) => candidate.id === id);
    if (!avatar) throw new Error('Avatar introuvable dans le projet actif.');
    const { bytes } = await this.readStoredAsset(storage, avatar);
    return { id, dataUrl: `data:${avatar.mime};base64,${bytes.toString('base64')}` };
  }

  /**
   * Make a verified working copy in Flow's existing generated-media trust root.
   * The private bible path remains main-process-only; renderer code receives
   * the disposable derivative path, never `.codebuddy/avatar-bible/assets`.
   */
  async materializeForFlow(idValue: unknown): Promise<{
    id: string;
    name: string;
    path: string;
    url: string;
  }> {
    const id = validateId(idValue);
    return this.mutate(async () => {
      const storage = await this.resolveStorage();
      const manifest = await this.readManifest(storage);
      const avatar = manifest.avatars.find((candidate) => candidate.id === id);
      if (!avatar) throw new Error('Avatar introuvable dans le projet actif.');
      const { bytes } = await this.readStoredAsset(storage, avatar);
      const codeBuddyRoot = join(storage.workspaceRoot, '.codebuddy');
      const mediaRoot = await ensurePrivateDirectory(codeBuddyRoot, 'media-generation');
      const imagesRoot = await ensurePrivateDirectory(mediaRoot, 'images');
      const extension = avatar.mime === 'image/png'
        ? 'png'
        : avatar.mime === 'image/jpeg' ? 'jpg' : 'webp';
      const path = join(imagesRoot, `avatar-${id}-${avatar.sha256.slice(0, 12)}.${extension}`);
      try {
        await writeExclusiveFile(path, bytes);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await verifyExistingFlowCopy(path, avatar);
      }
      return { id, name: avatar.name, path, url: pathToFileURL(path).href };
    });
  }

  /** Main-process-only resolver for media generation. Never expose this path over IPC. */
  async resolveAssetPath(idValue: unknown): Promise<string> {
    const id = validateId(idValue);
    const storage = await this.resolveStorage();
    const manifest = await this.readManifest(storage);
    const avatar = manifest.avatars.find((candidate) => candidate.id === id);
    if (!avatar) throw new Error('Avatar introuvable dans le projet actif.');
    const { path } = await this.readStoredAsset(storage, avatar);
    return path;
  }

  private async readStoredAsset(
    storage: AvatarBibleStorage,
    avatar: StoredAvatarBibleEntry,
  ): Promise<{ path: string; bytes: Buffer }> {
    const path = await this.resolveStoredAsset(storage, avatar);
    const handle = await open(path, fsConstants.O_RDONLY | O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size !== avatar.bytes || before.size > MAX_IMAGE_BYTES) {
        throw new Error('Le fichier avatar ne correspond plus au manifeste privé.');
      }
      const bytes = await handle.readFile();
      const parsed = parseImage(bytes);
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (
        digest !== avatar.sha256
        || parsed.mime !== avatar.mime
        || parsed.width !== avatar.width
        || parsed.height !== avatar.height
      ) {
        throw new Error('L’intégrité du fichier avatar a changé.');
      }
      return { path, bytes };
    } finally {
      await handle.close();
    }
  }

  private async resolveStoredAsset(
    storage: AvatarBibleStorage,
    avatar: StoredAvatarBibleEntry,
  ): Promise<string> {
    if (!SAFE_ASSET_NAME.test(avatar.fileName)) throw new Error('Nom d’asset avatar invalide.');
    const candidate = join(storage.assetsRoot, avatar.fileName);
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error('Asset avatar non régulier refusé.');
    const canonical = await realpath(candidate);
    if (!isWithin(storage.assetsRoot, canonical)) throw new Error('Asset avatar hors de la bibliothèque privée.');
    return canonical;
  }

  private async resolveStorage(): Promise<AvatarBibleStorage> {
    const workspace = this.options.getWorkspace();
    if (typeof workspace !== 'string' || !workspace.trim() || !isAbsolute(workspace) || workspace.includes('\0')) {
      throw new Error('Ouvrez un projet avec un workspace local avant d’utiliser les avatars.');
    }
    const workspaceRoot = await realpath(resolve(workspace));
    const workspaceInfo = await stat(workspaceRoot);
    if (!workspaceInfo.isDirectory()) throw new Error('Le workspace actif n’est pas un dossier.');

    const codeBuddyRoot = await ensurePrivateDirectory(workspaceRoot, '.codebuddy');
    const bibleRoot = await ensurePrivateDirectory(codeBuddyRoot, 'avatar-bible');
    const assetsRoot = await ensurePrivateDirectory(bibleRoot, 'assets');
    return {
      workspaceRoot,
      bibleRoot,
      assetsRoot,
      manifestPath: join(bibleRoot, 'manifest.json'),
    };
  }

  private async readManifest(storage: AvatarBibleStorage): Promise<StoredAvatarBibleManifest> {
    let handle;
    try {
      handle = await open(storage.manifestPath, fsConstants.O_RDONLY | O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyManifest(this.now());
      throw error;
    }
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_MANIFEST_BYTES) {
        throw new Error('Manifest avatar invalide ou trop volumineux.');
      }
      const parsed = JSON.parse(await handle.readFile({ encoding: 'utf-8' })) as unknown;
      return validateManifest(parsed);
    } finally {
      await handle.close();
    }
  }

  private async writeManifest(
    storage: AvatarBibleStorage,
    manifest: StoredAvatarBibleManifest,
  ): Promise<void> {
    const validated = validateManifest(manifest);
    const content = Buffer.from(`${JSON.stringify(validated, null, 2)}\n`, 'utf-8');
    if (content.length > MAX_MANIFEST_BYTES) throw new Error('Manifest avatar trop volumineux.');
    const temporary = join(storage.bibleRoot, `.manifest.${process.pid}.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(
        temporary,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | O_NOFOLLOW,
        0o600,
      );
      await handle.writeFile(content);
      await handle.chmod(0o600);
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        const current = await lstat(storage.manifestPath);
        if (current.isSymbolicLink() || !current.isFile()) {
          throw new Error('Manifest avatar non régulier refusé.');
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await rename(temporary, storage.manifestPath);
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

async function ensurePrivateDirectory(parent: string, name: string): Promise<string> {
  const candidate = join(parent, name);
  try {
    await mkdir(candidate, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const metadata = await lstat(candidate);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error('La bibliothèque avatar traverse un lien symbolique.');
  }
  const canonical = await realpath(candidate);
  if (!samePath(canonical, candidate) || !isWithin(parent, canonical)) {
    throw new Error('La bibliothèque avatar sort du workspace actif.');
  }
  await stat(canonical);
  return canonical;
}

async function readAndValidateImport(sourcePath: string): Promise<{ bytes: Buffer; image: ParsedImage }> {
  if (!isAbsolute(sourcePath) || sourcePath.includes('\0')) throw new Error('Image locale invalide.');
  const extension = extname(sourcePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
    throw new Error('Formats acceptés : PNG, JPEG et WebP.');
  }
  const sourceInfo = await lstat(sourcePath);
  if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) {
    throw new Error('Les liens symboliques et fichiers non réguliers sont refusés.');
  }
  const handle = await open(sourcePath, fsConstants.O_RDONLY | O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size <= 0n || before.size > BigInt(MAX_IMAGE_BYTES)) {
      throw new Error('L’image doit peser moins de 15 Mo.');
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
    ) {
      throw new Error('L’image a changé pendant son import.');
    }
    const image = parseImage(bytes);
    const expected = extension === '.jpeg' ? 'jpg' : extension.slice(1);
    if (image.format !== expected) throw new Error('La signature de l’image ne correspond pas à son extension.');
    validateDimensions(image.width, image.height);
    return { bytes, image };
  } finally {
    await handle.close();
  }
}

async function writeExclusiveFile(path: string, content: Buffer): Promise<void> {
  const handle = await open(
    path,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | O_NOFOLLOW,
    0o600,
  );
  let keep = false;
  try {
    await handle.writeFile(content);
    await handle.chmod(0o600);
    await handle.sync();
    keep = true;
  } finally {
    await handle.close();
    if (!keep) await rm(path, { force: true }).catch(() => undefined);
  }
}

async function verifyExistingFlowCopy(
  path: string,
  avatar: StoredAvatarBibleEntry,
): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size !== avatar.bytes) {
    throw new Error('La copie de travail Flow existante est invalide.');
  }
  const handle = await open(path, fsConstants.O_RDONLY | O_NOFOLLOW);
  try {
    const bytes = await handle.readFile();
    const image = parseImage(bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (
      digest !== avatar.sha256
      || image.mime !== avatar.mime
      || image.width !== avatar.width
      || image.height !== avatar.height
    ) {
      throw new Error('La copie de travail Flow a été modifiée ; elle ne sera pas réutilisée.');
    }
  } finally {
    await handle.close();
  }
}

function parseImage(bytes: Buffer): ParsedImage {
  if (
    bytes.length >= 24
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    && bytes.subarray(12, 16).toString('ascii') === 'IHDR'
  ) {
    return {
      format: 'png',
      mime: 'image/png',
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const dimensions = jpegDimensions(bytes);
    if (dimensions) return { format: 'jpg', mime: 'image/jpeg', ...dimensions };
  }
  if (
    bytes.length >= 30
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    const dimensions = webpDimensions(bytes);
    if (dimensions) return { format: 'webp', mime: 'image/webp', ...dimensions };
  }
  throw new Error('Signature d’image PNG, JPEG ou WebP invalide.');
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset]!;
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (frameMarkers.has(marker) && length >= 7) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes: Buffer): { width: number; height: number } | null {
  const chunk = bytes.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b1 = bytes[21]!;
    const b2 = bytes[22]!;
    const b3 = bytes[23]!;
    const b4 = bytes[24]!;
    return {
      width: 1 + (b1 | ((b2 & 0x3f) << 8)),
      height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
    };
  }
  if (
    chunk === 'VP8 '
    && bytes.length >= 30
    && bytes[23] === 0x9d
    && bytes[24] === 0x01
    && bytes[25] === 0x2a
  ) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

function validateDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < MIN_IMAGE_DIMENSION
    || height < MIN_IMAGE_DIMENSION
    || width > MAX_IMAGE_DIMENSION
    || height > MAX_IMAGE_DIMENSION
    || width * height > MAX_IMAGE_PIXELS
  ) {
    throw new Error('Dimensions refusées : entre 16 et 8192 px, 40 mégapixels maximum.');
  }
}

function validateMetadata(input: AvatarBibleMetadataInput): AvatarBibleMetadataInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Métadonnées avatar requises.');
  const name = cleanText(input.name, 'Nom', 120, true)!;
  const notes = cleanText(input.notes, 'Notes', 2_000, false);
  if (!ROLE_SET.has(input.role)) throw new Error('Rôle avatar invalide.');
  if (!RIGHTS_SET.has(input.rights)) throw new Error('Déclaration de droits invalide.');
  if (!CONSENT_SET.has(input.consent)) throw new Error('Déclaration de consentement invalide.');
  return {
    name,
    role: input.role,
    rights: input.rights,
    consent: input.consent,
    ...(notes ? { notes } : {}),
  };
}

function cleanText(
  value: unknown,
  label: string,
  maxLength: number,
  required: boolean,
): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label} requis.`);
    return undefined;
  }
  if (typeof value !== 'string' || value.includes('\0')) throw new Error(`${label} invalide.`);
  const normalized = Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return (code > 0 && code < 32) || code === 127 ? ' ' : character;
  }).join('').trim();
  if (required && !normalized) throw new Error(`${label} requis.`);
  if (normalized.length > maxLength) throw new Error(`${label} limité à ${maxLength} caractères.`);
  return normalized || undefined;
}

function validateId(value: unknown): string {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) throw new Error('Identifiant avatar invalide.');
  return value.toLowerCase();
}

function validateManifest(value: unknown): StoredAvatarBibleManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Manifest avatar invalide.');
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1) throw new Error('Version de manifest avatar non prise en charge.');
  if (!Number.isInteger(input.revision) || Number(input.revision) < 0) throw new Error('Révision avatar invalide.');
  if (!isIsoDate(input.updatedAt)) throw new Error('Date de manifest avatar invalide.');
  if (!Array.isArray(input.avatars) || input.avatars.length > MAX_AVATARS) throw new Error('Liste d’avatars invalide.');
  const avatars = input.avatars.map(validateStoredEntry);
  if (new Set(avatars.map((avatar) => avatar.id)).size !== avatars.length) throw new Error('Identifiants avatar dupliqués.');
  const masterId = input.masterId === undefined ? undefined : validateId(input.masterId);
  if (masterId && !avatars.some((avatar) => avatar.id === masterId)) throw new Error('Avatar maître absent du manifest.');
  const roleMasters = avatars.filter((avatar) => avatar.role === 'master');
  if (
    (masterId && (roleMasters.length !== 1 || roleMasters[0]?.id !== masterId))
    || (!masterId && roleMasters.length !== 0)
  ) {
    throw new Error('Le rôle maître et masterId doivent désigner une référence unique.');
  }
  return {
    schemaVersion: 1,
    revision: Number(input.revision),
    updatedAt: input.updatedAt as string,
    ...(masterId ? { masterId } : {}),
    avatars,
  };
}

function validateStoredEntry(value: unknown): StoredAvatarBibleEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Entrée avatar invalide.');
  const input = value as Record<string, unknown>;
  const metadata = validateMetadata({
    name: input.name as string,
    role: input.role as AvatarBibleRole,
    rights: input.rights as AvatarBibleRights,
    consent: input.consent as AvatarBibleConsent,
    ...(typeof input.notes === 'string' ? { notes: input.notes } : {}),
  });
  const id = validateId(input.id);
  const fileName = typeof input.fileName === 'string' && SAFE_ASSET_NAME.test(input.fileName)
    ? input.fileName
    : null;
  if (!fileName) throw new Error('Nom de fichier avatar invalide.');
  if (typeof input.sha256 !== 'string' || !SHA256.test(input.sha256)) throw new Error('Empreinte avatar invalide.');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(String(input.mime))) throw new Error('MIME avatar invalide.');
  const bytes = Number(input.bytes);
  const width = Number(input.width);
  const height = Number(input.height);
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_IMAGE_BYTES) throw new Error('Taille avatar invalide.');
  validateDimensions(width, height);
  if (!isIsoDate(input.createdAt) || !isIsoDate(input.updatedAt)) throw new Error('Date avatar invalide.');
  return {
    id,
    ...metadata,
    sha256: input.sha256,
    mime: input.mime as AvatarBibleEntry['mime'],
    bytes,
    width,
    height,
    createdAt: input.createdAt as string,
    updatedAt: input.updatedAt as string,
    fileName,
  };
}

function emptyManifest(now: Date): StoredAvatarBibleManifest {
  return { schemaVersion: 1, revision: 0, updatedAt: now.toISOString(), avatars: [] };
}

function bumpManifest(
  manifest: StoredAvatarBibleManifest,
  updatedAt: string,
): StoredAvatarBibleManifest {
  return validateManifest({ ...manifest, revision: manifest.revision + 1, updatedAt });
}

function publicEntry(entry: StoredAvatarBibleEntry): AvatarBibleEntry {
  const { fileName, ...safe } = entry;
  void fileName;
  return safe;
}

function demoteMaster(entry: StoredAvatarBibleEntry): StoredAvatarBibleEntry {
  return entry.role === 'master' ? { ...entry, role: 'front' } : entry;
}

function publicSnapshot(manifest: StoredAvatarBibleManifest): AvatarBibleSnapshot {
  return {
    schemaVersion: 1,
    revision: manifest.revision,
    updatedAt: manifest.updatedAt,
    ...(manifest.masterId ? { masterId: manifest.masterId } : {}),
    avatars: manifest.avatars.map(publicEntry),
    privacy: {
      projectScoped: true,
      containsFaceEmbeddings: false,
      note: 'Images créatives privées uniquement ; aucun enrôlement facial ni embedding biométrique.',
    },
  };
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isWithin(root: string, target: string): boolean {
  const child = relative(root, target);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}
