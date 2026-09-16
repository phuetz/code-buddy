import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseSupervisorManifest } from '../../src/harness/fleet-supervisor.js';

const script = path.resolve('scripts/fleet-supervisor.mjs');
describe('fleet supervisor', () => {
  it('only exposes fixed, bounded operations from the operator manifest', () => {
    const manifest = { workspace: '.', operations: { context: { command: 'code-explorer', args: ['status'] } } };
    expect(parseSupervisorManifest(manifest, '/work').workspace).toBe(path.resolve('/work'));
    for (const operation of [{ command: 'node', args: 'arbitrary shell' }, { command: 'node', args: [], timeoutMs: 600000 }]) {
      expect(() => parseSupervisorManifest({ ...manifest, operations: { operation } }, '/work')).toThrow();
    }
    expect(() => parseSupervisorManifest({ ...manifest, operations: { tool_search: manifest.operations.context } }, '/work')).toThrow();
  });
  it('executes a real fixed operation through the built Code Buddy harness and propagates failures', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-fleet-supervisor-'));
    try {
      const manifest = path.join(root, 'manifest.json');
      await fs.writeFile(manifest, JSON.stringify({ workspace: root, operations: {
        verify: { command: process.execPath, args: ['-e', 'console.log("FLEET_PROOF")'] },
        fail: { command: process.execPath, args: ['-e', 'process.exit(7)'] },
      } }));
      const raw = execFileSync(process.execPath, [script, manifest, 'verify'], { encoding: 'utf8', timeout: 10000 });
      const result = JSON.parse(raw.trim().split('\n').at(-1)!);
      expect(result.success).toBe(true);
      expect(result.output).toContain('FLEET_PROOF');
      expect(result.output).toContain('"exitCode":0');
      expect(() => execFileSync(process.execPath, [script, manifest, 'fail'], { stdio: 'pipe', timeout: 10000 })).toThrow();
      expect(() => execFileSync(process.execPath, [script, manifest, 'unknown'], { stdio: 'pipe', timeout: 10000 })).toThrow();
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
