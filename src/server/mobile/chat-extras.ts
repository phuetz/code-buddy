/**
 * Optional chat-frame extras for the mobile PWA.
 *
 * Old clients never send `replyTo` / `clientMsgId`; the helpers then return
 * the original message and `undefined`. Unknown extra fields on a `chat`
 * payload stay ignored by the rest of the handler.
 */

export function applyChatReplyContext(message: string, replyTo: unknown): string {
  if (!replyTo || typeof replyTo !== 'object' || Array.isArray(replyTo)) return message;
  const text =
    typeof (replyTo as { text?: unknown }).text === 'string'
      ? (replyTo as { text: string }).text.trim().slice(0, 280)
      : '';
  if (!text) return message;
  return `En réponse à : « ${text} »\n\n${message}`;
}

export function readClientMsgId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const id = raw.trim().slice(0, 80);
  return /^[A-Za-z0-9._:-]+$/.test(id) ? id : undefined;
}
