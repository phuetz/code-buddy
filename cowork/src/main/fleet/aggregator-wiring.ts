/**
 * Wire the Fleet Council's result-aggregator to a real LLM client so it
 * actually arbitrates the N peer answers instead of falling back to a labelled
 * concatenation.
 *
 * The core aggregator (`src/fleet/result-aggregator.ts`) exposes
 * `wireAggregatorClient(getter)` where `getter: () => CodeBuddyClient | null`,
 * but nothing called it in production — only tests. The Council's
 * `aggregateWithConsensus` runs in Cowork's main process (`saga-runner.ts`),
 * loaded via `loadCoreModule('fleet/result-aggregator.js')`. Because
 * `loadCoreModule` caches by path, wiring here sets `cachedGetter` on the SAME
 * module instance the saga-runner uses.
 *
 * The getter is lazy: it builds a fresh `CodeBuddyClient` from the current
 * config on every aggregation, so a mid-session model/key change in Settings is
 * picked up without re-wiring. Returns `null` when no API key is configured,
 * which the aggregator handles gracefully (concat fallback).
 *
 * @module main/fleet/aggregator-wiring
 */

import { loadCoreModule } from '../utils/core-loader';
import { log, logWarn } from '../utils/logger';

interface ConfigStoreLike {
  getAll(): { apiKey?: string; model?: string; baseUrl?: string };
}

interface AggregatorModule {
  wireAggregatorClient?: (getter: () => unknown) => void;
}

interface ClientModule {
  CodeBuddyClient?: new (apiKey: string, model?: string, baseURL?: string) => unknown;
}

/**
 * Build the lazy client getter passed to `wireAggregatorClient`. Exported for
 * unit testing the "key present → client, key absent → null" contract without
 * loading the real core modules.
 */
export function buildAggregatorClientGetter(
  configStore: ConfigStoreLike,
  CodeBuddyClient: new (apiKey: string, model?: string, baseURL?: string) => unknown,
): () => unknown {
  return () => {
    const cfg = configStore.getAll();
    const key = cfg.apiKey || process.env.GROK_API_KEY || '';
    if (!key) return null;
    return new CodeBuddyClient(key, cfg.model, cfg.baseUrl || process.env.GROK_BASE_URL);
  };
}

/**
 * Wire the aggregator client once at Cowork main boot. Best-effort: any failure
 * leaves the Council on its concat fallback rather than blocking startup.
 * Returns whether the client was wired.
 */
export async function wireFleetAggregator(configStore: ConfigStoreLike): Promise<boolean> {
  try {
    const [aggMod, clientMod] = await Promise.all([
      loadCoreModule<AggregatorModule>('fleet/result-aggregator.js'),
      loadCoreModule<ClientModule>('codebuddy/client.js'),
    ]);
    if (!aggMod?.wireAggregatorClient || !clientMod?.CodeBuddyClient) {
      logWarn('[fleet] aggregator/client core module unavailable — Council uses concat fallback');
      return false;
    }
    aggMod.wireAggregatorClient(
      buildAggregatorClientGetter(configStore, clientMod.CodeBuddyClient),
    );
    log('[fleet] aggregator client wired — Council uses LLM arbitration');
    return true;
  } catch (err) {
    logWarn('[fleet] failed to wire aggregator client (Council falls back to concat):', err);
    return false;
  }
}
