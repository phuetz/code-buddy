import { test, expect } from 'playwright/test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createServer, Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';

test.describe('Mobile PWA E2E', () => {
  let buddyServer: HttpServer | null;
  let baseUrl: string;
  let port: number;
  let stopFn: typeof import('../../src/server/index.js').stopServer;
  let createToken: typeof import('../../src/server/auth/jwt.js').createUserToken;
  let serverInstance: typeof import('../../src/server/index.js');
  let tmpHome: string;
  let stubServer: HttpServer;
  let stubUrl: string;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  test.beforeAll(async () => {
    // Start Stub LLM Provider
    stubServer = createServer((req, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'stub-model' }] }));
        return;
      }
      if (req.url === '/api/chat') {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.write(JSON.stringify({ message: { content: 'Stub Reply', role: 'assistant' }, done: true }) + '\n');
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>(resolve => stubServer.listen(0, '127.0.0.1', resolve));
    stubUrl = `http://127.0.0.1:${(stubServer.address() as AddressInfo).port}`;

    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-pwa-e2e-home-'));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    process.env.CODEBUDDY_MOBILE_PWA = 'true';
    process.env.JWT_SECRET = 'mobile-pwa-e2e-test-secret-32b-min';
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    process.env.GROK_MODEL = 'stub-model';
    process.env.OLLAMA_HOST = stubUrl;

    serverInstance = await import('../../src/server/index.js');
    const { createUserToken } = await import('../../src/server/auth/jwt.js');

    const started = await serverInstance.startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: true,
      websocketEnabled: true,
      logging: false,
      rateLimit: false,
      cors: false,
    });

    buddyServer = started.server;
    stopFn = serverInstance.stopServer;
    createToken = createUserToken;

    port = (buddyServer.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  test.afterAll(async () => {
    if (buddyServer) {
        await stopFn(buddyServer);
    }
    if (stubServer) await new Promise<void>((resolve) => stubServer.close(() => resolve()));
    delete process.env.CODEBUDDY_MOBILE_PWA;
    delete process.env.JWT_SECRET;
    delete process.env.CODEBUDDY_PROVIDER;
    delete process.env.GROK_MODEL;
    delete process.env.OLLAMA_HOST;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  test('authenticates, sends chat, receives reply, and reconnects', async ({ page }) => {
     test.setTimeout(90000);
     const token = createToken('e2e-user', ['chat', 'tools', 'sessions'], process.env.JWT_SECRET);

     await page.goto(`${baseUrl}/__codebuddy__/mobile/#token=${token}`);

     for (const size of [96, 192, 512]) {
       const response = await page.request.get(`${baseUrl}/__codebuddy__/mobile/assets/icon-${size}.png`);
       expect(response.status(), `PWA icon ${size}`).toBe(200);
       expect(response.headers()['content-type']).toContain('image/png');
       const bytes = await response.body();
       expect(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
     }

     await expect(page.locator('#main-screen')).toHaveClass(/active/);
     await expect(page.locator('#presence-line')).toHaveText('en ligne');

     // Use 'agent' instead of 'companion' to hit the standard chat route, not the companion specific route which might have complex behavior
     await page.locator('#assistant-btn').click();
     await page.locator('button:has-text("Agent")').click();

     await page.fill('#message-input', 'ping from pwa');
     await page.click('#send-btn');

     await expect(page.locator('.msg-row.user')).toContainText('ping from pwa');
     await expect(page.locator('.msg-row.assistant')).toContainText('Stub Reply', { timeout: 10000 });

     // Wait to ensure processing is done
     await page.waitForTimeout(500);

     await stopFn(buddyServer);
     buddyServer = null;

     await expect(page.locator('#presence-line')).toHaveText(/hors ligne|reconnexion/, { timeout: 10000 });

     const started = await serverInstance.startServer({
       port: port,
       host: '127.0.0.1',
       authEnabled: true,
       websocketEnabled: true,
       logging: false,
       rateLimit: false,
       cors: false,
     });
     buddyServer = started.server;

     await expect(page.locator('#presence-line')).toHaveText('en ligne', { timeout: 30000 });

     // Send a second message after reconnect to prove it's fully connected
     await page.fill('#message-input', 'ping 2');
     await page.click('#send-btn');

     await expect(page.locator('.msg-row.user').nth(1)).toContainText('ping 2');
     await expect(page.locator('.msg-row.assistant').nth(1)).toContainText('Stub Reply', { timeout: 10000 });
  });
});
