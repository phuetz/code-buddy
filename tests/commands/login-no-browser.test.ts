import { describe, expect, it } from 'vitest';

import {
  LOGIN_NEEDS_BROWSER_MESSAGE,
  LOGIN_NO_BROWSER_FLAG_MESSAGE,
  canAttemptInteractiveLogin,
} from '../../src/commands/login-prerequisites.js';

describe('ChatGPT login without a browser', () => {
  it('refuses a non-interactive session so login cannot block for five minutes', () => {
    expect(
      canAttemptInteractiveLogin(
        { CI: 'true' },
        { stdinIsTTY: true, stdoutIsTTY: true },
      ),
    ).toBe(false);
    expect(
      canAttemptInteractiveLogin(
        {},
        { stdinIsTTY: false, stdoutIsTTY: true },
      ),
    ).toBe(false);
    expect(
      canAttemptInteractiveLogin(
        { DISPLAY: '', WAYLAND_DISPLAY: '' },
        { stdinIsTTY: true, stdoutIsTTY: true },
        'linux',
      ),
    ).toBe(false);
    expect(LOGIN_NEEDS_BROWSER_MESSAGE).toContain('interactive terminal and a browser');
    expect(LOGIN_NEEDS_BROWSER_MESSAGE).toContain('buddy onboard');
    expect(LOGIN_NEEDS_BROWSER_MESSAGE).not.toMatch(/ECONN|ETIMEDOUT|stack/i);
  });

  it('allows a graphical interactive session', () => {
    expect(
      canAttemptInteractiveLogin(
        { DISPLAY: ':0' },
        { stdinIsTTY: true, stdoutIsTTY: true },
        'linux',
      ),
    ).toBe(true);
  });

  it('explains --no-browser without claiming the session has no display', () => {
    expect(LOGIN_NO_BROWSER_FLAG_MESSAGE).toContain('--no-browser was set');
    expect(LOGIN_NO_BROWSER_FLAG_MESSAGE).toContain('does not switch to a device code');
    expect(LOGIN_NO_BROWSER_FLAG_MESSAGE).toContain('buddy onboard');
    expect(LOGIN_NO_BROWSER_FLAG_MESSAGE).not.toContain('has no display');
  });
});
