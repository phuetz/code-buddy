import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MEETING_LIVE_CONSENT_STATEMENT,
  type MeetingLiveCapabilities,
  type MeetingLiveCaptureSource,
  type MeetingLiveSessionView,
} from '../../shared/meeting-live';

const CHECKPOINT_INTERVAL_MS = 10_000;
const PIPEWIRE_DEVICE_TIMEOUT_MS = 3_000;
const PIPEWIRE_DEVICE_POLL_MS = 100;
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
] as const;

const STATUS_LABELS: Record<MeetingLiveSessionView['status'], string> = {
  recording: 'Enregistrement',
  paused: 'En pause',
  interrupted: 'À reprendre',
  finalizing: 'Transcription locale…',
  completed: 'Notes prêtes',
  failed: 'À retraiter',
};

interface LocalMeetingCapture {
  recordingStream: MediaStream;
  inputStreams: MediaStream[];
  audioContext: AudioContext | null;
  sources: MeetingLiveCaptureSource[];
  sharedAudioLeaseId?: string;
  warning?: string;
}

async function waitForAudioInputByLabel(deviceLabel: string): Promise<MediaDeviceInfo> {
  if (!navigator.mediaDevices.enumerateDevices) {
    throw new Error('enumerateDevices est absent de ce runtime Chromium.');
  }
  const deadline = Date.now() + PIPEWIRE_DEVICE_TIMEOUT_MS;
  let probing = true;
  while (probing) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const source = devices.find((device) => (
      device.kind === 'audioinput' && device.label === deviceLabel
    ));
    if (source) return source;
    probing = Date.now() < deadline;
    if (!probing) break;
    await new Promise<void>((resolve) => window.setTimeout(resolve, PIPEWIRE_DEVICE_POLL_MS));
  }
  throw new Error(`La source PipeWire « ${deviceLabel} » n’est pas apparue dans Chromium.`);
}

