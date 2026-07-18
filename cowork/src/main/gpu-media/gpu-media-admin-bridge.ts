import { dialog } from 'electron';
import { link, lstat, mkdir, readFile, realpath, unlink, writeFile } from 'fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'path';
import { pathToFileURL } from 'url';
import { createHash, randomUUID } from 'crypto';
import type {
  AvatarVideoStagedInput,
  GpuMediaAdminSubmitInput,
  GpuMediaCapabilities,
  GpuMediaDownloadResult,
  GpuMediaJobKind,
  GpuMediaJobView,
  GpuMediaMaterializeResult,
  VoiceRightsEvidence,
} from '../../shared/gpu-media-admin';
import { loadCoreModule } from '../utils/core-loader';

interface CoreGpuMediaClient {
  capabilities(): Promise<GpuMediaCapabilities>;
  submit(kind: GpuMediaJobKind, payload: unknown): Promise<GpuMediaJobView>;
  status(jobId: string): Promise<GpuMediaJobView>;
  cancel(jobId: string): Promise<GpuMediaJobView>;
  downloadArtifact(jobId: string, artifactName?: string): Promise<Uint8Array>;
  uploadAsset?(name: string, bytes: Uint8Array, mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'audio/wav'): Promise<{ path: string; bytes: number }>;
}

interface CoreGpuMediaModule {
  gpuMediaWorkerFromEnv(env?: NodeJS.ProcessEnv): CoreGpuMediaClient;
}

interface SaveRequest {
  defaultPath: string;
  filters: Array<{ name: string; extensions: string[] }>;
  data: Uint8Array | string;
}

export interface GpuMediaAdminBridgeDeps {
  client?: () => Promise<CoreGpuMediaClient>;
  save?: (request: SaveRequest) => Promise<string | null>;
  resolveAssetPath?: (id: string) => Promise<string>;
  synthesize?: (input: AvatarVideoStagedInput) => Promise<{ audio: ArrayBuffer; rights: VoiceRightsEvidence }>;
  activeRoot?: () => string;
}

async function loadClient(): Promise<CoreGpuMediaClient> {
  const module = await loadCoreModule<CoreGpuMediaModule>('tools/gpu-media-worker.js');
  if (!module) throw new Error('Le module GPU de Code Buddy est indisponible. Recompile le cœur.');
  return module.gpuMediaWorkerFromEnv(process.env);
}

async function saveResult(request: SaveRequest): Promise<string | null> {
  const selected = await dialog.showSaveDialog({
    title: 'Enregistrer le résultat GPU',
    defaultPath: request.defaultPath,
    filters: request.filters,
  });
  if (selected.canceled || !selected.filePath) return null;
  await writeFile(selected.filePath, request.data);
  return selected.filePath;
}

export class GpuMediaAdminBridge {
  private readonly clientFactory: () => Promise<CoreGpuMediaClient>;
  private readonly save: (request: SaveRequest) => Promise<string | null>;
  private clientPromise: Promise<CoreGpuMediaClient> | null = null;
  private readonly resolveAssetPath?: (id: string) => Promise<string>;
  private readonly synthesize?: (input: AvatarVideoStagedInput) => Promise<{ audio: ArrayBuffer; rights: VoiceRightsEvidence }>;
  private readonly activeRoot?: () => string;

  constructor(deps: GpuMediaAdminBridgeDeps = {}) {
    this.clientFactory = deps.client ?? loadClient;
    this.save = deps.save ?? saveResult;
    this.resolveAssetPath = deps.resolveAssetPath;
    this.synthesize = deps.synthesize;
    this.activeRoot = deps.activeRoot;
  }

  private client(): Promise<CoreGpuMediaClient> {
    this.clientPromise ??= this.clientFactory();
    return this.clientPromise;
  }

  async capabilities(): Promise<GpuMediaCapabilities> {
    return (await this.client()).capabilities();
  }

