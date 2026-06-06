/**
 * CompanionPanel — Buddy's Lisa-inspired cockpit.
 *
 * Surfaces local companion readiness and the append-only sensory journal:
 * vision, hearing, screen, self-state, memory, tools, and suggestions.
 *
 * @module renderer/components/CompanionPanel
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Bot,
  Brain,
  Camera,
  ClipboardCheck,
  Eye,
  FolderOpen,
  ListChecks,
  Mic,
  Monitor,
  Play,
  Radio,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { useAppStore } from '../store';
import {
  analyzeCompanionMediaPipeFrame,
  type CompanionMediaPipeVisionAnalysis,
} from '../services/companion/mediapipe-vision';
import { speakText } from './VoiceOutputToggle';
import type {
  CameraSnapshotInspectionResult,
  CameraSnapshotResult,
  CompanionCard,
  CompanionCardStatus,
  CompanionCompetitiveRadar,
  CompanionCheckInCue,
  CompanionGatewayInbox,
  CompanionGatewayInboxDraft,
  CompanionGatewayMode,
  CompanionGatewayProfile,
  CompanionImprovementCycle,
  CompanionImpulseBrief,
  CompanionMission,
  CompanionMissionRunResult,
  CompanionMissionStatus,
  CompanionPercept,
  CompanionPerceptModality,
  CompanionPerceptStats,
  CompanionPrivacyExportResult,
  CompanionPrivacyPurgeResult,
  CompanionPrivacyReport,
  CompanionSafetyEvent,
  CompanionSafetyLedgerStats,
  CompanionSelfEvaluation,
  CompanionSetupResponse,
  CompanionSkillCandidate,
  CompanionSkillCuratorResult,
  CompanionStatus,
  VoiceConversationSnapshot,
} from '../types';

const MODALITIES: Array<{ key: CompanionPerceptModality | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'vision', label: 'Vision' },
  { key: 'hearing', label: 'Hearing' },
  { key: 'screen', label: 'Screen' },
  { key: 'self', label: 'Self' },
  { key: 'memory', label: 'Memory' },
  { key: 'tool', label: 'Tools' },
  { key: 'suggestion', label: 'Ideas' },
];

const MODALITY_ICON: Record<CompanionPerceptModality, typeof Activity> = {
  vision: Eye,
  hearing: Mic,
  screen: Monitor,
  self: Bot,
  memory: Brain,
  tool: Activity,
  suggestion: Sparkles,
};

interface RendererCameraFrame {
  dataUrl: string;
  mediaType: 'image/png';
  width: number;
  height: number;
  mediaPipe?: CompanionMediaPipeVisionAnalysis;
}

type CompanionCameraSnapshotResult = CameraSnapshotResult & {
  mediaPipe?: CompanionMediaPipeVisionAnalysis;
  capturedAt?: number;
};

type CompanionCameraInspectionResult = CameraSnapshotInspectionResult & {
  snapshot?: CompanionCameraSnapshotResult;
};

function cameraErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isCameraPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError';
}

function canUseRendererCamera(): boolean {
  const mediaDevices = (navigator as Navigator & {
    mediaDevices?: { getUserMedia?: unknown };
  }).mediaDevices;
  const companion = (window as Window & {
    electronAPI?: { companion?: { cameraRendererSnapshot?: unknown } };
  }).electronAPI?.companion;

  return Boolean(
    typeof mediaDevices?.getUserMedia === 'function'
    && typeof companion?.cameraRendererSnapshot === 'function',
  );
}

function withCaptureTimestamp(
  snapshot: CompanionCameraSnapshotResult | undefined | null,
  capturedAt = Date.now(),
): CompanionCameraSnapshotResult | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    capturedAt: snapshot.capturedAt ?? capturedAt,
  };
}

async function captureRendererCameraFrame(): Promise<RendererCameraFrame> {
  const mediaDevices = (navigator as Navigator & {
    mediaDevices?: { getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream> };
  }).mediaDevices;

  if (typeof mediaDevices?.getUserMedia !== 'function') {
    throw new Error('Renderer camera API is unavailable.');
  }

  const stream = await mediaDevices.getUserMedia({
    video: {
      width: { ideal: 640 },
      height: { ideal: 480 },
      facingMode: 'user',
    },
    audio: false,
  });

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error('Timed out waiting for the camera frame.'));
      }, 10000);

      video.onloadedmetadata = () => {
        video.play()
          .then(() => {
            window.clearTimeout(timer);
            resolve();
          })
          .catch((err: unknown) => {
            window.clearTimeout(timer);
            reject(err);
          });
      };
      video.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('Camera video element failed to load.'));
      };
    });

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error('Camera stream did not expose a video frame.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Camera canvas context is unavailable.');

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const mediaPipe = await analyzeCompanionMediaPipeFrame(canvas, { timeoutMs: 8000 });

    return {
      dataUrl: canvas.toDataURL('image/png'),
      mediaType: 'image/png',
      width: canvas.width,
      height: canvas.height,
      mediaPipe,
    };
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function ready(ok: boolean): string {
  return ok ? 'Ready' : 'Needs attention';
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function mediaPipeVisionSummary(analysis: CompanionMediaPipeVisionAnalysis): string {
  return `MediaPipe ${analysis.status}: ${[
    countLabel(analysis.faceCount, 'face'),
    countLabel(analysis.handCount, 'hand'),
    countLabel(analysis.poseCount, 'pose'),
  ].join(', ')}`;
}

function mediaPipeHandValue(analysis: CompanionMediaPipeVisionAnalysis): string {
  if (analysis.hands.length === 0) return 'No hands';
  return analysis.hands
    .map((hand, index) => {
      const tips = Object.keys(hand.fingerTips ?? {});
      return `${hand.handedness ?? `Hand ${index + 1}`}: ${tips.length > 0 ? tips.join(', ') : 'no fingertips'}`;
    })
    .join(' / ');
}

function MediaPipeVisionSummary({ analysis }: { analysis: CompanionMediaPipeVisionAnalysis | null }) {
  if (!analysis) return null;
  const available = analysis.status === 'ok';

  return (
    <div
      data-testid="mediapipe-vision-summary"
      className="rounded border border-border bg-surface/35 p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Eye className={`h-4 w-4 shrink-0 ${available ? 'text-accent' : 'text-warning'}`} />
          <span className="truncate text-xs font-semibold text-text-primary">
            {mediaPipeVisionSummary(analysis)}
          </span>
        </div>
        {typeof analysis.elapsedMs === 'number' && (
          <span className="shrink-0 text-[10px] text-text-muted">{analysis.elapsedMs}ms</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <StatusTile
          icon={Eye}
          label="Faces"
          value={analysis.faceCount > 0 ? `${analysis.faceCount} detected` : 'None detected'}
          ok={available && analysis.faceCount > 0}
        />
        <StatusTile
          icon={Activity}
          label="Hands"
          value={mediaPipeHandValue(analysis)}
          ok={available && analysis.handCount > 0}
        />
        <StatusTile
          icon={Monitor}
          label="Pose"
          value={analysis.poseCount > 0 ? `${analysis.poseCount} body pose` : 'None detected'}
          ok={available && analysis.poseCount > 0}
        />
        <StatusTile
          icon={Brain}
          label="Engine"
          value={analysis.error ?? analysis.engine}
          ok={available}
        />
      </div>
    </div>
  );
}

interface CompanionPulseSignal {
  label: string;
  value: string;
  ok: boolean;
  recoveryHint?: string;
}

type CompanionPulseAction =
  | 'activate'
  | 'retrySync'
  | 'inspectVoice'
  | 'inspectCamera'
  | 'recordSelf'
  | 'openVoiceChat'
  | 'checkIn';

interface CompanionPulse {
  ok: boolean;
  title: string;
  summary: string;
  nextAction: string;
  nextActionKey?: CompanionPulseAction;
  nextActionLabel?: string;
  signals: CompanionPulseSignal[];
}

type CompanionSyncState = {
  at: number;
  status: 'ok' | 'partial' | 'failed';
};

function voiceConversationValue(snapshot: VoiceConversationSnapshot | null): string {
  if (!snapshot) return 'No voice session';
  const interruptions = snapshot.interruptionCount > 0
    ? ` / ${snapshot.interruptionCount} interrupt${snapshot.interruptionCount === 1 ? '' : 's'}`
    : '';
  if (snapshot.pendingInterruption) {
    return `interrupted / resume pending${interruptions}`;
  }
  if (snapshot.resumedAfterInterruption) {
    return `listening after barge-in${interruptions}`;
  }
  return `${snapshot.phase} / turn ${snapshot.turnId}${interruptions}`;
}

interface RuntimeVoiceStatus {
  available: boolean;
  provider?: string;
  fallbackProvider?: string;
  bootError?: string | null;
  kyutai?: {
    sttEnabled?: boolean;
    ttsEnabled?: boolean;
    baseUrl?: string;
  };
}

interface VoiceDiagnosticProbe {
  ok: boolean;
  endpoint: string;
  durationMs: number;
  error?: string;
}

interface VoiceDiagnostics {
  ok: boolean;
  checkedAt: string;
  stt: {
    provider: string;
    available: boolean;
    fallbackProvider: string;
    fallbackAvailable: boolean;
    bootError: string | null;
  };
  tts: {
    provider: string;
    available: boolean;
    fallbackProvider: string;
    fallbackAvailable: boolean;
    bootError: string | null;
  };
  kyutai: {
    sttEnabled: boolean;
    ttsEnabled: boolean;
    baseUrl: string;
    ffmpegBinary: string;
    ffmpegFound: boolean;
    ttsVoice: string;
    sttProbe?: VoiceDiagnosticProbe;
    ttsProbe?: VoiceDiagnosticProbe;
  } | null;
}

interface VoiceDiagnosticIssue {
  id: string;
  label: string;
  detail?: string;
  recommendation: string;
}

interface ReadinessValue {
  value: string;
  ok: boolean;
}

function runtimeVoiceValue(
  companionProvider: string,
  runtime: RuntimeVoiceStatus | null,
  kyutaiKey: 'sttEnabled' | 'ttsEnabled',
): string {
  const kyutaiActive = Boolean(runtime?.kyutai?.[kyutaiKey]);
  if (kyutaiActive && runtime?.kyutai?.baseUrl) {
    const provider = runtime?.provider || 'kyutai';
    return `${provider} / ${runtime.kyutai.baseUrl.replace(/^wss?:\/\//, '')}`;
  }
  return companionProvider;
}

function routeDiagnosticValue(route: VoiceDiagnostics['stt']): string {
  const fallback = route.fallbackAvailable ? route.fallbackProvider : `${route.fallbackProvider} unavailable`;
  if (!route.available) return `Needs attention / ${route.provider} / ${fallback}`;
  if (!route.fallbackAvailable) return `Degraded / ${route.provider} / ${fallback}`;
  return `Ready / ${route.provider} / ${fallback}`;
}

function routeDiagnosticReady(route: VoiceDiagnostics['stt']): boolean {
  return route.available && route.fallbackAvailable;
}

function voiceDiagnosticsFreshness(diagnostics: VoiceDiagnostics): { fresh: boolean; age: string } {
  const checkedAtMs = parseTimestampMs(diagnostics.checkedAt);
  const ageMs = checkedAtMs === null ? null : Date.now() - checkedAtMs;

  return {
    fresh: ageMs !== null && ageMs <= COMPANION_VOICE_DIAGNOSTIC_FRESH_MS,
    age: ageMs === null ? 'unknown age' : formatAge(ageMs),
  };
}

function voiceDiagnosticRouteReadiness(
  route: VoiceDiagnostics['stt'],
  diagnostics: VoiceDiagnostics,
): ReadinessValue {
  const freshness = voiceDiagnosticsFreshness(diagnostics);

  if (!freshness.fresh) {
    return {
      value: `Stale diagnostic / ${freshness.age}`,
      ok: false,
    };
  }

  return {
    value: routeDiagnosticValue(route),
    ok: routeDiagnosticReady(route),
  };
}

function probeDiagnosticValue(enabled: boolean, probe: VoiceDiagnosticProbe | undefined): string {
  if (!enabled) return 'Disabled';
  if (!probe) return 'Not checked';
  if (probe.ok) return `Online / ${probe.durationMs}ms`;
  return `Offline / ${probe.error ?? 'connection failed'}`;
}

const COMPANION_CONTEXT_FRESH_MS = 15 * 60 * 1000;
const COMPANION_VOICE_DIAGNOSTIC_FRESH_MS = 15 * 60 * 1000;
const COMPANION_VISION_FRESH_MS = 15 * 60 * 1000;
const COMPANION_DIALOGUE_FRESH_MS = 15 * 60 * 1000;
const COMPANION_AUTO_REFRESH_MS = 60 * 1000;
const COMPANION_RECOVERY_REFRESH_MS = 10 * 1000;

function parseTimestampMs(timestamp: string | undefined): number | null {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAge(ageMs: number): string {
  const bounded = Math.max(0, ageMs);
  if (bounded < 60_000) return 'just now';
  if (bounded < 3_600_000) return `${Math.floor(bounded / 60_000)}m ago`;
  if (bounded < 86_400_000) return `${Math.floor(bounded / 3_600_000)}h ago`;
  return `${Math.floor(bounded / 86_400_000)}d ago`;
}

function companionSyncPresentation(sync: CompanionSyncState): { label: string; detail: string } {
  const age = formatAge(Date.now() - sync.at);
  if (sync.status === 'ok') {
    return {
      label: `Last sync ${age}`,
      detail: `Companion sync healthy ${age}; cockpit state is current.`,
    };
  }

  if (sync.status === 'partial') {
    return {
      label: `Last sync partial ${age}`,
      detail: `Companion sync partial ${age}; Buddy will retry automatically.`,
    };
  }

  return {
    label: `Last sync failed ${age}`,
    detail: `Companion sync failed ${age}; Buddy will retry automatically.`,
  };
}

function companionSyncSignal(sync: CompanionSyncState | null): CompanionPulseSignal | null {
  if (!sync || sync.status === 'ok') return null;
  return {
    label: 'Sync',
    value: `${sync.status === 'partial' ? 'Partial' : 'Failed'} / ${formatAge(Date.now() - sync.at)}`,
    ok: false,
  };
}

function companionContextFreshness(input: {
  percepts: CompanionPercept[];
  stats: CompanionPerceptStats | null;
}): CompanionPulseSignal {
  const candidates = input.percepts
    .map((percept) => ({
      modality: percept.modality,
      source: percept.source,
      timestampMs: parseTimestampMs(percept.timestamp),
    }))
    .filter((percept): percept is { modality: CompanionPerceptModality; source: string; timestampMs: number } => (
      percept.timestampMs !== null
    ));
  const latestStatsTimestamp = parseTimestampMs(input.stats?.latestTimestamp);
  if (latestStatsTimestamp !== null) {
    candidates.push({
      modality: 'memory',
      source: 'journal',
      timestampMs: latestStatsTimestamp,
    });
  }
  const latest = candidates.sort((a, b) => b.timestampMs - a.timestampMs)[0] ?? null;

  if (!latest) {
    return {
      label: 'Context',
      value: 'No percept journal yet',
      ok: false,
    };
  }

  const ageMs = Date.now() - latest.timestampMs;
  const ok = ageMs <= COMPANION_CONTEXT_FRESH_MS;
  const source = latest.source === 'journal' ? 'journal' : latest.modality;
  return {
    label: 'Context',
    value: `${ok ? 'Fresh' : 'Stale'} / ${source} ${formatAge(ageMs)}`,
    ok,
  };
}

function companionVoiceSignal(input: {
  status: CompanionStatus;
  diagnostics: VoiceDiagnostics | null;
  runtime: RuntimeVoiceStatus | null;
  ttsRuntime: RuntimeVoiceStatus | null;
}): CompanionPulseSignal {
  if (input.diagnostics) {
    const freshness = voiceDiagnosticsFreshness(input.diagnostics);
    const diagnosticsReady = voiceDiagnosticIssues(input.diagnostics).length === 0;
    const ok = freshness.fresh && diagnosticsReady;

    return {
      label: 'Voice',
      value: freshness.fresh
        ? `${ready(diagnosticsReady)} / diagnostic ${freshness.age}`
        : `Stale diagnostic / ${freshness.age}`,
      ok,
    };
  }

  const runtimeReady = input.status.voice.enabled
    && (input.runtime?.available ?? input.status.voice.available)
    && input.status.tts.enabled
    && (input.ttsRuntime?.available ?? input.status.tts.available);

  return {
    label: 'Voice',
    value: `${ready(runtimeReady)} / runtime status`,
    ok: runtimeReady,
  };
}

function companionWakeSignal(status: CompanionStatus): CompanionPulseSignal {
  const wakeWords = status.wakeWord.wakeWords.length > 0
    ? status.wakeWord.wakeWords.join(', ')
    : 'no wake words';

  return {
    label: 'Wake',
    value: `${ready(status.wakeWord.available)} / ${status.wakeWord.engine}: ${wakeWords}`,
    ok: status.wakeWord.available,
  };
}

function companionVisionSignal(input: {
  vision: CompanionMediaPipeVisionAnalysis | null;
  capturedAt: number | null;
  cameraAvailable: boolean;
  rendererCameraCapable: boolean;
}): CompanionPulseSignal {
  if (input.vision) {
    const ageMs = input.capturedAt === null ? null : Date.now() - input.capturedAt;
    const fresh = ageMs === null || ageMs <= COMPANION_VISION_FRESH_MS;
    const presenceDetected = input.vision.faceCount > 0
      || input.vision.handCount > 0
      || input.vision.poseCount > 0;
    const ok = input.vision.status === 'ok' && fresh && presenceDetected;

    return {
      label: 'Vision',
      value: fresh
        ? presenceDetected
          ? mediaPipeVisionSummary(input.vision)
          : `No presence / ${mediaPipeVisionSummary(input.vision)}`
        : `Stale MediaPipe / ${formatAge(ageMs)}`,
      ok,
    };
  }

  const capable = input.cameraAvailable || input.rendererCameraCapable;
  return {
    label: 'Vision',
    value: capable ? 'Camera ready for inspection' : 'Camera unavailable',
    ok: capable,
  };
}

function companionDialogueSignal(snapshot: VoiceConversationSnapshot | null): CompanionPulseSignal {
  if (!snapshot) {
    return {
      label: 'Dialogue',
      value: 'No voice session',
      ok: false,
    };
  }

  if (snapshot.phase === 'error') {
    return {
      label: 'Dialogue',
      value: snapshot.lastError ? `Error / ${snapshot.lastError}` : voiceConversationValue(snapshot),
      ok: false,
    };
  }

  if (snapshot.pendingInterruption) {
    const reason = snapshot.lastInterruptionReason ? ` / ${snapshot.lastInterruptionReason}` : '';
    const interruptions = snapshot.interruptionCount > 0
      ? ` / ${snapshot.interruptionCount} interrupt${snapshot.interruptionCount === 1 ? '' : 's'}`
      : '';
    return {
      label: 'Dialogue',
      value: `Interruption pending${reason}${interruptions}`,
      ok: false,
      recoveryHint: snapshot.resumeInstruction,
    };
  }

  const ageMs = Number.isFinite(snapshot.updatedAt) ? Date.now() - snapshot.updatedAt : null;
  if (ageMs === null || ageMs > COMPANION_DIALOGUE_FRESH_MS) {
    return {
      label: 'Dialogue',
      value: `Stale / ${snapshot.phase} ${ageMs === null ? 'unknown age' : formatAge(ageMs)}`,
      ok: false,
    };
  }

  return {
    label: 'Dialogue',
    value: voiceConversationValue(snapshot),
    ok: true,
  };
}

function buildCompanionPulse(input: {
  status: CompanionStatus | null;
  stats: CompanionPerceptStats | null;
  percepts: CompanionPercept[];
  voiceDiagnostics: VoiceDiagnostics | null;
  voiceRuntime: RuntimeVoiceStatus | null;
  ttsRuntime: RuntimeVoiceStatus | null;
  vision: CompanionMediaPipeVisionAnalysis | null;
  visionCapturedAt: number | null;
  rendererCameraCapable: boolean;
  voiceConversation: VoiceConversationSnapshot | null;
  sync: CompanionSyncState | null;
}): CompanionPulse | null {
  const { status } = input;
  if (!status) return null;

  const brainReady = status.chatGptCredentialsPresent
    && status.identity.soulIsCompanion
    && status.identity.bootIsCompanion;
  const voiceSignal = companionVoiceSignal({
    status,
    diagnostics: input.voiceDiagnostics,
    runtime: input.voiceRuntime,
    ttsRuntime: input.ttsRuntime,
  });
  const wakeSignal = companionWakeSignal(status);
  const visionSignal = companionVisionSignal({
    vision: input.vision,
    capturedAt: input.visionCapturedAt,
    cameraAvailable: status.camera.available,
    rendererCameraCapable: input.rendererCameraCapable,
  });
  const dialogueSignal = companionDialogueSignal(input.voiceConversation);
  const contextSignal = companionContextFreshness({
    percepts: input.percepts,
    stats: input.stats,
  });
  const syncSignal = companionSyncSignal(input.sync);

  const signals: CompanionPulseSignal[] = [
    {
      label: 'Brain',
      value: brainReady ? status.model : 'ChatGPT login or identity incomplete',
      ok: brainReady,
    },
    ...(syncSignal ? [syncSignal] : []),
    voiceSignal,
    wakeSignal,
    visionSignal,
    dialogueSignal,
    contextSignal,
  ];
  const readyCount = signals.filter((signal) => signal.ok).length;
  let action: {
    nextAction: string;
    nextActionKey: CompanionPulseAction;
    nextActionLabel: string;
  };
  if (!brainReady) {
    action = {
      nextAction: 'Activate companion or connect ChatGPT before asking Buddy to act.',
      nextActionKey: 'activate',
      nextActionLabel: 'Activate companion',
    };
  } else if (syncSignal) {
    action = {
      nextAction: 'Retry companion sync so Buddy refreshes the cockpit before acting.',
      nextActionKey: 'retrySync',
      nextActionLabel: 'Retry companion sync',
    };
  } else if (!voiceSignal.ok) {
    action = {
      nextAction: 'Run Inspect voice and follow the recovery cues before starting a spoken loop.',
      nextActionKey: 'inspectVoice',
      nextActionLabel: 'Inspect voice',
    };
  } else if (!wakeSignal.ok) {
    action = {
      nextAction: 'Run Inspect voice or configure wake word so Buddy can hear spoken instructions hands-free.',
      nextActionKey: 'inspectVoice',
      nextActionLabel: 'Inspect voice',
    };
  } else if (!visionSignal.ok) {
    action = {
      nextAction: 'Run Inspect camera so Buddy can refresh its local visual context.',
      nextActionKey: 'inspectCamera',
      nextActionLabel: 'Inspect camera',
    };
  } else if (!contextSignal.ok) {
    action = {
      nextAction: 'Record self-state so Buddy refreshes its local context before acting.',
      nextActionKey: 'recordSelf',
      nextActionLabel: 'Record self-state',
    };
  } else if (!dialogueSignal.ok) {
    action = {
      nextAction: dialogueSignal.recoveryHint
        ?? 'Open voice chat or start listening before expecting bidirectional dialogue.',
      nextActionKey: 'openVoiceChat',
      nextActionLabel: 'Open voice chat',
    };
  } else {
    action = {
      nextAction: 'Keep working with Buddy; run a check-in when you want a spoken status.',
      nextActionKey: 'checkIn',
      nextActionLabel: 'Buddy check-in',
    };
  }

  return {
    ok: readyCount === signals.length,
    title: readyCount === signals.length ? 'Buddy pulse steady' : 'Buddy pulse needs attention',
    summary: `${readyCount}/${signals.length} companion systems ready`,
    ...action,
    signals,
  };
}

function companionPulseSpeech(pulse: CompanionPulse, syncDetail?: string): string {
  const spokenSignals = pulse.signals
    .map((signal) => `${signal.label}: ${signal.value}${signal.ok ? '' : ', needs attention'}`)
    .join('. ');
  const spokenSync = syncDetail ? ` Sync: ${syncDetail}` : '';
  return `${pulse.title}. ${pulse.summary}. ${spokenSignals}.${spokenSync} Next: ${pulse.nextAction}`;
}

function CompanionPulsePanel({
  pulse,
  actionDisabled,
  syncDetail,
  onRunAction,
}: {
  pulse: CompanionPulse;
  actionDisabled: boolean;
  syncDetail?: string;
  onRunAction: (action: CompanionPulseAction) => void;
}) {
  const spokenPulse = companionPulseSpeech(pulse, syncDetail);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="companion-pulse"
      className={`rounded border px-3 py-3 ${
        pulse.ok ? 'border-accent/30 bg-accent/5' : 'border-warning/35 bg-warning/10'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Activity className={`h-4 w-4 shrink-0 ${pulse.ok ? 'text-accent' : 'text-warning'}`} />
          <span className="truncate text-sm font-semibold text-text-primary">{pulse.title}</span>
        </div>
        <span className="shrink-0 text-[10px] text-text-muted">{pulse.summary}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {pulse.signals.map((signal) => (
          <div
            key={signal.label}
            aria-label={`${signal.label}: ${signal.value}; ${signal.ok ? 'ready' : 'needs attention'}`}
            className="min-w-0 rounded border border-border bg-background/60 px-2 py-1.5"
          >
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${signal.ok ? 'bg-accent' : 'bg-warning'}`} />
              <span className="text-[10px] font-semibold uppercase text-text-muted">{signal.label}</span>
            </div>
            <div className="mt-1 truncate text-xs text-text-primary" title={signal.value}>{signal.value}</div>
          </div>
        ))}
      </div>
      <div
        data-testid="companion-pulse-next"
        className="mt-2 flex items-center justify-between gap-2 rounded border border-border bg-background/60 px-2 py-1.5 text-xs text-text-secondary"
      >
        <span className="min-w-0">
          <span className="font-medium text-text-primary">Next:</span> {pulse.nextAction}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {pulse.nextActionKey && pulse.nextActionLabel && (
            <button
              type="button"
              data-testid="companion-pulse-action"
              disabled={actionDisabled}
              onClick={() => onRunAction(pulse.nextActionKey!)}
              title={pulse.nextAction}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              {pulse.nextActionLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => void speakText(spokenPulse)}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-primary hover:bg-surface"
          >
            <Volume2 className="h-3.5 w-3.5" />
            Speak pulse
          </button>
        </div>
      </div>
    </div>
  );
}

function voiceDiagnosticIssues(diagnostics: VoiceDiagnostics): VoiceDiagnosticIssue[] {
  const issues: VoiceDiagnosticIssue[] = [];
  if (!diagnostics.ok) {
    issues.push({
      id: 'diagnostics',
      label: 'diagnostic check failed',
      recommendation: 'Run Inspect voice again after checking the local voice services.',
    });
  }
  if (!diagnostics.stt.available) {
    issues.push({
      id: 'stt-route',
      label: 'STT route offline',
      detail: diagnostics.stt.bootError ?? `provider ${diagnostics.stt.provider} did not become ready`,
      recommendation: 'Start the selected speech-to-text provider or switch voice input to a working fallback.',
    });
  }
  if (!diagnostics.tts.available) {
    issues.push({
      id: 'tts-route',
      label: 'TTS route offline',
      detail: diagnostics.tts.bootError ?? `provider ${diagnostics.tts.provider} did not become ready`,
      recommendation: 'Start the selected text-to-speech provider or switch voice output to a working fallback.',
    });
  }
  if (!diagnostics.stt.fallbackAvailable) {
    issues.push({
      id: 'stt-fallback',
      label: `${diagnostics.stt.fallbackProvider} fallback offline`,
      recommendation: 'Restore the STT fallback so Buddy can keep listening if the primary route drops.',
    });
  }
  if (!diagnostics.tts.fallbackAvailable) {
    issues.push({
      id: 'tts-fallback',
      label: `${diagnostics.tts.fallbackProvider} fallback offline`,
      recommendation: 'Restore the TTS fallback so Buddy can keep speaking if the primary route drops.',
    });
  }
  if (diagnostics.kyutai?.sttEnabled && diagnostics.kyutai.sttProbe?.ok === false) {
    issues.push({
      id: 'kyutai-stt',
      label: 'Kyutai STT offline',
      detail: diagnostics.kyutai.sttProbe.error ?? diagnostics.kyutai.sttProbe.endpoint,
      recommendation: 'Start the Kyutai ASR streaming endpoint or disable Kyutai STT for now.',
    });
  }
  if (diagnostics.kyutai?.ttsEnabled && diagnostics.kyutai.ttsProbe?.ok === false) {
    issues.push({
      id: 'kyutai-tts',
      label: 'Kyutai TTS offline',
      detail: diagnostics.kyutai.ttsProbe.error ?? diagnostics.kyutai.ttsProbe.endpoint,
      recommendation: 'Start the Kyutai TTS streaming endpoint or disable Kyutai TTS for now.',
    });
  }
  if (diagnostics.kyutai && !diagnostics.kyutai.ffmpegFound) {
    issues.push({
      id: 'ffmpeg',
      label: 'ffmpeg missing',
      detail: `${diagnostics.kyutai.ffmpegBinary} was not found for streaming audio conversion`,
      recommendation: 'Install ffmpeg or configure a valid ffmpeg binary path before streaming audio.',
    });
  }
  return issues;
}

function voiceDiagnosticsSummary(diagnostics: VoiceDiagnostics): { ok: boolean; text: string } {
  const issues = voiceDiagnosticIssues(diagnostics);

  if (issues.length === 0) {
    return {
      ok: true,
      text: 'Voice path ready: input, output, and fallbacks are available.',
    };
  }

  const labels = issues.map((issue) => issue.label);
  return {
    ok: false,
    text: `Needs attention: ${labels.slice(0, 4).join('; ')}${labels.length > 4 ? '; ...' : ''}`,
  };
}

function VoiceDiagnosticsIssueList({ diagnostics }: { diagnostics: VoiceDiagnostics }) {
  const issues = voiceDiagnosticIssues(diagnostics);
  if (issues.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="voice-diagnostics-actions"
      className="rounded border border-warning/30 bg-warning/5 px-3 py-2"
    >
      <div className="text-[11px] font-semibold uppercase text-text-muted">Recovery cues</div>
      <ul className="mt-2 space-y-1">
        {issues.map((issue) => (
          <li key={issue.id} className="flex items-start gap-2 text-xs text-text-secondary">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span>
              <span className="font-medium text-text-primary">{issue.label}</span>
              {issue.detail && <span className="text-text-muted"> - {issue.detail}</span>}
              <span className="block text-[11px] text-text-muted">{issue.recommendation}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VoiceDiagnosticsSummaryBanner({ diagnostics }: { diagnostics: VoiceDiagnostics }) {
  const summary = voiceDiagnosticsSummary(diagnostics);
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="voice-diagnostics-summary"
      className={`rounded border px-3 py-2 text-xs ${
        summary.ok
          ? 'border-accent/30 bg-accent/5 text-text-secondary'
          : 'border-warning/40 bg-warning/10 text-warning'
      }`}
    >
      {summary.text}
    </div>
  );
}

function StatusTile({
  icon: Icon,
  label,
  value,
  ok,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  ok: boolean;
}) {
  const testId = `status-tile-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div
      data-testid={testId}
      className="rounded border border-border bg-surface/40 px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${ok ? 'text-accent' : 'text-warning'}`} />
        <span className="text-[11px] font-semibold uppercase text-text-muted">{label}</span>
      </div>
      <div className="mt-1 break-words text-sm font-medium text-text-primary">{value}</div>
    </div>
  );
}

function payloadPath(percept: CompanionPercept): string | null {
  const value = percept.payload?.path;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function PerceptRow({ percept }: { percept: CompanionPercept }) {
  const Icon = MODALITY_ICON[percept.modality] ?? Activity;
  const path = payloadPath(percept);

  return (
    <div className="rounded border border-border bg-surface/35 p-3" data-testid="companion-percept">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-accent" />
            <span className="text-xs font-semibold text-text-primary">
              {percept.modality}/{percept.source}
            </span>
            <span className="text-[10px] text-text-muted">
              {Math.round(percept.confidence * 100)}%
            </span>
          </div>
          <p className="mt-1 text-xs text-text-secondary whitespace-pre-wrap">{percept.summary}</p>
          {path && (
            <button
              onClick={() => void window.electronAPI?.showItemInFolder(path)}
              className="mt-2 inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {path}
            </button>
          )}
          {percept.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {percept.tags.map((tag) => (
                <span key={tag} className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <time className="shrink-0 text-[10px] text-text-muted">
          {new Date(percept.timestamp).toLocaleString()}
        </time>
      </div>
    </div>
  );
}

function SafetyEventRow({ event }: { event: CompanionSafetyEvent }) {
  const artifact = event.artifactPath;
  return (
    <div className="rounded border border-border bg-surface/35 p-3" data-testid="companion-safety-event">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className={`h-4 w-4 ${event.risk === 'high' ? 'text-warning' : 'text-accent'}`} />
            <span className="text-xs font-semibold text-text-primary">{event.action}</span>
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
              {event.kind}
            </span>
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
              {event.risk}
            </span>
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
              {event.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-secondary whitespace-pre-wrap">{event.reason}</p>
          {artifact && (
            <button
              onClick={() => void window.electronAPI?.showItemInFolder(artifact)}
              className="mt-2 inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface"
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{artifact}</span>
            </button>
          )}
        </div>
        <time className="shrink-0 text-[10px] text-text-muted">
          {new Date(event.timestamp).toLocaleString()}
        </time>
      </div>
    </div>
  );
}

function priorityColor(priority: 'low' | 'medium' | 'high'): string {
  if (priority === 'high') return 'text-warning';
  if (priority === 'medium') return 'text-accent';
  return 'text-text-muted';
}

function CompanionCardRow({
  card,
  busy,
  onStatus,
}: {
  card: CompanionCard;
  busy: boolean;
  onStatus: (cardId: string, status: CompanionCardStatus) => void;
}) {
  return (
    <div className="rounded border border-border bg-surface/35 p-3" data-testid="companion-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ListChecks className="h-4 w-4 text-accent" />
            <span className={`text-[10px] font-semibold uppercase ${priorityColor(card.priority)}`}>
              {card.priority}
            </span>
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
              {card.kind}
            </span>
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
              {card.status}
            </span>
          </div>
          <p className="mt-1 text-xs font-medium text-text-primary">{card.title}</p>
          {card.body && <p className="mt-1 text-xs text-text-secondary whitespace-pre-wrap">{card.body}</p>}
          {card.actions.length > 0 && (
            <div className="mt-2 space-y-1">
              {card.actions.slice(0, 3).map((action) => (
                <div key={action.id} className="rounded bg-background px-2 py-1">
                  <span className="text-[11px] font-medium text-text-primary">{action.label}</span>
                  {action.command && (
                    <code className="mt-1 block truncate text-[10px] text-text-muted">{action.command}</code>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {card.status === 'open' && (
          <div className="flex shrink-0 flex-col gap-1">
            <button
              disabled={busy}
              onClick={() => onStatus(card.id, 'resolved')}
              className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
            >
              Resolve
            </button>
            <button
              disabled={busy}
              onClick={() => onStatus(card.id, 'dismissed')}
              className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function GatewayChannelRow({
  channel,
  busy,
  onUpdate,
}: {
  channel: CompanionGatewayProfile['channels'][number];
  busy: boolean;
  onUpdate: (
    channel: string,
    updates: {
      enabled?: boolean;
      mode?: CompanionGatewayMode;
      allowOutbound?: boolean;
      requireApprovalForTools?: boolean;
    },
  ) => void;
}) {
  return (
    <div className="rounded border border-border bg-surface/35 p-3" data-testid="companion-gateway-channel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Radio className={`h-4 w-4 ${channel.enabled ? 'text-accent' : 'text-text-muted'}`} />
            <span className="text-xs font-semibold text-text-primary">{channel.channel}</span>
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
              {channel.enabled ? channel.mode : 'paused'}
            </span>
            {channel.allowOutbound && (
              <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
                outbound
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-text-muted">
            {channel.requireApprovalForTools ? 'Tool approval on' : 'Tool approval off'} · {channel.recordPercepts ? 'percepts on' : 'percepts off'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <button
            disabled={busy}
            onClick={() => onUpdate(channel.channel, {
              enabled: true,
              mode: 'observe',
              allowOutbound: false,
              requireApprovalForTools: true,
            })}
            className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
          >
            Observe
          </button>
          <button
            disabled={busy}
            onClick={() => onUpdate(channel.channel, {
              enabled: true,
              mode: 'assist',
              allowOutbound: false,
              requireApprovalForTools: true,
            })}
            className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
          >
            Assist
          </button>
          <button
            disabled={busy}
            onClick={() => onUpdate(channel.channel, {
              enabled: true,
              mode: 'act',
              allowOutbound: true,
              requireApprovalForTools: true,
            })}
            className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
          >
            Act
          </button>
          <button
            disabled={busy}
            onClick={() => onUpdate(channel.channel, { enabled: false })}
            className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
          >
            Pause
          </button>
        </div>
      </div>
    </div>
  );
}

function GatewayInboxPreview({
  inbox,
  busy,
  onDraft,
}: {
  inbox: CompanionGatewayInbox;
  busy: boolean;
  onDraft: (itemId: string) => void;
}) {
  const items = inbox.items.slice(0, 5);
  return (
    <section className="space-y-3" data-testid="companion-gateway-inbox">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Gateway inbox</h3>
        <span className="text-[10px] text-text-muted">
          {inbox.counts.queued} queued
        </span>
      </div>
      <div
        className="grid grid-cols-2 gap-2"
        data-testid="companion-gateway-inbox-counts"
      >
        <StatusTile icon={Radio} label="Queued" value={String(inbox.counts.queued)} ok={inbox.counts.queued === 0} />
        <StatusTile icon={AlertCircle} label="High" value={String(inbox.counts.highPriority)} ok={inbox.counts.highPriority === 0} />
        <StatusTile icon={Activity} label="Total" value={String(inbox.counts.total)} ok />
        <StatusTile icon={ShieldCheck} label="Dispatch" value={inbox.safety.autoDispatch ? 'auto' : 'review'} ok={!inbox.safety.autoDispatch} />
      </div>
      {items.length === 0 ? (
        <div className="rounded border border-border bg-surface/35 px-3 py-6 text-center text-xs text-text-muted">
          No gateway messages waiting for review.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded border border-border bg-surface/35 p-3"
              data-testid="companion-gateway-inbox-item"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Radio className="h-4 w-4 text-accent" />
                    <span className="text-xs font-semibold text-text-primary">{item.channel}</span>
                    <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
                      {item.priority}
                    </span>
                    <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
                      {item.status}
                    </span>
                    <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
                      {item.mode}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-text-muted">
                    {item.sender.name || item.sender.id} · {item.proposedAction.label}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-[10px] text-text-muted">
                    {new Date(item.receivedAt).toLocaleTimeString()}
                  </span>
                  {item.status === 'queued' && item.proposedAction.requiresLocalApproval && (
                    <button
                      disabled={busy}
                      onClick={() => onDraft(item.id)}
                      className="rounded border border-accent/50 px-2 py-1 text-[10px] text-accent hover:bg-accent/10 disabled:opacity-50"
                    >
                      Prepare draft
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-text-secondary">{item.content.preview}</p>
              {item.draft && (
                <button
                  onClick={() => void window.electronAPI.showItemInFolder(item.draft!.taskFile)}
                  className="mt-2 inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-text-muted hover:bg-surface"
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{item.draft.command.join(' ')}</span>
                </button>
              )}
              <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-text-muted">
                <span className="rounded bg-background px-1.5 py-0.5">
                  {item.proposedAction.requiresLocalApproval ? 'local approval' : 'observe only'}
                </span>
                <span className="rounded bg-background px-1.5 py-0.5">
                  {item.safety.secretRedaction}
                </span>
                {item.safety.rawTextStored === false && (
                  <span className="rounded bg-background px-1.5 py-0.5">preview only</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {inbox.storePath && (
        <button
          onClick={() => void window.electronAPI.showItemInFolder(inbox.storePath)}
          className="inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface"
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{inbox.storePath}</span>
        </button>
      )}
    </section>
  );
}

function SkillCandidateRow({
  candidate,
  busy,
  onPromote,
  onDismiss,
}: {
  candidate: CompanionSkillCandidate;
  busy: boolean;
  onPromote: (candidateId: string) => void;
  onDismiss: (candidateId: string) => void;
}) {
  return (
    <div className="rounded border border-border bg-surface/35 p-3" data-testid="companion-skill-candidate">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <span className="text-xs font-semibold text-text-primary">{candidate.title}</span>
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
              {candidate.status}
            </span>
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
              {candidate.score}/100
            </span>
          </div>
          <p className="mt-1 text-xs text-text-secondary">{candidate.trigger}</p>
          {candidate.command && (
            <code className="mt-2 block truncate rounded bg-background px-1.5 py-1 text-[10px] text-text-muted">
              {candidate.command}
            </code>
          )}
          {candidate.artifactPath && (
            <button
              onClick={() => void window.electronAPI.showItemInFolder(candidate.artifactPath!)}
              className="mt-2 inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface"
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{candidate.artifactPath}</span>
            </button>
          )}
        </div>
        {candidate.status !== 'promoted' && candidate.status !== 'dismissed' && (
          <div className="flex shrink-0 flex-col gap-1">
            <button
              disabled={busy}
              onClick={() => onPromote(candidate.id)}
              className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
            >
              Promote
            </button>
            <button
              disabled={busy}
              onClick={() => onDismiss(candidate.id)}
              className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function CompanionPanel() {
  const show = useAppStore((s) => s.showCompanionPanel);
  const setShow = useAppStore((s) => s.setShowCompanionPanel);

  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [stats, setStats] = useState<CompanionPerceptStats | null>(null);
  const [percepts, setPercepts] = useState<CompanionPercept[]>([]);
  const [evaluation, setEvaluation] = useState<CompanionSelfEvaluation | null>(null);
  const [radar, setRadar] = useState<CompanionCompetitiveRadar | null>(null);
  const [improvementCycle, setImprovementCycle] = useState<CompanionImprovementCycle | null>(null);
  const [impulses, setImpulses] = useState<CompanionImpulseBrief | null>(null);
  const [checkIn, setCheckIn] = useState<CompanionCheckInCue | null>(null);
  const [missions, setMissions] = useState<CompanionMission[]>([]);
  const [missionRun, setMissionRun] = useState<CompanionMissionRunResult | null>(null);
  const [safetyEvents, setSafetyEvents] = useState<CompanionSafetyEvent[]>([]);
  const [safetyStats, setSafetyStats] = useState<CompanionSafetyLedgerStats | null>(null);
  const [cards, setCards] = useState<CompanionCard[]>([]);
  const [gateway, setGateway] = useState<CompanionGatewayProfile | null>(null);
  const [gatewayInbox, setGatewayInbox] = useState<CompanionGatewayInbox | null>(null);
  const [gatewayDraft, setGatewayDraft] = useState<CompanionGatewayInboxDraft | null>(null);
  const [skillCandidates, setSkillCandidates] = useState<CompanionSkillCandidate[]>([]);
  const [skillCuratorResult, setSkillCuratorResult] = useState<CompanionSkillCuratorResult | null>(null);
  const [setupResult, setSetupResult] = useState<CompanionSetupResponse | null>(null);
  const [voiceConversation, setVoiceConversation] = useState<VoiceConversationSnapshot | null>(null);
  const [voiceRuntime, setVoiceRuntime] = useState<RuntimeVoiceStatus | null>(null);
  const [ttsRuntime, setTtsRuntime] = useState<RuntimeVoiceStatus | null>(null);
  const [voiceDiagnostics, setVoiceDiagnostics] = useState<VoiceDiagnostics | null>(null);
  const [privacyReport, setPrivacyReport] = useState<CompanionPrivacyReport | null>(null);
  const [privacyExport, setPrivacyExport] = useState<CompanionPrivacyExportResult | null>(null);
  const [privacyPurge, setPrivacyPurge] = useState<CompanionPrivacyPurgeResult | null>(null);
  const [modality, setModality] = useState<CompanionPerceptModality | 'all'>('all');
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<'setup' | 'self' | 'camera' | 'cameraInspect' | 'voiceDiagnostics' | 'evaluate' | 'radar' | 'improve' | 'impulses' | 'checkIn' | 'missions' | 'runNext' | 'mission' | 'card' | 'gateway' | 'gatewayDraft' | 'skills' | 'skill' | 'privacyExport' | 'privacyPurge' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSnapshot, setLastSnapshot] = useState<CompanionCameraSnapshotResult | null>(null);
  const [lastInspection, setLastInspection] = useState<CompanionCameraInspectionResult | null>(null);
  const [lastSync, setLastSync] = useState<CompanionSyncState | null>(null);
  const busyActionRef = useRef<typeof busyAction>(null);
  const refreshInFlightRef = useRef(false);
  const rendererCameraCapable = canUseRendererCamera();

  const captureRendererSnapshot = async (): Promise<CompanionCameraSnapshotResult> => {
    const frame = await captureRendererCameraFrame();
    const res = await window.electronAPI.companion.cameraRendererSnapshot({
      dataUrl: frame.dataUrl,
      mediaType: frame.mediaType,
      width: frame.width,
      height: frame.height,
      mediaPipe: frame.mediaPipe,
    });
    if (!res.ok || !res.result) {
      throw new Error(res.error ?? 'Renderer camera snapshot failed');
    }
    return {
      ...res.result,
      mediaPipe: frame.mediaPipe,
      capturedAt: Date.now(),
    };
  };

  const filteredStats = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.byModality).sort(([a], [b]) => a.localeCompare(b));
  }, [stats]);

  const refresh = useCallback(async (modalityOverride?: CompanionPerceptModality | 'all') => {
    if (!window.electronAPI?.companion || refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const activeModality = modalityOverride ?? modality;
      const selected = activeModality === 'all' ? undefined : activeModality;
      const [
        statusRes,
        recentRes,
        statsRes,
        impulsesRes,
        missionsRes,
        safetyRecentRes,
        safetyStatsRes,
        cardsRes,
        gatewayRes,
        gatewayInboxRes,
        skillsRes,
        voiceConversationRes,
        voiceRuntimeRes,
        ttsRuntimeRes,
        privacyRes,
      ] = await Promise.all([
        window.electronAPI.companion.status(),
        window.electronAPI.companion.recentPercepts({ limit: 30, modality: selected }),
        window.electronAPI.companion.perceptStats(),
        window.electronAPI.companion.impulses({ recordSuggestions: false }),
        window.electronAPI.companion.listMissions(),
        window.electronAPI.companion.recentSafetyEvents({ limit: 8 }),
        window.electronAPI.companion.safetyStats(),
        window.electronAPI.companion.listCards({ status: 'open', limit: 8 }),
        window.electronAPI.companion.gatewayProfile(),
        window.electronAPI.companion.gatewayInbox(),
        window.electronAPI.companion.listSkillCandidates(),
        window.electronAPI.voice.conversationStatus().catch(() => null),
        window.electronAPI.voice.status().catch(() => null),
        window.electronAPI.voice.ttsStatus().catch(() => null),
        window.electronAPI.companion.privacyReport(),
      ]);

      const partialFailure = !recentRes.ok
        || !statsRes.ok
        || !impulsesRes.ok
        || !missionsRes.ok
        || !safetyRecentRes.ok
        || !safetyStatsRes.ok
        || !cardsRes.ok
        || !gatewayRes.ok
        || !gatewayInboxRes.ok
        || !skillsRes.ok
        || !privacyRes.ok;
      setLastSync(statusRes.error === 'NO_ACTIVE_PROJECT'
        ? null
        : {
          at: Date.now(),
          status: !statusRes.ok
            ? 'failed'
            : partialFailure
              ? 'partial'
              : 'ok',
        });
      if (!statusRes.ok) {
        if (statusRes.error === 'NO_ACTIVE_PROJECT') {
          setStatus(null);
          setStats(null);
          setPercepts([]);
          setEvaluation(null);
          setRadar(null);
          setImprovementCycle(null);
          setImpulses(null);
          setCheckIn(null);
          setMissions([]);
          setMissionRun(null);
          setSafetyEvents([]);
          setSafetyStats(null);
          setCards([]);
          setGateway(null);
          setGatewayInbox(null);
          setGatewayDraft(null);
          setSkillCandidates([]);
          setSkillCuratorResult(null);
          setSetupResult(null);
          setVoiceDiagnostics(null);
          setPrivacyReport(null);
          setPrivacyExport(null);
          setPrivacyPurge(null);
          setLastSnapshot(null);
          setLastInspection(null);
        }
        setVoiceConversation(voiceConversationRes);
        setVoiceRuntime(voiceRuntimeRes);
        setTtsRuntime(ttsRuntimeRes);
        setPrivacyReport(privacyRes.ok ? privacyRes.report ?? null : null);
        setError(statusRes.error === 'NO_ACTIVE_PROJECT'
          ? 'Select a project before opening Buddy companion senses.'
          : statusRes.error ?? 'Failed to load companion status');
        return;
      }

      setStatus(statusRes.status ?? null);
      setPercepts(recentRes.ok ? recentRes.items : []);
      setStats(statsRes.ok ? statsRes.stats ?? null : null);
      setImpulses(impulsesRes.ok ? impulsesRes.brief ?? null : null);
      setMissions(missionsRes.ok ? missionsRes.items : []);
      setSafetyEvents(safetyRecentRes.ok ? safetyRecentRes.items : []);
      setSafetyStats(safetyStatsRes.ok ? safetyStatsRes.stats ?? null : null);
      setCards(cardsRes.ok ? cardsRes.items : []);
      setGateway(gatewayRes.ok ? gatewayRes.profile ?? null : null);
      setGatewayInbox(gatewayInboxRes.ok ? gatewayInboxRes.inbox ?? null : null);
      setSkillCandidates(skillsRes.ok ? skillsRes.items : []);
      setVoiceConversation(voiceConversationRes);
      setVoiceRuntime(voiceRuntimeRes);
      setTtsRuntime(ttsRuntimeRes);
      setPrivacyReport(privacyRes.ok ? privacyRes.report ?? null : null);
      if (partialFailure) {
        setError(recentRes.error
          ?? statsRes.error
          ?? impulsesRes.error
          ?? missionsRes.error
          ?? safetyRecentRes.error
          ?? safetyStatsRes.error
          ?? cardsRes.error
          ?? gatewayRes.error
          ?? gatewayInboxRes.error
          ?? skillsRes.error
          ?? privacyRes.error
          ?? 'Failed to load companion state');
      }
    } catch (err) {
      setLastSync({ at: Date.now(), status: 'failed' });
      setError(`Failed to refresh companion state: ${cameraErrorMessage(err)}`);
    } finally {
      refreshInFlightRef.current = false;
      setLoading(false);
    }
  }, [modality]);

  useEffect(() => {
    busyActionRef.current = busyAction;
  }, [busyAction]);

  const refreshIfIdle = useCallback(() => {
    if (busyActionRef.current !== null || refreshInFlightRef.current) return;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (show) void refresh();
  }, [show, refresh]);

  useEffect(() => {
    if (!show) return undefined;

    const timer = window.setInterval(refreshIfIdle, COMPANION_AUTO_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [show, refreshIfIdle]);

  useEffect(() => {
    if (!show || lastSync === null || lastSync.status === 'ok') return undefined;

    const timer = window.setTimeout(refreshIfIdle, COMPANION_RECOVERY_REFRESH_MS);

    return () => window.clearTimeout(timer);
  }, [lastSync, show, refreshIfIdle]);

  useEffect(() => {
    if (!show) return undefined;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') refreshIfIdle();
    };

    window.addEventListener('focus', refreshIfIdle);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', refreshIfIdle);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [show, refreshIfIdle]);

  const recordSelf = async () => {
    setBusyAction('self');
    setError(null);
    const res = await window.electronAPI.companion.recordSelf();
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Self-state recording failed');
      return;
    }
    await refresh();
  };

  const activateCompanion = async () => {
    setBusyAction('setup');
    setError(null);
    const res = await window.electronAPI.companion.setup({
      configureVoice: true,
      configureModel: true,
      recordSelf: true,
    });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Companion activation failed');
      return;
    }
    setSetupResult(res.result ?? null);
    if (res.result?.setup.status) {
      setStatus(res.result.setup.status);
    }
    await refresh();
  };

  const captureCamera = async () => {
    setBusyAction('camera');
    setError(null);
    let rendererError: string | null = null;

    if (rendererCameraCapable) {
      try {
        const snapshot = await captureRendererSnapshot();
        setBusyAction(null);
        setLastSnapshot(snapshot);
        await refresh();
        return;
      } catch (err) {
        if (isCameraPermissionDenied(err)) {
          setBusyAction(null);
          setError(`Camera permission denied: ${cameraErrorMessage(err)}`);
          return;
        }
        rendererError = cameraErrorMessage(err);
      }
    }

    const res = await window.electronAPI.companion.cameraSnapshot({ timeoutMs: 10000 });
    setBusyAction(null);
    if (!res.ok) {
      setError(
        rendererError
          ? `Renderer camera unavailable: ${rendererError}. ${res.error ?? 'Camera snapshot failed'}`
          : res.error ?? 'Camera snapshot failed',
      );
      return;
    }
    setLastSnapshot(withCaptureTimestamp(res.result));
    await refresh();
  };

  const inspectCamera = async () => {
    setBusyAction('cameraInspect');
    setError(null);
    let snapshot = lastSnapshot;
    let rendererError: string | null = null;

    if (!snapshot?.path && rendererCameraCapable) {
      try {
        snapshot = await captureRendererSnapshot();
        setLastSnapshot(snapshot);
      } catch (err) {
        if (isCameraPermissionDenied(err)) {
          setBusyAction(null);
          setError(`Camera permission denied: ${cameraErrorMessage(err)}`);
          return;
        }
        rendererError = cameraErrorMessage(err);
      }
    }

    const res = await window.electronAPI.companion.cameraInspect({
      imagePath: snapshot?.path,
      timeoutMs: 10000,
    });
    setBusyAction(null);
    if (!res.ok) {
      setError(
        rendererError
          ? `Renderer camera unavailable: ${rendererError}. ${res.error ?? 'Camera inspection failed'}`
          : res.error ?? 'Camera inspection failed',
      );
      return;
    }
    const capturedAt = Date.now();
    const inspection = res.result
      ? {
        ...res.result,
        snapshot: withCaptureTimestamp(res.result.snapshot, capturedAt) ?? undefined,
      }
      : null;
    setLastInspection(inspection);
    if (inspection?.snapshot) setLastSnapshot(inspection.snapshot);
    await refresh();
  };

  const inspectVoice = async () => {
    setBusyAction('voiceDiagnostics');
    setError(null);
    try {
      const res = await window.electronAPI.voice.diagnostics();
      setVoiceDiagnostics(res);
      if (!res.ok) setError('Voice diagnostics failed');
      else {
        setModality('tool');
        await refresh('tool');
      }
    } catch (err) {
      setError(`Voice diagnostics failed: ${cameraErrorMessage(err)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const runEvaluation = async () => {
    setBusyAction('evaluate');
    setError(null);
    const res = await window.electronAPI.companion.evaluate({ recordSuggestions: true });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Self-evaluation failed');
      return;
    }
    setEvaluation(res.evaluation ?? null);
    await refresh();
  };

  const runRadar = async () => {
    setBusyAction('radar');
    setError(null);
    const res = await window.electronAPI.companion.radar({ recordSuggestions: true });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Competitive radar failed');
      return;
    }
    setRadar(res.radar ?? null);
    await refresh();
  };

  const runImprovementCycle = async () => {
    setBusyAction('improve');
    setError(null);
    const res = await window.electronAPI.companion.improve({
      recordSuggestions: true,
      runMission: true,
    });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Improvement cycle failed');
      return;
    }
    setImprovementCycle(res.cycle ?? null);
    if (res.cycle?.radar) setRadar(res.cycle.radar);
    if (res.cycle?.board) setMissions(res.cycle.board.missions);
    if (res.cycle?.missionRun) setMissionRun(res.cycle.missionRun);
    await refresh();
  };

  const runImpulses = async () => {
    setBusyAction('impulses');
    setError(null);
    const res = await window.electronAPI.companion.impulses({ recordSuggestions: true });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Companion impulses failed');
      return;
    }
    setImpulses(res.brief ?? null);
    await refresh();
  };

  const runCheckIn = async () => {
    setBusyAction('checkIn');
    setError(null);
    const res = await window.electronAPI.companion.checkIn();
    setBusyAction(null);
    if (!res.ok || !res.cue) {
      setError(res.error ?? 'Companion check-in failed');
      return;
    }
    setCheckIn(res.cue);
    await speakText(res.cue.spokenText);
    await refresh();
  };

  const syncMissions = async () => {
    setBusyAction('missions');
    setError(null);
    const res = await window.electronAPI.companion.syncMissions({ recordSuggestions: true });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Mission sync failed');
      return;
    }
    setMissions(res.result?.board.missions ?? []);
    await refresh();
  };

  const runNextMission = async () => {
    setBusyAction('runNext');
    setError(null);
    const res = await window.electronAPI.companion.runNextMission();
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Mission runner failed');
      return;
    }
    setMissionRun(res.result ?? null);
    await refresh();
  };

  const updateMission = async (missionId: string, status: CompanionMissionStatus) => {
    setBusyAction('mission');
    setError(null);
    const res = await window.electronAPI.companion.updateMission({ missionId, status });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Mission update failed');
      return;
    }
    await refresh();
  };

  const updateCard = async (cardId: string, status: CompanionCardStatus) => {
    setBusyAction('card');
    setError(null);
    const res = await window.electronAPI.companion.updateCard({ cardId, status });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Card update failed');
      return;
    }
    await refresh();
  };

  const updateGatewayChannel = async (
    channel: string,
    updates: {
      enabled?: boolean;
      mode?: CompanionGatewayMode;
      allowOutbound?: boolean;
      requireApprovalForTools?: boolean;
    },
  ) => {
    setBusyAction('gateway');
    setError(null);
    const res = await window.electronAPI.companion.updateGatewayChannel({
      channel,
      ...updates,
    });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Gateway update failed');
      return;
    }
    setGateway(res.profile ?? null);
    await refresh();
  };

  const draftGatewayInboxItem = async (itemId: string) => {
    setBusyAction('gatewayDraft');
    setError(null);
    const res = await window.electronAPI.companion.draftGatewayInboxItem({ itemId });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Gateway draft preparation failed');
      return;
    }
    setGatewayDraft(res.draft ?? null);
    setGatewayInbox(res.inbox ?? null);
    await refresh();
  };

  const curateSkills = async () => {
    setBusyAction('skills');
    setError(null);
    const res = await window.electronAPI.companion.curateSkills({ recordSuggestions: true });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Skill curation failed');
      return;
    }
    setSkillCuratorResult(res.result ?? null);
    setSkillCandidates(res.result?.store.candidates ?? []);
    await refresh();
  };

  const promoteSkill = async (candidateId: string) => {
    setBusyAction('skill');
    setError(null);
    const res = await window.electronAPI.companion.promoteSkillCandidate({ candidateId });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Skill promotion failed');
      return;
    }
    await refresh();
  };

  const dismissSkill = async (candidateId: string) => {
    setBusyAction('skill');
    setError(null);
    const res = await window.electronAPI.companion.dismissSkillCandidate({ candidateId });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Skill dismissal failed');
      return;
    }
    await refresh();
  };

  const exportPrivacy = async () => {
    setBusyAction('privacyExport');
    setError(null);
    const res = await window.electronAPI.companion.exportPrivacy();
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Privacy export failed');
      return;
    }
    setPrivacyExport(res.result ?? null);
    await refresh();
  };

  const purgePrivacy = async () => {
    const confirmed = window.confirm(
      'Purge Buddy companion memory for this workspace? A local backup export will be created first.',
    );
    if (!confirmed) return;
    setBusyAction('privacyPurge');
    setError(null);
    const res = await window.electronAPI.companion.purgePrivacy({ backup: true });
    setBusyAction(null);
    if (!res.ok) {
      setError(res.error ?? 'Privacy purge failed');
      return;
    }
    setPrivacyPurge(res.result ?? null);
    setPrivacyExport(res.result?.backup ?? privacyExport);
    await refresh();
  };

  const activeVisionSnapshot = lastInspection?.snapshot?.mediaPipe ? lastInspection.snapshot : lastSnapshot;
  const activeMediaPipeVision = activeVisionSnapshot?.mediaPipe ?? null;
  const voiceInputReadiness = status
    ? voiceDiagnostics
      ? voiceDiagnosticRouteReadiness(voiceDiagnostics.stt, voiceDiagnostics)
      : {
        value: `${ready(status.voice.enabled && (voiceRuntime?.available ?? status.voice.available))} / ${runtimeVoiceValue(status.voice.provider, voiceRuntime, 'sttEnabled')}`,
        ok: status.voice.enabled && (voiceRuntime?.available ?? status.voice.available),
      }
    : null;
  const voiceOutputReadiness = status
    ? voiceDiagnostics
      ? voiceDiagnosticRouteReadiness(voiceDiagnostics.tts, voiceDiagnostics)
      : {
        value: `${ready(status.tts.enabled && (ttsRuntime?.available ?? status.tts.available))} / ${runtimeVoiceValue(status.tts.provider, ttsRuntime, 'ttsEnabled')}`,
        ok: status.tts.enabled && (ttsRuntime?.available ?? status.tts.available),
      }
    : null;
  const wakeReadiness = status ? companionWakeSignal(status) : null;
  const visionReadiness = status
    ? companionVisionSignal({
      vision: activeMediaPipeVision,
      capturedAt: activeVisionSnapshot?.capturedAt ?? null,
      cameraAvailable: status.camera.available,
      rendererCameraCapable,
    })
    : null;
  const dialogueReadiness = companionDialogueSignal(voiceConversation);
  const companionPulse = buildCompanionPulse({
    status,
    stats,
    percepts,
    voiceDiagnostics,
    voiceRuntime,
    ttsRuntime,
    vision: activeMediaPipeVision,
    visionCapturedAt: activeVisionSnapshot?.capturedAt ?? null,
    rendererCameraCapable,
    voiceConversation,
    sync: lastSync,
  });
  const syncPresentation = lastSync ? companionSyncPresentation(lastSync) : null;
  const runPulseAction = (action: CompanionPulseAction) => {
    if (busyAction !== null) return;
    switch (action) {
      case 'activate':
        void activateCompanion();
        break;
      case 'retrySync':
        refreshIfIdle();
        break;
      case 'inspectVoice':
        void inspectVoice();
        break;
      case 'inspectCamera':
        void inspectCamera();
        break;
      case 'recordSelf':
        void recordSelf();
        break;
      case 'openVoiceChat':
        window.dispatchEvent(new Event('cowork:open-voice-chat'));
        break;
      case 'checkIn':
        void runCheckIn();
        break;
    }
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30 backdrop-blur-sm">
      <div className="flex h-full w-[640px] max-w-[calc(100vw-32px)] flex-col border-l border-border bg-background-secondary shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">Buddy companion</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void refresh()}
              className="rounded p-1 hover:bg-surface transition-colors"
              aria-label="Refresh companion panel"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 text-text-muted ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShow(false)}
              className="rounded p-1 hover:bg-surface transition-colors"
              aria-label="Close companion panel"
            >
              <X className="h-4 w-4 text-text-muted" />
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mx-4 mt-3 flex items-start gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Readiness</h3>
              <div className="flex min-w-0 flex-col items-end gap-0.5">
                {syncPresentation !== null && (
                  <div className="flex items-center gap-1">
                    <span
                      data-testid="companion-last-sync"
                      aria-label={syncPresentation.detail}
                      title={syncPresentation.detail}
                      className={`text-[10px] ${lastSync?.status === 'ok' ? 'text-text-muted' : 'text-warning'}`}
                    >
                      {syncPresentation.label}
                    </span>
                    {lastSync?.status !== 'ok' && (
                      <button
                        type="button"
                        onClick={refreshIfIdle}
                        disabled={busyAction !== null || loading}
                        aria-label="Retry companion sync"
                        title="Retry companion sync"
                        className="rounded p-0.5 text-warning hover:bg-warning/10 disabled:opacity-50"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
                {status?.cwd && <span className="max-w-[360px] truncate text-[10px] text-text-muted">{status.cwd}</span>}
              </div>
            </div>

            {status ? (
              <div className="grid grid-cols-2 gap-2">
                <StatusTile
                  icon={Brain}
                  label="Brain"
                  value={status.chatGptCredentialsPresent ? status.model : 'ChatGPT login missing'}
                  ok={status.chatGptCredentialsPresent}
                />
                <StatusTile
                  icon={Bot}
                  label="Identity"
                  value={status.identity.soulIsCompanion && status.identity.bootIsCompanion ? 'Companion identity' : 'Identity incomplete'}
                  ok={status.identity.soulIsCompanion && status.identity.bootIsCompanion}
                />
                <StatusTile
                  icon={Mic}
                  label="Voice input"
                  value={voiceInputReadiness?.value ?? 'Needs attention / voice input unavailable'}
                  ok={voiceInputReadiness?.ok ?? false}
                />
                <StatusTile
                  icon={Volume2}
                  label="Voice output"
                  value={voiceOutputReadiness?.value ?? 'Needs attention / voice output unavailable'}
                  ok={voiceOutputReadiness?.ok ?? false}
                />
                <StatusTile
                  icon={Activity}
                  label="Dialogue"
                  value={dialogueReadiness.value}
                  ok={dialogueReadiness.ok}
                />
                <StatusTile
                  icon={Camera}
                  label="Camera"
                  value={visionReadiness?.value ?? 'Camera unavailable'}
                  ok={visionReadiness?.ok ?? false}
                />
                <StatusTile
                  icon={Radio}
                  label="Wake word"
                  value={wakeReadiness?.value ?? 'Needs attention / wake word unavailable'}
                  ok={wakeReadiness?.ok ?? false}
                />
              </div>
            ) : (
              <div className="rounded border border-border bg-surface/35 px-3 py-6 text-center text-xs text-text-muted">
                {loading ? 'Loading companion state...' : 'No companion status loaded.'}
              </div>
            )}
            {companionPulse && (
              <CompanionPulsePanel
                pulse={companionPulse}
                actionDisabled={busyAction !== null || loading}
                syncDetail={syncPresentation?.detail}
                onRunAction={runPulseAction}
              />
            )}
          </section>

          <section className="flex flex-wrap gap-2">
            <button
              disabled={busyAction !== null}
              onClick={() => void activateCompanion()}
              className="inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <Bot className="h-4 w-4" />
              {busyAction === 'setup' ? 'Activating...' : 'Activate companion'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void recordSelf()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <Bot className="h-4 w-4" />
              {busyAction === 'self' ? 'Recording...' : 'Record self-state'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void captureCamera()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <Camera className="h-4 w-4" />
              {busyAction === 'camera' ? 'Capturing...' : 'Camera snapshot'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void inspectCamera()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <Eye className="h-4 w-4" />
              {busyAction === 'cameraInspect' ? 'Inspecting...' : 'Inspect camera'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void inspectVoice()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <Radio className="h-4 w-4" />
              {busyAction === 'voiceDiagnostics' ? 'Checking...' : 'Inspect voice'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void runEvaluation()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <ClipboardCheck className="h-4 w-4" />
              {busyAction === 'evaluate' ? 'Evaluating...' : 'Self-evaluate'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void runRadar()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <Radar className="h-4 w-4" />
              {busyAction === 'radar' ? 'Scanning...' : 'Competitive radar'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void runImprovementCycle()}
              className="inline-flex items-center gap-2 rounded border border-accent/50 px-3 py-2 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {busyAction === 'improve' ? 'Improving...' : 'Improve loop'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void runImpulses()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {busyAction === 'impulses' ? 'Thinking...' : 'Build impulses'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void runCheckIn()}
              className="inline-flex items-center gap-2 rounded border border-accent/50 px-3 py-2 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              <Volume2 className="h-4 w-4" />
              {busyAction === 'checkIn' ? 'Checking in...' : 'Buddy check-in'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void syncMissions()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <ListChecks className="h-4 w-4" />
              {busyAction === 'missions' ? 'Syncing...' : 'Sync missions'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void runNextMission()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              {busyAction === 'runNext' ? 'Preparing...' : 'Run next mission'}
            </button>
            <button
              disabled={busyAction !== null}
              onClick={() => void curateSkills()}
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {busyAction === 'skills' ? 'Curating...' : 'Curate routines'}
            </button>
            {lastSnapshot?.path && (
              <button
                onClick={() => void window.electronAPI.showItemInFolder(lastSnapshot.path!)}
                className="inline-flex min-w-0 items-center gap-2 rounded border border-border px-3 py-2 text-xs text-text-secondary hover:bg-surface"
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="truncate max-w-[260px]">{lastSnapshot.path}</span>
              </button>
            )}
          </section>

          {voiceDiagnostics && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Voice diagnostics</h3>
                <span className="text-[10px] text-text-muted">
                  {new Date(voiceDiagnostics.checkedAt).toLocaleTimeString()}
                </span>
              </div>
              <VoiceDiagnosticsSummaryBanner diagnostics={voiceDiagnostics} />
              <VoiceDiagnosticsIssueList diagnostics={voiceDiagnostics} />
              <div className="grid grid-cols-2 gap-2">
                <StatusTile
                  icon={Mic}
                  label="STT route"
                  value={routeDiagnosticValue(voiceDiagnostics.stt)}
                  ok={voiceDiagnostics.stt.available}
                />
                <StatusTile
                  icon={Volume2}
                  label="TTS route"
                  value={routeDiagnosticValue(voiceDiagnostics.tts)}
                  ok={voiceDiagnostics.tts.available}
                />
                {voiceDiagnostics.kyutai && (
                  <>
                    <StatusTile
                      icon={Radio}
                      label="Kyutai STT"
                      value={probeDiagnosticValue(
                        voiceDiagnostics.kyutai.sttEnabled,
                        voiceDiagnostics.kyutai.sttProbe,
                      )}
                      ok={!voiceDiagnostics.kyutai.sttEnabled || voiceDiagnostics.kyutai.sttProbe?.ok === true}
                    />
                    <StatusTile
                      icon={Radio}
                      label="Kyutai TTS"
                      value={probeDiagnosticValue(
                        voiceDiagnostics.kyutai.ttsEnabled,
                        voiceDiagnostics.kyutai.ttsProbe,
                      )}
                      ok={!voiceDiagnostics.kyutai.ttsEnabled || voiceDiagnostics.kyutai.ttsProbe?.ok === true}
                    />
                    <StatusTile
                      icon={Activity}
                      label="Audio tooling"
                      value={`${voiceDiagnostics.kyutai.ffmpegFound ? 'ffmpeg ready' : 'ffmpeg missing'} / ${voiceDiagnostics.kyutai.baseUrl.replace(/^wss?:\/\//, '')}`}
                      ok={voiceDiagnostics.kyutai.ffmpegFound}
                    />
                  </>
                )}
              </div>
            </section>
          )}

          {checkIn && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Check-in</h3>
                <span className="text-[10px] text-text-muted">{checkIn.mood} / {checkIn.priority}</span>
              </div>
              <div className="rounded border border-accent/30 bg-accent/5 p-3">
                <div className="flex items-start gap-2">
                  <Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text-primary">{checkIn.spokenText}</p>
                    {checkIn.sourceImpulseTitle && (
                      <p className="mt-1 text-[11px] text-text-muted">
                        From {checkIn.sourceImpulseTitle}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => void speakText(checkIn.spokenText)}
                    className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-xs text-text-primary hover:bg-surface"
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                    Speak
                  </button>
                  {checkIn.suggestedCommand && (
                    <span className="min-w-0 rounded bg-background px-2 py-1.5 text-[11px] text-text-muted">
                      <span className="truncate">{checkIn.suggestedCommand}</span>
                    </span>
                  )}
                </div>
              </div>
            </section>
          )}

          {lastInspection && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Vision inspection</h3>
                <span className="text-[10px] text-text-muted">
                  {lastInspection.analysis?.format || 'image'}
                  {lastInspection.analysis?.dimensions
                    ? ` / ${lastInspection.analysis.dimensions.width}x${lastInspection.analysis.dimensions.height}`
                    : ''}
                </span>
              </div>
              <div className="rounded border border-border bg-surface/35 p-3">
                <div className="flex items-start gap-2">
                  <Eye className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text-primary">{lastInspection.summary || 'Camera image inspected.'}</p>
                    {lastInspection.path && (
                      <button
                        onClick={() => void window.electronAPI.showItemInFolder(lastInspection.path!)}
                        className="mt-2 inline-flex max-w-full items-center gap-2 rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface"
                      >
                        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{lastInspection.path}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <MediaPipeVisionSummary analysis={activeMediaPipeVision} />
            </section>
          )}

          {setupResult && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Activation</h3>
                <span className="text-[10px] text-text-muted">
                  {setupResult.selfPercept ? 'self-state recorded' : 'setup complete'}
                </span>
              </div>
              <div className="rounded border border-border bg-surface/35 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Bot className="h-4 w-4 text-accent" />
                  <span className="text-xs font-semibold text-text-primary">
                    Companion identity {setupResult.setup.wroteSoul || setupResult.setup.wroteBoot ? 'installed' : 'already present'}
                  </span>
                  <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
                    voice {setupResult.setup.voiceConfigured ? 'configured' : 'skipped'}
                  </span>
                  <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
                    model {setupResult.setup.modelConfigured ? setupResult.setup.model : 'unchanged'}
                  </span>
                </div>
                {setupResult.selfPerceptError && (
                  <p className="mt-2 text-xs text-warning">{setupResult.selfPerceptError}</p>
                )}
              </div>
            </section>
          )}

          {improvementCycle && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Improvement loop</h3>
                <span className="text-[10px] text-text-muted">
                  {improvementCycle.radar.score}/100 / {improvementCycle.board.missions.length} mission(s)
                </span>
              </div>
              <div className="rounded border border-accent/30 bg-accent/5 p-3">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary">
                      {improvementCycle.missionRun?.mission
                        ? improvementCycle.missionRun.mission.title
                        : improvementCycle.missionRun?.message ?? 'Companion improvement cycle completed.'}
                    </p>
                    {improvementCycle.missionRun?.briefPath && (
                      <button
                        onClick={() => void window.electronAPI.showItemInFolder(improvementCycle.missionRun!.briefPath!)}
                        className="mt-2 inline-flex max-w-full items-center gap-2 rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface"
                      >
                        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{improvementCycle.missionRun.briefPath}</span>
                      </button>
                    )}
                    {improvementCycle.nextActions.length > 0 && (
                      <ul className="mt-3 space-y-1 text-xs text-text-secondary">
                        {improvementCycle.nextActions.slice(0, 3).map((action) => (
                          <li key={action} className="line-clamp-2">- {action}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {impulses && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Impulses</h3>
                <span className="text-[10px] text-text-muted">
                  {new Date(impulses.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="rounded border border-border bg-surface/35 p-3">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">{impulses.summary}</p>
                    <p className="mt-1 text-xs text-text-secondary whitespace-pre-wrap">{impulses.nextPrompt}</p>
                  </div>
                </div>
                {impulses.impulses.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {impulses.impulses.slice(0, 4).map((impulse) => (
                      <div key={impulse.id} className="rounded bg-background px-2 py-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-[10px] font-semibold uppercase ${
                            impulse.priority === 'high'
                              ? 'text-warning'
                              : impulse.priority === 'medium'
                                ? 'text-accent'
                                : 'text-text-muted'
                          }`}>
                            {impulse.priority}
                          </span>
                          <span className="text-[10px] uppercase text-text-muted">{impulse.kind}</span>
                          <span className="text-xs font-medium text-text-primary">{impulse.title}</span>
                        </div>
                        <p className="mt-1 text-xs text-text-secondary">{impulse.message}</p>
                        {impulse.command && (
                          <code className="mt-1 block truncate rounded bg-surface px-1.5 py-1 text-[10px] text-text-muted">
                            {impulse.command}
                          </code>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Companion cards</h3>
              <span className="text-[10px] text-text-muted">{cards.length} open</span>
            </div>
            {cards.length === 0 ? (
              <div className="rounded border border-border bg-surface/35 px-3 py-6 text-center text-xs text-text-muted">
                No open companion cards.
              </div>
            ) : (
              <div className="space-y-2">
                {cards.map((card) => (
                  <CompanionCardRow
                    key={card.id}
                    card={card}
                    busy={busyAction !== null}
                    onStatus={(cardId, nextStatus) => void updateCard(cardId, nextStatus)}
                  />
                ))}
              </div>
            )}
          </section>

          {gateway && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Gateway</h3>
                <span className="text-[10px] text-text-muted">
                  {gateway.channels.filter((channel) => channel.enabled).length}/{gateway.channels.length} enabled
                </span>
              </div>
              <div className="space-y-2">
                {gateway.channels.slice(0, 8).map((channel) => (
                  <GatewayChannelRow
                    key={channel.channel}
                    channel={channel}
                    busy={busyAction !== null}
                    onUpdate={(name, updates) => void updateGatewayChannel(name, updates)}
                  />
                ))}
              </div>
              {gateway.storePath && (
                <button
                  onClick={() => void window.electronAPI.showItemInFolder(gateway.storePath)}
                  className="inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface"
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{gateway.storePath}</span>
                </button>
              )}
            </section>
          )}

          {gatewayInbox && (
            <GatewayInboxPreview
              inbox={gatewayInbox}
              busy={busyAction !== null}
              onDraft={(itemId) => void draftGatewayInboxItem(itemId)}
            />
          )}

          {gatewayDraft && (
            <section className="space-y-3" data-testid="companion-gateway-draft">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Gateway draft</h3>
                <span className="text-[10px] text-text-muted">local approval</span>
              </div>
              <div className="rounded border border-border bg-surface/35 p-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-accent" />
                  <span className="text-sm font-semibold text-text-primary">{gatewayDraft.kind}</span>
                </div>
                <code className="mt-2 block break-words rounded bg-background px-2 py-1 text-[10px] text-text-muted">
                  {gatewayDraft.command.join(' ')}
                </code>
                <button
                  onClick={() => void window.electronAPI.showItemInFolder(gatewayDraft.taskFile)}
                  className="mt-2 inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface"
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{gatewayDraft.taskFile}</span>
                </button>
              </div>
            </section>
          )}

          {missionRun && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Mission run</h3>
                <span className="text-[10px] text-text-muted">
                  {missionRun.success ? 'prepared' : 'blocked'}
                </span>
              </div>
              <div className="rounded border border-border bg-surface/35 p-3">
                <div className="flex items-center gap-2">
                  <Play className="h-4 w-4 text-accent" />
                  <span className="text-sm font-semibold text-text-primary">{missionRun.message}</span>
                </div>
                {missionRun.mission && (
                  <p className="mt-2 text-xs text-text-secondary">
                    [{missionRun.mission.priority}] {missionRun.mission.title}
                  </p>
                )}
                {missionRun.briefPath && (
                  <button
                    onClick={() => void window.electronAPI.showItemInFolder(missionRun.briefPath!)}
                    className="mt-3 inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface"
                  >
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{missionRun.briefPath}</span>
                  </button>
                )}
              </div>
            </section>
          )}

          {evaluation && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Self-evaluation</h3>
                <span className="text-[10px] text-text-muted">
                  {new Date(evaluation.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="rounded border border-border bg-surface/35 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="h-4 w-4 text-accent" />
                    <span className="text-sm font-semibold text-text-primary">
                      {evaluation.score}/100
                    </span>
                    <span className="rounded bg-background px-2 py-0.5 text-[10px] uppercase text-text-muted">
                      {evaluation.level}
                    </span>
                  </div>
                  <span className="text-[10px] text-text-muted">
                    {evaluation.findings.length} finding(s)
                  </span>
                </div>
                {evaluation.nextActions.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {evaluation.nextActions.slice(0, 3).map((action) => (
                      <p key={action} className="text-xs text-text-secondary">
                        {action}
                      </p>
                    ))}
                  </div>
                )}
                {evaluation.findings.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {evaluation.findings.slice(0, 4).map((finding) => (
                      <div key={finding.id} className="rounded bg-background px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-semibold uppercase ${
                            finding.severity === 'action'
                              ? 'text-warning'
                              : finding.severity === 'warning'
                                ? 'text-warning'
                                : 'text-text-muted'
                          }`}>
                            {finding.severity}
                          </span>
                          <span className="text-[10px] uppercase text-text-muted">{finding.area}</span>
                        </div>
                        <p className="mt-1 text-xs text-text-primary">{finding.summary}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {radar && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Competitive radar</h3>
                <span className="text-[10px] text-text-muted">
                  {radar.score}/100
                </span>
              </div>
              <div className="rounded border border-border bg-surface/35 p-3">
                <div className="flex items-center gap-2">
                  <Radar className="h-4 w-4 text-accent" />
                  <span className="text-sm font-semibold text-text-primary">Hermes / OpenClaw / Lisa / UNI gaps</span>
                </div>
                {radar.nextMoves.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {radar.nextMoves.slice(0, 3).map((move) => (
                      <p key={move} className="text-xs text-text-secondary">
                        {move}
                      </p>
                    ))}
                  </div>
                )}
                <div className="mt-3 space-y-2">
                  {radar.gaps.slice(0, 4).map((gap) => (
                    <div key={gap.id} className="rounded bg-background px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold uppercase ${
                          gap.severity === 'gap' ? 'text-warning' : 'text-text-muted'
                        }`}>
                          {gap.severity}
                        </span>
                        <span className="text-[10px] uppercase text-text-muted">{gap.dimension}</span>
                        <span className="truncate text-[10px] text-text-muted">
                          {gap.competitorRefs.join(', ')}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-text-primary">{gap.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Mission board</h3>
              <span className="text-[10px] text-text-muted">
                {missions.length} mission(s)
              </span>
            </div>
            {missions.length === 0 ? (
              <div className="rounded border border-border bg-surface/35 px-3 py-6 text-center text-xs text-text-muted">
                Sync missions to turn the competitive radar into a working backlog.
              </div>
            ) : (
              <div className="space-y-2">
                {missions.slice(0, 5).map((mission) => (
                  <div key={mission.id} className="rounded border border-border bg-surface/35 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-background px-1.5 py-0.5 text-[10px] font-semibold text-text-muted">
                            {mission.priority}
                          </span>
                          <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-text-muted">
                            {mission.status}
                          </span>
                          <span className="text-[10px] uppercase text-text-muted">{mission.dimension}</span>
                        </div>
                        <p className="mt-1 text-xs font-medium text-text-primary">{mission.title}</p>
                        <p className="mt-1 text-xs text-text-secondary">{mission.recommendation}</p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        {mission.status === 'open' && (
                          <button
                            disabled={busyAction !== null}
                            onClick={() => void updateMission(mission.id, 'in_progress')}
                            className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
                          >
                            Start
                          </button>
                        )}
                        {mission.status === 'in_progress' && (
                          <button
                            disabled={busyAction !== null}
                            onClick={() => void updateMission(mission.id, 'done')}
                            className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary hover:bg-surface disabled:opacity-50"
                          >
                            Done
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Learned routines</h3>
              <span className="text-[10px] text-text-muted">
                {skillCandidates.length} candidate(s)
              </span>
            </div>
            {skillCuratorResult && (
              <div className="rounded border border-border bg-surface/35 p-3 text-xs text-text-secondary">
                {skillCuratorResult.created} created · {skillCuratorResult.updated} updated · {skillCuratorResult.pruned} pruned
              </div>
            )}
            {skillCandidates.length === 0 ? (
              <div className="rounded border border-border bg-surface/35 px-3 py-6 text-center text-xs text-text-muted">
                Curate routines after missions or percepts exist.
              </div>
            ) : (
              <div className="space-y-2">
                {skillCandidates.slice(0, 5).map((candidate) => (
                  <SkillCandidateRow
                    key={candidate.id}
                    candidate={candidate}
                    busy={busyAction !== null}
                    onPromote={(candidateId) => void promoteSkill(candidateId)}
                    onDismiss={(candidateId) => void dismissSkill(candidateId)}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Safety ledger</h3>
              <span className="text-[10px] text-text-muted">
                {safetyStats ? `${safetyStats.total} event(s)` : 'No stats'}
              </span>
            </div>
            {safetyStats?.ledgerPath && (
              <button
                onClick={() => void window.electronAPI.showItemInFolder(safetyStats.ledgerPath)}
                className="inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface"
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{safetyStats.ledgerPath}</span>
              </button>
            )}
            {safetyEvents.length === 0 ? (
              <div className="rounded border border-border bg-surface/35 px-3 py-6 text-center text-xs text-text-muted">
                No safety events recorded yet.
              </div>
            ) : (
              <div className="space-y-2">
                {safetyEvents.map((event) => (
                  <SafetyEventRow key={event.id} event={event} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Privacy</h3>
              <span className="text-[10px] text-text-muted">
                {privacyReport ? `${privacyReport.totalEntries} entries · ${formatBytes(privacyReport.totalBytes)}` : 'No report'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                disabled={busyAction !== null}
                onClick={() => void exportPrivacy()}
                className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-xs font-medium text-text-primary hover:bg-surface disabled:opacity-50"
              >
                <FolderOpen className="h-4 w-4" />
                {busyAction === 'privacyExport' ? 'Exporting...' : 'Export memory'}
              </button>
              <button
                disabled={busyAction !== null}
                onClick={() => void purgePrivacy()}
                className="inline-flex items-center gap-2 rounded border border-warning/40 px-3 py-2 text-xs font-medium text-warning hover:bg-warning/10 disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4" />
                {busyAction === 'privacyPurge' ? 'Purging...' : 'Purge with backup'}
              </button>
              {privacyExport?.exportDir && (
                <button
                  onClick={() => void window.electronAPI.showItemInFolder(privacyExport.exportDir)}
                  className="inline-flex min-w-0 items-center gap-2 rounded border border-border px-3 py-2 text-xs text-text-secondary hover:bg-surface"
                >
                  <FolderOpen className="h-4 w-4 shrink-0" />
                  <span className="truncate max-w-[260px]">{privacyExport.exportDir}</span>
                </button>
              )}
            </div>
            {privacyPurge && (
              <div className="rounded border border-border bg-surface/35 p-3 text-xs text-text-secondary">
                Purged {privacyPurge.removed.filter((item) => item.existed).length} store(s).
                {privacyPurge.backup?.manifestPath && (
                  <button
                    onClick={() => void window.electronAPI.showItemInFolder(privacyPurge.backup!.manifestPath)}
                    className="ml-2 inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface"
                  >
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{privacyPurge.backup.manifestPath}</span>
                  </button>
                )}
              </div>
            )}
            {privacyReport && (
              <div className="grid grid-cols-2 gap-2">
                {privacyReport.stores.map((store) => (
                  <div key={store.kind} className="rounded border border-border bg-surface/35 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-text-primary">{store.kind}</span>
                      <span className={`text-[10px] ${store.exists ? 'text-accent' : 'text-text-muted'}`}>
                        {store.exists ? 'stored' : 'empty'}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-text-muted">
                      {store.entries} entries · {formatBytes(store.bytes)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Sensory journal</h3>
              <span className="text-[10px] text-text-muted">
                {stats ? `${stats.total} percepts` : 'No stats'}
              </span>
            </div>
            {stats?.storePath && (
              <button
                onClick={() => void window.electronAPI.showItemInFolder(stats.storePath)}
                className="inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface"
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{stats.storePath}</span>
              </button>
            )}
            {filteredStats.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {filteredStats.map(([key, count]) => (
                  <span key={key} className="rounded bg-surface px-2 py-1 text-[10px] text-text-muted">
                    {key}: {count}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {MODALITIES.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setModality(item.key)}
                  className={`rounded px-2 py-1 text-xs transition-colors ${
                    modality === item.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {percepts.length === 0 ? (
              <div className="rounded border border-border bg-surface/35 px-3 py-8 text-center text-xs text-text-muted">
                {loading ? 'Loading percepts...' : 'No percepts for this filter yet.'}
              </div>
            ) : (
              <div className="space-y-2">
                {percepts.map((percept) => (
                  <PerceptRow key={percept.id} percept={percept} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
