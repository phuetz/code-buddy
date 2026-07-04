/**
 * Channels IPC — surfaces the core channel layer to Cowork.
 *
 * `channels.status` stays READ-ONLY (per-channel runtime connection status, the
 * free-form `info` blob dropped server-side). Phase 5 adds a CONFIG surface on
 * top so the GUI can add / enable / disable a channel and set its secret —
 * without ever moving the channel/secret logic out of the core:
 *
 *   - `channels.listConfig` — the configurable channels + their state, merged
 *     with runtime status. NEVER returns a secret value: each entry reports only
 *     `hasSecret: boolean`.
 *   - `channels.setConfig` / `channels.setEnabled` — write the NON-SECRET fields
 *     (`enabled`, `webhookUrl`, allow-lists) into `~/.codebuddy/channels.json`.
 *     A `token`/secret key in the patch is stripped defensively so a secret can
 *     never leak into that world-readable JSON.
 *   - `channels.setSecret` / `channels.deleteSecret` — the token is stored via
 *     the core's ENCRYPTED secret store (`CredentialManager`, AES-256-GCM,
 *     `~/.codebuddy/credentials.enc`, mode 0600) under the key
 *     `channel:<type>:token`. The value is write-only: it is never echoed back
 *     to the renderer and never logged (`CredentialManager` logs the key name
 *     only).
 *
 * All handlers never-throw: an invalid config / unavailable core module degrades
 * to a clean `{ ok: false, error }` rather than crashing the main process.
 *
 * @module main/ipc/channels-ipc
 */

import { ipcMain } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { loadCoreModule } from '../utils/core-loader';
import { logError } from '../utils/logger';
import {
  getChannelGatewayStatusForReview,
  type ChannelGatewayStatusPayload,
} from '../tools/channel-gateway-readiness-bridge';

// ---------------------------------------------------------------------------
// Core secret store (`src/security/credential-manager.ts`) — the encrypted
// vault used for LLM keys. `StoredCredentials` has a `[key: string]` index
// signature, so channel tokens live under `channel:<type>:token`. Loaded lazily
// (never bundled) and mockable in tests via the core-loader.
// ---------------------------------------------------------------------------
interface CredentialManagerLike {
  setCredential: (key: string, value: string) => void;
  getCredential: (key: string) => string | undefined;
  hasCredential: (key: string) => boolean;
  deleteCredential: (key: string) => void;
}
interface CredentialModule {
  getCredentialManager: () => CredentialManagerLike;
}

/** The secret-store key that holds a channel's primary token. */
function channelSecretKey(type: string): string {
  return `channel:${type}:token`;
}

