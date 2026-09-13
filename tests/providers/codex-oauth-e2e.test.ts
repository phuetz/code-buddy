/**
 * Phase d.24 — E2E test for the Codex OAuth login flow.
 *
 * Exercise the real callback server with a simulated browser and issuer:
 * normal login, manual browser fallback, and a real persistence failure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const openMock = vi.hoisted(() => ({
  capturedUrl: null as string | null,
  fn: vi.fn((url: string) => {
    (openMock as unknown as { capturedUrl: string | null }).capturedUrl = url;
    return Promise.resolve({} as never);
  }),
}));

vi.mock('open', () => ({ default: openMock.fn }));

let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => tmpHome };
});

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-oauth-e2e-'));
  openMock.capturedUrl = null;
  openMock.fn.mockClear();
  vi.resetModules();
});

afterEach(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* ignore */ }
  vi.restoreAllMocks();
});

async function waitForOpenCalled(timeoutMs = 5000): Promise<string> {
  const start = Date.now();
  while (!openMock.capturedUrl) {
    if (Date.now() - start > timeoutMs) throw new Error('open() never called');
    await new Promise((r) => setTimeout(r, 25));
  }
  return openMock.capturedUrl;
}

describe('Codex OAuth — E2E login happy path', () => {
  it.each([
    { browserFails: false, storageFails: false },
    { browserFails: true, storageFails: false },
    { browserFails: false, storageFails: true },
  ])('full flow with browser failure=$browserFails and storage failure=$storageFails', async ({ browserFails, storageFails }) => {
    // Capture the real fetch BEFORE we mock global fetch, so the
    // simulated callback request can still hit our local server.
    const realFetch = globalThis.fetch.bind(globalThis);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL | Request).toString();
      if (url === 'https://auth.openai.com/oauth/token') {
        const idTokenPayload = Buffer.from(JSON.stringify({
          'https://api.openai.com/profile': { email: 'patrice@example.com' },
          'https://api.openai.com/auth': {
            chatgpt_account_id: 'acct_e2e',
            chatgpt_plan_type: 'plus',
            chatgpt_account_is_fedramp: false,
          },
        })).toString('base64url');
        return new Response(
          JSON.stringify({
            id_token: `header.${idTokenPayload}.sig`,
            access_token: 'access-tok-e2e',
            refresh_token: 'refresh-tok-e2e',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // Anything else (the simulated callback hitting localhost) → real fetch.
      return realFetch(input as RequestInfo, init);
    });

    const { getChatGptAuth, getCodexAuthFilePath } = await import(
      '../../src/providers/codex-oauth.js'
    );
    const { loginChatGptWithBrowser } = await import('../../src/commands/login-chatgpt.js');
    if (storageFails) {
      // A directory at the target path makes the real atomic rename fail.
      fs.mkdirSync(getCodexAuthFilePath(), { recursive: true });
    }
    if (browserFails) {
      openMock.fn.mockImplementationOnce((url: string) => {
        openMock.capturedUrl = url;
        return Promise.reject(new Error('Browser unavailable'));
      });
    }
    const output = { stdout: vi.fn(), warn: vi.fn() };
    const loginPromise = loginChatGptWithBrowser(output);
    const loginFailure = loginPromise.then(() => null, (error: unknown) => error);

    // Wait for browser-open, parse the URL.
    const authorizeUrl = await waitForOpenCalled();
    expect(output.stdout).toHaveBeenCalledWith(authorizeUrl);
    expect(output.stdout.mock.invocationCallOrder[1]).toBeLessThan(openMock.fn.mock.invocationCallOrder[0]!);
    if (browserFails) {
      expect(output.warn).toHaveBeenCalledWith(expect.stringContaining('Open the URL above manually'));
    } else {
      expect(output.warn).not.toHaveBeenCalled();
    }
    const u = new URL(authorizeUrl);
    const redirectUri = u.searchParams.get('redirect_uri') ?? '';
    const portMatch = redirectUri.match(/:(\d+)\/auth\/callback/);
    expect(portMatch).toBeTruthy();
    const port = Number(portMatch![1]);
    const state = u.searchParams.get('state') ?? '';
    expect(state.length).toBeGreaterThan(20);

    // Simulate the user completing OAuth → OpenAI redirects to our callback.
    const cbUrl = new URL(`http://127.0.0.1:${port}/auth/callback`);
    cbUrl.searchParams.set('code', 'auth-code-e2e');
    cbUrl.searchParams.set('state', state);
    const cb = await realFetch(cbUrl.toString());
    if (storageFails) {
      expect(cb.status).toBe(500);
      const html = await cb.text();
      expect(html).toContain('Could not save ChatGPT credentials');
      expect(html).not.toContain('Authentifié à ChatGPT');
      expect(html).not.toContain('access-tok-e2e');
      expect(await loginFailure).toEqual(expect.objectContaining({
        message: expect.stringContaining('Could not save ChatGPT credentials'),
      }));
      expect(fs.statSync(getCodexAuthFilePath()).isDirectory()).toBe(true);
      return;
    }
    expect(cb.status).toBe(200);
    const html = await cb.text();
    expect(html).toContain('Authentifié à ChatGPT');

    // The login promise resolves with parsed claims.
    const auth = await loginPromise;
    expect(auth.email).toBe('patrice@example.com');
    expect(auth.plan_type).toBe('plus');
    expect(auth.account_id).toBe('acct_e2e');
    expect(auth.access_token).toBe('access-tok-e2e');
    expect(auth.is_fedramp).toBe(false);

    // Disk persistence verified.
    const authPath = getCodexAuthFilePath();
    expect(fs.existsSync(authPath)).toBe(true);
    const stored = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    expect(stored.tokens.access_token).toBe('access-tok-e2e');
    expect(stored.tokens.refresh_token).toBe('refresh-tok-e2e');
    expect(stored.last_refresh).toBeTruthy();

    // getChatGptAuth() reads back the same data with claims extracted.
    const round = await getChatGptAuth();
    expect(round?.email).toBe('patrice@example.com');
    expect(round?.access_token).toBe('access-tok-e2e');

    // Token endpoint POST captured: grant_type=authorization_code + PKCE.
    const tokenCalls = fetchSpy.mock.calls.filter(([url]) =>
      typeof url === 'string' && url === 'https://auth.openai.com/oauth/token',
    );
    expect(tokenCalls.length).toBe(1);
    const body = (tokenCalls[0][1] as RequestInit).body as string;
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=auth-code-e2e');
    expect(body).toContain('code_verifier=');

    fetchSpy.mockRestore();
  }, 15000);
});
