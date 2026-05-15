import { describe, expect, it } from 'vitest';
import { createCanvasRoutes } from '../../src/server/routes/canvas.js';

function createResponse() {
  return {
    status: 0,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(status: number, headers?: Record<string, string>) {
      this.status = status;
      this.headers = headers ?? {};
    },
    end(body?: string) {
      this.body = body ?? '';
    },
  };
}

describe('canvas routes', () => {
  it('does not claim the static A2UI page is connected to a websocket', async () => {
    const route = createCanvasRoutes().find(r => r.method === 'GET' && r.path === '/__codebuddy__/a2ui/');
    const res = createResponse();

    await route?.handler({}, res);

    expect(res.status).toBe(200);
    expect(res.body).toContain('Not connected');
    expect(res.body).not.toContain('Connected to Code Buddy Gateway');
  });

  it('does not pretend to evaluate A2UI expressions through the HTTP route', async () => {
    const route = createCanvasRoutes().find(r => r.method === 'POST' && r.path === '/__codebuddy__/a2ui/eval');
    const res = createResponse();

    await route?.handler({}, res, JSON.stringify({ expression: '1 + 1' }));

    expect(res.status).toBe(501);
    expect(JSON.parse(res.body).error).toContain('not wired');
  });
});
