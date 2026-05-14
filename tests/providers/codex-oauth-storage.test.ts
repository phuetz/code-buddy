/**
 * ChatGPT subscription credential storage tests.
 *
 * Code Buddy writes its own OAuth file, but it can also reuse the native
 * Codex CLI auth file that powers the user's ChatGPT Pro workflow.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpHome: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => tmpHome };
});

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-codex-auth-storage-'));
  vi.resetModules();
});

afterEach(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  vi.restoreAllMocks();
});

function makeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.`;
}

function writeAuth(relativePath: string, content: unknown): string {
  const filePath = path.join(tmpHome, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
  return filePath;
}

function authFile(email: string, accessToken: string, refreshToken: string, lastRefresh: string): unknown {
  return {
    tokens: {
      id_token: makeJwt({
        'https://api.openai.com/profile': { email },
        'https://api.openai.com/auth': {
          chatgpt_account_id: `acct-${email}`,
          chatgpt_plan_type: 'pro',
          chatgpt_account_is_fedramp: false,
        },
      }),
      access_token: accessToken,
      refresh_token: refreshToken,
    },
    last_refresh: lastRefresh,
  };
}

describe('codex-oauth credential storage', () => {
  it('uses shared Codex CLI credentials when Code Buddy credentials are absent', async () => {
    const sharedPath = writeAuth(
      path.join('.codex', 'auth.json'),
      authFile('shared@example.com', 'shared-access', 'shared-refresh', new Date().toISOString()),
    );

    const {
      getChatGptAuth,
      hasCodexCredentials,
      hasCodeBuddyCodexCredentials,
      getActiveCodexAuthFilePath,
    } = await import('../../src/providers/codex-oauth.js');

    const auth = await getChatGptAuth();
    expect(hasCodexCredentials()).toBe(true);
    expect(hasCodeBuddyCodexCredentials()).toBe(false);
    expect(getActiveCodexAuthFilePath()).toBe(sharedPath);
    expect(auth?.email).toBe('shared@example.com');
    expect(auth?.plan_type).toBe('pro');
    expect(auth?.auth_source).toBe('codex-cli');
    expect(auth?.auth_file_path).toBe(sharedPath);
  });

  it('prefers Code Buddy credentials over shared Codex CLI credentials', async () => {
    const codeBuddyPath = writeAuth(
      path.join('.codebuddy', 'codex-auth.json'),
      authFile('codebuddy@example.com', 'cb-access', 'cb-refresh', new Date().toISOString()),
    );
    writeAuth(
      path.join('.codex', 'auth.json'),
      authFile('shared@example.com', 'shared-access', 'shared-refresh', new Date().toISOString()),
    );

    const { getChatGptAuth, getActiveCodexAuthFilePath } = await import(
      '../../src/providers/codex-oauth.js'
    );

    const auth = await getChatGptAuth();
    expect(getActiveCodexAuthFilePath()).toBe(codeBuddyPath);
    expect(auth?.email).toBe('codebuddy@example.com');
    expect(auth?.auth_source).toBe('codebuddy');
  });

  it('refreshes shared Codex CLI credentials in place and preserves extra fields', async () => {
    const staleDate = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const refreshedIdToken = makeJwt({
      'https://api.openai.com/profile': { email: 'shared@example.com' },
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct-refreshed',
        chatgpt_plan_type: 'pro',
      },
    });
    const sharedPath = writeAuth(path.join('.codex', 'auth.json'), {
      auth_mode: 'chatgpt',
      tokens: {
        id_token: makeJwt({}),
        access_token: 'old-access',
        refresh_token: 'old-refresh',
        account_id: 'old-account',
      },
      last_refresh: staleDate,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id_token: refreshedIdToken,
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          account_id: 'acct-refreshed',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const { getChatGptAuth } = await import('../../src/providers/codex-oauth.js');

    const auth = await getChatGptAuth();
    const stored = JSON.parse(fs.readFileSync(sharedPath, 'utf-8'));
    expect(auth?.access_token).toBe('new-access');
    expect(auth?.account_id).toBe('acct-refreshed');
    expect(auth?.auth_source).toBe('codex-cli');
    expect(stored.auth_mode).toBe('chatgpt');
    expect(stored.tokens.access_token).toBe('new-access');
    expect(stored.tokens.refresh_token).toBe('new-refresh');
  });
});
