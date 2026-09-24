/**
 * Isolated in-process server for the HTTP route catalogue.
 * The token comes from the server JWT helper (`createUserToken`), not from
 * an extra package. HOME, CODEBUDDY_HOME and the working directory are
 * temporary; provider credentials are removed so no paid API is called.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ApiScope } from '../../src/server/types.js';

export const CATALOGUE_JWT_SECRET = 'catalogue-routes-http-test-secret-32b';
export const CATALOGUE_USER_ID = 'catalogue-http-user';

const REPO_ROOT = process.cwd();

const envFrames: Array<Map<string, string | undefined>> = [];

const METRICS_ENV = ['METRICS_FILE', 'METRICS_PATH', 'METRICS_INTERVAL', 'METRICS_CONSOLE'] as const;

const DROPPED_ENV = [
  'CODEBUDDY_PROVIDER',
  'CODEBUDDY_MODEL',
  'CODEBUDDY_A2A_PEERS',
  'CODEBUDDY_OWNER_USER_ID',
  'CODEBUDDY_SENSORY',
  'CODEBUDDY_MOBILE_PWA',
  'CODEBUDDY_SERVER_CHANNEL_INTAKE',
  'CODEBUDDY_RUNS_DIR',
  'CODEBUDDY_AUDIT_DIR',
  'CODEBUDDY_MEMORY_PATH',
  'CODEBUDDY_WORKSPACE',
  'CODEBUDDY_CHANNEL_CONFIG',
  'CODEBUDDY_HTTPS',
  'CODEBUDDY_MOBILE_TLS',
  'GROK_HOME',
  'GROK_MODEL',
  'GROK_BASE_URL',
  'OLLAMA_HOST',
  'VLLM_BASE_URL',
  'LMSTUDIO_HOST',
  'LM_STUDIO_HOST',
  'LMSTUDIO_BASE_URL',
  'LM_STUDIO_BASE_URL',
];

export interface CatalogueServer {
  repoRoot: string;
  tempRoot: string;
  workDir: string;
  server: HttpServer;
  baseUrl: string;
  port: number;
  token: string;
  restore: () => Promise<void>;
}

function remember(frame: Map<string, string | undefined>, name: string): void {
  if (!frame.has(name)) frame.set(name, process.env[name]);
}

export function isolateCatalogueEnv(tempRoot: string): void {
  const frame = new Map<string, string | undefined>();
  for (const name of Object.keys(process.env)) {
    if (
      name.endsWith('_API_KEY')
      || name.endsWith('_TOKEN')
      || name.endsWith('_SECRET')
      || name.endsWith('_PASSWORD')
      || name.includes('CREDENTIAL')
    ) {
      remember(frame, name);
      delete process.env[name];
    }
  }
  for (const name of DROPPED_ENV) {
    remember(frame, name);
    delete process.env[name];
  }
  for (const name of ['HOME', 'CODEBUDDY_HOME', 'CODEBUDDY_SESSIONS_DIR', 'JWT_SECRET', ...METRICS_ENV]) {
    remember(frame, name);
  }
  for (const name of METRICS_ENV) delete process.env[name];
  process.env.HOME = tempRoot;
  process.env.CODEBUDDY_HOME = path.join(tempRoot, 'codebuddy-home');
  process.env.CODEBUDDY_SESSIONS_DIR = path.join(tempRoot, 'sessions');
  process.env.JWT_SECRET = CATALOGUE_JWT_SECRET;
  mkdirSync(process.env.CODEBUDDY_HOME, { recursive: true });
  mkdirSync(process.env.CODEBUDDY_SESSIONS_DIR, { recursive: true });
  envFrames.push(frame);
}

export function restoreCatalogueEnv(): void {
  const frame = envFrames.pop();
  if (!frame) return;
  for (const [name, value] of frame) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

export async function startCatalogueServer(options?: {
  start?: (config: {
    port: number;
    host: string;
    authEnabled: boolean;
    websocketEnabled: boolean;
    logging: boolean;
    rateLimit: boolean;
    cors: boolean;
    jwtSecret: string;
  }) => Promise<{ server: HttpServer }>;
}): Promise<CatalogueServer> {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'cb-catalogue-http-'));
  const workDir = path.join(tempRoot, 'work');
  mkdirSync(workDir, { recursive: true });
  isolateCatalogueEnv(tempRoot);
  const cwdBefore = process.cwd();
  let released = false;
  let started: { server: HttpServer } | undefined;
  const release = (): void => {
    if (released) return;
    released = true;
    try {
      process.chdir(cwdBefore);
    } finally {
      restoreCatalogueEnv();
    }
  };
  try {
    process.chdir(workDir);
    const { createUserToken } = await import('../../src/server/auth/jwt.js');
    const scopes: ApiScope[] = ['admin'];
    const token = createUserToken(CATALOGUE_USER_ID, scopes, CATALOGUE_JWT_SECRET, '1h');
    const launch = options?.start ?? (await import('../../src/server/index.js')).startServer;
    started = await launch({
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      websocketEnabled: true,
      logging: false,
      rateLimit: false,
      cors: false,
      jwtSecret: CATALOGUE_JWT_SECRET,
    });
    const address = started.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Le serveur catalogue n\'a pas de port');
    }
    const running = started;
    const port = address.port;
    return {
      repoRoot: REPO_ROOT,
      tempRoot,
      workDir,
      server: running.server,
      baseUrl: `http://127.0.0.1:${port}`,
      port,
      token,
      restore: async () => {
        const { stopServer } = await import('../../src/server/index.js');
        try {
          await stopServer(running.server);
        } finally {
          release();
        }
      },
    };
  } catch (error) {
    if (started) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        started?.server.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    release();
    throw error;
  }
}

export async function httpCall(
  baseUrl: string,
  token: string,
  method: string,
  routePath: string,
  body?: unknown,
  authenticated = true,
): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = {};
  if (authenticated) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${routePath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  return { status: response.status, text };
}

export function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} n'est pas du JSON (${message}) : ${text.slice(0, 200)}`);
  }
}

export function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} n'est pas un objet JSON`);
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} n'est pas un tableau`);
  return value;
}

/** Paths this catalogue is allowed to leave dirty. Anything else fails the suite. */
const ALLOWED_DIRTY = [
  'tests/server/catalogue-routes-http-a.test.ts',
  'tests/server/catalogue-routes-http-b.test.ts',
  'tests/server/catalogue-routes-http-harness.ts',
  'docs/reports/2026-09/RAPPORT-ROUTES-HTTP.md',
  'docs/FABLE5-CODEX-COORDINATION.md',
  'tests/channels/webchat.test.ts',
  'tests/channels/webchat-page-drive.ts',
  'tests/server/catalogue-routes-http-isolation.test.ts',
  'src/channels/webchat/index.ts',
  'src/server/index.ts',
  'docs/reports/2026-09/REPARATION-WEBCHAT-JETON-RECONNEXION.md',
];

export function unexpectedRepoDirtyPaths(repoRoot: string): string[] {
  const output = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 8_000,
  });
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .filter((line) => {
      const filePath = line.slice(3).trim();
      return !ALLOWED_DIRTY.some((allowed) => filePath === allowed || filePath.endsWith(allowed));
    });
}
