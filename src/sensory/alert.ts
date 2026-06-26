/**
 * Sensory alert — best-effort Telegram push (photo + caption) for the remote
 * watch. Token + chat id come from env (`CODEBUDDY_SENSORY_ALERT_TOKEN` /
 * `CODEBUDDY_SENSORY_ALERT_CHAT`). No-op when unconfigured; never throws.
 *
 * @module sensory/alert
 */
import { logger } from '../utils/logger.js';

/**
 * Send `text` as a Telegram VOICE NOTE (so the robot's voice reaches Patrice's phone when he's
 * away, not just the home speakers): synthesize to OGG/Opus (Piper → ffmpeg, the format Telegram
 * voice notes require) and POST `sendVoice`. Falls back to a text alert if synthesis/sending
 * fails. No-op (returns false) when the alert token/voice isn't configured. Never throws.
 * Injectable (`synthesize` / `post`) for deterministic tests.
 */
export async function sendTelegramVoice(
  text: string,
  deps: {
    synthesize?: (t: string) => Promise<string>;
    post?: (url: string, form: FormData) => Promise<{ ok: boolean }>;
  } = {},
): Promise<boolean> {
  const token = process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
  const chat = process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
  if (!token || !chat || !text.trim()) return false;
  const post = deps.post ?? ((url, form) => fetch(url, { method: 'POST', body: form }));
  let ogg: string | undefined;
  try {
    const synthesize =
      deps.synthesize ?? (async (t: string) => (await import('../voice/local-tts.js')).synthesizeToOgg(t));
    ogg = await synthesize(text);
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const bytes = await fs.readFile(ogg);
    const form = new FormData();
    form.append('chat_id', chat);
    form.append('voice', new Blob([bytes], { type: 'audio/ogg' }), path.basename(ogg));
    form.append('caption', text.slice(0, 1024)); // text too, for skim + fallback context
    const res = await post(`https://api.telegram.org/bot${token}/sendVoice`, form);
    return Boolean(res?.ok);
  } catch (err) {
    logger.warn(`[sensory] voice note failed, sending text instead: ${err instanceof Error ? err.message : String(err)}`);
    await sendTelegramAlert(text).catch(() => undefined);
    return false;
  } finally {
    if (ogg) {
      try {
        await (await import('node:fs/promises')).unlink(ogg);
      } catch {
        /* leave the temp file if cleanup fails */
      }
    }
  }
}

export async function sendTelegramAlert(caption: string, imagePath?: string): Promise<void> {
  const token = process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
  const chat = process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
  if (!token || !chat) return;
  try {
    if (imagePath) {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const bytes = await fs.readFile(imagePath);
      const form = new FormData();
      form.append('chat_id', chat);
      form.append('caption', caption.slice(0, 1024));
      form.append('photo', new Blob([bytes], { type: 'image/jpeg' }), path.basename(imagePath));
      await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
    } else {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: caption }),
      });
    }
  } catch (err) {
    logger.warn(`[sensory] alert failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
