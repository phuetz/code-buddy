// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeetingLiveView, pickMeetingRecorderMimeType } from '../src/renderer/components/MeetingLiveView';
import {
  MEETING_LIVE_CONSENT_STATEMENT,
  type MeetingLiveSessionView,
  type MeetingLiveSharedAudioArmResult,
} from '../src/shared/meeting-live';

const interrupted: MeetingLiveSessionView = {
  schemaVersion: 1,
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Réunion récupérée',
  language: 'fr',
  source: 'microphone',
  captureSources: ['microphone'],
  status: 'interrupted',
  localOnly: true,
  remoteEgress: false,
  createdAt: '2026-07-12T10:00:00.000Z',
  updatedAt: '2026-07-12T10:01:00.000Z',
  consentEvents: [{
    accepted: true,
    statement: MEETING_LIVE_CONSENT_STATEMENT,
    acceptedAt: '2026-07-12T10:00:00.000Z',
    reason: 'start',
    actor: 'local-user',
  }],
  segments: [{
    sequence: 1,
    captureId: 'capture-one',
    mimeType: 'audio/webm',
    bytes: 3,
    sha256: 'a'.repeat(64),
    startOffsetMs: 0,
    durationMs: 10_000,
    captureSources: ['microphone'],
    checkpointedAt: '2026-07-12T10:00:10.000Z',
  }],
  totalBytes: 3,
  durationMs: 10_000,
  diarization: {
    requested: false,
    provider: 'none',
    status: 'disabled',
    speakerCount: 0,
    reason: 'Diarisation non demandée.',
  },
  lastError: 'Capture interrompue. Le dernier checkpoint atomique peut être repris.',
};

class FakeMediaRecorder extends EventTarget {
  static finalChunk: Blob | null = null;

  static isTypeSupported(mimeType: string): boolean {
    return mimeType === 'audio/webm;codecs=opus';
  }

  readonly mimeType: string;
  state: RecordingState = 'inactive';

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super();
    this.mimeType = options?.mimeType ?? 'audio/webm';
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    if (FakeMediaRecorder.finalChunk) {
      const chunk = new Event('dataavailable');
      Object.defineProperty(chunk, 'data', { value: FakeMediaRecorder.finalChunk });
      this.dispatchEvent(chunk);
    }
    this.dispatchEvent(new Event('stop'));
  }
}

const trackStop = vi.fn();
const stream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;

function fakeBlob(bytes: number[]): Blob {
  const value = Uint8Array.from(bytes);
  return {
    size: value.byteLength,
    type: 'audio/webm;codecs=opus',
    arrayBuffer: async () => value.buffer,
  } as Blob;
}

const api = {
  capabilities: vi.fn(async () => ({
    ok: true as const,
    capabilities: {
      microphone: { state: 'runtime-probe' as const, reason: 'Micro à vérifier.' },
      sharedAudio: { state: 'unavailable' as const, reason: 'Windows uniquement.' },
      localMixing: { state: 'runtime-probe' as const, reason: 'Mix à vérifier.' },
      diarization: {
        state: 'available' as const,
        provider: 'sherpa-onnx' as const,
        reason: 'Sherpa prêt.',
      },
    },
  })),
  armSharedAudio: vi.fn<() => MeetingLiveSharedAudioArmResult>(() => ({
    ok: true as const,
    state: 'runtime-probe' as const,
    method: 'electron-loopback' as const,
  })),
  releaseSharedAudio: vi.fn(async () => ({ ok: true as const })),
  list: vi.fn(async () => ({ ok: true as const, sessions: [interrupted] })),
  start: vi.fn(async () => ({ ok: true as const, session: { ...interrupted, status: 'recording' as const } })),
  appendSegment: vi.fn(),
  pause: vi.fn(async () => ({ ok: true as const, session: { ...interrupted, status: 'paused' as const } })),
  resume: vi.fn(async () => ({
    ok: true as const,
    session: {
      ...interrupted,
      status: 'recording' as const,
      consentEvents: [
        ...interrupted.consentEvents,
        {
          accepted: true as const,
          statement: MEETING_LIVE_CONSENT_STATEMENT,
          acceptedAt: '2026-07-12T10:02:00.000Z',
          reason: 'resume' as const,
          actor: 'local-user' as const,
        },
      ],
    },
  })),
  finalize: vi.fn(),
  discard: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  api.armSharedAudio.mockReturnValue({
    ok: true,
    state: 'runtime-probe',
    method: 'electron-loopback',
  });
  api.releaseSharedAudio.mockResolvedValue({ ok: true });
  FakeMediaRecorder.finalChunk = null;
  Object.defineProperty(globalThis, 'MediaRecorder', {
    configurable: true,
    value: FakeMediaRecorder,
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      meetingLive: api,
      showItemInFolder: vi.fn(),
    },
  });
  api.appendSegment.mockResolvedValue({
    ok: true,
    session: {
      ...interrupted,
      status: 'recording',
      segments: [
        ...interrupted.segments,
        { ...interrupted.segments[0]!, sequence: 2, sha256: 'b'.repeat(64) },
      ],
    },
  });
  api.pause.mockResolvedValue({ ok: true, session: { ...interrupted, status: 'paused' } });
});

