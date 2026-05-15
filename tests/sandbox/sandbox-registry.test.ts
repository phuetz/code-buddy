import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerSandboxBackend,
  getActiveSandboxBackend,
  sandboxExecute,
  listSandboxBackends,
  resetSandboxRegistry,
} from '../../src/sandbox/sandbox-registry.js';
import type { SandboxBackendInterface } from '../../src/sandbox/sandbox-backend.js';

function createMockBackend(name: string, available: boolean): SandboxBackendInterface {
  return {
    name,
    isAvailable: async () => available,
    execute: async (cmd) => ({
      success: true,
      output: `${name}: ${cmd}`,
      exitCode: 0,
      durationMs: 10,
    }),
    kill: async () => true,
    cleanup: async () => {},
  };
}

describe('SandboxRegistry', () => {
  beforeEach(() => {
    resetSandboxRegistry();
  });

  it('returns null when no backends registered', async () => {
    const backend = await getActiveSandboxBackend();
    expect(backend).toBeNull();
  });

  it('selects highest priority available backend', async () => {
    registerSandboxBackend(createMockBackend('low', true), 10);
    registerSandboxBackend(createMockBackend('high', true), 100);
    registerSandboxBackend(createMockBackend('mid', true), 50);

    const backend = await getActiveSandboxBackend();
    expect(backend?.name).toBe('high');
  });

  it('falls back to lower priority when higher is unavailable', async () => {
    registerSandboxBackend(createMockBackend('unavailable', false), 100);
    registerSandboxBackend(createMockBackend('available', true), 50);

    const backend = await getActiveSandboxBackend();
    expect(backend?.name).toBe('available');
  });

  it('sandboxExecute uses active backend', async () => {
    registerSandboxBackend(createMockBackend('test', true), 10);

    const result = await sandboxExecute('echo hello');
    expect(result.success).toBe(true);
    expect(result.output).toContain('test: echo hello');
  });

  it('sandboxExecute returns error when no backend available', async () => {
    const result = await sandboxExecute('echo hello');
    expect(result.success).toBe(false);
    expect(result.error).toContain('No sandbox backend');
    expect(result.output).toBe(result.error);
  });

  it('listSandboxBackends returns all backends with availability', async () => {
    registerSandboxBackend(createMockBackend('a', true), 10);
    registerSandboxBackend(createMockBackend('b', false), 20);

    const list = await listSandboxBackends();
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ name: 'b', priority: 20, available: false });
    expect(list[1]).toEqual({ name: 'a', priority: 10, available: true });
  });

  it('caches active backend', async () => {
    const backend = createMockBackend('cached', true);
    registerSandboxBackend(backend, 10);

    const first = await getActiveSandboxBackend();
    const second = await getActiveSandboxBackend();
    expect(first).toBe(second);
  });
});
