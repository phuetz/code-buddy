/**
 * ChatGPT Codex OAuth — Authorization Code + PKCE flow.
 *
 * Aligned with OpenAI Codex CLI Rust upstream (`openai/codex` @
 * `codex-rs/login/`). The same flow OpenAI's official CLI uses:
 *
 *  1. Generate a 64-byte random `code_verifier`, base64url-encoded.
 *  2. SHA-256 it → `code_challenge` (S256).
 *  3. Spin up a callback HTTP server on `127.0.0.1:1455` (fallback `1457`).
 *  4. Open `https://auth.openai.com/oauth/authorize?...` in the browser.
 *     The user is already signed in to ChatGPT — one click.
 *  5. Browser redirects to `http://localhost:<port>/auth/callback?code=...`.
 *  6. Server exchanges the code (form-encoded) for `{id_token, access_token,
 *     refresh_token}` against `https://auth.openai.com/oauth/token`.
 *  7. Tokens land on disk under `~/.codebuddy/codex-auth.json`.
 *
 * Existing Codex CLI credentials under `~/.codex/auth.json` are also
 * accepted as a read/write fallback. This lets Code Buddy reuse the same
 * ChatGPT Pro subscription login the user already uses through Codex.
 *
 * The access_token grants access to the **ChatGPT Codex Responses backend**
 * (`chatgpt.com/backend-api/codex/responses`), NOT the standard OpenAI
 * `/v1/chat/completions` API. See `provider-chatgpt-responses.ts` for the
 * client side.
 *
 * Token refresh uses a JSON body (asymmetry vs the auth_code exchange,
 * which is form-encoded — this is upstream's contract, mirrored here).
 */

import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import open from 'open';

/** OpenAI's public OAuth client id for the Codex CLI. Not a secret —
 *  identifies the application to the IdP, paired with PKCE for security.
 *  Same constant as `openai/codex`. */
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

/** OAuth issuer — both authorize and token endpoints live under here. */
const ISSUER = 'https://auth.openai.com';

/** Primary callback port. Must match OpenAI's allow-list of registered
 *  redirect URIs for the Codex CLI client_id. */
const CALLBACK_PORT = 1455;
/** Fallback when 1455 is busy (e.g. another Codex/Code Buddy session). */
const FALLBACK_CALLBACK_PORT = 1457;

/** Telemetry identifier OpenAI's IdP uses to recognize Codex CLI traffic. */
const ORIGINATOR = 'codex_cli_rs';

/** OAuth scopes — `offline_access` enables refresh_token issuance.
 *  `api.connectors.*` are required by the ChatGPT backend (harmless to
 *  request even when only calling the Responses API). */
const SCOPES =
  'openid profile email offline_access api.connectors.read api.connectors.invoke';

/** Refresh threshold: re-fetch tokens when last_refresh is older than this. */
const TOKEN_REFRESH_AGE_MS = 60 * 60 * 1000; // 1 hour

const CODEBUDDY_AUTH_FILE_PATH = path.join(os.homedir(), '.codebuddy', 'codex-auth.json');
const CODEX_CLI_AUTH_FILE_PATH = path.join(os.homedir(), '.codex', 'auth.json');

/** Token bundle returned by `https://auth.openai.com/oauth/token`. */
interface OauthTokens {
  id_token: string;
  access_token: string;
  refresh_token: string;
  account_id?: string;
}

/** Persistent file format. */
interface CodexAuthDotJson {
  /** Optional API key co-storage (back-compat with `oauth` sentinel). */
  OPENAI_API_KEY?: string;
  tokens?: OauthTokens;
  last_refresh?: string;
}

/**
 * Authentication material the Codex Responses backend expects.
 *
 * The access token alone is not enough: the backend wants the ChatGPT
 * account id (header `ChatGPT-Account-ID`) and a FedRAMP marker
 * (`X-OpenAI-Fedramp`) when the account is enrolled.
 */
export interface ChatGptAuth {
  access_token: string;
  account_id?: string;
  email?: string;
  plan_type?: string;
  is_fedramp: boolean;
  auth_file_path?: string;
  auth_source?: 'codebuddy' | 'codex-cli';
}

// ─────────────────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────────────────

interface AuthCandidate {
  path: string;
  source: 'codebuddy' | 'codex-cli';
}

interface LoadedAuthFile {
  path: string;
  source: 'codebuddy' | 'codex-cli';
  auth: CodexAuthDotJson;
}

function getAuthCandidates(): AuthCandidate[] {
  return [
    { path: CODEBUDDY_AUTH_FILE_PATH, source: 'codebuddy' },
    { path: CODEX_CLI_AUTH_FILE_PATH, source: 'codex-cli' },
  ];
}