afterEach(cleanup);

describe('MeetingLiveView', () => {
  it('selects a supported local Opus format', () => {
    expect(pickMeetingRecorderMimeType((mime) => mime === 'audio/webm')).toBe('audio/webm');
    expect(pickMeetingRecorderMimeType(() => false)).toBe('');
  });

  it('shows recovered checkpoints and requires fresh consent before resuming the microphone', async () => {
    render(<MeetingLiveView />);

    expect(await screen.findAllByText('Réunion récupérée')).toHaveLength(2);
    expect(screen.getAllByText('À reprendre')).toHaveLength(2);
    expect(screen.getByText(/dernier checkpoint atomique/i)).toBeTruthy();
    const resume = screen.getByRole('button', { name: /reprendre avec consentement/i }) as HTMLButtonElement;
    expect(resume.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: /confirmer le consentement/i }));
    expect(resume.disabled).toBe(false);
    fireEvent.click(resume);

    await waitFor(() => expect(api.resume).toHaveBeenCalledWith({
      sessionId: interrupted.id,
      consent: { accepted: true, statement: MEETING_LIVE_CONSENT_STATEMENT },
      captureSources: ['microphone'],
    }));
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
      audio: expect.objectContaining({ echoCancellation: true }),
      video: false,
    }));
    await screen.findByText('MICRO ACTIF');
  });

  it('states the privacy boundary instead of claiming a video-conference bot', async () => {
    render(<MeetingLiveView />);

    await screen.findByText('Confidentialité');
    expect(screen.getByText(/aucun onglet Zoom, Meet ou Teams n’est rejoint/i)).toBeTruthy();
    expect(screen.getByText(/aucun transcript n’est envoyé à un LLM/i)).toBeTruthy();
    const start = screen.getByRole('button', { name: /commencer l’enregistrement local/i }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(start.className).toContain('bg-amber-600');
    expect(start.className).toContain('text-white');
  });

  it('mixes confirmed shared system audio locally and records no display video', async () => {
    const microphoneStop = vi.fn();
    const sharedAudioStop = vi.fn();
    const sharedVideoStop = vi.fn();
    const mixedStop = vi.fn();
    const microphone = {
      getTracks: () => [{ kind: 'audio', stop: microphoneStop }],
      getAudioTracks: () => [{ kind: 'audio', stop: microphoneStop }],
    } as unknown as MediaStream;
    const shared = {
      getTracks: () => [
        { kind: 'audio', stop: sharedAudioStop },
        { kind: 'video', stop: sharedVideoStop },
      ],
      getAudioTracks: () => [{ kind: 'audio', stop: sharedAudioStop }],
      getVideoTracks: () => [{ kind: 'video', stop: sharedVideoStop }],
    } as unknown as MediaStream;
    const mixed = {
      getTracks: () => [{ kind: 'audio', stop: mixedStop }],
      getAudioTracks: () => [{ kind: 'audio', stop: mixedStop }],
    } as unknown as MediaStream;
    const connect = vi.fn();
    class FakeAudioContext {
      resume = vi.fn(async () => undefined);
      close = vi.fn(async () => undefined);
      createMediaStreamDestination = () => ({ stream: mixed });
      createMediaStreamSource = () => ({ connect });
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });
    const getUserMedia = vi.fn(async () => microphone);
    const getDisplayMedia = vi.fn(async () => shared);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, getDisplayMedia },
    });
    api.capabilities.mockResolvedValueOnce({
      ok: true,
      capabilities: {
        microphone: { state: 'runtime-probe', reason: 'Micro à vérifier.' },
        sharedAudio: { state: 'runtime-probe', reason: 'Sélecteur système prêt.' },
        localMixing: { state: 'runtime-probe', reason: 'Mix à vérifier.' },
        diarization: { state: 'available', provider: 'sherpa-onnx', reason: 'Sherpa prêt.' },
      },
    });
    api.start.mockImplementationOnce(async (input) => ({
      ok: true as const,
      session: {
        ...interrupted,
        status: 'recording' as const,
        source: 'microphone+shared-audio' as const,
        captureSources: input.captureSources ?? ['microphone'],
      },
    }));
    render(<MeetingLiveView />);
    await screen.findAllByText('Réunion récupérée');
    const sharedToggle = screen.getByRole('checkbox', { name: /inclure l’audio système/i });
    await waitFor(() => expect((sharedToggle as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(sharedToggle);
    fireEvent.click(screen.getByRole('checkbox', { name: /activer la diarisation locale/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /confirmer le consentement/i }));
    fireEvent.click(screen.getByRole('button', { name: /commencer l’enregistrement local/i }));

    await screen.findByText('MICRO + SYSTÈME ACTIFS');
    expect(api.armSharedAudio).toHaveBeenCalledTimes(1);
    expect(getDisplayMedia).toHaveBeenCalledWith({ audio: true, video: true });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(sharedVideoStop).toHaveBeenCalledTimes(1);
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({
      captureSources: ['microphone', 'shared-audio'],
      diarization: true,
    }));
  });

  it('selects the ephemeral PipeWire input by exact device id and releases its lease', async () => {
    const microphone = {
      getTracks: () => [{ kind: 'audio', stop: vi.fn() }],
      getAudioTracks: () => [{ kind: 'audio', stop: vi.fn() }],
    } as unknown as MediaStream;
    const shared = {
      getTracks: () => [{ kind: 'audio', stop: vi.fn() }],
      getAudioTracks: () => [{ kind: 'audio', stop: vi.fn() }],
      getVideoTracks: () => [],
    } as unknown as MediaStream;
    const mixed = {
      getTracks: () => [{ kind: 'audio', stop: vi.fn() }],
      getAudioTracks: () => [{ kind: 'audio', stop: vi.fn() }],
    } as unknown as MediaStream;
    class FakeAudioContext {
      resume = vi.fn(async () => undefined);
      close = vi.fn(async () => undefined);
      createMediaStreamDestination = () => ({ stream: mixed });
      createMediaStreamSource = () => ({ connect: vi.fn() });
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });
    const getDisplayMedia = vi.fn();
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      const audio = constraints.audio;
      return typeof audio === 'object' && audio.deviceId ? shared : microphone;
    });
    const enumerateDevices = vi.fn(async () => [{
      deviceId: 'pipewire-device-id',
      groupId: 'pipewire-group',
      kind: 'audioinput' as const,
      label: 'CodeBuddy-System-Audio-test1234',
      toJSON: () => ({}),
    }]);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia, getDisplayMedia, enumerateDevices },
    });
    api.armSharedAudio.mockReturnValueOnce({
      ok: true,
      state: 'runtime-probe',
      method: 'pipewire-virtual-source',
      leaseId: 'lease-one',
      deviceLabel: 'CodeBuddy-System-Audio-test1234',
    });
    api.capabilities.mockResolvedValueOnce({
      ok: true,
      capabilities: {
        microphone: { state: 'runtime-probe', reason: 'Micro à vérifier.' },
        sharedAudio: { state: 'runtime-probe', reason: 'PipeWire prêt.' },
        localMixing: { state: 'runtime-probe', reason: 'Mix à vérifier.' },
        diarization: { state: 'available', provider: 'sherpa-onnx', reason: 'Sherpa prêt.' },
      },
    });
    api.start.mockImplementationOnce(async (input) => ({
      ok: true as const,
      session: {
        ...interrupted,
        status: 'recording' as const,
        source: 'microphone+shared-audio' as const,
        captureSources: input.captureSources ?? ['microphone'],
      },
    }));

    render(<MeetingLiveView />);
    await screen.findAllByText('Réunion récupérée');
    const sharedToggle = screen.getByRole('checkbox', { name: /inclure l’audio système/i });
    await waitFor(() => expect((sharedToggle as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(sharedToggle);
    fireEvent.click(screen.getByRole('checkbox', { name: /confirmer le consentement/i }));
    fireEvent.click(screen.getByRole('button', { name: /commencer l’enregistrement local/i }));

    await screen.findByText('MICRO + SYSTÈME ACTIFS');
    expect(enumerateDevices).toHaveBeenCalled();
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: {
        deviceId: { exact: 'pipewire-device-id' },
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
      },
      video: false,
    });
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({
      captureSources: ['microphone', 'shared-audio'],
    }));

    fireEvent.click(screen.getByRole('button', { name: /mettre en pause/i }));
    await waitFor(() => expect(api.releaseSharedAudio).toHaveBeenCalledWith({
      leaseId: 'lease-one',
    }));
  });

  it('falls back explicitly to microphone when the system picker returns no audio track', async () => {
    const microphone = {
      getTracks: () => [{ kind: 'audio', stop: vi.fn() }],
      getAudioTracks: () => [{ kind: 'audio', stop: vi.fn() }],
    } as unknown as MediaStream;
    const sharedVideoStop = vi.fn();
    const shared = {
      getTracks: () => [{ kind: 'video', stop: sharedVideoStop }],
      getAudioTracks: () => [],
      getVideoTracks: () => [{ kind: 'video', stop: sharedVideoStop }],
    } as unknown as MediaStream;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => microphone),
        getDisplayMedia: vi.fn(async () => shared),
      },
    });
    api.capabilities.mockResolvedValueOnce({
      ok: true,
      capabilities: {
        microphone: { state: 'runtime-probe', reason: 'Micro à vérifier.' },
        sharedAudio: { state: 'runtime-probe', reason: 'Sélecteur système prêt.' },
        localMixing: { state: 'runtime-probe', reason: 'Mix à vérifier.' },
        diarization: { state: 'available', provider: 'sherpa-onnx', reason: 'Sherpa prêt.' },
      },
    });
    api.start.mockImplementationOnce(async (input) => ({
      ok: true as const,
      session: {
        ...interrupted,
        status: 'recording' as const,
        captureSources: input.captureSources ?? ['microphone'],
      },
    }));
    render(<MeetingLiveView />);
    await screen.findAllByText('Réunion récupérée');
    const sharedToggle = screen.getByRole('checkbox', { name: /inclure l’audio système/i });
    await waitFor(() => expect((sharedToggle as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(sharedToggle);
    fireEvent.click(screen.getByRole('checkbox', { name: /confirmer le consentement/i }));
    fireEvent.click(screen.getByRole('button', { name: /commencer l’enregistrement local/i }));

    expect((await screen.findByRole('status')).textContent).toMatch(/poursuite explicite avec le micro seul/i);
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({
      captureSources: ['microphone'],
    }));
    await screen.findByText('MICRO ACTIF');
  });

  it('flushes the final MediaRecorder chunk before pausing during navigation', async () => {
    const order: string[] = [];
    FakeMediaRecorder.finalChunk = fakeBlob([7, 8, 9]);
    api.appendSegment.mockImplementation(async () => {
      order.push('append');
      return {
        ok: true as const,
        session: { ...interrupted, status: 'recording' as const },
      };
    });
    api.pause.mockImplementation(async () => {
      order.push('pause');
      return {
        ok: true as const,
        session: { ...interrupted, status: 'paused' as const },
      };
    });
    const { unmount } = render(<MeetingLiveView />);
    await screen.findAllByText('Réunion récupérée');
    fireEvent.click(screen.getByRole('checkbox', { name: /confirmer le consentement/i }));
    fireEvent.click(screen.getByRole('button', { name: /reprendre avec consentement/i }));
    await screen.findByText('MICRO ACTIF');

    unmount();

    await waitFor(() => expect(api.pause).toHaveBeenCalledWith({
      sessionId: interrupted.id,
      reason: 'navigation',
    }));
    expect(api.appendSegment).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['append', 'pause']);
  });

  it('blocks finalization and closes the session when the last checkpoint is rejected', async () => {
    FakeMediaRecorder.finalChunk = fakeBlob([4, 5, 6]);
    api.appendSegment.mockResolvedValueOnce({
      ok: false,
      error: 'Checkpoint refused',
      session: null,
    });
    api.finalize.mockResolvedValue({
      ok: true,
      session: { ...interrupted, status: 'completed' },
    });
    render(<MeetingLiveView />);
    await screen.findAllByText('Réunion récupérée');
    fireEvent.click(screen.getByRole('checkbox', { name: /confirmer le consentement/i }));
    fireEvent.click(screen.getByRole('button', { name: /reprendre avec consentement/i }));
    await screen.findByText('MICRO ACTIF');

    fireEvent.click(screen.getByRole('button', { name: /arrêter et créer les notes/i }));

    await screen.findByText('Checkpoint refused');
    expect(api.finalize).not.toHaveBeenCalled();
    expect(api.pause).toHaveBeenCalledWith({
      sessionId: interrupted.id,
      reason: 'capture-error',
    });
  });
});
