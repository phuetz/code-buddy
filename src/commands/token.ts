/**
 * `buddy token` / `buddy fleet token` — mint a JWT for the API and the mobile PWA.
 *
 * The signing secret is never printed or logged. Resolve order:
 * `--env <file>` → `JWT_SECRET` → `~/.codebuddy/server.env`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';

import type { ApiScope } from '../server/types.js';
import { decodeToken, generateToken } from '../server/auth/jwt.js';

export const TOKEN_ROLE_SCOPES = {
  user: ['chat', 'chat:stream', 'sessions', 'tools'],
  admin: ['admin'],
} as const;

export type TokenRole = keyof typeof TOKEN_ROLE_SCOPES;

export interface TokenMintOptions {
  env?: string;
  user?: string;
  role?: string;
  days?: number | string;
  ttl?: string;
  scopes?: string;
  url?: string;
  qr?: boolean;
  json?: boolean;
  telegram?: boolean;
}

export type SpawnSyncFn = (
  command: string,
  args: readonly string[],
  options: { encoding: 'utf8'; timeout: number; windowsHide?: boolean },
) => {
  status: number | null;
  stdout: string | Buffer;
  stderr: string | Buffer;
  error?: NodeJS.ErrnoException;
};

export interface TokenCommandDependencies {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  readFile?: (filePath: string) => string;
  exists?: (filePath: string) => boolean;
  spawn?: SpawnSyncFn;
  nowMs?: () => number;
  sendTelegram?: (text: string) => Promise<boolean>;
}

export interface MintedToken {
  token: string;
  user: string;
  role: TokenRole;
  scopes: string[];
  expiresAt: string;
  expiresIn: string;
  url: string;
  qrHint?: string;
}

export type MintTokenResult =
  | { ok: true; minted: MintedToken; qrAnsi?: string; telegramSent?: boolean; telegramError?: string }
  | { ok: false; error: string; exitCode: number };

const DEFAULT_USER = 'mobile';
const DEFAULT_TTL = '30d';
const MAX_DAYS = 365;
const QR_TIMEOUT_MS = 4000;

export function parseServiceEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eqIndex = withoutExport.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = withoutExport.slice(0, eqIndex).trim();
    let value = withoutExport.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) env[key] = value;
  }
  return env;
}

export function defaultScopesForRole(role: TokenRole): string[] {
  return [...TOKEN_ROLE_SCOPES[role]];
}

export function buildMobileOpenUrl(base: string, token: string): string {
  const origin = base.trim().replace(/\/+$/, '');
  return `${origin}/__codebuddy__/mobile/#token=${encodeURIComponent(token)}`;
}

function parseRole(raw: string | undefined): TokenRole | null {
  const role = (raw ?? 'user').trim().toLowerCase();
  if (role === 'user' || role === 'admin') return role;
  return null;
}

function parseDays(raw: number | string | undefined): number | null | 'invalid' {
  if (raw === undefined || raw === '') return null;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_DAYS) return 'invalid';
  return value;
}

function parseScopes(raw: string | undefined, role: TokenRole): string[] {
  if (raw === undefined || raw.trim() === '') return defaultScopesForRole(role);
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveTtl(options: TokenMintOptions): { ttl: string } | { error: string } {
  const days = parseDays(options.days);
  if (days === 'invalid') {
    return { error: `--days must be an integer between 1 and ${MAX_DAYS}` };
  }
  if (days !== null) return { ttl: `${days}d` };
  const ttl = options.ttl?.trim() || DEFAULT_TTL;
  return { ttl };
}

function resolveBaseUrl(
  options: TokenMintOptions,
  env: NodeJS.ProcessEnv,
  overlay: Record<string, string>,
): string {
  const configured = options.url?.trim()
    || overlay.CODEBUDDY_SERVER_URL?.trim()
    || env.CODEBUDDY_SERVER_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const port = overlay.CODEBUDDY_SERVER_PORT?.trim()
    || overlay.PORT?.trim()
    || env.CODEBUDDY_SERVER_PORT?.trim()
    || env.PORT?.trim()
    || '3000';
  return `http://127.0.0.1:${port}`;
}

function readEnvFile(
  filePath: string,
  deps: TokenCommandDependencies,
): { ok: true; values: Record<string, string> } | { ok: false; error: string } {
  const exists = deps.exists ?? existsSync;
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, 'utf8'));
  if (!exists(filePath)) {
    return { ok: false, error: `Fichier --env introuvable : ${filePath}` };
  }
  try {
    return { ok: true, values: parseServiceEnv(readFile(filePath)) };
  } catch {
    return { ok: false, error: `Impossible de lire le fichier d'env : ${filePath}` };
  }
}

function resolveSecret(
  options: TokenMintOptions,
  env: NodeJS.ProcessEnv,
  overlay: Record<string, string>,
  home: string,
  deps: TokenCommandDependencies,
): { secret: string } | { error: string } {
  const fromOverlay = overlay.JWT_SECRET?.trim();
  if (fromOverlay) return { secret: fromOverlay };
  const fromEnv = env.JWT_SECRET?.trim();
  if (fromEnv) return { secret: fromEnv };

  const fallback = join(home, '.codebuddy', 'server.env');
  const exists = deps.exists ?? existsSync;
  if (exists(fallback)) {
    const loaded = readEnvFile(fallback, deps);
    if (loaded.ok) {
      const fromHome = loaded.values.JWT_SECRET?.trim();
      if (fromHome) return { secret: fromHome };
    }
  }

  return {
    error:
      'JWT_SECRET is required and must match the target server\'s JWT_SECRET.\n'
      + 'Set JWT_SECRET, pass --env <service.env>, or create ~/.codebuddy/server.env.',
  };
}

export function renderQrAnsi(
  text: string,
  spawn: SpawnSyncFn = spawnSync as SpawnSyncFn,
): { ok: true; output: string } | { ok: false; hint: string } {
  const hint = 'Installez qrencode (ex. apt install qrencode) pour afficher un QR dans le terminal.';
  try {
    const result = spawn('qrencode', ['-t', 'ANSIUTF8', text], {
      encoding: 'utf8',
      timeout: QR_TIMEOUT_MS,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      return { ok: false, hint };
    }
    const output = typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? '');
    if (!output.trim()) return { ok: false, hint };
    return { ok: true, output };
  } catch {
    return { ok: false, hint };
  }
}

export async function mintBuddyToken(
  options: TokenMintOptions,
  deps: TokenCommandDependencies = {},
): Promise<MintTokenResult> {
  const env = deps.env ?? process.env;
  const home = (deps.homedir ?? osHomedir)();
  let overlay: Record<string, string> = {};

  if (options.env?.trim()) {
    const loaded = readEnvFile(options.env.trim(), deps);
    if (!loaded.ok) return { ok: false, error: loaded.error, exitCode: 2 };
    overlay = loaded.values;
  }

  const secretResult = resolveSecret(options, env, overlay, home, deps);
  if ('error' in secretResult) {
    return { ok: false, error: secretResult.error, exitCode: 2 };
  }

  const role = parseRole(options.role);
  if (!role) {
    return { ok: false, error: '--role must be user or admin', exitCode: 2 };
  }

  const ttlResult = resolveTtl(options);
  if ('error' in ttlResult) {
    return { ok: false, error: ttlResult.error, exitCode: 2 };
  }

  const user = (options.user?.trim() || DEFAULT_USER);
  const scopes = parseScopes(options.scopes, role);
  const token = generateToken(
    {
      sub: user,
      userId: user,
      scopes: scopes as ApiScope[],
      type: 'user',
      role,
    },
    secretResult.secret,
    ttlResult.ttl,
  );

  const baseUrl = resolveBaseUrl(options, env, overlay);
  const url = buildMobileOpenUrl(baseUrl, token);
  const nowMs = deps.nowMs ?? Date.now;
  const decoded = decodeToken(token);
  const expiresAt = new Date((decoded?.exp ?? Math.floor(nowMs() / 1000)) * 1000).toISOString();

  const minted: MintedToken = {
    token,
    user,
    role,
    scopes,
    expiresAt,
    expiresIn: ttlResult.ttl,
    url,
  };

  let qrAnsi: string | undefined;
  if (options.qr) {
    const qr = renderQrAnsi(url, deps.spawn ?? (spawnSync as SpawnSyncFn));
    if (qr.ok) qrAnsi = qr.output;
    else minted.qrHint = qr.hint;
  }

  let telegramSent: boolean | undefined;
  let telegramError: string | undefined;
  if (options.telegram) {
    const tokenKey = overlay.CODEBUDDY_SENSORY_ALERT_TOKEN?.trim()
      || env.CODEBUDDY_SENSORY_ALERT_TOKEN?.trim()
      || env.TELEGRAM_BOT_TOKEN?.trim();
    const chat = overlay.CODEBUDDY_SENSORY_ALERT_CHAT?.trim()
      || env.CODEBUDDY_SENSORY_ALERT_CHAT?.trim();
    if (!tokenKey || !chat) {
      telegramError =
        'Telegram non configuré : CODEBUDDY_SENSORY_ALERT_TOKEN et CODEBUDDY_SENSORY_ALERT_CHAT sont requis (variables d\'environnement ou fichier --env).';
    } else {
      const send = deps.sendTelegram ?? (async (text: string) => {
        const previousToken = process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
        const previousChat = process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
        process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = tokenKey;
        process.env.CODEBUDDY_SENSORY_ALERT_CHAT = chat;
        try {
          const { sendTelegramAlert } = await import('../sensory/alert.js');
          return await sendTelegramAlert(text);
        } finally {
          if (previousToken === undefined) delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
          else process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = previousToken;
          if (previousChat === undefined) delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
          else process.env.CODEBUDDY_SENSORY_ALERT_CHAT = previousChat;
        }
      });
      const text =
        `Jeton Code Buddy (expire le ${expiresAt}). Ouvre : ${url}\n`
        + 'Ne transmets pas ce lien ; il donne accès à l\'API et à la PWA jusqu\'à expiration.';
      try {
        telegramSent = await send(text);
        if (!telegramSent) {
          telegramError = 'Telegram : envoi échoué (le jeton a tout de même été généré).';
        }
      } catch {
        telegramSent = false;
        telegramError = 'Telegram : envoi échoué (le jeton a tout de même été généré).';
      }
    }
  }

  return { ok: true, minted, qrAnsi, telegramSent, telegramError };
}

export function printMintedToken(
  result: Extract<MintTokenResult, { ok: true }>,
  options: TokenMintOptions,
): void {
  const { minted, qrAnsi, telegramError } = result;
  if (options.json) {
    console.log(JSON.stringify({
      token: minted.token,
      user: minted.user,
      role: minted.role,
      scopes: minted.scopes,
      expiresAt: minted.expiresAt,
      expiresIn: minted.expiresIn,
      url: minted.url,
      ...(typeof result.telegramSent === 'boolean' ? { telegramSent: result.telegramSent } : {}),
    }, null, 2));
  } else {
    console.log(minted.token);
    console.log(`Expire le ${minted.expiresAt} (${minted.expiresIn})`);
    console.log(`Ouvrir : ${minted.url}`);
    if (qrAnsi) console.log(qrAnsi);
  }

  if (minted.qrHint) console.error(minted.qrHint);
  if (telegramError) console.error(telegramError);
  else if (result.telegramSent) {
    console.error(`Telegram : lien envoyé (expire le ${minted.expiresAt}).`);
  }

  if (minted.scopes.includes('peer:invoke')) {
    console.error(
      '\n# Fleet: on the other machine, join with:\n'
      + '#   /fleet listen ws://HOST:PORT/ws --jwt <token>\n'
      + '# Same JWT_SECRET, auth enabled (not --no-auth).',
    );
  }
}

function attachTokenOptions(command: Command, deps: TokenCommandDependencies = {}): Command {
  return command
    .option('--env <file>', 'Read JWT_SECRET (and Telegram keys) from a service env file')
    .option('--user <id>', 'token subject / user id', DEFAULT_USER)
    .option('--role <role>', 'user or admin', 'user')
    .option('--days <n>', `lifetime in days (1-${MAX_DAYS}); overrides --ttl`, (value: string) => Number(value))
    .option('--ttl <dur>', 'expiry, e.g. 15m / 24h / 30d', DEFAULT_TTL)
    .option('--scopes <csv>', 'override scopes (default: those of --role)')
    .option('--url <base>', 'public base URL of buddy server (default: CODEBUDDY_SERVER_URL or http://127.0.0.1:<port>)')
    .option('--qr', 'print an ANSI QR (qrencode -t ANSIUTF8)')
    .option('--json', 'machine-readable JSON on stdout')
    .option('--telegram', 'send the open URL via Telegram (CODEBUDDY_SENSORY_ALERT_TOKEN/_CHAT)')
    .action(async (options: TokenMintOptions) => {
      const result = await mintBuddyToken(options, deps);
      if (!result.ok) {
        console.error(result.error);
        process.exitCode = result.exitCode;
        return;
      }
      printMintedToken(result, options);
      if (options.telegram && !result.telegramSent) {
        process.exitCode = 1;
      }
    });
}

export function createTokenCommand(deps: TokenCommandDependencies = {}): Command {
  return attachTokenOptions(
    new Command('token')
      .description('Mint a JWT for the API and the mobile PWA (alias of buddy fleet token)'),
    deps,
  );
}

export function registerFleetTokenCommand(fleet: Command, deps: TokenCommandDependencies = {}): void {
  attachTokenOptions(
    fleet
      .command('token')
      .description('Mint a JWT for the API, Fleet, and the mobile PWA'),
    deps,
  );
}
