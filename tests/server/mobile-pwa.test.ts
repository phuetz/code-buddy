import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { Server } from 'http';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { mobilePwaRouter } from '../../src/server/mobile/index.js';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../src/server/middleware/index.js', () => ({
  createSecurityHeadersMiddleware: () => (req: any, res: any, next: any) => next(),
}));

describe('Mobile PWA Router', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/__codebuddy__/mobile', mobilePwaRouter);

    server = app.listen(0);
    const address = server.address();
    if (address && typeof address !== 'string') {
      baseUrl = `http://localhost:${address.port}`;
    }
  });

  afterAll(async () => {
    server.close();
  });

  describe('GET /__codebuddy__/mobile/', () => {
    it('should serve the main HTML file', async () => {
      const response = await http.get(`${baseUrl}/__codebuddy__/mobile/`);
      
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
    });

    it('should include PWA manifest link', async () => {
      const response = await http.get(`${baseUrl}/__codebuddy__/mobile/`);
      let body = '';
      response.on('data', chunk => body += chunk);
      
      await new Promise((resolve, reject) => {
        response.on('end', resolve);
        response.on('error', reject);
      });

      expect(body).toContain('<link rel="manifest"');
      expect(body).toContain('/__codebuddy__/mobile/manifest.webmanifest');
    });

    it('should include CSP header in HTML', async () => {
      const response = await http.get(`${baseUrl}/__codebuddy__/mobile/`);
      let body = '';
      response.on('data', chunk => body += chunk);
      
      await new Promise((resolve, reject) => {
        response.on('end', resolve);
        response.on('error', reject);
      });

      expect(body).toContain('Content-Security-Policy');
      expect(body).toContain("default-src 'self'");
    });
  });

  describe('GET /__codebuddy__/mobile/manifest.webmanifest', () => {
    it('should serve the manifest with correct content type', async () => {
      const response = await http.get(`${baseUrl}/__codebuddy__/mobile/manifest.webmanifest`);
      
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/manifest+json');
    });

    it('should contain valid manifest structure', async () => {
      const response = await http.get(`${baseUrl}/__codebuddy__/mobile/manifest.webmanifest`);
      let body = '';
      response.on('data', chunk => body += chunk);
      
      await new Promise((resolve, reject) => {
        response.on('end', resolve);
        response.on('error', reject);
      });

      const manifest = JSON.parse(body);
      expect(manifest.name).toBe('Code Buddy Mobile');
      expect(manifest.short_name).toBe('CodeBuddy');
      expect(manifest.start_url).toBe('/__codebuddy__/mobile/');
      expect(manifest.display).toBe('standalone');
      expect(manifest.theme_color).toBe('#1a1a2e');
    });
  });

  describe('GET /__codebuddy__/mobile/sw.js', () => {
    it('should serve the service worker with correct content type', async () => {
      const response = await http.get(`${baseUrl}/__codebuddy__/mobile/sw.js`);
      
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('application/javascript');
      expect(response.headers['service-worker-allowed']).toBe('/__codebuddy__/mobile/');
    });

    it('should contain service worker registration code', async () => {
      const response = await http.get(`${baseUrl}/__codebuddy__/mobile/sw.js`);
      let body = '';
      response.on('data', chunk => body += chunk);
      
      await new Promise((resolve, reject) => {
        response.on('end', resolve);
        response.on('error', reject);
      });

      expect(body).toContain('self.addEventListener');
      expect(body).toContain('fetch');
      expect(body).toContain('CACHE_NAME');
    });
  });

  describe('GET /__codebuddy__/mobile/assets/*', () => {
    it('should serve static assets', async () => {
      const response = await http.get(`${baseUrl}/__codebuddy__/mobile/assets/styles.css`);
      expect(response.statusCode).toBe(200);
    });

    it('should serve index.html', async () => {
      const response = await http.get(`${baseUrl}/__codebuddy__/mobile/assets/index.html`);
      expect(response.statusCode).toBe(200);
    });

    it('should serve app.js', async () => {
      const response = await http.get(`${baseUrl}/__codebuddy__/mobile/assets/app.js`);
      expect(response.statusCode).toBe(200);
    });

    it('should serve icon.svg', async () => {
      const response = await http.get(`${baseUrl}/__codebuddy__/mobile/assets/icon.svg`);
      expect(response.statusCode).toBe(200);
    });

    it('should block path traversal attempts', async () => {
      // This should be blocked by the security check in the router
      // Note: The router checks if the path stays within ASSETS_DIR
      // For this test, we'll check that it doesn't serve files outside the assets directory
      const response = await http.get(`${baseUrl}/__codebuddy__/mobile/assets/../../../package.json`);
      
      // Should return 403 or 404, not the package.json content
      expect(response.statusCode).not.toBe(200);
    });
  });

  describe('GET /__codebuddy__/mobile/health', () => {
    it('should return health status', async () => {
      const response = await http.get(`${baseUrl}/__codebuddy__/mobile/health`);
      
      expect(response.statusCode).toBe(200);
      
      let body = '';
      response.on('data', chunk => body += chunk);
      
      await new Promise((resolve, reject) => {
        response.on('end', resolve);
        response.on('error', reject);
      });

      const health = JSON.parse(body);
      expect(health.ok).toBe(true);
      expect(health.service).toBe('mobile-pwa');
      expect(health.endpoints).toContain('/__codebuddy__/mobile/');
    });
  });

  describe('Security', () => {
    it('should not expose tokens in URLs without authentication', async () => {
      // The PWA itself doesn't require authentication for static assets
      // But it should not serve any sensitive data without proper auth
      const response = await http.get(`${baseUrl}/__codebuddy__/mobile/`);
      expect(response.statusCode).toBe(200);
      
      let body = '';
      response.on('data', chunk => body += chunk);
      
      await new Promise((resolve, reject) => {
        response.on('end', resolve);
        response.on('error', reject);
      });

      // The HTML should not contain any hardcoded tokens
      expect(body).not.toContain('Bearer ');
      expect(body).not.toContain('api_key:');
    });
  });
});

describe('Mobile PWA Assets Validation', () => {
  const assetsDir = path.resolve(__dirname, '../../../src/server/mobile/assets');

  it('should have required PWA files', () => {
    const requiredFiles = [
      'index.html',
      'styles.css',
      'app.js',
      'sw.js',
      'manifest.webmanifest',
      'icon.svg'
    ];

    requiredFiles.forEach(file => {
      const filePath = path.join(assetsDir, file);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  it('should have valid manifest structure', () => {
    const manifestPath = path.join(assetsDir, 'manifest.webmanifest');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    expect(manifest.name).toBeDefined();
    expect(manifest.short_name).toBeDefined();
    expect(manifest.start_url).toBe('/__codebuddy__/mobile/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBeDefined();
    expect(manifest.background_color).toBeDefined();
    expect(manifest.icons).toBeDefined();
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it('should have CSP in HTML', () => {
    const htmlPath = path.join(assetsDir, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'self'");
    expect(html).toContain("script-src 'self'");
    expect(html).toContain("connect-src 'self' ws: wss:");
  });

  it('should have responsive viewport', () => {
    const htmlPath = path.join(assetsDir, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    expect(html).toContain('name="viewport"');
    expect(html).toContain('width=device-width');
    expect(html).toContain('initial-scale=1.0');
  });

  it('should reference manifest in HTML', () => {
    const htmlPath = path.join(assetsDir, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    expect(html).toContain('rel="manifest"');
    expect(html).toContain('manifest.webmanifest');
  });
});


