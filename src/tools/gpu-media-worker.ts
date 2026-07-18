/**
 * Client for heavyweight media/world-model workers (PanoWorld, LongCat).
 *
 * The model runtimes stay outside the Node/Electron process. A Darkstar worker
 * exposes this small authenticated HTTP protocol and owns CUDA, queueing and
 * output files. Code Buddy only validates contracts and submits bounded jobs.
 */

export type GpuMediaJobKind = 'panoworld_reconstruct' | 'avatar_video_render';
export type GpuMediaJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface GpuMediaWorkerConfig {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
}

export interface GpuMediaWorkerCapabilities {
  protocolVersion: 1;
  workerId: string;
  jobs: GpuMediaJobKind[];
  gpus?: Array<{ name: string; vramMb: number; busy: boolean }>;
  queueDepth?: number;
  activeJobs?: number;
  availableSlots?: number;
  runnerRevisions?: Partial<Record<GpuMediaJobKind, string>>;
}

export interface GpuMediaJobView {
  id: string;
  kind: GpuMediaJobKind;
  status: GpuMediaJobStatus;
  progress?: number;
  progressMessage?: string;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  output?: Record<string, unknown>;
  error?: string;
  requestHash?: string;
  runnerRevision?: string;
  attempt?: number;
  retryOf?: string;
}

export interface PanoWorldPayload {
  sceneId: string;
  panoramas: Array<{
    imagePath: string;
    roomId: string;
    cameraToWorld?: number[];
  }>;
  profile: 'single-2048' | 'multi-1024';
  outputDir: string;
}

export interface AvatarVideoPayload {
  turnId: string;
  audioPath: string;
  referenceImagePath: string;
  audioSha256?: string;
  referenceImageSha256?: string;
  prompt: string;
  resolution: '480p';
  channelTarget?: {
    channel: string;
    conversationId: string;
    threadId?: string;
  };
}

export interface GpuMediaWorkerDeps {
  fetch?: typeof fetch;
}

export interface GpuMediaUploadedAsset {
  path: string;
  bytes: number;
}

const JOB_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const DEFAULT_TIMEOUT_MS = 15_000;
const ARTIFACT_LIMIT = 512 * 1024 * 1024;

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [first = -1, second = -1] = parts;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

/** HTTP is accepted only on loopback/private/Tailscale endpoints. */
export function validateGpuWorkerUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('CODEBUDDY_GPU_WORKER_URL is not a valid URL');
  }
  if (url.username || url.password) throw new Error('GPU worker URL must not contain credentials');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('GPU worker URL must use http or https');
  }
  if (
    url.protocol === 'http:' &&
    url.hostname !== 'localhost' &&
    url.hostname !== '::1' &&
    !isPrivateIpv4(url.hostname) &&
    !url.hostname.endsWith('.ts.net')
  ) {
    throw new Error('Unencrypted GPU worker URL must be loopback, private, or Tailscale');
  }
  url.pathname = url.pathname.replace(/\/+$/u, '');
  url.search = '';
  url.hash = '';
  return url;
}

function requiredText(value: unknown, name: string, maxLength = 4_096): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  const result = value.trim();
  if (result.length > maxLength) throw new Error(`${name} is too long`);
  if (hasControlCharacters(result)) throw new Error(`${name} contains control characters`);
  return result;
}

function optionalMatrix(value: unknown, name: string): number[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length !== 16 ||
    value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
  ) {
    throw new Error(`${name} must contain 16 finite numbers`);
  }
  return value as number[];
}

export function parsePanoWorldPayload(value: unknown): PanoWorldPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('payload must be an object');
  }
  const input = value as Record<string, unknown>;
  const profile = input.profile;
  if (profile !== 'single-2048' && profile !== 'multi-1024') {
    throw new Error('profile must be single-2048 or multi-1024');
  }
  if (!Array.isArray(input.panoramas) || input.panoramas.length === 0) {
    throw new Error('panoramas must contain at least one view');
  }
  const maximum = profile === 'single-2048' ? 1 : 5;
  if (input.panoramas.length > maximum) {
    throw new Error(`${profile} accepts at most ${maximum} panorama(s)`);
  }
  const panoramas = input.panoramas.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`panoramas[${index}] must be an object`);
    }
    const panorama = raw as Record<string, unknown>;
    const cameraToWorld = optionalMatrix(
      panorama.camera_to_world ?? panorama.cameraToWorld,
      `panoramas[${index}].camera_to_world`
    );
    return {
      imagePath: requiredText(
        panorama.image_path ?? panorama.imagePath,
        `panoramas[${index}].image_path`
      ),
      roomId: requiredText(panorama.room_id ?? panorama.roomId, `panoramas[${index}].room_id`, 128),
      ...(cameraToWorld ? { cameraToWorld } : {}),
    };
  });
  return {
    sceneId: requiredText(input.scene_id ?? input.sceneId, 'scene_id', 128),
    panoramas,
    profile,
    outputDir: requiredText(input.output_dir ?? input.outputDir, 'output_dir'),
  };
}

