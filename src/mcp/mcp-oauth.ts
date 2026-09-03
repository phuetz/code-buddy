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

interface StoredTokens {
  [serverId: string]: {
    token: MCPOAuthToken;
    config: {
      clientId: string;
      tokenUrl: string;
    };
  };
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
  // Use CODEBUDDY_VAULT_KEY if available, otherwise derive from machine ID
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

/**
 * Start a temporary local HTTP server to receive the OAuth callback.
 * Returns a promise that resolves with the authorization code.
 */
function startCallbackServer(
  redirectUri: string,
  expectedState: string,
  timeoutMs: number = 120_000,
): Promise<AuthorizationResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(redirectUri);
    const port = parseInt(url.port || '19836', 10);
    const pathname = url.pathname || '/callback';

    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', `http://localhost:${port}`);

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
        server.close();
        reject(new Error(`OAuth authorization error: ${error}`));
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
        server.close();
        reject(new Error('OAuth state mismatch'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Authorization Successful</h1><p>You can close this window and return to the terminal.</p></body></html>');
      server.close();
      resolve({ code, state });
    });

    // Set timeout
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('OAuth callback timed out (120s)'));
    }, timeoutMs);

    server.on('close', () => clearTimeout(timer));
    server.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start callback server: ${err.message}`));
    });

    server.listen(port, '127.0.0.1', () => {
      logger.debug(`OAuth callback server listening on port ${port}`);
    });
  });
}

// ============================================================================
// Browser Opener
// ============================================================================

/**
 * Open a URL in the default browser (cross-platform)
 */
async function openBrowser(url: string): Promise<void> {
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

    // Start callback server
    const callbackPromise = startCallbackServer(redirectUri, state);

    // Open browser
    logger.info('Opening browser for OAuth authorization...');
    try {
      await openBrowser(authUrl.toString());
    } catch {
      logger.info(`Please open this URL in your browser:\n${authUrl.toString()}`);
    }

    // Wait for callback
    const { code } = await callbackPromise;

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
    if (!entry) return null;

    const { token, config } = entry;

    // If token is still valid (with 60s buffer), return it
    if (token.expiresAt > Date.now() + 60_000) {
      this.tokenCache.set(serverId, token);
      return token.accessToken;
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
   * Store a token encrypted on disk and in memory cache
   */
  storeToken(serverId: string, token: MCPOAuthToken, config: MCPOAuthConfig): void {
    this.tokenCache.set(serverId, token);

    const store = loadTokenStore();
    store[serverId] = {
      token,
      config: {
        clientId: config.clientId,
        tokenUrl: config.tokenUrl,
      },
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

  /**
   * Check if a token exists for a server (may be expired)
   */
  hasToken(serverId: string): boolean {
    const store = loadTokenStore();
    return serverId in store;
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