  async submit(input: GpuMediaAdminSubmitInput): Promise<GpuMediaJobView> {
    const client = await this.client();
    if (input.kind === 'panoworld_reconstruct') {
      return client.submit(input.kind, {
        sceneId: input.sceneId,
        profile: 'single-2048',
        panoramas: [{ imagePath: input.imagePath, roomId: input.roomId }],
        outputDir: input.outputDir,
      });
    }
    return client.submit(input.kind, {
      turnId: input.turnId,
      audioPath: input.audioPath,
      referenceImagePath: input.referenceImagePath,
      prompt: input.prompt,
      resolution: '480p',
    });
  }

  async status(jobId: string): Promise<GpuMediaJobView> {
    return (await this.client()).status(jobId);
  }

  async submitAvatar(input: AvatarVideoStagedInput): Promise<GpuMediaJobView> {
    if (!this.resolveAssetPath || !this.synthesize) throw new Error('Le staging LongCat n’est pas configuré.');
    if (!input || typeof input !== 'object' || !input.turnId?.trim() || !input.referenceAssetId?.trim()
      || !input.narration?.trim() || !input.prompt?.trim()) throw new Error('Demande d’avatar LongCat invalide.');
    const referencePath = await this.resolveAssetPath(input.referenceAssetId);
    const extension = extname(referencePath).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new Error('La référence LongCat doit être une image PNG, JPEG ou WebP.');
    const mediaType = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
    if (!input.locale?.trim() || !input.voiceProfileId?.trim()) throw new Error('Profil vocal et locale obligatoires pour LongCat.');
    const [imageBytes, voiceRender] = await Promise.all([readFile(referencePath), this.synthesize(input)]);
    if (imageBytes.length <= 0 || imageBytes.length > 20 * 1024 * 1024 || !isImage(imageBytes, extension)) {
      throw new Error('La référence LongCat ne correspond pas à son format image ou dépasse 20 Mo.');
    }
    assertVoiceRights(voiceRender.rights, input);
    const audioBytes = new Uint8Array(voiceRender.audio);
    if (!isWav(audioBytes)) throw new Error('La synthèse LongCat doit produire un fichier WAV valide.');
    const client = await this.client();
    if (!client.uploadAsset) throw new Error('Le client GPU doit être recompilé pour prendre en charge le staging LongCat.');
    const [image, voice] = await Promise.all([
      client.uploadAsset(`reference${extension === '.jpeg' ? '.jpg' : extension}`, imageBytes, mediaType),
      client.uploadAsset('voice.wav', audioBytes, 'audio/wav'),
    ]);
    const job = await client.submit('avatar_video_render', {
      turnId: input.turnId,
      audioPath: voice.path,
      referenceImagePath: image.path,
      prompt: input.prompt,
      resolution: '480p',
    });
    const root = this.activeRoot?.();
    if (!root) throw new Error('Aucun workspace actif pour le reçu de droits vocaux.');
    const receiptDirectory = await ensureConfinedMediaDirectory(root, 'job-receipts');
    const receiptPath = join(receiptDirectory, `${job.id}.voice-rights.json`);
    const temporary = `${receiptPath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({
      schemaVersion: 1,
      jobId: job.id,
      turnId: input.turnId,
      narrationRights: voiceRender.rights,
      createdAt: new Date().toISOString(),
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    try {
      await link(temporary, receiptPath);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    return job;
  }

  async cancel(jobId: string): Promise<GpuMediaJobView> {
    return (await this.client()).cancel(jobId);
  }

  async download(jobId: string): Promise<GpuMediaDownloadResult> {
    try {
      const client = await this.client();
      const job = await client.status(jobId);
      if (job.status !== 'succeeded') {
        return { ok: false, error: 'Le résultat GPU n’est pas encore disponible.' };
      }
      if (job.kind === 'avatar_video_render') {
        const bytes = await client.downloadArtifact(job.id, 'avatar.mp4');
        const path = await this.save({
          defaultPath: `avatar-${job.id}.mp4`,
          filters: [{ name: 'Vidéo MP4', extensions: ['mp4'] }],
          data: bytes,
        });
        return path ? { ok: true, path, format: 'mp4' } : { ok: false, cancelled: true };
      }
      const path = await this.save({
        defaultPath: `panoworld-${job.id}.json`,
        filters: [{ name: 'Manifeste JSON', extensions: ['json'] }],
        data: `${JSON.stringify(job.output ?? {}, null, 2)}\n`,
      });
      return path ? { ok: true, path, format: 'json' } : { ok: false, cancelled: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async materialize(jobId: string): Promise<GpuMediaMaterializeResult> {
    try {
      const client = await this.client();
      const job = await client.status(jobId);
      if (job.kind !== 'avatar_video_render' || job.status !== 'succeeded') {
        return { ok: false, error: 'Le rendu LongCat n’est pas terminé.' };
      }
      const root = this.activeRoot?.();
      if (!root) return { ok: false, error: 'Aucun workspace actif.' };
      const directory = await ensureConfinedMediaDirectory(root, 'videos');
      const receiptDirectory = await ensureConfinedMediaDirectory(root, 'job-receipts');
      const receipt = JSON.parse(await readFile(join(receiptDirectory, `${jobId}.voice-rights.json`), 'utf8')) as {
        narrationRights?: VoiceRightsEvidence;
      };
      if (!receipt.narrationRights) return { ok: false, error: 'Le reçu de droits vocaux LongCat est absent.' };
      const path = join(directory, `longcat-avatar-${randomUUID()}.mp4`);
      const bytes = await client.downloadArtifact(jobId, 'avatar.mp4');
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
      const rightsPath = `${path}.voice-rights.json`;
      await writeFile(rightsPath, `${JSON.stringify({
        schemaVersion: 1,
        videoSha256: createHash('sha256').update(bytes).digest('hex'),
        narrationRights: receipt.narrationRights,
      }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      return { ok: true, path, url: pathToFileURL(path).href, rightsPath, narrationRights: receipt.narrationRights };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

function isWav(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 44) return false;
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  return text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE';
}

function isImage(bytes: Uint8Array, extension: string): boolean {
  if (extension === '.png') return Buffer.from(bytes.slice(0, 8)).toString('hex') === '89504e470d0a1a0a';
  if (extension === '.jpg' || extension === '.jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  return Buffer.from(bytes.slice(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.slice(8, 12)).toString('ascii') === 'WEBP';
}

async function ensureConfinedMediaDirectory(root: string, leaf: 'videos' | 'job-receipts'): Promise<string> {
  if (!isAbsolute(root) || root.includes('\0')) throw new Error('Workspace média invalide.');
  await mkdir(root, { recursive: true });
  const canonicalRoot = await realpath(root);
  let cursor = canonicalRoot;
  for (const segment of ['.codebuddy', 'media-generation', leaf]) {
    cursor = join(cursor, segment);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Le dossier LongCat contient un lien symbolique.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(cursor, { mode: 0o700 });
    }
    const canonical = await realpath(cursor);
    const child = relative(resolve(canonicalRoot), resolve(canonical));
    if (child.startsWith('..') || isAbsolute(child)) throw new Error('Le dossier LongCat sort du workspace actif.');
  }
  return realpath(cursor);
}

function assertVoiceRights(rights: VoiceRightsEvidence, input: AvatarVideoStagedInput): void {
  if (
    !rights || rights.commercialUseApproved !== true || rights.voiceProfileId !== input.voiceProfileId ||
    rights.locale !== input.locale || !['pocket', 'piper'].includes(rights.provider) ||
    !rights.provenanceRef?.trim() || !/^[a-f0-9]{64}$/u.test(rights.profileRevision) ||
    !/^[a-f0-9]{64}$/u.test(rights.registryRevision) || !/^[a-f0-9]{64}$/u.test(rights.evidenceSha256)
  ) throw new Error('La preuve de droits vocaux ne correspond pas à la demande LongCat.');
}
