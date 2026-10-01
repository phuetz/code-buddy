import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '../../src/server/types.js';
import { createRateLimitMiddleware } from '../../src/server/middleware/rate-limit.js';

const request = {
  path: '/x',
  ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' },
} as Request;

function response() {
  const headers = new Map<string, string>();
  return {
    headers,
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(_body: unknown) {
      return this;
    },
  };
}

function config(windowMs: number): ServerConfig {
  return {
    rateLimit: true,
    rateLimitMax: 2,
    rateLimitWindow: windowMs,
  } as ServerConfig;
}

describe('Rate limit sliding window', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calculates Retry-After from the oldest request still in the window', () => {
    const middleware = createRateLimitMiddleware(config(60_000));
    let res = response();
    middleware(request, res as unknown as Response, () => {}); // t=0

    vi.advanceTimersByTime(50_000);
    res = response();
    middleware(request, res as unknown as Response, () => {}); // t=50s

    vi.advanceTimersByTime(11_000);
    res = response();
    middleware(request, res as unknown as Response, () => {}); // t=61s

    vi.advanceTimersByTime(1_000);
    res = response();
    middleware(request, res as unknown as Response, () => {}); // t=62s

    expect(res.statusCode).toBe(429);
    expect(res.headers.get('retry-after')).toBe('48');
    expect(res.headers.get('x-ratelimit-reset-after')).toBe('48');
  });

  it('retains an entry with a valid request when cleanup runs', async () => {
    vi.resetModules();
    const { createRateLimitMiddleware: createFreshMiddleware, getAllRateLimits } =
      await import('../../src/server/middleware/rate-limit.js');
    const middleware = createFreshMiddleware(config(90_000));

    middleware(request, response() as unknown as Response, () => {}); // t=0
    vi.advanceTimersByTime(80_000);
    middleware(request, response() as unknown as Response, () => {}); // t=80s, valid until t=170s

    vi.advanceTimersByTime(40_000); // cleanup at t=120s
    expect(getAllRateLimits().has('global:ip:127.0.0.1')).toBe(true);
  });
});
