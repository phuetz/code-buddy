/**
 * Cross-channel identity integration tests.
 *
 * Tests identity linking across channels and its effect on session keys.
 */

import { IdentityLinker, resetIdentityLinker } from '../../src/channels/identity-links.js';
import { SessionIsolator, resetSessionIsolator } from '../../src/channels/session-isolation.js';

describe('Multi-Channel Identity', () => {
  let linker: IdentityLinker;
  let isolator: SessionIsolator;

  beforeEach(() => {
    resetIdentityLinker();
    resetSessionIsolator();
    // autoPersist: false — this suite never asserts on-disk state, and the
    // default persistPath is the REAL ~/.codebuddy/identity-links.json.
    // Without this, every run of this file fired unawaited writes at the
    // user's actual home directory (see docs/reports/2026-09/REPARATION-IDLINKS1.md).
    linker = new IdentityLinker({ autoPersist: false });
    isolator = new SessionIsolator({ identityLinker: linker });
  });

  afterEach(() => {
    resetIdentityLinker();
    resetSessionIsolator();
  });

  it('should produce different session keys for unlinked identities', () => {
    const telegramMsg = {
      id: 'msg-1',
      content: 'hi',
      channel: { type: 'telegram' as const, id: 'tg-chan', name: 'tg' },
      sender: { id: 'alice-tg', name: 'Alice' },
      timestamp: new Date(),
      raw: {},
    };

    const discordMsg = {
      id: 'msg-2',
      content: 'hi',
      channel: { type: 'discord' as const, id: 'dc-chan', name: 'dc' },
      sender: { id: 'alice-dc', name: 'Alice' },
      timestamp: new Date(),
      raw: {},
    };

    const key1 = isolator.getSessionKey(telegramMsg as any);
    const key2 = isolator.getSessionKey(discordMsg as any);
    expect(key1).not.toBe(key2);
  });

  it('should converge session keys after linking identities', () => {
    linker.link(
      { channelType: 'telegram', peerId: 'alice-tg' },
      { channelType: 'discord', peerId: 'alice-dc' }
    );

    const telegramMsg = {
      id: 'msg-1',
      content: 'hi',
      channel: { type: 'telegram' as const, id: 'tg-chan', name: 'tg' },
      sender: { id: 'alice-tg', name: 'Alice' },
      timestamp: new Date(),
      raw: {},
    };

    const discordMsg = {
      id: 'msg-2',
      content: 'hi',
      channel: { type: 'discord' as const, id: 'dc-chan', name: 'dc' },
      sender: { id: 'alice-dc', name: 'Alice' },
      timestamp: new Date(),
      raw: {},
    };

    const key1 = isolator.getSessionKey(telegramMsg as any);
    const key2 = isolator.getSessionKey(discordMsg as any);
    expect(key1).toBe(key2);
  });

  it('should restore separate keys after unlinking', () => {
    linker.link(
      { channelType: 'telegram', peerId: 'bob-tg' },
      { channelType: 'discord', peerId: 'bob-dc' }
    );

    const tgMsg = {
      id: 'msg-1', content: 'hi',
      channel: { type: 'telegram' as const, id: 'chan', name: 'c' },
      sender: { id: 'bob-tg', name: 'Bob' },
      timestamp: new Date(), raw: {},
    };

    const dcMsg = {
      id: 'msg-2', content: 'hi',
      channel: { type: 'discord' as const, id: 'chan', name: 'c' },
      sender: { id: 'bob-dc', name: 'Bob' },
      timestamp: new Date(), raw: {},
    };

    // Linked: same key
    const keyBefore1 = isolator.getSessionKey(tgMsg as any);
    const keyBefore2 = isolator.getSessionKey(dcMsg as any);
    expect(keyBefore1).toBe(keyBefore2);

    // Unlink
    linker.unlink({ channelType: 'telegram', peerId: 'bob-tg' });

    const keyAfter1 = isolator.getSessionKey(tgMsg as any);
    const keyAfter2 = isolator.getSessionKey(dcMsg as any);
    expect(keyAfter1).not.toBe(keyAfter2);
  });

  it('should support three-way linking', () => {
    linker.link(
      { channelType: 'telegram', peerId: 'carol-tg' },
      { channelType: 'discord', peerId: 'carol-dc' }
    );
    linker.link(
      { channelType: 'telegram', peerId: 'carol-tg' },
      { channelType: 'slack', peerId: 'carol-sl' }
    );

    const msgs = [
      { type: 'telegram', peerId: 'carol-tg' },
      { type: 'discord', peerId: 'carol-dc' },
      { type: 'slack', peerId: 'carol-sl' },
    ].map(({ type, peerId }, i) => ({
      id: `msg-${i}`, content: 'hi',
      channel: { type: type as any, id: `${type}-chan`, name: type },
      sender: { id: peerId, name: 'Carol' },
      timestamp: new Date(), raw: {},
    }));

    const keys = msgs.map(m => isolator.getSessionKey(m as any));
    expect(keys[0]).toBe(keys[1]);
    expect(keys[1]).toBe(keys[2]);
  });
});
