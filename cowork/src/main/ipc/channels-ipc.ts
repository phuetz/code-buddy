/**
 * Channels IPC — surfaces the core channel layer to Cowork.
 *
 * `channels.status` stays READ-ONLY (per-channel runtime connection status, the
 * free-form `info` blob dropped server-side). Phase 5 adds a CONFIG surface on
 * top so the GUI can add / edit / enable / disable a channel and set its secrets —
 * without ever moving the channel/secret logic out of the core:
 *
 *   - `channels.listConfig` — the configurable channels + their state, merged
 *     with runtime status. NEVER returns a secret value: each entry reports only
 *     secret-presence booleans.
 *   - `channels.setConfig` / `channels.setEnabled` — write the NON-SECRET fields
 *     (channel-specific options, webhook URL, allow-lists) into
 *     `~/.codebuddy/channels.json` (mode 0600).
 *     A `token`/secret key in the patch is stripped defensively so a secret can
 *     never leak into that JSON.
 *   - `channels.setSecret` / `channels.deleteSecret` — named credentials are stored via
 *     the core's ENCRYPTED secret store (`CredentialManager`, AES-256-GCM,
 *     `~/.codebuddy/credentials.enc`, mode 0600) under the key
 *     `channel:<type>:<name>` (the primary remains `token` for compatibility).
 *     The value is write-only: it is never echoed back
 *     to the renderer and never logged (`CredentialManager` logs the key name
 *     only).
 *
 * All handlers never-throw: an invalid config / unavailable core module degrades
 * to a clean `{ ok: false, error }` rather than crashing the main process.
 *
 * @module main/ipc/channels-ipc
 */

import { ipcMain } from 'electron';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
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

type ChannelFieldValue = string | number | boolean | string[];
interface ChannelFieldDefinition {
  key: string;
  label: string;
  kind: 'text' | 'url' | 'number' | 'boolean' | 'string-list' | 'select' | 'secret';
  location: 'root' | 'options';
  required?: boolean;
  primarySecret?: boolean;
  placeholder?: string;
  choices?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
}
export interface ChannelCatalogEntry {
  type: string;
  label: string;
  description: string;
  fields: ChannelFieldDefinition[];
}
interface ValidatedConfigPatch {
  enabled?: boolean;
  webhookUrl?: string;
  allowedUsers?: string[];
  allowedChannels?: string[];
  options?: Record<string, ChannelFieldValue>;
  unsetOptions?: string[];
}
interface ChannelSchemaModule {
  getChannelConfigDefinitions: () => ChannelCatalogEntry[];
  getChannelConfigDefinition: (type: string) => ChannelCatalogEntry | undefined;
  getChannelSecretFields: (type: string) => ChannelFieldDefinition[];
  channelSecretStorageName: (field: ChannelFieldDefinition) => string;
  validateChannelConfigPatch: (
    type: string,
    patch: unknown,
  ) => { ok: true; patch: ValidatedConfigPatch } | { ok: false; error: string };
  validateChannelForEnable: (
    type: string,
    entry: ChannelConfigEntry,
    secretPresence: Record<string, boolean>,
  ) => { ok: true } | { ok: false; error: string };
}

async function loadChannelSchema(): Promise<ChannelSchemaModule | null> {
  return loadCoreModule<ChannelSchemaModule>('channels/channel-config-schema.js');
}

function channelSecretKey(type: string, storageName = 'token'): string {
  return `channel:${type}:${storageName}`;
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
  [key: string]: unknown;
}

