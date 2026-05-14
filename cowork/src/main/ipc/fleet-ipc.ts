import { ipcMain } from 'electron';
import { log, logError, logWarn } from '../utils/logger';
import type { FleetBridge } from '../fleet/fleet-bridge';
import { loadCoreModule } from '../utils/core-loader';
import { SagaRunner } from '../fleet/saga-runner';
import { sendToRenderer } from '../ipc-main-bridge';

type FleetApiScope = 'fleet:listen' | 'peer:invoke';

interface CoreApiKeyView {
  id: string;
  keyPreview?: string;
  name: string;
  userId: string;
  scopes: string[];
  active: boolean;
  createdAt: Date | string;
  expiresAt?: Date | string;
  lastUsedAt?: Date | string;
}

interface CoreApiKeysModule {
  createApiKey: (options: {
    name: string;
    userId: string;
    scopes: FleetApiScope[];
  }) => { key: string; apiKey: CoreApiKeyView };
  listApiKeys: (userId: string) => CoreApiKeyView[];
  getApiKeyStorePath: () => string;
}

const FLEET_API_SCOPES: FleetApiScope[] = ['fleet:listen', 'peer:invoke'];

function normalizeFleetScopes(scopes?: string[]): FleetApiScope[] {
  if (!scopes || scopes.length === 0) {
    return FLEET_API_SCOPES;
  }

  const invalid = scopes.filter((scope) => !FLEET_API_SCOPES.includes(scope as FleetApiScope));
  if (invalid.length > 0) {
    throw new Error(`Unsupported Fleet API scope(s): ${invalid.join(', ')}`);
  }

  return Array.from(new Set(scopes)) as FleetApiScope[];
}

function serializeDate(value?: Date | string): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function serializeApiKey(apiKey: CoreApiKeyView) {
  return {
    id: apiKey.id,
    keyPreview: apiKey.keyPreview,
    name: apiKey.name,
    userId: apiKey.userId,
    scopes: apiKey.scopes,
    active: apiKey.active,
    createdAt: serializeDate(apiKey.createdAt) ?? new Date().toISOString(),
    expiresAt: serializeDate(apiKey.expiresAt),
    lastUsedAt: serializeDate(apiKey.lastUsedAt),
  };
}

