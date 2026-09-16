/**
 * xAI / Grok OAuth — Authorization Code + PKCE flow (subscription login).
 *
 * Lets a SuperGrok / xAI subscriber use their plan as the brain of Code
 * Buddy via a one-time browser login — no `XAI_API_KEY`, no per-token API
 * metering — mirroring the ChatGPT `buddy login` path (`codex-oauth.ts`).
 *
 * Flow (RFC 7636 PKCE + loopback redirect, per RFC 8252):
 *   1. Fetch OIDC discovery (`https://auth.x.ai/.well-known/openid-configuration`)
 *      → `authorization_endpoint` + `token_endpoint` (validated to be on *.x.ai).
 *   2. Generate a 64-byte `code_verifier` → SHA-256 `code_challenge` (S256).
 *   3. Spin a callback server on `127.0.0.1:56121` (fallback ephemeral).
 *   4. Open the authorize URL in the browser; the user consents.
 *   5. Browser redirects to `http://127.0.0.1:<port>/callback?code=...&state=...`.
 *   6. Exchange the code (form-encoded, with `code_challenge` re-sent — an xAI
 *      defense-in-depth quirk) for `{access_token, refresh_token, ...}`.
 *   7. Tokens land under `~/.codebuddy/xai-auth.json` (0600).
 *
 * Inference: the `access_token` is sent **directly** as `Authorization:
 * Bearer` to `https://api.x.ai/v1` (`/chat/completions` or `/responses`).
 * There is NO key-exchange / management API step — the OAuth token is the
 * inference credential. (Verified against the Hermes Agent reference impl.)
 *
 * Client id `b1a00492-…` is xAI's first-party Grok CLI public OAuth client
 * (paired with PKCE, not a secret) — the same reuse pattern as the ChatGPT
 * Codex CLI client id in `codex-oauth.ts`.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import open from 'open';
import { logger } from '../utils/logger.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

/** xAI's public Grok CLI OAuth client id (PKCE public client; not a secret). */
const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';

/** OAuth issuer — discovery, authorize and token endpoints live under here. */
const ISSUER = 'https://auth.x.ai';
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;

/** Hardcoded fallbacks if OIDC discovery is unreachable at login time.
 *  The token endpoint is the one observed in the Hermes reference impl. */
const FALLBACK_AUTHORIZE_ENDPOINT = `${ISSUER}/oauth/authorize`;
const FALLBACK_TOKEN_ENDPOINT = `${ISSUER}/oauth2/token`;

/** Scopes — `offline_access` enables refresh_token issuance; `api:access`
 *  is the scope that (when entitled) grants api.x.ai inference; `grok-cli:access`
 *  identifies the Grok CLI surface. */
const SCOPES = 'openid profile email offline_access grok-cli:access api:access';

/** Primary loopback callback port (matches the Grok CLI's registered redirect). */
const CALLBACK_PORT = 56121;
const CALLBACK_PATH = '/callback';

/** Bound on token exchange/refresh fetches so a stalled IdP can't hang an
 *  inline refresh (refresh runs on the first chat call when tokens are stale). */
const OAUTH_TOKEN_TIMEOUT_MS = 30_000;
/** Short bound on the discovery fetch. */
const DISCOVERY_TIMEOUT_MS = 10_000;

/** Refresh the access token this many seconds before its JWT `exp`. */
const ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 120;

/** Attribution marker (best-effort, mirrors Hermes' `referrer=`). */
const REFERRER = 'code-buddy';

const AUTH_FILE_PATH = path.join(os.homedir(), '.codebuddy', 'xai-auth.json');

/** Default inference base URL for the xAI OAuth path. */
export const XAI_OAUTH_BASE_URL = 'https://api.x.ai/v1';

/** Token bundle returned by the xAI token endpoint. */
interface XaiOauthTokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  /** TTL in seconds from grant time (xAI returns this; expiry itself is read
   *  from the JWT `exp` claim when the access_token is a JWT). */
  expires_in?: number;
  token_type?: string;
}

interface XaiDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
}

/** Persistent file format (`~/.codebuddy/xai-auth.json`). */
interface XaiAuthDotJson {
  tokens?: XaiOauthTokens;
  discovery?: XaiDiscovery;
  redirect_uri?: string;
  last_refresh?: string;
}

