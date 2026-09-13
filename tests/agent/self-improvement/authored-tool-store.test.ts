import { describe, it, expect, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { AuthoredToolStore } from '../../../src/agent/self-improvement/authored-tool-store.js';
import { LiveToolMutator, loadAuthoredTools } from '../../../src/agent/self-improvement/tool-skill-mutator.js';
import type { AuthoredToolSpec } from '../../../src/agent/self-improvement/authored-tool-runtime.js';
import { FormalToolRegistry } from '../../../src/tools/registry/tool-registry.js';
import { getToolRegistry } from '../../../src/tools/registry.js';

const SPEC: AuthoredToolSpec = {
  name: 'authored__echo',
  description: 'echo input.msg',
  parameters: { type: 'object', properties: { msg: { type: 'string' } } },
  language: 'javascript',
  code: "const i=JSON.parse(process.env.CODEBUDDY_TOOL_INPUT||'{}'); console.log('echo:'+(i.msg||''));",
};

function tmp(): string {
  return path.join(os.tmpdir(), `cb-store-${randomUUID()}`);
}

beforeEach(() => {
  FormalToolRegistry.reset();
  getToolRegistry().removeTool('authored__echo');
});

describe('AuthoredToolStore', () => {
  it('add / list / remove round-trip (upsert by name)', () => {
    const store = new AuthoredToolStore({ workDir: tmp() });
    expect(store.list()).toHaveLength(0);
    store.add(SPEC);
    store.add({ ...SPEC, description: 'updated' }); // upsert, not duplicate
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]!.description).toBe('updated');
    expect(store.remove('authored__echo')).toBe(true);
    expect(store.list()).toHaveLength(0);
  });
});

describe('authored-tool persistence across a simulated restart', () => {
  it('a persisted tool is reloaded into both registries and is callable', async () => {
    const workDir = tmp();
    const store = new AuthoredToolStore({ workDir });

    // Author + keep (persists to the store).
    new LiveToolMutator({ store }).register(SPEC);
    expect(store.list()).toHaveLength(1);

    // Simulate a restart: wipe the in-memory registries.
    FormalToolRegistry.reset();
    getToolRegistry().removeTool('authored__echo');
    expect(FormalToolRegistry.getInstance().has('authored__echo')).toBe(false);

    // Reload from disk.
    const loaded = loadAuthoredTools(workDir);
    expect(loaded).toContain('authored__echo');
    expect(FormalToolRegistry.getInstance().has('authored__echo')).toBe(true);

    const out = await FormalToolRegistry.getInstance().execute('authored__echo', { msg: 'hi' });
    if (process.platform === 'linux') {
      expect(out.output).toContain('echo:hi');
    } else {
      expect(out.success).toBe(false);
      expect(out.error).toContain('Compute confinement requires Linux');
    }
  });

  it('unregister removes the tool from the store too', () => {
    const workDir = tmp();
    const store = new AuthoredToolStore({ workDir });
    const m = new LiveToolMutator({ store });
    m.register(SPEC);
    expect(store.list()).toHaveLength(1);
    m.unregister('authored__echo');
    expect(store.list()).toHaveLength(0);
  });
});
