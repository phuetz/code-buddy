/**
 * Per-channel model override resolution — Hermes parity (session > channel > global).
 *
 * The channel dispatch path resolves the model for every inbound message
 * through explicit tiers, finest scope first:
 *
 *   1. `session`       — a `/model <name>` override set for this exact chat
 *                        (per sessionKey, runtime state, not persisted)
 *   2. `route`         — an EXPLICITLY matched PeerRoute (peer > channel-id >
 *                        channel-type > account specificity, resolved upstream)
 *   3. `persona`       — the per-bot persona from channels.json `options.model`
 *   4. `route-default` — the merged RouteAgentConfig model, which includes the
 *                        router-wide `defaultAgent` fallback. Kept BELOW the
 *                        persona so a router default never clobbers a bot
 *                        persona in multi-bot setups.
 *   5. `global`        — the provider default from the environment.
 */

export type ModelTierSource = 'session' | 'route' | 'persona' | 'route-default' | 'global';

export interface ChannelModelTiers {
  /** `/model` override for this sessionKey. */
  sessionOverride?: string | undefined;
  /** Model of an explicitly matched PeerRoute (`matchType !== 'default'`). */
  routeModel?: string | undefined;
  /** Per-bot persona model (channels.json `options.model`). */
  personaModel?: string | undefined;
  /** Merged RouteAgentConfig model (includes the router `defaultAgent` fallback). */
  routeDefaultModel?: string | undefined;
  /** Provider default from the environment. */
  globalModel: string;
}

/** Single-token sanity check for user-supplied model names (same trust level as channels.json). */
export const MODEL_NAME_PATTERN = /^[A-Za-z0-9._:/@-]{1,100}$/;

/** First non-empty tier wins, in the order documented above. */
export function resolveChannelModel(tiers: ChannelModelTiers): { model: string; source: ModelTierSource } {
  const clean = (value: string | undefined): string | undefined => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed ? trimmed : undefined;
  };
  const ordered: Array<[string | undefined, ModelTierSource]> = [
    [clean(tiers.sessionOverride), 'session'],
    [clean(tiers.routeModel), 'route'],
    [clean(tiers.personaModel), 'persona'],
    [clean(tiers.routeDefaultModel), 'route-default'],
  ];
  for (const [model, source] of ordered) {
    if (model) return { model, source };
  }
  return { model: tiers.globalModel.trim(), source: 'global' };
}

// ---------------------------------------------------------------------------
// Session-override store — in-memory, keyed by the channel sessionKey
// (`${botId}:${accountId}:${channelType}:${channelId}:${peerId}`). Lost on
// daemon restart by design (v1); `/model` with no arg always shows the truth.
// ---------------------------------------------------------------------------

const sessionModelOverrides = new Map<string, string>();

export function setSessionModelOverride(sessionKey: string, model: string): void {
  if (sessionKey && model.trim()) sessionModelOverrides.set(sessionKey, model.trim());
}

export function getSessionModelOverride(sessionKey: string): string | undefined {
  return sessionModelOverrides.get(sessionKey);
}

/** Returns true when an override existed and was removed. */
export function clearSessionModelOverride(sessionKey: string): boolean {
  return sessionModelOverrides.delete(sessionKey);
}

/** Test-only — never call in production. */
export function __resetSessionModelOverridesForTests(): void {
  sessionModelOverrides.clear();
}
