import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { writeNixConfigs } from '../../src/deploy/nix-config.js';

it('creates a requested new output directory before writing Nix files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nix-output-'));
  try {
    const result = await writeNixConfigs(path.join(root, 'new', 'nested'), {
      packageName: 'fixture-app', version: '1.0.0', description: 'Fixture',
    });
    expect(await readFile(result.flake, 'utf8')).toContain('fixture-app');
    expect(await readFile(result.defaultNix, 'utf8')).toContain('fixture-app');
  } finally { await rm(root, { recursive: true, force: true }); }
});
