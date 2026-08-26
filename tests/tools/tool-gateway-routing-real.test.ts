import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveToolGatewayRoute,
  isToolGatewayRoutingActive,
} from '../../src/agent/tool-gateway-router.js';
import { firecrawlSearch, isFirecrawlEnabled } from '../../src/tools/firecrawl-tool.js';
import { generateImage } from '../../src/tools/media-generation-tool.js';

// 1x1 transparent PNG (bytes are not validated by the asset writer).
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

interface CapturedRequest {
  path: string;
  authorization: string | undefined;
  body: unknown;
}

describe('tool-gateway-router (unit)', () => {
  it('returns null when no gateway is configured', () => {
    expect(resolveToolGatewayRoute('web', {})).toBeNull();
    expect(resolveToolGatewayRoute('image_gen', {})).toBeNull();
    expect(isToolGatewayRoutingActive({})).toBe(false);
  });

  it('routes managed tools through the configured gateway URL + token', () => {
    const env = {
      CODEBUDDY_NOUS_TOOL_GATEWAY_URL: 'https://gw.example.com/',
      CODEBUDDY_NOUS_TOOL_GATEWAY_USER_TOKEN: 'gw-token',
    } as NodeJS.ProcessEnv;

    const web = resolveToolGatewayRoute('web', env);
    expect(web).toEqual({ baseUrl: 'https://gw.example.com', token: 'gw-token', source: 'CODEBUDDY_NOUS_TOOL_GATEWAY_URL' });
    expect(resolveToolGatewayRoute('image_gen', env)?.baseUrl).toBe('https://gw.example.com');
    expect(isToolGatewayRoutingActive(env)).toBe(true);
  });

  it('respects the NOUS_MANAGED_TOOLS allow-set', () => {
    const env = {
      CODEBUDDY_NOUS_TOOL_GATEWAY_URL: 'https://gw.example.com',
      CODEBUDDY_NOUS_TOOL_GATEWAY_USER_TOKEN: 'gw-token',
      NOUS_MANAGED_TOOLS: 'web',
    } as NodeJS.ProcessEnv;
    expect(resolveToolGatewayRoute('web', env)).not.toBeNull();
    expect(resolveToolGatewayRoute('image_gen', env)).toBeNull();
  });

  it('does not route when a gateway URL is set without a token (avoids leaking direct keys)', () => {
    const env = { CODEBUDDY_NOUS_TOOL_GATEWAY_URL: 'https://gw.example.com' } as NodeJS.ProcessEnv;
    expect(resolveToolGatewayRoute('web', env)).toBeNull();
    expect(resolveToolGatewayRoute('image_gen', env)).toBeNull();
    expect(isToolGatewayRoutingActive(env)).toBe(false);
  });

  it('composes the self-hosted scheme + domain form', () => {
    const env = {
      TOOL_GATEWAY_DOMAIN: 'gw.internal',
      TOOL_GATEWAY_SCHEME: 'http',
      TOOL_GATEWAY_USER_TOKEN: 'self-token',
    } as NodeJS.ProcessEnv;
    expect(resolveToolGatewayRoute('web', env)).toEqual({
      baseUrl: 'http://gw.internal',
      token: 'self-token',
      source: 'TOOL_GATEWAY_DOMAIN',
    });
  });

  it('honors a per-tool gateway URL override', () => {
    const env = {
      CODEBUDDY_NOUS_TOOL_GATEWAY_URL: 'https://shared.example.com',
      CODEBUDDY_NOUS_TOOL_GATEWAY_WEB_URL: 'https://web.example.com',
      CODEBUDDY_NOUS_TOOL_GATEWAY_USER_TOKEN: 'gw-token',
    } as NodeJS.ProcessEnv;
    expect(resolveToolGatewayRoute('web', env)?.baseUrl).toBe('https://web.example.com');
    expect(resolveToolGatewayRoute('image_gen', env)?.baseUrl).toBe('https://shared.example.com');
  });
});

describe('gateway routing integration (real http server)', () => {
  let server: http.Server;
  let baseUrl: string;
  const requests: CapturedRequest[] = [];
  let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  const savedEnv: Record<string, string | undefined> = {};

  function saveEnv(...keys: string[]): void {
    for (const key of keys) savedEnv[key] = process.env[key];
  }
  function restoreEnv(): void {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  beforeEach(async () => {
    requests.length = 0;
    saveEnv(
      'CODEBUDDY_NOUS_TOOL_GATEWAY_URL',
      'CODEBUDDY_NOUS_TOOL_GATEWAY_USER_TOKEN',
      'CODEBUDDY_NOUS_TOOL_GATEWAY',
      'FIRECRAWL_API_KEY',
    );
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        requests.push({
          path: req.url ?? '',
          authorization: req.headers.authorization,
          body: raw ? JSON.parse(raw) : null,
        });
        respond(req, res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    restoreEnv();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  it('routes Firecrawl web search through the gateway with the gateway token', async () => {
    respond = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: [{ title: 'T', url: 'https://x', content: 'C' }] }));
    };
    // Gateway configured, NO direct Firecrawl key — proves the gateway path.
    delete process.env.FIRECRAWL_API_KEY;
    process.env.CODEBUDDY_NOUS_TOOL_GATEWAY_URL = baseUrl;
    process.env.CODEBUDDY_NOUS_TOOL_GATEWAY_USER_TOKEN = 'gw-token';

    expect(isFirecrawlEnabled()).toBe(true);

    const result = await firecrawlSearch({ query: 'hello' });
    expect(result.success).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe('/search');
    expect(requests[0]?.authorization).toBe('Bearer gw-token');
  });

  it('routes image generation through the gateway with the gateway token', async () => {
    respond = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }));
    };
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-image-'));
    try {
      const result = await generateImage(
        { prompt: 'a cat' },
        {
          rootDir,
          env: {
            CODEBUDDY_NOUS_TOOL_GATEWAY_URL: baseUrl,
            CODEBUDDY_NOUS_TOOL_GATEWAY_USER_TOKEN: 'gw-token',
            CODEBUDDY_IMAGE_API_KEY: 'direct-key-should-be-ignored',
          } as NodeJS.ProcessEnv,
          fetch: globalThis.fetch,
        },
      );

      expect(requests).toHaveLength(1);
      expect(requests[0]?.path).toBe('/images/generations');
      expect(requests[0]?.authorization).toBe('Bearer gw-token');
      expect(result.image).toBeTruthy();
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
