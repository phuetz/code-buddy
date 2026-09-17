/**
 * MCP OAuth Support
 *
 * Implements OAuth 2.0 Authorization Code flow with PKCE for MCP server authentication.
 * Stores tokens encrypted in .codebuddy/mcp-tokens.json.
 */

import * as crypto from 'crypto';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';
import { logger } from '../utils/logger.js';
import { readTextAtomicSync, writeFileAtomicSync } from '../utils/atomic-write.js';
import { SDK_MANAGED_TOKEN_URL } from './mcp-oauth-constants.js';

// ============================================================================
// Types
// ============================================================================

export interface MCPOAuthConfig {
  clientId: string;
  clientSecret?: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri?: string;  // default: http://localhost:19836/callback
}

export interface MCPOAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scopes: string[];
}

/** Client id + optional DCR metadata persisted next to the token (encrypted store). */
export interface StoredClientInformation {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  client_name?: string;
  scope?: string;
}

interface StoredEntry {
  token?: MCPOAuthToken;
  config: {
    clientId: string;
    tokenUrl: string;
  };
  client?: StoredClientInformation;
}

interface StoredTokens {
  [serverId: string]: StoredEntry;
}

function storedClientFrom(info: StoredClientInformation): StoredClientInformation {
  const client: StoredClientInformation = { client_id: info.client_id };
  if (info.client_secret) client.client_secret = info.client_secret;
  if (info.client_id_issued_at !== undefined) client.client_id_issued_at = info.client_id_issued_at;
  if (info.client_secret_expires_at !== undefined) client.client_secret_expires_at = info.client_secret_expires_at;
  if (info.redirect_uris?.length) client.redirect_uris = [...info.redirect_uris];
  if (info.token_endpoint_auth_method) client.token_endpoint_auth_method = info.token_endpoint_auth_method;
  if (info.grant_types?.length) client.grant_types = [...info.grant_types];
  if (info.response_types?.length) client.response_types = [...info.response_types];
  if (info.client_name) client.client_name = info.client_name;
  if (info.scope) client.scope = info.scope;
  return client;
}

// ============================================================================
// PKCE (RFC 7636)
// ============================================================================

/**
 * Generate a cryptographically random code verifier (43-128 chars, URL-safe)
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate code challenge from verifier using S256 method
 */
export function generateCodeChallenge(verifier: string): string {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

// ============================================================================
// Token Encryption (AES-256-GCM)
// ============================================================================

const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 32;

function getEncryptionKey(): string {
  // Prefer CODEBUDDY_VAULT_KEY or CODEBUDDY_MCP_KEY. The USER+platform fallback
  // is derivable by anyone on the same account: AES-GCM still runs, but that is
  // not a strong vault. Set an explicit key for real confidentiality.
  return process.env.CODEBUDDY_VAULT_KEY
    || process.env.CODEBUDDY_MCP_KEY
    || `mcp-oauth-${process.env.USER || process.env.USERNAME || 'default'}-${process.platform}`;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, 32);
}

