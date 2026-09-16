/**
 * Low-latency Kyutai TTS client for the resident voice.
 *
 * Contract: POST `{ "text": "..." }` to `/tts`, then receive raw signed
 * PCM16 little-endian, mono, 24 kHz chunks. The short timeout covers headers
 * AND the first PCM byte; after audio starts, the caller's AbortSignal owns the
 * body lifetime so a normal multi-second phrase is not cut at 1.5 seconds.
 */

import { logger } from '../utils/logger.js';

export const DEFAULT_KYUTAI_LOCAL_TIMEOUT_MS = 1_500;
export const DEFAULT_KYUTAI_LOCAL_N_Q = 12;

export interface KyutaiLocalHealth {
  healthy: boolean;
  nQ?: number;
  sampleRate?: number;
  format?: string;
  reason?: string;
}

export interface KyutaiLocalVoiceOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function resolveKyutaiLocalUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured = env.CODEBUDDY_TTS_LOCAL_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/u, '');
  } catch {
    return null;
  }
}

export function resolveKyutaiLocalTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number(env.CODEBUDDY_TTS_LOCAL_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(60_000, Math.floor(parsed))
    : DEFAULT_KYUTAI_LOCAL_TIMEOUT_MS;
}

export function resolveKyutaiLocalNq(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number(env.CODEBUDDY_TTS_LOCAL_N_Q);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 64
    ? parsed
    : DEFAULT_KYUTAI_LOCAL_N_Q;
}

/** Acoustic identity consumed by TtsCache; never aliases Lisa's cloud voice. */
export function resolveKyutaiCacheVoice(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const endpoint = resolveKyutaiLocalUrl(env) ?? 'unconfigured';
  return `local:kyutai:${resolveKyutaiLocalNq(env)}:url=${endpoint}:format=pcm_s16le_mono_24000`;
}

function endpoint(baseUrl: string, path: 'health' | 'tts'): URL {
  return new URL(path, `${baseUrl}/`);
}

function requestController(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  controller: AbortController;
  clear: () => void;
  detach: () => void;
} {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) onAbort();
  else callerSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error(`Kyutai first PCM timeout after ${timeoutMs}ms`)),
    timeoutMs,
  );
  return {
    controller,
    clear: () => clearTimeout(timer),
    detach: () => callerSignal?.removeEventListener('abort', onAbort),
  };
}

export async function checkKyutaiLocalHealth(
  env: NodeJS.ProcessEnv = process.env,
  options: KyutaiLocalVoiceOptions = {},
): Promise<KyutaiLocalHealth> {
  const baseUrl = resolveKyutaiLocalUrl(env);
  if (!baseUrl) return { healthy: false, reason: 'CODEBUDDY_TTS_LOCAL_URL is not configured' };
  const timeoutMs = options.timeoutMs ?? resolveKyutaiLocalTimeoutMs(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint(baseUrl, 'health'), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return { healthy: false, reason: `HTTP ${response.status}` };
    const body = await response.json() as {
      ok?: unknown;
      engine?: unknown;
      n_q?: unknown;
      sample_rate?: unknown;
      format?: unknown;
    };
    const healthy = body.ok === true && body.engine === 'kyutai';
    return {
      healthy,
      ...(typeof body.n_q === 'number' ? { nQ: body.n_q } : {}),
      ...(typeof body.sample_rate === 'number' ? { sampleRate: body.sample_rate } : {}),
      ...(typeof body.format === 'string' ? { format: body.format } : {}),
      ...(healthy ? {} : { reason: 'unexpected health payload' }),
    };
  } catch (error) {
    return {
      healthy: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function validatePcmHeaders(response: Response): void {
  const sampleRate = response.headers.get('x-audio-sample-rate');
  if (sampleRate && sampleRate !== '24000') {
    throw new Error(`Kyutai returned unsupported sample rate ${sampleRate}`);
  }
  const format = response.headers.get('x-audio-format');
  if (format && format.toLowerCase() !== 's16le') {
    throw new Error(`Kyutai returned unsupported audio format ${format}`);
  }
  const contentType = response.headers.get('content-type');
  if (contentType && !contentType.toLowerCase().startsWith('audio/pcm')) {
    throw new Error('Kyutai returned a non-PCM response');
  }
}

/**
 * Open the raw PCM stream after proving health through its first non-empty byte.
 * Returns null on every setup/timeout failure so the caller can immediately
 * retry the unchanged phrase with ElevenLabs, then Pocket.
 */
export async function openKyutaiPcm24kStream(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
  options: KyutaiLocalVoiceOptions = {},
): Promise<ReadableStream<Uint8Array> | null> {
  const baseUrl = resolveKyutaiLocalUrl(env);
  const phrase = text.trim();
  if (!baseUrl || !phrase || signal?.aborted) return null;
  const timeoutMs = options.timeoutMs ?? resolveKyutaiLocalTimeoutMs(env);
  const request = requestController(signal, timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint(baseUrl, 'tts'), {
      method: 'POST',
      headers: {
        Accept: 'audio/pcm',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: phrase }),
      signal: request.controller.signal,
    });
    if (!response.ok) throw new Error(`Kyutai TTS failed with HTTP ${response.status}`);
    if (!response.body) throw new Error('Kyutai TTS response carried no body');
    validatePcmHeaders(response);
    reader = response.body.getReader();
    let first: ReadableStreamReadResult<Uint8Array>;
    do {
      first = await reader.read();
    } while (!first.done && first.value.byteLength === 0);
    if (first.done || first.value.byteLength === 0) {
      throw new Error('Kyutai TTS returned empty audio');
    }
    request.clear();

    let firstPending: Uint8Array | undefined = first.value;
    let closed = false;
    const finish = (): void => {
      if (closed) return;
      closed = true;
      request.detach();
    };
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (firstPending) {
            const value = firstPending;
            firstPending = undefined;
            controller.enqueue(value);
            return;
          }
          const next = await reader!.read();
          if (next.done) {
            finish();
            controller.close();
          } else if (next.value.byteLength > 0) {
            controller.enqueue(next.value);
          }
        } catch (error) {
          finish();
          controller.error(error);
        }
      },
      async cancel(reason) {
        finish();
        request.controller.abort(reason);
        await reader!.cancel(reason).catch(() => undefined);
      },
    });
  } catch (error) {
    request.clear();
    request.detach();
    await reader?.cancel().catch(() => undefined);
    if (signal?.aborted) {
      logger.debug('[kyutai-voice] flux interrompu par l’appelant');
    } else {
      logger.warn(
        `[kyutai-voice] flux indisponible (${error instanceof Error ? error.message : String(error)}); repli ElevenLabs`,
      );
    }
    return null;
  }
}