/** Minimal auth summary returned to callers after login. */
export interface XaiAuth {
  access_token: string;
  email?: string;
  /** Seconds until the access token expires, when derivable from the JWT. */
  expires_in_seconds?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────────────────

function loadAuthFile(): XaiAuthDotJson | null {
  try {
    return readJsonAtomicSync<XaiAuthDotJson | null>(AUTH_FILE_PATH, null);
  } catch (err) {
    logger.error('Error reading xai-auth.json', err instanceof Error ? err : { error: String(err) });
    return null;
  }
}

function saveAuthFile(auth: XaiAuthDotJson): void {
  try {
    writeJsonAtomicSync(AUTH_FILE_PATH, auth, { mode: 0o600 });
  } catch (err) {
    logger.error('Error writing xai-auth.json', err instanceof Error ? err : { error: String(err) });
  }
}

/** Remove cached tokens. `buddy logout xai` calls this. */
export function clearXaiCredentials(): void {
  try {
    if (fs.existsSync(AUTH_FILE_PATH)) {
      fs.unlinkSync(AUTH_FILE_PATH);
    }
  } catch (err) {
    logger.error('Error clearing xai credentials', err instanceof Error ? err : { error: String(err) });
  }
}

/** Whether a non-empty auth file with an access token exists. Used for
 *  provider auto-detection (no token loading, just presence). */
export function hasXaiCredentials(): boolean {
  try {
    const parsed = readJsonAtomicSync<XaiAuthDotJson | null>(AUTH_FILE_PATH, null);
    if (!parsed) return false;
    return Boolean(parsed.tokens?.access_token);
  } catch {
    return false;
  }
}

/** Absolute path to the auth file. Exposed for doctor / debug. */
export function getXaiAuthFilePath(): string {
  return AUTH_FILE_PATH;
}

// ─────────────────────────────────────────────────────────────────────
// PKCE
// ─────────────────────────────────────────────────────────────────────

function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

interface PkceCodes {
  code_verifier: string;
  code_challenge: string;
}

/** Generate a fresh PKCE pair (64 bytes of entropy, S256). */
function generatePkce(): PkceCodes {
  const code_verifier = base64URLEncode(crypto.randomBytes(64));
  const code_challenge = base64URLEncode(
    crypto.createHash('sha256').update(code_verifier).digest()
  );
  return { code_verifier, code_challenge };
}

function randomHex(): string {
  return crypto.randomBytes(16).toString('hex');
}

// ─────────────────────────────────────────────────────────────────────
// JWT expiry
// ─────────────────────────────────────────────────────────────────────

interface JwtClaims {
  exp?: number;
  email?: string;
  [key: string]: unknown;
}

/** Decode a JWT payload (no signature verification — the IdP vouched for it).
 *  Returns null for opaque (non-JWT) tokens. */
function decodeJwtClaims(token: string): JwtClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    if (payload === undefined) return null;
    const padded = payload + '==='.slice((payload.length + 3) % 4);
    const json = Buffer.from(
      padded.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf-8');
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

/** Seconds until the access token expires, or null when not derivable
 *  (opaque token, or missing `exp`). */
function accessTokenTtlSeconds(accessToken: string): number | null {
  const claims = decodeJwtClaims(accessToken);
  if (!claims?.exp) return null;
  return Math.floor(claims.exp - Date.now() / 1000);
}

/** True when the token is a JWT expiring within the refresh skew window.
 *  Opaque tokens (no `exp`) are treated as NOT-expiring → refreshed only
 *  reactively on a 401. */
function isAccessTokenExpiring(accessToken: string): boolean {
  const ttl = accessTokenTtlSeconds(accessToken);
  if (ttl === null) return false;
  return ttl <= ACCESS_TOKEN_REFRESH_SKEW_SECONDS;
}

// ─────────────────────────────────────────────────────────────────────
// OIDC discovery
// ─────────────────────────────────────────────────────────────────────

/** Validate an endpoint is HTTPS on the `*.x.ai` origin — prevents a
 *  poisoned discovery doc from redirecting credentials elsewhere. */
function isXaiHttpsEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return u.hostname === 'x.ai' || u.hostname.endsWith('.x.ai');
  } catch {
    return false;
  }
}

