import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';
import type { Server } from 'node:http';
import express from 'express';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { ScaffoldAppTool } from '../../src/tools/scaffold-app-tool.js';

it('serves Hello World from the actual generated Express entry point', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'express-starter-http-'));
  let server: Server | undefined;
  try {
    const targetDir = path.join(tmp, 'app');
    expect((await new ScaffoldAppTool().execute({ template: 'express-api', targetDir })).success).toBe(true);
    const entry = await fs.readFile(path.join(targetDir, 'src/index.ts'), 'utf8');
    const compiled = ts.transpileModule(entry, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    const realExpress = Object.assign(() => {
      const app = express();
      app.listen = (() => { server = express.application.listen.call(app, 0, '127.0.0.1'); return server; }) as typeof app.listen;
      return app;
    }, express);
    const pass = (_req: unknown, _res: unknown, next: () => void) => next();
    const health = express.Router();
    health.get('/', (_req, res) => res.json({ status: 'ok' }));
    // Only optional middleware and the neighbouring health module are stubbed.
    // The generated root route runs unchanged on a real Express HTTP server.
    runInNewContext(compiled, {
      exports: {}, process: { env: {} }, console: { log() {} },
      require(name: string) {
        if (name === 'express') return realExpress;
        if (name === 'cors' || name === 'helmet') return () => pass;
        if (name === 'dotenv') return { config() {} };
        if (name === './routes/health.js') return { healthRouter: health };
        if (name === './middleware/error-handler.js') return { errorHandler: pass };
        throw new Error(`Unexpected generated import: ${name}`);
      },
    });
    if (!server) throw new Error('Generated entry did not start a server');
    if (!server.listening) await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No TCP address');
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hello World!');
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
