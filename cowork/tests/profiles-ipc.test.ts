import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };
});

// A faithful, minimal stand-in for the core parseTOML: 2-level parser that
// flattens [profiles.a.agent] into a sibling "a.agent" key under profiles —
// exactly the behaviour the handler must dedupe around.
const coreLoaderMock = vi.hoisted(() => ({
  loadCoreModule: vi.fn(async () => ({
    parseTOML(content: string): Record<string, unknown> {
      const result: Record<string, unknown> = {};
      let section = '';
      let sub = '';
      for (let line of content.split('\n')) {
        line = line.trim();
        if (!line || line.startsWith('#')) continue;
        const sm = line.match(/^\[([^\]]+)\]$/);
        if (sm && sm[1]) {
          const parts = sm[1].split('.');
          section = parts[0] ?? '';
          sub = parts.slice(1).join('.');
          if (!result[section]) result[section] = {};
          if (sub) {
            const o = result[section] as Record<string, unknown>;
            if (!o[sub]) o[sub] = {};
          }
          continue;
        }
        const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
        if (kv && kv[1] && kv[2] !== undefined) {
          let v: unknown = kv[2].trim();
          if (typeof v === 'string' && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
          if (sub) {
            ((result[section] as Record<string, unknown>)[sub] as Record<string, unknown>)[kv[1]] = v;
          } else if (section) {
            (result[section] as Record<string, unknown>)[kv[1]] = v;
          } else {
            result[kv[1]] = v;
          }
        }
      }
      return result;
    },
  })),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: electronMock.handle },
}));

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: coreLoaderMock.loadCoreModule,
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

// homedir() is read at module load (CONFIG_DIR const), so the mock must be in
// place before import. The home dir is mutable per-test via a hoisted holder.
// Resolve the temp home inside the hoisted initializer so it is set before the
// handler module computes CONFIG_DIR (= homedir()/.codebuddy) at import time.
const homeHolder = vi.hoisted(() => {
  const os = require('os') as typeof import('os');
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  return { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'profiles-ipc-')) };
});
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => homeHolder.dir };
});

import { registerProfilesIpcHandlers } from '../src/main/ipc/profiles-ipc';

const tmpHome = homeHolder.dir;
const CODEBUDDY_DIR = join(tmpHome, '.codebuddy');
const CONFIG_FILE = () => join(CODEBUDDY_DIR, 'config.toml');
const ACTIVE_FILE = () => join(CODEBUDDY_DIR, 'cowork-active-profile.json');

function call<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = electronMock.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler({}, ...args) as Promise<T>;
}

