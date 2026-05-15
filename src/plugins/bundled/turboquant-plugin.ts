/**
 * TurboQuant Bundled Plugin
 *
 * Registers the TurboQuantProvider when turboquant config is present in settings.
 * Starts background health monitoring and wires up the /infra slash command.
 *
 * Activated when TURBOQUANT_VLLM_ENDPOINT or TURBOQUANT_OLLAMA_ENDPOINT is set,
 * or when settings.json contains a `turboquant` block.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../../utils/logger.js';
import type { PluginProvider } from '../types.js';
import { requireProviderText } from './response-content.js';
import {
  TurboQuantProvider,
  createTurboQuantProvider,
} from '../../providers/turboquant-provider.js';
import type { TurboQuantProviderConfig } from '../../providers/turboquant-provider.js';

export const TURBOQUANT_PROVIDER_ID = 'bundled-turboquant';

// ---------------------------------------------------------------------------
// Routing stats (in-memory, reset per process)
// ---------------------------------------------------------------------------

export interface TurboQuantRoutingStats {
  ollamaRequests: number;
  vllmRequests: number;
  ollamaErrors: number;
  vllmErrors: number;
  lastChecked: Date | null;
  ollamaReachable: boolean;
  vllmReachable: boolean;
}

const stats: TurboQuantRoutingStats = {
  ollamaRequests: 0,
  vllmRequests: 0,
  ollamaErrors: 0,
  vllmErrors: 0,
  lastChecked: null,
  ollamaReachable: false,
  vllmReachable: false,
};

let healthInterval: ReturnType<typeof setInterval> | null = null;
let activeProvider: TurboQuantProvider | null = null;

// ---------------------------------------------------------------------------
// Settings reader
// ---------------------------------------------------------------------------

/**
 * Read TurboQuant config from .codebuddy/settings.json if present.
 */
function readSettingsConfig(): Partial<TurboQuantProviderConfig> | null {
  try {
    const settingsPath = join(process.cwd(), '.codebuddy', 'settings.json');
    if (!existsSync(settingsPath)) return null;
    const raw = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    if (raw['turboquant'] && typeof raw['turboquant'] === 'object') {
      return raw['turboquant'] as Partial<TurboQuantProviderConfig>;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Health monitoring
// ---------------------------------------------------------------------------

/**
 * Start a background health-check loop (every 60 seconds).
 */
function startHealthMonitor(provider: TurboQuantProvider): void {
  if (healthInterval) return;

  const runCheck = async (): Promise<void> => {
    try {
      const available = await provider.isAvailable();
      stats.ollamaReachable = available;
      stats.vllmReachable = available;
      stats.lastChecked = new Date();
      logger.debug('TurboQuant health check', { available });
    } catch (err) {
      logger.debug('TurboQuant health check failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Run immediately on start, then on interval
  void runCheck();

  healthInterval = setInterval(() => void runCheck(), 60_000);
  // Don't hold the process open for health checks
  if (typeof healthInterval === 'object' && healthInterval !== null && 'unref' in healthInterval) {
    (healthInterval as { unref(): void }).unref();
  }
}

/**
 * Stop the background health monitor.
 */
function stopHealthMonitor(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Public accessors (used by infra-handlers)
// ---------------------------------------------------------------------------

/**
 * Get current routing stats for the /infra dashboard.
 */
export function getTurboQuantStats(): TurboQuantRoutingStats {
  return { ...stats };
}

/**
 * Get the active TurboQuantProvider instance.
 */
export function getActiveTurboQuantProvider(): TurboQuantProvider | null {
  return activeProvider;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create the TurboQuant bundled plugin provider.
 * Returns null if TurboQuant is not configured.
 */
export function createTurboQuantPlugin(): PluginProvider | null {
  const settingsConfig = readSettingsConfig();
  const provider = createTurboQuantProvider(settingsConfig ?? undefined);

  if (!provider) {
    logger.debug(
      'TurboQuant plugin skipped: no TURBOQUANT_VLLM_ENDPOINT or TURBOQUANT_OLLAMA_ENDPOINT configured'
    );
    return null;
  }

  activeProvider = provider;

  return {
    id: TURBOQUANT_PROVIDER_ID,
    name: 'TurboQuant',
    type: 'llm',
    priority: 3,
    config: { settingsConfig },

    async initialize() {
      logger.info('TurboQuant bundled plugin initializing');
      startHealthMonitor(provider);
      const available = await provider.isAvailable();
      if (!available) {
        logger.warn('TurboQuant: no backend endpoints are reachable at startup');
      } else {
        logger.info('TurboQuant: at least one backend endpoint is reachable');
      }
    },

    async shutdown() {
      stopHealthMonitor();
      activeProvider = null;
      logger.debug('TurboQuant bundled plugin shutdown');
    },

    async chat(messages: Array<{ role: string; content: string }>) {
      stats.ollamaRequests++;
      try {
        const response = await provider.chat(
          messages.map((m) => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
          }))
        );
        return requireProviderText('TurboQuant', response.choices[0]?.message?.content);
      } catch (err) {
        stats.ollamaErrors++;
        throw err;
      }
    },

    async complete(prompt: string) {
      return this.chat!([{ role: 'user', content: prompt }]);
    },
  };
}

/**
 * Load the TurboQuant plugin — called from getBundledProviders() in index.ts.
 */
export function loadTurboQuantPlugin(): PluginProvider | null {
  return createTurboQuantPlugin();
}