function ensureConfigDir(filePath: string = CODEBUDDY_AUTH_FILE_PATH): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readCandidate(candidate: AuthCandidate): LoadedAuthFile | null {
  if (!fs.existsSync(candidate.path)) return null;
  try {
    const raw = fs.readFileSync(candidate.path, 'utf-8');
    const auth = JSON.parse(raw) as CodexAuthDotJson;
    return { path: candidate.path, source: candidate.source, auth };
  } catch (err) {
    console.error(`Error reading ${candidate.path}:`, err);
    return null;
  }
}

function loadAuthFile(): LoadedAuthFile | null {
  for (const candidate of getAuthCandidates()) {
    const loaded = readCandidate(candidate);
    if (loaded?.auth.tokens?.access_token) return loaded;
  }
  return null;
}

function saveAuthFile(auth: CodexAuthDotJson, filePath: string = CODEBUDDY_AUTH_FILE_PATH): void {
  try {
    ensureConfigDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(auth, null, 2), 'utf-8');
    // Restrict permissions on Unix (0o600 = owner read/write only).
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(filePath, 0o600);
      } catch { /* non-fatal */ }
    }
  } catch (err) {
    console.error('Error writing codex-auth.json:', err);
  }
}

/** Remove cached tokens. `/logout chatgpt` calls this. */
export function clearCodexCredentials(): void {
  try {
    if (fs.existsSync(CODEBUDDY_AUTH_FILE_PATH)) {
      fs.unlinkSync(CODEBUDDY_AUTH_FILE_PATH);
    }
  } catch (err) {
    console.error('Error clearing codex credentials:', err);
  }
}

/** Whether Code Buddy's own auth file exists. Does not count the shared
 *  Codex CLI fallback, so `/logout chatgpt` can avoid deleting Codex's
 *  global login. */
export function hasCodeBuddyCodexCredentials(): boolean {
  try {
    const loaded = readCandidate({ path: CODEBUDDY_AUTH_FILE_PATH, source: 'codebuddy' });
    return Boolean(loaded?.auth.tokens?.access_token);
  } catch {
    return false;
  }
}

/** Whether a non-empty auth file exists. Used by `src/index.ts` for
 *  provider auto-detection (no token loading, just file presence). */
export function hasCodexCredentials(): boolean {
  return loadAuthFile() !== null;
}

/** Absolute path where Code Buddy writes credentials on `buddy login`. */
export function getCodexAuthFilePath(): string {
  return CODEBUDDY_AUTH_FILE_PATH;
}

/** Absolute path to Codex CLI's shared ChatGPT subscription login file. */
export function getSharedCodexAuthFilePath(): string {
  return CODEX_CLI_AUTH_FILE_PATH;
}

/** Absolute path currently used for auth, if any. */
export function getActiveCodexAuthFilePath(): string | null {
  return loadAuthFile()?.path ?? null;
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

/** Generate a fresh PKCE pair. **64 bytes** of entropy to match the
 *  upstream Codex CLI (RFC 7636 only requires 32; 64 is safer and
 *  preserves byte-for-byte compatibility with OpenAI's reference). */
function generatePkce(): PkceCodes {
  const verifierBuffer = crypto.randomBytes(64);
  const code_verifier = base64URLEncode(verifierBuffer);
  const challengeHash = crypto
    .createHash('sha256')
    .update(code_verifier)
    .digest();
  const code_challenge = base64URLEncode(challengeHash);
  return { code_verifier, code_challenge };
}

function randomState(): string {
  return base64URLEncode(crypto.randomBytes(32));
}

// ─────────────────────────────────────────────────────────────────────
// JWT id_token claim extraction
// ─────────────────────────────────────────────────────────────────────

interface IdTokenClaims {
  // Top-level OIDC claim (sometimes present).
  email?: string;
  // OpenAI namespaced claims — the ChatGPT account metadata lives here.
  ['https://api.openai.com/auth']?: {
    chatgpt_account_id?: string;
    chatgpt_user_id?: string;
    chatgpt_plan_type?: string;
    chatgpt_account_is_fedramp?: boolean;
  };
  ['https://api.openai.com/profile']?: {
    email?: string;
  };
}

/** Decode the JWT payload (no signature verification — the IdP already
 *  vouched for it; we just extract claims). Returns null on malformed
 *  tokens. */
function decodeIdTokenClaims(idToken: string): IdTokenClaims | null {
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    const padded = payload + '==='.slice((payload.length + 3) % 4);
    const json = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf-8'
    );
    return JSON.parse(json) as IdTokenClaims;
  } catch {
    return null;
  }
}

