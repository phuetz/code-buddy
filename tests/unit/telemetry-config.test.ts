/**
 * Tests for src/utils/telemetry-config.ts
 *
 * Telemetry opt-in/opt-out configuration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';

const { mockTelemetryStore, mockReadJsonAtomicSync, mockWriteJsonAtomicSync } = vi.hoisted(() => {
  const mockTelemetryStore: { data: Record<string, unknown> } = { data: {} };
  return {
    mockTelemetryStore,
    mockReadJsonAtomicSync: vi.fn((_path: string, fallback: unknown) =>
      Object.keys(mockTelemetryStore.data).length > 0 ? { ...mockTelemetryStore.data } : fallback
    ),
    mockWriteJsonAtomicSync: vi.fn(
      (_path: string, data: Record<string, unknown>, _options?: { mode?: number }) => {
        mockTelemetryStore.data = { ...data };
      }
    ),
  };
});

vi.mock('../../src/utils/atomic-write.js', () => ({
  readJsonAtomicSync: mockReadJsonAtomicSync,
  writeJsonAtomicSync: mockWriteJsonAtomicSync,
}));

import {
  getTelemetryConfig,
  setTelemetryEnabled,
  setTelemetryLevel,
  isTelemetryEnabled,
  resetTelemetryCache,
} from '../../src/utils/telemetry-config';

// Mock fs-extra to avoid real filesystem operations
vi.mock('fs-extra', () => {
  return {
    default: {
      existsSync: vi.fn(() => Object.keys(mockTelemetryStore.data).length > 0),
      readJsonSync: vi.fn(() => ({ ...mockTelemetryStore.data })),
      writeJsonSync: mockWriteJsonAtomicSync,
      ensureDirSync: vi.fn(),
    },
    existsSync: vi.fn(() => Object.keys(mockTelemetryStore.data).length > 0),
    readJsonSync: vi.fn(() => ({ ...mockTelemetryStore.data })),
    writeJsonSync: mockWriteJsonAtomicSync,
    ensureDirSync: vi.fn(),
  };
});

describe('telemetry-config', () => {
  const settingsPath = () => path.join(process.cwd(), '.codebuddy', 'settings.json');

  beforeEach(() => {
    mockTelemetryStore.data = {};
    resetTelemetryCache();
    vi.clearAllMocks();
  });

  it('returns default config when no settings file exists', () => {
    const config = getTelemetryConfig();
    expect(config.enabled).toBe(true);
    expect(config.level).toBe('full');
  });

  it('setTelemetryEnabled(false) disables telemetry', () => {
    setTelemetryEnabled(false);
    expect(isTelemetryEnabled()).toBe(false);
    const config = getTelemetryConfig();
    expect(config.enabled).toBe(false);
    expect(config.level).toBe('none');
  });

  it('setTelemetryEnabled(true) re-enables telemetry', () => {
    setTelemetryEnabled(false);
    setTelemetryEnabled(true);
    expect(isTelemetryEnabled()).toBe(true);
    const config = getTelemetryConfig();
    expect(config.enabled).toBe(true);
    expect(config.level).toBe('full');
  });

  it('setTelemetryLevel changes level correctly', () => {
    setTelemetryLevel('errors-only');
    const config = getTelemetryConfig();
    expect(config.level).toBe('errors-only');
    expect(config.enabled).toBe(true);
    expect(isTelemetryEnabled()).toBe(true);
  });

  it('setTelemetryLevel("none") disables telemetry', () => {
    setTelemetryLevel('none');
    const config = getTelemetryConfig();
    expect(config.level).toBe('none');
    expect(config.enabled).toBe(false);
    expect(isTelemetryEnabled()).toBe(false);
  });

  // VERIF3 T2 : les six tests passaient tous par le cache mémoire du module.
  // Vider le contenu persisté, dégrader le mode en 0o644 ou supprimer
  // complètement `writeJsonAtomicSync` restait vert.
  it('persists the telemetry block at the settings path in 0o600', () => {
    setTelemetryLevel('errors-only');

    expect(mockWriteJsonAtomicSync).toHaveBeenCalledTimes(1);
    const [writtenPath, payload, options] = mockWriteJsonAtomicSync.mock.calls[0]!;
    expect(writtenPath).toBe(settingsPath());
    expect(payload).toEqual({ telemetry: { enabled: true, level: 'errors-only' } });
    expect(options).toEqual({ mode: 0o600 });
  });

  it('preserves unrelated settings keys when persisting telemetry', () => {
    mockTelemetryStore.data = { model: 'gpt-5.5', thinkingLevel: 'high' };
    resetTelemetryCache();

    setTelemetryEnabled(false);

    const lastCall = mockWriteJsonAtomicSync.mock.calls.at(-1)!;
    expect(lastCall[0]).toBe(settingsPath());
    expect(lastCall[1]).toEqual({
      model: 'gpt-5.5',
      thinkingLevel: 'high',
      telemetry: { enabled: false, level: 'none' },
    });
    expect(lastCall[2]).toEqual({ mode: 0o600 });
  });

  it('re-reads the persisted telemetry block once the cache is dropped', () => {
    setTelemetryLevel('errors-only');
    resetTelemetryCache();

    expect(mockTelemetryStore.data).toEqual({
      telemetry: { enabled: true, level: 'errors-only' },
    });
    expect(getTelemetryConfig()).toEqual({ enabled: true, level: 'errors-only' });
  });

  it('resetTelemetryCache clears cached config', () => {
    setTelemetryEnabled(false);
    expect(isTelemetryEnabled()).toBe(false);
    resetTelemetryCache();
    // After reset, will re-read from (mocked) file
    const config = getTelemetryConfig();
    // Should get the cached written values since mock retains them
    expect(config).toBeDefined();
  });
});
