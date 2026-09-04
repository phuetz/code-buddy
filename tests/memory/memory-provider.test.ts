import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  MemoryProviderRegistry,
  LocalMemoryProvider,
  getMemoryProviderRegistry,
  getActiveMemoryProvider,
  resetMemoryProviderRegistry,
  type MemoryProvider,
} from '../../src/memory/memory-provider.js';
import type { Memory } from '../../src/memory/persistent-memory.js';
import { resetMemoryManagerForTests } from '../../src/memory/persistent-memory.js';
import {
  Mem0MemoryProvider,
  HonchoMemoryProvider,
  SupermemoryMemoryProvider,
} from '../../src/memory/adapters/network-memory-adapters.js';

function fakeProvider(id: string): MemoryProvider {
  return {
    id,
    async initialize() {},
    async remember() {},
    async recall() {
      return `${id}-value`;
    },
    async getRelevantMemories(): Promise<Memory[]> {
      return [];
    },
    async getContextForPrompt() {
      return `${id}-context`;
    },
  };
}

describe('MemoryProviderRegistry', () => {
  afterEach(() => {
    resetMemoryProviderRegistry();
  });

  it('registers a local provider by default and makes it active', () => {
    const registry = new MemoryProviderRegistry();
    expect(registry.list()).toContain('local');
    expect(registry.getActiveId()).toBe('local');
    expect(registry.getActive().id).toBe('local');
  });

  it('registers and switches to a custom provider', async () => {
    const registry = new MemoryProviderRegistry();
    registry.register(fakeProvider('mem0'));
    expect(registry.has('mem0')).toBe(true);

    registry.setActive('mem0');
    expect(registry.getActiveId()).toBe('mem0');
    expect(await registry.getActive().recall('k')).toBe('mem0-value');
  });

  it('throws when activating an unknown provider', () => {
    const registry = new MemoryProviderRegistry();
    expect(() => registry.setActive('does-not-exist')).toThrow(/Unknown memory provider/);
  });

  it('rejects a provider without an id', () => {
    const registry = new MemoryProviderRegistry();
    expect(() => registry.register(fakeProvider(''))).toThrow(/non-empty id/);
  });

  it('keeps the local provider active when no override is set (agent loop unaffected)', () => {
    const registry = new MemoryProviderRegistry();
    registry.register(fakeProvider('honcho'));
    // Without an explicit setActive, the default local provider stays active.
    expect(registry.getActiveId()).toBe('local');
  });

  it('exposes a process-wide singleton helper', () => {
    const a = getMemoryProviderRegistry();
    const b = getMemoryProviderRegistry();
    expect(a).toBe(b);
    expect(getActiveMemoryProvider().id).toBe('local');
  });
});

describe('LocalMemoryProvider', () => {
  it('implements the provider contract with id "local"', () => {
    const provider = new LocalMemoryProvider();
    expect(provider.id).toBe('local');
    expect(typeof provider.remember).toBe('function');
    expect(typeof provider.recall).toBe('function');
    expect(typeof provider.getRelevantMemories).toBe('function');
    expect(typeof provider.getContextForPrompt).toBe('function');
  });
});

// TESTWRITE1 (2026-09-04): each network adapter's fallback used to be a bare
// `new LocalMemoryProvider()`, which resolves the DEFAULT `PersistentMemoryManager`
// singleton — `.codebuddy/CODEBUDDY_MEMORY.md` under `process.cwd()`. Exercising
// the "no API key -> local fallback" path (the whole point of these tests) was
// therefore writing `test-key`/`test-value` into the real, git-tracked project
// memory file on every run (measured: category comments overwritten with
// "No memories in this category"). `fallbackMemoryConfig` is the injectable
// seam added to fix this (`src/memory/adapters/network-memory-adapters.ts`);
// production callers never pass it, so the real default is unchanged.
// `resetMemoryManagerForTests()` is required alongside it because
// `getMemoryManager()` is itself a singleton — without a reset, an earlier
// test in this same worker (e.g. `new LocalMemoryProvider()` above) can have
// already claimed the real default path, and the override would be ignored.
describe('NetworkMemoryProviders Fallbacks', () => {
  let tmpDir: string;
  let projectMemoryPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-memory-provider-test-'));
    projectMemoryPath = path.join(tmpDir, 'CODEBUDDY_MEMORY.md');
    resetMemoryManagerForTests();
  });

  afterEach(() => {
    resetMemoryManagerForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Mem0MemoryProvider', () => {
    it('falls back to LocalMemoryProvider when API key is missing', async () => {
      const provider = new Mem0MemoryProvider({ apiKey: '', fallbackMemoryConfig: { projectMemoryPath } });
      await provider.initialize();
      expect(provider.id).toBe('mem0');
      // Should write to fallback local provider and retrieve it
      await provider.remember('test-key', 'test-value');
      const val = await provider.recall('test-key');
      expect(val).toBe('test-value');
    });
  });

  describe('HonchoMemoryProvider', () => {
    it('falls back to LocalMemoryProvider when API key is missing', async () => {
      const provider = new HonchoMemoryProvider({ apiKey: '', fallbackMemoryConfig: { projectMemoryPath } });
      await provider.initialize();
      expect(provider.id).toBe('honcho');
      await provider.remember('test-key', 'test-value');
      const val = await provider.recall('test-key');
      expect(val).toBe('test-value');
    });
  });

  describe('SupermemoryMemoryProvider', () => {
    it('falls back to LocalMemoryProvider when API key is missing', async () => {
      const provider = new SupermemoryMemoryProvider({ apiKey: '', fallbackMemoryConfig: { projectMemoryPath } });
      await provider.initialize();
      expect(provider.id).toBe('supermemory');
      await provider.remember('test-key', 'test-value');
      const val = await provider.recall('test-key');
      expect(val).toBe('test-value');
    });
  });
});
