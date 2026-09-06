import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
    expect(app).toContain('stream_end');
    expect(app).toContain('confirmation_required');
    expect(app).not.toContain('auth_success');
    expect(app).not.toContain('chat_stream');
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
