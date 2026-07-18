import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  buildLisaSelfiePrompt,
  createAndMaybeSendLisaSelfie,
  inferSelfieMood,
  isLisaSelfieRequest,
  maybeHandleLisaSelfieRequest,
  resetLisaSelfieCooldown,
  resolveLisaContentTier,
  selfieCooldownRemainingMs,
} from '../../src/companion/lisa-selfie.js';

describe('lisa-selfie', () => {
  beforeEach(() => {
    resetLisaSelfieCooldown();
  });

  it('detects selfie / photo-of-you requests', () => {
    expect(isLisaSelfieRequest('Lisa, envoie-moi une photo de toi')).toBe(true);
    expect(isLisaSelfieRequest('fais un selfie et envoie sur telegram')).toBe(true);
    expect(isLisaSelfieRequest('envoie ta photo sur mon téléphone')).toBe(true);
    expect(isLisaSelfieRequest('regarde la photo que je te montre')).toBe(false);
    expect(isLisaSelfieRequest('bonjour lisa')).toBe(false);
  });

  it('infers mood from wording', () => {
    expect(inferSelfieMood('un selfie espiègle')).toBe('playful');
    expect(inferSelfieMood('photo tendre mon amour')).toBe('tender');
    expect(inferSelfieMood('portrait simple')).toBe('portrait');
  });

  it('allows request-level tiers while keeping explicit fail-closed', () => {
    expect(resolveLisaContentTier({}, 'sensual')).toBe('sensual');
    expect(resolveLisaContentTier({}, 'explicit')).toBe('safe');
    expect(resolveLisaContentTier({ CODEBUDDY_ADULT_CONTENT_ENABLED: 'true' }, 'explicit'))
      .toBe('explicit');
  });

  it('builds prompt with trigger first', () => {
    const p = buildLisaSelfiePrompt({
      trigger: 'ohwx lisa',
      mood: 'playful',
      userName: 'Patrice',
    });
    expect(p.startsWith('ohwx lisa')).toBe(true);
    expect(p).toMatch(/playful|mischievous/i);
    expect(p).toContain('Patrice');
  });

  it('generates, archives, and sends telegram', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-selfie-'));
    const fakeImg = path.join(root, 'out.png');
    await fs.writeFile(fakeImg, Buffer.from([1, 2, 3, 4]));
    const sendPhoto = vi.fn(async () => true);
    const result = await createAndMaybeSendLisaSelfie({
      mood: 'tender',
      rootDir: root,
      env: {
        CODEBUDDY_SENSORY_ALERT_TOKEN: 't',
        CODEBUDDY_SENSORY_ALERT_CHAT: '1',
      } as NodeJS.ProcessEnv,
      generate: async () => ({ success: true, outputPath: fakeImg }),
      sendPhoto,
    });
    expect(result.success).toBe(true);
    expect(result.telegramSent).toBe(true);
    expect(sendPhoto).toHaveBeenCalled();
    expect(result.spokenReply).toMatch(/Telegram|photo/i);
    expect(result.imagePath).toBeTruthy();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('uses a pre-generated style image without calling the live generator', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-selfie-cache-'));
    const cacheDir = path.join(root, 'cache');
    const styleDir = path.join(cacheDir, 'tender');
    await fs.mkdir(styleDir, { recursive: true });
    await fs.writeFile(path.join(styleDir, 'tender-001.png'), Buffer.from([1, 2, 3]));
    const generate = vi.fn(async () => ({ success: false, error: 'must not run' }));

    const result = await createAndMaybeSendLisaSelfie({
      mood: 'tender',
      rootDir: root,
      env: { CODEBUDDY_LISA_SELFIE_CACHE_DIR: cacheDir } as NodeJS.ProcessEnv,
      generate,
      sendTelegram: false,
      force: true,
    });

    expect(result.success).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    expect(result.imagePath).toBeTruthy();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects an explicit request when the verified adult gate is disabled', async () => {
    const generate = vi.fn(async () => ({ success: false, error: 'must not run' }));
    const result = await createAndMaybeSendLisaSelfie({
      contentTier: 'explicit',
      env: { CODEBUDDY_ADULT_CONTENT_ENABLED: 'false' },
      generate,
      force: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/verified adult-content gate/i);
    expect(generate).not.toHaveBeenCalled();
  });

  it('maybeHandle returns null for non-selfie speech', async () => {
    const r = await maybeHandleLisaSelfieRequest('bonjour lisa');
    expect(r).toBeNull();
  });

  it('maybeHandle runs for selfie speech', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-selfie2-'));
    const fakeImg = path.join(root, 'x.png');
    await fs.writeFile(fakeImg, Buffer.from([9]));
    const r = await maybeHandleLisaSelfieRequest('Lisa envoie une photo de toi', {
      rootDir: root,
      generate: async () => ({ success: true, outputPath: fakeImg }),
      sendPhoto: async () => false,
      sendTelegram: true,
      env: {} as NodeJS.ProcessEnv,
      force: true,
    });
    expect(r?.success).toBe(true);
    expect(r?.telegramSent).toBe(false);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('selfie intent → tool path (mock): spoken phrases map to maybeHandle tool result', async () => {
    // B5: deterministic hybrid intent → lisa_selfie tool chain (no real image gen).
    const phrases = [
      'envoie-moi un selfie',
      'fais une photo de toi mon amour',
      'Lisa send me a selfie on telegram',
    ];
    for (const phrase of phrases) {
      expect(isLisaSelfieRequest(phrase), phrase).toBe(true);
    }
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-selfie-b5-'));
    const fakeImg = path.join(root, 'tool.png');
    await fs.writeFile(fakeImg, Buffer.from([4, 5, 6]));
    const generate = vi.fn(async () => ({ success: true, outputPath: fakeImg }));
    const r = await maybeHandleLisaSelfieRequest(phrases[0]!, {
      rootDir: root,
      generate,
      sendTelegram: false,
      force: true,
    });
    expect(generate).toHaveBeenCalledOnce();
    expect(r).not.toBeNull();
    expect(r!.success).toBe(true);
    expect(r!.spokenReply.length).toBeGreaterThan(5);
    // Non-selfie never calls the tool
    const skip = await maybeHandleLisaSelfieRequest('explique la photosynthèse', {
      rootDir: root,
      generate,
      force: true,
    });
    expect(skip).toBeNull();
    expect(generate).toHaveBeenCalledOnce();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('enforces cooldown between selfies', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-selfie3-'));
    const fakeImg = path.join(root, 'y.png');
    await fs.writeFile(fakeImg, Buffer.from([1]));
    const env = { CODEBUDDY_LISA_SELFIE_COOLDOWN_MS: '60000' } as NodeJS.ProcessEnv;
    const first = await createAndMaybeSendLisaSelfie({
      rootDir: root,
      env,
      generate: async () => ({ success: true, outputPath: fakeImg }),
      sendTelegram: false,
      force: false,
    });
    expect(first.success).toBe(true);
    expect(selfieCooldownRemainingMs(Date.now(), env)).toBeGreaterThan(0);
    const second = await createAndMaybeSendLisaSelfie({
      rootDir: root,
      env,
      generate: async () => ({ success: true, outputPath: fakeImg }),
      sendTelegram: false,
      force: false,
    });
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/cooldown/i);
    await fs.rm(root, { recursive: true, force: true });
  });
});
