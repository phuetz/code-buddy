import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MEETING_LIVE_CHANNELS, MEETING_LIVE_CONSENT_STATEMENT } from '../src/shared/meeting-live';

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const syncHandlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    syncHandlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      syncHandlers.set(channel, handler);
    }),
  };
});

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/private-user-data') },
  ipcMain: { handle: electronMock.handle, on: electronMock.on },
}));

import { registerMeetingLiveIpcHandlers } from '../src/main/ipc/meeting-live-ipc';
import type { MeetingLiveService } from '../src/main/meeting/meeting-live-service';

function call<T>(channel: string, input?: unknown): Promise<T> {
  const handler = electronMock.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return Promise.resolve(handler({}, input) as T);
}

describe('Meeting Live IPC', () => {
  const session = {
    schemaVersion: 1 as const,
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Point équipe',
    language: 'fr',
    source: 'microphone' as const,
    status: 'recording' as const,
    localOnly: true as const,
    remoteEgress: false as const,
    createdAt: '2026-07-12T10:00:00.000Z',
    updatedAt: '2026-07-12T10:00:00.000Z',
    consentEvents: [],
    segments: [],
    totalBytes: 0,
    durationMs: 0,
  };
  const service = {
    diarizationCapability: vi.fn(async () => ({
      available: true,
      provider: 'sherpa-onnx' as const,
      reason: 'Sherpa local prêt.',
    })),
    list: vi.fn(async () => [session]),
    start: vi.fn(async () => session),
    appendSegment: vi.fn(async () => session),
    pause: vi.fn(async () => ({ ...session, status: 'paused' as const })),
    resume: vi.fn(async () => session),
    finalize: vi.fn(async () => ({ ...session, status: 'completed' as const })),
    discard: vi.fn(async () => true),
  };
  const webContents = { id: 7 };
  const mainWindow = {
    isDestroyed: () => false,
    webContents,
  };
  const displayAudioBroker = {
    capability: vi.fn(() => ({
      state: 'unavailable' as const,
      reason: 'Indisponible dans ce fixture.',
    })),
    arm: vi.fn(() => ({ ok: false, state: 'unavailable' as const })),
    release: vi.fn(() => ({ ok: true as const })),
  };

  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.syncHandlers.clear();
    electronMock.handle.mockClear();
    electronMock.on.mockClear();
    vi.clearAllMocks();
    registerMeetingLiveIpcHandlers({
      service: service as unknown as MeetingLiveService,
      displayAudioBroker: displayAudioBroker as never,
      getMainWindow: () => mainWindow as never,
    });
  });

  it('registers the complete capture, recovery, finalization, and privacy surface', () => {
    expect([
      ...electronMock.handlers.keys(),
      ...electronMock.syncHandlers.keys(),
    ]).toEqual(expect.arrayContaining(Object.values(MEETING_LIVE_CHANNELS)));
  });

  it('reports runtime-probed capabilities without claiming Linux shared audio', async () => {
    const result = await call<{
      ok: boolean;
      capabilities: {
        sharedAudio: { state: string };
        diarization: { state: string; provider: string };
      };
    }>(MEETING_LIVE_CHANNELS.capabilities);

    expect(result).toMatchObject({
      ok: true,
      capabilities: {
        sharedAudio: { state: 'unavailable' },
        diarization: { state: 'available', provider: 'sherpa-onnx' },
      },
    });
  });

  it('routes audio checkpoints without exposing a renderer-selected filesystem path', async () => {
    const input = {
      sessionId: session.id,
      sequence: 1,
      captureId: 'capture-one',
      mimeType: 'audio/webm',
      bytes: Uint8Array.from([1, 2]),
      startOffsetMs: 0,
      durationMs: 10_000,
      path: '/tmp/attacker-chosen.webm',
    };

    const result = await call<{ ok: boolean }>(MEETING_LIVE_CHANNELS.appendSegment, input);

    expect(result.ok).toBe(true);
    expect(service.appendSegment).toHaveBeenCalledWith(input);
    expect(Object.values(MEETING_LIVE_CHANNELS).some((channel) => channel.includes('export'))).toBe(false);
  });

  it('releases a PipeWire lease only for the canonical renderer', async () => {
    const handler = electronMock.handlers.get(MEETING_LIVE_CHANNELS.releaseSharedAudio)!;

    await expect(handler({ sender: webContents }, { leaseId: 'lease-one' })).resolves.toEqual({
      ok: true,
    });
    expect(displayAudioBroker.release).toHaveBeenCalledWith('lease-one');

    await expect(handler({ sender: { id: 99 } }, { leaseId: 'lease-two' })).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/fenêtre principale/i),
    });
    expect(displayAudioBroker.release).not.toHaveBeenCalledWith('lease-two');
  });

  it('returns bounded failures instead of rejected IPC calls', async () => {
    service.start.mockRejectedValueOnce(new Error('Consent missing'));
    const result = await call<{ ok: boolean; error?: string }>(MEETING_LIVE_CHANNELS.start, {
      title: 'Test',
      consent: { accepted: false, statement: MEETING_LIVE_CONSENT_STATEMENT },
    });

    expect(result).toEqual({ ok: false, error: 'Consent missing', session: null });
    await expect(call(MEETING_LIVE_CHANNELS.finalize)).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/payload is required/i),
    });
  });
});
