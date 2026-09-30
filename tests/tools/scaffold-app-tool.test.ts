import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { ScaffoldAppTool } from '../../src/tools/scaffold-app-tool.js';

describe('ScaffoldAppTool', () => {
  it.skipIf(process.platform === 'win32')('starts the generated Express app after installation without a manual build', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'scaffold-express-start-'));
    const targetDir = path.join(tmp, 'api');
    const socket = createServer();
    await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
    const address = socket.address();
    if (!address || typeof address === 'string') throw new Error('No test port');
    const port = address.port;
    await new Promise<void>(resolve => socket.close(() => resolve()));
    let child: ReturnType<typeof spawn> | undefined;
    try {
      expect((await new ScaffoldAppTool().execute({ template: 'express-api', targetDir })).success).toBe(true);
      // Exercise the generated build/start pipeline with a minimal Express
      // entry using the dependencies installed in this checkout. The complete
      // template is checked separately with its actual npm install and HTTP.
      await fs.writeFile(path.join(targetDir, 'src/index.ts'), 'import express from "express"; const app = express(); app.get("/", (_req, res) => res.send("Hello World!")); app.listen(Number(process.env.PORT), "127.0.0.1");\n');
      await fs.symlink(path.join(process.cwd(), 'node_modules'), path.join(targetDir, 'node_modules'), 'dir');
      child = spawn('npm', ['start'], { cwd: targetDir, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: String(port) } });
      let output = '';
      child.stdout?.on('data', data => { output += String(data); });
      child.stderr?.on('data', data => { output += String(data); });
      let body: string | undefined;
      for (let attempt = 0; attempt < 200; attempt++) {
        if (child.exitCode !== null) throw new Error(`Generated app exited ${child.exitCode}: ${output}`);
        try { const response = await fetch(`http://127.0.0.1:${port}/`); if (response.ok) { body = await response.text(); break; } } catch { /* startup */ }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(body, output).toBe('Hello World!');
    } finally {
      if (child?.pid && child.exitCode === null) {
        const closed = new Promise(resolve => child!.once('close', resolve));
        process.kill(-child.pid, 'SIGTERM');
        await closed;
      }
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }, 20000);

  it('returns actual generated entry contents so the model can inspect behavior, rather than a file count alone', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'scaffold-observation-'));
    try {
      const targetDir = path.join(tmp, 'api');
      const result = await new ScaffoldAppTool().execute({ template: 'express-api', targetDir });
      const entry = await fs.readFile(path.join(targetDir, 'src/index.ts'), 'utf8');
      expect(result.success).toBe(true);
      expect(result.output).toContain('src/index.ts');
      expect(result.output).toContain(entry.slice(0, 3_000));
      expect(result.output!.length).toBeLessThan(5_000);
    } finally { await fs.rm(tmp, { recursive: true, force: true }); }
  });

  it('exposes the presentation-ready React template to agent scaffolding', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'scaffold-app-tool-'));
    const targetDir = path.join(tmp, 'styled-react');

    const result = await new ScaffoldAppTool().execute({
      template: 'react-tailwind',
      targetDir,
      vars: { description: 'Styled from the first render' },
    });

    expect(result.success).toBe(true);
    const data = result.data as { filesCreated: string[] };
    expect(data.filesCreated).toEqual(expect.arrayContaining([
      'tailwind.config.ts',
      'src/styles/tokens.css',
      'src/components/ui/Button.tsx',
    ]));
  });

  it('scaffolds a node-cli project into an explicit target directory', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'scaffold-app-tool-'));
    const targetDir = path.join(tmp, 'demo-cli');

    const result = await new ScaffoldAppTool().execute({
      template: 'node-cli',
      targetDir,
      vars: { binName: 'demo-cli', description: 'Demo CLI', author: 'Test' },
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    const data = result.data as { filesCreated: string[]; targetDir: string };
    expect(data.targetDir).toBe(targetDir);
    expect(data.filesCreated).toContain('package.json');
    expect(data.filesCreated).toContain('src/index.ts');
    expect(data.filesCreated).toContain('tsconfig.json');

    const packageJson = JSON.parse(await fs.readFile(path.join(targetDir, 'package.json'), 'utf8')) as {
      bin: Record<string, string>;
    };
    expect(packageJson.bin['demo-cli']).toBe('./dist/index.js');
  });

  it('exposes the Expo React Native template to agent scaffolding', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'scaffold-app-tool-'));
    const targetDir = path.join(tmp, 'mobile-app');

    const result = await new ScaffoldAppTool().execute({
      template: 'expo-rn',
      targetDir,
      vars: { description: 'Mobile from the agent' },
    });

    expect(result.success).toBe(true);
    const data = result.data as { filesCreated: string[] };
    expect(data.filesCreated).toEqual(expect.arrayContaining([
      'eas.json',
      'app/(tabs)/index.tsx',
      'app/item/[id].tsx',
      'tests/catalog.test.ts',
    ]));
  });

  it('refuses a non-empty target directory', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'scaffold-app-tool-'));
    await fs.writeFile(path.join(tmp, 'existing.txt'), 'content');

    const result = await new ScaffoldAppTool().execute({
      template: 'node-cli',
      targetDir: tmp,
      vars: { binName: 'demo-cli' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not empty');
  });
});
