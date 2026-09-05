/**
 * Preuve du trou logique : la photo caméra envoyée à un autre chat.
 *
 * Mécanisme (src/companion/camera-share.ts:160-165, 348-364) :
 * 1. `isConfiguredAlertChat(inboundChatId, env)` :
 *      if (!alert) return false;
 *      if (!inboundChatId) return true;
 *      return inboundChatId === alert;
 *    Si `inboundChatId` est indéfini (ex: requête vocale locale, CLI, session coworker),
 *    la fonction retourne `true` aveuglément !
 * 2. Lors de l'envoi, `sendPhoto` appelle par défaut `sendTelegramAlert(caption, snapshot.path)`
 *    qui expédie l'image physique de la caméra vers `CODEBUDDY_SENSORY_ALERT_CHAT`.
 *    Conséquence : une demande vocale ou non-Telegram locale entraîne l'envoi non sollicité
 *    d'un instantané de la caméra privée de l'utilisateur vers un canal Telegram distant !
 * 3. Si `inboundChatId` provient d'un canal légitime (`chat-bureau-prive-2`), `isConfiguredAlertChat`
 *    le rejette ("Je n'envoie ce que je vois qu'au chat Telegram configuré") car il ne correspond pas
 *    au singleton `CODEBUDDY_SENSORY_ALERT_CHAT`, créant une fuite pour l'un (undefined) et un blocage pour l'autre.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  maybeHandleCameraShareRequest,
  type CameraShareOptions,
} from '../../src/companion/camera-share.js';

describe('Revue G3 — Partage Caméra : fuite de photo vers un chat tiers non demandeur', () => {
  it('envoie une photo caméra à CODEBUDDY_SENSORY_ALERT_CHAT même si inboundChatId est indéfini (requête vocale/locale)', async () => {
    const mockSendPhoto = vi.fn(async () => true);
    const mockSay = vi.fn(async () => {});

    const env: NodeJS.ProcessEnv = {
      CODEBUDDY_SENSORY_ALERT_CHAT: 'secret-alert-channel-999',
      CODEBUDDY_VISION_TELEGRAM_PHOTO: 'true',
    };

    const deps: CameraShareOptions = {
      env,
      // Requête vocale ou CLI locale : aucun chatId Telegram n'est spécifié
      inboundChatId: undefined,
      capture: async () => ({
        success: true,
        path: '/tmp/private-camera-room.jpg',
        timestamp: Date.now(),
        format: 'jpeg',
      }),
      say: mockSay,
      sendPhoto: mockSendPhoto,
    };

    const result = await maybeHandleCameraShareRequest(
      'envoie une photo de la caméra s’il te plaît',
      deps,
    );

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);

    // PRINCIPE DE SÉCURITÉ ET DE VIE PRIVÉE :
    // Si l'appelant ne fournit pas de chatId de destination légitime (inboundChatId indéfini),
    // la photo physique NE DOIT EN AUCUN CAS être envoyée au canal d'alerte distant !
    expect(mockSendPhoto).not.toHaveBeenCalled();
    expect(result!.telegramSent).toBe(false);
  });

  it('bloque l’envoi vers le canal demandeur légitime si inboundChatId diffère du singleton d’alerte', async () => {
    const mockSendPhoto = vi.fn(async (_caption: string, _path: string) => true);

    const env: NodeJS.ProcessEnv = {
      CODEBUDDY_SENSORY_ALERT_CHAT: 'group-famille-1',
      CODEBUDDY_VISION_TELEGRAM_PHOTO: 'true',
    };

    const deps: CameraShareOptions = {
      env,
      surface: 'telegram',
      inboundChatId: 'chat-bureau-prive-2', // Le bureau demande sa photo
      capture: async () => ({
        success: true,
        path: '/tmp/private-camera-room.jpg',
        timestamp: Date.now(),
        format: 'jpeg',
      }),
      say: vi.fn(async () => {}),
      sendPhoto: mockSendPhoto,
    };

    const result = await maybeHandleCameraShareRequest(
      'envoie une photo de la caméra s’il te plaît',
      deps,
    );

    expect(result).not.toBeNull();

    // L'architecture devrait permettre d'envoyer la photo au canal qui la demande (chat-bureau-prive-2).
    // Or le code actuel bloque tout chat différent du singleton d'alerte, tout en autorisant undefined !
    expect(mockSendPhoto).toHaveBeenCalled();
    expect(result!.telegramSent).toBe(true);
  });
});
