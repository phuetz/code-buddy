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
  workerId: string;
  jobs: GpuMediaJobKind[];
  gpus?: Array<{ name: string; vramMb: number; busy: boolean }>;
  queueDepth?: number;
}

export interface GpuMediaJobView {
  id: string;
  kind: GpuMediaJobKind;
  status: GpuMediaJobStatus;
  progress?: number;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  output?: Record<string, unknown>;
  error?: string;
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

const JOB_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const DEFAULT_TIMEOUT_MS = 15_000;

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
  const maximum = profile === 'single-2048' ? 1 : 6;
  if (input.panoramas.length > maximum) {
    throw new Error(`${profile} accepts at most ${maximum} panorama(s)`);
  }
  const panoramas = input.panoramas.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`panoramas[${index}] must be an object`);
    }
    const panorama = raw as Record<string, unknown>;
    const cameraToWorld = optionalMatrix(
      panorama.camera_to_world,
      `panoramas[${index}].camera_to_world`
    );
    return {
      imagePath: requiredText(panorama.image_path, `panoramas[${index}].image_path`),
      roomId: requiredText(panorama.room_id, `panoramas[${index}].room_id`, 128),
      ...(cameraToWorld ? { cameraToWorld } : {}),
    };
  });
  return {
    sceneId: requiredText(input.scene_id, 'scene_id', 128),
    panoramas,
    profile,
    outputDir: requiredText(input.output_dir, 'output_dir'),
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
  if (input.channel_target !== undefined) {
    if (
      !input.channel_target ||
      typeof input.channel_target !== 'object' ||
      Array.isArray(input.channel_target)
    ) {
      throw new Error('channel_target must be an object');
    }
    const target = input.channel_target as Record<string, unknown>;
    const threadId =
      typeof target.thread_id === 'string' && target.thread_id.trim()
        ? requiredText(target.thread_id, 'channel_target.thread_id', 256)
        : undefined;
    channelTarget = {
      channel: requiredText(target.channel, 'channel_target.channel', 64),
      conversationId: requiredText(target.conversation_id, 'channel_target.conversation_id', 256),
      ...(threadId ? { threadId } : {}),
    };
  }
  return {
    turnId: requiredText(input.turn_id, 'turn_id', 128),
    audioPath: requiredText(input.audio_path, 'audio_path'),
    referenceImagePath: requiredText(input.reference_image_path, 'reference_image_path'),
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
      const response = await this.fetchFn(
        new URL(`${this.baseUrl.pathname}${pathname}`, this.baseUrl),
        {
          ...init,
          headers: {
            accept: 'application/json',
            ...(init.body ? { 'content-type': 'application/json' } : {}),
            ...(this.config.token ? { authorization: `Bearer ${this.config.token}` } : {}),
            ...init.headers,
          },
          signal: controller.signal,
        }
      );
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
    if (!Array.isArray(data.jobs)) throw new Error('GPU worker capabilities are missing jobs');
    return data as unknown as GpuMediaWorkerCapabilities;
  }

  async submit(kind: GpuMediaJobKind, rawPayload: unknown): Promise<GpuMediaJobView> {
    const payload =
      kind === 'panoworld_reconstruct'
        ? parsePanoWorldPayload(rawPayload)
        : parseAvatarVideoPayload(rawPayload);
    return parseJob(
      await this.request('/v1/jobs', {
        method: 'POST',
        body: JSON.stringify({ kind, payload }),
      })
    );
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
