/**
 * Forward a PWA chat line to the configured Telegram alert channel.
 * Hidden on the client when this returns false; never throws.
 */

export function isTelegramForwardConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const token = (env.CODEBUDDY_SENSORY_ALERT_TOKEN || env.TELEGRAM_BOT_TOKEN || '').trim();
  const chat = (env.CODEBUDDY_SENSORY_ALERT_CHAT || '').trim();
  return Boolean(token && chat);
}

export async function forwardMobileTextToTelegram(
  text: string,
  deps: { send?: (caption: string) => Promise<boolean> } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const caption = text.trim().slice(0, 4000);
  if (!caption) return { ok: false, status: 400, error: 'Text is required' };
  if (!isTelegramForwardConfigured(env)) {
    return { ok: false, status: 404, error: 'Telegram not configured' };
  }
  try {
    const send =
      deps.send ??
      (async (line: string) => {
        const { sendTelegramAlert } = await import('../../sensory/alert.js');
        return sendTelegramAlert(line);
      });
    const sent = await send(caption);
    if (!sent) return { ok: false, status: 502, error: 'Telegram send failed' };
    return { ok: true };
  } catch {
    return { ok: false, status: 502, error: 'Telegram send failed' };
  }
}
