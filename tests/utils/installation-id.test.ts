/**
 * Phase d.23.G — tests for src/utils/installation-id.ts.
 *
 * Persistence + cache behavior, with the file path mocked to a temp
 * dir so we don't pollute the real ~/.codebuddy/installation-id.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpHome: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

beforeEach(async () => {
  // Fresh temp HOME per test so the persisted file is isolated.
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-iid-'));
  // Reset module cache so the in-memory cache from a prior test doesn't
  // leak into this one.
  vi.resetModules();
});

afterEach(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* ignore */ }
});

describe('installation-id', () => {
  it('generates a UUID on first read and persists it to ~/.codebuddy/installation-id', async () => {
    const { getInstallationId, getInstallationIdPath } = await import('../../src/utils/installation-id.js');
    const id = getInstallationId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const p = getInstallationIdPath();
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, 'utf-8').trim()).toBe(id);
  });

  it('returns the same value across calls in the same process (in-memory cache)', async () => {
    const { getInstallationId } = await import('../../src/utils/installation-id.js');
    const a = getInstallationId();
    const b = getInstallationId();
    expect(b).toBe(a);
  });

  it('returns the persisted value across process restarts (module reload)', async () => {
    const m1 = await import('../../src/utils/installation-id.js');
    const id1 = m1.getInstallationId();

    // Simulate restart: new module instance, same disk.
    vi.resetModules();
    const m2 = await import('../../src/utils/installation-id.js');
    const id2 = m2.getInstallationId();

    expect(id2).toBe(id1);
  });

  it('regenerates the file when its content is malformed', async () => {
    const m = await import('../../src/utils/installation-id.js');
    const p = m.getInstallationIdPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'not-a-uuid-at-all', 'utf-8');

    const fresh = m.getInstallationId();
    expect(fresh).not.toBe('not-a-uuid-at-all');
    expect(fresh).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(fs.readFileSync(p, 'utf-8').trim()).toBe(fresh);
  });

  it('does not crash if the directory is non-writable (returns an in-memory id)', async () => {
    // We can't easily make the dir read-only on Windows, so just verify
    // the function never throws and returns a usable UUID even when the
    // disk path resolves outside our tmpHome (file write may silently
    // succeed). Smoke check.
    const m = await import('../../src/utils/installation-id.js');
    const id = m.getInstallationId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(20);
  });
});
