/**
 * Renouvellement du jeton ChatGPT : la VRAIE cause d'un échec doit être
 * journalisée et exposée (statut HTTP, code OAuth, détail nettoyé), jamais
 * un jeton. Faux serveur OAuth réel sur 127.0.0.1, fichiers de jetons
 * fabriqués dans un HOME jetable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';

let tmpHome: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => tmpHome };
});

const REFRESH_TOKEN = 'rt_FABRIQUE_pour_le_test_0123456789abcdef';

function makeJwt(claims: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.`;
}

function authPath(): string {
  return path.join(tmpHome, '.codebuddy', 'codex-auth.json');
}

function writeAuth(opts: { accessExpSec?: number; stale?: boolean; refreshToken?: string } = {}): void {
  fs.mkdirSync(path.dirname(authPath()), { recursive: true });
  const exp = opts.accessExpSec ?? Math.floor(Date.now() / 1000) + 3600;
  fs.writeFileSync(authPath(), JSON.stringify({
    tokens: {
      id_token: makeJwt({ email: 'inconnu@example.com' }),
      access_token: makeJwt({ exp }),
      refresh_token: opts.refreshToken ?? REFRESH_TOKEN,
    },
    last_refresh: opts.stale === false
      ? new Date().toISOString()
      : new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  }));
}

interface FakeIssuer {
  url: string;
  requests: number;
  close: () => Promise<void>;
}

async function startIssuer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<FakeIssuer> {
  const state = { requests: 0 };
  const server = http.createServer((req, res) => {
    state.requests += 1;
    req.resume();
    req.on('end', () => handler(req, res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    get requests() { return state.requests; },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function jsonReply(status: number, body: unknown) {
  return (_req: http.IncomingMessage, res: http.ServerResponse) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
}

let issuer: FakeIssuer | null = null;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-codex-cause-'));
  vi.resetModules();
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.CODEBUDDY_CHATGPT_OAUTH_ISSUER;
  if (issuer) await issuer.close();
  issuer = null;
  fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function load() {
  const { logger } = await import('../../src/utils/logger.js');
  const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  const mod = await import('../../src/providers/codex-oauth.js');
  return { mod, errorSpy };
}

function loggedText(spy: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify(spy.mock.calls);
}

describe('cause réelle d’un échec de renouvellement ChatGPT', () => {
  it('jeton déjà utilisé (401 OpenAI) : statut et code journalisés, jamais le jeton', async () => {
    writeAuth();
    issuer = await startIssuer(jsonReply(401, {
      error: {
        message: `Your refresh token has already been used to generate a new access token. ${REFRESH_TOKEN}`,
        type: 'invalid_request_error',
        code: 'refresh_token_reused',
      },
    }));
    process.env.CODEBUDDY_CHATGPT_OAUTH_ISSUER = issuer.url;
    const { mod, errorSpy } = await load();

    expect(await mod.refreshChatGptAuth()).toBeNull();
    const failure = mod.getLastChatGptRefreshFailure();
    expect(failure).toMatchObject({ kind: 'http', status: 401, code: 'refresh_token_reused', transient: false });
    expect(errorSpy).toHaveBeenCalledWith('ChatGPT token refresh failed', expect.objectContaining({
      kind: 'http', status: 401, code: 'refresh_token_reused',
    }));
    const logged = loggedText(errorSpy);
    expect(logged).not.toContain(REFRESH_TOKEN);
    expect(logged).not.toContain('"error":"Error"');
    expect(mod.describeChatGptRefreshFailure(failure!)).toMatch(/HTTP 401.*refresh_token_reused.*buddy login/s);
  });

  it('invalid_grant RFC 6749 (400) : code et description', async () => {
    writeAuth();
    issuer = await startIssuer(jsonReply(400, { error: 'invalid_grant', error_description: 'Refresh token expired' }));
    process.env.CODEBUDDY_CHATGPT_OAUTH_ISSUER = issuer.url;
    const { mod } = await load();
    expect(await mod.getChatGptAuth()).toBeNull();
    expect(mod.getLastChatGptRefreshFailure()).toMatchObject({
      kind: 'http', status: 400, code: 'invalid_grant', detail: 'Refresh token expired',
    });
  });

  it('réponse 200 non JSON : invalid-response, pas « Error »', async () => {
    writeAuth();
    issuer = await startIssuer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>portail captif</html>');
    });
    process.env.CODEBUDDY_CHATGPT_OAUTH_ISSUER = issuer.url;
    const { mod } = await load();
    expect(await mod.refreshChatGptAuth()).toBeNull();
    expect(mod.getLastChatGptRefreshFailure()).toMatchObject({
      kind: 'invalid-response', status: 200, detail: expect.stringContaining('text/html'),
    });
  });

  it('503 passager : jeton d’accès encore valide conservé, sans reconnexion', async () => {
    writeAuth({ accessExpSec: Math.floor(Date.now() / 1000) + 3600 });
    issuer = await startIssuer(jsonReply(503, { error: 'temporarily_unavailable' }));
    process.env.CODEBUDDY_CHATGPT_OAUTH_ISSUER = issuer.url;
    const { mod } = await load();
    const auth = await mod.getChatGptAuth();
    expect(auth?.email).toBe('inconnu@example.com');
    expect(mod.getLastChatGptRefreshFailure()).toMatchObject({ kind: 'http', status: 503, transient: true });
    // Le fichier n'a pas été touché : le jeton de rafraîchissement reste utilisable.
    expect(JSON.parse(fs.readFileSync(authPath(), 'utf8')).tokens.refresh_token).toBe(REFRESH_TOKEN);
  });

  it('réseau coupé : cause ECONNREFUSED ; jeton d’accès expiré ⇒ null', async () => {
    writeAuth({ accessExpSec: Math.floor(Date.now() / 1000) - 10 });
    issuer = await startIssuer(jsonReply(200, {}));
    const deadUrl = issuer.url;
    await issuer.close();
    issuer = null;
    process.env.CODEBUDDY_CHATGPT_OAUTH_ISSUER = deadUrl;
    const { mod } = await load();
    expect(await mod.getChatGptAuth()).toBeNull();
    expect(mod.getLastChatGptRefreshFailure()).toMatchObject({
      kind: 'network', code: 'ECONNREFUSED', transient: true,
    });
    expect(mod.describeChatGptRefreshFailure(mod.getLastChatGptRefreshFailure()!)).toMatch(/no re-login needed/);
  });

  it('une URL d’émetteur non locale est ignorée (le jeton ne part jamais ailleurs)', async () => {
    writeAuth();
    process.env.CODEBUDDY_CHATGPT_OAUTH_ISSUER = 'https://attaquant.example';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
    const { mod } = await load();
    await mod.refreshChatGptAuth();
    expect(String(fetchSpy.mock.calls[0]![0])).toBe('https://auth.openai.com/oauth/token');
  });

  it('un autre processus a déjà renouvelé : on relit le fichier sous le verrou, aucun appel', async () => {
    writeAuth({ stale: true });
    issuer = await startIssuer(jsonReply(401, { error: { code: 'refresh_token_reused' } }));
    process.env.CODEBUDDY_CHATGPT_OAUTH_ISSUER = issuer.url;
    const lockPath = `${authPath()}.refresh.lock`;
    fs.writeFileSync(lockPath, '99999');
    const { mod } = await load();

    const pending = mod.refreshChatGptAuth();
    // L'« autre processus » enregistre des jetons tournés puis libère le verrou.
    await new Promise((resolve) => setTimeout(resolve, 250));
    fs.writeFileSync(authPath(), JSON.stringify({
      tokens: {
        id_token: makeJwt({ email: 'inconnu@example.com' }),
        access_token: 'acces-tourne-par-l-autre-processus',
        refresh_token: 'rt_tourne_par_l_autre_processus',
      },
      last_refresh: new Date().toISOString(),
    }));
    fs.rmSync(lockPath);

    const auth = await pending;
    expect(auth?.access_token).toBe('acces-tourne-par-l-autre-processus');
    expect(issuer.requests).toBe(0);
    expect(mod.getLastChatGptRefreshFailure()).toBeNull();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('un succès efface la cause précédente et libère le verrou', async () => {
    writeAuth();
    let calls = 0;
    issuer = await startIssuer((_req, res) => {
      calls += 1;
      if (calls === 1) {
        res.writeHead(502); res.end('bad gateway');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id_token: makeJwt(), access_token: 'nouvel-acces', refresh_token: 'rt_suivant' }));
    });
    process.env.CODEBUDDY_CHATGPT_OAUTH_ISSUER = issuer.url;
    const { mod } = await load();
    expect(await mod.refreshChatGptAuth()).toBeNull();
    expect(mod.getLastChatGptRefreshFailure()?.status).toBe(502);
    expect((await mod.refreshChatGptAuth())?.access_token).toBe('nouvel-acces');
    expect(mod.getLastChatGptRefreshFailure()).toBeNull();
    expect(fs.existsSync(`${authPath()}.refresh.lock`)).toBe(false);
  });

  it('fichier sans jeton de rafraîchissement : cause no-refresh-token', async () => {
    fs.mkdirSync(path.dirname(authPath()), { recursive: true });
    fs.writeFileSync(authPath(), JSON.stringify({ tokens: { id_token: makeJwt(), access_token: 'a' } }));
    const { mod } = await load();
    expect(await mod.refreshChatGptAuth()).toBeNull();
    expect(mod.getLastChatGptRefreshFailure()).toMatchObject({ kind: 'no-refresh-token' });
  });
});
