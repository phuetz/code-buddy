import { describe, it, expect } from 'vitest';
import {
  classifyChannelProviderFailure,
  speakChannelProviderFailure,
  COMPANION_CHANNEL_FAILOVER_SEAM,
} from '../../src/channels/provider-failure-speech.js';

describe('channel provider-failure speech', () => {
  it('exposes the CodeBuddyClient.chat failover seam (do not reimplement the chain)', () => {
    expect(COMPANION_CHANNEL_FAILOVER_SEAM).toBe('CodeBuddyClient.chat');
  });

  it('says the quota reset time instead of a generic apology', () => {
    const now = Date.parse('2026-09-06T10:00:00+02:00');
    const err = 'ChatGPT Responses backend error (429): {"type":"usage_limit_reached","resets_in_seconds":3600}';
    const failure = classifyChannelProviderFailure(err, now);
    expect(failure.kind).toBe('quota');
    expect(failure.resetsAt?.getTime()).toBe(now + 3600_000);
    const spoken = speakChannelProviderFailure(err, { nowMs: now, copine: true });
    const until = failure.resetsAt!.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    expect(spoken).toMatch(/quota/i);
    expect(spoken).toContain(until);
    expect(spoken).not.toMatch(/réponse fiable/);
  });

  it('names an unavailable model', () => {
    const spoken = speakChannelProviderFailure('404 model not found: gpt-5.5', { copine: true });
    expect(spoken).toMatch(/modèle/i);
    expect(spoken).not.toMatch(/réponse fiable/);
  });

  it('names exhausted credits', () => {
    const err = Object.assign(new Error('Forbidden: out_of_credits'), { status: 403 });
    const spoken = speakChannelProviderFailure(err, { copine: true });
    expect(spoken).toMatch(/crédits/i);
  });

  it('names a timeout honestly', () => {
    const err = Object.assign(new Error('channel turn timed out after 180000ms during generation'), {
      name: 'ChannelTurnTimeoutError',
    });
    const spoken = speakChannelProviderFailure(err, { copine: true });
    expect(spoken).toMatch(/trop long/i);
  });
});
