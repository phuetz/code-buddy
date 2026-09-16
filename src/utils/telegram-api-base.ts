/**
 * Telegram Bot API origin.
 *
 * Defaults to the public API. Operators (and GK10's local fake server) can
 * point every bot call at a loopback origin via TELEGRAM_API_BASE.
 * Trailing slashes are stripped so `/bot<token>/<method>` stays well-formed.
 */

export const DEFAULT_TELEGRAM_API_BASE = 'https://api.telegram.org';

export function resolveTelegramApiBase(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.TELEGRAM_API_BASE?.trim();
  if (!raw) return DEFAULT_TELEGRAM_API_BASE;
  return raw.replace(/\/+$/u, '');
}
