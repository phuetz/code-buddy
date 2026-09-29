/**
 * Inference Infrastructure Health Monitor
 *
 * Monitors health of local and cloud inference backends:
 * - Ollama (local, multi-model)
 * - vLLM  (local, high-throughput)
 * - Cloud providers (xAI, OpenAI, Anthropic, etc.)
 */

import { logger } from '../utils/logger.js';
import { getOllamaBaseUrl } from '../utils/ollama-url.js';

// ============================================================================
// Types
// ============================================================================

export interface OllamaHealth {
  status: 'up' | 'down' | 'degraded';
  loadedModels: string[];
  freeRamGB: number;
  latencyMs: number;
}

export interface VllmHealth {
  status: 'up' | 'down' | 'degraded';
  loadedModel: string;
  freeVramGB: number;
  queueLength: number;
  tokensPerSecond: number;
  turboQuantEnabled: boolean;
}

export interface InfraHealth {
  ollama: OllamaHealth | null;
  vllm: VllmHealth | null;
  cloud: {
    providers: Record<string, 'available' | 'rate_limited' | 'error'>;
  };
}

// ============================================================================
// Ollama
// ============================================================================

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

interface OllamaPsResponse {
  models?: Array<{ name: string }>;
}

/**
 * Check Ollama health by querying /api/tags and /api/ps.
 */
