import { describe, expect, it } from 'vitest';
import { applyChatReplyContext, readClientMsgId } from '../../src/server/mobile/chat-extras.js';

describe('mobile chat extras (lot 1)', () => {
  it('leaves the message unchanged when replyTo is absent (old clients)', () => {
    expect(applyChatReplyContext('salut', undefined)).toBe('salut');
    expect(applyChatReplyContext('salut', null)).toBe('salut');
    expect(applyChatReplyContext('salut', { id: 'm-1' })).toBe('salut');
  });

  it('prefixes a bounded quote when replyTo.text is present', () => {
    const out = applyChatReplyContext('oui', { id: 'm-1', text: 'on se voit ?' });
    expect(out).toBe('En réponse à : « on se voit ? »\n\noui');
    const long = 'x'.repeat(400);
    const clipped = applyChatReplyContext('ok', { text: long });
    expect(clipped).toContain('« ');
    expect(clipped.indexOf('ok')).toBeGreaterThan(280);
    expect(clipped).toMatch(/ok$/);
  });

  it('accepts only a short token-like clientMsgId', () => {
    expect(readClientMsgId('m-1')).toBe('m-1');
    expect(readClientMsgId('m-171000-2')).toBe('m-171000-2');
    expect(readClientMsgId('../etc/passwd')).toBeUndefined();
    expect(readClientMsgId(1)).toBeUndefined();
    expect(readClientMsgId('')).toBeUndefined();
  });
});
