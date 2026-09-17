/**
 * OAuth provider bridge for HTTP MCP transports.
 *
 * Adapts the SDK `OAuthClientProvider` contract (RFC 9728 discovery, PKCE,
 * URL-based client IDs / dynamic registration handled by the SDK itself) onto
 * the existing encrypted token store of `mcp-oauth.ts`. No parallel OAuth
 * implementation: PKCE, discovery and token exchange come from the SDK; the
 * local callback server, browser opening and token persistence come from the
 * existing manager.
 */

import * as crypto from 'crypto';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { logger } from '../utils/logger.js';
import { SDK_MANAGED_TOKEN_URL } from './mcp-oauth-constants.js';
import {
  getMCPOAuthManager,
  OAuthCallbackCancelledError,
  openBrowser,
  startCallbackServer,
  startCallbackSession,
  type CallbackSession,
  type StoredClientInformation,
} from './mcp-oauth.js';

export { SDK_MANAGED_TOKEN_URL };

export interface MCPTransportOAuthConfig {
  type: 'oauth';
  /** Key of the stored token; defaults to the server URL host. */
  serverId?: string;
  /** SEP-991 URL-based client id (HTTPS document). Used when the server advertises support. */
  clientMetadataUrl?: string;
  /** Pre-registered public client id (token_endpoint_auth_method none). */
  clientId?: string;
  scopes?: string[];
  /** Loopback redirect; default http://localhost:19836/callback (same as mcp-oauth.ts). */
  redirectUri?: string;
  /** When false, an authorization requirement fails closed instead of opening a browser. */
  interactive?: boolean;
}

export interface OAuthWaitOptions {
  signal?: AbortSignal;
}

export interface OAuthInteraction {
  openUrl: (url: string) => Promise<void>;
  waitForCode: (redirectUri: string, state: string, opts?: OAuthWaitOptions) => Promise<string>;
  /** Production default: bind the callback port before openUrl. Tests may omit this. */
  beginWaitForCode?: (redirectUri: string, state: string, opts?: OAuthWaitOptions) => CallbackSession;
}

const DEFAULT_REDIRECT = 'http://localhost:19836/callback';

function waitUntilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function storedClientFromMixed(info: OAuthClientInformationMixed): StoredClientInformation {
  const client: StoredClientInformation = { client_id: info.client_id };
  if (info.client_secret) client.client_secret = info.client_secret;
  if (info.client_id_issued_at !== undefined) client.client_id_issued_at = info.client_id_issued_at;
  if (info.client_secret_expires_at !== undefined) client.client_secret_expires_at = info.client_secret_expires_at;
  if ('redirect_uris' in info && info.redirect_uris) client.redirect_uris = info.redirect_uris.map(String);
  if ('token_endpoint_auth_method' in info && info.token_endpoint_auth_method) {
    client.token_endpoint_auth_method = info.token_endpoint_auth_method;
  }
  if ('grant_types' in info && info.grant_types) client.grant_types = info.grant_types;
  if ('response_types' in info && info.response_types) client.response_types = info.response_types;
  if ('client_name' in info && info.client_name) client.client_name = info.client_name;
  if ('scope' in info && info.scope) client.scope = info.scope;
  return client;
}

function defaultInteraction(): OAuthInteraction {
  return {
    openUrl: (url) => openBrowser(url),
    waitForCode: async (redirectUri, state, opts) =>
      (await startCallbackServer(redirectUri, state, 120_000, opts?.signal)).code,
    beginWaitForCode: (redirectUri, state, opts) =>
      startCallbackSession(redirectUri, state, 120_000, opts?.signal),
  };
}

let interaction: OAuthInteraction = defaultInteraction();

/** Tests inject a fake browser; production keeps the default loopback flow. */
export function setMCPOAuthInteraction(next: OAuthInteraction | null): void {
  interaction = next ?? defaultInteraction();
}

interface FinishAuthTransport {
  finishAuth(authorizationCode: string): Promise<void>;
}

export class MCPStoredOAuthProvider implements OAuthClientProvider {
  private verifier?: string;
  private stateValue?: string;
  private client?: OAuthClientInformationMixed;
  private transport?: FinishAuthTransport;
  /** Single in-flight authorization: concurrent SDK auth() calls share it. */
  private pending?: Promise<void>;
  private flowAbort?: AbortController;
  private callbackSession?: CallbackSession;
  /** Set by abortAuthorization so a late successful callback cannot finishAuth. */
  private authCancelled = false;

  constructor(private readonly serverId: string, private readonly auth: MCPTransportOAuthConfig) {}

  attachTransport(transport: FinishAuthTransport): void {
    this.transport = transport;
  }

  get redirectUrl(): string {
    return this.auth.redirectUri ?? DEFAULT_REDIRECT;
  }

