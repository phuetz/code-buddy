import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { checkSecretFileAccess, formatSecretRefusal } from '../security/secret-files.js';

import type { MediaGenerationRuntime } from './media-generation-tool.js';

export interface VideoAnalyzeInput {
  videoUrl: string;
  question: string;
}

export interface VideoAnalyzeResult {
  success: boolean;
  analysis: string;
  kind: 'video_analyze_result';
  videoSource: string;
  question: string;
  model: string;
  generatedAt: string;
  videoSizeBytes: number;
  mimeType: string;
  error?: string;
  error_type?: string;
}

const VIDEO_MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
};

const MAX_VIDEO_BASE64_BYTES = 50 * 1024 * 1024;

export async function analyzeVideoWithModel(
  input: VideoAnalyzeInput,
  runtime: MediaGenerationRuntime = {},
): Promise<VideoAnalyzeResult> {
  const videoSource = input.videoUrl.trim();
  const question = input.question.trim();
  if (!videoSource) {
    throw new Error('video_url is required');
  }
  if (!question) {
    throw new Error('question is required');
  }

  const fetchImpl = runtime.fetch ?? fetch;
  const rootDir = path.resolve(runtime.rootDir ?? process.cwd());
  const prepared = await prepareVideo(videoSource, {
    rootDir,
    fetchImpl,
    createId: runtime.createId,
  });
  const dataUrl = await videoToBase64DataUrl(prepared.path, prepared.mimeType);

  const config = resolveVideoAnalysisConfig(runtime.env ?? process.env);
  const prompt = [
    'Fully describe and explain everything happening in this video, including visual content, motion, audio cues, text overlays, and scene transitions.',
    '',
    'Then answer the following question:',
    '',
    question,
  ].join('\n');
  const response = await postChatCompletion(fetchImpl, config, prompt, dataUrl);
  const analysis = extractAssistantText(response);
  if (!analysis) {
    throw new Error('Video-capable model returned an empty response');
  }

  return {
    success: true,
    analysis,
    kind: 'video_analyze_result',
    videoSource,
    question,
    model: config.model,
    generatedAt: (runtime.now ?? (() => new Date()))().toISOString(),
    videoSizeBytes: prepared.sizeBytes,
    mimeType: prepared.mimeType,
  };
}

async function prepareVideo(
  videoSource: string,
  options: { rootDir: string; fetchImpl: typeof fetch; createId?: () => string },
): Promise<{ path: string; mimeType: string; sizeBytes: number }> {
  if (/^https?:\/\//i.test(videoSource)) {
    const response = await fetchWithTimeout(options.fetchImpl, videoSource, {
      headers: { Accept: 'video/*,*/*;q=0.8' },
    }, 60_000);
    if (!response.ok) {
      throw new Error(`Video download failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length <= 0) {
      throw new Error('Downloaded video was empty');
    }
    if (bytes.length > MAX_VIDEO_BASE64_BYTES) {
      throw new Error(`Video too large (${bytes.length} bytes, max ${MAX_VIDEO_BASE64_BYTES})`);
    }
    const mimeType = detectMimeFromContentType(response.headers.get('content-type')) ?? 'video/mp4';
    const ext = extensionForMime(mimeType);
    const cacheDir = path.join(options.rootDir, '.codebuddy', 'video-analysis');
    await fs.mkdir(cacheDir, { recursive: true });
    const localPath = path.join(cacheDir, `video-${sanitizeId(options.createId?.() ?? randomUUID())}.${ext}`);
    await fs.writeFile(localPath, bytes);
    return { path: localPath, mimeType, sizeBytes: bytes.length };
  }

  const stripped = videoSource.startsWith('file://') ? videoSource.slice('file://'.length) : videoSource;
  const localPath = path.isAbsolute(stripped) ? path.resolve(stripped) : path.resolve(options.rootDir, stripped);
  refuseSecretVideo(localPath);
  const stat = await fs.stat(localPath);
  const mimeType = detectVideoMimeType(localPath);
  if (!mimeType) {
    throw new Error(`Unsupported video format: ${path.extname(localPath)}. Supported: ${Object.keys(VIDEO_MIME_TYPES).join(', ')}`);
  }
  if (stat.size > MAX_VIDEO_BASE64_BYTES) {
    throw new Error(`Video too large (${stat.size} bytes, max ${MAX_VIDEO_BASE64_BYTES})`);
  }
  return { path: localPath, mimeType, sizeBytes: stat.size };
}

function detectVideoMimeType(videoPath: string): string | undefined {
  return VIDEO_MIME_TYPES[path.extname(videoPath).toLowerCase()];
}

async function videoToBase64DataUrl(videoPath: string, mimeType: string): Promise<string> {
  refuseSecretVideo(videoPath);
  const bytes = await fs.readFile(videoPath);
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

function refuseSecretVideo(videoPath: string): void {
  const verdict = checkSecretFileAccess(videoPath, 'read');
  if (verdict.secret) throw new Error(formatSecretRefusal(videoPath, verdict));
}

function resolveVideoAnalysisConfig(env: NodeJS.ProcessEnv): { baseUrl: string; apiKey: string; model: string } {
  const baseUrl = (env.CODEBUDDY_VIDEO_ANALYSIS_BASE_URL
    ?? env.OPENAI_BASE_URL
    ?? 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  const apiKey = (env.CODEBUDDY_VIDEO_ANALYSIS_API_KEY ?? env.OPENAI_API_KEY ?? '').trim();
  const model = (env.CODEBUDDY_VIDEO_ANALYSIS_MODEL
    ?? env.AUXILIARY_VIDEO_MODEL
    ?? env.AUXILIARY_VISION_MODEL
    ?? 'gpt-4o-mini').trim();
  if (!apiKey && !isLocalBaseUrl(baseUrl)) {
    throw new Error('No video analysis credentials configured. Set CODEBUDDY_VIDEO_ANALYSIS_API_KEY or OPENAI_API_KEY.');
  }
  return { baseUrl, apiKey, model };
}

async function postChatCompletion(
  fetchImpl: typeof fetch,
  config: { baseUrl: string; apiKey: string; model: string },
  prompt: string,
  videoDataUrl: string,
): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(fetchImpl, joinUrl(config.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'video_url', video_url: { url: videoDataUrl } },
          ],
        },
      ],
    }),
  }, 180_000);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Video analysis API returned ${response.status}: ${text.slice(0, 500)}`);
  }
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Video analysis API returned non-object JSON');
  }
  return parsed as Record<string, unknown>;
}

function extractAssistantText(response: Record<string, unknown>): string | undefined {
  const choices = response.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  const first = choices[0];
  if (!first || typeof first !== 'object') {
    return undefined;
  }
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') {
    return undefined;
  }
  const content = (message as Record<string, unknown>).content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => part && typeof part === 'object' ? (part as Record<string, unknown>).text : undefined)
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
    return parts.join('\n').trim() || undefined;
  }
  return undefined;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function detectMimeFromContentType(contentType: string | null): string | undefined {
  const type = (contentType ?? '').split(';', 1)[0]?.trim().toLowerCase();
  return type && type.startsWith('video/') ? type : undefined;
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'video/webm') return 'webm';
  if (mimeType === 'video/quicktime' || mimeType === 'video/mov') return 'mov';
  if (mimeType === 'video/mpeg') return 'mpeg';
  return 'mp4';
}

function joinUrl(baseUrl: string, suffix: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedSuffix = suffix.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedSuffix}`;
}

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function sanitizeId(id: string): string {
  const sanitized = id.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || randomUUID();
}
