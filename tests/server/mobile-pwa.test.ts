import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MOBILE_PWA_CSP, mobilePwaRouter } from '../../src/server/mobile/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const assetsDir = path.resolve(repoRoot, 'src/server/mobile/assets');

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

function generateIcons(): void {
  execFileSync(process.execPath, ['scripts/generate-mobile-pwa-icons.mjs'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
}

describe('Mobile PWA Router', () => {
  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    generateIcons();
    app = express();
    app.use('/__codebuddy__/mobile', mobilePwaRouter);
    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected a TCP port');
    }
    if (address.port < 3460) {
      // Vitest assigns an ephemeral port; the live buddy server uses >= 3460.
      // Router unit tests may land below that and that is fine.
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  describe('GET /__codebuddy__/mobile/', () => {
    it('should serve the main HTML file', async () => {
      const response = await fetch(`${baseUrl}/__codebuddy__/mobile/`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('content-security-policy')).toBe(MOBILE_PWA_CSP);
    });

    it('should include PWA manifest link', async () => {
      const response = await fetch(`${baseUrl}/__codebuddy__/mobile/`);
      const body = await response.text();
      expect(body).toContain('<link rel="manifest"');
      expect(body).toContain('/__codebuddy__/mobile/manifest.webmanifest');
    });

    it('should include CSP without unsafe-eval or unsafe-inline', async () => {
      const response = await fetch(`${baseUrl}/__codebuddy__/mobile/`);
      const body = await response.text();
      const csp = response.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain('unsafe-eval');
      expect(csp).not.toContain('unsafe-inline');
      expect(body).not.toContain('unsafe-eval');
    });
  });

  describe('GET /__codebuddy__/mobile/manifest.webmanifest', () => {
    it('should serve the manifest with correct content type', async () => {
      const response = await fetch(`${baseUrl}/__codebuddy__/mobile/manifest.webmanifest`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/manifest+json');
    });

    it('should contain valid manifest structure and PNG icons', async () => {
      const response = await fetch(`${baseUrl}/__codebuddy__/mobile/manifest.webmanifest`);
      const manifest = (await response.json()) as {
        name: string;
        short_name: string;
        start_url: string;
        display: string;
        icons: Array<{ src: string; sizes: string }>;
      };
      expect(manifest.name).toBe('Code Buddy Mobile');
      expect(manifest.short_name).toBe('CodeBuddy');
      expect(manifest.start_url).toBe('/__codebuddy__/mobile/');
      expect(manifest.display).toBe('standalone');
      const sizes = manifest.icons.map((icon) => icon.sizes);
      expect(sizes).toEqual(expect.arrayContaining(['96x96', '192x192', '512x512']));
    });
  });

  describe('GET /__codebuddy__/mobile/sw.js', () => {
    it('should serve the service worker with correct content type', async () => {
      const response = await fetch(`${baseUrl}/__codebuddy__/mobile/sw.js`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('javascript');
      expect(response.headers.get('service-worker-allowed')).toBe('/__codebuddy__/mobile/');
    });

    it('should contain service worker registration code', async () => {
      const response = await fetch(`${baseUrl}/__codebuddy__/mobile/sw.js`);
      const body = await response.text();
      expect(body).toContain('self.addEventListener');
      expect(body).toContain('fetch');
      expect(body).toContain('CACHE_NAME');
    });
  });

  describe('GET /__codebuddy__/mobile/assets/*', () => {
    it('should serve static assets', async () => {
      const response = await fetch(`${baseUrl}/__codebuddy__/mobile/assets/styles.css`);
      expect(response.status).toBe(200);
    });

    it('should serve index.html', async () => {
      const response = await fetch(`${baseUrl}/__codebuddy__/mobile/assets/index.html`);
      expect(response.status).toBe(200);
    });

    it('should serve app.js', async () => {
      const response = await fetch(`${baseUrl}/__codebuddy__/mobile/assets/app.js`);
      expect(response.status).toBe(200);
    });

    it('should serve emoji-data.js', async () => {
      const response = await fetch(`${baseUrl}/__codebuddy__/mobile/assets/emoji-data.js`);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('CODEBUDDY_EMOJI_DATA');
    });

    it('should serve icon.svg', async () => {
      const response = await fetch(`${baseUrl}/__codebuddy__/mobile/assets/icon.svg`);
      expect(response.status).toBe(200);
    });

    it('should serve generated PNG icons', async () => {
      for (const size of [96, 192, 512]) {
        const response = await fetch(`${baseUrl}/__codebuddy__/mobile/assets/icon-${size}.png`);
        expect(response.status, `icon-${size}.png`).toBe(200);
        const buf = Buffer.from(await response.arrayBuffer());
        expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      }
    });

    it('should block path traversal attempts', async () => {
      const response = await fetch(
        `${baseUrl}/__codebuddy__/mobile/assets/../../../package.json`,
      );
      expect(response.status).not.toBe(200);
    });
  });

  describe('GET /__codebuddy__/mobile/health', () => {
    it('should return health status', async () => {
      const response = await fetch(`${baseUrl}/__codebuddy__/mobile/health`);
      expect(response.status).toBe(200);
      const health = (await response.json()) as { ok: boolean; service: string; endpoints: string[] };
      expect(health.ok).toBe(true);
      expect(health.service).toBe('mobile-pwa');
      expect(health.endpoints).toContain('/__codebuddy__/mobile/');
    });
  });

  describe('Security', () => {
    it('should not expose tokens in the shell HTML', async () => {
      const response = await fetch(`${baseUrl}/__codebuddy__/mobile/`);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).not.toContain('Bearer ');
      expect(body).not.toContain('api_key:');
    });
  });
});

describe('Mobile PWA Assets Validation', () => {
  beforeAll(() => {
    generateIcons();
  });

  it('should have required PWA files', () => {
    const requiredFiles = [
      'index.html',
      'styles.css',
      'app.js',
      'emoji-data.js',
      'sw.js',
      'manifest.webmanifest',
      'icon.svg',
      'icon-96.png',
      'icon-192.png',
      'icon-512.png',
    ];
    for (const file of requiredFiles) {
      expect(existsSync(path.join(assetsDir, file)), file).toBe(true);
    }
  });

  it('should have valid manifest structure', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(assetsDir, 'manifest.webmanifest'), 'utf-8'),
    ) as { start_url: string; display: string; icons: unknown[] };
    expect(manifest.start_url).toBe('/__codebuddy__/mobile/');
    expect(manifest.display).toBe('standalone');
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it('should have CSP in HTML or leave it to the HTTP header', () => {
    const html = readFileSync(path.join(assetsDir, 'index.html'), 'utf-8');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('rel="manifest"');
    expect(html).not.toContain('unsafe-eval');
    expect(html).not.toContain('unsafe-inline');
    expect(html).not.toMatch(/<script(?![^>]+src=)/);
  });

  it('should speak the real WebSocket protocol', () => {
    const app = readFileSync(path.join(assetsDir, 'app.js'), 'utf-8');
    expect(app).toContain('authenticated');
    expect(app).toContain('stream_chunk');
    expect(app).toContain('payload.image');
    expect(app).toContain('stream_end');
    expect(app).toContain('confirmation_required');
    expect(app).toContain('approvalCapable');
    expect(app).not.toContain('auth_success');
    expect(app).not.toContain('chat_stream');
    expect(app).toContain('local-only');
    expect(app).not.toMatch(/send\(\s*['"]reaction['"]/);
  });

  it('should ship a chat composer with emoji picker markup', () => {
    const html = readFileSync(path.join(assetsDir, 'index.html'), 'utf-8');
    expect(html).toContain('id="emoji-btn"');
    expect(html).toContain('id="emoji-picker"');
    expect(html).toContain('id="lightbox"');
    expect(html).toContain('id="reaction-bar"');
    expect(html).toContain('id="suggestions"');
    expect(html).toContain('id="typing-indicator"');
    expect(html).toContain('emoji-data.js');
    expect(html).not.toContain('unsafe-inline');
  });

  it('should bump the service worker cache to include emoji-data.js', () => {
    const sw = readFileSync(path.join(assetsDir, 'sw.js'), 'utf-8');
    expect(sw).toContain('codebuddy-mobile-v3');
    expect(sw).toContain('/__codebuddy__/mobile/assets/emoji-data.js');
  });
});

describe('Mobile PWA shell is public under JWT', () => {
  it('serves the HTML shell without a token when auth is on', async () => {
    const previous = process.env.JWT_SECRET;
    const previousPwa = process.env.CODEBUDDY_MOBILE_PWA;
    process.env.JWT_SECRET = 'mobile-pwa-shell-public-test-secret-32b';
    process.env.CODEBUDDY_MOBILE_PWA = 'true';
    const { startServer, stopServer } = await import('../../src/server/index.js');
    const started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      websocketEnabled: false,
      logging: false,
      rateLimit: false,
      cors: false,
    });
    try {
      const { port } = started.server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/__codebuddy__/mobile/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const api = await fetch(`http://127.0.0.1:${port}/api/runs`);
      expect(api.status).toBe(401);
    } finally {
      await stopServer(started.server);
      if (previous === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previous;
      if (previousPwa === undefined) delete process.env.CODEBUDDY_MOBILE_PWA;
      else process.env.CODEBUDDY_MOBILE_PWA = previousPwa;
    }
  });
});

describe('B-1 CODEBUDDY_MOBILE_PWA opt-in', () => {
  it('keeps the PWA route and WS approval bridge off without the flag', async () => {
    const previous = process.env.JWT_SECRET;
    const previousPwa = process.env.CODEBUDDY_MOBILE_PWA;
    delete process.env.CODEBUDDY_MOBILE_PWA;
    process.env.JWT_SECRET = 'mobile-pwa-opt-in-test-secret-32b-min';
    const { ConfirmationService } = await import('../../src/utils/confirmation-service.js');
    const spy = vi.spyOn(ConfirmationService.getInstance(), 'setWsApprovalBridge');
    const { startServer, stopServer } = await import('../../src/server/index.js');
    const started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      websocketEnabled: true,
      logging: false,
      rateLimit: false,
      cors: false,
    });
    try {
      const { port } = started.server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/__codebuddy__/mobile/`);
      expect(res.status).toBe(404);
      expect(spy.mock.calls.some((call) => typeof call[0] === 'function')).toBe(false);
    } finally {
      spy.mockRestore();
      await stopServer(started.server);
      if (previous === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previous;
      if (previousPwa === undefined) delete process.env.CODEBUDDY_MOBILE_PWA;
      else process.env.CODEBUDDY_MOBILE_PWA = previousPwa;
    }
  });

  it('installs the WS approval bridge when CODEBUDDY_MOBILE_PWA=true', async () => {
    const previous = process.env.JWT_SECRET;
    const previousPwa = process.env.CODEBUDDY_MOBILE_PWA;
    process.env.CODEBUDDY_MOBILE_PWA = 'true';
    process.env.JWT_SECRET = 'mobile-pwa-opt-in-on-test-secret-32b';
    const { ConfirmationService } = await import('../../src/utils/confirmation-service.js');
    const spy = vi.spyOn(ConfirmationService.getInstance(), 'setWsApprovalBridge');
    const { startServer, stopServer } = await import('../../src/server/index.js');
    const started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      websocketEnabled: true,
      logging: false,
      rateLimit: false,
      cors: false,
    });
    try {
      expect(spy.mock.calls.some((call) => typeof call[0] === 'function')).toBe(true);
    } finally {
      spy.mockRestore();
      await stopServer(started.server);
      if (previous === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previous;
      if (previousPwa === undefined) delete process.env.CODEBUDDY_MOBILE_PWA;
      else process.env.CODEBUDDY_MOBILE_PWA = previousPwa;
    }
  });
});

describe('Mobile PWA Express 5 route table', () => {
  it('constructs without throwing on Express 5 wildcards', async () => {
    const { mobilePwaRouter: router } = await import('../../src/server/mobile/index.js');
    expect(router).toBeDefined();
    const stack = (router as unknown as { stack: Array<{ route?: { path: string } }> }).stack;
    const paths = stack.map((layer) => layer.route?.path).filter(Boolean);
    expect(paths).not.toContain('/assets/*');
  });
});

describe('Mobile companion selfie router gate', () => {
  afterEach(() => {
    delete process.env.CODEBUDDY_COMPANION_PERSONA;
    delete process.env.CODEBUDDY_CHANNEL_PROFILE;
    delete process.env.CODEBUDDY_LISA_SELFIE;
    vi.restoreAllMocks();
  });

  it('does not call the selfie router without a companion surface', async () => {
    const { produceCompanionReply } = await import('../../src/server/websocket/handler.js');
    const router = await import('../../src/companion/lisa-selfie-router.js');
    const spy = vi.spyOn(router, 'tryServeCompanionSelfie');
    vi.spyOn(await import('../../src/sensory/voice-loop.js'), 'defaultReply')
      .mockResolvedValue('fallback');
    await produceCompanionReply('envoie-moi une photo de toi');
    expect(spy).not.toHaveBeenCalled();
  });

  it('calls the selfie router when the copine persona is set', async () => {
    process.env.CODEBUDDY_COMPANION_PERSONA = 'copine';
    const { produceCompanionReply } = await import('../../src/server/websocket/handler.js');
    const router = await import('../../src/companion/lisa-selfie-router.js');
    const spy = vi.spyOn(router, 'tryServeCompanionSelfie').mockResolvedValue(null);
    vi.spyOn(await import('../../src/sensory/voice-loop.js'), 'defaultReply')
      .mockResolvedValue('fallback');
    await produceCompanionReply('envoie-moi une photo de toi');
    expect(spy).toHaveBeenCalled();
  });
});
