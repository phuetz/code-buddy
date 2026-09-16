/**
 * ChatGPT OAuth needs a real browser AND an interactive terminal.
 * Without them the callback server waits up to five minutes for a
 * redirect that never arrives — a hang, not a login.
 */

export const LOGIN_NEEDS_BROWSER_MESSAGE = [
  'ChatGPT login needs an interactive terminal and a browser.',
  'This session has no display (or stdin is not a terminal), so waiting for the OAuth callback would block.',
  'From a graphical desktop run `buddy login`, or set up a local model with `buddy onboard`.',
].join('\n');

export interface LoginIo {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
}

export function canAttemptInteractiveLogin(
  env: NodeJS.ProcessEnv = process.env,
  io: LoginIo = {
    stdinIsTTY: process.stdin.isTTY,
    stdoutIsTTY: process.stdout.isTTY,
  },
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (env.CI === 'true' || env.CODEBUDDY_LOGIN_NO_BROWSER === 'true') return false;
  if (io.stdinIsTTY !== true || io.stdoutIsTTY !== true) return false;
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  return true;
}
