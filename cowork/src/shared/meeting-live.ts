/**
 * Stable IPC contract for the local-first live meeting recorder.
 *
 * Audio bytes never appear in these public views. They are transferred only
 * by `appendSegment` and are persisted by the main process inside the private
 * Electron user-data directory.
 */

export const MEETING_LIVE_SCHEMA_VERSION = 1 as const;
export const MEETING_LIVE_CONSENT_STATEMENT =
  'J’ai informé les participants et j’ai leur accord pour enregistrer cette réunion.';

export type MeetingLiveCaptureSource = 'microphone' | 'shared-audio';
export type MeetingLiveCapabilityState = 'available' | 'unavailable' | 'runtime-probe';

export interface MeetingLiveCapability {
  state: MeetingLiveCapabilityState;
  reason: string;
}

export interface MeetingLiveCapabilities {
  microphone: MeetingLiveCapability;
  sharedAudio: MeetingLiveCapability;
  localMixing: MeetingLiveCapability;
  diarization: MeetingLiveCapability & {
    provider: 'sherpa-onnx' | 'none';
  };
}

export interface MeetingLiveCapabilitiesResult {
  ok: boolean;
  capabilities: MeetingLiveCapabilities;
  error?: string;
}

export interface MeetingLiveSharedAudioArmResult {
  ok: boolean;
  state: MeetingLiveCapabilityState;
  method?: 'electron-loopback' | 'pipewire-virtual-source';
  /** Opaque main-process lease used to tear down an ephemeral PipeWire source. */
  leaseId?: string;
  /** Exact Chromium device label to select when `method` is PipeWire. */
  deviceLabel?: string;
  error?: string;
}

export interface MeetingLiveSharedAudioReleaseInput {
  leaseId: string;
}

export interface MeetingLiveSharedAudioReleaseResult {
  ok: boolean;
  error?: string;
}

export interface MeetingLiveDiarizationView {
  requested: boolean;
  provider: 'sherpa-onnx' | 'none';
  status: 'disabled' | 'pending' | 'applied' | 'unavailable' | 'failed';
  speakerCount: number;
  reason?: string;
}

export type MeetingLiveStatus =
  | 'recording'
  | 'paused'
  | 'interrupted'
  | 'finalizing'
  | 'completed'
  | 'failed';

export interface MeetingLiveConsentEvent {
  accepted: true;
  statement: typeof MEETING_LIVE_CONSENT_STATEMENT;
  acceptedAt: string;
  reason: 'start' | 'resume';
  actor: 'local-user';
}

export interface MeetingLiveSegmentView {
  sequence: number;
  captureId: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  startOffsetMs: number;
  durationMs: number;
  captureSources: MeetingLiveCaptureSource[];
  checkpointedAt: string;
}

export interface MeetingLiveOutput {
  markdownPath: string;
  jsonPath: string;
  title: string;
  summary: string;
  transcriptSegments: number;
  decisions: number;
  actionItems: number;
  openQuestions: number;
  diarization: MeetingLiveDiarizationView;
}

export interface MeetingLiveSessionView {
  schemaVersion: typeof MEETING_LIVE_SCHEMA_VERSION;
  id: string;
  title: string;
  language: string;
  source: 'microphone' | 'microphone+shared-audio';
  captureSources: MeetingLiveCaptureSource[];
  status: MeetingLiveStatus;
  localOnly: true;
  remoteEgress: false;
  createdAt: string;
  updatedAt: string;
  interruptedAt?: string;
  pauseReason?: string;
  lastError?: string;
  consentEvents: MeetingLiveConsentEvent[];
  segments: MeetingLiveSegmentView[];
  totalBytes: number;
  durationMs: number;
  diarization: MeetingLiveDiarizationView;
  output?: MeetingLiveOutput;
}

export interface MeetingLiveConsentInput {
  accepted: boolean;
  statement: string;
}

export interface MeetingLiveStartInput {
  title: string;
  language?: string;
  captureSources?: MeetingLiveCaptureSource[];
  diarization?: boolean;
  consent: MeetingLiveConsentInput;
}

export interface MeetingLiveResumeInput {
  sessionId: string;
  captureSources?: MeetingLiveCaptureSource[];
  consent: MeetingLiveConsentInput;
}

export interface MeetingLiveAppendSegmentInput {
  sessionId: string;
  sequence: number;
  captureId: string;
  mimeType: string;
  bytes: Uint8Array;
  startOffsetMs: number;
  durationMs: number;
  captureSources?: MeetingLiveCaptureSource[];
}

export interface MeetingLivePauseInput {
  sessionId: string;
  reason?: 'user' | 'navigation' | 'capture-error';
}

export interface MeetingLiveSessionInput {
  sessionId: string;
}

export type MeetingLiveResult =
  | { ok: true; session: MeetingLiveSessionView }
  | { ok: false; error: string; session: null };

export type MeetingLiveListResult =
  | { ok: true; sessions: MeetingLiveSessionView[] }
  | { ok: false; error: string; sessions: [] };

export interface MeetingLiveDiscardResult {
  ok: boolean;
  deleted: boolean;
  error?: string;
}

export interface MeetingLiveApi {
  capabilities: () => Promise<MeetingLiveCapabilitiesResult>;
  /** Synchronous by design so Chromium's transient user activation is preserved. */
  armSharedAudio: () => MeetingLiveSharedAudioArmResult;
  releaseSharedAudio: (
    input: MeetingLiveSharedAudioReleaseInput,
  ) => Promise<MeetingLiveSharedAudioReleaseResult>;
  list: () => Promise<MeetingLiveListResult>;
  start: (input: MeetingLiveStartInput) => Promise<MeetingLiveResult>;
  appendSegment: (input: MeetingLiveAppendSegmentInput) => Promise<MeetingLiveResult>;
  pause: (input: MeetingLivePauseInput) => Promise<MeetingLiveResult>;
  resume: (input: MeetingLiveResumeInput) => Promise<MeetingLiveResult>;
  finalize: (input: MeetingLiveSessionInput) => Promise<MeetingLiveResult>;
  discard: (input: MeetingLiveSessionInput) => Promise<MeetingLiveDiscardResult>;
}

export const MEETING_LIVE_CHANNELS = {
  capabilities: 'meetingLive.capabilities',
  armSharedAudio: 'meetingLive.armSharedAudio',
  releaseSharedAudio: 'meetingLive.releaseSharedAudio',
  list: 'meetingLive.list',
  start: 'meetingLive.start',
  appendSegment: 'meetingLive.appendSegment',
  pause: 'meetingLive.pause',
  resume: 'meetingLive.resume',
  finalize: 'meetingLive.finalize',
  discard: 'meetingLive.discard',
} as const;
