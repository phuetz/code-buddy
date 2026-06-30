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
});
