/**
 * Receiving a photo IS a companion turn — the same single path as text, with
 * the image in it. The two properties that matter here: a turn without an
 * attachment must be byte-identical to what it was, and a turn with one must
 * carry the photo to the model in exactly the way the privacy posture allows.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { runCompanionTurn } from '../../src/companion/companion-turn.js';
import { listSharedPhotos } from '../../src/companion/shared-photos.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let albumDir = '';

beforeEach(() => {
  albumDir = mkdtempSync(path.join(tmpdir(), 'cb-turn-album-'));
});

afterEach(() => {
  rmSync(albumDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function captureChat(reply = 'Oh ce ciel orange, tu étais où ?') {
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

const baseOptions = (extra: Record<string, unknown> = {}) => ({
  surface: 'mobile' as const,
  env: {
    CODEBUDDY_COMPANION_PERSONA: 'copine',
    CODEBUDDY_CHANNEL_PROFILE: 'companion',
    CODEBUDDY_LISA_SELFIE: 'false',
    CODEBUDDY_ROBOT_NAME: 'Lisa',
  } as NodeJS.ProcessEnv,
  resolveProvider: () => ({ apiKey: 'k', baseUrl: 'http://127.0.0.1:4699/v1', model: 'm' }),
  rememberPhotos: async () => [],
  ...extra,
});

describe('a companion turn without a photo', () => {
  it('is byte-identical: no photo guidance, no image part, no album write', async () => {
    const { chat, seen } = captureChat();
    const remember = vi.fn(async () => []);
    const result = await runCompanionTurn('coucou toi', {
      ...baseOptions({ rememberPhotos: remember }),
      chat,
    });

    expect(result.kind).toBe('text');
    expect(result.photos).toBeUndefined();
    expect(remember).not.toHaveBeenCalled();
    const system = String(seen[0]![0]!.content ?? '');
    expect(system).not.toContain('photo_partagee');
    expect(typeof seen[0]![seen[0]!.length - 1]!.content).toBe('string');
  });
});

describe('a companion turn with a photo — local posture', () => {
  it('injects the description in the message and never sends bytes to the model', async () => {
    const { chat, seen } = captureChat();
    const result = await runCompanionTurn('regarde ce que j’ai vu aujourd’hui', {
      ...baseOptions(),
      env: {
        ...baseOptions().env,
        CODEBUDDY_COMPANION_PHOTO_VISION: 'local',
      } as NodeJS.ProcessEnv,
      attachments: [{ bytes: PNG_1X1 }],
      preparePhotos: async (attachments, options) => {
        const { prepareCompanionPhotos } = await import('../../src/companion/companion-photo.js');
        return prepareCompanionPhotos(attachments, {
          ...options,
          describe: async () => ['un ciel orange au-dessus d’un lac, un chien au premier plan'],
        });
      },
      chat,
    });

    expect(result.photos).toMatchObject({ mode: 'local', accepted: 1 });
    const messages = seen[0]!;
    const system = String(messages[0]!.content ?? '');
    expect(system).toContain('<photo_partagee>');
    const user = messages[messages.length - 1]!;
    expect(typeof user.content).toBe('string');
    expect(String(user.content)).toContain('[Photo envoyée : un ciel orange');
    // The hard guarantee: no image bytes anywhere in the request.
    expect(JSON.stringify(messages)).not.toContain('base64');
    expect(JSON.stringify(messages)).not.toContain(PNG_1X1.toString('base64'));
  });
});

describe('a companion turn with a photo — cloud posture', () => {
  it('carries the image as a part on the user message', async () => {
    const { chat, seen } = captureChat();
    const result = await runCompanionTurn('regarde', {
      ...baseOptions(),
      env: {
        ...baseOptions().env,
        CODEBUDDY_COMPANION_PHOTO_VISION: 'cloud',
      } as NodeJS.ProcessEnv,
      attachments: [{ bytes: PNG_1X1 }],
      chat,
    });

    expect(result.photos).toMatchObject({ mode: 'cloud', accepted: 1 });
    const messages = seen[0]!;
    const parts = messages[messages.length - 1]!.content as unknown as Array<Record<string, unknown>>;
    expect(Array.isArray(parts)).toBe(true);
    expect(parts.some((part) => part.type === 'image_url')).toBe(true);
  });

  it('retries once locally when the model claims it cannot see images', async () => {
    const replies = ['Désolée, je ne peux pas voir les images.', 'Ce lac est magnifique, tu y étais quand ?'];
    const seen: CodeBuddyMessage[][] = [];
    let call = 0;
    const chat = vi.fn(async (messages: CodeBuddyMessage[]) => {
      seen.push(messages);
      const content = replies[Math.min(call, replies.length - 1)]!;
      call += 1;
      return { choices: [{ message: { content, role: 'assistant' } }], model: 'm' } as never;
    });

    const result = await runCompanionTurn('regarde', {
      ...baseOptions(),
      env: {
        ...baseOptions().env,
        CODEBUDDY_COMPANION_PHOTO_VISION: 'cloud',
      } as NodeJS.ProcessEnv,
      attachments: [{ bytes: PNG_1X1 }],
      preparePhotos: async (attachments, options) => {
        const { prepareCompanionPhotos } = await import('../../src/companion/companion-photo.js');
        return prepareCompanionPhotos(attachments, {
          ...options,
          describe: async () => ['un lac au coucher du soleil'],
        });
      },
      chat,
    });

    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.text).toContain('lac');
    expect(result.photos!.mode).toBe('local');
    // The retry is text-only: the description replaced the image part.
    const retry = seen[1]!;
    expect(typeof retry[retry.length - 1]!.content).toBe('string');
    expect(String(retry[retry.length - 1]!.content)).toContain('[Photo envoyée :');
  });
});

describe('the shared album is written by the turn', () => {
  it('files the photo and reports what was stored', async () => {
    const { chat } = captureChat();
    const { rememberSharedPhotos } = await import('../../src/companion/shared-photo-memory.js');
    const result = await runCompanionTurn('regarde ce lac', {
      ...baseOptions(),
      env: {
        ...baseOptions().env,
        CODEBUDDY_COMPANION_PHOTO_VISION: 'local',
      } as NodeJS.ProcessEnv,
      attachments: [{ bytes: PNG_1X1 }],
      preparePhotos: async (attachments, options) => {
        const { prepareCompanionPhotos } = await import('../../src/companion/companion-photo.js');
        return prepareCompanionPhotos(attachments, {
          ...options,
          describe: async () => ['un lac au coucher du soleil'],
        });
      },
      rememberPhotos: (photos, options) =>
        rememberSharedPhotos(photos, { ...options, dir: albumDir, writeMemory: false }),
      chat,
    });

    expect(result.photos).toMatchObject({ stored: 1 });
    const album = await listSharedPhotos({ dir: albumDir });
    expect(album).toHaveLength(1);
    expect(album[0]!.descriptionLisa).toBe('un lac au coucher du soleil');
    expect(album[0]!.captionUser).toBe('regarde ce lac');
    expect(album[0]!.surface).toBe('mobile');
  });

  it('still answers when the album cannot be written', async () => {
    const { chat } = captureChat();
    const result = await runCompanionTurn('regarde', {
      ...baseOptions(),
      env: {
        ...baseOptions().env,
        CODEBUDDY_COMPANION_PHOTO_VISION: 'local',
      } as NodeJS.ProcessEnv,
      attachments: [{ bytes: PNG_1X1 }],
      rememberPhotos: async () => {
        throw new Error('disk full');
      },
      chat,
    });
    expect(result.text).toContain('ciel');
    expect(result.photos).toMatchObject({ stored: 0 });
  });
});

describe('a corrupted attachment', () => {
  it('does not break the turn — she still replies', async () => {
    const { chat, seen } = captureChat();
    const result = await runCompanionTurn('regarde', {
      ...baseOptions(),
      env: {
        ...baseOptions().env,
        CODEBUDDY_COMPANION_PHOTO_VISION: 'cloud',
      } as NodeJS.ProcessEnv,
      attachments: [{ data: Buffer.from('definitely not an image').toString('base64') }],
      chat,
    });
    expect(result.kind).toBe('text');
    expect(result.photos).toMatchObject({ accepted: 0 });
    expect(typeof seen[0]![seen[0]!.length - 1]!.content).toBe('string');
  });
});
