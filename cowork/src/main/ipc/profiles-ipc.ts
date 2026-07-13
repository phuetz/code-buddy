/**
 * Profiles IPC (Phase A1) — manage isolated Code Buddy config profiles
 * (`[profiles.<name>]` sections in the user toml) from Cowork.
 *
 * Backed by the root backend's toml config (`src/config/toml-config.js`),
 * loaded through {@link loadCoreModule}. The CLI activates a profile with
 * `buddy --profile <name>` and deep-merges `[profiles.<name>]` on top of the
 * base config (`ConfigManager.applyProfile`).
 *
 * Persistence notes (why this file hand-rolls toml writes):
 *  - `ConfigManager.saveUserConfig()` routes through `serializeTOML`, which
 *    only emits a *subset* of sections (providers, models, tool_config,
 *    middleware, ui, agent, integrations). It silently drops `profiles`,
 *    `model_pairs`, `agent_defaults`, `advisor`, etc. Calling it from here
 *    would destroy large parts of a real user config. So `create` appends a
 *    raw `[profiles.<name>]` block to the user toml, preserving the rest
 *    verbatim.
 *  - The toml has no concept of an "active profile" (the CLI only takes
 *    `--profile` at launch). Cowork persists the selected profile in a
 *    dedicated light file (`~/.codebuddy/cowork-active-profile.json`).
 *    `switch` writes it and returns `requiresRestart: true` — the embedded
 *    agent runtime must be relaunched with the profile to take effect.
 *    Effective relaunch wiring is a follow-up (no launch path currently
 *    consumes a Code Buddy profile arg).
 *
 * Reads always parse the user-global toml fresh via `fs` + the core
 * `parseTOML` (not the cached `getConfigManager()` singleton, which merges a
 * project config from `process.cwd()` — irrelevant and stale in the Electron
 * main process), so the renderer sees read-after-write consistency.
 *
 * @module main/ipc/profiles-ipc
 */

import { ipcMain } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { generateKeyPairSync, sign, verify } from 'crypto';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { logError, log } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';

/** Where the user-global Code Buddy toml lives (mirrors `toml-config.ts`). */
const CONFIG_DIR = join(homedir(), '.codebuddy');
const USER_CONFIG_FILE = join(CONFIG_DIR, 'config.toml');
/** Cowork-owned record of the selected profile (toml has no such field). */
const ACTIVE_PROFILE_FILE = join(CONFIG_DIR, 'cowork-active-profile.json');
const PROFILE_SIGNING_PRIVATE_KEY = join(CONFIG_DIR, 'profile-signing-key.pem');
const PROFILE_SIGNING_PUBLIC_KEY = join(CONFIG_DIR, 'profile-signing-key.pub.pem');

/**
 * Allowed profile name shape. Closes toml sub-table injection (`.`, `[`, `]`,
 * `"`, `=`, `#`), whitespace/newlines, and path traversal (`/`, `\`, `..`) in
 * one rule. Must start alphanumeric; max 64 chars.
 */
const PROFILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

type TomlMod = {
  parseTOML(content: string): Record<string, unknown>;
};

interface SignedProfilePackage {
  format: 'code-buddy-profile/v1';
  name: string;
  createdAt: string;
  toml: string;
  publicKey: string;
  signature: string;
}

function ensureProfileSigningKeys(): { privateKey: string; publicKey: string } {
  if (!existsSync(PROFILE_SIGNING_PRIVATE_KEY) || !existsSync(PROFILE_SIGNING_PUBLIC_KEY)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const pair = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    writeFileSync(PROFILE_SIGNING_PRIVATE_KEY, pair.privateKey, { mode: 0o600 });
    writeFileSync(PROFILE_SIGNING_PUBLIC_KEY, pair.publicKey, { mode: 0o644 });
  }
  chmodSync(PROFILE_SIGNING_PRIVATE_KEY, 0o600);
  return {
    privateKey: readFileSync(PROFILE_SIGNING_PRIVATE_KEY, 'utf-8'),
    publicKey: readFileSync(PROFILE_SIGNING_PUBLIC_KEY, 'utf-8'),
  };
}

function profilePackagePayload(input: Pick<SignedProfilePackage, 'format' | 'name' | 'createdAt' | 'toml'>): Buffer {
  return Buffer.from(JSON.stringify(input), 'utf-8');
}

function extractProfileToml(name: string): string {
  if (!existsSync(USER_CONFIG_FILE)) throw new Error('User config does not exist');
  const lines = readFileSync(USER_CONFIG_FILE, 'utf-8').split(/\r?\n/);
  const prefix = `[profiles.${name}`;
  const result: string[] = [];
  let capturing = false;
  for (const line of lines) {
    const header = line.trim().startsWith('[') ? line.trim() : null;
    if (header) {
      if (header.startsWith(prefix) && (header[prefix.length] === ']' || header[prefix.length] === '.')) {
        capturing = true;
      } else if (capturing) {
        capturing = false;
      }
    }
    if (capturing) result.push(line);
  }
  if (result.length === 0) throw new Error(`Profile not found: ${name}`);
  const toml = `${result.join('\n').trim()}\n`;
  if (/^\s*(api[_-]?key|token|secret|password)\s*=/im.test(toml)) {
    throw new Error('Profile export refused: move secrets to SecretRef or the encrypted credential store first');
  }
  return toml;
}

