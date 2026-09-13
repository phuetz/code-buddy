import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { expect, it } from 'vitest';

it('bundles renderer Fleet/Hermes profiles for a browser and evaluates them without Node globals', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cowork-renderer-profiles-'));
  try {
    const entry = path.join(directory, 'profiles.ts');
    const core = fileURLToPath(new URL('../../src/', import.meta.url));
    await fs.writeFile(entry, [
      `import { buildHermesToolsetDescriptor } from ${JSON.stringify(path.join(core, 'fleet/dispatch-profile.ts'))};`,
      `import { buildHermesIntegrationPlan } from ${JSON.stringify(path.join(core, 'agent/hermes-agent-profile.ts'))};`,
      'export const safe = buildHermesToolsetDescriptor("safe", ["view_file", "bash"]);',
      'export const plan = buildHermesIntegrationPlan("code");',
    ].join('\n'));
    // Real browser-target compilation: no Electron plugin, aliases or Node shims.
    const result = await build({
      configFile: false,
      root: directory,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        target: 'es2022',
        lib: { entry, name: 'RendererProfiles', formats: ['iife'] },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    expect(outputs).toHaveLength(1);
    const output = outputs[0];
    if (!output || !('output' in output)) throw new Error('Expected one browser bundle');
    const chunks = output.output.filter(item => item.type === 'chunk');
    expect(chunks).toHaveLength(1);
    const chunk = chunks[0];
    if (!chunk) throw new Error('Missing renderer bundle');
    expect(chunk.imports).toEqual([]);
    const browser = vm.createContext({});
    expect(vm.runInContext('typeof process', browser)).toBe('undefined');
    expect(vm.runInContext('typeof require', browser)).toBe('undefined');
    vm.runInContext(chunk.code, browser, { timeout: 1000 });
    const profiles = JSON.parse(vm.runInContext('JSON.stringify(RendererProfiles)', browser));
    expect(profiles.safe).toMatchObject({ profile: 'safe', toolsetId: 'fleet.hermes.safe' });
    expect(profiles.safe.allowedTools).toContain('view_file');
    expect(profiles.safe.deniedTools).toContain('bash');
    expect(profiles.plan).toMatchObject({ dispatchProfile: 'code', toolsetId: 'fleet.hermes.code', recommendedNextCommand: 'buddy hermes doctor code --json' });
    expect(profiles.plan.surfaceIds).toContain('delegation');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 30_000);
