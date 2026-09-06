/**
 * ONE companion path — the PWA and the channels must produce Lisa's reply the
 * same way. Before this test the mobile WebSocket called `defaultReply` (the
 * VOICE loop, fastest-model routed, no history), while Telegram went through
 * the companion channel profile: two different Lisas for the same person.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runCompanionTurn,
  type CompanionHistoryTurn,
} from '../../src/companion/companion-turn.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';

const ENV_KEYS = [
  'CODEBUDDY_COMPANION_PERSONA',
  'CODEBUDDY_CHANNEL_PROFILE',
  'CODEBUDDY_LISA_SELFIE',
  'CODEBUDDY_COMPANION_RELATIONAL',
  'CODEBUDDY_ROBOT_NAME',
  'CODEBUDDY_USER_NAME',
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

function captureChat(reply = 'Coucou toi.') {
  const seen: CodeBuddyMessage[][] = [];
  const chat = vi.fn(async (messages: CodeBuddyMessage[]) => {
    seen.push(messages);
    return {
      choices: [{ message: { content: reply, role: 'assistant' } }],
      model: 'fake-model',
    } as never;
  });
  return { chat, seen };
}

describe('runCompanionTurn — one path for every companion surface', () => {
  it('serves a cached selfie without ever calling the LLM', async () => {
    const { chat } = captureChat();
    const result = await runCompanionTurn('envoie-moi une photo de toi', {
      surface: 'mobile',
      env: { CODEBUDDY_COMPANION_PERSONA: 'copine' } as NodeJS.ProcessEnv,
      chat,
      resolveProvider: () => ({ apiKey: 'k', baseUrl: 'http://127.0.0.1:4199/v1', model: 'm' }),
      serveSelfie: async () => ({
        handled: true,
        caption: 'Hop. Photo de moi.',
        imagePath: '/nowhere/a.png',
        mimeType: 'image/png',
        imageBase64: 'AAAA',
        refused: false,
        reason: 'ok',
        contentTier: 'safe',
      }),
    });
    expect(result.kind).toBe('selfie');
    expect(result.text).toBe('Hop. Photo de moi.');
    expect(result.image).toEqual({ mimeType: 'image/png', data: 'AAAA' });
    expect(chat).not.toHaveBeenCalled();
  });

  it('routes a plain message through the companion profile with typed history', async () => {
    const { chat, seen } = captureChat('Ça va, et toi ?');
    const history: CompanionHistoryTurn[] = [
      { role: 'user', content: 'Envoie-moi une photo de toi' },
      { role: 'assistant', content: 'Hop. Photo de moi.', kind: 'selfie' },
    ];
    const result = await runCompanionTurn('Coucou', {
      surface: 'mobile',
      history,
      env: { CODEBUDDY_COMPANION_PERSONA: 'copine' } as NodeJS.ProcessEnv,
      chat,
      resolveProvider: () => ({ apiKey: 'k', baseUrl: 'http://127.0.0.1:4199/v1', model: 'm' }),
      serveSelfie: async () => null,
    });
    expect(result.kind).toBe('text');
    expect(result.text).toBe('Ça va, et toi ?');
    const messages = seen[0] ?? [];
    expect(messages[0]?.role).toBe('system');
    // Structured roles, never a "Lisa: … / Toi: …" text blob.
    expect(messages.slice(1, -1).map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[messages.length - 1]).toMatchObject({ role: 'user', content: 'Coucou' });
    expect(JSON.stringify(messages)).not.toContain('kind');
  });

  it('states who is who in the system message reaching the model', async () => {
    const { chat, seen } = captureChat('Coucou toi.');
    await runCompanionTurn('Coucou 💕', {
      surface: 'mobile',
      history: [
        { role: 'user', content: 'Coucou' },
        { role: 'assistant', content: 'Coucou toi.' },
      ],
      env: {
        CODEBUDDY_COMPANION_PERSONA: 'copine',
        CODEBUDDY_ROBOT_NAME: 'Lisa',
      } as NodeJS.ProcessEnv,
      chat,
      resolveProvider: () => ({ apiKey: 'k', baseUrl: 'http://127.0.0.1:4199/v1', model: 'm' }),
      serveSelfie: async () => null,
    });
    const system = String(seen[0]?.[0]?.content ?? '');
    expect(system).toContain('TU es Lisa');
    expect(system).toMatch(/ne l['’]appelle jamais lisa/i);
    expect(system).toContain('la personne que tu aimes');
    expect(system).not.toMatch(/comment puis-je (?:t['’]|vous )aider/i);
    expect(seen[0]?.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('speaks the honest provider failure instead of a generic apology', async () => {
    const chat = vi.fn(async () => {
      throw new Error('429 usage_limit_reached: resets_in_seconds=120');
    });
    const result = await runCompanionTurn('Coucou', {
      surface: 'mobile',
      env: { CODEBUDDY_COMPANION_PERSONA: 'copine' } as NodeJS.ProcessEnv,
      chat: chat as never,
      resolveProvider: () => ({ apiKey: 'k', baseUrl: 'http://127.0.0.1:4199/v1', model: 'm' }),
      serveSelfie: async () => null,
    });
    expect(result.kind).toBe('text');
    expect(result.text.toLowerCase()).toContain('quota');
  });

  it('speaks honestly when no provider is configured (never a silent empty reply)', async () => {
    const result = await runCompanionTurn('Coucou', {
      surface: 'mobile',
      env: {} as NodeJS.ProcessEnv,
      resolveProvider: () => null,
      serveSelfie: async () => null,
    });
    expect(result.kind).toBe('text');
    expect(result.text.trim().length).toBeGreaterThan(0);
  });
});
