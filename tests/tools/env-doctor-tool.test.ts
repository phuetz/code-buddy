import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { EnvDoctorTool } from '../../src/tools/env-doctor-tool.js';

describe('EnvDoctorTool', () => {
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

  it('reports node environment, scripts, tools, and config files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'env-doctor-tool-'));
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', build: 'tsc' } }));
    await fs.writeFile(path.join(root, 'tsconfig.json'), '{}');
    await fs.writeFile(path.join(root, '.env.example'), 'TOKEN=\n');
    const result = await new EnvDoctorTool().execute({ root });
    expect(result.success).toBe(true);
    const data = result.data as { nodeVersion: string; nodeModulesPresent: boolean; npmScripts: string[]; tools: Record<string, boolean>; configFiles: string[] };
    expect(data.nodeVersion).toBe(process.version);
    expect(data.nodeModulesPresent).toBe(true);
    expect(data.npmScripts).toEqual(['build', 'test']);
    expect(data.tools.git).toBe(true);
    expect(data.configFiles).toContain('tsconfig.json');
    expect(data.configFiles).toContain('.env.example');
  });
});