function chatGptAuthFromTokens(tokens: OauthTokens, source?: LoadedAuthFile): ChatGptAuth {
  const claims = decodeIdTokenClaims(tokens.id_token);
  const authClaims = claims?.['https://api.openai.com/auth'];
  const profileClaims = claims?.['https://api.openai.com/profile'];

  return {
    access_token: tokens.access_token,
    account_id: tokens.account_id ?? authClaims?.chatgpt_account_id,
    email: profileClaims?.email ?? claims?.email,
    plan_type: authClaims?.chatgpt_plan_type,
    is_fedramp: authClaims?.chatgpt_account_is_fedramp ?? false,
    auth_file_path: source?.path,
    auth_source: source?.source,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Token endpoint calls
// ─────────────────────────────────────────────────────────────────────

/** Exchange the authorization code for the bearer-token bundle.
 *  `application/x-www-form-urlencoded` body — the IdP rejects JSON here. */
async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<OauthTokens> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Token exchange failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return (await response.json()) as OauthTokens;
}

/** Refresh the access_token. **JSON body** here (NOT form-encoded), per
 *  OpenAI's contract. The IdP rotates the refresh_token on every call,
 *  so we always overwrite both. */
async function refreshTokens(refreshToken: string): Promise<OauthTokens> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Token refresh failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return (await response.json()) as OauthTokens;
}

// ─────────────────────────────────────────────────────────────────────
// Authorize URL construction
// ─────────────────────────────────────────────────────────────────────

function buildAuthorizeUrl(
  redirectUri: string,
  codeChallenge: string,
  state: string
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: ORIGINATOR,
  });
  return `${ISSUER}/oauth/authorize?${params.toString()}`;
}

// Exported only for tests — not part of the stable public API.
// Note: bindCallbackServer / pingCancelEndpoint defined below — re-exposed
// at the bottom of the file so the test object stays a single source.
function __getTestExports() {
  return {
    buildAuthorizeUrl,
    generatePkce,
    decodeIdTokenClaims,
    chatGptAuthFromTokens,
    pingCancelEndpoint,
    bindCallbackServer,
    tryBindOnce,
    CLIENT_ID,
    SCOPES,
    ORIGINATOR,
  };
}

export const __test = new Proxy({} as ReturnType<typeof __getTestExports>, {
  get(_target, prop) {
    return __getTestExports()[prop as keyof ReturnType<typeof __getTestExports>];
  },
});

// ─────────────────────────────────────────────────────────────────────
// Callback server
// ─────────────────────────────────────────────────────────────────────

/**
 * Best-effort attempt to shut down a zombie Codex login server bound to
 * `port`. Sends a GET `/cancel` — our server handler responds 200 and
 * shuts down. If nothing is listening (= clean state), the fetch fails
 * silently and we proceed with the bind. 500ms timeout so we don't hang
 * on unrelated processes that might hold the port for unrelated reasons.
 */