function channelsConfigCandidates(configPath?: string): string[] {
  if (configPath && configPath.trim()) return [configPath];
  const envPath = process.env.CODEBUDDY_CHANNEL_CONFIG?.trim();
  if (envPath) return [envPath];
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
      return { path: p, config: { ...parsed, channels } };
    } catch (error) {
      throw new Error(
        `Cannot read ${p}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  // Nothing on disk yet — write target is the last candidate (home).
  const target = candidates[candidates.length - 1] ?? join(process.cwd(), '.codebuddy', 'channels.json');
  return { path: target, config: { channels: [] } };
}

function writeChannelsConfig(path: string, config: ChannelsConfigFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporaryPath, path);
  chmodSync(path, 0o600);
}

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
  /** Presence by form field; values never cross IPC. */
  hasSecrets: Record<string, boolean>;
  /** Plaintext legacy presence by field; still booleans only. */
  legacyPlaintextSecrets: Record<string, boolean>;
  hasWebhookUrl: boolean;
  webhookUrl?: string;
  allowedUsers: string[];
  allowedChannels: string[];
  optionKeys: string[];
  /** Editable, non-secret values declared by the core schema. */
  values: Record<string, ChannelFieldValue>;
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
  definition: ChannelCatalogEntry | undefined,
  hasSecrets: Record<string, boolean>,
  legacyPlaintextSecrets: Record<string, boolean>,
  runtime: Map<string, { connected: boolean; authenticated: boolean; lastActivity?: number; error?: string }>,
): ChannelConfigView {
  const rt = runtime.get(entry.type);
  const values: Record<string, ChannelFieldValue> = {};
  for (const field of definition?.fields ?? []) {
    if (field.kind === 'secret') continue;
    const value = field.location === 'root'
      ? field.key === 'webhookUrl' ? entry.webhookUrl : undefined
      : entry.options?.[field.key];
    if (
      typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
      || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
    ) {
      values[field.key] = value as ChannelFieldValue;
    }
  }
  const view: ChannelConfigView = {
    type: entry.type,
    enabled: entry.enabled === true,
    configured: true,
    // A legacy hand-written config may carry a plaintext token; report presence only.
    hasSecret: Object.values(hasSecrets).some(Boolean) || Boolean(entry.token),
    hasSecrets,
    legacyPlaintextSecrets,
    hasWebhookUrl: Boolean(entry.webhookUrl),
    allowedUsers: Array.isArray(entry.allowedUsers) ? entry.allowedUsers.filter((u): u is string => typeof u === 'string') : [],
    allowedChannels: Array.isArray(entry.allowedChannels)
      ? entry.allowedChannels.filter((c): c is string => typeof c === 'string')
      : [],
    optionKeys: entry.options && typeof entry.options === 'object' ? Object.keys(entry.options).sort() : [],
    values,
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
  options?: Record<string, ChannelFieldValue>;
  unsetOptions?: string[];
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
  if (patch.options || patch.unsetOptions) {
    const options = { ...(entry.options ?? {}), ...(patch.options ?? {}) };
    for (const key of patch.unsetOptions ?? []) delete options[key];
    if (Object.keys(options).length > 0) next.options = options;
    else delete next.options;
  }
  return next;
}

function secretPresenceFor(
  type: string,
  entry: ChannelConfigEntry,
  fields: ChannelFieldDefinition[],
  schema: ChannelSchemaModule,
  credentials: CredentialManagerLike | null,
): Record<string, boolean> {
  const legacyPresence = legacySecretPresenceFor(entry, fields);
  const presence: Record<string, boolean> = {};
  for (const field of fields) {
    let stored = false;
    try {
      stored = credentials?.hasCredential(
        channelSecretKey(type, schema.channelSecretStorageName(field)),
      ) ?? false;
    } catch (error) {
      logError('[channels] secret presence check failed:', error);
    }
    presence[field.key] = stored || legacyPresence[field.key] === true;
  }
  return presence;
}

function legacySecretPresenceFor(
  entry: ChannelConfigEntry,
  fields: ChannelFieldDefinition[],
): Record<string, boolean> {
  const presence: Record<string, boolean> = {};
  for (const field of fields) {
    const candidates = field.primarySecret
      ? [entry.token, entry.options?.[field.key]]
      : [entry.options?.[field.key]];
    presence[field.key] = candidates.some(
      (value) => typeof value === 'string' && value.length > 0,
    );
  }
  return presence;
}

/** Remove the plaintext equivalent after a vault mutation. */
function purgeLegacySecret(
  type: string,
  field: ChannelFieldDefinition,
  configPath?: string,
): void {
  const { path, config } = readChannelsConfig(configPath);
  const index = config.channels.findIndex((entry) => entry.type === type);
  const entry = config.channels[index];
  if (index < 0 || !entry) return;

  let changed = false;
  if (field.primarySecret && Object.prototype.hasOwnProperty.call(entry, 'token')) {
    delete entry.token;
    changed = true;
  }
  if (entry.options && Object.prototype.hasOwnProperty.call(entry.options, field.key)) {
    const options = { ...entry.options };
    delete options[field.key];
    if (Object.keys(options).length > 0) entry.options = options;
    else delete entry.options;
    changed = true;
  }
  if (changed) writeChannelsConfig(path, config);
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
      let fallbackPath = '';
      let catalog: ChannelCatalogEntry[] = [];
      try {
        const schema = await loadChannelSchema();
        if (!schema) {
          return { ok: false, error: 'channel config schema unavailable', path: fallbackPath, channels: [], catalog };
        }
        catalog = schema.getChannelConfigDefinitions();
        fallbackPath = channelsConfigCandidates(opts?.configPath).at(-1) ?? '';
        const { path, config } = readChannelsConfig(opts?.configPath);
        const creds = await loadCredentialManager();
        const runtime = await runtimeStatusByType();
        const channels = config.channels
          .filter((e): e is ChannelConfigEntry => Boolean(e) && typeof e.type === 'string')
          .map((entry) => {
            const definition = schema.getChannelConfigDefinition(entry.type);
            const secretFields = schema.getChannelSecretFields(entry.type);
            const hasSecrets = secretPresenceFor(
              entry.type,
              entry,
              secretFields,
              schema,
              creds,
            );
            return toConfigView(
              entry,
              definition,
              hasSecrets,
              legacySecretPresenceFor(entry, secretFields),
              runtime,
            );
          });
        return { ok: true, path, channels, catalog };
      } catch (error) {
        logError('[channels.listConfig] failed:', error);
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          path: fallbackPath,
          channels: [],
          catalog,
        };
      }
    },
  );

  // Upsert a channel's declared NON-SECRET config. A
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
      try {
        const schema = await loadChannelSchema();
        if (!schema) return { ok: false, error: 'channel config schema unavailable' };
        const validated = schema.validateChannelConfigPatch(type, patch);
        if (!validated.ok) return validated;
        const cleanPatch = validated.patch;
        // Resolve every async dependency before the read-modify-write section.
        // Once the file is read, the synchronous write completes in the same
        // event-loop turn so concurrent IPC mutations cannot overwrite it.
        const credentials = await loadCredentialManager();
        const { path, config } = readChannelsConfig(opts?.configPath);
        const idx = config.channels.findIndex((c) => c.type === type);
        let nextEntry: ChannelConfigEntry;
        if (idx >= 0) {
          const existing = config.channels[idx];
          if (!existing) return { ok: false, error: 'channel config entry unavailable' };
          nextEntry = applyPatch(existing, cleanPatch);
          config.channels[idx] = nextEntry;
        } else {
          nextEntry = applyPatch({ type, enabled: cleanPatch.enabled ?? false }, cleanPatch);
          config.channels.push(nextEntry);
        }
        if (nextEntry.enabled) {
          const presence = secretPresenceFor(
            type,
            nextEntry,
            schema.getChannelSecretFields(type),
            schema,
            credentials,
          );
          const enableValidation = schema.validateChannelForEnable(type, nextEntry, presence);
          if (!enableValidation.ok) return enableValidation;
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
        const schema = await loadChannelSchema();
        if (!schema?.getChannelConfigDefinition(type)) {
          return { ok: false, error: `unsupported channel type: ${type}` };
        }
        // Resolve before entering the synchronous read-modify-write section.
        const credentials = await loadCredentialManager();
        const { path, config } = readChannelsConfig(opts?.configPath);
        const idx = config.channels.findIndex((c) => c.type === type);
        let nextEntry: ChannelConfigEntry;
        if (idx >= 0) {
          const existing = config.channels[idx];
          if (!existing) return { ok: false, error: 'channel config entry unavailable' };
          nextEntry = { ...existing, enabled };
          config.channels[idx] = nextEntry;
        } else {
          nextEntry = { type, enabled };
          config.channels.push(nextEntry);
        }
        if (enabled) {
          const presence = secretPresenceFor(
            type,
            nextEntry,
            schema.getChannelSecretFields(type),
            schema,
            credentials,
          );
          const validation = schema.validateChannelForEnable(type, nextEntry, presence);
          if (!validation.ok) return validation;
        }
        writeChannelsConfig(path, config);
        return { ok: true };
      } catch (error) {
        logError('[channels.setEnabled] failed:', error);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  // Store a channel credential in the ENCRYPTED secret store. Write-only: the value
  // is never returned and never logged (the store logs the key name only).
  ipcMain.handle(
    'channels.setSecret',
    async (
      _event,
      type: unknown,
      fieldKey: unknown,
      secretValue: unknown,
      opts?: { configPath?: string },
    ): Promise<ChannelMutationResult> => {
      if (!isValidType(type)) return { ok: false, error: 'invalid channel type' };
      if (typeof fieldKey !== 'string') return { ok: false, error: 'invalid secret field' };
      if (typeof secretValue !== 'string' || !secretValue.trim()) {
        return { ok: false, error: 'secret must be a non-empty string' };
      }
      try {
        const schema = await loadChannelSchema();
        const secretFields = schema?.getChannelSecretFields(type) ?? [];
        const field = secretFields.find((candidate) => candidate.key === fieldKey)
          ?? (fieldKey === 'token' ? secretFields.find((candidate) => candidate.primarySecret) : undefined);
        if (!schema || !field) return { ok: false, error: 'invalid secret field' };
        const creds = await loadCredentialManager();
        if (!creds) return { ok: false, error: 'secret store unavailable' };
        creds.setCredential(
          channelSecretKey(type, schema.channelSecretStorageName(field)),
          secretValue,
        );
        purgeLegacySecret(type, field, opts?.configPath);
        return { ok: true };
      } catch (error) {
        // NB: never include the secret value — only the (secret-free) error.
        logError('[channels.setSecret] failed for', typeof type === 'string' ? type : '?', error);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  // Remove one stored channel credential.
  ipcMain.handle('channels.deleteSecret', async (
    _event,
    type: unknown,
    fieldKey: unknown = 'token',
    opts?: { configPath?: string },
  ): Promise<ChannelMutationResult> => {
    if (!isValidType(type)) return { ok: false, error: 'invalid channel type' };
    if (typeof fieldKey !== 'string') return { ok: false, error: 'invalid secret field' };
    try {
      const schema = await loadChannelSchema();
      const secretFields = schema?.getChannelSecretFields(type) ?? [];
      const field = secretFields.find((candidate) => candidate.key === fieldKey)
        ?? (fieldKey === 'token' ? secretFields.find((candidate) => candidate.primarySecret) : undefined);
      if (!schema || !field) return { ok: false, error: 'invalid secret field' };
      const creds = await loadCredentialManager();
      if (!creds) return { ok: false, error: 'secret store unavailable' };
      creds.deleteCredential(channelSecretKey(type, schema.channelSecretStorageName(field)));
      purgeLegacySecret(type, field, opts?.configPath);
      return { ok: true };
    } catch (error) {
      logError('[channels.deleteSecret] failed:', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Remove a channel entry entirely (config + all of its stored secrets).
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
          const schema = await loadChannelSchema();
          const storageNames = new Set<string>(['token']);
          for (const field of schema?.getChannelSecretFields(type) ?? []) {
            storageNames.add(schema?.channelSecretStorageName(field) ?? field.key);
          }
          for (const storageName of storageNames) {
            creds?.deleteCredential(channelSecretKey(type, storageName));
          }
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
