import { describe, it, expect } from 'vitest';
import { scrubbedEnv, strippedKeys } from '../../../../src/agent/self-improvement/evolution/scrub-env.js';

describe('scrub-env', () => {
  const dirty: NodeJS.ProcessEnv = {
    PATH: '/usr/bin',
    HOME: '/home/u',
    NODE_OPTIONS: '--max-old-space-size=8192',
    GROK_API_KEY: 'xai-secret',
    OPENAI_API_KEY: 'sk-secret',
    ANTHROPIC_API_KEY: 'sk-ant',
    GITHUB_TOKEN: 'ghp_x',
    JWT_SECRET: 'jjj',
    AWS_SECRET_ACCESS_KEY: 'aws',
    PICOVOICE_ACCESS_KEY: 'pv',
    DATABASE_PASSWORD: 'pw',
  };

  it('strips secret-looking keys, keeps benign ones', () => {
    const out = scrubbedEnv(dirty);
    expect(out.PATH).toBe('/usr/bin');
    expect(out.HOME).toBe('/home/u');
    expect(out.NODE_OPTIONS).toBe('--max-old-space-size=8192');
    for (const k of ['GROK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'JWT_SECRET', 'AWS_SECRET_ACCESS_KEY', 'PICOVOICE_ACCESS_KEY', 'DATABASE_PASSWORD']) {
      expect(out[k], k).toBeUndefined();
    }
  });

  it('strippedKeys lists exactly the removed secret keys', () => {
    expect(strippedKeys(dirty).sort()).toEqual(
      ['ANTHROPIC_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_PASSWORD', 'GITHUB_TOKEN', 'GROK_API_KEY', 'JWT_SECRET', 'OPENAI_API_KEY', 'PICOVOICE_ACCESS_KEY'].sort(),
    );
  });

  it('strips value-bearing connection strings whose key name is innocuous', () => {
    const conn: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      DATABASE_URL: 'postgres://user:pw@host/db',
      REDIS_URL: 'redis://:pw@host:6379',
      MONGODB_URI: 'mongodb+srv://user:pw@cluster',
      SUPABASE_URL: 'https://x.supabase.co',
      POSTGRES_HOST: 'db.internal',
    };
    const out = scrubbedEnv(conn);
    expect(out.PATH).toBe('/usr/bin');
    for (const k of ['DATABASE_URL', 'REDIS_URL', 'MONGODB_URI', 'SUPABASE_URL', 'POSTGRES_HOST']) {
      expect(out[k], k).toBeUndefined();
    }
  });

  it('redirects HOME/USERPROFILE so ~/.codebuddy credential files are unreachable by path', () => {
    const out = scrubbedEnv(dirty, { homeDir: '/tmp/sandbox-home' });
    expect(out.HOME).toBe('/tmp/sandbox-home'); // not /home/u
    expect(out.USERPROFILE).toBe('/tmp/sandbox-home');
  });

  it('without homeDir, HOME is preserved (back-compat)', () => {
    expect(scrubbedEnv(dirty).HOME).toBe('/home/u');
  });
});