/** Fetch + validate the OIDC discovery document. Falls back to the known
 *  endpoints if discovery is unreachable or malformed. */
async function fetchDiscovery(): Promise<XaiDiscovery> {
  const fallback: XaiDiscovery = {
    authorization_endpoint: FALLBACK_AUTHORIZE_ENDPOINT,
    token_endpoint: FALLBACK_TOKEN_ENDPOINT,
  };
  try {
    const response = await fetch(DISCOVERY_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) return fallback;
    const doc = (await response.json()) as Partial<XaiDiscovery>;
    const authorize = doc.authorization_endpoint;
    const token = doc.token_endpoint;
    if (
      typeof authorize === 'string' &&
      typeof token === 'string' &&
      isXaiHttpsEndpoint(authorize) &&
      isXaiHttpsEndpoint(token)
    ) {
      return { authorization_endpoint: authorize, token_endpoint: token };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Authorize URL + token endpoint calls
// ─────────────────────────────────────────────────────────────────────

function buildAuthorizeUrl(
  authorizeEndpoint: string,
  redirectUri: string,
  codeChallenge: string,
  state: string,
  nonce: string
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    plan: 'generic',
    referrer: REFERRER,
  });
  return `${authorizeEndpoint}?${params.toString()}`;
}

/** Exchange the authorization code for tokens. Form-encoded body; the
 *  `code_challenge` is re-sent (xAI defense-in-depth re-validation). */
async function exchangeCodeForTokens(
  tokenEndpoint: string,
  code: string,
  codeVerifier: string,
  codeChallenge: string,
  redirectUri: string
): Promise<XaiOauthTokens> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(OAUTH_TOKEN_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Token exchange failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return (await response.json()) as XaiOauthTokens;
}

/** Refresh the access token (form-encoded, grant_type=refresh_token). */
async function refreshTokens(
  tokenEndpoint: string,
  refreshToken: string
): Promise<XaiOauthTokens> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(OAUTH_TOKEN_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // 403 = entitlement gate (account not authorized for api.x.ai inference).
    if (response.status === 403) {
      throw new Error(
        `xAI refused the token (403): your subscription may not include API ` +
          `inference access. Set XAI_API_KEY to use the metered API instead.`
      );
    }
    throw new Error(`Token refresh failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return (await response.json()) as XaiOauthTokens;
}

// ─────────────────────────────────────────────────────────────────────
// Callback server
// ─────────────────────────────────────────────────────────────────────

async function tryBindOnce(
  port: number,
  handler: http.RequestListener
): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  return { server, port: boundPort };
}

const isAddrInUse = (err: unknown): boolean =>
  (err as NodeJS.ErrnoException).code === 'EADDRINUSE';

/** Bind the callback server: prefer 56121, fall back to an OS-assigned
 *  ephemeral port (RFC 8252 §7.3 — loopback redirects accept any port). */
async function bindCallbackServer(
  handler: http.RequestListener
): Promise<{ server: http.Server; port: number }> {
  try {
    return await tryBindOnce(CALLBACK_PORT, handler);
  } catch (err) {
    if (isAddrInUse(err)) {
      // Ephemeral fallback.
      return await tryBindOnce(0, handler);
    }
    throw err;
  }
}

/** Parse what the user pastes back from the browser. xAI's current consent
 *  screen shows the bare authorization code in-page (rather than redirecting
 *  to the loopback), so accept either a bare code, a full callback URL, or a
 *  `?code=...&state=...` fragment. Returns null when no code is found. */
function parsePastedCallback(raw: string): { code: string; state?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.includes('code=')) {
    try {
      const qs = trimmed.includes('?') ? trimmed.slice(trimmed.indexOf('?') + 1) : trimmed;
      const params = new URLSearchParams(qs);
      const code = params.get('code');
      if (code) {
        const state = params.get('state');
        return state ? { code, state } : { code };
      }
    } catch { /* fall through to bare-code handling */ }
  }
  return { code: trimmed };
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

// ── Two-step (begin → complete) flow ────────────────────────────────
// Works in non-interactive / backgrounded / remote shells where the user
// can't paste into the process's stdin: `beginLogin()` opens the browser
// and persists the PKCE material; `completeLogin(code)` exchanges the code
// the user copied from xAI's in-page consent screen.

const PENDING_FILE_PATH = path.join(os.homedir(), '.codebuddy', 'xai-login-pending.json');

interface PendingLogin {
  code_verifier: string;
  code_challenge: string;
  state: string;
  nonce: string;
  redirect_uri: string;
  authorization_endpoint: string;
  token_endpoint: string;
  created_at: string;
}

function savePending(p: PendingLogin): void {
  try {
    writeJsonAtomicSync(PENDING_FILE_PATH, p, { mode: 0o600 });
  } catch (err) {
    logger.error('Error writing xai-login-pending.json', err instanceof Error ? err : { error: String(err) });
  }
}

function loadPending(): PendingLogin | null {
  try {
    return readJsonAtomicSync<PendingLogin | null>(PENDING_FILE_PATH, null);
  } catch {
    return null;
  }
}

function clearPending(): void {
  try {
    if (fs.existsSync(PENDING_FILE_PATH)) fs.unlinkSync(PENDING_FILE_PATH);
  } catch { /* ignore */ }
}

/**
 * Begin a login: run discovery, generate PKCE, persist the pending material,
 * and return the authorize URL to open. Does NOT block — the caller opens the
 * browser and later calls `completeLogin(code)` with the in-page code.
 */
export async function beginLogin(): Promise<{ authorizeUrl: string; redirectUri: string }> {
  const discovery = await fetchDiscovery();
  const pkce = generatePkce();
  const state = randomHex();
  const nonce = randomHex();
  // Fixed loopback redirect_uri (must match in authorize + token exchange).
  const redirectUri = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`;
  savePending({
    code_verifier: pkce.code_verifier,
    code_challenge: pkce.code_challenge,
    state,
    nonce,
    redirect_uri: redirectUri,
    authorization_endpoint: discovery.authorization_endpoint,
    token_endpoint: discovery.token_endpoint,
    created_at: new Date().toISOString(),
  });
  const authorizeUrl = buildAuthorizeUrl(
    discovery.authorization_endpoint,
    redirectUri,
    pkce.code_challenge,
    state,
    nonce
  );
  return { authorizeUrl, redirectUri };
}

/**
 * Complete a login started by `beginLogin()`: exchange the authorization code
 * (bare code or a pasted callback URL) for tokens, persist them, and clear the
 * pending file. Throws when there's no pending login or the exchange fails.
 */
export async function completeLogin(rawCode: string): Promise<XaiAuth> {
  const pending = loadPending();
  if (!pending) {
    throw new Error('No pending xAI login. Run `buddy login xai` first to open the browser.');
  }
  const parsed = parsePastedCallback(rawCode);
  if (!parsed) throw new Error('No authorization code provided.');
  if (parsed.state !== undefined && parsed.state !== pending.state) {
    throw new Error('state mismatch (paste the code from the same login attempt).');
  }
  const tokens = await exchangeCodeForTokens(
    pending.token_endpoint,
    parsed.code,
    pending.code_verifier,
    pending.code_challenge,
    pending.redirect_uri
  );
  saveAuthFile({
    tokens,
    discovery: {
      authorization_endpoint: pending.authorization_endpoint,
      token_endpoint: pending.token_endpoint,
    },
    redirect_uri: pending.redirect_uri,
    last_refresh: new Date().toISOString(),
  });
  clearPending();
  const claims = decodeJwtClaims(tokens.access_token);
  const ttl = accessTokenTtlSeconds(tokens.access_token);
  return {
    access_token: tokens.access_token,
    ...(claims?.email ? { email: claims.email } : {}),
    ...(ttl !== null ? { expires_in_seconds: ttl } : {}),
  };
}

/**
 * Run the interactive login flow. Because xAI's consent screen currently
 * shows the authorization code **in-page** (rather than redirecting to the
 * loopback), this races two completion paths:
 *   - a loopback callback server on 127.0.0.1:56121 (used if xAI redirects), and
 *   - a stdin prompt where the user pastes the in-page code.
 * Whichever resolves first wins. The `redirect_uri` stays byte-identical in
 * the authorize URL and the token exchange (xAI cross-checks it). Returns a
 * minimal `XaiAuth`. Rejects on failure / timeout (5 minutes).
 */
export function loginInteractive(openUrl?: (url: string) => void | Promise<void>): Promise<XaiAuth> {
  const pkce = generatePkce();
  const state = randomHex();
  const nonce = randomHex();

  return new Promise<XaiAuth>((resolve, reject) => {
    let settled = false;
    let serverInstance: http.Server | null = null;
    let rl: readline.Interface | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let actualPort = CALLBACK_PORT;
    let discovery: XaiDiscovery = {
      authorization_endpoint: FALLBACK_AUTHORIZE_ENDPOINT,
      token_endpoint: FALLBACK_TOKEN_ENDPOINT,
    };

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (serverInstance) { try { serverInstance.close(); } catch { /* ignore */ } }
      if (rl) { try { rl.close(); } catch { /* ignore */ } }
    };

    /** Exchange a code (from either path) and settle the promise once. */
    const finish = async (code: string, returnedState?: string): Promise<void> => {
      if (settled) return;
      // Enforce state only when we have one to compare (loopback callback, or a
      // pasted full URL). A bare pasted code carries no state — accept it.
      if (returnedState !== undefined && returnedState !== state) {
        settled = true;
        cleanup();
        reject(new Error('state mismatch'));
        return;
      }
      settled = true;
      try {
        const redirectUri = `http://127.0.0.1:${actualPort}${CALLBACK_PATH}`;
        const tokens = await exchangeCodeForTokens(
          discovery.token_endpoint,
          code,
          pkce.code_verifier,
          pkce.code_challenge,
          redirectUri
        );
        saveAuthFile({
          tokens,
          discovery,
          redirect_uri: redirectUri,
          last_refresh: new Date().toISOString(),
        });
        cleanup();
        const claims = decodeJwtClaims(tokens.access_token);
        const ttl = accessTokenTtlSeconds(tokens.access_token);
        resolve({
          access_token: tokens.access_token,
          ...(claims?.email ? { email: claims.email } : {}),
          ...(ttl !== null ? { expires_in_seconds: ttl } : {}),
        });
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    const requestHandler: http.RequestListener = async (req, res) => {
      try {
        const url = new URL(req.url || '', `http://127.0.0.1:${actualPort}`);
        if (url.pathname !== CALLBACK_PATH) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const error = url.searchParams.get('error');
        if (error) {
          const detail = url.searchParams.get('error_description') ?? error;
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(errorHtml('xAI a refusé la connexion', detail));
          if (!settled) { settled = true; cleanup(); reject(new Error(`OAuth provider error: ${detail}`)); }
          return;
        }
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state') ?? undefined;
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(errorHtml('Réponse invalide', 'code manquant'));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(successHtml());
        await finish(code, returnedState);
      } catch (err) {
        try {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(errorHtml("Échec de l'échange de jetons", String(err)));
        } catch { /* ignore */ }
        if (!settled) { settled = true; cleanup(); reject(err); }
      }
    };

    // Discovery first; then bind the (best-effort) loopback server and open
    // the browser. A bind failure is non-fatal — the paste path still works.
    fetchDiscovery()
      .then((d) => {
        discovery = d;
        return bindCallbackServer(requestHandler).catch(() => null);
      })
      .then((bound) => {
        if (bound) {
          serverInstance = bound.server;
          actualPort = bound.port;
        }
        const redirectUri = `http://127.0.0.1:${actualPort}${CALLBACK_PATH}`;
        const authUrl = buildAuthorizeUrl(
          discovery.authorization_endpoint,
          redirectUri,
          pkce.code_challenge,
          state,
          nonce
        );

        timeoutHandle = setTimeout(() => {
          if (!settled) { settled = true; cleanup(); reject(new Error('Login timed out after 5 minutes')); }
        }, 5 * 60 * 1000);

        const fail = () =>
          console.error(`Couldn't auto-open the browser. Open this URL manually:\n${authUrl}`);
        if (openUrl) {
          try {
            const r = openUrl(authUrl);
            if (r instanceof Promise) r.catch(fail);
          } catch {
            fail();
          }
        } else {
          open(authUrl).catch(fail);
          console.log(`\nIf your browser didn't open, visit this URL:\n${authUrl}`);
        }

        // Paste path — xAI shows the code in-page rather than redirecting.
        console.log('\nxAI usually shows a code in the page instead of redirecting.');
        console.log('Copy that code, paste it here, and press Enter');
        console.log('(or just finish in the browser if it redirects):');
        rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question('Code: ', (answer) => {
          if (settled) return;
          const parsed = parsePastedCallback(answer);
          if (parsed) {
            void finish(parsed.code, parsed.state);
          }
        });
      })
      .catch((err) => {
        if (!settled) { settled = true; cleanup(); reject(err); }
      });
  });
}

/**
 * Returns a valid xAI access token for inference, refreshing it when the
 * JWT is within the skew window (or when `forceRefresh` is set, e.g. after a
 * 401). Returns null when no credentials are on disk, or when a refresh
 * fails (token revoked / entitlement lost) — the caller should re-login.
 */
export async function getValidXaiAccessToken(forceRefresh = false): Promise<string | null> {
  const file = loadAuthFile();
  const accessToken = file?.tokens?.access_token;
  if (!file || !accessToken) return null;

  const needsRefresh = forceRefresh || isAccessTokenExpiring(accessToken);
  if (!needsRefresh) return accessToken;

  const refreshToken = file.tokens?.refresh_token;
  if (!refreshToken) {
    // No refresh token (e.g. consent without offline_access). Hand back the
    // current token; a 401 will tell the user to re-login.
    return accessToken;
  }

  const tokenEndpoint = file.discovery?.token_endpoint ?? FALLBACK_TOKEN_ENDPOINT;
  try {
    const refreshed = await refreshTokens(tokenEndpoint, refreshToken);
    saveAuthFile({
      ...file,
      tokens: { ...file.tokens, ...refreshed },
      last_refresh: new Date().toISOString(),
    });
    return refreshed.access_token;
  } catch (err) {
    logger.error('xAI token refresh failed', err instanceof Error ? err : { error: String(err) });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Browser response pages
// ─────────────────────────────────────────────────────────────────────

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function successHtml(): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Code Buddy — Connecté</title>
<style>body{font-family:system-ui;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#171717;border:1px solid #262626;border-radius:12px;padding:32px 40px;max-width:420px;text-align:center}
h1{font-size:18px;margin:0 0 8px;color:#a7f3d0}
p{margin:0;font-size:14px;color:#a3a3a3;line-height:1.5}</style>
</head><body><div class="card"><h1>✅ Authentifié à xAI / Grok</h1>
<p>Tu peux fermer cet onglet et retourner dans Code Buddy — ton jeton est stocké.</p>
<script>setTimeout(() => window.close(), 1200)</script>
</div></body></html>`;
}

function errorHtml(title: string, detail: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Code Buddy — Erreur OAuth</title>
<style>body{font-family:system-ui;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#171717;border:1px solid #7f1d1d;border-radius:12px;padding:32px 40px;max-width:520px}
h1{font-size:18px;margin:0 0 12px;color:#fca5a5}
pre{margin:0;font-size:12px;color:#a3a3a3;white-space:pre-wrap;word-break:break-word}</style>
</head><body><div class="card"><h1>${htmlEscape(title)}</h1><pre>${htmlEscape(detail)}</pre></div></body></html>`;
}

// ─────────────────────────────────────────────────────────────────────
// Test-only exports (not part of the stable public API)
// ─────────────────────────────────────────────────────────────────────

function __getTestExports() {
  return {
    buildAuthorizeUrl,
    generatePkce,
    decodeJwtClaims,
    accessTokenTtlSeconds,
    isAccessTokenExpiring,
    isXaiHttpsEndpoint,
    parsePastedCallback,
    base64URLEncode,
    CLIENT_ID,
    SCOPES,
    ISSUER,
    FALLBACK_TOKEN_ENDPOINT,
    FALLBACK_AUTHORIZE_ENDPOINT,
    CALLBACK_PORT,
    CALLBACK_PATH,
  };
}

export const __test = new Proxy({} as ReturnType<typeof __getTestExports>, {
  get(_target, prop) {
    return __getTestExports()[prop as keyof ReturnType<typeof __getTestExports>];
  },
});
