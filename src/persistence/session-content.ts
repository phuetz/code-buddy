import { SessionEncryption, type EncryptedData } from '../security/session-encryption.js';
import type { SessionMessage } from './session-store.js';

export class SessionDecryptionError extends Error {
  constructor(cause: unknown) {
    super('Cannot decrypt session: restore the original encryption key before continuing.', { cause });
    this.name = 'SessionDecryptionError';
  }
}

function envelope(messages: SessionMessage[]): { data: EncryptedData; format?: string } | null {
  if (messages.length !== 1 || messages[0]?.type !== 'assistant') return null;
  let value: unknown;
  try { value = JSON.parse(messages[0].content); } catch { return null; }
  if (!value || typeof value !== 'object' || !('__encrypted' in value) || value.__encrypted !== true) return null;
  if (!('data' in value)) throw new SessionDecryptionError(new Error('Missing encrypted data'));
  return value as { data: EncryptedData; format?: string };
}

export function hasEncryptedSessionContent(messages: SessionMessage[]): boolean {
  return envelope(messages) !== null;
}

/** Both async and legacy synchronous store readers use the same authenticated decoder. */
export function decryptSessionContent(messages: SessionMessage[], keyPath?: string): SessionMessage[] {
  const wrapped = envelope(messages);
  if (!wrapped) return messages;
  const encryption = new SessionEncryption({ keyPath, requirePersistentKey: true });
  try {
    if (!encryption.isEncrypted(wrapped.data) || ![1, 2].includes(wrapped.data.version)) throw new Error('Invalid encrypted envelope');
    encryption.initializeForRead();
    const decoded: unknown = encryption.decryptObject(wrapped.data);
    if (!Array.isArray(decoded)) throw new Error('Invalid encrypted history');
    const types = new Set(['user', 'assistant', 'tool_call', 'tool_result', 'reasoning', 'plan_progress', 'steer', 'diff_preview']);
    return decoded.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object') throw new Error('Invalid encrypted message');
      const message = entry as SessionMessage;
      if (!types.has(message.type) || typeof message.content !== 'string' ||
          typeof message.timestamp !== 'string' || !Number.isFinite(Date.parse(message.timestamp))) {
        throw new Error('Invalid encrypted message');
      }
      // Legacy envelopes contain ChatEntry JSON; its timestamp is already serialized.
      return { ...message };
    });
  } catch (error) {
    throw new SessionDecryptionError(error);
  } finally {
    encryption.dispose();
  }
}

export async function encryptSessionContent(messages: SessionMessage[], keyPath?: string): Promise<SessionMessage[]> {
  if (hasEncryptedSessionContent(messages)) return messages;
  const encryption = new SessionEncryption({ keyPath, requirePersistentKey: true });
  try {
    await encryption.initialize();
    const data = encryption.encryptObject(messages);
    if (!encryption.isEncrypted(data)) throw new Error('Session encryption produced plaintext');
    return [{ type: 'assistant', timestamp: new Date().toISOString(),
      content: JSON.stringify({ __encrypted: true, format: 'session-messages-v1', data }) }];
  } finally {
    encryption.dispose();
  }
}

/**
 * Seal a text copied out of a session (an archive, an export) with the same
 * envelope and key as the session messages. The result never contains the text.
 */
export async function sealSessionText(text: string, keyPath?: string): Promise<string> {
  const [sealed] = await encryptSessionContent(
    [{ type: 'user', content: text, timestamp: new Date(0).toISOString() }],
    keyPath,
  );
  if (!sealed || !hasEncryptedSessionContent([sealed])) throw new Error('Session text was not sealed');
  return sealed.content;
}

/** Open what `sealSessionText` produced. A plain or damaged payload throws. */
export function openSessionText(payload: string, keyPath?: string): string {
  const wrapped: SessionMessage[] = [{ type: 'assistant', content: payload, timestamp: new Date(0).toISOString() }];
  if (!hasEncryptedSessionContent(wrapped)) throw new SessionDecryptionError(new Error('Payload is not sealed'));
  const opened = decryptSessionContent(wrapped, keyPath);
  if (opened.length !== 1 || opened[0]?.type !== 'user') throw new SessionDecryptionError(new Error('Invalid sealed text'));
  return opened[0].content;
}
