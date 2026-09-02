import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  cameraShareCooldownRemainingMs,
  findRecentEyeKeyframe,
  isCameraShareRequest,
  isCameraShareTelegramSendRequest,
  maybeHandleCameraShareRequest,
  resetCameraShareCooldown,
} from '../../src/companion/camera-share.js';

const ALERT_CHAT = '424242';
const OTHER_CHAT = '999999';

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    CODEBUDDY_VISION_MODEL: 'moondream',
    CODEBUDDY_VISION_BASE_URL: 'http://127.0.0.1:11434/v1',
    CODEBUDDY_VISION_REMOTE_IMAGE: 'false',
    CODEBUDDY_VISION_TELEGRAM_PHOTO: 'true',
    CODEBUDDY_SENSORY_ALERT_TOKEN: 'tok',
    CODEBUDDY_SENSORY_ALERT_CHAT: ALERT_CHAT,
    ...overrides,
  } as NodeJS.ProcessEnv;
}

async function fakeFrame(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-camera-share-'));
  const file = path.join(dir, 'frame.jpg');
  await fs.writeFile(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return file;
}

describe('camera-share intent', () => {
  it('détecte les demandes FR de scène / caméra', () => {
    const phrases = [
      "qu'est-ce que tu vois ?",
      "Qu'est ce que tu vois",
      'que vois-tu',
      'montre-moi la caméra',
      'montre moi la webcam',
      'montre-moi la pièce',
      'montre-moi ce que tu vois',
      'regarde',
      'Lisa, regarde un peu',
      'regarde la caméra',
      'regarde autour',
      'envoie-moi une photo de la pièce',
      'envoie ce que tu vois',
      'what do you see',
      'show me the camera',
    ];
    for (const phrase of phrases) {
      expect(isCameraShareRequest(phrase), phrase).toBe(true);
    }
  });

  it('ne vole pas le selfie, le figuré, ni le grounding d’un objet nommé', () => {
    const phrases = [
      'Lisa, envoie-moi une photo de toi',
      'fais un selfie',
      'tu vois ce que je veux dire',
      'tu vois bien que ce raisonnement est faux',
      'regarde les actualités',
      'regarde la météo',
      'regarde le code',
      'tu vois le bug dans ce fichier',
      "tu vois le hamburger que j'ai préparé",
      'regarde mon tournevis',
      'regarde le livre que je te montre',
      'bonjour lisa',
      'montre-moi une image de chat',
    ];
    for (const phrase of phrases) {
      expect(isCameraShareRequest(phrase), phrase).toBe(false);
    }
  });

  it('réserve l’envoi Telegram voix aux demandes explicites', () => {
    expect(isCameraShareTelegramSendRequest("qu'est-ce que tu vois ?")).toBe(false);
    expect(isCameraShareTelegramSendRequest('regarde')).toBe(false);
    expect(isCameraShareTelegramSendRequest('montre-moi la caméra')).toBe(false);
    expect(isCameraShareTelegramSendRequest('envoie-la sur Telegram')).toBe(true);
    expect(isCameraShareTelegramSendRequest('envoie-moi une photo de la pièce')).toBe(true);
    expect(isCameraShareTelegramSendRequest('regarde et envoie-la sur telegram')).toBe(true);
    expect(isCameraShareTelegramSendRequest('envoie ce que tu vois')).toBe(true);
  });
});

describe('camera-share — capture factice + faux Telegram', () => {
  beforeEach(() => {
    resetCameraShareCooldown();
  });

  afterEach(() => {
    resetCameraShareCooldown();
  });

  it('maybeHandle ignore le bavardage', async () => {
    const capture = vi.fn();
    const result = await maybeHandleCameraShareRequest('bonjour lisa', {
      capture,
      env: env(),
    });
    expect(result).toBeNull();
    expect(capture).not.toHaveBeenCalled();
  });

  it('envoie la photo Telegram + la description locale quand le drapeau est on', async () => {
    const frame = await fakeFrame();
    const sendPhoto = vi.fn(async () => true);
    const analyze = vi.fn(async () => 'Un bureau avec un écran allumé.');
    const result = await maybeHandleCameraShareRequest("qu'est-ce que tu vois ?", {
      surface: 'telegram',
      inboundChatId: ALERT_CHAT,
      env: env(),
      capture: async () => ({ success: true, path: frame }),
      analyze,
      sendPhoto,
    });
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.telegramSent).toBe(true);
    expect(result!.description).toContain('bureau');
    expect(result!.spokenReply).toContain('bureau');
    expect(sendPhoto).toHaveBeenCalledOnce();
    const [caption, imagePath] = sendPhoto.mock.calls[0]!;
    expect(imagePath).toBe(frame);
    expect(caption).toContain('bureau');
    expect(analyze).toHaveBeenCalledWith(frame);
    await fs.rm(path.dirname(frame), { recursive: true, force: true });
  });

  it('sans drapeau photo : description seule et dit que l’envoi est désactivé', async () => {
    const frame = await fakeFrame();
    const sendPhoto = vi.fn(async () => true);
    const result = await maybeHandleCameraShareRequest('montre-moi la caméra', {
      surface: 'telegram',
      inboundChatId: ALERT_CHAT,
      env: env({ CODEBUDDY_VISION_TELEGRAM_PHOTO: 'false' }),
      capture: async () => ({ success: true, path: frame }),
      analyze: async () => 'La pièce est calme.',
      sendPhoto,
    });
    expect(result!.success).toBe(true);
    expect(result!.telegramSent).toBe(false);
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(result!.spokenReply).toMatch(/pièce|piece/i);
    expect(result!.spokenReply.toLowerCase()).toContain("l'envoi de photo est désactivé");
    await fs.rm(path.dirname(frame), { recursive: true, force: true });
  });

  it('refuse d’envoyer vers un autre chat que CODEBUDDY_SENSORY_ALERT_CHAT', async () => {
    const frame = await fakeFrame();
    const result = await maybeHandleCameraShareRequest('envoie-moi une photo de la pièce', {
      surface: 'telegram',
      inboundChatId: OTHER_CHAT,
      env: env(),
      capture: async () => ({ success: true, path: frame }),
      analyze: async () => 'Un salon.',
    });
    expect(result!.telegramSent).toBe(false);
    expect(result!.spokenReply).toBeTruthy();
    await fs.rm(path.dirname(frame), { recursive: true, force: true });
  });

  it('dit honnêtement qu’il n’y a pas d’image si la caméra factice échoue', async () => {
    const sendPhoto = vi.fn(async () => true);
    const analyze = vi.fn();
    const result = await maybeHandleCameraShareRequest('regarde', {
      surface: 'telegram',
      inboundChatId: ALERT_CHAT,
      env: env(),
      capture: async () => ({ success: false, error: 'no device' }),
      analyze,
      sendPhoto,
    });
    expect(result!.success).toBe(false);
    expect(result!.telegramSent).toBe(false);
    expect(result!.spokenReply.toLowerCase()).toContain("je n'ai pas d'image en ce moment");
    expect(analyze).not.toHaveBeenCalled();
    expect(sendPhoto).not.toHaveBeenCalled();
  });

  it('n’envoie pas l’image à un VLM distant (CODEBUDDY_VISION_REMOTE_IMAGE=false)', async () => {
    const frame = await fakeFrame();
    const analyze = vi.fn(async () => 'ne doit pas tourner');
    const sendPhoto = vi.fn(async () => true);
    const result = await maybeHandleCameraShareRequest("qu'est-ce que tu vois ?", {
      surface: 'telegram',
      inboundChatId: ALERT_CHAT,
      env: env({
        CODEBUDDY_VISION_BASE_URL: 'https://vision.example.test/v1',
        CODEBUDDY_VISION_REMOTE_IMAGE: 'false',
      }),
      capture: async () => ({ success: true, path: frame }),
      analyze,
      sendPhoto,
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(result!.telegramSent).toBe(true);
    expect(sendPhoto).toHaveBeenCalledOnce();
    await fs.rm(path.dirname(frame), { recursive: true, force: true });
  });

  it('sur la voix, ne joint pas la photo sans demande d’envoi explicite', async () => {
    const frame = await fakeFrame();
    const sendPhoto = vi.fn(async () => true);
    const result = await maybeHandleCameraShareRequest("qu'est-ce que tu vois ?", {
      surface: 'voice',
      env: env(),
      capture: async () => ({ success: true, path: frame }),
      analyze: async () => 'Un canapé beige.',
      sendPhoto,
    });
    expect(result!.telegramSent).toBe(false);
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(result!.spokenReply).toContain('canapé');
    await fs.rm(path.dirname(frame), { recursive: true, force: true });
  });

  it('sur la voix, ne joint pas la photo sans chat Telegram demandeur', async () => {
    const frame = await fakeFrame();
    const sendPhoto = vi.fn(async () => true);
    const result = await maybeHandleCameraShareRequest(
      'regarde et envoie-la sur Telegram',
      {
        surface: 'voice',
        env: env(),
        capture: async () => ({ success: true, path: frame }),
        analyze: async () => 'La cuisine.',
        sendPhoto,
      },
    );
    expect(result!.telegramSent).toBe(false);
    expect(sendPhoto).not.toHaveBeenCalled();
    await fs.rm(path.dirname(frame), { recursive: true, force: true });
  });

  it('plafonne un envoi toutes les 10 s', async () => {
    const frame = await fakeFrame();
    const sendPhoto = vi.fn(async () => true);
    let now = 1_000_000;
    const shared = {
      surface: 'telegram' as const,
      inboundChatId: ALERT_CHAT,
      env: env(),
      capture: async () => ({ success: true, path: frame }),
      analyze: async () => 'Même pièce.',
      sendPhoto,
      now: () => new Date(now),
    };
    const first = await maybeHandleCameraShareRequest("qu'est-ce que tu vois ?", shared);
    expect(first!.telegramSent).toBe(true);
    now += 3_000;
    const second = await maybeHandleCameraShareRequest("qu'est-ce que tu vois ?", shared);
    expect(second!.telegramSent).toBe(false);
    expect(sendPhoto).toHaveBeenCalledOnce();
    expect(cameraShareCooldownRemainingMs(now, env())).toBeGreaterThan(0);
    now += 8_000;
    const third = await maybeHandleCameraShareRequest("qu'est-ce que tu vois ?", shared);
    expect(third!.telegramSent).toBe(true);
    expect(sendPhoto).toHaveBeenCalledTimes(2);
    await fs.rm(path.dirname(frame), { recursive: true, force: true });
  });

  it('relit l’image-clé récente de l’œil et n’ouvre pas la webcam', async () => {
    const spool = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-eye-spool-'));
    const frame = path.join(spool, 'motion-03.jpg');
    await fs.writeFile(frame, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const capture = vi.fn();
    const sendPhoto = vi.fn(async () => true);
    const result = await maybeHandleCameraShareRequest("qu'est-ce que tu vois ?", {
      surface: 'telegram',
      inboundChatId: ALERT_CHAT,
      env: env({ BUDDY_SENSE_FRAME_DIR: spool }),
      analyze: async (imagePath) => {
        expect(imagePath).toContain('motion-03.jpg');
        return 'Le salon vu par l’œil.';
      },
      sendPhoto,
    });
    expect(capture).not.toHaveBeenCalled();
    expect(result!.success).toBe(true);
    expect(result!.telegramSent).toBe(true);
    expect(result!.spokenReply).toContain('salon');
    expect(sendPhoto.mock.calls[0]?.[1]).toContain('motion-03.jpg');
    await fs.rm(spool, { recursive: true, force: true });
  });

  it('ignore une image-clé trop vieille et dit qu’il n’y a pas d’image', async () => {
    const spool = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-eye-stale-'));
    const frame = path.join(spool, 'semantic-001.jpg');
    await fs.writeFile(frame, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const stale = Date.now() - 120_000;
    await fs.utimes(frame, new Date(stale), new Date(stale));
    const found = await findRecentEyeKeyframe({
      env: { BUDDY_SENSE_FRAME_DIR: spool } as NodeJS.ProcessEnv,
      maxAgeMs: 30_000,
    });
    expect(found).toBeUndefined();
    const result = await maybeHandleCameraShareRequest('regarde', {
      surface: 'telegram',
      inboundChatId: ALERT_CHAT,
      env: env({
        BUDDY_SENSE_FRAME_DIR: spool,
        CODEBUDDY_CAMERA_SHARE_MAX_AGE_MS: '30000',
      }),
      analyze: vi.fn(),
      sendPhoto: vi.fn(async () => true),
    });
    expect(result!.success).toBe(false);
    expect(result!.spokenReply.toLowerCase()).toContain("je n'ai pas d'image en ce moment");
    await fs.rm(spool, { recursive: true, force: true });
  });

  it('l’envoi par défaut passe par sendTelegramAlert (chat d’alerte), jamais un autre destinataire', async () => {
    const frame = await fakeFrame();
    const alert = await import('../../src/sensory/alert.js');
    const spy = vi.spyOn(alert, 'sendTelegramAlert').mockResolvedValue(true);
    try {
      const result = await maybeHandleCameraShareRequest('montre-moi la caméra', {
        surface: 'telegram',
        inboundChatId: ALERT_CHAT,
        env: env(),
        capture: async () => ({ success: true, path: frame }),
        analyze: async () => 'Un couloir.',
      });
      expect(result!.telegramSent).toBe(true);
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0]?.[1]).toBe(frame);
    } finally {
      spy.mockRestore();
      await fs.rm(path.dirname(frame), { recursive: true, force: true });
    }
  });
});
