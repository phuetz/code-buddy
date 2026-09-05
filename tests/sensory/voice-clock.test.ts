/**
 * Clock facts must never be invented by the chitchat model. Direct questions
 * are answered locally; the fast-lane system prompt still carries the turn's
 * timestamp so indirect questions ("il est tard ?") stay grounded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chat = vi.hoisted(() =>
  vi.fn(async () => ({
    choices: [{ message: { content: 'Un peu, oui.' } }],
  })),
);

vi.mock('../../src/codebuddy/client.js', () => ({
  CHATGPT_OAUTH_SENTINEL: 'oauth-chatgpt',
  CHATGPT_RESPONSES_BASE_URL: 'https://chatgpt.com/backend-api/codex',
  CodeBuddyClient: class {
    chat = chat;
  },
}));

import { defaultReply } from '../../src/sensory/voice-loop.js';

const FROZEN = new Date('2026-09-02T12:53:00.000Z');

describe('voice chitchat — clock grounding in the system prompt', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.tz = process.env.CODEBUDDY_TIMEZONE;
    saved.fast = process.env.CODEBUDDY_SENSORY_FAST_REPLIES;
    saved.model = process.env.CODEBUDDY_SENSORY_SPEAK_MODEL;
    saved.selfie = process.env.CODEBUDDY_LISA_SELFIE;
    saved.relational = process.env.CODEBUDDY_COMPANION_RELATIONAL;
    process.env.CODEBUDDY_TIMEZONE = 'Europe/Paris';
    process.env.CODEBUDDY_SENSORY_SPEAK_MODEL = 'qwen-clock-test';
    process.env.CODEBUDDY_LISA_SELFIE = 'false';
    process.env.CODEBUDDY_COMPANION_RELATIONAL = 'false';
    delete process.env.CODEBUDDY_SENSORY_FAST_REPLIES;
    chat.mockClear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FROZEN);
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreEnv('CODEBUDDY_TIMEZONE', saved.tz);
    restoreEnv('CODEBUDDY_SENSORY_FAST_REPLIES', saved.fast);
    restoreEnv('CODEBUDDY_SENSORY_SPEAK_MODEL', saved.model);
    restoreEnv('CODEBUDDY_LISA_SELFIE', saved.selfie);
    restoreEnv('CODEBUDDY_COMPANION_RELATIONAL', saved.relational);
  });

  it('sends the turn timestamp to the fake provider for an indirect time question', async () => {
    const reply = await defaultReply('il est tard ?', [], {
      relationshipEvolutionHandled: true,
    });
    expect(reply).toBe('Un peu, oui.');
    expect(chat).toHaveBeenCalledOnce();
    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    const system = messages.find((message) => message.role === 'system')?.content ?? '';
    expect(system).toContain('<horloge>');
    expect(system).toContain('mercredi 2 septembre 2026');
    expect(system).toContain('14 h 53');
    expect(system).toContain('Europe/Paris');
  });

  it('still grounds the prompt when the deterministic shortcut is disabled', async () => {
    process.env.CODEBUDDY_SENSORY_FAST_REPLIES = 'false';
    await defaultReply('Lisa, quelle heure est-il ?', [], {
      relationshipEvolutionHandled: true,
    });
    expect(chat).toHaveBeenCalledOnce();
    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    const system = messages.find((message) => message.role === 'system')?.content ?? '';
    expect(system).toMatch(/<horloge>[\s\S]*14 h 53[\s\S]*Europe\/Paris/);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