describe('registerProfilesIpcHandlers', () => {
  beforeEach(() => {
    // Clean the .codebuddy dir per test for isolation (home dir is fixed
    // because CONFIG_DIR is resolved once at module load).
    rmSync(CODEBUDDY_DIR, { recursive: true, force: true });
    electronMock.handlers.clear();
    electronMock.handle.mockClear();
    registerProfilesIpcHandlers();
  });

  afterEach(() => {
    rmSync(CODEBUDDY_DIR, { recursive: true, force: true });
  });

  it('lists distinct profiles, deduping flattened sub-tables', async () => {
    const fs = await import('fs');
    fs.mkdirSync(join(tmpHome, '.codebuddy'), { recursive: true });
    writeFileSync(
      CONFIG_FILE(),
      [
        'active_model = "grok-code-fast"',
        '',
        '[profiles.deep-review]',
        'active_model = "claude-opus"',
        '',
        '[profiles.deep-review.agent]',
        'yolo_mode = false',
        '',
        '[profiles.fast]',
        'active_model = "grok-4-fast"',
      ].join('\n'),
    );

    const result = await call<{ ok: boolean; profiles: Array<{ name: string }>; active: string | null }>(
      'profiles.list',
    );
    expect(result.ok).toBe(true);
    expect(result.profiles.map((p) => p.name)).toEqual(['deep-review', 'fast']);
    expect(result.active).toBeNull();
  });

  it('returns empty list when no config file exists', async () => {
    const result = await call<{ ok: boolean; profiles: unknown[]; active: string | null }>(
      'profiles.list',
    );
    expect(result).toEqual({ ok: true, profiles: [], active: null });
  });

  it('creates a new profile block seeded from base active_model', async () => {
    const fs = await import('fs');
    fs.mkdirSync(join(tmpHome, '.codebuddy'), { recursive: true });
    writeFileSync(CONFIG_FILE(), 'active_model = "grok-code-fast"\n');

    const created = await call<{ ok: boolean; profiles?: Array<{ name: string }> }>(
      'profiles.create',
      'staging',
    );
    expect(created.ok).toBe(true);
    expect(created.profiles?.map((p) => p.name)).toContain('staging');

    const toml = readFileSync(CONFIG_FILE(), 'utf-8');
    expect(toml).toContain('[profiles.staging]');
    expect(toml).toContain('active_model = "grok-code-fast"');
    // Base config preserved verbatim.
    expect(toml.startsWith('active_model = "grok-code-fast"')).toBe(true);
  });

  it('rejects duplicate and invalid profile names', async () => {
    const fs = await import('fs');
    fs.mkdirSync(join(tmpHome, '.codebuddy'), { recursive: true });
    writeFileSync(CONFIG_FILE(), 'active_model = "grok-code-fast"\n\n[profiles.dup]\n');

    const dup = await call<{ ok: boolean; error?: string }>('profiles.create', 'dup');
    expect(dup.ok).toBe(false);
    expect(dup.error).toMatch(/already exists/);

    for (const bad of ['has space', 'a.b', '../etc', 'name"', '[x]', '']) {
      const r = await call<{ ok: boolean }>('profiles.create', bad);
      expect(r.ok).toBe(false);
    }
  });

  it('switches active profile and signals restart required', async () => {
    const fs = await import('fs');
    fs.mkdirSync(join(tmpHome, '.codebuddy'), { recursive: true });
    writeFileSync(CONFIG_FILE(), 'active_model = "grok-code-fast"\n\n[profiles.alpha]\n');

    const switched = await call<{ ok: boolean; requiresRestart?: boolean; active?: string | null }>(
      'profiles.switch',
      'alpha',
    );
    expect(switched.ok).toBe(true);
    expect(switched.requiresRestart).toBe(true);
    expect(switched.active).toBe('alpha');
    expect(existsSync(ACTIVE_FILE())).toBe(true);

    const active = await call<{ ok: boolean; active: string | null }>('profiles.active');
    expect(active.active).toBe('alpha');

    // Switching to a non-existent profile fails.
    const bad = await call<{ ok: boolean; error?: string }>('profiles.switch', 'ghost');
    expect(bad.ok).toBe(false);

    // Clearing the selection (base config) is allowed.
    const cleared = await call<{ ok: boolean; active?: string | null }>('profiles.switch', null);
    expect(cleared.ok).toBe(true);
    expect(cleared.active).toBeNull();
  });

  it('drops a stale active selection if the profile no longer exists', async () => {
    const fs = await import('fs');
    fs.mkdirSync(join(tmpHome, '.codebuddy'), { recursive: true });
    writeFileSync(CONFIG_FILE(), 'active_model = "grok-code-fast"\n');
    writeFileSync(ACTIVE_FILE(), JSON.stringify({ active: 'gone' }));

    const result = await call<{ active: string | null }>('profiles.list');
    expect(result.active).toBeNull();
  });

  it('exports an Ed25519-signed profile and verifies it on import', async () => {
    const fs = await import('fs');
    fs.mkdirSync(join(tmpHome, '.codebuddy'), { recursive: true });
    writeFileSync(CONFIG_FILE(), '[profiles.portable]\nactive_model = "gpt-5.5"\n');
    const exported = await call<{ ok: boolean; profile?: Record<string, unknown> }>('profiles.export', 'portable');
    expect(exported.ok).toBe(true);
    expect(exported.profile?.signature).toBeTypeOf('string');
    expect(exported.profile?.publicKey).toContain('BEGIN PUBLIC KEY');

    writeFileSync(CONFIG_FILE(), 'active_model = "local"\n');
    const imported = await call<{ ok: boolean; profiles?: Array<{ name: string }> }>('profiles.import', exported.profile);
    expect(imported.ok).toBe(true);
    expect(imported.profiles?.map((profile) => profile.name)).toContain('portable');
  });

  it('refuses to export a profile containing an embedded secret', async () => {
    const fs = await import('fs');
    fs.mkdirSync(join(tmpHome, '.codebuddy'), { recursive: true });
    writeFileSync(CONFIG_FILE(), '[profiles.unsafe]\napi_key = "secret"\n');
    const result = await call<{ ok: boolean; error?: string }>('profiles.export', 'unsafe');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/secrets?/i);
  });
});
