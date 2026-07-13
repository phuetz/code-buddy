import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpHome: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => tmpHome };
});

function makeJwt(claims: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.`;
}

function writeRecentAuth(): void {
  const dir = path.join(tmpHome, '.codebuddy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'codex-auth.json'), JSON.stringify({
    tokens: {
      id_token: makeJwt(),
      access_token: 'recent-but-rejected-access',
      refresh_token: 'rotating-refresh-1',
    },
    last_refresh: new Date().toISOString(),
  }));
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-codex-refresh-'));
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('refreshChatGptAuth', () => {
  it('forces refresh of a recent token and coalesces concurrent 401 recovery', async () => {
    writeRecentAuth();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        id_token: makeJwt(),
        access_token: 'fresh-access',
        refresh_token: 'rotating-refresh-2',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const { refreshChatGptAuth, getChatGptAuth } = await import('../../src/providers/codex-oauth.js');

    const [first, second] = await Promise.all([
      refreshChatGptAuth(),
      refreshChatGptAuth(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first?.access_token).toBe('fresh-access');
    expect(second?.access_token).toBe('fresh-access');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'rotating-refresh-1',
    });

    const stored = JSON.parse(fs.readFileSync(
      path.join(tmpHome, '.codebuddy', 'codex-auth.json'),
      'utf8',
    ));
    expect(stored.tokens.access_token).toBe('fresh-access');
    expect(stored.tokens.refresh_token).toBe('rotating-refresh-2');

    // Recent refreshed credentials are returned without another token call.
    expect((await getChatGptAuth())?.access_token).toBe('fresh-access');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
