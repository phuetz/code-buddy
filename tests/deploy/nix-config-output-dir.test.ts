import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { writeNixConfigs } from '../../src/deploy/nix-config.js';

describe('writeNixConfigs', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nix-config-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates the output directory recursively before writing files', async () => {
    const deepDir = path.join(tmpDir, 'non', 'existent', 'dir');
    const config = {
      packageName: 'test-pkg',
      version: '1.0.0',
      description: 'test desc'
    };

    // This will throw ENOENT if directory is not created
    const result = await writeNixConfigs(deepDir, config);

    expect(result.flake).toBe(path.join(deepDir, 'flake.nix'));
    expect(result.defaultNix).toBe(path.join(deepDir, 'default.nix'));

    const flakeStat = await fs.stat(result.flake);
    expect(flakeStat.isFile()).toBe(true);
  });
});
