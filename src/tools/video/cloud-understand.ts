import { getToolWorkingDirectory } from '../../utils/tool-execution-context.js';
/**
 * Phase 3 — cloud video understanding via Gemini (OPT-IN, never default).
 *
 * Gemini 2.5 understands a video's audio AND visual track jointly and answers with
 * timestamps. It accepts a **YouTube URL directly** (as a `fileData.fileUri` part) or a
 * local file **inlined as base64** (`inlineData`) — so we never re-encode, we hand Gemini
 * the URL or the raw bytes. This is the config-driven, env-gated cascade tail:
 *   captions → yt-dlp+Whisper → (--visual) frames → (--cloud, opt-in) Gemini.
 *
 * PRIVACY: this path SENDS the video / URL to Google. It runs ONLY when the caller sets
 * `cloud: true` (or the dedicated env). Every result carries an explicit privacy warning.
 *
 * NEVER THROWS. A missing key, an unreachable API, a quota error, an oversized file — all
 * return a soft `{ ok: false, reason }` so the orchestrator degrades cleanly to the local
 * transcript. The Gemini HTTP call is injectable (`callGemini`) so the request-building
 * (source-kind detection, parts) is unit-testable without any real network call.
 *
 * We deliberately do NOT reuse the legacy `video_analyze` (byte-dump, non-standard
 * `video_url`, dubious model support) — this is a fresh, native `generateContent` call
 * against `generativelanguage.googleapis.com`, mirroring `GeminiNativeProvider`.
 *
 * @module tools/video/cloud-understand
 */

import { readFile as realReadFile } from 'fs/promises';
import { existsSync as realExistsSync } from 'fs';
import { isAbsolute, resolve as resolvePath, extname } from 'path';
import { logger } from '../../utils/logger.js';
import { checkSecretFileAccess, formatSecretRefusal } from '../../security/secret-files.js';
import { isYoutubeUrl } from './youtube-captions.js';

/** Explicit privacy warning attached to every cloud result — the video went to Google. */
export const CLOUD_PRIVACY_WARNING =
  "⚠️ Compréhension vidéo CLOUD (Gemini) : la vidéo/URL a été envoyée à Google. " +
  'À réserver aux vidéos PUBLIQUES et NON SENSIBLES.';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TIMEOUT_MS = 120_000;
/** Inline base64 cap (~20 MB request limit on generateContent). Larger → degrade honestly. */
const DEFAULT_MAX_INLINE_BYTES = 20 * 1024 * 1024;

export type CloudSourceKind = 'youtube' | 'url' | 'file-inline';

/** One Gemini `contents[].parts[]` entry (the subset we emit). */
export interface GeminiPart {
  text?: string;
  fileData?: { fileUri: string; mimeType?: string };
  inlineData?: { mimeType: string; data: string };
}

export interface GeminiVideoRequest {
  parts: GeminiPart[];
  model: string;
  question?: string;
  sourceKind: CloudSourceKind;
}

/** Context handed to the (injectable) Gemini caller — the resolved config + transport. */
export interface GeminiCallContext {
  apiKey: string;
  baseUrl: string;
  fetch: typeof fetch;
  timeoutMs: number;
}

/** The injectable Gemini HTTP boundary. Returns the answer text; throws on API error. */
export type GeminiVideoCaller = (req: GeminiVideoRequest, ctx: GeminiCallContext) => Promise<string>;

export interface CloudVideoAnswer {
  answer: string;
  model: string;
  provider: 'gemini';
  sourceKind: CloudSourceKind;
  /** Privacy warning — the video/URL was sent to Google. */
  warning: string;
}

export type CloudUnderstandOutcome =
  | { ok: true; result: CloudVideoAnswer }
  | { ok: false; reason: string };

export interface CloudUnderstandDeps {
  /** Env source for config resolution (default `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Transport (default global `fetch`). */
  fetch?: typeof fetch;
  /** Injectable Gemini call — bypasses HTTP entirely in tests. */
  callGemini?: GeminiVideoCaller;
  /** Local-file reader (default `fs/promises.readFile`). */
  readFile?: (path: string) => Promise<Buffer>;
  /** Existence check (default `fs.existsSync`). */
  existsSync?: (path: string) => boolean;
  /** Base for relative local paths (default `process.cwd()`). */
  cwd?: string;
  /** Per-call timeout in ms (default 120000). */
  timeoutMs?: number;
  /** Max bytes for the inline base64 path (default ~20 MB). */
  maxInlineBytes?: number;
}

interface CloudConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** Resolve the Gemini config from env, config-driven like `media-generation-tool.ts`.
 *  Returns `null` (no throw) when no API key is available → clean degradation. */
