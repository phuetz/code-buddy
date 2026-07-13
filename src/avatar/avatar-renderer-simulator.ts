import type { AvatarGatewayMessage, AvatarSyncMessage } from './avatar-gateway-bridge.js';
import {
  AVATAR_PROTOCOL_VERSION,
  AvatarPlaybackStateMachine,
  MAX_AVATAR_AUDIO_CHUNK_BYTES,
  type AvatarEvent,
  type AvatarPlaybackState,
} from './avatar-protocol.js';

interface AudioAssembly {
  turnId: string;
  streamId: string;
  maxChunkBytes: number;
  nextIndex: number;
  nextOffset: number;
  chunks: Buffer[];
}

export interface SimulatedAvatarAudio {
  turnId: string;
  streamId: string;
  audio: Buffer;
}

/**
 * Executable reference consumer for the Unreal implementation. It validates
 * ordering and reconstructs WAV streams, but never plays audio or stores text.
 */
export class AvatarRendererSimulator {
  private readonly playback = new AvatarPlaybackStateMachine();
  private readonly streams = new Map<string, AudioAssembly>();
  private completedAudio: SimulatedAvatarAudio[] = [];
  private phase: 'ready' | 'buffering' | 'playing' | 'interrupted' | 'error' = 'ready';
  private activeTurnId: string | undefined;
  private lastSequence = -1;
  private droppedAudioChunks = 0;

  constructor(readonly rendererId = 'codebuddy-avatar-simulator') {}

  hello(): Record<string, unknown> {
    return {
      rendererId: this.rendererId,
      displayName: 'Code Buddy Avatar Simulator',
      protocolVersion: AVATAR_PROTOCOL_VERSION,
      runtime: 'simulator',
      capabilities: {
        audioDrivenAnimation: true,
        wavStream: true,
        affect: true,
        gestures: true,
        gaze: true,
        interruptionAck: true,
      },
    };
  }

  status(): Record<string, unknown> {
    return {
      rendererId: this.rendererId,
      phase: this.phase,
      ...(this.activeTurnId ? { activeTurnId: this.activeTurnId } : {}),
      lastSequence: this.lastSequence,
      droppedAudioChunks: this.droppedAudioChunks,
    };
  }

  consumeGatewayMessage(message: AvatarGatewayMessage | AvatarSyncMessage): void {
    if (message.type === 'avatar:sync') {
      this.applySync(message);
      return;
    }
    this.consumeEvent(message.payload as AvatarEvent);
  }

  applySync(message: AvatarSyncMessage): AvatarPlaybackState {
    this.streams.clear();
    this.phase = 'ready';
    this.activeTurnId = undefined;
    this.lastSequence = message.payload.latestSequence;
    return this.playback.applySync({
      events: message.payload.events,
      latestSequence: message.payload.latestSequence,
      ignoredTurnIds: message.payload.ignoredTurnIds,
    });
  }

  consumeEvent(event: AvatarEvent): AvatarPlaybackState {
    if (event.sequence <= this.lastSequence) return this.playback.snapshot();
    this.lastSequence = event.sequence;
    const state = this.playback.consume(event);
    switch (event.type) {
      case 'avatar.turn.started':
        this.activeTurnId = event.turnId;
        this.phase = 'ready';
        break;
      case 'avatar.audio.started':
        this.phase = 'buffering';
        this.streams.set(event.streamId, {
          turnId: event.turnId,
          streamId: event.streamId,
          maxChunkBytes: Math.min(event.maxChunkBytes, MAX_AVATAR_AUDIO_CHUNK_BYTES),
          nextIndex: 0,
          nextOffset: 0,
          chunks: [],
        });
        break;
      case 'avatar.audio.chunk':
        this.consumeAudioChunk(event);
        break;
      case 'avatar.audio.ended':
        this.finishAudio(event);
        break;
      case 'avatar.speech.started':
        this.phase = 'playing';
        break;
      case 'avatar.speech.interrupted':
        this.streams.clear();
        this.phase = 'interrupted';
        this.activeTurnId = undefined;
        break;
      case 'avatar.speech.failed':
        this.streams.clear();
        this.phase = 'error';
        this.activeTurnId = undefined;
        break;
      case 'avatar.speech.completed':
      case 'avatar.turn.silent':
        this.streams.clear();
        this.phase = 'ready';
        this.activeTurnId = undefined;
        break;
      case 'avatar.speech.prepared':
      case 'avatar.speech.segment':
        break;
    }
    return state;
  }

  drainCompletedAudio(): SimulatedAvatarAudio[] {
    const result = this.completedAudio;
    this.completedAudio = [];
    return result;
  }

  snapshot(): AvatarPlaybackState {
    return this.playback.snapshot();
  }

  private consumeAudioChunk(event: Extract<AvatarEvent, { type: 'avatar.audio.chunk' }>): void {
    const streamId = event.streamId;
    const assembly = streamId ? this.streams.get(streamId) : this.streams.values().next().value;
    if (!assembly) {
      this.droppedAudioChunks += 1;
      return;
    }
    const bytes = Buffer.from(event.data, 'base64');
    const valid =
      event.chunkIndex === assembly.nextIndex &&
      (event.byteOffset === undefined || event.byteOffset === assembly.nextOffset) &&
      (event.byteLength === undefined || event.byteLength === bytes.byteLength) &&
      bytes.byteLength <= assembly.maxChunkBytes;
    if (!valid) {
      this.droppedAudioChunks += 1;
      return;
    }
    assembly.chunks.push(bytes);
    assembly.nextIndex += 1;
    assembly.nextOffset += bytes.byteLength;
  }

  private finishAudio(event: Extract<AvatarEvent, { type: 'avatar.audio.ended' }>): void {
    const assembly = this.streams.get(event.streamId);
    this.streams.delete(event.streamId);
    if (!assembly || event.outcome !== 'complete') return;
    const audio = Buffer.concat(assembly.chunks);
    if (
      assembly.nextIndex !== event.chunks ||
      assembly.nextOffset !== event.totalBytes ||
      audio.byteLength !== event.totalBytes
    ) {
      this.droppedAudioChunks += 1;
      return;
    }
    this.completedAudio.push({
      turnId: assembly.turnId,
      streamId: assembly.streamId,
      audio,
    });
  }
}
