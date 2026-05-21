import path from 'path';
import {
  formatCodeBuddyHomeInfo,
  getCodeBuddyHome,
  getCodeBuddyPath,
  getGrokPath,
  isCustomCodeBuddyHome,
} from '../../src/utils/codebuddy-home.js';

describe('codebuddy-home', () => {
  const originalCodeBuddyHome = process.env.CODEBUDDY_HOME;
  const originalGrokHome = process.env.GROK_HOME;

  afterEach(() => {
    if (originalCodeBuddyHome === undefined) {
      delete process.env.CODEBUDDY_HOME;
    } else {
      process.env.CODEBUDDY_HOME = originalCodeBuddyHome;
    }

    if (originalGrokHome === undefined) {
      delete process.env.GROK_HOME;
    } else {
      process.env.GROK_HOME = originalGrokHome;
    }
  });

  it('prefers CODEBUDDY_HOME over the legacy GROK_HOME alias', () => {
    process.env.CODEBUDDY_HOME = path.join('tmp', 'codebuddy-home');
    process.env.GROK_HOME = path.join('tmp', 'grok-home');

    expect(getCodeBuddyHome()).toBe(process.env.CODEBUDDY_HOME);
    expect(isCustomCodeBuddyHome()).toBe(true);
    expect(formatCodeBuddyHomeInfo()).toContain('custom via CODEBUDDY_HOME');
  });

  it('keeps GROK_HOME as a backward-compatible alias', () => {
    delete process.env.CODEBUDDY_HOME;
    process.env.GROK_HOME = path.join('tmp', 'legacy-grok-home');

    expect(getCodeBuddyHome()).toBe(process.env.GROK_HOME);
    expect(formatCodeBuddyHomeInfo()).toContain('custom via GROK_HOME');
  });

  it('keeps getGrokPath as an alias of getCodeBuddyPath', () => {
    process.env.CODEBUDDY_HOME = path.join('tmp', 'codebuddy-home');

    expect(getGrokPath('sessions')).toBe(getCodeBuddyPath('sessions'));
  });
});
