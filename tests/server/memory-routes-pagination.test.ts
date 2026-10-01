import { describe, expect, it } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import memoryRoutes from '../../src/server/routes/memory.js';
import { ApiServerError } from '../../src/server/middleware/index.js';

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response, next: NextFunction) => void }>;
  };
};

async function invokeGet(path: string, query: Record<string, unknown>): Promise<{ status: number; error?: unknown }> {
  const layers = (memoryRoutes as unknown as { stack: RouteLayer[] }).stack;
  const route = layers.find((layer) => layer.route?.path === path && layer.route.methods.get)?.route;
  if (!route) throw new Error(`GET ${path} route missing`);
  const handler = route.stack.at(-1)?.handle;
  if (!handler) throw new Error(`GET ${path} handler missing`);

  return new Promise((resolve) => {
    const response = { json: () => resolve({ status: 200 }) } as unknown as Response;
    handler({ query } as unknown as Request, response, ((error?: unknown) => {
      resolve({ status: error instanceof ApiServerError ? error.status : 500, error });
    }) as NextFunction);
  });
}

describe('memory route pagination parameters without an HTTP listener', () => {
  it.each([
    ['/', { limit: 'abc' }],
    ['/', { limit: '2junk' }],
    ['/', { limit: '0' }],
    ['/', { limit: '-2' }],
    ['/', { limit: '' }],
    ['/', { limit: '0x10' }],
    ['/', { limit: '1001' }],
    ['/', { offset: 'abc' }],
    ['/', { offset: '-1' }],
    ['/', { offset: '' }],
    ['/', { offset: '9007199254740992' }],
    ['/search', { query: 'x', limit: 'abc' }],
    ['/search', { query: 'x', limit: '2junk' }],
    ['/search', { query: 'x', limit: '' }],
    ['/search', { query: 'x', limit: '1001' }],
  ])('rejects invalid GET %s query %j', async (route, query) => {
    const result = await invokeGet(route, query);
    expect(result.status).toBe(400);
  });

  it.each([
    ['/', { limit: '2', offset: '0' }],
    ['/', { limit: '1000', offset: '1' }],
    ['/search', { query: 'x', limit: '2' }],
  ])('accepts valid GET %s query %j', async (route, query) => {
    const result = await invokeGet(route, query);
    expect(result.status).toBe(200);
  });
});
