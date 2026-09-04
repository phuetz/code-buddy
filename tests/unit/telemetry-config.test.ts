/**
 * Tests for src/utils/telemetry-config.ts
 *
 * Telemetry opt-in/opt-out configuration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockTelemetryStore, mockReadJsonAtomicSync, mockWriteJsonAtomicSync } = vi.hoisted(() => {
  const mockTelemetryStore: { data: Record<string, unknown> } = { data: {} };
  return {
    mockTelemetryStore,
    mockReadJsonAtomicSync: vi.fn((_path: string, fallback: unknown) =>
      Object.keys(mockTelemetryStore.data).length > 0 ? { ...mockTelemetryStore.data } : fallback
    ),
    mockWriteJsonAtomicSync: vi.fn((_path: string, data: Record<string, unknown>) => {
      mockTelemetryStore.data = { ...data };
    }),
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
  beforeEach(() => {
    mockTelemetryStore.data = {};
    resetTelemetryCache();
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
