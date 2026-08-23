/**
 * Interactive CLI splash shown while the agent graph loads.
 *
 * Automation (CI, scripts scraping the TTY) can skip it with
 * `CODEBUDDY_NO_LOADING_SCREEN=1` or `--no-loading-screen`.
 */

export const LOADING_SCREEN_TITLE = 'Starting Code Buddy...';

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export function isLoadingScreenDisabled(
  env: NodeJS.ProcessEnv = process.env,
  cliFlag = false,
): boolean {
  if (cliFlag) return true;
  const raw = env.CODEBUDDY_NO_LOADING_SCREEN;
  if (raw == null || raw === '') return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}
