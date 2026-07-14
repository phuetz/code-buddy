export type CompanionAvatarRendererPhase =
  | 'ready'
  | 'buffering'
  | 'playing'
  | 'interrupted'
  | 'unavailable'
  | 'error';

export interface CompanionAvatarRendererCapabilities {
  audioDrivenAnimation: boolean;
  wavStream: boolean;
  affect: boolean;
  gestures: boolean;
  gaze: boolean;
  interruptionAck: boolean;
}

/** Raw-free public telemetry reported by an authenticated avatar renderer. */
export interface CompanionAvatarRendererView {
  rendererId: string;
  displayName?: string;
  protocolVersion: number;
  runtime: 'unreal' | 'simulator' | 'other';
  runtimeVersion?: string;
  project?: string;
  capabilities: CompanionAvatarRendererCapabilities;
  phase: CompanionAvatarRendererPhase;
  activeTurnId?: string;
  lastSequence: number;
  fps?: number;
  audioBufferMs?: number;
  mouthLatencyMs?: number;
  droppedAudioChunks: number;
  connected: boolean;
  connectedAt: string;
  lastSeenAt: string;
  disconnectedAt?: string;
  reason?: string;
}

export interface CompanionAvatarRendererSnapshot {
  generatedAt: string;
  bridgeEnabled: boolean;
  audioPolicy: 'auto' | 'forced_on' | 'forced_off';
  audioStreamingActive: boolean;
  connectedCount: number;
  readyCount: number;
  renderers: CompanionAvatarRendererView[];
  privacy: {
    textIncluded: false;
    audioIncluded: false;
    connectionCredentialsIncluded: false;
  };
}