export interface ProfileSummary {
  /** Profile name (the `<name>` in `[profiles.<name>]`). */
  name: string;
  /** Whether this profile is the one Cowork has selected as active. */
  active: boolean;
}

export interface ProfilesListResult {
  ok: boolean;
  error?: string;
  /** All profiles defined in the user toml, plus their active flag. */
  profiles: ProfileSummary[];
  /** The selected active profile name, or null for "no profile (base config)". */
  active: string | null;
}

export interface ProfilesMutationResult {
  ok: boolean;
  error?: string;
  /** True for `switch` — the embedded agent runtime must relaunch to apply. */
  requiresRestart?: boolean;
  profiles?: ProfileSummary[];
  active?: string | null;
}

/** Validate a profile name; returns an error string or null if OK. */
function validateProfileName(name: unknown): string | null {
  if (typeof name !== 'string') return 'Profile name must be a string';
  const trimmed = name.trim();
  if (!trimmed) return 'Profile name is required';
  if (!PROFILE_NAME_RE.test(trimmed)) {
    return 'Invalid profile name: use letters, digits, "-" or "_" (max 64, must start alphanumeric)';
  }
  return null;
}

/**
 * Read the distinct profile names from the user toml.
 *
 * `parseTOML` flattens `[profiles.deep-review.agent]` into a sibling key
 * `"deep-review.agent"` under `profiles` (it is a 2-level parser), so we must
 * derive the real profile set from the segment *before the first dot* and
 * dedupe — otherwise nested sub-tables show up as phantom profiles.
 */
async function readProfileNames(): Promise<string[]> {
  if (!existsSync(USER_CONFIG_FILE)) return [];
  const mod = await loadCoreModule<TomlMod>('config/toml-config.js');
  if (!mod?.parseTOML) {
    throw new Error('core toml-config module unavailable');
  }
  const parsed = mod.parseTOML(readFileSync(USER_CONFIG_FILE, 'utf-8'));
  const profiles = parsed.profiles;
  if (!profiles || typeof profiles !== 'object') return [];
  const names = new Set<string>();
  for (const key of Object.keys(profiles as Record<string, unknown>)) {
    const head = key.split('.')[0];
    if (head) names.add(head);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/** Read Cowork's selected active profile, or null if none / file missing. */
export function readActiveProfile(): string | null {
  if (!existsSync(ACTIVE_PROFILE_FILE)) return null;
  try {
    const raw = JSON.parse(readFileSync(ACTIVE_PROFILE_FILE, 'utf-8')) as { active?: unknown };
    return typeof raw.active === 'string' && raw.active ? raw.active : null;
  } catch {
    return null;
  }
}

/** Persist Cowork's selected active profile (null clears the selection). */
function writeActiveProfile(name: string | null): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(ACTIVE_PROFILE_FILE, JSON.stringify({ active: name }, null, 2));
}

/**
 * Append a fresh `[profiles.<name>]` block to the user toml, preserving the
 * rest of the file verbatim. When `deriveFromDefault` is true, seeds the
 * profile with the current base `active_model` so it is a usable override of
 * the default rather than an empty section.
 */
function appendProfileBlock(name: string, baseActiveModel: string | null): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(dirname(USER_CONFIG_FILE), { recursive: true });
  }
  const existing = existsSync(USER_CONFIG_FILE) ? readFileSync(USER_CONFIG_FILE, 'utf-8') : '';
  const lines: string[] = [];
  // Ensure a clean separation from prior content.
  if (existing.length > 0 && !existing.endsWith('\n')) lines.push('');
  lines.push('');
  lines.push(`# Profile created from Cowork on ${new Date().toISOString()}`);
  lines.push(`[profiles.${name}]`);
  if (baseActiveModel) {
    lines.push(`active_model = "${baseActiveModel}"`);
  }
  lines.push('');
  writeFileSync(USER_CONFIG_FILE, existing + lines.join('\n'));
}

/** Read the base config's `active_model` (for seeding new profiles). */
async function readBaseActiveModel(): Promise<string | null> {
  if (!existsSync(USER_CONFIG_FILE)) return null;
  const mod = await loadCoreModule<TomlMod>('config/toml-config.js');
  if (!mod?.parseTOML) return null;
  const parsed = mod.parseTOML(readFileSync(USER_CONFIG_FILE, 'utf-8'));
  return typeof parsed.active_model === 'string' ? parsed.active_model : null;
}

async function buildListResult(): Promise<ProfilesListResult> {
  const names = await readProfileNames();
  let active = readActiveProfile();
  // If the selected profile was deleted out-of-band, don't report a phantom.
  if (active && !names.includes(active)) {
    active = null;
  }
  return {
    ok: true,
    profiles: names.map((name) => ({ name, active: name === active })),
    active,
  };
}