function encryptData(text: string): string {
  const passphrase = getEncryptionKey();
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(passphrase, salt);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

function decryptData(data: string): string {
  const passphrase = getEncryptionKey();
  const [saltHex, ivHex, tagHex, encrypted] = data.split(':');
  if (
    saltHex === undefined ||
    ivHex === undefined ||
    tagHex === undefined ||
    encrypted === undefined
  ) {
    throw new Error('Invalid encrypted data format');
  }
  const salt = Buffer.from(saltHex, 'hex');
  const key = deriveKey(passphrase, salt);
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============================================================================
// Token Storage
// ============================================================================

function getTokenFilePath(): string {
  return path.join(process.cwd(), '.codebuddy', 'mcp-tokens.json');
}

function loadTokenStore(): StoredTokens {
  const filePath = getTokenFilePath();
  try {
    const raw = readTextAtomicSync(filePath, '');
    if (!raw) return {};
    const decrypted = decryptData(raw);
    return JSON.parse(decrypted);
  } catch {
    return {};
  }
}

function saveTokenStore(store: StoredTokens): void {
  const filePath = getTokenFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const encrypted = encryptData(JSON.stringify(store));
  writeFileAtomicSync(filePath, encrypted, { mode: 0o600 });
}

// ============================================================================
// Local Callback Server
// ============================================================================

interface AuthorizationResult {
  code: string;
  state: string;
}

export class OAuthCallbackCancelledError extends Error {
  constructor(message = 'OAuth authorization cancelled') {
    super(message);
    this.name = 'OAuthCallbackCancelledError';
  }
}

export interface CallbackSession {
  /** Resolves only after listen() succeeded. Rejects on bind failure or abort-before-listen. */
  listening: Promise<void>;
  /** Resolves with the authorization code after a valid callback. */
  result: Promise<AuthorizationResult>;
  abort: (reason?: Error) => void;
}

/**
 * Bind the loopback callback server. Callers must await `listening` before
 * opening a browser: a bind failure must not leave an unhandled rejection
 * nor launch a flow that can never complete.
 */
export function startCallbackSession(
  redirectUri: string,
  expectedState: string,
  timeoutMs: number = 120_000,
  signal?: AbortSignal,
): CallbackSession {
  const url = new URL(redirectUri);
  const port = parseInt(url.port || '19836', 10);
  const pathname = url.pathname || '/callback';

  let listenResolve!: () => void;
  let listenReject!: (err: Error) => void;
  let resultResolve!: (value: AuthorizationResult) => void;
  let resultReject!: (err: Error) => void;
  let listeningSettled = false;
  let resultSettled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let server: http.Server | undefined;

  const listening = new Promise<void>((resolve, reject) => {
    listenResolve = resolve;
    listenReject = reject;
  });
  const result = new Promise<AuthorizationResult>((resolve, reject) => {
    resultResolve = resolve;
    resultReject = reject;
  });
  // Attach observers at construction so a pre-aborted signal cannot leave an
  // unhandledRejection on the public startCallbackServer wrapper (the early
  // return used to skip the .catch() that lived after listen()).
  listening.catch(() => undefined);
  result.catch(() => undefined);

  const settleListen = (err?: Error) => {
    if (listeningSettled) return;
    listeningSettled = true;
    if (err) listenReject(err);
    else listenResolve();
  };
  const settleResult = (value?: AuthorizationResult, err?: Error) => {
    if (resultSettled) return;
    resultSettled = true;
    if (timer) clearTimeout(timer);
    if (err) resultReject(err);
    else resultResolve(value!);
  };

  let abort!: (reason?: Error) => void;
  const onAbort = () => abort(new OAuthCallbackCancelledError());
  const detachAbort = () => signal?.removeEventListener('abort', onAbort);

  abort = (reason?: Error) => {
    detachAbort();
    const fail = reason ?? new OAuthCallbackCancelledError();
    if (!listeningSettled) settleListen(fail);
    if (!resultSettled) settleResult(undefined, fail);
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (server) {
      server.removeAllListeners('error');
      const closing = server;
      server = undefined;
      closing.close();
    }
  };

  if (signal?.aborted) {
    abort(new OAuthCallbackCancelledError());
    return { listening, result, abort };
  }
  signal?.addEventListener('abort', onAbort, { once: true });

  timer = setTimeout(() => {
    abort(new Error('OAuth callback timed out (120s)'));
    detachAbort();
  }, timeoutMs);

  server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);

    if (reqUrl.pathname !== pathname) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const code = reqUrl.searchParams.get('code');
    const state = reqUrl.searchParams.get('state');
    const error = reqUrl.searchParams.get('error');

    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Authorization Failed</h1><p>You can close this window.</p></body></html>');
      detachAbort();
      abort(new Error(`OAuth authorization error: ${error}`));
      return;
    }

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Missing authorization code</h1></body></html>');
      return;
    }

    if (state !== expectedState) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>State mismatch — possible CSRF attack</h1></body></html>');
      detachAbort();
      abort(new Error('OAuth state mismatch'));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body><h1>Authorization Successful</h1><p>You can close this window and return to the terminal.</p></body></html>');
    detachAbort();
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    const closing = server;
    server = undefined;
    closing?.removeAllListeners('error');
    closing?.close();
    settleListen();
    settleResult({ code, state });
  });

  server.on('error', (err) => {
    detachAbort();
    abort(new Error(`Failed to start callback server: ${err.message}`));
  });

  server.listen(port, '127.0.0.1', () => {
    logger.debug(`OAuth callback server listening on port ${port}`);
    settleListen();
  });

  return { listening, result, abort };
}

