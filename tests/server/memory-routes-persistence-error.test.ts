import fs from 'fs';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getMemoryManager,
  resetMemoryManagerForTests,
} from '../../src/memory/persistent-memory.js';
import memoryRoutes from '../../src/server/routes/memory.js';
import { errorHandler } from '../../src/server/middleware/index.js';

describe('memory HTTP persistence failures', () => {
  let server: Server;
  let baseUrl: string;
  let testRoot: string;

  beforeAll(async () => {
    testRoot = path.join(process.cwd(), '.test-r21', `memory-${process.pid}`);
    const projectPath = path.join(testRoot, 'project-memory-is-a-directory');
    const userPath = path.join(testRoot, 'user-memory.md');
    fs.rmSync(testRoot, { recursive: true, force: true });
    fs.mkdirSync(projectPath, { recursive: true });

    resetMemoryManagerForTests();
    getMemoryManager({ projectMemoryPath: projectPath, userMemoryPath: userPath });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { scopes: ['admin'], type: 'api_key' };
      next();
    });
    app.use('/api/memory', memoryRoutes);
    app.use(errorHandler);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    resetMemoryManagerForTests();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('répond 503 quand le magasin refuse la sauvegarde', async () => {
    const response = await fetch(`${baseUrl}/api/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'r21-memory', content: 'ne doit pas être annoncé persistant' }),
    });
    const body = await response.json() as { code?: string; message?: string };

    expect(response.status).toBe(503);
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.message).toMatch(/memory.*(unreadable|persist)/i);
  });
});