async function loadCredentialManager(): Promise<CredentialManagerLike | null> {
  const mod = await loadCoreModule<CredentialModule>('security/credential-manager.js');
  if (!mod?.getCredentialManager) return null;
  try {
    return mod.getCredentialManager();
  } catch (error) {
    logError('[channels] credential manager unavailable:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// channels.json (the NON-SECRET config file the core reads at start —
// `src/commands/handlers/channel-handlers.ts getChannelConfigPaths`). The core
// has no writer, so the GUI owns writing it; the token is deliberately kept OUT
// of it (it goes to the encrypted store instead).
// ---------------------------------------------------------------------------
interface ChannelConfigEntry {
  type: string;
  enabled: boolean;
  /** Legacy plaintext token (from hand-written configs). Never surfaced; only its presence is reported. */
  token?: string;
  webhookUrl?: string;
  allowedUsers?: string[];
  allowedChannels?: string[];
  options?: Record<string, unknown>;
}
interface ChannelsConfigFile {
  channels: ChannelConfigEntry[];
}

function channelsConfigCandidates(configPath?: string): string[] {
  if (configPath && configPath.trim()) return [configPath];
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return [join(process.cwd(), '.codebuddy', 'channels.json'), join(home, '.codebuddy', 'channels.json')];
}

/**
 * Read channels.json, mirroring the core search order (cwd → home). When no
 * file exists, returns an empty config and the preferred WRITE target (home),
 * so a first `setConfig` creates `~/.codebuddy/channels.json`.
 */
function readChannelsConfig(configPath?: string): { path: string; config: ChannelsConfigFile } {
  const candidates = channelsConfigCandidates(configPath);
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<ChannelsConfigFile>;
      const channels = Array.isArray(parsed.channels) ? parsed.channels : [];
      return { path: p, config: { channels } };
    } catch (error) {
      logError('[channels] channels.json unreadable, treating as empty:', error);
      return { path: p, config: { channels: [] } };
    }
  }
  // Nothing on disk yet — write target is the last candidate (home).
  const target = candidates[candidates.length - 1] ?? join(process.cwd(), '.codebuddy', 'channels.json');
  return { path: target, config: { channels: [] } };
}

function writeChannelsConfig(path: string, config: ChannelsConfigFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Catalog — the channels the GUI offers to add. Kept in sync (by hand) with the
// token-bearing cases of `instantiateChannel`. `needsSecret:false` channels
// (whatsapp QR, webchat) take no token.
// ---------------------------------------------------------------------------
export interface ChannelCatalogEntry {
  type: string;
  label: string;
  /** Human label for the secret field (empty when the channel takes no token). */
  secretLabel: string;
  needsSecret: boolean;
  supportsWebhook: boolean;
}

const CHANNEL_CATALOG: readonly ChannelCatalogEntry[] = [
  { type: 'telegram', label: 'Telegram', secretLabel: 'Bot token', needsSecret: true, supportsWebhook: true },
  { type: 'discord', label: 'Discord', secretLabel: 'Bot token', needsSecret: true, supportsWebhook: false },
  { type: 'slack', label: 'Slack', secretLabel: 'Bot token', needsSecret: true, supportsWebhook: false },
  { type: 'matrix', label: 'Matrix', secretLabel: 'Access token', needsSecret: true, supportsWebhook: false },
  { type: 'teams', label: 'Microsoft Teams', secretLabel: 'App password', needsSecret: true, supportsWebhook: false },
  { type: 'line', label: 'LINE', secretLabel: 'Channel access token', needsSecret: true, supportsWebhook: true },
  { type: 'mattermost', label: 'Mattermost', secretLabel: 'Access token', needsSecret: true, supportsWebhook: false },
  { type: 'ntfy', label: 'ntfy', secretLabel: 'Access token', needsSecret: true, supportsWebhook: false },
  { type: 'google-chat', label: 'Google Chat', secretLabel: 'Verification token', needsSecret: true, supportsWebhook: true },
  { type: 'whatsapp', label: 'WhatsApp', secretLabel: '', needsSecret: false, supportsWebhook: false },
  { type: 'webchat', label: 'Web chat', secretLabel: '', needsSecret: false, supportsWebhook: false },
];

// ---------------------------------------------------------------------------
// View types (renderer-facing). A secret VALUE never appears here.
// ---------------------------------------------------------------------------
export interface ChannelConfigView {
  type: string;
  enabled: boolean;
  /** Present in channels.json (vs a catalog-only, not-yet-configured entry). */
  configured: boolean;
  /** A token exists in the encrypted store OR a legacy plaintext token is present. */
  hasSecret: boolean;
  hasWebhookUrl: boolean;
  webhookUrl?: string;
  allowedUsers: string[];
  allowedChannels: string[];
  optionKeys: string[];
  // Runtime (best-effort; false when the channel is not registered in this process).
  connected: boolean;
  authenticated: boolean;
  lastActivity?: number;
  error?: string;
}

export interface ChannelsConfigResult {
  ok: boolean;
  error?: string;
  path: string;
  channels: ChannelConfigView[];
  catalog: ChannelCatalogEntry[];
}

export interface ChannelMutationResult {
  ok: boolean;
  error?: string;
}

/** Reject unknown / malformed channel types before they reach the config file. */
function isValidType(type: unknown): type is string {
  return typeof type === 'string' && /^[a-z][a-z0-9-]{1,40}$/.test(type);
}

/** Runtime status keyed by channel type (best-effort — empty when unavailable). */
async function runtimeStatusByType(): Promise<
  Map<string, { connected: boolean; authenticated: boolean; lastActivity?: number; error?: string }>
> {
  const map = new Map<string, { connected: boolean; authenticated: boolean; lastActivity?: number; error?: string }>();
  try {
    const payload = await getChannelGatewayStatusForReview();
    if (payload.ok) {
      for (const item of payload.items) {
        map.set(item.type, {
          connected: item.connected,
          authenticated: item.authenticated,
          ...(typeof item.lastActivity === 'number' ? { lastActivity: item.lastActivity } : {}),
          ...(item.error ? { error: item.error } : {}),
        });
      }
    }
  } catch (error) {
    logError('[channels] runtime status unavailable:', error);
  }
  return map;
}

function toConfigView(
  entry: ChannelConfigEntry,
  hasSecretInStore: boolean,
  runtime: Map<string, { connected: boolean; authenticated: boolean; lastActivity?: number; error?: string }>,
): ChannelConfigView {
  const rt = runtime.get(entry.type);
  const view: ChannelConfigView = {
    type: entry.type,
    enabled: entry.enabled === true,
    configured: true,
    // A legacy hand-written config may carry a plaintext token; report presence only.
    hasSecret: hasSecretInStore || Boolean(entry.token),
    hasWebhookUrl: Boolean(entry.webhookUrl),
    allowedUsers: Array.isArray(entry.allowedUsers) ? entry.allowedUsers.filter((u): u is string => typeof u === 'string') : [],
    allowedChannels: Array.isArray(entry.allowedChannels)
      ? entry.allowedChannels.filter((c): c is string => typeof c === 'string')
      : [],
    optionKeys: entry.options && typeof entry.options === 'object' ? Object.keys(entry.options).sort() : [],
    connected: rt?.connected ?? false,
    authenticated: rt?.authenticated ?? false,
  };
  // webhookUrl is NOT a secret — safe to surface so the form can show it.
  if (typeof entry.webhookUrl === 'string' && entry.webhookUrl) view.webhookUrl = entry.webhookUrl;
  if (rt?.lastActivity !== undefined) view.lastActivity = rt.lastActivity;
  if (rt?.error) view.error = rt.error;
  return view;
}

/** Upsert a channel entry, applying a whitelisted NON-SECRET patch. */
type ConfigPatch = {
  enabled?: boolean;
  webhookUrl?: string;
  allowedUsers?: string[];
  allowedChannels?: string[];
};

function applyPatch(entry: ChannelConfigEntry, patch: ConfigPatch): ChannelConfigEntry {
  const next: ChannelConfigEntry = { ...entry };
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (typeof patch.webhookUrl === 'string') next.webhookUrl = patch.webhookUrl;
  if (Array.isArray(patch.allowedUsers)) {
    next.allowedUsers = patch.allowedUsers.filter((u): u is string => typeof u === 'string');
  }
  if (Array.isArray(patch.allowedChannels)) {
    next.allowedChannels = patch.allowedChannels.filter((c): c is string => typeof c === 'string');
  }
  return next;
}

export function registerChannelsIpcHandlers(): void {
  // Existing read-only runtime status (unchanged).
  ipcMain.handle('channels.status', async () => {
    try {
      return await getChannelGatewayStatusForReview();
    } catch (err) {
      logError('[channels.status] failed:', err);
      return {
        error: err instanceof Error ? err.message : String(err),
        items: [],
        ok: false,
        report: null,
      } satisfies ChannelGatewayStatusPayload;
    }
  });

  // List the configurable channels + their state (secret presence only, never
  // the value). Merges channels.json with the encrypted store and runtime status.
  ipcMain.handle(
    'channels.listConfig',
    async (_event, opts?: { configPath?: string }): Promise<ChannelsConfigResult> => {
      const { path, config } = readChannelsConfig(opts?.configPath);
      try {
        const creds = await loadCredentialManager();
        const runtime = await runtimeStatusByType();
        const channels = config.channels
          .filter((e): e is ChannelConfigEntry => Boolean(e) && typeof e.type === 'string')
          .map((entry) => {
            let hasSecretInStore = false;
            try {
              hasSecretInStore = creds?.hasCredential(channelSecretKey(entry.type)) ?? false;
            } catch (error) {
              logError('[channels.listConfig] hasCredential failed:', error);
            }
            return toConfigView(entry, hasSecretInStore, runtime);
          });
        return { ok: true, path, channels, catalog: [...CHANNEL_CATALOG] };
      } catch (error) {
        logError('[channels.listConfig] failed:', error);
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          path,
          channels: [],
          catalog: [...CHANNEL_CATALOG],
        };
      }
    },
  );

  // Upsert a channel's NON-SECRET config (enabled / webhookUrl / allow-lists). A
  // `token` or other secret key in the patch is stripped so it can never land in
  // channels.json — secrets go through `channels.setSecret` only.
  ipcMain.handle(
    'channels.setConfig',
    async (
      _event,
      type: unknown,
      patch: unknown,
      opts?: { configPath?: string },
    ): Promise<ChannelMutationResult> => {
      if (!isValidType(type)) return { ok: false, error: 'invalid channel type' };
      if (!patch || typeof patch !== 'object') return { ok: false, error: 'invalid patch' };
      const p = patch as Record<string, unknown>;
      const cleanPatch: ConfigPatch = {};
      if (typeof p.enabled === 'boolean') cleanPatch.enabled = p.enabled;
      if (typeof p.webhookUrl === 'string') cleanPatch.webhookUrl = p.webhookUrl;
      if (Array.isArray(p.allowedUsers)) cleanPatch.allowedUsers = p.allowedUsers as string[];
      if (Array.isArray(p.allowedChannels)) cleanPatch.allowedChannels = p.allowedChannels as string[];
      try {
        const { path, config } = readChannelsConfig(opts?.configPath);
        const idx = config.channels.findIndex((c) => c.type === type);
        if (idx >= 0) {
          const existing = config.channels[idx];
          if (existing) config.channels[idx] = applyPatch(existing, cleanPatch);
        } else {
          config.channels.push(applyPatch({ type, enabled: cleanPatch.enabled ?? false }, cleanPatch));
        }
        writeChannelsConfig(path, config);
        return { ok: true };
      } catch (error) {
        logError('[channels.setConfig] failed:', error);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  // Enable / disable a channel (a focused toggle over setConfig).
  ipcMain.handle(
    'channels.setEnabled',
    async (_event, type: unknown, enabled: unknown, opts?: { configPath?: string }): Promise<ChannelMutationResult> => {
      if (!isValidType(type)) return { ok: false, error: 'invalid channel type' };
      if (typeof enabled !== 'boolean') return { ok: false, error: 'enabled must be a boolean' };
      try {
        const { path, config } = readChannelsConfig(opts?.configPath);
        const idx = config.channels.findIndex((c) => c.type === type);
        if (idx >= 0) {
          const existing = config.channels[idx];
          if (existing) existing.enabled = enabled;
        } else {
          config.channels.push({ type, enabled });
        }
        writeChannelsConfig(path, config);
        return { ok: true };
      } catch (error) {
        logError('[channels.setEnabled] failed:', error);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  // Store a channel's token in the ENCRYPTED secret store. Write-only: the value
  // is never returned and never logged (the store logs the key name only).
  ipcMain.handle(
    'channels.setSecret',
    async (_event, type: unknown, token: unknown): Promise<ChannelMutationResult> => {
      if (!isValidType(type)) return { ok: false, error: 'invalid channel type' };
      if (typeof token !== 'string' || !token.trim()) return { ok: false, error: 'secret must be a non-empty string' };
      try {
        const creds = await loadCredentialManager();
        if (!creds) return { ok: false, error: 'secret store unavailable' };
        creds.setCredential(channelSecretKey(type), token);
        return { ok: true };
      } catch (error) {
        // NB: never include `token` — only the (secret-free) error.
        logError('[channels.setSecret] failed for', typeof type === 'string' ? type : '?', error);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  // Remove a channel's stored token.
  ipcMain.handle('channels.deleteSecret', async (_event, type: unknown): Promise<ChannelMutationResult> => {
    if (!isValidType(type)) return { ok: false, error: 'invalid channel type' };
    try {
      const creds = await loadCredentialManager();
      if (!creds) return { ok: false, error: 'secret store unavailable' };
      creds.deleteCredential(channelSecretKey(type));
      return { ok: true };
    } catch (error) {
      logError('[channels.deleteSecret] failed:', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Remove a channel entry entirely (config + its stored secret).
  ipcMain.handle(
    'channels.removeChannel',
    async (_event, type: unknown, opts?: { configPath?: string }): Promise<ChannelMutationResult> => {
      if (!isValidType(type)) return { ok: false, error: 'invalid channel type' };
      try {
        const { path, config } = readChannelsConfig(opts?.configPath);
        config.channels = config.channels.filter((c) => c.type !== type);
        writeChannelsConfig(path, config);
        const creds = await loadCredentialManager();
        try {
          creds?.deleteCredential(channelSecretKey(type));
        } catch (error) {
          logError('[channels.removeChannel] secret cleanup failed:', error);
        }
        return { ok: true };
      } catch (error) {
        logError('[channels.removeChannel] failed:', error);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
}
