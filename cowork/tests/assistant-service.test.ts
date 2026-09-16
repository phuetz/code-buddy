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

describe('AssistantService.diagnostics', () => {
  it('returns the raw-free voice runtime snapshot', async () => {
    const snapshot = {
      version: 1 as const,
      updatedAt: '2026-07-15T12:00:00.000Z',
      phase: 'speaking',
      counters: {
        captured: 2,
        accepted: 1,
        spoken: 1,
        suppressed: 1,
        interrupted: 0,
        failed: 0,
      },
      recent: [],
    };
    const service = new AssistantService(async () => ({
      readAssistantVoiceDiagnostics: () => snapshot,
    }));

    await expect(service.diagnostics()).resolves.toEqual({ diagnostics: snapshot });
  });
});

describe('AssistantService Voicebox studio', () => {
  it('uses persisted assistant values for studio discovery', async () => {
    const probeVoiceboxStudio = vi.fn(async () => ({
      available: true,
      baseUrl: 'http://gpuNode:17493',
      profiles: [],
      models: [],
      languages: ['fr'],
      engine: 'qwen',
    }));
    const service = new AssistantService(
      async () => ({ readAssistantConfig: () => ({ CODEBUDDY_VOICEBOX_URL: 'http://gpuNode:17493' }) }),
      async () => ({ probeVoiceboxStudio })
    );

    await expect(service.voiceboxStudio()).resolves.toMatchObject({ available: true });
    expect(probeVoiceboxStudio).toHaveBeenCalledWith(expect.objectContaining({
      CODEBUDDY_VOICEBOX_URL: 'http://gpuNode:17493',
    }));
  });

  it('passes audio and explicit consent to the clone transaction', async () => {
    const createVoiceboxClone = vi.fn(async () => ({
      profile: { id: 'lisa', name: 'Lisa' },
      sample: { id: 'sample' },
    }));
    const service = new AssistantService(
      async () => ({ readAssistantConfig: () => ({}) }),
      async () => ({ createVoiceboxClone })
    );
    const audio = new Uint8Array([1, 2, 3]).buffer;

    await expect(service.createVoiceboxClone({
      name: 'Lisa',
      language: 'fr',
      referenceText: 'Bonjour.',
      filename: 'lisa.webm',
      audio,
      consent: true,
    })).resolves.toEqual({
      ok: true,
      profile: { id: 'lisa', name: 'Lisa' },
      sampleId: 'sample',
    });
    expect(createVoiceboxClone).toHaveBeenCalledWith(
      expect.objectContaining({ audio: expect.any(Uint8Array), consent: true }),
      expect.any(Object)
    );
  });

  it('creates preset voices, administers models, and returns bounded preview audio', async () => {
    const createVoiceboxPresetProfile = vi.fn(async () => ({
      id: 'preset-lisa',
      name: 'Lisa Siwis',
      voice_type: 'preset',
    }));
    const manageVoiceboxModel = vi.fn(async () => ({ message: 'download started' }));
    const renderVoiceboxWavBytes = vi.fn(async () => new Uint8Array([82, 73, 70, 70]));
    const service = new AssistantService(
      async () => ({ readAssistantConfig: () => ({ CODEBUDDY_VOICEBOX_ENGINE: 'qwen' }) }),
      async () => ({
        createVoiceboxPresetProfile,
        manageVoiceboxModel,
        renderVoiceboxWavBytes,
      })
    );

    await expect(service.createVoiceboxPresetProfile({
      name: 'Lisa Siwis',
      language: 'fr',
      engine: 'kokoro',
      voiceId: 'ff_siwis',
    })).resolves.toMatchObject({ ok: true, profile: { id: 'preset-lisa' } });
    await expect(service.manageVoiceboxModel({
      modelName: 'qwen-tts-1.7B',
      action: 'download',
    })).resolves.toEqual({ ok: true, message: 'download started' });
    await expect(service.previewVoiceboxProfile({
      profileId: 'preset-lisa',
      text: ' Bonjour Patrice. ',
      engine: 'qwen',
    })).resolves.toEqual({
      ok: true,
      audio: new Uint8Array([82, 73, 70, 70]),
      mimeType: 'audio/wav',
    });
    expect(renderVoiceboxWavBytes).toHaveBeenCalledWith(
      'Bonjour Patrice.',
      expect.objectContaining({
        CODEBUDDY_VOICEBOX_PROFILE: 'preset-lisa',
        CODEBUDDY_VOICEBOX_ENGINE: 'qwen',
      })
    );
  });
});
