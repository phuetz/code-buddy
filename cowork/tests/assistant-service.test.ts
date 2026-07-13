import { describe, expect, it, vi } from 'vitest';
import { AssistantService } from '../src/main/assistant/assistant-service.js';

describe('AssistantService.playPreview', () => {
  it('returns success only after the core confirms playback', async () => {
    const playVoicePreview = vi.fn(async () => ({
      path: '/tmp/estelle-preview.wav',
      played: true,
    }));
    const service = new AssistantService(async () => ({ playVoicePreview }));

    await expect(service.playPreview(' estelle ', ' Bonjour ')).resolves.toEqual({
      ok: true,
      path: '/tmp/estelle-preview.wav',
    });
    expect(playVoicePreview).toHaveBeenCalledWith('estelle', 'Bonjour');
  });

  it('returns an actionable error when no system player can play the WAV', async () => {
    const service = new AssistantService(async () => ({
      playVoicePreview: vi.fn(async () => ({
        path: '/tmp/estelle-preview.wav',
        played: false,
      })),
    }));

    await expect(service.playPreview('estelle')).resolves.toEqual({
      ok: false,
      error: 'aucun lecteur audio système disponible pour lire l\'aperçu',
    });
  });
});
