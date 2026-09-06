import { describe, it, expect } from 'vitest';
import {
  buildCompanionChannelPrompt,
  channelWaitNoticeMs,
  companionWaitNoticeText,
  isChannelAgentIntent,
  shouldUseCompanionChannelProfile,
  COMPANION_CHANNEL_HISTORY_LIMIT,
} from '../../src/channels/companion-channel-profile.js';
import { COPINE_PERSONA } from '../../src/companion/personas/copine.js';

describe('companion channel profile', () => {
  it('is off by default (byte-identical agent path)', () => {
    expect(shouldUseCompanionChannelProfile({ text: 'salut', env: {} })).toBe(false);
  });

  it('turns on with CODEBUDDY_CHANNEL_PROFILE=companion', () => {
    expect(
      shouldUseCompanionChannelProfile({
        text: 'salut',
        env: { CODEBUDDY_CHANNEL_PROFILE: 'companion' },
      }),
    ).toBe(true);
  });

  it('turns on automatically when a companion persona is set', () => {
    expect(
      shouldUseCompanionChannelProfile({
        text: 'ça va ?',
        env: { CODEBUDDY_COMPANION_PERSONA: 'copine' },
      }),
    ).toBe(true);
  });

  it('keeps the agent profile for slash commands, lance, and code', () => {
    const env = { CODEBUDDY_COMPANION_PERSONA: 'copine' };
    expect(isChannelAgentIntent('/repo status')).toBe(true);
    expect(shouldUseCompanionChannelProfile({ text: '/help', env })).toBe(false);
    expect(shouldUseCompanionChannelProfile({ text: 'lance les tests', env })).toBe(false);
    expect(shouldUseCompanionChannelProfile({ text: 'code une fonction', env })).toBe(false);
    expect(shouldUseCompanionChannelProfile({ text: 'salut', isCommand: true, env })).toBe(false);
  });

  it('builds a prompt under 1500 tokens from spokenPrompt + relational + 10 turns', () => {
    const history = Array.from({ length: 14 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: i % 2 === 0 ? `tour utilisateur ${i}` : `réponse courte ${i}`,
    }));
    const built = buildCompanionChannelPrompt({
      spokenPrompt: COPINE_PERSONA.spokenPrompt,
      relationalContext: 'Humeur calme. On parlait de la journée.',
      history,
      userText: 'tu es là ?',
    });
    expect(built.messages[0]?.role).toBe('system');
    expect(String(built.messages[0]?.content)).toContain('Tu es Lisa');
    expect(String(built.messages[0]?.content)).toContain('Humeur calme');
    const nonSystem = built.messages.filter((message) => message.role !== 'system');
    expect(nonSystem).toHaveLength(COMPANION_CHANNEL_HISTORY_LIMIT + 1);
    expect(built.tokenEstimate).toBeLessThan(1500);
    expect(JSON.stringify(built.messages)).not.toMatch(/view_file|bash|mcp__/);
  });

  it('wait notice defaults to 20s and uses the honest spoken line', () => {
    expect(channelWaitNoticeMs({})).toBe(20_000);
    expect(channelWaitNoticeMs({ CODEBUDDY_CHANNEL_WAIT_NOTICE_MS: '50' })).toBe(50);
    expect(companionWaitNoticeText()).toBe('Je réfléchis, quelques secondes…');
  });
});