  get clientMetadataUrl(): string | undefined {
    return this.auth.clientMetadataUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Code Buddy',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(this.auth.scopes?.length ? { scope: this.auth.scopes.join(' ') } : {}),
    };
  }

  state(): string {
    this.stateValue = crypto.randomBytes(16).toString('hex');
    return this.stateValue;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    if (this.auth.clientId) return { client_id: this.auth.clientId };
    if (this.client) return this.client;
    const stored = getMCPOAuthManager().getStoredClientInformation(this.serverId);
    return stored ?? undefined;
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.client = info;
    getMCPOAuthManager().storeClientInformation(this.serverId, storedClientFromMixed(info));
  }

  tokens(): OAuthTokens | undefined {
    const stored = getMCPOAuthManager().getStoredToken(this.serverId);
    if (!stored) return undefined;
    const { token } = stored;
    return {
      access_token: token.accessToken,
      token_type: 'bearer',
      ...(token.refreshToken ? { refresh_token: token.refreshToken } : {}),
      expires_in: Math.max(0, Math.floor((token.expiresAt - Date.now()) / 1000)),
      ...(token.scopes.length ? { scope: token.scopes.join(' ') } : {}),
    };
  }

  saveTokens(tokens: OAuthTokens): void {
    const clientId = this.clientInformation()?.client_id ?? '';
    getMCPOAuthManager().storeToken(
      this.serverId,
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        scopes: tokens.scope ? tokens.scope.split(' ') : (this.auth.scopes ?? []),
      },
      { clientId, clientSecret: undefined, authorizationUrl: '', tokenUrl: SDK_MANAGED_TOKEN_URL, scopes: this.auth.scopes ?? [] },
    );
  }

  abortAuthorization(reason?: Error): void {
    this.authCancelled = true;
    this.flowAbort?.abort();
    this.callbackSession?.abort(reason);
  }

  redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this.auth.interactive === false) {
      return Promise.reject(new Error(`MCP server "${this.serverId}" requires OAuth authorization; run the connection interactively to sign in.`));
    }
    if (!this.transport) {
      return Promise.reject(new Error('OAuth provider is not attached to a transport'));
    }
    if (this.pending) return this.pending;
    this.authCancelled = false;
    this.flowAbort = new AbortController();
    const signal = this.flowAbort.signal;
    const url = authorizationUrl.toString();
    this.pending = (async () => {
      const state = this.stateValue ?? this.state();
      const opts = { signal };
      let code: string;
      if (interaction.beginWaitForCode) {
        const session = interaction.beginWaitForCode(this.redirectUrl, state, opts);
        this.callbackSession = session;
        await session.listening;
        this.throwIfAuthCancelled(signal);
        logger.info(`MCP "${this.serverId}": opening browser for OAuth authorization`);
        await this.openAuthorizationUrl(url, signal);
        this.throwIfAuthCancelled(signal);
        code = (await session.result).code;
      } else {
        const codePromise = interaction.waitForCode(this.redirectUrl, state, opts);
        logger.info(`MCP "${this.serverId}": opening browser for OAuth authorization`);
        await this.openAuthorizationUrl(url, signal);
        this.throwIfAuthCancelled(signal);
        code = await codePromise;
      }
      this.throwIfAuthCancelled(signal);
      await this.transport!.finishAuth(code);
    })().finally(() => {
      this.pending = undefined;
      this.callbackSession = undefined;
      this.flowAbort = undefined;
    });
    return this.pending;
  }

  private throwIfAuthCancelled(signal: AbortSignal): void {
    if (this.authCancelled || signal.aborted) {
      throw new OAuthCallbackCancelledError();
    }
  }

  /**
   * Open the system browser. A slow opener is raced against abort so
   * removeServer does not stay stuck in openUrl; a failed opener still
   * prints the URL so the user can complete the loopback callback by hand.
   */
  private async openAuthorizationUrl(url: string, signal: AbortSignal): Promise<void> {
    this.throwIfAuthCancelled(signal);
    const aborted = waitUntilAborted(signal);
    aborted.catch(() => undefined);
    const opener = interaction.openUrl(url).then(
      () => 'opened' as const,
      () => 'failed' as const,
    );
    const outcome = await Promise.race([
      opener.then((kind) => ({ kind })),
      aborted.then(() => ({ kind: 'aborted' as const })),
    ]);
    if (outcome.kind === 'aborted' || this.authCancelled) {
      throw new OAuthCallbackCancelledError();
    }
    if (outcome.kind === 'failed') {
      logger.warn(
        `MCP "${this.serverId}": browser could not be opened; open this URL manually:\n${url}`,
      );
    }
  }

  saveCodeVerifier(codeVerifier: string): void {
    // A concurrent auth() while the browser flow is pending must not replace the
    // verifier the pending flow will exchange its code with.
    if (this.pending) return;
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.verifier) throw new Error('No PKCE code verifier saved');
    return this.verifier;
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): void {
    if (scope === 'tokens') {
      getMCPOAuthManager().clearTokens(this.serverId);
      return;
    }
    if (scope === 'all' || scope === 'client') {
      getMCPOAuthManager().removeToken(this.serverId);
      this.client = undefined;
    }
    if (scope === 'all' || scope === 'verifier') this.verifier = undefined;
  }
}

export function createOAuthProvider(url: string, auth: MCPTransportOAuthConfig): MCPStoredOAuthProvider {
  const serverId = auth.serverId ?? new URL(url).host;
  // Fail closed before the SDK performs discovery or client registration: without a
  // stored token, a non-interactive connection can never complete.
  if (auth.interactive === false && !getMCPOAuthManager().getStoredToken(serverId)) {
    throw new Error(`MCP server "${serverId}" requires OAuth authorization; run the connection interactively to sign in.`);
  }
  return new MCPStoredOAuthProvider(serverId, auth);
}
