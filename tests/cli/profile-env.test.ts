/**
 * Named profiles (`local`, `cloud`, `fleet`, `max`) group advanced settings as
 * env defaults. HOME and config are isolated under _qa/zero-config/home.
 */
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyProfileEnvDefaults, applyRequestedProfileEnv } from '../../src/cli/profile-env.js';
import { getConfigManager, profileNamesOf, resetConfigManager } from '../../src/config/toml-config.js';

const QA_HOME = path.resolve(__dirname, '../../_qa/zero-config/home-profile-test');
const saved = { ...process.env };
const savedCwd = process.cwd();

function argv(...args: string[]): string[] {
  return ['node', 'buddy', ...args];
}

beforeAll(() => {
  fs.rmSync(QA_HOME, { recursive: true, force: true });
  fs.mkdirSync(path.join(QA_HOME, '.codebuddy'), { recursive: true });
});

afterAll(() => {
  fs.rmSync(QA_HOME, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.HOME = QA_HOME;
  process.env.CODEBUDDY_HOME = QA_HOME;
  process.env.CODEBUDDY_CONFIG = path.join(QA_HOME, '.codebuddy', 'config.toml');
  process.chdir(QA_HOME);
  resetConfigManager();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  process.chdir(savedCwd);
  resetConfigManager();
  try {
    fs.rmSync(path.join(QA_HOME, '.codebuddy', 'config.toml'), { force: true });
  } catch {
    /* already gone */
  }
});

describe('applyProfileEnvDefaults', () => {
  it('fills unset variables only — an existing value keeps priority', () => {
    const env: NodeJS.ProcessEnv = { CODEBUDDY_LOCAL_ONLY: 'false' };
    const applied = applyProfileEnvDefaults(
      { CODEBUDDY_LOCAL_ONLY: 'true', CODEBUDDY_PREFER_LOCAL: 'true' },
      env,
    );
    expect(env.CODEBUDDY_LOCAL_ONLY).toBe('false');
    expect(env.CODEBUDDY_PREFER_LOCAL).toBe('true');
    expect(applied).toEqual({ CODEBUDDY_PREFER_LOCAL: 'true' });
  });

  it('keeps an explicitly empty variable (set, even if empty)', () => {
    const env: NodeJS.ProcessEnv = { CODEBUDDY_DIFF_REVIEW: '' };
    applyProfileEnvDefaults({ CODEBUDDY_DIFF_REVIEW: 'static' }, env);
    expect(env.CODEBUDDY_DIFF_REVIEW).toBe('');
  });

  it('ignores invalid names and non-scalar values', () => {
    const env: NodeJS.ProcessEnv = {};
    const applied = applyProfileEnvDefaults({ 'BAD NAME': 'x', OBJ: { a: 1 }, N: 2, B: true }, env);
    expect(applied).toEqual({ N: '2', B: 'true' });
  });

  it('is a no-op for a missing or malformed env table', () => {
    expect(applyProfileEnvDefaults(undefined, {})).toEqual({});
    expect(applyProfileEnvDefaults(['A'], {})).toEqual({});
  });
});

describe('built-in named profiles', () => {
  it('lists local, cloud, fleet and max next to core and all', () => {
    getConfigManager().load();
    const names = profileNamesOf(getConfigManager().getConfig().profiles);
    for (const name of ['core', 'all', 'local', 'cloud', 'fleet', 'max']) expect(names).toContain(name);
  });

  it('applies without an unknown-key warning and returns the grouped settings', () => {
    getConfigManager().load();
    for (const name of ['local', 'cloud', 'fleet', 'max']) {
      expect(() => getConfigManager().applyProfile(name)).not.toThrow();
    }
  });

  it('`--profile local` prefers the local model and keeps failover local', () => {
    delete process.env.CODEBUDDY_PREFER_LOCAL;
    delete process.env.CODEBUDDY_LOCAL_ONLY;
    getConfigManager().load();
    const result = applyRequestedProfileEnv(argv('--profile', 'local'));
    expect(result.profile).toBe('local');
    expect(process.env.CODEBUDDY_PREFER_LOCAL).toBe('true');
    expect(process.env.CODEBUDDY_LOCAL_ONLY).toBe('true');
  });

  it('`--profile=cloud` disables the local fallback and enables provider failover', () => {
    delete process.env.CODEBUDDY_ZERO_CONFIG;
    delete process.env.CODEBUDDY_PROVIDER_FALLBACK;
    getConfigManager().load();
    applyRequestedProfileEnv(argv('--profile=cloud'));
    expect(process.env.CODEBUDDY_ZERO_CONFIG).toBe('false');
    expect(process.env.CODEBUDDY_PROVIDER_FALLBACK).toBe('true');
  });

  it('an exported variable wins over `--profile max`', () => {
    process.env.CODEBUDDY_DIFF_REVIEW = 'off';
    delete process.env.CODEBUDDY_CONTEXT_ZOOM;
    getConfigManager().load();
    const { applied } = applyRequestedProfileEnv(argv('--profile', 'max'));
    expect(process.env.CODEBUDDY_DIFF_REVIEW).toBe('off');
    expect(applied.CODEBUDDY_DIFF_REVIEW).toBeUndefined();
    expect(process.env.CODEBUDDY_CONTEXT_ZOOM).toBe('true');
  });

  it('no --profile changes nothing', () => {
    const before = { ...process.env };
    getConfigManager().load();
    expect(applyRequestedProfileEnv(argv('-p', 'hello')).applied).toEqual({});
    expect(process.env).toEqual(before);
  });

  it('a user [profiles.local.env] table in config.toml is deep-merged over the built-in one', () => {
    fs.writeFileSync(
      process.env.CODEBUDDY_CONFIG!,
      ['[profiles.local.env]', 'CODEBUDDY_LOCAL_ONLY = "false"', 'OLLAMA_MODEL = "qwen3:14b"', ''].join('\n'),
    );
    delete process.env.CODEBUDDY_LOCAL_ONLY;
    delete process.env.OLLAMA_MODEL;
    delete process.env.CODEBUDDY_PREFER_LOCAL;
    getConfigManager().load();
    const { applied } = applyRequestedProfileEnv(argv('--profile', 'local'));
    expect(applied).toEqual({
      CODEBUDDY_PREFER_LOCAL: 'true', // built-in key kept
      CODEBUDDY_LOCAL_ONLY: 'false', // user value wins
      OLLAMA_MODEL: 'qwen3:14b', // user addition
    });
  });
});