/**
 * Start a temporary local HTTP server to receive the OAuth callback.
 * Awaits a successful listen before waiting for the code.
 */
export async function startCallbackServer(
  redirectUri: string,
  expectedState: string,
  timeoutMs: number = 120_000,
  signal?: AbortSignal,
): Promise<AuthorizationResult> {
  const session = startCallbackSession(redirectUri, expectedState, timeoutMs, signal);
  await session.listening;
  return session.result;
}

// ============================================================================
// Browser Opener
// ============================================================================

/**
 * Open a URL in the default browser (cross-platform)
 */
export async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('child_process');

  const command = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;

  return new Promise((resolve, reject) => {
    exec(command, (err) => {
      if (err) {
        logger.warn('Failed to open browser — please open this URL manually:', { url });
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// ============================================================================
// Token Exchange
// ============================================================================

async function exchangeCodeForToken(
  config: MCPOAuthConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<MCPOAuthToken> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
  });

  if (config.clientSecret) {
    params.set('client_secret', config.clientSecret);
  }

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${body}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    scopes: data.scope ? data.scope.split(' ') : config.scopes,
  };
}

// ============================================================================
// MCPOAuthManager
// ============================================================================

export class MCPOAuthManager {
  private tokenCache: Map<string, MCPOAuthToken> = new Map();

  /**
   * Start the full OAuth Authorization Code + PKCE flow.
   *
   * 1. Generate PKCE code_verifier + code_challenge
   * 2. Start local callback server
   * 3. Open browser for authorization
   * 4. Exchange code for token
   * 5. Store token encrypted
   */
  async startAuthFlow(config: MCPOAuthConfig, serverId?: string): Promise<MCPOAuthToken> {
    const redirectUri = config.redirectUri || 'http://localhost:19836/callback';

    // PKCE
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString('hex');

    // Build authorization URL
    const authUrl = new URL(config.authorizationUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', config.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', config.scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    // Bind the loopback callback before opening the browser: a listen failure
    // must not launch a flow that can never complete (same contract as the SDK
    // provider path). Keep the manual URL if the opener fails.
    const session = startCallbackSession(redirectUri, state);
    await session.listening;
    logger.info('Opening browser for OAuth authorization...');
    try {
      await openBrowser(authUrl.toString());
    } catch {
      logger.info(`Please open this URL in your browser:\n${authUrl.toString()}`);
    }

    const { code } = await session.result;

    // Exchange code for token
    const token = await exchangeCodeForToken(config, code, codeVerifier, redirectUri);

    // Store token
    if (serverId) {
      this.storeToken(serverId, token, config);
    }

    return token;
  }

  /**
   * Refresh an expired token using the refresh_token grant
   */
  async refreshToken(config: MCPOAuthConfig, refreshToken: string): Promise<MCPOAuthToken> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
    });

    if (config.clientSecret) {
      params.set('client_secret', config.clientSecret);
    }

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${body}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken, // Keep old refresh token if not rotated
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      scopes: data.scope ? data.scope.split(' ') : config.scopes,
    };
  }

  /**
   * Get a valid (non-expired) token for a server, auto-refreshing if needed.
   * Returns null if no token is stored.
   */
  async getValidToken(serverId: string): Promise<string | null> {
    // Check in-memory cache first
    const cached = this.tokenCache.get(serverId);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.accessToken;
    }

    // Load from disk
    const store = loadTokenStore();
    const entry = store[serverId];
    const token = entry?.token;
    if (!token?.accessToken || !entry) return null;

    const { config } = entry;

    // If token is still valid (with 60s buffer), return it
    if (token.expiresAt > Date.now() + 60_000) {
      this.tokenCache.set(serverId, token);
      return token.accessToken;
    }

    // Entries written by the SDK-backed provider are refreshed by the SDK itself.
    if (config.tokenUrl === SDK_MANAGED_TOKEN_URL) {
      logger.debug(`MCP OAuth token for ${serverId} is SDK-managed; refresh happens on the next transport connection`);
      return null;
    }

    // Try to refresh
    if (token.refreshToken) {
      try {
        const refreshed = await this.refreshToken(
          {
            clientId: config.clientId,
            tokenUrl: config.tokenUrl,
            scopes: token.scopes,
            authorizationUrl: '', // Not needed for refresh
          },
          token.refreshToken,
        );

        this.storeToken(serverId, refreshed, {
          clientId: config.clientId,
          tokenUrl: config.tokenUrl,
          scopes: refreshed.scopes,
          authorizationUrl: '',
        });

        return refreshed.accessToken;
      } catch (err) {
        logger.warn(`Failed to refresh OAuth token for ${serverId}`, { error: err });
        return null;
      }
    }

    // Token expired and no refresh token
    return null;
  }

  /**
   * Store a token encrypted on disk and in memory cache.
   * Preserves any previously persisted client metadata for the same server.
   */
  storeToken(serverId: string, token: MCPOAuthToken, config: MCPOAuthConfig): void {
    this.tokenCache.set(serverId, token);

    const store = loadTokenStore();
    const prev = store[serverId];
    const clientId = config.clientId || prev?.config.clientId || prev?.client?.client_id || '';
    const client = prev?.client
      ? storedClientFrom({ ...prev.client, ...(clientId ? { client_id: clientId } : {}) })
      : (clientId ? storedClientFrom({ client_id: clientId }) : undefined);
    store[serverId] = {
      token,
      config: {
        clientId,
        tokenUrl: config.tokenUrl || prev?.config.tokenUrl || SDK_MANAGED_TOKEN_URL,
      },
      ...(client ? { client } : {}),
    };
    saveTokenStore(store);
  }

  /**
   * Persist client registration (client_id and optional DCR metadata) in the
   * encrypted store, even before a token exists. Never writes plaintext.
   */
  storeClientInformation(serverId: string, info: StoredClientInformation): void {
    const client = storedClientFrom(info);
    const store = loadTokenStore();
    const prev = store[serverId];
    store[serverId] = {
      ...(prev?.token ? { token: prev.token } : {}),
      config: {
        clientId: client.client_id,
        tokenUrl: prev?.config.tokenUrl ?? SDK_MANAGED_TOKEN_URL,
      },
      client,
    };
    saveTokenStore(store);
  }

  /**
   * Remove a stored token
   */
  removeToken(serverId: string): void {
    this.tokenCache.delete(serverId);
    const store = loadTokenStore();
    delete store[serverId];
    saveTokenStore(store);
  }

  /** Drop access/refresh tokens only; keep client_id and DCR metadata. */
  clearTokens(serverId: string): void {
    this.tokenCache.delete(serverId);
    const store = loadTokenStore();
    const prev = store[serverId];
    if (!prev) return;
    const { token: _dropped, ...rest } = prev;
    store[serverId] = rest;
    if (!rest.client && !rest.config?.clientId) delete store[serverId];
    saveTokenStore(store);
  }

  /**
   * Check if a token exists for a server (may be expired)
   */
  /** Stored token and client id for a server, without refresh side effects. */
  getStoredToken(serverId: string): { token: MCPOAuthToken; clientId: string; client?: StoredClientInformation } | null {
    const entry = loadTokenStore()[serverId];
    if (!entry?.token?.accessToken) return null;
    return { token: entry.token, clientId: entry.config.clientId, ...(entry.client ? { client: entry.client } : {}) };
  }

  /** Persisted client id / DCR metadata, independent of whether a token exists. */
  getStoredClientInformation(serverId: string): StoredClientInformation | null {
    const entry = loadTokenStore()[serverId];
    if (entry?.client?.client_id) return entry.client;
    if (entry?.config.clientId) return { client_id: entry.config.clientId };
    return null;
  }

  hasToken(serverId: string): boolean {
    const store = loadTokenStore();
    return Boolean(store[serverId]?.token?.accessToken);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: MCPOAuthManager | null = null;

export function getMCPOAuthManager(): MCPOAuthManager {
  if (!_instance) {
    _instance = new MCPOAuthManager();
  }
  return _instance;
}

export function resetMCPOAuthManager(): void {
  _instance = null;
}