export function registerProfilesIpcHandlers(): void {
  // List all toml profiles + the active selection.
  ipcMain.handle('profiles.list', async (): Promise<ProfilesListResult> => {
    try {
      return await buildListResult();
    } catch (err) {
      logError('[profiles.list] failed:', err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        profiles: [],
        active: null,
      };
    }
  });

  // The currently selected active profile name (or null).
  ipcMain.handle(
    'profiles.active',
    async (): Promise<{ ok: boolean; error?: string; active: string | null }> => {
      try {
        const names = await readProfileNames();
        let active = readActiveProfile();
        if (active && !names.includes(active)) active = null;
        return { ok: true, active };
      } catch (err) {
        logError('[profiles.active] failed:', err);
        return { ok: false, error: err instanceof Error ? err.message : String(err), active: null };
      }
    },
  );

  // Create a new `[profiles.<name>]` section, seeded from the base config.
  ipcMain.handle(
    'profiles.create',
    async (_event, name: string): Promise<ProfilesMutationResult> => {
      try {
        const nameError = validateProfileName(name);
        if (nameError) return { ok: false, error: nameError };
        const trimmed = (name as string).trim();

        const existing = await readProfileNames();
        if (existing.includes(trimmed)) {
          return { ok: false, error: `Profile "${trimmed}" already exists` };
        }

        const baseActiveModel = await readBaseActiveModel();
        appendProfileBlock(trimmed, baseActiveModel);
        log('[profiles.create] created profile', trimmed);

        const list = await buildListResult();
        return { ok: true, profiles: list.profiles, active: list.active };
      } catch (err) {
        logError('[profiles.create] failed:', err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // Select a profile as active. Persists the selection and signals that the
  // embedded agent runtime must relaunch to apply it (no live switch).
  ipcMain.handle(
    'profiles.switch',
    async (_event, name: string | null): Promise<ProfilesMutationResult> => {
      try {
        if (name !== null) {
          const nameError = validateProfileName(name);
          if (nameError) return { ok: false, error: nameError };
        }
        const target = name === null ? null : (name as string).trim();

        if (target !== null) {
          const existing = await readProfileNames();
          if (!existing.includes(target)) {
            return { ok: false, error: `Profile "${target}" not found` };
          }
        }

        writeActiveProfile(target);
        log('[profiles.switch] selected profile', target ?? '(base config)');

        const list = await buildListResult();
        return {
          ok: true,
          requiresRestart: true,
          profiles: list.profiles,
          active: list.active,
        };
      } catch (err) {
        logError('[profiles.switch] failed:', err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle('profiles.export', async (_event, name: string) => {
    try {
      const nameError = validateProfileName(name);
      if (nameError) return { ok: false, error: nameError };
      const toml = extractProfileToml(name.trim());
      const unsigned = {
        format: 'code-buddy-profile/v1' as const,
        name: name.trim(),
        createdAt: new Date().toISOString(),
        toml,
      };
      const keys = ensureProfileSigningKeys();
      const signature = sign(null, profilePackagePayload(unsigned), keys.privateKey).toString('base64');
      return { ok: true, profile: { ...unsigned, publicKey: keys.publicKey, signature } satisfies SignedProfilePackage };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('profiles.import', async (_event, candidate: unknown): Promise<ProfilesMutationResult> => {
    try {
      if (!candidate || typeof candidate !== 'object') return { ok: false, error: 'Invalid profile package' };
      const profile = candidate as Partial<SignedProfilePackage>;
      if (profile.format !== 'code-buddy-profile/v1' || !profile.name || !profile.createdAt || !profile.toml || !profile.publicKey || !profile.signature) {
        return { ok: false, error: 'Incomplete profile package' };
      }
      const nameError = validateProfileName(profile.name);
      if (nameError) return { ok: false, error: nameError };
      const unsigned = { format: profile.format, name: profile.name, createdAt: profile.createdAt, toml: profile.toml };
      if (!verify(null, profilePackagePayload(unsigned), profile.publicKey, Buffer.from(profile.signature, 'base64'))) {
        return { ok: false, error: 'Profile signature verification failed' };
      }
      if (/^\s*(api[_-]?key|token|secret|password)\s*=/im.test(profile.toml)) {
        return { ok: false, error: 'Profile contains embedded secrets' };
      }
      const expectedHeader = `[profiles.${profile.name}]`;
      if (!profile.toml.includes(expectedHeader)) return { ok: false, error: 'Profile name does not match TOML payload' };
      const existing = await readProfileNames();
      if (existing.includes(profile.name)) return { ok: false, error: `Profile "${profile.name}" already exists` };
      mkdirSync(CONFIG_DIR, { recursive: true });
      const current = existsSync(USER_CONFIG_FILE) ? readFileSync(USER_CONFIG_FILE, 'utf-8') : '';
      writeFileSync(USER_CONFIG_FILE, `${current.trimEnd()}\n\n# Imported signed profile\n${profile.toml.trim()}\n`);
      const list = await buildListResult();
      return { ok: true, profiles: list.profiles, active: list.active };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