export function parseAvatarVideoPayload(value: unknown): AvatarVideoPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('payload must be an object');
  }
  const input = value as Record<string, unknown>;
  if (input.resolution !== undefined && input.resolution !== '480p') {
    throw new Error('Only the measured 480p profile is enabled for Darkstar');
  }
  let channelTarget: AvatarVideoPayload['channelTarget'];
  const rawChannelTarget = input.channel_target ?? input.channelTarget;
  if (rawChannelTarget !== undefined) {
    if (
      !rawChannelTarget ||
      typeof rawChannelTarget !== 'object' ||
      Array.isArray(rawChannelTarget)
    ) {
      throw new Error('channel_target must be an object');
    }
    const target = rawChannelTarget as Record<string, unknown>;
    const threadId =
      typeof target.thread_id === 'string' && target.thread_id.trim()
        ? requiredText(target.thread_id, 'channel_target.thread_id', 256)
        : undefined;
    channelTarget = {
      channel: requiredText(target.channel, 'channel_target.channel', 64),
      conversationId: requiredText(
        target.conversation_id ?? target.conversationId,
        'channel_target.conversation_id',
        256
      ),
      ...(threadId ? { threadId } : {}),
    };
  }
  const audioSha256 = input.audio_sha256 ?? input.audioSha256;
  const referenceImageSha256 = input.reference_image_sha256 ?? input.referenceImageSha256;
  if (audioSha256 !== undefined && (typeof audioSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(audioSha256))) {
    throw new Error('audio_sha256 must be a lowercase SHA-256 digest');
  }
  if (
    referenceImageSha256 !== undefined &&
    (typeof referenceImageSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(referenceImageSha256))
  ) {
    throw new Error('reference_image_sha256 must be a lowercase SHA-256 digest');
  }
  if ((audioSha256 === undefined) !== (referenceImageSha256 === undefined)) {
    throw new Error('audio and reference image SHA-256 digests must be supplied together');
  }
  return {
    turnId: requiredText(input.turn_id ?? input.turnId, 'turn_id', 128),
    audioPath: requiredText(input.audio_path ?? input.audioPath, 'audio_path'),
    referenceImagePath: requiredText(
      input.reference_image_path ?? input.referenceImagePath,
      'reference_image_path'
    ),
    ...(typeof audioSha256 === 'string' ? { audioSha256 } : {}),
    ...(typeof referenceImageSha256 === 'string' ? { referenceImageSha256 } : {}),
    prompt: requiredText(input.prompt, 'prompt', 8_000),
    resolution: '480p',
    ...(channelTarget ? { channelTarget } : {}),
  };
}

function parseObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`GPU worker returned an invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function parseJob(value: unknown): GpuMediaJobView {
  const data = parseObject(value, 'job');
  const id = requiredText(data.id, 'worker job id', 128);
  if (!JOB_ID_PATTERN.test(id)) throw new Error('GPU worker returned an invalid job id');
  if (data.kind !== 'panoworld_reconstruct' && data.kind !== 'avatar_video_render') {
    throw new Error('GPU worker returned an invalid job kind');
  }
  const statuses: GpuMediaJobStatus[] = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];
  if (!statuses.includes(data.status as GpuMediaJobStatus)) {
    throw new Error('GPU worker returned an invalid job status');
  }
  return data as unknown as GpuMediaJobView;
}

export class GpuMediaWorkerClient {
  private readonly baseUrl: URL;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: GpuMediaWorkerConfig,
    deps: GpuMediaWorkerDeps = {}
  ) {
    this.baseUrl = validateGpuWorkerUrl(config.baseUrl);
    this.fetchFn = deps.fetch ?? fetch;
    this.timeoutMs = Math.max(1_000, Math.min(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, 120_000));
  }

  private async request(pathname: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const basePath = this.baseUrl.pathname === '/' ? '' : this.baseUrl.pathname;
      const response = await this.fetchFn(new URL(`${basePath}${pathname}`, this.baseUrl), {
        ...init,
        headers: {
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(this.config.token ? { authorization: `Bearer ${this.config.token}` } : {}),
          ...init.headers,
        },
        signal: controller.signal,
      });
      const text = await response.text();
      const data = text ? (JSON.parse(text) as unknown) : {};
      if (!response.ok) {
        const object = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
        const message = typeof object.error === 'string' ? object.error : `HTTP ${response.status}`;
        throw new Error(`GPU worker request failed: ${message}`);
      }
      return data;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`GPU worker request timed out after ${this.timeoutMs} ms`);
      }
      if (error instanceof SyntaxError) throw new Error('GPU worker returned invalid JSON');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async capabilities(): Promise<GpuMediaWorkerCapabilities> {
    const data = parseObject(await this.request('/v1/capabilities'), 'capabilities');
    if (data.protocolVersion !== 1) {
      throw new Error('GPU worker protocol version is not supported');
    }
    if (!Array.isArray(data.jobs)) throw new Error('GPU worker capabilities are missing jobs');
    return data as unknown as GpuMediaWorkerCapabilities;
  }

  async submit(
    kind: GpuMediaJobKind,
    rawPayload: unknown,
    options: { retryTerminal?: boolean } = {},
  ): Promise<GpuMediaJobView> {
    const payload =
      kind === 'panoworld_reconstruct'
        ? parsePanoWorldPayload(rawPayload)
        : parseAvatarVideoPayload(rawPayload);
    return parseJob(
      await this.request('/v1/jobs', {
        method: 'POST',
        body: JSON.stringify({ kind, payload, retryTerminal: options.retryTerminal === true }),
      })
    );
  }

  async uploadAsset(name: string, bytes: Uint8Array, mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'audio/wav'): Promise<GpuMediaUploadedAsset> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/u.test(name)) throw new Error('asset_name is invalid');
    if (!(bytes instanceof Uint8Array) || bytes.byteLength <= 0 || bytes.byteLength > 64 * 1024 * 1024) {
      throw new Error('asset must contain at most 64 MiB');
    }
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    const data = parseObject(await this.request(`/v1/assets?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': mediaType, 'content-length': String(bytes.byteLength) },
      body: new Blob([body], { type: mediaType }),
    }), 'uploaded asset');
    return {
      path: requiredText(data.path, 'uploaded asset path'),
      bytes: typeof data.bytes === 'number' ? data.bytes : bytes.byteLength,
    };
  }

  async status(jobId: string): Promise<GpuMediaJobView> {
    const id = requiredText(jobId, 'job_id', 128);
    if (!JOB_ID_PATTERN.test(id)) throw new Error('job_id contains invalid characters');
    return parseJob(await this.request(`/v1/jobs/${encodeURIComponent(id)}`));
  }

  async cancel(jobId: string): Promise<GpuMediaJobView> {
    const id = requiredText(jobId, 'job_id', 128);
    if (!JOB_ID_PATTERN.test(id)) throw new Error('job_id contains invalid characters');
    return parseJob(await this.request(`/v1/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }));
  }

  async downloadArtifact(jobId: string, artifactName = 'avatar.mp4'): Promise<Uint8Array> {
    const id = requiredText(jobId, 'job_id', 128);
    if (!JOB_ID_PATTERN.test(id)) throw new Error('job_id contains invalid characters');
    if (artifactName !== 'avatar.mp4') throw new Error('artifact_name must be avatar.mp4');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const basePath = this.baseUrl.pathname === '/' ? '' : this.baseUrl.pathname;
      const pathname = `${basePath}/v1/jobs/${encodeURIComponent(id)}/artifacts/avatar.mp4`;
      const response = await this.fetchFn(new URL(pathname, this.baseUrl), {
        headers: {
          accept: 'video/mp4',
          ...(this.config.token ? { authorization: `Bearer ${this.config.token}` } : {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const data = (await response.json()) as unknown;
          const workerError =
            data && typeof data === 'object'
              ? (data as Record<string, unknown>).error
              : undefined;
          if (typeof workerError === 'string') {
            message = workerError;
          }
        } catch {
          // Keep the bounded HTTP status fallback for a non-JSON proxy response.
        }
        throw new Error(`GPU worker artifact request failed: ${message}`);
      }
      const declaredSize = Number(response.headers.get('content-length'));
      if (
        !Number.isInteger(declaredSize) ||
        declaredSize <= 0 ||
        declaredSize > ARTIFACT_LIMIT
      ) {
        throw new Error('GPU worker artifact has an invalid content length');
      }
      if (!response.body) throw new Error('GPU worker artifact response has no body');
      const bytes = new Uint8Array(declaredSize);
      const reader = response.body.getReader();
      let offset = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (offset + chunk.value.byteLength > declaredSize) {
          await reader.cancel();
          throw new Error('GPU worker artifact exceeds its declared content length');
        }
        bytes.set(chunk.value, offset);
        offset += chunk.value.byteLength;
      }
      if (offset !== declaredSize) {
        throw new Error('GPU worker artifact length does not match the response');
      }
      return bytes;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`GPU worker artifact request timed out after ${this.timeoutMs} ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function gpuMediaWorkerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  deps: GpuMediaWorkerDeps = {}
): GpuMediaWorkerClient {
  const baseUrl = env.CODEBUDDY_GPU_WORKER_URL?.trim();
  if (!baseUrl) {
    throw new Error('CODEBUDDY_GPU_WORKER_URL is not configured');
  }
  return new GpuMediaWorkerClient(
    {
      baseUrl,
      ...(env.CODEBUDDY_GPU_WORKER_TOKEN ? { token: env.CODEBUDDY_GPU_WORKER_TOKEN } : {}),
    },
    deps
  );
}