export async function checkOllama(endpoint: string): Promise<OllamaHealth> {
  const base = endpoint.replace(/\/$/, '');
  const start = Date.now();

  try {
    // GET /api/tags — lists available models (proves the server is up)
    const tagsRes = await fetch(`${base}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!tagsRes.ok) {
      return { status: 'degraded', loadedModels: [], freeRamGB: 0, latencyMs: Date.now() - start };
    }

    const tagsData = (await tagsRes.json()) as OllamaTagsResponse;
    const latencyMs = Date.now() - start;

    // GET /api/ps — lists running models (optional, non-fatal)
    let loadedModels: string[] = [];
    try {
      const psRes = await fetch(`${base}/api/ps`, {
        signal: AbortSignal.timeout(3000),
      });
      if (psRes.ok) {
        const psData = (await psRes.json()) as OllamaPsResponse;
        loadedModels = (psData.models ?? []).map((m) => m.name);
      }
    } catch {
      // /api/ps is optional — ignore errors
    }

    // Estimate free RAM: Ollama exposes no direct VRAM/RAM metric via HTTP,
    // so we fall back to process memory heuristic (available in Node).
    const freeRamGB = os_freeRamGB();

    const status: OllamaHealth['status'] = latencyMs > 3000 ? 'degraded' : 'up';

    return { status, loadedModels, freeRamGB, latencyMs };
  } catch {
    return { status: 'down', loadedModels: [], freeRamGB: 0, latencyMs: Date.now() - start };
  }
}

// ============================================================================
// vLLM
// ============================================================================

interface VllmHealthResponse {
  status?: string;
}

interface VllmModelsResponse {
  data?: Array<{
    id: string;
    turbo_quant_enabled?: boolean;
  }>;
}

interface VllmMetricsLine {
  queue?: number;
  tps?: number;
  free_vram_gb?: number;
}

/**
 * Parse Prometheus-style metrics text for vLLM-specific gauges.
 * Extracts queue_length, tokens_per_second, and free GPU memory.
 */
function parseVllmMetrics(text: string): VllmMetricsLine {
  const result: VllmMetricsLine = {};

  for (const line of text.split('\n')) {
    if (line.startsWith('#')) continue;

    // vllm:num_requests_waiting
    if (line.startsWith('vllm:num_requests_waiting')) {
      const val = parseFloat(line.split(' ')[1] ?? '');
      if (!isNaN(val)) result.queue = val;
    }

    // vllm:avg_generation_throughput_toks_per_s
    if (line.startsWith('vllm:avg_generation_throughput_toks_per_s')) {
      const val = parseFloat(line.split(' ')[1] ?? '');
      if (!isNaN(val)) result.tps = val;
    }

    // vllm:gpu_cache_usage_perc — proxy for free VRAM
    // Free VRAM = (1 - usage_pct) × total_vram; we approximate total as 24GB if unknown
    if (line.startsWith('vllm:gpu_cache_usage_perc')) {
      const val = parseFloat(line.split(' ')[1] ?? '');
      if (!isNaN(val)) result.free_vram_gb = (1 - val) * 24;
    }
  }

  return result;
}

/**
 * Check vLLM health by querying /health and /v1/models.
 */
export async function checkVllm(endpoint: string): Promise<VllmHealth> {
  const base = endpoint.replace(/\/$/, '');

  try {
    // GET /health — basic liveness probe
    const healthRes = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!healthRes.ok) {
      return emptyVllmHealth('degraded');
    }

    // GET /v1/models — find loaded model
    let loadedModel = '';
    let turboQuantEnabled = false;
    try {
      const modelsRes = await fetch(`${base}/v1/models`, {
        signal: AbortSignal.timeout(3000),
      });
      if (modelsRes.ok) {
        const modelsData = (await modelsRes.json()) as VllmModelsResponse;
        const first = modelsData.data?.[0];
        if (first) {
          loadedModel = first.id;
          turboQuantEnabled = first.turbo_quant_enabled ?? false;
        }
      }
    } catch {
      // Non-fatal
    }

    // GET /metrics — Prometheus metrics for queue/tps/vram
    let queueLength = 0;
    let tokensPerSecond = 0;
    let freeVramGB = 0;
    try {
      const metricsRes = await fetch(`${base}/metrics`, {
        signal: AbortSignal.timeout(3000),
      });
      if (metricsRes.ok) {
        const metricsText = await metricsRes.text();
        const parsed = parseVllmMetrics(metricsText);
        queueLength = parsed.queue ?? 0;
        tokensPerSecond = parsed.tps ?? 0;
        freeVramGB = parsed.free_vram_gb ?? 0;
      }
    } catch {
      // Non-fatal
    }

    const status: VllmHealth['status'] = queueLength > 50 ? 'degraded' : 'up';

    return {
      status,
      loadedModel,
      freeVramGB,
      queueLength,
      tokensPerSecond,
      turboQuantEnabled,
    };
  } catch {
    return emptyVllmHealth('down');
  }
}

function emptyVllmHealth(status: VllmHealth['status']): VllmHealth {
  return {
    status,
    loadedModel: '',
    freeVramGB: 0,
    queueLength: 0,
    tokensPerSecond: 0,
    turboQuantEnabled: false,
  };
}

// ============================================================================
// Cloud Providers
// ============================================================================

const CLOUD_HEALTH_ENDPOINTS: Record<string, string> = {
  'xai': 'https://api.x.ai/v1/models',
  'openai': 'https://api.openai.com/v1/models',
  'anthropic': 'https://api.anthropic.com/v1/models',
};

/**
 * Check a single cloud provider by hitting its models endpoint.
 * Returns 'available', 'rate_limited', or 'error'.
 */
async function checkCloudProvider(
  name: string,
  url: string,
): Promise<'available' | 'rate_limited' | 'error'> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 429) return 'rate_limited';
    // 401/403 means the service is reachable but we're unauthenticated — still "available"
    if (res.status === 401 || res.status === 403 || res.ok) return 'available';
    return 'error';
  } catch {
    logger.debug('Cloud provider health check failed', { provider: name });
    return 'error';
  }
}

// ============================================================================
// Aggregate Health
// ============================================================================

const DEFAULT_OLLAMA_ENDPOINT = getOllamaBaseUrl();
const DEFAULT_VLLM_ENDPOINT = 'http://localhost:8000';

/**
 * Aggregate health from Ollama, vLLM, and cloud providers in parallel.
 */
export async function getHealth(
  ollamaEndpoint = DEFAULT_OLLAMA_ENDPOINT,
  vllmEndpoint = DEFAULT_VLLM_ENDPOINT,
): Promise<InfraHealth> {
  logger.debug('Running infrastructure health checks');

  const [ollamaHealth, vllmHealth, ...cloudResults] = await Promise.allSettled([
    checkOllama(ollamaEndpoint),
    checkVllm(vllmEndpoint),
    ...Object.entries(CLOUD_HEALTH_ENDPOINTS).map(([name, url]) =>
      checkCloudProvider(name, url).then((status) => ({ name, status })),
    ),
  ]);

  const ollama =
    ollamaHealth.status === 'fulfilled' ? ollamaHealth.value : null;
  const vllm =
    vllmHealth.status === 'fulfilled' ? vllmHealth.value : null;

  const providers: Record<string, 'available' | 'rate_limited' | 'error'> = {};
  for (const result of cloudResults) {
    if (result.status === 'fulfilled') {
      const { name, status } = result.value as { name: string; status: 'available' | 'rate_limited' | 'error' };
      providers[name] = status;
    }
  }

  return { ollama, vllm, cloud: { providers } };
}

// ============================================================================
// Dashboard Formatter
// ============================================================================

/**
 * Format an InfraHealth snapshot as a human-readable CLI dashboard string.
 */
export function formatDashboard(health: InfraHealth): string {
  const lines: string[] = [];

  lines.push('Inference Infrastructure Health');
  lines.push('══════════════════════════════════════');

  // Ollama
  lines.push('');
  lines.push('Ollama (local)');
  lines.push('──────────────────────────────────────');
  if (!health.ollama) {
    lines.push('  Status: unknown');
  } else {
    const o = health.ollama;
    lines.push(`  Status:        ${statusIcon(o.status)} ${o.status}`);
    lines.push(`  Latency:       ${o.latencyMs} ms`);
    lines.push(`  Free RAM:      ${o.freeRamGB.toFixed(1)} GB`);
    if (o.loadedModels.length > 0) {
      lines.push(`  Loaded models: ${o.loadedModels.join(', ')}`);
    } else {
      lines.push('  Loaded models: (none)');
    }
  }

  // vLLM
  lines.push('');
  lines.push('vLLM (local)');
  lines.push('──────────────────────────────────────');
  if (!health.vllm) {
    lines.push('  Status: unknown');
  } else {
    const v = health.vllm;
    lines.push(`  Status:         ${statusIcon(v.status)} ${v.status}`);
    lines.push(`  Model:          ${v.loadedModel || '(none)'}`);
    lines.push(`  Free VRAM:      ${v.freeVramGB.toFixed(1)} GB`);
    lines.push(`  Queue length:   ${v.queueLength}`);
    lines.push(`  Throughput:     ${v.tokensPerSecond.toFixed(1)} tok/s`);
    lines.push(`  TurboQuant:     ${v.turboQuantEnabled ? 'enabled' : 'disabled'}`);
  }

  // Cloud
  lines.push('');
  lines.push('Cloud Providers');
  lines.push('──────────────────────────────────────');
  const providerEntries = Object.entries(health.cloud.providers);
  if (providerEntries.length === 0) {
    lines.push('  (no cloud providers checked)');
  } else {
    for (const [name, status] of providerEntries) {
      lines.push(`  ${name.padEnd(12)} ${providerStatusIcon(status)} ${status}`);
    }
  }

  return lines.join('\n');
}

function statusIcon(status: 'up' | 'down' | 'degraded'): string {
  switch (status) {
    case 'up': return '[OK]';
    case 'degraded': return '[!!]';
    case 'down': return '[XX]';
  }
}

function providerStatusIcon(status: 'available' | 'rate_limited' | 'error'): string {
  switch (status) {
    case 'available': return '[OK]';
    case 'rate_limited': return '[RL]';
    case 'error': return '[XX]';
  }
}

// ============================================================================
// Free RAM helper (Node.js)
// ============================================================================

import { freemem } from 'os';

function os_freeRamGB(): number {
  return freemem() / 1e9;
}

// ============================================================================
// Health Monitor (polling)
// ============================================================================

export class HealthMonitor {
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private lastHealth: InfraHealth | null = null;
  private ollamaEndpoint: string;
  private vllmEndpoint: string;

  constructor(
    ollamaEndpoint = DEFAULT_OLLAMA_ENDPOINT,
    vllmEndpoint = DEFAULT_VLLM_ENDPOINT,
  ) {
    this.ollamaEndpoint = ollamaEndpoint;
    this.vllmEndpoint = vllmEndpoint;
  }

  /**
   * Run a one-shot health check and return the result.
   */
  async getHealth(): Promise<InfraHealth> {
    this.lastHealth = await getHealth(this.ollamaEndpoint, this.vllmEndpoint);
    return this.lastHealth;
  }

  /**
   * Return the most recent cached health snapshot (null if never polled).
   */
  getLastHealth(): InfraHealth | null {
    return this.lastHealth;
  }

  /**
   * Start background polling at the given interval.
   * Subsequent checks update the internal cache silently.
   */
  startPolling(intervalMs: number): void {
    if (this.pollingTimer) return; // already polling

    logger.info('Starting inference health monitor polling', { intervalMs });

    const poll = async (): Promise<void> => {
      try {
        this.lastHealth = await getHealth(this.ollamaEndpoint, this.vllmEndpoint);
        logger.debug('Health poll completed', {
          ollamaStatus: this.lastHealth.ollama?.status ?? 'null',
          vllmStatus: this.lastHealth.vllm?.status ?? 'null',
        });
      } catch (err) {
        logger.warn('Health poll failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    // Run immediately, then on interval
    void poll();
    this.pollingTimer = setInterval(() => void poll(), intervalMs);
  }

  /**
   * Stop background polling.
   */
  stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
      logger.info('Inference health monitor polling stopped');
    }
  }

  /**
   * Format the last known health as a dashboard string.
   * Returns a "no data" message if no poll has run yet.
   */
  formatDashboard(): string {
    if (!this.lastHealth) {
      return 'No health data available. Run getHealth() or startPolling() first.';
    }
    return formatDashboard(this.lastHealth);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let healthMonitorInstance: HealthMonitor | null = null;

export function getHealthMonitor(
  ollamaEndpoint?: string,
  vllmEndpoint?: string,
): HealthMonitor {
  if (!healthMonitorInstance) {
    healthMonitorInstance = new HealthMonitor(ollamaEndpoint, vllmEndpoint);
  }
  return healthMonitorInstance;
}

export function resetHealthMonitor(): void {
  healthMonitorInstance?.stopPolling();
  healthMonitorInstance = null;
}
