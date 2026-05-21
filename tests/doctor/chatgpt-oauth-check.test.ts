/**
 * Phase d.24 — tests for the ChatGPT OAuth doctor check.
 *
 * `runDoctorChecks()` includes a check that surfaces the user's ChatGPT
 * auth status. Three scenarios:
 *   - No credentials on disk → warn (not fatal — user might use API key)
 *   - Valid credentials → ok with email + plan
 *   - File present but unreadable → error with actionable message
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
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-doctor-chatgpt-'));
  vi.resetModules();
});

afterEach(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  vi.restoreAllMocks();
});

function writeAuthFile(content: unknown): void {
  const dir = path.join(tmpHome, '.codebuddy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'codex-auth.json'),
    typeof content === 'string' ? content : JSON.stringify(content, null, 2),
    'utf-8',
  );
}

function makeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.`;
}

describe('doctor — ChatGPT OAuth check', () => {
  it('returns warn when no credentials are on disk', async () => {
    const { runDoctorChecks } = await import('../../src/doctor/index.js');
    const checks = await runDoctorChecks(tmpHome);
    const chatgpt = checks.find((c) => c.name === 'ChatGPT OAuth');
    expect(chatgpt).toBeDefined();
    expect(chatgpt?.status).toBe('warn');
    expect(chatgpt?.message).toMatch(/not signed in/i);
    expect(chatgpt?.message).toMatch(/login chatgpt/i);
  }, 15_000);

  it('returns ok with email + plan when credentials are valid and recent', async () => {
    writeAuthFile({
      tokens: {
        id_token: makeJwt({
          'https://api.openai.com/profile': { email: 'patrice@example.com' },
          'https://api.openai.com/auth': {
            chatgpt_account_id: 'acct_42',
            chatgpt_plan_type: 'plus',
            chatgpt_account_is_fedramp: false,
          },
        }),
        access_token: 'tok',
        refresh_token: 'ref',
      },
      // Recent → no refresh attempt → no network call.
      last_refresh: new Date().toISOString(),
    });

    const { runDoctorChecks } = await import('../../src/doctor/index.js');
    const checks = await runDoctorChecks(tmpHome);
    const chatgpt = checks.find((c) => c.name === 'ChatGPT OAuth');
    expect(chatgpt?.status).toBe('ok');
    expect(chatgpt?.message).toContain('patrice@example.com');
    expect(chatgpt?.message).toContain('Plan: plus');
  }, 15_000);

  it('flags FedRAMP marker in the ok message when present', async () => {
    writeAuthFile({
      tokens: {
        id_token: makeJwt({
          'https://api.openai.com/profile': { email: 'enterprise@example.com' },
          'https://api.openai.com/auth': {
            chatgpt_account_is_fedramp: true,
            chatgpt_plan_type: 'enterprise',
          },
        }),
        access_token: 'tok',
        refresh_token: 'ref',
      },
      last_refresh: new Date().toISOString(),
    });

    const { runDoctorChecks } = await import('../../src/doctor/index.js');
    const checks = await runDoctorChecks(tmpHome);
    const chatgpt = checks.find((c) => c.name === 'ChatGPT OAuth');
    expect(chatgpt?.status).toBe('ok');
    expect(chatgpt?.message).toMatch(/FedRAMP/);
  });

  it('returns error when refresh fails on a stale token', async () => {
    // Stale → triggers a refresh attempt. Mock fetch to fail.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('revoked', { status: 401 }),
    );

    writeAuthFile({
      tokens: {
        id_token: makeJwt({
          'https://api.openai.com/profile': { email: 'old@example.com' },
        }),
        access_token: 'old-tok',
        refresh_token: 'old-ref',
      },
      // 2 days ago → > 1h refresh threshold.
      last_refresh: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    });

    const { runDoctorChecks } = await import('../../src/doctor/index.js');
    const checks = await runDoctorChecks(tmpHome);
    const chatgpt = checks.find((c) => c.name === 'ChatGPT OAuth');
    expect(chatgpt?.status).toBe('error');
    expect(chatgpt?.message).toMatch(/unreadable|logout/i);
  });
});
