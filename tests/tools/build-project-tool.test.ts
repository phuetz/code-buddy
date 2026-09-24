import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { BuildProjectTool } from '../../src/tools/build-project-tool.js';

describe('BuildProjectTool', () => {
  let homeDir: string;
  let originalHome: string | undefined;
  let originalCodebuddyHome: string | undefined;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'home-'));
    originalHome = process.env.HOME;
    originalCodebuddyHome = process.env.CODEBUDDY_HOME;
    process.env.HOME = homeDir;
    process.env.CODEBUDDY_HOME = path.join(homeDir, '.codebuddy');
  });

  afterEach(async () => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    if (originalCodebuddyHome !== undefined) process.env.CODEBUDDY_HOME = originalCodebuddyHome;
    else delete process.env.CODEBUDDY_HOME;
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('runs only package build script', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'build-project-tool-'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { build: 'node build.js' } }));
    await fs.writeFile(path.join(root, 'build.js'), 'console.log("built ok")\n');
    const result = await new BuildProjectTool().execute({ root, timeoutMs: 10000 });
    expect(result.success).toBe(true);
    expect((result.data as { stdoutTail: string }).stdoutTail).toContain('built ok');
  });
});