function resolveCloudConfig(env: NodeJS.ProcessEnv): CloudConfig | null {
  const apiKey = (
    env.CODEBUDDY_VIDEO_CLOUD_API_KEY ??
    env.GEMINI_API_KEY ??
    env.GOOGLE_API_KEY ??
    ''
  ).trim();
  if (!apiKey) return null;
  const baseUrl = (env.CODEBUDDY_VIDEO_CLOUD_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const model = (env.CODEBUDDY_VIDEO_CLOUD_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}

/** Best-effort MIME type from a file/URL extension (default video/mp4). */
function mimeFromPath(p: string): string {
  const ext = extname(p.split(/[?#]/)[0] ?? p).toLowerCase();
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mpeg': 'video/mpeg',
    '.mpg': 'video/mpeg',
    '.m4v': 'video/mp4',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mp3',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
  };
  return map[ext] ?? 'video/mp4';
}

/** Build the timestamped-answer prompt (French, matching the local pipeline's voice). */
function buildPrompt(question?: string): string {
  const q = question?.trim();
  if (q) {
    return (
      "Réponds à cette question sur la vidéo en t'appuyant sur son AUDIO et son VISUEL, " +
      `et cite des horodatages (timestamps) précis quand c'est pertinent : ${q}`
    );
  }
  return (
    'Résume cette vidéo de façon structurée en français : ' +
    "d'abord un TL;DR en 2-3 phrases, puis les MOMENTS CLÉS horodatés (heure:minute:seconde) " +
    "couvrant à la fois ce qui est DIT et ce qui est MONTRÉ à l'écran."
  );
}

/** Resolve the source to Gemini media parts. Returns a soft failure for anything we can't send. */
async function buildMediaPart(
  source: string,
  deps: CloudUnderstandDeps,
): Promise<{ part: GeminiPart; kind: CloudSourceKind } | { reason: string }> {
  // YouTube URL → fileData.fileUri (Gemini fetches it natively).
  if (isYoutubeUrl(source)) {
    return { part: { fileData: { fileUri: source } }, kind: 'youtube' };
  }

  // Local file → inline base64 (never re-encode; bounded so we stay within the request limit).
  const existsSync = deps.existsSync ?? realExistsSync;
  const localPath = isAbsolute(source) ? source : resolvePath(deps.cwd ?? getToolWorkingDirectory(), source);
  if (existsSync(source) || existsSync(localPath)) {
    const filePath = existsSync(source) ? source : localPath;
    const secret = checkSecretFileAccess(filePath, 'read');
    if (secret.secret) return { reason: formatSecretRefusal(filePath, secret) };
    const readFile = deps.readFile ?? realReadFile;
    const maxBytes = deps.maxInlineBytes ?? DEFAULT_MAX_INLINE_BYTES;
    let bytes: Buffer;
    try {
      bytes = await readFile(filePath);
    } catch (err) {
      return { reason: `lecture du fichier impossible (${err instanceof Error ? err.message : String(err)})` };
    }
    if (bytes.length === 0) return { reason: 'fichier vide' };
    if (bytes.length > maxBytes) {
      return {
        reason:
          `fichier trop volumineux pour l'inline cloud (${Math.round(bytes.length / 1024 / 1024)} Mo > ` +
          `${Math.round(maxBytes / 1024 / 1024)} Mo ; l'upload via Files API est hors périmètre)`,
      };
    }
    return {
      part: { inlineData: { mimeType: mimeFromPath(filePath), data: bytes.toString('base64') } },
      kind: 'file-inline',
    };
  }

  // Direct http(s) URL → fileData.fileUri with a best-effort MIME (Gemini may or may not fetch it).
  if (/^https?:\/\//i.test(source)) {
    return { part: { fileData: { fileUri: source, mimeType: mimeFromPath(source) } }, kind: 'url' };
  }

  return { reason: `source cloud introuvable (ni YouTube, ni fichier local, ni URL) : ${source}` };
}

/** Default Gemini HTTP call — native `generateContent`, mirroring GeminiNativeProvider. */
async function defaultCallGemini(req: GeminiVideoRequest, ctx: GeminiCallContext): Promise<string> {
  const url = `${ctx.baseUrl}/models/${encodeURIComponent(req.model)}:generateContent`;
  const body = { contents: [{ role: 'user', parts: req.parts }] };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ctx.timeoutMs);
  try {
    const res = await ctx.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ctx.apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const answer = parts
      .map((p) => p.text ?? '')
      .join('')
      .trim();
    if (!answer) throw new Error('Gemini a renvoyé une réponse vide');
    return answer;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Understand a video via Gemini (opt-in cloud). Never throws — every failure path returns a
 * soft `{ ok: false, reason }` for clean degradation to the local transcript.
 */
export async function understandVideoCloud(
  source: string,
  question: string | undefined,
  deps: CloudUnderstandDeps = {},
): Promise<CloudUnderstandOutcome> {
  try {
    const src = source?.trim();
    if (!src) return { ok: false, reason: 'source vide' };

    const env = deps.env ?? process.env;
    const config = resolveCloudConfig(env);
    if (!config) {
      return {
        ok: false,
        reason: 'aucune clé API Gemini (GEMINI_API_KEY / CODEBUDDY_VIDEO_CLOUD_API_KEY)',
      };
    }

    const media = await buildMediaPart(src, deps);
    if ('reason' in media) return { ok: false, reason: media.reason };

    const parts: GeminiPart[] = [media.part, { text: buildPrompt(question) }];
    const request: GeminiVideoRequest = {
      parts,
      model: config.model,
      ...(question ? { question } : {}),
      sourceKind: media.kind,
    };

    const call = deps.callGemini ?? defaultCallGemini;
    const ctx: GeminiCallContext = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      fetch: deps.fetch ?? fetch,
      timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };

    let answer: string;
    try {
      answer = (await call(request, ctx))?.trim() ?? '';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[video] cloud (Gemini) call failed: ${message}`);
      return { ok: false, reason: `appel Gemini échoué (${message})` };
    }
    if (!answer) return { ok: false, reason: 'réponse cloud vide' };

    return {
      ok: true,
      result: {
        answer,
        model: config.model,
        provider: 'gemini',
        sourceKind: media.kind,
        warning: CLOUD_PRIVACY_WARNING,
      },
    };
  } catch (err) {
    // Absolute defensive net — this function must NEVER throw.
    logger.warn(`[video] cloud understanding unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, reason: 'erreur cloud inattendue' };
  }
}
