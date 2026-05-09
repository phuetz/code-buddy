/**
 * Heartbeat monitor — periodically pings the configured LLM provider's
 * base URL so `/api/health` can report a meaningful `apiHeartbeat`
 * field instead of the legacy `{ lastCheck: null, status: 'unknown' }`.
 *
 * The probe is intentionally minimal: a HEAD/GET on the provider root
 * with a 5 s timeout. We accept 2xx/3xx/401/403 as "service reachable"
 * (the auth challenge proves the endpoint is alive); 404/5xx and
 * fetch errors mean "down".
 */
import { logger } from '../utils/logger.js';
import { updateApiHeartbeat } from './routes/health.js';

interface HeartbeatTimer {
  stop: () => void;
}

let activeTimer: HeartbeatTimer | null = null;

/**
 * Best-effort detection of the provider URL to ping. Order:
 * 1. Explicit `OLLAMA_BASE_URL` (Ollama-only).
 * 2. `OPENAI_BASE_URL` (OpenAI / Ollama-via-OAI / LM Studio / …).
 * 3. `ANTHROPIC_BASE_URL`.
 * 4. `GROK_BASE_URL` / `XAI_BASE_URL`.
 * 5. `GEMINI_BASE_URL`.
 * 6. Skip — no probe.
 */
function pickProbeUrl(): { url: string; label: string } | null {
  const env = process.env;
  if (env.OLLAMA_BASE_URL) {
    return { url: `${env.OLLAMA_BASE_URL.replace(/\/$/, '')}/api/tags`, label: 'ollama' };
  }
  if (env.OPENAI_BASE_URL) {
    const base = env.OPENAI_BASE_URL.replace(/\/$/, '');
    // Ollama serves /v1 + /api/tags. OpenAI serves /v1/models.
    // /v1/models works for both as a 401 (no auth) on OpenAI vs a list
    // on Ollama — both prove the endpoint is alive.
    return { url: `${base}/models`, label: 'openai-compat' };
  }
  if (env.ANTHROPIC_BASE_URL) {
    return { url: `${env.ANTHROPIC_BASE_URL.replace(/\/$/, '')}/v1/me`, label: 'anthropic' };
  }
  if (env.GROK_BASE_URL || env.XAI_BASE_URL) {
    const base = (env.GROK_BASE_URL || env.XAI_BASE_URL || '').replace(/\/$/, '');
    return { url: `${base}/v1/models`, label: 'xai' };
  }
  if (env.GEMINI_BASE_URL) {
    return { url: `${env.GEMINI_BASE_URL.replace(/\/$/, '')}/v1beta/models`, label: 'gemini' };
  }
  return null;
}

async function probeOnce(): Promise<void> {
  const target = pickProbeUrl();
  if (!target) return; // No provider configured — skip silently.
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(target.url, { signal: ctrl.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    // 2xx/3xx/401/403 all prove the service is alive.
    const reachable = res.ok || res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400);
    if (reachable) {
      updateApiHeartbeat(latencyMs);
    } else {
      logger.debug(
        `[heartbeat] ${target.label} returned ${res.status} — not counting as reachable`
      );
    }
  } catch (err) {
    clearTimeout(timer);
    logger.debug(
      `[heartbeat] ${target.label} unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Start a 30-second heartbeat. Idempotent — if already running,
 * returns the existing handle.
 */
export function startApiHeartbeatMonitor(intervalMs: number = 30_000): HeartbeatTimer {
  if (activeTimer) return activeTimer;
  // Fire one immediately so /api/health has data within a few seconds
  // of server boot rather than 30 s.
  void probeOnce();
  const id = setInterval(() => void probeOnce(), intervalMs);
  // Don't keep the event loop alive just for this.
  if (typeof id === 'object' && id !== null && 'unref' in id && typeof (id as { unref: () => void }).unref === 'function') {
    (id as { unref: () => void }).unref();
  }
  activeTimer = {
    stop: () => {
      clearInterval(id);
      activeTimer = null;
    },
  };
  return activeTimer;
}

export function stopApiHeartbeatMonitor(): void {
  activeTimer?.stop();
  activeTimer = null;
}