async function pingCancelEndpoint(port: number): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${port}/cancel`, {
      method: 'GET',
      signal: AbortSignal.timeout(500),
    });
    // Give the OS a moment to release the port after the previous
    // server's `server.close()` ack.
    await new Promise((r) => setTimeout(r, 100));
  } catch {
    // Nothing to cancel, or unrelated process — fine, proceed.
  }
}

async function tryBindOnce(
  port: number,
  handler: http.RequestListener
): Promise<http.Server> {
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
  return server;
}

const isAddrInUse = (err: unknown): boolean =>
  (err as NodeJS.ErrnoException).code === 'EADDRINUSE';

async function bindCallbackServer(
  ports: number[],
  handler: http.RequestListener
): Promise<{ server: http.Server; port: number }> {
  // First, try to shut down any zombie Codex login server on the
  // primary port. Mirrors openai/codex Rust upstream behavior — the
  // worst that happens here is a no-op on a clean bind.
  if (ports.length > 0) {
    await pingCancelEndpoint(ports[0]);
  }

  for (let i = 0; i < ports.length; i++) {
    const port = ports[i];
    const isPrimary = i === 0;
    // For the primary port, retry up to 10x@200ms (= 2s) to give a
    // freshly-cancelled server time to release the socket. Secondary
    // ports try once.
    const maxAttempts = isPrimary ? 10 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const server = await tryBindOnce(port, handler);
        return { server, port };
      } catch (err) {
        if (isAddrInUse(err)) {
          if (attempt + 1 < maxAttempts) {
            await new Promise((r) => setTimeout(r, 200));
            continue;
          }
          break; // exhausted attempts on this port, fall through to next port
        }
        throw err;
      }
    }
  }
  throw new Error(
    `Callback ports ${ports.join(', ')} are all unavailable. ` +
      `Close any other Codex/ChatGPT login session and retry.`
  );
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Run the interactive login flow: spin a callback server, open the
 * browser, wait for the redirect, exchange the code, persist the tokens.
 *
 * Returns the parsed `ChatGptAuth` so callers can show the user their
 * email/plan immediately. Throws on failure / timeout (5 minutes).
 */
export async function loginInteractive(): Promise<ChatGptAuth> {
  const pkce = generatePkce();
  const state = randomState();

  return new Promise<ChatGptAuth>((resolve, reject) => {
    let serverInstance: http.Server | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let actualPort = CALLBACK_PORT;

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (serverInstance) {
        try { serverInstance.close(); } catch { /* ignore */ }
      }
    };

    const requestHandler: http.RequestListener = async (req, res) => {
      try {
        const url = new URL(req.url || '', `http://localhost:${actualPort}`);

        // Hand-off endpoint — used by a NEW login attempt to gracefully
        // shut down THIS (zombie) server so it can re-bind 1455. Mirrors
        // openai/codex upstream. On receipt: 200 + close + reject the
        // pending OAuth promise.
        if (url.pathname === '/cancel') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('cancelled');
          cleanup();
          reject(new Error('Login cancelled by another instance'));
          return;
        }

        if (url.pathname !== '/auth/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const error = url.searchParams.get('error');
        if (error) {
          const detail = url.searchParams.get('error_description') ?? error;
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(errorHtml('OpenAI a refusé la connexion', detail));
          cleanup();
          reject(new Error(`OAuth provider error: ${detail}`));
          return;
        }

        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');

        if (!code || returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(errorHtml('Réponse invalide', 'code ou state manquant/invalide'));
          cleanup();
          reject(new Error('Invalid code or state mismatch'));
          return;
        }

        const redirectUri = `http://localhost:${actualPort}/auth/callback`;
        const tokens = await exchangeCodeForTokens(code, pkce.code_verifier, redirectUri);

        const authFile: CodexAuthDotJson = {
          tokens,
          last_refresh: new Date().toISOString(),
        };
        saveAuthFile(authFile);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(successHtml());

        cleanup();
        resolve(chatGptAuthFromTokens(tokens));
      } catch (err) {
        try {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(errorHtml("Échec de l'échange de jetons", String(err)));
        } catch { /* ignore */ }
        cleanup();
        reject(err);
      }
    };

    bindCallbackServer([CALLBACK_PORT, FALLBACK_CALLBACK_PORT], requestHandler)
      .then(({ server, port }) => {
        serverInstance = server;
        actualPort = port;

        const redirectUri = `http://localhost:${port}/auth/callback`;
        const authUrl = buildAuthorizeUrl(redirectUri, pkce.code_challenge, state);

        // 5-minute timeout — forgotten browser tab shouldn't leak the server.
        timeoutHandle = setTimeout(() => {
          cleanup();
          reject(new Error('Login timed out after 5 minutes'));
        }, 5 * 60 * 1000);

        // Open the browser. If it fails, log the URL so the user can
        // copy-paste manually.
        open(authUrl).catch(() => {
          console.error(
            `Couldn't auto-open the browser. Open this URL manually:\n${authUrl}`
          );
        });
      })
      .catch(reject);
  });
}

/**
 * Returns the current ChatGptAuth (with claims), refreshing the access
 * token if `last_refresh` is older than 1 hour. Returns `null` when no
 * credentials are on disk yet — caller should run `loginInteractive()`.
 */
export async function getChatGptAuth(): Promise<ChatGptAuth | null> {
  const loaded = loadAuthFile();
  const file = loaded?.auth;
  if (!loaded || !file?.tokens?.access_token) return null;

  const lastRefreshMs = file.last_refresh
    ? new Date(file.last_refresh).getTime()
    : 0;
  const ageMs = Date.now() - lastRefreshMs;

  if (ageMs > TOKEN_REFRESH_AGE_MS) {
    try {
      const refreshed = await refreshTokens(file.tokens.refresh_token);
      const updated: CodexAuthDotJson = {
        ...file,
        tokens: {
          ...file.tokens,
          ...refreshed,
        },
        last_refresh: new Date().toISOString(),
      };
      saveAuthFile(updated, loaded.path);
      return chatGptAuthFromTokens(updated.tokens!, { ...loaded, auth: updated });
    } catch (err) {
      // Refresh failed — token may have been revoked. Surface to caller
      // so they can decide whether to clear credentials.
      console.error('ChatGPT token refresh failed:', err);
      return null;
    }
  }

  return chatGptAuthFromTokens(file.tokens, loaded);
}

/**
 * @deprecated Use `getChatGptAuth()` (returns the full auth bundle) or
 *   `loginInteractive()` (forces a new login). Kept for back-compat with
 *   `src/providers/openai-provider.ts:41` which still treats the token
 *   as a plain API key.
 */
export async function getCodexOauthTokens(forceLogin = false): Promise<string | null> {
  if (forceLogin) {
    const auth = await loginInteractive();
    return auth.access_token;
  }
  const auth = await getChatGptAuth();
  return auth?.access_token ?? null;
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
</head><body><div class="card"><h1>✅ Authentifié à ChatGPT</h1>
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