async function releaseSharedAudioLease(leaseId?: string): Promise<string | null> {
  if (!leaseId) return null;
  try {
    const result = await window.electronAPI.meetingLive.releaseSharedAudio({ leaseId });
    return result.ok ? null : result.error ?? 'La source audio système n’a pas pu être libérée.';
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

const UNKNOWN_CAPABILITIES: MeetingLiveCapabilities = {
  microphone: { state: 'runtime-probe', reason: 'Vérification au démarrage.' },
  sharedAudio: { state: 'runtime-probe', reason: 'Vérification du runtime Electron.' },
  localMixing: { state: 'runtime-probe', reason: 'Vérification avec AudioContext.' },
  diarization: {
    state: 'runtime-probe',
    provider: 'none',
    reason: 'Vérification du moteur local.',
  },
};

export function pickMeetingRecorderMimeType(
  isSupported: (mimeType: string) => boolean = MediaRecorder.isTypeSupported,
): string {
  return MIME_CANDIDATES.find((candidate) => isSupported(candidate)) ?? '';
}

function formatDuration(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024 * 1_024) return `${Math.max(1, Math.round(bytes / 1_024))} Ko`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} Mo`;
}

function statusTone(status: MeetingLiveSessionView['status']): string {
  if (status === 'recording') return 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300';
  if (status === 'completed') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed') return 'border-destructive/40 bg-destructive/10 text-destructive';
  return 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300';
}

export function MeetingLiveView() {
  const [sessions, setSessions] = useState<MeetingLiveSessionView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('Réunion');
  const [language, setLanguage] = useState('fr');
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const [capabilities, setCapabilities] = useState(UNKNOWN_CAPABILITIES);
  const [requestSharedAudio, setRequestSharedAudio] = useState(false);
  const [allowMicrophoneFallback, setAllowMicrophoneFallback] = useState(true);
  const [diarizationEnabled, setDiarizationEnabled] = useState(false);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [clock, setClock] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const localCaptureRef = useRef<LocalMeetingCapture | null>(null);
  const appendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const nextSequenceRef = useRef(1);
  const nextOffsetRef = useRef(0);
  const lastCheckpointClockRef = useRef(0);
  const captureIdRef = useRef('');
  const captureSourcesRef = useRef<MeetingLiveCaptureSource[]>(['microphone']);
  const recordingSessionIdRef = useRef<string | null>(null);
  const appendFailureRef = useRef<Error | null>(null);
  const refreshingRef = useRef(false);
  const mountedRef = useRef(true);

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? null,
    [selectedId, sessions],
  );

  const applySession = useCallback((session: MeetingLiveSessionView) => {
    if (!mountedRef.current) return;
    setSessions((current) => [
      session,
      ...current.filter((item) => item.id !== session.id),
    ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    setSelectedId(session.id);
  }, []);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const result = await window.electronAPI.meetingLive.list();
      if (!mountedRef.current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSessions(result.sessions);
      setSelectedId((current) => (
        current && result.sessions.some((session) => session.id === current)
          ? current
          : result.sessions[0]?.id ?? null
      ));
    } catch (cause) {
      if (mountedRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  const refreshCapabilities = useCallback(async () => {
    try {
      const result = await window.electronAPI.meetingLive.capabilities();
      if (!mountedRef.current) return;
      setCapabilities(result.capabilities);
      if (result.capabilities.sharedAudio.state === 'unavailable') {
        setRequestSharedAudio(false);
      }
      if (result.capabilities.diarization.state !== 'available') {
        setDiarizationEnabled(false);
      }
    } catch (cause) {
      if (!mountedRef.current) return;
      const reason = cause instanceof Error ? cause.message : String(cause);
      setCapabilities({
        microphone: { state: 'runtime-probe', reason: 'Vérification au démarrage.' },
        sharedAudio: { state: 'unavailable', reason },
        localMixing: { state: 'unavailable', reason },
        diarization: { state: 'unavailable', provider: 'none', reason },
      });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void Promise.all([refresh(), refreshCapabilities()]);
    return () => {
      mountedRef.current = false;
    };
  }, [refresh, refreshCapabilities]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!microphoneActive) return undefined;
    const timer = window.setInterval(() => setClock((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [microphoneActive]);

  const stopLocalRecorder = useCallback(async (updateUi = true): Promise<void> => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    }
    await appendQueueRef.current;
    const localCapture = localCaptureRef.current;
    const streams = new Set<MediaStream>([
      ...(localCapture?.inputStreams ?? []),
      ...(localCapture ? [localCapture.recordingStream] : []),
    ]);
    streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    await localCapture?.audioContext?.close().catch(() => undefined);
    const releaseError = await releaseSharedAudioLease(localCapture?.sharedAudioLeaseId);
    recorderRef.current = null;
    localCaptureRef.current = null;
    recordingSessionIdRef.current = null;
    captureSourcesRef.current = ['microphone'];
    if (updateUi && mountedRef.current) setMicrophoneActive(false);
    if (releaseError && updateUi && mountedRef.current) {
      setCaptureNotice(`La capture est arrêtée, mais le nettoyage audio système a échoué : ${releaseError}`);
    }
    const appendFailure = appendFailureRef.current;
    appendFailureRef.current = null;
    if (appendFailure) throw appendFailure;
  }, []);

  useEffect(() => () => {
    const sessionId = recordingSessionIdRef.current;
    const recorder = recorderRef.current;
    if (!sessionId || !recorder || recorder.state === 'inactive') return;
    // MediaRecorder emits its last `dataavailable` immediately before `stop`.
    // Wait for both events and the subsequently extended append queue before
    // telling the main process to close the resumable session.
    void stopLocalRecorder(false)
      .catch(() => undefined)
      .then(() => window.electronAPI.meetingLive.pause({
        sessionId,
        reason: 'navigation',
      }));
  }, [stopLocalRecorder]);

  const attachRecorder = useCallback((
    capture: LocalMeetingCapture,
    session: MeetingLiveSessionView,
  ): void => {
    const stream = capture.recordingStream;
    const mimeType = pickMeetingRecorderMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 })
      : new MediaRecorder(stream, { audioBitsPerSecond: 64_000 });
    const actualMimeType = recorder.mimeType || mimeType || 'audio/webm';
    recorderRef.current = recorder;
    localCaptureRef.current = capture;
    captureSourcesRef.current = capture.sources;
    appendQueueRef.current = Promise.resolve();
    appendFailureRef.current = null;
    nextSequenceRef.current = session.segments.length + 1;
    nextOffsetRef.current = session.durationMs;
    lastCheckpointClockRef.current = performance.now();
    captureIdRef.current = crypto.randomUUID();
    recordingSessionIdRef.current = session.id;

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size === 0) return;
      const now = performance.now();
      const durationMs = Math.max(1, now - lastCheckpointClockRef.current);
      lastCheckpointClockRef.current = now;
      const sequence = nextSequenceRef.current;
      nextSequenceRef.current += 1;
      const startOffsetMs = nextOffsetRef.current;
      nextOffsetRef.current += durationMs;
      const blob = event.data;
      const captureId = captureIdRef.current;
      appendQueueRef.current = appendQueueRef.current
        .then(async () => {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const result = await window.electronAPI.meetingLive.appendSegment({
            sessionId: session.id,
            sequence,
            captureId,
            mimeType: actualMimeType,
            bytes,
            startOffsetMs,
            durationMs,
            captureSources: captureSourcesRef.current,
          });
          if (!result.ok) throw new Error(result.error);
          applySession(result.session);
        })
        .catch((cause: unknown) => {
          appendFailureRef.current = cause instanceof Error ? cause : new Error(String(cause));
          if (mountedRef.current) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        });
    });
    recorder.addEventListener('error', () => {
      if (mountedRef.current) setError('La capture audio a signalé une erreur. Les checkpoints déjà écrits restent récupérables.');
    });
    recorder.start(CHECKPOINT_INTERVAL_MS);
    setMicrophoneActive(true);
    setClock((value) => value + 1);
  }, [applySession]);

  const prepareLocalCapture = useCallback(async (): Promise<LocalMeetingCapture> => {
    let shared: MediaStream | null = null;
    let sharedAudioLeaseId: string | undefined;
    let sharedWarning: string | undefined;
    if (requestSharedAudio) {
      try {
        // Arming uses bounded synchronous IPC. Calling getDisplayMedia before
        // the first await on Windows preserves Chromium's transient click activation.
        const armed = window.electronAPI.meetingLive.armSharedAudio();
        if (!armed.ok) throw new Error(armed.error ?? 'Partage audio non autorisé.');
        sharedAudioLeaseId = armed.leaseId;
        if (armed.method === 'pipewire-virtual-source') {
          if (!armed.leaseId || !armed.deviceLabel) {
            throw new Error('Le broker PipeWire n’a pas retourné de source vérifiable.');
          }
          const source = await waitForAudioInputByLabel(armed.deviceLabel);
          shared = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: { exact: source.deviceId },
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
            },
            video: false,
          });
        } else {
          if (!navigator.mediaDevices.getDisplayMedia) {
            throw new Error('getDisplayMedia est absent de ce runtime Chromium.');
          }
          const sharedRequest = navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: true,
          });
          shared = await sharedRequest;
          // Electron uses a display video source as getDisplayMedia transport.
          // It is never connected to the recorder and is stopped immediately.
          shared.getVideoTracks().forEach((track) => track.stop());
        }
        if (shared.getAudioTracks().length === 0) {
          throw new Error('Le runtime n’a fourni aucune piste audio système partagée.');
        }
      } catch (cause) {
        shared?.getTracks().forEach((track) => track.stop());
        shared = null;
        await releaseSharedAudioLease(sharedAudioLeaseId);
        sharedAudioLeaseId = undefined;
        const reason = cause instanceof Error ? cause.message : String(cause);
        if (!allowMicrophoneFallback) {
          throw new Error(`Audio partagé indisponible : ${reason}`);
        }
        sharedWarning = `Audio partagé indisponible — poursuite explicite avec le micro seul : ${reason}`;
      }
    }

    let microphone: MediaStream;
    try {
      microphone = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
    } catch (cause) {
      shared?.getTracks().forEach((track) => track.stop());
      await releaseSharedAudioLease(sharedAudioLeaseId);
      throw cause;
    }
    const microphoneTracks = typeof microphone.getAudioTracks === 'function'
      ? microphone.getAudioTracks()
      : microphone.getTracks();
    if (microphoneTracks.length === 0) {
      microphone.getTracks().forEach((track) => track.stop());
      shared?.getTracks().forEach((track) => track.stop());
      await releaseSharedAudioLease(sharedAudioLeaseId);
      throw new Error('Le runtime n’a fourni aucune piste microphone.');
    }
    if (!shared) {
      return {
        recordingStream: microphone,
        inputStreams: [microphone],
        audioContext: null,
        sources: ['microphone'],
        ...(sharedWarning ? { warning: sharedWarning } : {}),
      };
    }

    let audioContext: AudioContext | null = null;
    try {
      if (!window.AudioContext) {
        throw new Error('AudioContext est indisponible : mélange local impossible.');
      }
      audioContext = new AudioContext();
      await audioContext.resume();
      const destination = audioContext.createMediaStreamDestination();
      audioContext.createMediaStreamSource(microphone).connect(destination);
      audioContext.createMediaStreamSource(shared).connect(destination);
      if (destination.stream.getAudioTracks().length === 0) {
        throw new Error('Le mélange local n’a produit aucune piste audio.');
      }
      return {
        recordingStream: destination.stream,
        inputStreams: [microphone, shared],
        audioContext,
        sources: ['microphone', 'shared-audio'],
        ...(sharedAudioLeaseId ? { sharedAudioLeaseId } : {}),
      };
    } catch (cause) {
      shared?.getTracks().forEach((track) => track.stop());
      await audioContext?.close().catch(() => undefined);
      await releaseSharedAudioLease(sharedAudioLeaseId);
      sharedAudioLeaseId = undefined;
      const reason = cause instanceof Error ? cause.message : String(cause);
      if (!allowMicrophoneFallback) {
        microphone.getTracks().forEach((track) => track.stop());
        throw new Error(`Audio partagé indisponible : ${reason}`);
      }
      return {
        recordingStream: microphone,
        inputStreams: [microphone],
        audioContext: null,
        sources: ['microphone'],
        warning: `Audio partagé indisponible — poursuite explicite avec le micro seul : ${reason}`,
      };
    }
  }, [allowMicrophoneFallback, requestSharedAudio]);

  const beginCapture = useCallback(async (
    mode: 'start' | 'resume',
    sessionToResume?: MeetingLiveSessionView,
  ) => {
    if (!consentAccepted) {
      setError('Confirme le consentement des participants avant d’activer le micro.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('La capture microphone n’est pas disponible dans ce runtime.');
      return;
    }
    setBusy(true);
    setError(null);
    let capture: LocalMeetingCapture | null = null;
    let openedSession: MeetingLiveSessionView | null = null;
    try {
      capture = await prepareLocalCapture();
      setCaptureNotice(capture.warning ?? null);
      const consent = { accepted: true, statement: MEETING_LIVE_CONSENT_STATEMENT };
      const result = mode === 'start'
        ? await window.electronAPI.meetingLive.start({
            title,
            language,
            consent,
            captureSources: capture.sources,
            diarization: diarizationEnabled,
          })
        : await window.electronAPI.meetingLive.resume({
          sessionId: sessionToResume!.id,
          consent,
          captureSources: capture.sources,
        });
      if (!result.ok) throw new Error(result.error);
      openedSession = result.session;
      applySession(result.session);
      attachRecorder(capture, result.session);
      capture = null;
      setConsentAccepted(false);
    } catch (cause) {
      if (capture) {
        capture.inputStreams.forEach((stream) => (
          stream.getTracks().forEach((track) => track.stop())
        ));
        capture.recordingStream.getTracks().forEach((track) => track.stop());
        await capture.audioContext?.close().catch(() => undefined);
        await releaseSharedAudioLease(capture.sharedAudioLeaseId);
      }
      if (openedSession) {
        await window.electronAPI.meetingLive.pause({
          sessionId: openedSession.id,
          reason: 'capture-error',
        });
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [
    applySession,
    attachRecorder,
    consentAccepted,
    diarizationEnabled,
    language,
    prepareLocalCapture,
    title,
  ]);

  const pause = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    let captureFailure: Error | null = null;
    try {
      try {
        await stopLocalRecorder();
      } catch (cause) {
        captureFailure = cause instanceof Error ? cause : new Error(String(cause));
      }
      const result = await window.electronAPI.meetingLive.pause({
        sessionId: selected.id,
        reason: 'user',
      });
      if (!result.ok) throw new Error(result.error);
      applySession(result.session);
      if (captureFailure) throw captureFailure;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [applySession, selected, stopLocalRecorder]);

  const finalize = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      if (recordingSessionIdRef.current === selected.id) {
        try {
          await stopLocalRecorder();
        } catch (cause) {
          await window.electronAPI.meetingLive.pause({
            sessionId: selected.id,
            reason: 'capture-error',
          });
          throw cause;
        }
      }
      const result = await window.electronAPI.meetingLive.finalize({ sessionId: selected.id });
      if (!result.ok) throw new Error(result.error);
      applySession(result.session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [applySession, refresh, selected, stopLocalRecorder]);

  const discard = useCallback(async () => {
    if (!selected) return;
    const confirmed = window.confirm(
      `Supprimer définitivement l’audio local et les notes de « ${selected.title} » ?`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      if (recordingSessionIdRef.current === selected.id) {
        await stopLocalRecorder();
        await window.electronAPI.meetingLive.pause({ sessionId: selected.id, reason: 'user' });
      }
      const result = await window.electronAPI.meetingLive.discard({ sessionId: selected.id });
      if (!result.ok) throw new Error(result.error ?? 'Suppression impossible.');
      setSelectedId(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [refresh, selected, stopLocalRecorder]);

  const effectiveDuration = selected?.durationMs ?? 0;
  void clock;

  return (
    <div className="h-full min-h-0 overflow-auto bg-background" data-testid="meeting-live-view">
      <div className="mx-auto max-w-6xl space-y-5 p-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Intelligence locale de réunion
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Meeting Live</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Capture des sources audio explicitement choisies, reprend après une interruption,
              puis produit un compte rendu local avec Whisper et, sur demande, Sherpa-ONNX.
            </p>
          </div>
          <div className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            🔒 Local uniquement · aucun envoi cloud
          </div>
        </header>

        {error ? (
          <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {captureNotice ? (
          <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
            {captureNotice}
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
          <main className="space-y-5">
            <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Nouvelle capture</h2>
                  <p className="text-xs text-muted-foreground">Micro obligatoire · audio système seulement si le runtime le confirme</p>
                </div>
                {microphoneActive ? (
                  <span className="flex items-center gap-2 text-xs font-semibold text-red-600 dark:text-red-300">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                    {captureSourcesRef.current.includes('shared-audio') ? 'MICRO + SYSTÈME ACTIFS' : 'MICRO ACTIF'}
                  </span>
                ) : null}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_120px]">
                <label className="space-y-1 text-xs font-medium">
                  Titre de la réunion
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={160}
                    disabled={microphoneActive || busy}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal outline-none focus:border-primary"
                  />
                </label>
                <label className="space-y-1 text-xs font-medium">
                  Langue
                  <select
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    disabled={microphoneActive || busy}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal"
                  >
                    <option value="fr">Français</option>
                    <option value="en">English</option>
                    <option value="de">Deutsch</option>
                    <option value="es">Español</option>
                  </select>
                </label>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex items-start gap-3 rounded-xl border border-border bg-background p-3 text-sm">
                  <input type="checkbox" checked disabled className="mt-0.5" />
                  <span>
                    <span className="block font-semibold">Microphone</span>
                    <span className="block text-xs text-muted-foreground">
                      Source locale obligatoire, vérifiée à l’ouverture de la piste.
                    </span>
                  </span>
                </label>
                <label className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${capabilities.sharedAudio.state === 'unavailable' ? 'cursor-not-allowed border-border bg-muted/40 opacity-70' : 'border-border bg-background'}`}>
                  <input
                    type="checkbox"
                    aria-label="Inclure l’audio système partagé"
                    checked={requestSharedAudio}
                    onChange={(event) => setRequestSharedAudio(event.target.checked)}
                    disabled={microphoneActive || busy || capabilities.sharedAudio.state === 'unavailable'}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-semibold">Audio système partagé</span>
                    <span className="block text-xs text-muted-foreground">
                      {capabilities.sharedAudio.reason}
                    </span>
                  </span>
                </label>
              </div>
              {requestSharedAudio ? (
                <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    aria-label="Continuer avec le micro seul si le partage audio est refusé"
                    checked={allowMicrophoneFallback}
                    onChange={(event) => setAllowMicrophoneFallback(event.target.checked)}
                    disabled={microphoneActive || busy}
                  />
                  Continuer avec le micro seul si la source système échoue, en affichant la raison.
                </label>
              ) : null}
              <label className={`mt-3 flex items-start gap-3 rounded-xl border p-3 text-sm ${capabilities.diarization.state !== 'available' ? 'cursor-not-allowed border-border bg-muted/40 opacity-70' : 'border-violet-500/30 bg-violet-500/5'}`}>
                <input
                  type="checkbox"
                  aria-label="Activer la diarisation locale des locuteurs"
                  checked={diarizationEnabled}
                  onChange={(event) => setDiarizationEnabled(event.target.checked)}
                  disabled={microphoneActive || busy || capabilities.diarization.state !== 'available'}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-semibold">Identifier les tours de parole</span>
                  <span className="block text-xs text-muted-foreground">
                    {capabilities.diarization.reason} Les noms restent « Locuteur 1, 2… » : aucune identité n’est inventée.
                  </span>
                </span>
              </label>
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <input
                  type="checkbox"
                  aria-label="Confirmer le consentement explicite des participants"
                  checked={consentAccepted}
                  onChange={(event) => setConsentAccepted(event.target.checked)}
                  disabled={microphoneActive || busy}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-semibold">Consentement explicite obligatoire</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {MEETING_LIVE_CONSENT_STATEMENT} Cette validation horodatée est conservée dans
                    le manifeste local et sera redemandée après une interruption.
                  </span>
                </span>
              </label>
              <button
                type="button"
                onClick={() => void beginCapture('start')}
                disabled={!consentAccepted || microphoneActive || busy || !title.trim()}
                className="mt-4 w-full rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Préparation…' : '🎙️ Commencer l’enregistrement local'}
              </button>
            </section>

            {selected ? (
              <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm" data-testid="meeting-live-session">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{selected.title}</h2>
                    <p className="text-xs text-muted-foreground">
                      Créée le {new Date(selected.createdAt).toLocaleString()} · {selected.consentEvents.length} validation(s) de consentement
                    </p>
                    <p className="mt-1 text-xs font-medium text-muted-foreground">
                      Sources réellement enregistrées : {(selected.captureSources ?? ['microphone']).includes('shared-audio') ? 'microphone + audio système' : 'microphone'}
                    </p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(selected.status)}`}>
                    {STATUS_LABELS[selected.status]}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-accent/50 p-3">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Durée sauvée</div>
                    <div className="mt-1 font-mono text-xl font-semibold">{formatDuration(effectiveDuration)}</div>
                  </div>
                  <div className="rounded-xl bg-accent/50 p-3">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Checkpoints</div>
                    <div className="mt-1 text-xl font-semibold">{selected.segments.length}</div>
                  </div>
                  <div className="rounded-xl bg-accent/50 p-3">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Audio privé</div>
                    <div className="mt-1 text-xl font-semibold">{formatBytes(selected.totalBytes)}</div>
                  </div>
                </div>

                {selected.lastError ? (
                  <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                    {selected.lastError}
                  </p>
                ) : null}

                {selected.output ? (
                  <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                    <h3 className="font-semibold">{selected.output.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{selected.output.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span>{selected.output.decisions} décision(s)</span>
                      <span>· {selected.output.actionItems} action(s)</span>
                      <span>· {selected.output.openQuestions} question(s)</span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Locuteurs : {(selected.output.diarization ?? selected.diarization)?.status === 'applied'
                        ? `${(selected.output.diarization ?? selected.diarization)?.speakerCount ?? 0} cluster(s) de voix par prise, étiqueté(s) localement`
                        : (selected.output.diarization ?? selected.diarization)?.reason ?? 'rapport non diarizé'}
                    </p>
                    <button
                      type="button"
                      onClick={() => void window.electronAPI.showItemInFolder(selected.output!.markdownPath)}
                      className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-accent"
                    >
                      Afficher les notes Markdown
                    </button>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  {microphoneActive && recordingSessionIdRef.current === selected.id ? (
                    <button type="button" onClick={() => void pause()} disabled={busy} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-50">
                      ⏸ Mettre en pause
                    </button>
                  ) : null}
                  {['paused', 'interrupted', 'failed'].includes(selected.status) ? (
                    <button
                      type="button"
                      onClick={() => void beginCapture('resume', selected)}
                      disabled={!consentAccepted || busy || microphoneActive}
                      className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-500 disabled:opacity-50"
                    >
                      🎙️ Reprendre avec consentement
                    </button>
                  ) : null}
                  {selected.status !== 'completed' && selected.segments.length > 0 ? (
                    <button type="button" onClick={() => void finalize()} disabled={busy} className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300">
                      {selected.status === 'finalizing' ? 'Transcription locale…' : '✓ Arrêter et créer les notes'}
                    </button>
                  ) : null}
                  {selected.status !== 'recording' && selected.status !== 'finalizing' ? (
                    <button type="button" onClick={() => void discard()} disabled={busy} className="ml-auto rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50">
                      Supprimer les données locales
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}
          </main>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-border bg-surface p-4">
              <h2 className="font-semibold">Captures locales</h2>
              <p className="mt-1 text-xs text-muted-foreground">Les interruptions récupérables apparaissent ici au redémarrage.</p>
              <div className="mt-3 space-y-2">
                {sessions.map((session) => (
                  <button
                    type="button"
                    key={session.id}
                    onClick={() => {
                      setSelectedId(session.id);
                      setConsentAccepted(false);
                    }}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${selectedId === session.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{session.title}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{STATUS_LABELS[session.status]}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatDuration(session.durationMs)} · {session.segments.length} checkpoint(s)
                    </div>
                  </button>
                ))}
                {sessions.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">Aucune réunion enregistrée.</p>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-surface p-4 text-xs text-muted-foreground">
              <h2 className="font-semibold text-foreground">Confidentialité</h2>
              <ul className="mt-2 list-disc space-y-1.5 pl-4">
                <li>Aucun onglet Zoom, Meet ou Teams n’est rejoint et aucun bot n’est ajouté.</li>
                <li>L’audio système n’est demandé qu’après un clic explicite, avec autorisation éphémère limitée à cette fenêtre.</li>
                <li>Un checkpoint audio atomique est écrit toutes les 10 secondes.</li>
                <li>Les fichiers privés sont limités au dossier utilisateur Cowork, en mode 0600.</li>
                <li>Whisper et Sherpa-ONNX restent locaux ; aucun transcript n’est envoyé à un LLM.</li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
