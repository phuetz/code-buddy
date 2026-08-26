/**
 * MCP OAuth Support — Unit Tests
 *
 * Tests: PKCE generation, token storage (encrypt/decrypt), token management,
 * refresh token flow, and the MCPOAuthManager class.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  MCPOAuthManager,
  resetMCPOAuthManager,
} from '../../src/mcp/mcp-oauth';

// Mock fetch for token exchange
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Use a temp directory for token storage
let tempDir: string;
const originalCwd = process.cwd;

beforeEach(() => {
  jest.clearAllMocks();
  resetMCPOAuthManager();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-oauth-test-'));
  fs.mkdirSync(path.join(tempDir, '.codebuddy'), { recursive: true });
  // Override process.cwd to use temp dir
  process.cwd = () => tempDir;
  // Set encryption key for tests
  process.env.CODEBUDDY_VAULT_KEY = 'test-key-for-mcp-oauth-tests';
});

afterEach(() => {
  process.cwd = originalCwd;
  delete process.env.CODEBUDDY_VAULT_KEY;
  try {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch { /* ignore */ }
});

describe('PKCE', () => {
  it('should generate a code verifier with correct length and format', () => {
    const verifier = generateCodeVerifier();
    expect(typeof verifier).toBe('string');
    expect(verifier.length).toBeGreaterThanOrEqual(40);
    // base64url characters only
    expect(/^[A-Za-z0-9_-]+$/.test(verifier)).toBe(true);
  });

  it('should generate different verifiers each time', () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(v1).not.toBe(v2);
  });

  it('should generate correct S256 code challenge', () => {
    const verifier = 'test-verifier-12345';
    const challenge = generateCodeChallenge(verifier);
    // Verify it matches SHA-256 of the verifier
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });

  it('should generate base64url-encoded challenge (no padding)', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    expect(challenge).not.toContain('+');
    expect(challenge).not.toContain('/');
    expect(challenge).not.toContain('=');
  });
});

describe('MCPOAuthManager', () => {
  let manager: MCPOAuthManager;

  beforeEach(() => {
    manager = new MCPOAuthManager();
  });

  it('should store and retrieve a token', async () => {
    const config = {
      clientId: 'test-client',
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      scopes: ['read', 'write'],
    };

    const token = {
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-456',
      expiresAt: Date.now() + 3600 * 1000,
      scopes: ['read', 'write'],
    };

    manager.storeToken('test-server', token, config);
    const retrieved = await manager.getValidToken('test-server');
    expect(retrieved).toBe('access-token-123');
  });

  it('should return null for non-existent server', async () => {
    const result = await manager.getValidToken('nonexistent-server');
    expect(result).toBeNull();
  });

  it('should refresh expired token', async () => {
    const config = {
      clientId: 'test-client',
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      scopes: ['read'],
    };

    // Store an expired token
    const expiredToken = {
      accessToken: 'old-token',
      refreshToken: 'refresh-123',
      expiresAt: Date.now() - 1000, // Already expired
      scopes: ['read'],
    };
    manager.storeToken('test-server', expiredToken, config);

    // Mock the refresh endpoint
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        scope: 'read',
      }),
    });

    const token = await manager.getValidToken('test-server');
    expect(token).toBe('new-access-token');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify the fetch call was to the token URL with refresh_token grant
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toBe('https://auth.example.com/token');
    const body = fetchCall[1].body as string;
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=refresh-123');
  });

  it('should remove a token', async () => {
    const config = {
      clientId: 'test-client',
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      scopes: ['read'],
    };

    const token = {
      accessToken: 'to-be-removed',
      expiresAt: Date.now() + 3600 * 1000,
      scopes: ['read'],
    };

    manager.storeToken('server-to-remove', token, config);
    expect(manager.hasToken('server-to-remove')).toBe(true);

    manager.removeToken('server-to-remove');
    expect(manager.hasToken('server-to-remove')).toBe(false);

    const result = await manager.getValidToken('server-to-remove');
    expect(result).toBeNull();
  });

  it('should check token existence', () => {
    const config = {
      clientId: 'c',
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      scopes: [],
    };

    expect(manager.hasToken('my-server')).toBe(false);
    manager.storeToken('my-server', {
      accessToken: 'x',
      expiresAt: Date.now() + 3600000,
      scopes: [],
    }, config);
    expect(manager.hasToken('my-server')).toBe(true);
  });

  it('should persist tokens to encrypted file and load them back', () => {
    const config = {
      clientId: 'persist-client',
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      scopes: ['read'],
    };

    const token = {
      accessToken: 'persisted-token',
      expiresAt: Date.now() + 3600 * 1000,
      scopes: ['read'],
    };

    manager.storeToken('persist-server', token, config);

    // Verify the encrypted file exists
    const tokenFile = path.join(tempDir, '.codebuddy', 'mcp-tokens.json');
    expect(fs.existsSync(tokenFile)).toBe(true);

    // The file should be encrypted (not plain JSON)
    const fileContent = fs.readFileSync(tokenFile, 'utf-8');
    expect(() => JSON.parse(fileContent)).toThrow(); // Not valid JSON

    // Create a new manager — it should load from disk
    const newManager = new MCPOAuthManager();
    expect(newManager.hasToken('persist-server')).toBe(true);
  });

  it('should handle refresh failure gracefully', async () => {
    const config = {
      clientId: 'fail-client',
      authorizationUrl: 'https://auth.example.com/authorize',
      tokenUrl: 'https://auth.example.com/token',
      scopes: ['read'],
    };

    const expiredToken = {
      accessToken: 'expired',
      refreshToken: 'bad-refresh',
      expiresAt: Date.now() - 1000,
      scopes: ['read'],
    };
    manager.storeToken('fail-server', expiredToken, config);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    });

    const token = await manager.getValidToken('fail-server');
    expect(token).toBeNull();
  });
});
