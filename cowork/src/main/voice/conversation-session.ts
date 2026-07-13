export type VoiceConversationPhase =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'error';

export type VoiceConversationEventType =
  | 'listening_started'
  | 'listening_stopped'
  | 'transcription_started'
  | 'transcription_completed'
  | 'transcription_failed'
  | 'user_message_sent'
  | 'assistant_speech_started'
  | 'assistant_speech_finished'
  | 'assistant_interrupted'
  | 'reset';

export interface VoiceConversationEvent {
  type: VoiceConversationEventType;
  timestamp?: number;
  transcript?: string;
  error?: string;
  reason?: string;
  hadPlayback?: boolean;
  durationMs?: number;
  provider?: string;
}

export interface VoiceConversationSnapshot {
  phase: VoiceConversationPhase;
  startedAt: number;
  updatedAt: number;
  lastEventType?: VoiceConversationEventType;
  turnId: number;
  interruptionCount: number;
  lastTranscriptPreview?: string;
  lastError?: string;
  lastInterruptionReason?: string;
  lastInterruptionAt?: number;
  interruptedTurnId?: number;
  pendingInterruption?: boolean;
  resumedAfterInterruption?: boolean;
  resumeInstruction?: string;
  hadPlaybackDuringLastInterruption?: boolean;
  lastSttMs?: number;
  lastResponseMs?: number;
  lastVoiceTurnMs?: number;
  lastProvider?: string;
  lastListeningStartedAt?: number;
  lastTranscriptionStartedAt?: number;
  lastUserMessageAt?: number;
}

function nowMs(): number {
  return Date.now();
}

function preview(text: string | undefined): string | undefined {
  const compact = (text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  return compact.length <= 240 ? compact : `${compact.slice(0, 237)}...`;
}

function interruptionInstruction(reason: string | undefined): string {
  if (reason === 'barge_in') {
    return 'Listen to the next user speech as a correction or higher-priority instruction before continuing.';
  }
  if (reason === 'new_speech') {
    return 'Prefer the newest speech turn and avoid continuing stale playback.';
  }
  if (reason === 'stop') {
    return 'Stay quiet until the user gives a new instruction.';
  }
  return 'Confirm the next user intent before resuming speech.';
}

export class VoiceConversationSession {
  private state: VoiceConversationSnapshot;

  constructor(now: number = nowMs()) {
    this.state = {
      phase: 'idle',
      startedAt: now,
      updatedAt: now,
      turnId: 0,
      interruptionCount: 0,
    };
  }

  snapshot(): VoiceConversationSnapshot {
    return { ...this.state };
  }

  record(event: VoiceConversationEvent): VoiceConversationSnapshot {
    const timestamp = event.timestamp ?? nowMs();
    if (event.type === 'reset') {
      this.state = {
        phase: 'idle',
        startedAt: timestamp,
        updatedAt: timestamp,
        lastEventType: event.type,
        turnId: 0,
        interruptionCount: 0,
      };
      return this.snapshot();
    }

    const next: VoiceConversationSnapshot = {
      ...this.state,
      updatedAt: timestamp,
      lastEventType: event.type,
    };

    switch (event.type) {
      case 'listening_started':
        next.resumedAfterInterruption = Boolean(next.pendingInterruption);
        next.pendingInterruption = false;
        next.phase = 'listening';
        next.turnId += 1;
        next.lastError = undefined;
        next.lastListeningStartedAt = timestamp;
        break;
      case 'listening_stopped':
        next.phase = 'transcribing';
        break;
      case 'transcription_started':
        next.phase = 'transcribing';
        next.lastTranscriptionStartedAt = timestamp;
        break;
      case 'transcription_completed':
        next.phase = 'thinking';
        next.lastTranscriptPreview = preview(event.transcript);
        next.lastError = undefined;
        next.lastSttMs = event.durationMs ?? (next.lastTranscriptionStartedAt ? timestamp - next.lastTranscriptionStartedAt : undefined);
        next.lastProvider = event.provider ?? next.lastProvider;
        break;
      case 'transcription_failed':
        next.phase = 'error';
        next.lastError = event.error || 'transcription failed';
        break;
      case 'user_message_sent':
        next.phase = 'thinking';
        next.lastTranscriptPreview = preview(event.transcript) ?? next.lastTranscriptPreview;
        next.lastUserMessageAt = timestamp;
        break;
      case 'assistant_speech_started':
        next.phase = 'speaking';
        next.lastError = undefined;
        next.lastResponseMs = next.lastUserMessageAt ? timestamp - next.lastUserMessageAt : undefined;
        break;
      case 'assistant_speech_finished':
        next.phase = 'idle';
        next.pendingInterruption = false;
        next.resumedAfterInterruption = false;
        next.lastVoiceTurnMs = next.lastListeningStartedAt ? timestamp - next.lastListeningStartedAt : undefined;
        break;
      case 'assistant_interrupted':
        next.phase = 'interrupted';
        next.interruptionCount += 1;
        next.lastInterruptionReason = event.reason || 'manual';
        next.lastInterruptionAt = timestamp;
        next.interruptedTurnId = next.turnId;
        next.pendingInterruption = true;
        next.resumedAfterInterruption = false;
        next.resumeInstruction = interruptionInstruction(event.reason);
        next.hadPlaybackDuringLastInterruption = Boolean(event.hadPlayback);
        break;
    }

    this.state = next;
    return this.snapshot();
  }
}