export function registerFleetIpcHandlers(fleetBridge: FleetBridge | null) {
  const sagaRunner = fleetBridge ? new SagaRunner(fleetBridge, sendToRenderer) : null;
  ipcMain.handle('fleet.list', async () => {
    if (!fleetBridge) return [];
    return fleetBridge.listPeers();
  });

  ipcMain.handle(
    'fleet.addPeer',
    async (
      _event,
      input: { url: string; apiKey?: string; jwt?: string; label?: string }
    ) => {
      if (!fleetBridge) return { success: false, error: 'FleetBridge not initialized' };
      return fleetBridge.addPeer(input);
    }
  );

  ipcMain.handle('fleet.removePeer', async (_event, peerId: string) => {
    if (!fleetBridge) return { success: false };
    return fleetBridge.removePeer(peerId);
  });

  ipcMain.handle('fleet.reconnect', async (_event, peerId: string) => {
    if (!fleetBridge) return { success: false, error: 'FleetBridge not initialized' };
    return fleetBridge.reconnectPeer(peerId);
  });

  ipcMain.handle(
    'fleet.events',
    async (_event, peerId?: string, limit?: number) => {
      if (!fleetBridge) return [];
      return fleetBridge.getRecentEvents(peerId, limit);
    }
  );

  ipcMain.handle(
    'fleet.createApiKey',
    async (
      _event,
      input?: { name?: string; userId?: string; scopes?: string[] },
    ) => {
      try {
        const apiKeysMod = await loadCoreModule<CoreApiKeysModule>('server/auth/api-keys.js');
        if (!apiKeysMod) {
          return { ok: false, error: 'server API key module unavailable' };
        }

        const { key, apiKey } = apiKeysMod.createApiKey({
          name: input?.name?.trim() || 'Cowork Fleet key',
          userId: input?.userId?.trim() || 'local',
          scopes: normalizeFleetScopes(input?.scopes),
        });

        return {
          ok: true,
          key,
          apiKey: serializeApiKey(apiKey),
          store: apiKeysMod.getApiKeyStorePath(),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError('[fleet.createApiKey] failed:', message);
        return { ok: false, error: message };
      }
    },
  );

  ipcMain.handle(
    'fleet.listApiKeys',
    async (_event, input?: { userId?: string }) => {
      try {
        const apiKeysMod = await loadCoreModule<CoreApiKeysModule>('server/auth/api-keys.js');
        if (!apiKeysMod) {
          return { ok: false, error: 'server API key module unavailable', keys: [] };
        }

        const userId = input?.userId?.trim() || 'local';
        return {
          ok: true,
          keys: apiKeysMod.listApiKeys(userId).map(serializeApiKey),
          store: apiKeysMod.getApiKeyStorePath(),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError('[fleet.listApiKeys] failed:', message);
        return { ok: false, error: message, keys: [] };
      }
    },
  );

  // ── Fleet dispatch (Wiring W1+W3+W4+W5) ─────────────────────────
  //
  // 1. Privacy lint pre-dispatch (W4) — auto-bumps privacyTag to
  //    'sensitive' if the goal contains secrets.
  // 2. Cost cap pre-dispatch (W5) — refuses if today's spend or this
  //    saga's accumulated spend would exceed the configured caps.
  // 3. Build DispatchPlan via TaskRouter, persist saga via SagaStore.
  // 4. Hand off to SagaRunner (W1) which fires peer.dispatch, polls
  //    peer.dispatchStatus, updates step status, and finalises the
  //    saga via the result aggregator (W3).
  ipcMain.handle(
    'fleet.dispatch',
    async (
      _event,
      input: {
        goal: string;
        parallelism?: number;
        privacyTag?: 'public' | 'sensitive';
        maxCostUsd?: number;
        estimatedCostUsd?: number;
      },
    ) => {
      if (!fleetBridge || !sagaRunner) {
        return { ok: false, error: 'FleetBridge not initialized' };
      }
      try {
        type ClassificationLike = Record<string, unknown>;
        type RouterMod = {
          TaskRouter: new () => {
            plan: (
              cls: ClassificationLike,
              peers: Array<{ peerId: string; capability: unknown }>,
              constraints?: unknown,
            ) => unknown;
          };
        };
        type ClsMod = {
          classifyTaskComplexity: (msg: string) => ClassificationLike;
        };
        type SagaMod = {
          getSagaStore: () => {
            create: (input: {
              goal: string;
              plan: unknown;
              metadata?: Record<string, unknown>;
            }) => Promise<{ id: string }>;
          };
        };
        type LintMod = {
          scanForSecrets: (
            prompt: string,
          ) => { hasSecrets: boolean; highConfidence: boolean; matches: unknown[] };
        };
        type CostMod = {
          getCostTracker: () => {
            canSpend: (
              estimated: number,
              sagaId: string | undefined,
            ) => Promise<{ ok: boolean; reason?: string; remainingUsd?: number }>;
          };
        };

        const [routerMod, clsMod, sagaMod, lintMod, costMod] = await Promise.all([
          loadCoreModule<RouterMod>('fleet/task-router.js'),
          loadCoreModule<ClsMod>('optimization/model-routing.js'),
          loadCoreModule<SagaMod>('fleet/saga-store.js'),
          loadCoreModule<LintMod>('fleet/privacy-lint.js'),
          loadCoreModule<CostMod>('fleet/cost-tracker.js'),
        ]);
        if (!routerMod || !clsMod || !sagaMod) {
          return { ok: false, error: 'core fleet modules unavailable' };
        }

        // (W4) Privacy lint — auto-bump to 'sensitive' if secrets detected
        // unless caller explicitly set 'public' (in which case we refuse).
        let effectivePrivacyTag = input.privacyTag;
        let lintWarning: string | undefined;
        if (lintMod) {
          const lint = lintMod.scanForSecrets(input.goal);
          if (lint.hasSecrets) {
            if (input.privacyTag === 'public') {
              return {
                ok: false,
                error: `Privacy lint blocked dispatch — secrets detected (${lint.matches.length} match(es)) but caller forced privacyTag='public'. Remove the secret or drop privacyTag.`,
              };
            }
            if (effectivePrivacyTag !== 'sensitive') {
              effectivePrivacyTag = 'sensitive';
              lintWarning = `auto-bumped to sensitive (${lint.matches.length} match(es))`;
              logWarn('[fleet.dispatch] privacy lint auto-bumped privacyTag', {
                matches: lint.matches.length,
                highConfidence: lint.highConfidence,
              });
            }
          }
        }

        // (W5) Cost cap pre-dispatch.
        if (costMod && typeof input.estimatedCostUsd === 'number') {
          const tracker = costMod.getCostTracker();
          const check = await tracker.canSpend(input.estimatedCostUsd, undefined);
          if (!check.ok) {
            return {
              ok: false,
              error: `Cost cap reached — ${check.reason ?? 'unknown reason'}`,
            };
          }
        }

        const peers = (await Promise.resolve(fleetBridge.listPeers())) as Array<
          { id: string; capability?: unknown }
        >;
        const peerSlots = peers
          .filter((p) => Boolean(p.capability))
          .map((p) => ({
            peerId: p.id,
            capability: p.capability as unknown,
          }));
        if (peerSlots.length === 0) {
          return {
            ok: false,
            error:
              'No peer with known capabilities — wait for the next heartbeat or add peers from the Fleet panel.',
          };
        }

        const classification = clsMod.classifyTaskComplexity(input.goal);
        const router = new routerMod.TaskRouter();
        const plan = router.plan(classification, peerSlots, {
          parallelism: input.parallelism,
          privacyTag: effectivePrivacyTag,
          maxCostUsd: input.maxCostUsd,
        });

        const saga = await sagaMod.getSagaStore().create({
          goal: input.goal,
          plan,
          metadata: {
            privacyTag: effectivePrivacyTag,
            parallelism: input.parallelism,
            requestedAt: Date.now(),
            lintWarning,
          },
        });
        log('[fleet.dispatch] saga created — handing off to runner', {
          sagaId: saga.id,
        });

        // (W1+W3) Hand off to SagaRunner — fires peer.dispatch, polls
        // status, finalises via aggregator.
        sagaRunner.start(saga.id);

        return {
          ok: true,
          sagaId: saga.id,
          privacyTag: effectivePrivacyTag,
          lintWarning,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError('[fleet.dispatch] failed:', message);
        return { ok: false, error: message };
      }
    },
  );

  // (W6) Manual + auto discovery handler — returns peers detected on
  // the Tailscale tailnet and via the manual YAML fallback that aren't
  // already paired in the FleetBridge.
  ipcMain.handle('fleet.discoverPeers', async () => {
    if (!fleetBridge) return { ok: false, error: 'FleetBridge not initialized', peers: [] };
    try {
      const { discoverPeers } = await import('../fleet/discovery');
      const all = await discoverPeers();
      const known = new Set(
        (await Promise.resolve(fleetBridge.listPeers())).map((p) => p.url),
      );
      const fresh = all.filter((p) => !known.has(p.url));
      return { ok: true, peers: fresh, total: all.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('[fleet.discoverPeers] failed:', message);
      return { ok: false, error: message, peers: [] };
    }
  });

  ipcMain.handle('fleet.listSagas', async () => {
    try {
      type SagaMod = {
        getSagaStore: () => { list: () => Promise<unknown[]> };
      };
      const sagaMod = await loadCoreModule<SagaMod>('fleet/saga-store.js');
      if (!sagaMod) return [];
      return await sagaMod.getSagaStore().list();
    } catch (err) {
      logError('[fleet.listSagas] failed:', err);
      return [];
    }
  });
}
