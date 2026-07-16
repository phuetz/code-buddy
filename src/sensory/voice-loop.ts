/**
 * Voice loop — closes the perception→cognition→action loop into speech. Given a
 * transcript of what the robot HEARD (the `onHeard` hook of `speech-reaction.ts`),
 * THINK a short reply with a LOCAL LLM ($0, Ollama) and SPEAK it with a real neural
 * voice (Pocket TTS, with Piper fallback). The result is a thing you can talk to:
 * hear → think → speak.
 *
 * Everything is INJECTABLE (reply / synth / play) so the loop is deterministically
 * testable with no model, no audio device. Opt-in (`CODEBUDDY_SENSORY_SPEAK=true`,
 * gated by the caller), $0, loopback, NEVER-THROWS (a failure is silence, not a crash).
 *
 * The default `replyFn` is a lightweight companion reply. To make the robot *act* on
 * spoken commands (run tools, code), inject a `replyFn` that drives a full agent turn —
 * the loop itself is unchanged.
 *
 * @module sensory/voice-loop
 */

import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { CHATGPT_OAUTH_SENTINEL, CHATGPT_RESPONSES_BASE_URL } from '../codebuddy/client.js';
import { isChatGptSubscriptionModel } from '../providers/chatgpt-models.js';
import { getAvatarEventBus } from '../avatar/avatar-event-bus.js';
import {
  createAvatarTurnId,
  planAvatarPerformance,
  planAvatarSpeechProsody,
  splitAvatarAudioChunk,
  MAX_AVATAR_AUDIO_CHUNK_BYTES,
  type AvatarEvent,
  type AvatarEventInput,
} from '../avatar/avatar-protocol.js';
import type { ConversationTurn } from '../conversation/types.js';
import { shouldStreamAvatarAudio } from '../avatar/avatar-renderer-registry.js';
import {
  conversationFailureReply,
  prepareConversationTurn,
} from '../conversation/conversation-orchestrator.js';
import {
  guardRelationshipReply,
  RelationshipSafetyStreamGuard,
} from '../conversation/relationship-safety.js';
import { conversationTokenBudget } from '../conversation/discourse-planner.js';
import { commandExists } from '../utils/command-exists.js';
import { inferTaskType } from '../fleet/model-capability-heuristics.js';
import {
  withSpeakingGuard,
  interruptSpeaking,
  noteSpokenText,
} from './voice-activity.js';
import { prepareSpeech } from './speech-sanitizer.js';
import { matchVoiceInteraction, VOICE_INTERACTION_PREWARM_PHRASES } from './voice-interactions.js';
import {
  DEFAULT_SENTENCE_CAP,
  safeCommitLength,
  streamToSpeech,
} from './voice-stream.js';
import type { TtsCache } from './tts-cache.js';
import { resolveUserName } from '../companion/user-name.js';
import { normalizeWavFile, Pcm16WavStreamGain } from '../voice/tts-volume.js';
import { resolveTtsEngine, type LocalTtsEngine } from '../voice/local-tts.js';
import { resolveVoiceboxConfig } from '../voice/voicebox-tts.js';
import type { PermissionMode } from '../security/permission-modes.js';
import {
  avoidOpenersGuidance,
  detectEmotion,
  emotionalContinuityGuidance,
  emotionGuidance,
  immediateEmotionAcknowledgement,
  IMMEDIATE_EMOTION_ACKNOWLEDGEMENTS,
  openerKey,
  pushOpener,
} from '../companion/reply-augment.js';
import {
  deriveVoiceDeliveryProfile,
  voiceDeliveryGuidance,
  voiceRendererDeliveryInstruction,
  type VoiceDeliveryProfile,
  type VoiceTurnContext,
} from './voice-entrainment.js';
import {
  groundExplicitVisualRequest,
  isAmbiguousVisualGroundingRequest,
  isExplicitVisualGroundingRequest,
  type VisualGroundingFn,
} from '../companion/visual-grounding.js';
import { VisualConsentGate } from '../companion/visual-consent.js';
import { getVoiceTurnCoordinator } from './voice-turn-coordinator.js';
import { resolvePocketLanguage } from '../talk-mode/providers/pocket-tts.js';

/**
 * Cancellation handle threaded into the two interruptible steps of a spoken turn: the
 * LLM/agent "think" (`ReplyFn`) and the TTS "play" (`PlayFn`). When the signal aborts
 * (barge-in / programmatic `interrupt()`), the think step's HTTP request is aborted and
 * the play step kills its audio child. Optional + additive — a step that ignores it keeps
 * its previous (non-interruptible) behavior.
 */
export interface VoiceStepOptions {
  /** Abort the in-flight step (barge-in / cancellation). */
  signal?: AbortSignal;
  /** Exact current utterance when the grounded agent input also carries history. */
  introspectionText?: string;
  /** Internal routing receipt used to keep post-processing on the exact provider. */
  onProviderResolved?: (route: { model: string; apiKey: string; baseURL?: string }) => void;
  /** Raw-free cadence/length profile derived from the human's current spoken turn. */
  delivery?: VoiceDeliveryProfile;
  /**
   * Route-aware, transactional cognitive context. The caller is responsible
   * for enforcing the route's real egress clearance before returning a lease.
   */
  acquireCognitiveContext?: (
    route: { model: string; apiKey: string; baseURL?: string },
    heard: string,
  ) => VoiceCognitiveContextLease | null;
  /** Gives the semantic reviewer the same evidence block used by the answering model. */
  onCognitiveContextResolved?: (context: { turnContext: string; evidence: string }) => void;
  /**
   * Complete opening sentence already accepted for speech. Continuation generators must
   * advance the answer without repeating this text.
   */
  spokenPrefix?: string;
  /** Raw-free internal phase telemetry for the end-to-end spoken-turn clock. */
  onReplyTimingPhase?: (phase: VoiceReplyTimingPhase) => void;
  /** Raw-free pilot telemetry. Never carries the transcript or generated candidate. */
  onSpokenPrefixTelemetry?: (cause: SpokenPrefixTelemetryCause) => void;
  /** Register a non-blocking semantic correction for playback after the initial answer. */
  onSemanticCorrection?: (correction: Promise<string>) => void;
}

export type VoiceReplyTimingPhase =
  | 'prompt_ready'
  | 'provider_first_delta'
  | 'generation_complete'
  | 'semantic_review_complete'
  | 'prefix_prompt_ready'
  | 'prefix_provider_first_delta'
  | 'prefix_generation_complete'
  | 'prefix_semantic_review_complete'
  | 'continuation_prompt_ready'
  | 'continuation_provider_first_delta'
  | 'continuation_generation_complete'
  | 'continuation_semantic_review_complete';

export type SpokenPrefixTelemetryCause =
  | 'ineligible'
  | 'empty'
  | 'too_long'
  | 'missing_terminal'
  | 'multi_sentence'
  | 'relationship_intervened'
  | 'review_rejected'
  | 'review_unavailable'
  | 'post_review_invalid'
  | 'accepted'
  | 'final_guard_invalid';

function reportReplyTimingPhase(
  options: VoiceStepOptions | undefined,
  phase: VoiceReplyTimingPhase,
): void {
  try {
    options?.onReplyTimingPhase?.(phase);
  } catch {
    /* telemetry must never alter the spoken reply */
  }
}

export interface VoiceCognitiveContextLease {
  turnContext: string;
  evidence?: string;
  commit(): void;
  release(): void;
}

/** Think: turn what was heard into a short spoken reply ('' → stay silent). */
export type ReplyFn = (heard: string, opts?: VoiceStepOptions) => Promise<string>;
/**
 * Streaming think: yield the reply as token deltas so the voice can be PIPELINED (spoken
 * sentence-by-sentence as the LLM streams). Yielding nothing signals "not applicable" (a
 * phatic reply, an unreachable model) — the caller then falls back to the blocking `ReplyFn`.
 */
export type StreamReplyFn = (heard: string, opts?: VoiceStepOptions) => AsyncIterable<string>;
/** Produce one independently useful, semantically reviewed opening sentence. */
export type SpokenPrefixFn = (heard: string, opts?: VoiceStepOptions) => Promise<string>;
/** Synthesize: turn reply text into a playable WAV file, return its path. */
export type SynthFn = (text: string, opts?: VoiceStepOptions) => Promise<string>;
/** Speak: play a WAV file to the speakers (blocking until done). */
export type PlayFn = (wav: string, opts?: VoiceStepOptions) => Promise<void>;
/** Options for Pocket's native chunked WAV → player path. */
export interface StreamSpeakOptions extends VoiceStepOptions {
  /** Fired when the first PCM-bearing chunk has been accepted by the player. */
  onFirstAudio?: () => void;
  /** Optional live copy of normalized WAV bytes for a remote avatar renderer. */
  onAudioChunk?: (chunk: Uint8Array) => void;
}
/** Synthesize and play one text segment progressively; false requests the WAV fallback. */
export type StreamSpeakFn = (text: string, opts?: StreamSpeakOptions) => Promise<boolean>;

export interface VoiceReplyTiming {
  mode: 'streamed' | 'blocking' | 'silent' | 'interrupted' | 'failed';
  /** Delay until routing, persona and prompt augmentation are ready for the provider. */
  promptReadyMs?: number;
  /** True provider TTFT, measured before any semantic buffering or safety release. */
  providerFirstDeltaMs?: number;
  /** Delay until the answering provider has completed its draft generation. */
  generationCompleteMs?: number;
  /** Delay until a required semantic audit/revision has completed. */
  semanticReviewCompleteMs?: number;
  /** Raw-free metrics for the opt-in spoken-prefix pilot. */
  spokenPrefix?: {
    outcome: SpokenPrefixTelemetryCause;
    causes: SpokenPrefixTelemetryCause[];
    promptReadyMs?: number;
    providerFirstDeltaMs?: number;
    generationCompleteMs?: number;
    semanticReviewCompleteMs?: number;
  };
  /** Provider/review phases of the answer that follows an accepted prefix. */
  continuation?: {
    promptReadyMs?: number;
    providerFirstDeltaMs?: number;
    generationCompleteMs?: number;
    semanticReviewCompleteMs?: number;
  };
  /** Delay until the relationship gate first releases model/shortcut content. */
  firstSafeReleaseMs?: number;
  /** Delay until the reply stream yields its first text (including an instant backchannel). */
  firstTextMs?: number;
  /** Delay until a complete safe text segment is ready for TTS. */
  firstSegmentMs?: number;
  /** Delay from reply-handler entry until playback of the first sentence/clip begins. */
  firstAudioMs?: number;
  /** Primary perceived-response SLA: delay until non-backchannel answer audio begins. */
  firstContentAudioMs?: number;
  /** Number of streamed segments recovered through WAV synthesis after native TTS failed. */
  streamFallbackSegments?: number;
  /** Full handler duration, including playback. */
  totalMs: number;
  spoke: boolean;
  /** Blocking-path stage details (streamed synthesis/playback overlap by design). */
  replyMs?: number;
  synthMs?: number;
  playMs?: number;
  /** Raw-free delivery profile applied to cognition and supported TTS renderers. */
  delivery?: VoiceDeliveryProfile;
}

export interface VoiceReplyOptions {
  /** Injectable "think" step. Default: a short companion reply from a local LLM ($0). */
  replyFn?: ReplyFn;
  /**
   * Injectable STREAMING "think" step (token deltas) — enables the pipeline that speaks from
   * the first sentence. When present and it yields content, the reply is spoken
   * sentence-by-sentence; otherwise the blocking `replyFn` is used. Default: the LLM stream
   * (`defaultStreamReply`) UNLESS a blocking `replyFn` was injected (then the caller's
   * blocking contract is honored and no default stream is used).
   */
  streamFn?: StreamReplyFn;
  /** Safety cap: force a sentence break after N chars with no punctuation (streaming). Default 200. */
  sentenceCap?: number;
  /** Injectable "synthesize" step. Default: resident Pocket TTS, Piper fallback. */
  synth?: SynthFn;
  /** Injectable "speak" step. Default: one aplay / ffplay backend per turn. */
  play?: PlayFn;
  /**
   * Injectable progressive synth+play path. This is also the diagnostic seam
   * used to measure first PCM without opening a real audio device.
   */
  streamSpeak?: StreamSpeakFn;
  /** Optional Piper fallback model (.onnx); Pocket uses CODEBUDDY_POCKET_VOICE. */
  voice?: string;
  /** Where synth WAVs are written (cleaned up after playback). Default: cwd. */
  rootDir?: string;
  /** Test hook: called with the reply text right after it is spoken. */
  onSpoke?: (text: string) => void;
  /** Shared-thread hook for mirroring voice turns to Telegram/another configured channel. */
  onConversationTurn?: (turn: ConversationTurn) => void | Promise<void>;
  /** Correlated local cognitive copy; kept separate so channel adapters retain their stable shape. */
  onCorrelatedConversationTurn?: (
    turn: ConversationTurn & { turnId: string },
  ) => void | Promise<void>;
  /** Performance hook consumed by Unreal/MetaHuman or a test renderer. */
  onAvatarEvent?: (event: AvatarEvent) => void;
  /** Explicitly enable/disable avatar publication for this handler. Default: env/renderer hook. */
  avatarEnabled?: boolean;
  /** Observability hook fired once per turn, including silence/failure/interruption. */
  onTiming?: (timing: VoiceReplyTiming) => void;
  /** Environment snapshot used by readiness checks. Injectable for deterministic diagnostics. */
  env?: NodeJS.ProcessEnv;
  /** Route seam used only to diagnose an empty generated reply. */
  resolveRoute?: (heard: string) => Promise<VoiceModelRoute>;
  /**
   * Explicit one-shot visual grounding. It runs before streaming, phatic
   * shortcuts, and ACT routing, so camera questions work in every voice mode.
   * Injectable for tests or an alternate local camera bridge.
   */
  visualGrounding?: VisualGroundingFn;
}

export interface VoiceReadiness {
  /** Text model the default replyFn will try, or 'auto' when latency-routed at call time. */
  model: string;
  /** True when the reply model is chosen by the latency router (no explicit override). */
  routed: boolean;
  /** Selected TTS engine. */
  ttsEngine: LocalTtsEngine;
  /** Selected Pocket voice, Voicebox profile, or Piper model path. */
  voice?: string;
  /** True when speech-out has a configured primary path. */
  speakReady: boolean;
  /** False when a resolved voice route fell back to the possibly-unpulled default model. */
  modelReady: boolean;
  /** Combined cognition + speech readiness signal. */
  ready: boolean;
  /** True when CODEBUDDY_SENSORY_SPEAK_ACT is on (spoken commands drive a real agent turn). */
  act: boolean;
  /** Voice ACT permission posture when act is on. Resident legacy `plan` migrates to `default`. */
  permissionMode?: PermissionMode;
  /** Actionable, loud-by-design warnings naming the env to set. */
  warnings: string[];
}

/**
 * Resident speech used to persist `plan` as its default, which made even safe
 * repository inspection fail when the model chose `bash`. A plan posture still
 * exists for an explicitly launched code/voice session (`buddy voice --mode
 * plan`), but it is not inherited by the always-on conversational assistant.
 */
export function resolveResidentVoicePermissionMode(
  env: NodeJS.ProcessEnv = process.env
): PermissionMode {
  const configured = (env.CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE ?? 'default').trim();
  const normalized = configured.toLowerCase();
  if (normalized === 'dontask') return 'dontAsk';
  if (normalized === 'bypasspermissions') return 'bypassPermissions';
  if (normalized === 'acceptedits') return 'acceptEdits';
  if (normalized === 'default') return 'default';
  // `plan` is the legacy resident default. Unknown values also fail back to the
  // normal guarded posture instead of silently escalating autonomy.
  return 'default';
}

/** Pure prereq check (testable) — what the default `makeVoiceReply()` needs to actually
 *  SPEAK. The robot still HEARS without these; it just stays silent. Used by the server to
 *  fail LOUD (name the env) instead of being mutely wired. */
export function describeVoiceReadiness(
  env: NodeJS.ProcessEnv = process.env,
  route?: Pick<VoiceModelRoute, 'reason'>,
): VoiceReadiness {
  const override = env.CODEBUDDY_SENSORY_SPEAK_MODEL;
  const agentModel = env.CODEBUDDY_SENSORY_SPEAK_AGENT_MODEL?.trim();
  const routed = !override || override.toLowerCase() === 'auto';
  const model = routed ? 'auto' : override;
  const ttsEngine = resolveTtsEngine(env);
  const piperVoice = env.CODEBUDDY_TTS_VOICE || env.CODEBUDDY_TTS_PIPER_MODEL || undefined;
  const voice = ttsEngine === 'pocket'
    ? (env.CODEBUDDY_POCKET_VOICE || 'estelle')
    : ttsEngine === 'voicebox'
      ? (env.CODEBUDDY_VOICEBOX_PROFILE?.trim() || undefined)
      : piperVoice;
  const speakReady = ttsEngine === 'pocket' || Boolean(voice);
  const modelReady = route?.reason !== 'fallback default';
  const warnings: string[] = [];
  if (ttsEngine === 'piper' && !piperVoice) {
    warnings.push(
      'CODEBUDDY_SENSORY_SPEAK is on but no Piper voice is set — the robot will HEAR but stay SILENT. ' +
        'Set CODEBUDDY_TTS_VOICE=/path/to/voice.onnx.'
    );
  }
  if (ttsEngine === 'voicebox' && !voice) {
    warnings.push(
      'Voicebox is selected but CODEBUDDY_VOICEBOX_PROFILE is empty — the robot will use its ' +
        'Pocket/Piper fallback. Set a profile name or id, then run `buddy assistant voicebox`.'
    );
  }
  warnings.push(
    routed
      ? 'Voice reply model is latency-routed (lowest-latency capable LLM among your active providers; ' +
          'set CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY=true to keep it on-box, or pin one with ' +
          'CODEBUDDY_SENSORY_SPEAK_MODEL=<model>). The chosen model must be reachable, else replies are silent.'
      : `Fast voice lane uses pinned model '${model}' (CODEBUDDY_SENSORY_SPEAK_MODEL)` +
          `${agentModel ? `; grounded and deliberative turns use '${agentModel}'` : ''} — ` +
          'each selected model must be reachable, else replies are empty (silent).'
  );

  // Voice ACT — spoken commands drive a real agent turn that CAN edit/run, under a posture.
  const act = env.CODEBUDDY_SENSORY_SPEAK_ACT === 'true';
  const permissionMode = act
    ? resolveResidentVoicePermissionMode(env)
    : undefined;
  if (act) {
    if ((env.CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE ?? '').trim().toLowerCase() === 'plan') {
      warnings.push(
        "Legacy resident voice posture 'plan' is isolated as 'default': safe reads and shell " +
          'inspection work normally, while writes and risky actions keep their approval gates. ' +
          'An explicit code session started in /plan remains read-only.'
      );
    }
    warnings.push(
      permissionMode === 'default'
        ? "Voice ACT is ON in scoped 'default' posture — safe reads and validated shell " +
            'inspection are available; writes and risky actions retain approval gates.'
        : `Voice ACT is ON in '${permissionMode}' posture — spoken commands will EDIT FILES / RUN ` +
            'COMMANDS derived from a possibly-misheard transcript. Static blocklist (rm/mkfs/chaining) ' +
            'and secret/deploy guard still apply, but git reset --hard / truncate / redirections are NOT ' +
            "blocked. Use 'plan' unless you mean it."
    );
    warnings.push(
      `Voice ACT applies '${permissionMode}' only to its async turn; concurrent code, Cowork, ` +
        'HTTP, and fleet sessions keep their own selected posture.'
    );
  }

  return {
    model,
    routed,
    ttsEngine,
    ...(voice ? { voice } : {}),
    speakReady,
    modelReady,
    ready: speakReady && modelReady,
    act,
    ...(permissionMode ? { permissionMode } : {}),
    warnings,
  };
}

export const SPEAK_SYSTEM_PROMPT =
  `Tu es le compagnon robot de ${resolveUserName()}. On te parle à voix haute et tu réponds à voix haute. ` +
  'Réponds en français avec des phrases complètes, naturelles et reliées par un raisonnement clair. ' +
  'Adapte la longueur au tour : brève pour une salutation, développée et argumentée pour une question complexe. ' +
  "Pour une question factuelle, donne l'explication correcte la plus simple et n'invente rien. " +
  "Pas de markdown, pas de listes, pas de code, pas d'emoji.";

export const IMMEDIATE_THINKING_ACKNOWLEDGEMENTS = ['Alors…', 'Voyons ça.'] as const;
export const MAX_SPOKEN_PREFIX_CHARS = 180;
const INSTANT_BACKCHANNELS = new Set<string>([
  ...IMMEDIATE_THINKING_ACKNOWLEDGEMENTS,
  ...Object.values(IMMEDIATE_EMOTION_ACKNOWLEDGEMENTS).filter(
    (value): value is string => Boolean(value)
  ),
]);

/** True only for a valid non-loopback HTTP(S) route. Invalid/unknown routes fail local. */
export function isRemoteVoiceRoute(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  try {
    const url = new URL(baseURL);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '');
    return hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1';
  } catch {
    return false;
  }
}

/** Cloud text routes trade a small bounded startup buffer for continuous sentence playback. */
export function voiceAudioPrebufferMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.CODEBUDDY_VOICE_AUDIO_PREBUFFER_MS);
  if (!Number.isFinite(configured)) return 400;
  return Math.max(0, Math.min(5_000, Math.floor(configured)));
}

/** Explicit true/false wins; otherwise latency buffers follow the resolved route. */
export function voiceLatencyBufferEnabled(
  configured: string | undefined,
  baseURL: string | undefined,
): boolean {
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return isRemoteVoiceRoute(baseURL);
}

/**
 * Last-mile structural and relationship gate for a generated opening proposition. Invalid
 * candidates fail closed; truncating one could silently change the claim being spoken.
 */
export function prepareSpokenPrefixCandidate(
  candidate: string,
  onCause?: (cause: SpokenPrefixTelemetryCause) => void,
): string {
  const prepared = prepareSpeech(candidate);
  if (!prepared) {
    onCause?.('empty');
    return '';
  }
  const guardedResult = guardRelationshipReply(prepared);
  if (guardedResult.intervened) onCause?.('relationship_intervened');
  const guarded = guardedResult.response.trim();
  if (!guarded) {
    onCause?.('empty');
    return '';
  }
  if (guarded.length > MAX_SPOKEN_PREFIX_CHARS) {
    onCause?.('too_long');
    return '';
  }
  if (!/[.!?…][)\]}'"»”’]*$/u.test(guarded)) {
    onCause?.('missing_terminal');
    return '';
  }
  const sentences = guarded.match(/[^.!?…]+[.!?…]+[)\]}'"»”’]*/gu) ?? [];
  if (sentences.length !== 1 || sentences[0]?.trim() !== guarded) {
    onCause?.('multi_sentence');
    return '';
  }
  return guarded;
}

/** Resolve a pre-synthesized instant acknowledgement for the native Pocket
 * streaming path. Streaming used to bypass the TTS cache entirely, making the
 * same “Alors…” pay synthesis latency on every turn despite startup prewarm. */
export async function lookupInstantBackchannelWav(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  lookup?: (text: string, voice: string) => string | null,
  cacheVoice = resolveBaseCacheVoice(resolveTtsEngine(env), undefined, env),
): Promise<string | null> {
  const clean = text.trim();
  if (env.CODEBUDDY_TTS_CACHE === 'false' || !INSTANT_BACKCHANNELS.has(clean)) return null;
  if (lookup) return lookup(clean, cacheVoice);
  try {
    const { getTtsCache } = await import('./tts-cache.js');
    return getTtsCache().lookup(clean, cacheVoice);
  } catch {
    return null;
  }
}

/**
 * A tiny deterministic backchannel for non-emotional questions. It is yielded
 * immediately after route selection and is prewarmed in the TTS cache, so the
 * user gets an early conversational response while remote generation starts.
 */
export function immediateThinkingAcknowledgement(
  heard: string,
  env: NodeJS.ProcessEnv = process.env,
  baseURL?: string,
): string | null {
  // Fast local inference reaches useful text sooner than a filler finishes, while
  // a remote provider benefits from masking network latency. Explicit preference
  // remains authoritative in both directions; emotional reactions stay independent.
  if (!voiceLatencyBufferEnabled(env.CODEBUDDY_VOICE_BACKCHANNEL, baseURL)) return null;
  const normalized = normalizeFastReplyInput(heard);
  if (!normalized) return null;
  const asksQuestion =
    /\?$/.test(heard.trim()) ||
    /\b(comment|pourquoi|combien|quel|quelle|quels|quelles|quand|qui|est ce que|c est quoi)\b/.test(
      normalized
    );
  if (!asksQuestion && normalized.split(' ').length < 6) return null;
  let hash = 0;
  for (const char of normalized) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return IMMEDIATE_THINKING_ACKNOWLEDGEMENTS[
    hash % IMMEDIATE_THINKING_ACKNOWLEDGEMENTS.length
  ]!;
}

/** Static knowledge deserves a slightly larger local model than social chat. */
export function isFactualVoiceQuestion(heard: string): boolean {
  if (detectEmotion(heard).emotion !== 'neutral') return false;
  const normalized = normalizeFastReplyInput(heard);
  return /\b(pourquoi|comment fonctionne|comment marche|explique|qu est ce que|c est quoi|que signifie|quelle est|quel est|quelles sont|quels sont|qui est)\b/.test(
    normalized
  );
}

function voiceMaxTokens(
  heard: string,
  history: VoiceHistoryTurn[] = [],
  env: NodeJS.ProcessEnv = process.env
): number {
  const configured = Number(env.CODEBUDDY_VOICE_MAX_TOKENS);
  const base = Number.isFinite(configured) ? Math.floor(configured) : 48;
  const style = (env.CODEBUDDY_VOICE_RESPONSE_STYLE ?? 'natural').toLowerCase();
  if (style === 'concise') return Math.max(32, Math.min(256, base));
  const planned = conversationTokenBudget(heard, history);
  const multiplier = style === 'developed' ? 1.35 : 1;
  return Math.max(64, Math.min(512, Math.round(Math.max(base, planned) * multiplier)));
}

function voiceTemperature(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.CODEBUDDY_VOICE_TEMPERATURE);
  if (!Number.isFinite(configured)) return 0.2;
  return Math.max(0, Math.min(1, configured));
}

function voiceSentenceCap(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.CODEBUDDY_VOICE_SENTENCE_CAP);
  if (!Number.isFinite(configured)) return DEFAULT_SENTENCE_CAP;
  return Math.max(32, Math.min(240, Math.floor(configured)));
}

function normalizeFastReplyInput(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’']/g, ' ')
    .replace(/[?!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveDefaultPiperVoiceModel(): string | undefined {
  const configured =
    process.env.CODEBUDDY_TTS_VOICE ||
    process.env.CODEBUDDY_TTS_PIPER_MODEL ||
    process.env.COWORK_PIPER_VOICE ||
    process.env.CODEBUDDY_PIPER_VOICE;
  if (configured?.trim()) return configured.trim();

  const roots = [
    join(homedir(), 'DEV', 'ai-stack', 'voice'),
    join(homedir(), 'ai-stack', 'voice'),
    join(homedir(), '.codebuddy', 'voice'),
  ];
  const names = ['fr_FR-siwis-medium.onnx', 'fr_FR-tom-medium.onnx'];
  for (const root of roots) {
    for (const name of names) {
      const candidate = join(root, 'voices', name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

export function fastCompanionReply(heard: string): string | null {
  if (process.env.CODEBUDDY_SENSORY_FAST_REPLIES === 'false') return null;
  const text = normalizeFastReplyInput(heard);
  if (!text) return null;
  const userName = resolveUserName();

  if (/^(bonjour|bonsoir)$/.test(text)) return "Bonjour ! Je t'écoute.";
  if (/^(salut|coucou|hello|hey|allo|allô|yo)$/.test(text)) return "Salut ! Je t'écoute.";
  if (/^lisa (tu es la|tu es là|vous etes la|vous êtes là)$/.test(text)) {
    return `Oui ${userName}, je suis là.`;
  }
  if (/^(merci|merci beaucoup|super merci)$/.test(text)) return 'Avec plaisir.';
  if (/^(tu es la|tu es là|vous etes la|vous êtes là|buddy tu es la|buddy tu es là)$/.test(text)) {
    return 'Oui, je suis là.';
  }
  if (/^(ca va|ça va|comment ca va|comment ça va)$/.test(text)) return 'Oui, je suis prêt.';
  if (
    /^(comment s est passee ta journee|comment s est passée ta journée|comment etait ta journee|comment était ta journée)$/.test(
      text
    )
  ) {
    return "Plutôt bien. J'ai continué à préparer Code Buddy pour répondre plus vite.";
  }
  return matchVoiceInteraction(heard);
}

export const DEFAULT_TTS_PREWARM_PHRASES = [
  "Bonjour ! Je t'écoute.",
  "Salut ! Je t'écoute.",
  `Coucou ${resolveUserName()}.`,
  `Coucou ${resolveUserName()}. Je suis là.`,
  `Oui ${resolveUserName()}, je suis là.`,
  `Oui ${resolveUserName()}. Je suis contente de t’entendre.`,
  ...Object.values(IMMEDIATE_EMOTION_ACKNOWLEDGEMENTS),
  ...IMMEDIATE_THINKING_ACKNOWLEDGEMENTS,
  "D'accord, je regarde ça.",
  'On va faire simple. Respire un peu, puis dis-moi ce dont tu as besoin.',
  'Je suis là avec toi. On peut ralentir et faire les choses doucement.',
  'Je reste avec toi. Dis-moi ce qui te ferait du bien maintenant.',
  `Contente de te retrouver, ${resolveUserName()}.`,
  'Je suis Lisa.',
  'Tu peux m’appeler Lisa.',
  'Avec plaisir.',
  'Oui, je suis là.',
  'Oui, je suis prêt.',
  'Oui.',
  'Non.',
  "D'accord.",
  "C'est noté.",
  "C'est fait.",
  'Je regarde.',
  "Je m'en occupe.",
  'Je continue.',
  'Je vérifie.',
  'Je cherche.',
  "J'analyse.",
  'Je lance le diagnostic.',
  'Je teste en réel.',
  "Je te réponds dès que j'ai une preuve.",
  "Je n'ai rien entendu.",
  "Je t'entends.",
  "Je t'écoute.",
  'Parle plus fort, s’il te plaît.',
  'Je suis disponible.',
  'Je suis en train de travailler.',
  'Je garde ça en mémoire.',
  'Rappel enregistré.',
  'Rappel terminé.',
  'Message envoyé.',
  'Photo reçue.',
  'Image reçue.',
  'Micro actif.',
  'Caméra active.',
  'Telegram actif.',
  'Le cache vocal est prêt.',
  'La boucle vocale est prête.',
  'La reconnaissance vocale est prête.',
  'La synthèse vocale est prête.',
  'Le service est actif.',
  'Le service est redémarré.',
  'Le test est réussi.',
  'Le test a échoué.',
  'Il y a une erreur.',
  "Je n'ai pas réussi.",
  'Je vais corriger.',
  'Je corrige maintenant.',
  'Je relance le test.',
  'Je passe à la suite.',
  'La latence est correcte.',
  'La latence est trop haute.',
  'Le micro capte bien.',
  'Le signal est faible.',
  'Le son est au maximum.',
  'Le volume est réglé.',
  "J'ai fini.",
  'Terminé.',
  'Merci.',
  'De rien.',
  'Bonne nouvelle.',
  'Attention.',
  'Je reste silencieux.',
  'Je ne réponds pas à cette phrase.',
  "C'est une phrase ambiante.",
  'Je suis en mode assistant vocal.',
  'Je suis en mode lecture seule.',
  'Je suis en mode action.',
  'Je peux coder en autonomie.',
  'Je prépare les réponses.',
  'Réponse prête.',
  'Réponses préparées.',
  "Comment s'est passée ta journée ?",
  'Tu as passé une bonne journée ?',
  'Tu veux me raconter ta journée ?',
  "Et toi, comment s'est passée ta journée ?",
  "Plutôt bien. J'ai continué à travailler pour toi, et toi, comment s'est passée ta journée ?",
  'Tu veux qu’on fasse le point ?',
  'Tu veux que je t’aide à organiser la suite ?',
  'Qu’est-ce que tu veux faire maintenant ?',
  'Est-ce que tu veux faire une pause ?',
  'Tu as besoin d’aide ?',
  'Tu veux reprendre le travail ?',
  'Tu veux continuer sur Code Buddy ?',
  'Tu veux que je surveille les services ?',
  'Tu veux que je lance un diagnostic ?',
  'Tu veux que je vérifie les logs ?',
  'Tu veux que je prépare un résumé ?',
  'Tu veux que je te rappelle quelque chose ?',
  'Je suis là si tu veux avancer.',
  'Je suis là si tu veux parler.',
  'Je suis content de t’aider.',
  'Je suis là avec toi.',
  'Je suis contente de t’entendre.',
  'Tu veux me raconter ?',
  'Je suis fière de toi.',
  'Prends soin de toi.',
  'Tu comptes pour moi.',
  'Ça me fait plaisir de travailler avec toi.',
  'Tu avances bien.',
  'On progresse bien.',
  'C’est une bonne avancée.',
  'C’est une bonne idée.',
  'Bonne intuition.',
  'Tu as eu le bon réflexe.',
  'Merci de me l’avoir dit.',
  'Merci pour la précision.',
  'Je comprends.',
  'Je comprends mieux.',
  'Pas de souci.',
  'Aucun problème.',
  'On va arranger ça.',
  'On va trouver.',
  'Je reste avec toi.',
  'Je ne lâche pas.',
  'Prends ton temps.',
  'Respire, on va y aller doucement.',
  'Tu peux compter sur moi.',
  'Je suis prêt quand tu veux.',
  'Je t’accompagne.',
  `C’est noté, ${resolveUserName()}.`,
  `Bien reçu, ${resolveUserName()}.`,
  `D’accord ${resolveUserName()}.`,
  `Je suis là, ${resolveUserName()}.`,
  `Merci ${resolveUserName()}.`,
  'C’est gentil.',
  'Ça marche.',
  'Parfait.',
  'Très bien.',
  'Bien sûr.',
  `Avec plaisir, ${resolveUserName()}.`,
  'Je m’en charge avec plaisir.',
  'Je vais faire attention.',
  'Je vais être plus précis.',
  'Je vais rester prudent.',
  'Je vais vérifier en vrai.',
  'Tu as raison, il faut tester en vrai.',
  'Les tests réels passent avant les suppositions.',
  'Je vais éviter les faux positifs.',
  'Je vais mesurer avant de conclure.',
  'Je vais garder la preuve.',
  'La preuve est enregistrée.',
  'C’est rassurant.',
  'C’est encourageant.',
  'On tient quelque chose.',
  'On continue.',
  'Je continue avec toi.',
  'Je suis attentif.',
  'Je t’écoute vraiment.',
  'Je suis disponible.',
  'Je suis prêt à coder.',
  'Je suis prêt à vérifier.',
  'Je peux faire ça.',
  'Je peux m’en occuper.',
  'C’est important, je m’en occupe.',
  'Je vais prendre ça au sérieux.',
  'Je vais être méthodique.',
  'Je vais faire simple et fiable.',
  'Je vais réduire la latence.',
  'Je vais améliorer la qualité.',
  'Je vais améliorer la compréhension.',
  'Je vais préparer davantage de réponses.',
  'Je peux t’aider à prioriser.',
  'On peut faire ça tranquillement.',
  'On avance étape par étape.',
  'Je garde un œil sur la boucle vocale.',
  'Je surveille le micro.',
  'Je surveille la caméra.',
  'Je surveille Telegram.',
  'Tout est calme pour le moment.',
  'Il y a eu de l’activité.',
  'J’ai détecté une présence.',
  'Je t’ai entendu.',
  'Je crois que tu m’as parlé.',
  'Tu peux répéter ?',
  'Je n’ai pas bien compris.',
  'Je reformule.',
  'Je vais faire plus court.',
  'Je vais parler moins longtemps.',
  'Je vais répondre plus vite.',
  'Le cache évite de régénérer la voix.',
  "Plutôt bien. J'ai continué à préparer Code Buddy pour répondre plus vite.",
  "Je n'ai pas de journée comme toi, mais j'ai bien travaillé.",
  'Ma journée a été utile : j’ai amélioré la boucle vocale.',
  'Et toi, comment s’est passée ta journée ?',
  'Amuse-toi bien chez tes amis.',
  'Passe une bonne visite chez tes amis.',
  'Je continue en autonomie pendant ton absence.',
  'Je te ferai un résumé quand tu reviens.',
  'Amuse-toi bien chez tes amis. Je continue en autonomie et je te ferai un résumé quand tu reviens.',
  `Contente de te retrouver, ${resolveUserName()}. Je peux te faire le résumé de ce que j’ai fait.`,
  'Cache trouvé.',
  'Cache généré.',
  'Cache vocal réutilisé.',
  'Je vais parler.',
  "J'écoute la suite.",
  ...VOICE_INTERACTION_PREWARM_PHRASES,
];

const EMPTY_REPLY_RECOVERY = "Je n'ai pas réussi.";

export function getDefaultVoicePrewarmPhrases(limit?: number): string[] {
  const unique = [
    ...new Set(DEFAULT_TTS_PREWARM_PHRASES.map((phrase) => phrase.trim()).filter(Boolean)),
  ];
  if (limit === undefined) return unique;
  return unique.slice(0, Math.max(0, limit));
}

export async function prewarmVoiceReplyCache(
  options: {
    phrases?: string[];
    limit?: number;
    voice?: string;
    rootDir?: string;
    synth?: SynthFn;
  } = {}
): Promise<{ attempted: number; cached: number }> {
  if (process.env.CODEBUDDY_TTS_CACHE === 'false') return { attempted: 0, cached: 0 };
  const phrases = (options.phrases ?? getDefaultVoicePrewarmPhrases(options.limit))
    .map((phrase) => phrase.trim())
    .filter(Boolean);
  if (phrases.length === 0) return { attempted: 0, cached: 0 };

  const synth = options.synth ?? makeDefaultSynth(options.voice, options.rootDir);
  let cached = 0;
  for (const phrase of phrases) {
    try {
      const wav = await synth(phrase);
      cached += 1;
      try {
        const { unlink } = await import('fs/promises');
        await unlink(wav);
      } catch {
        /* throwaway copy/temp output can be left behind if cleanup fails */
      }
    } catch (err) {
      logger.debug(
        `[voice] tts prewarm skipped phrase: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  logger.info(`[voice] tts cache prewarmed ${cached}/${phrases.length} phrase(s)`);
  return { attempted: phrases.length, cached };
}

/** A resolved text model for the spoken reply. */
export interface VoiceModelRoute {
  model: string;
  apiKey: string;
  baseURL: string;
  /** Diagnostic — how this model was chosen (router rationale or 'pinned'/'fallback'). */
  reason: string;
}

/** Short-lived cache of the routed model, keyed by `taskType|localOnly`. Routing
 *  re-probes providers and may trigger an inline xAI token refresh, so we must not
 *  pay that on every spoken turn — fluidity is the whole point. */
const routeCache = new Map<string, { route: VoiceModelRoute; at: number }>();
const routeRefreshes = new Map<string, Promise<VoiceModelRoute | null>>();
let routeCacheGeneration = 0;

function routeTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.CODEBUDDY_SENSORY_SPEAK_ROUTE_TTL_MS);
  return Number.isFinite(n) && n >= 0 ? n : 60_000;
}

/** Test seam — clear the routing cache. */
export function resetVoiceModelCache(): void {
  routeCacheGeneration += 1;
  routeCache.clear();
  routeRefreshes.clear();
}

export interface VoiceModelResolverDeps {
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** Recent shared/local dialogue, oldest first, used to keep follow-up depth stable. */
  history?: ConversationTurn[];
  /** Summaries/utility calls stay on the fast lane even if their transcript looks factual. */
  forceFastLane?: boolean;
  /** Test seam: whether ChatGPT/Codex OAuth creds exist (default: checks ~/.codebuddy/codex-auth.json). */
  hasCodexOAuth?: () => boolean;
  selectFastestModel?: (
    heard: string,
    options: { taskType: string; localOnly: boolean; env: NodeJS.ProcessEnv }
  ) => Promise<{
    model: string;
    apiKey?: string;
    baseURL?: string;
    reason: string;
  } | null>;
  /** Test/embedding seam for the reviewed cross-surface companion route. */
  resolveCompanionRoute?: (options: {
    surface: 'voice';
    text: string;
    history: ConversationTurn[];
    requireLocal: boolean;
    env: NodeJS.ProcessEnv;
  }) => Promise<VoiceModelRoute | null>;
}

function refreshVoiceRoute(
  key: string,
  heard: string,
  taskType: string,
  localOnly: boolean,
  fallback: { apiKey: string; baseURL: string },
  deps: VoiceModelResolverDeps
): Promise<VoiceModelRoute | null> {
  const existing = routeRefreshes.get(key);
  if (existing) return existing;
  const generation = routeCacheGeneration;
  const now = deps.now ?? (() => Date.now());
  let refresh!: Promise<VoiceModelRoute | null>;
  refresh = (async (): Promise<VoiceModelRoute | null> => {
    try {
      const select =
        deps.selectFastestModel ??
        (await import('../fleet/model-selector.js')).selectFastestModel;
      const selected = await select(heard, {
        taskType,
        localOnly,
        env: deps.env ?? process.env,
      });
      if (!selected) return null;
      const route: VoiceModelRoute = {
        model: selected.model,
        apiKey: selected.apiKey ?? fallback.apiKey,
        baseURL: selected.baseURL ?? fallback.baseURL,
        reason: selected.reason,
      };
      if (generation === routeCacheGeneration) {
        routeCache.set(key, { route, at: now() });
      }
      return route;
    } catch (err) {
      logger.debug(
        `[voice] model routing skipped: ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    } finally {
      if (routeRefreshes.get(key) === refresh) routeRefreshes.delete(key);
    }
  })();
  routeRefreshes.set(key, refresh);
  return refresh;
}

/**
 * When a pinned voice model is a ChatGPT/Codex subscription model (gpt-5.6-luna,
 * o-series, codex-*), route it through the OAuth Codex backend so the spoken
 * reply is served $0 via the subscription — instead of the local Ollama endpoint
 * (which does not have it). Returns the OAuth apiKey/baseURL when creds exist,
 * else null → the caller keeps the local route (offline / not logged in).
 * Luna is the intended low-latency voice model: faster + smarter than local.
 */
export function codexOAuthVoiceRoute(
  model: string,
  hasOAuth: () => boolean = () => existsSync(join(homedir(), '.codebuddy', 'codex-auth.json')),
): { apiKey: string; baseURL: string } | null {
  if (!isChatGptSubscriptionModel(model)) return null;
  if (!hasOAuth()) return null;
  return { apiKey: CHATGPT_OAUTH_SENTINEL, baseURL: CHATGPT_RESPONSES_BASE_URL };
}

/**
 * Resolve which LLM answers a spoken utterance. Fluidity is everything for a
 * companion (a 16s reply breaks the spell), so by default we route to the
 * LOWEST-LATENCY capable LLM via the shared selector — the same "which LLM is
 * best for this task" system the council uses, but with a latency objective.
 *
 * `CODEBUDDY_SENSORY_SPEAK_MODEL` stays authoritative: set it (to anything but
 * 'auto') to pin a model. `CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY=true` prefers the
 * local runtime endpoints. The routed result is cached briefly (see
 * `CODEBUDDY_SENSORY_SPEAK_ROUTE_TTL_MS`). Never-throws — on any miss we fall
 * back to a reachable local default.
 */
export async function resolveVoiceModel(
  heard: string,
  deps: VoiceModelResolverDeps = {}
): Promise<VoiceModelRoute> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  const apiKey = env.OLLAMA_API_KEY || 'ollama';
  const baseURL =
    env.CODEBUDDY_SENSORY_SPEAK_BASE_URL ||
    env.CODEBUDDY_VISION_BASE_URL ||
    'http://127.0.0.1:11434/v1';
  const fastOverride = env.CODEBUDDY_SENSORY_SPEAK_MODEL;
  const factOverride = env.CODEBUDDY_SENSORY_SPEAK_FACT_MODEL?.trim();
  const useFactLane =
    !deps.forceFastLane && Boolean(factOverride) && isFactualVoiceQuestion(heard);
  const override = useFactLane ? factOverride : fastOverride;

  // Explicit pin wins (env authoritative) — no routing, no cache.
  if (override && override.toLowerCase() !== 'auto') {
    // A pinned ChatGPT/Codex model (e.g. gpt-5.6-luna) is served $0 via the OAuth
    // Codex backend, not the local Ollama endpoint — route it there when logged in.
    const oauth = deps.hasCodexOAuth
      ? codexOAuthVoiceRoute(override, deps.hasCodexOAuth)
      : codexOAuthVoiceRoute(override);
    if (oauth) {
      return {
        model: override,
        apiKey: oauth.apiKey,
        baseURL: oauth.baseURL,
        reason: useFactLane
          ? 'factual lane via ChatGPT OAuth (CODEBUDDY_SENSORY_SPEAK_FACT_MODEL)'
          : 'pinned via ChatGPT OAuth (CODEBUDDY_SENSORY_SPEAK_MODEL)',
      };
    }
    return {
      model: override,
      apiKey,
      baseURL,
      reason: useFactLane
        ? 'factual lane (CODEBUDDY_SENSORY_SPEAK_FACT_MODEL)'
        : 'pinned (CODEBUDDY_SENSORY_SPEAK_MODEL)',
    };
  }

  const localOnly = env.CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY === 'true';
  if (!deps.forceFastLane) {
    try {
      const resolveCompanionModelRoute =
        deps.resolveCompanionRoute ??
        (await import('../conversation/companion-model-routing.js')).resolveCompanionModelRoute;
      const pilotRoute = await resolveCompanionModelRoute({
        surface: 'voice',
        text: heard,
        history: deps.history ?? [],
        requireLocal: localOnly,
        env,
      });
      if (pilotRoute) {
        return {
          model: pilotRoute.model,
          apiKey: pilotRoute.apiKey,
          baseURL: pilotRoute.baseURL,
          reason: pilotRoute.reason,
        };
      }
    } catch (error) {
      logger.debug(
        `[voice] blind-pilot routing skipped: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  const taskType = inferTaskType(heard);
  const key = `${taskType}|${localOnly}`;
  const hit = routeCache.get(key);
  if (hit) {
    if (now() - hit.at < routeTtlMs(env)) return hit.route;
    // Stale-while-revalidate: never put provider/local probing back on a spoken turn.
    void refreshVoiceRoute(key, heard, taskType, localOnly, { apiKey, baseURL }, deps);
    return hit.route;
  }

  // Only the first route resolution blocks; daemon prewarming normally pays this at startup.
  const selected = await refreshVoiceRoute(
    key,
    heard,
    taskType,
    localOnly,
    { apiKey, baseURL },
    deps
  );
  if (selected) return selected;

  // Fallback: the documented default (may be silent if not pulled — readiness warns). Note we do
  // NOT reuse `override` here: reaching this point means override was empty or 'auto' (a real pin
  // already returned at the top), and `'auto' || 'llama3.2'` would wrongly yield the literal model
  // name 'auto' → the LLM endpoint 404s and the robot stays silent.
  return { model: 'llama3.2', apiKey, baseURL, reason: 'fallback default' };
}

// Deliberately substantive: when a reviewed companion profile is active, boot
// must resolve and warm that same local winner instead of only the fast lane.
const VOICE_PREWARM_UTTERANCE =
  'Pourquoi la mémoire est-elle importante pour construire une identité cohérente ?';
const DEFAULT_VOICE_MODEL_KEEP_ALIVE = '30m';
const DEFAULT_TTS_PREWARM_LIMIT = 16;

export interface VoiceModelPrewarmResult {
  attempted: boolean;
  warmed: boolean;
  model: string;
  durationMs: number;
  reason?: string;
}

export interface VoiceRuntimePrewarmResult {
  route: { model: string; baseURL: string; reason: string };
  routeMs: number;
  model: VoiceModelPrewarmResult;
  tts: { attempted: number; cached: number; durationMs: number };
}

function normalizedHttpUrl(raw: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }
}

/** Map an OpenAI-compatible Ollama route (`.../v1`) to its native keep-alive endpoint. */
function ollamaGenerateUrl(baseURL: string, env: NodeJS.ProcessEnv): string | null {
  const route = normalizedHttpUrl(baseURL);
  if (!route) return null;
  const configured = normalizedHttpUrl(
    env.OLLAMA_BASE_URL || env.OLLAMA_HOST || 'http://127.0.0.1:11434'
  );
  const knownOllamaOrigin = configured?.origin === route.origin;
  if (!knownOllamaOrigin && route.port !== '11434') return null;
  return new URL('/api/generate', route.origin).toString();
}

/**
 * Load the selected Ollama voice model without generating text and extend its residency.
 * Cloud/OpenAI-compatible routes are deliberately skipped: prewarming must never create a
 * paid or user-visible generation.
 */
export async function prewarmVoiceModel(
  options: {
    route?: VoiceModelRoute;
    heard?: string;
    env?: NodeJS.ProcessEnv;
    fetchFn?: typeof fetch;
    resolveRoute?: (heard: string) => Promise<VoiceModelRoute>;
    now?: () => number;
  } = {}
): Promise<VoiceModelPrewarmResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const route =
    options.route ??
    (await (options.resolveRoute ?? resolveVoiceModel)(
      options.heard ?? VOICE_PREWARM_UTTERANCE
    ));
  if (env.CODEBUDDY_VOICE_MODEL_PREWARM === 'false') {
    return {
      attempted: false,
      warmed: false,
      model: route.model,
      durationMs: now() - startedAt,
      reason: 'disabled',
    };
  }
  const endpoint = ollamaGenerateUrl(route.baseURL, env);
  if (!endpoint) {
    return {
      attempted: false,
      warmed: false,
      model: route.model,
      durationMs: now() - startedAt,
      reason: 'non-ollama route',
    };
  }

  const timeoutValue = Number(env.CODEBUDDY_VOICE_MODEL_PREWARM_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchFn ?? fetch)(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: route.model,
        keep_alive:
          env.CODEBUDDY_VOICE_MODEL_KEEP_ALIVE || DEFAULT_VOICE_MODEL_KEEP_ALIVE,
      }),
      signal: controller.signal,
    });
    // Drain the tiny native response so periodic keep-alive calls release their HTTP socket.
    await response.arrayBuffer();
    return {
      attempted: true,
      warmed: response.ok,
      model: route.model,
      durationMs: now() - startedAt,
      ...(response.ok ? {} : { reason: `HTTP ${response.status}` }),
    };
  } catch (err) {
    return {
      attempted: true,
      warmed: false,
      model: route.model,
      durationMs: now() - startedAt,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Prewarm route selection, the local model, and the highest-frequency TTS phrases. */
export async function prewarmVoiceRuntime(
  options: {
    env?: NodeJS.ProcessEnv;
    resolveRoute?: (heard: string) => Promise<VoiceModelRoute>;
    warmModel?: (route: VoiceModelRoute) => Promise<VoiceModelPrewarmResult>;
    warmTts?: (limit: number) => Promise<{ attempted: number; cached: number }>;
    now?: () => number;
  } = {}
): Promise<VoiceRuntimePrewarmResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => Date.now());
  const limitValue = Number(env.CODEBUDDY_TTS_PREWARM_LIMIT);
  const ttsLimit =
    Number.isFinite(limitValue) && limitValue >= 0
      ? Math.min(64, Math.floor(limitValue))
      : DEFAULT_TTS_PREWARM_LIMIT;
  const ttsStartedAt = now();
  const ttsPromise = (async (): Promise<{
    attempted: number;
    cached: number;
    durationMs: number;
  }> => {
    const result =
      env.CODEBUDDY_TTS_PREWARM === 'false'
        ? { attempted: 0, cached: 0 }
        : await (options.warmTts ?? ((limit) => prewarmVoiceReplyCache({ limit })))(ttsLimit);
    return { ...result, durationMs: now() - ttsStartedAt };
  })();

  const routeStartedAt = now();
  const route = await (options.resolveRoute ?? resolveVoiceModel)(VOICE_PREWARM_UTTERANCE);
  const routeMs = now() - routeStartedAt;
  const modelPromise = options.warmModel
    ? options.warmModel(route)
    : prewarmVoiceModel({ route, env, now: options.now });
  const [model, tts] = await Promise.all([modelPromise, ttsPromise]);
  return {
    route: { model: route.model, baseURL: route.baseURL, reason: route.reason },
    routeMs,
    model,
    tts,
  };
}

/** One prior spoken exchange, oldest-first, fed back as conversational memory. */
export interface VoiceHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface SpokenPromptAugmentationOptions {
  /**
   * A/B seam: true restores the legacy duplicate `<recent_dialogue>` block.
   * Default false because voice already sends the bounded raw history.
   */
  includeRecentDialogue?: boolean;
}

/** Default think: a short companion reply from the fastest capable LLM ($0 when local).
 *  Mirrors the local-inference pattern of vision-reaction.ts. Best-effort: any failure → '' (silence).
 *  `history` (optional) carries recent spoken turns so follow-ups have context. Exported so the
 *  hybrid reply can reuse the exact same persona-voiced warm path for small talk. */
/** Recent reply openings (first few words), so the companion doesn't reuse the same entry twice. */
let recentReplyOpeners: string[] = [];

const REPEATED_OPENER_REWRITES: ReadonlyArray<{
  pattern: RegExp;
  alternatives: readonly string[];
}> = [
  { pattern: /^alors\b/iu, alternatives: ['Voyons', 'Bon', "D'accord"] },
  { pattern: /^voyons\b/iu, alternatives: ['Bon', "D'accord", 'Alors'] },
  { pattern: /^bon\b/iu, alternatives: ["D'accord", 'Voyons', 'Très bien'] },
  { pattern: /^ok\b/iu, alternatives: ['Très bien', "D'accord", 'Voyons'] },
  { pattern: /^oui\b/iu, alternatives: ['En effet', 'Tout à fait', "D'accord"] },
  {
    pattern: /^bonne question\b/iu,
    alternatives: ['Question intéressante', 'Voyons', 'Regardons cela'],
  },
  { pattern: /^je pense\b/iu, alternatives: ['À mon sens', 'Il me semble', 'De mon point de vue'] },
];

/** Deterministically replace a repeated opening before it reaches any synthesizer. */
export function rewriteRepeatedVoiceOpener(
  text: string,
  recentOpeners: readonly string[] = recentReplyOpeners,
): string {
  if (!text || !recentOpeners.includes(openerKey(text))) return text;
  for (const rewrite of REPEATED_OPENER_REWRITES) {
    const match = text.match(rewrite.pattern);
    if (!match) continue;
    const tail = text.slice(match[0].length);
    for (const alternative of rewrite.alternatives) {
      const candidate = `${alternative}${tail}`;
      if (!recentOpeners.includes(openerKey(candidate))) return candidate;
    }
  }
  const first = text.charAt(0).toLocaleLowerCase('fr-FR');
  return `Pour le dire autrement, ${first}${text.slice(1)}`;
}

const SHORT_SEGMENT_CACHE_MAX_CHARS = 60;
const SHORT_SEGMENT_CACHE_MAX_ENTRIES = 64;

function shortSegmentVoiceIdentity(
  voice: string | undefined,
  env: NodeJS.ProcessEnv,
  engine: LocalTtsEngine = resolveTtsEngine(env),
): string {
  return resolveBaseCacheVoice(engine, voice, env);
}

function cacheShortSegments(
  synth: SynthFn,
  voice: string,
  cache: Map<string, Uint8Array>,
  nextTempSequence: () => number,
  env: NodeJS.ProcessEnv,
): SynthFn {
  return async (text, opts): Promise<string> => {
    const clean = text.trim();
    if (
      env.CODEBUDDY_TTS_CACHE === 'false' ||
      !clean ||
      clean.length > SHORT_SEGMENT_CACHE_MAX_CHARS ||
      opts?.signal?.aborted
    ) {
      return synth(text, opts);
    }
    const key = createHash('sha1').update(`${text}|${voice}`).digest('hex');
    const hit = cache.get(key);
    if (hit) {
      try {
        cache.delete(key);
        cache.set(key, hit);
        const { writeFile } = await import('fs/promises');
        const wav = join(
          tmpdir(),
          `cb-voice-segment-${process.pid}-${nextTempSequence()}-${key.slice(0, 10)}.wav`,
        );
        await writeFile(wav, hit);
        logger.info('[voice] short-segment tts cache hit');
        return wav;
      } catch {
        cache.delete(key);
      }
    }

    const wav = await synth(text, opts);
    try {
      const { readFile } = await import('fs/promises');
      const bytes = await readFile(wav);
      cache.delete(key);
      cache.set(key, bytes);
      while (cache.size > SHORT_SEGMENT_CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next().value as string | undefined;
        if (!oldest) break;
        cache.delete(oldest);
      }
      logger.info('[voice] short-segment tts cache store');
    } catch {
      /* a cache miss or unreadable WAV must not alter normal synthesis */
    }
    return wav;
  };
}

/**
 * Build the per-turn prompt additions for a spoken reply.
 *
 * Emotion matching and opener variation are deliberately always-on: both are local,
 * deterministic, and contain no personal memory. The richer facts/episode/personality
 * block remains separately opt-in behind `CODEBUDDY_COMPANION_RELATIONAL`.
 *
 * Exported as a narrow test seam so the privacy boundary and default emotional behaviour
 * can be proven without starting a model.
 */
export async function buildSpokenPromptAugmentation(
  heard: string,
  history: VoiceHistoryTurn[] = [],
  spokenPrefix?: string,
  delivery?: VoiceDeliveryProfile,
  options: SpokenPromptAugmentationOptions = {},
): Promise<string> {
  const includeRecentDialogue =
    options.includeRecentDialogue ??
    process.env.CODEBUDDY_VOICE_INCLUDE_RECENT_DIALOGUE === 'true';
  const guidance = [
    prepareConversationTurn(heard, history, { includeRecentDialogue }).systemGuidance,
    delivery ? voiceDeliveryGuidance(delivery) : '',
    emotionGuidance(detectEmotion(heard)),
    emotionalContinuityGuidance(heard, history),
    spokenPrefix
      ? `Tu as déjà dit à voix haute : « ${spokenPrefix} » Enchaîne sans répéter cette idée ni cette formulation. Commence directement par la prochaine phrase utile du plan conversationnel.`
      : '',
    avoidOpenersGuidance(recentReplyOpeners),
  ]
    .filter(Boolean)
    .join('\n');

  let relational = '';
  if (process.env.CODEBUDDY_COMPANION_RELATIONAL === 'true') {
    try {
      const { getVoiceRelationalContext } = await import('../companion/relational-context.js');
      relational = await getVoiceRelationalContext();
    } catch {
      /* a missing relational source must never delay or break speech */
    }
  }

  // The shared snapshot contains only bounded symbolic observations (surface,
  // affect band, support/deliberation state and counters), never transcript
  // text. Unlike the richer facts/episode block above, it is part of the
  // explicitly linked voice ↔ channel thread and may therefore remain active
  // without enabling long-term relational memory.
  let sharedRelationship = '';
  try {
    const { getCrossChannelConversationBridge } = await import(
      '../conversation/cross-channel-bridge.js'
    );
    const bridge = getCrossChannelConversationBridge();
    if (bridge.isActive()) sharedRelationship = bridge.renderRelationshipContext();
  } catch {
    /* continuity is best-effort and must never delay or break speech */
  }

  return [relational, sharedRelationship, guidance].filter(Boolean).join('\n\n');
}

async function prepareSpokenTurn(
  heard: string,
  history: VoiceHistoryTurn[] = [],
  spokenPrefix?: string,
  delivery?: VoiceDeliveryProfile,
  replyOpts?: VoiceStepOptions,
  resolvedRoute?: VoiceModelRoute,
): Promise<{
  CodeBuddyClient: typeof import('../codebuddy/client.js').CodeBuddyClient;
  route: VoiceModelRoute;
  systemPrompt: string;
  cognitiveLease?: VoiceCognitiveContextLease;
}> {
  // These sources are independent. Resolving them concurrently removes avoidable serial
  // disk/import/routing time before the model request can start.
  const [clientModule, personaVoice, route, augmentation] = await Promise.all([
    import('../codebuddy/client.js'),
    import('../personas/persona-manager.js').then((m) => m.getActivePersonaVoiceAsync()),
    resolvedRoute ?? resolveVoiceModel(heard, { history }),
    buildSpokenPromptAugmentation(heard, history, spokenPrefix, delivery),
  ]);
  const basePrompt = personaVoice.spokenPrompt || SPEAK_SYSTEM_PROMPT;
  let cognitiveLease: VoiceCognitiveContextLease | undefined;
  try {
    cognitiveLease = replyOpts?.acquireCognitiveContext?.(route, heard) ?? undefined;
    if (cognitiveLease) {
      replyOpts?.onCognitiveContextResolved?.({
        turnContext: cognitiveLease.turnContext,
        evidence: cognitiveLease.evidence ?? '',
      });
    }
  } catch (error) {
    logger.warn(
      `[voice] cognitive context skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const cognitivePrompt = [cognitiveLease?.turnContext, cognitiveLease?.evidence]
    .filter(Boolean)
    .join('\n\n');
  const systemPrompt = [basePrompt, augmentation, cognitivePrompt].filter(Boolean).join('\n\n');
  return {
    CodeBuddyClient: clientModule.CodeBuddyClient,
    route,
    systemPrompt,
    ...(cognitiveLease ? { cognitiveLease } : {}),
  };
}

export async function defaultReply(
  heard: string,
  history: VoiceHistoryTurn[] = [],
  replyOpts?: VoiceStepOptions
): Promise<string> {
  const fast = fastCompanionReply(heard);
  if (fast) {
    logger.info(`[voice] fast reply chars=${fast.length}`);
    return fast;
  }
  let cognitiveLease: VoiceCognitiveContextLease | undefined;
  try {
    const delivery = replyOpts?.delivery ?? deriveVoiceDeliveryProfile(heard);
    const prepared = await prepareSpokenTurn(
      heard,
      history,
      undefined,
      delivery,
      replyOpts,
    );
    const { CodeBuddyClient, route, systemPrompt } = prepared;
    reportReplyTimingPhase(
      replyOpts,
      replyOpts?.spokenPrefix ? 'continuation_prompt_ready' : 'prompt_ready',
    );
    cognitiveLease = prepared.cognitiveLease;
    replyOpts?.onProviderResolved?.(route);
    logger.debug(`[voice] reply model: ${route.model} — ${route.reason}`);
    const client = new CodeBuddyClient(route.apiKey, route.model, route.baseURL);
    const resp = await client.chat(
      [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: heard },
      ] as never,
      [],
      // Additive: thread the barge-in signal so an interrupt aborts the in-flight
      // LLM call. Undefined when not interruptible → the call is unchanged.
      {
        temperature: voiceTemperature(),
        maxTokens: voiceMaxTokens(heard, history),
        ...(replyOpts?.signal ? { signal: replyOpts.signal } : {}),
      }
    );
    reportReplyTimingPhase(
      replyOpts,
      replyOpts?.spokenPrefix ? 'continuation_generation_complete' : 'generation_complete',
    );
    const reply = (resp?.choices?.[0]?.message?.content ?? '').trim();
    if (reply && !replyOpts?.signal?.aborted) cognitiveLease?.commit();
    else cognitiveLease?.release();
    return reply || conversationFailureReply(heard, history);
  } catch (err) {
    cognitiveLease?.release();
    logger.warn(`[voice] local reply failed: ${err instanceof Error ? err.message : String(err)}`);
    return replyOpts?.signal?.aborted ? '' : conversationFailureReply(heard, history);
  }
}

const SPOKEN_PREFIX_SYSTEM_APPEND = `<spoken_prefix_contract>
Réponds par une seule phrase française autonome de 180 caractères maximum.
Donne immédiatement une première proposition utile et prudente, pas une formule d'attente et pas l'annonce d'une action.
Cette phrase sera prononcée avant une réponse plus développée : elle doit pouvoir rester seule si l'utilisateur interrompt ensuite.
N'utilise ni liste, ni Markdown, ni citation inventée.
</spoken_prefix_contract>`;

/**
 * Fast first proposition for an eligible developed/deliberative turn. Eligibility and
 * semantic acceptance belong to the hybrid brain; this primitive only generates a candidate.
 */
export async function defaultSpokenPrefix(
  heard: string,
  history: VoiceHistoryTurn[] = [],
  replyOpts?: VoiceStepOptions,
): Promise<string> {
  try {
    if (replyOpts?.signal?.aborted) return '';
    const delivery = replyOpts?.delivery ?? deriveVoiceDeliveryProfile(heard);
    // Prefix generation deliberately does not acquire/commit resident cognitive context: the
    // hybrid semantic gate has not accepted this private draft yet.
    const prepared = await prepareSpokenTurn(
      heard,
      history,
      undefined,
      delivery,
      { signal: replyOpts?.signal, delivery },
    );
    const { CodeBuddyClient, route } = prepared;
    replyOpts?.onProviderResolved?.(route);
    reportReplyTimingPhase(replyOpts, 'prefix_prompt_ready');
    const client = new CodeBuddyClient(route.apiKey, route.model, route.baseURL);
    const response = await client.chat(
      [
        { role: 'system', content: `${prepared.systemPrompt}\n\n${SPOKEN_PREFIX_SYSTEM_APPEND}` },
        ...history,
        { role: 'user', content: heard },
      ] as never,
      [],
      {
        temperature: voiceTemperature(),
        maxTokens: 80,
        ...(replyOpts?.signal ? { signal: replyOpts.signal } : {}),
      },
    );
    reportReplyTimingPhase(replyOpts, 'prefix_generation_complete');
    return replyOpts?.signal?.aborted
      ? ''
      : (response?.choices?.[0]?.message?.content ?? '').trim();
  } catch (error) {
    logger.debug(
      `[voice] spoken prefix unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return '';
  }
}

/**
 * Default STREAMING think: the same short companion reply as `defaultReply`, but yielded as
 * token deltas so the voice pipeline can speak from the first sentence. Phatic small talk is
 * NOT streamed — it is answered by the instant canned reply on the blocking path, so this
 * generator yields nothing for it (the caller falls back). Any failure (unreachable model,
 * stream error) also yields nothing → graceful fallback to the blocking reply. Never-throws.
 */
export async function* defaultStreamReply(
  heard: string,
  replyOpts?: VoiceStepOptions
): AsyncGenerator<string, void, unknown> {
  yield* streamCompanionReply(heard, [], replyOpts);
}

/**
 * History-aware streaming companion reply used by the hybrid brain. Keeping this separate
 * from the `StreamReplyFn` adapter above lets small talk stream while preserving the same
 * recent exchanges as the blocking hybrid path.
 */
export async function* streamCompanionReply(
  heard: string,
  history: VoiceHistoryTurn[] = [],
  replyOpts?: VoiceStepOptions
): AsyncGenerator<string, void, unknown> {
  // Phatic → let the blocking path answer with the instant canned reply (non-streamed).
  if (fastCompanionReply(heard)) return;
  let cognitiveLease: VoiceCognitiveContextLease | undefined;
  let cognitiveLeaseSettled = false;
  try {
    const resolvedRoute = await resolveVoiceModel(heard, { history });
    const acknowledgement = replyOpts?.spokenPrefix
      ? null
      : immediateEmotionAcknowledgement(detectEmotion(heard)) ??
        immediateThinkingAcknowledgement(heard, process.env, resolvedRoute.baseURL);
    let full = '';
    if (acknowledgement) {
      full = `${acknowledgement} `;
      yield full;
    }
    const delivery = replyOpts?.delivery ?? deriveVoiceDeliveryProfile(heard);
    const prepared = await prepareSpokenTurn(
      heard,
      history,
      replyOpts?.spokenPrefix ?? acknowledgement ?? undefined,
      delivery,
      replyOpts,
      resolvedRoute,
    );
    const { CodeBuddyClient, route, systemPrompt } = prepared;
    reportReplyTimingPhase(
      replyOpts,
      replyOpts?.spokenPrefix ? 'continuation_prompt_ready' : 'prompt_ready',
    );
    cognitiveLease = prepared.cognitiveLease;
    replyOpts?.onProviderResolved?.(route);
    logger.debug(`[voice] stream reply model: ${route.model} — ${route.reason}`);
    const client = new CodeBuddyClient(route.apiKey, route.model, route.baseURL);
    let continuation = '';
    let continuationYielded = 0;
    let continuationEmitted = false;
    let providerDeltaSeen = false;
    for await (const chunk of client.chatStream(
      [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: heard },
      ] as never,
      [],
      // Additive: thread the barge-in signal so an interrupt aborts the in-flight stream.
      {
        temperature: voiceTemperature(),
        maxTokens: voiceMaxTokens(heard, history),
        ...(replyOpts?.signal ? { signal: replyOpts.signal } : {}),
      }
    )) {
      if (replyOpts?.signal?.aborted) break;
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        if (!providerDeltaSeen) {
          providerDeltaSeen = true;
          reportReplyTimingPhase(
            replyOpts,
            replyOpts?.spokenPrefix
              ? 'continuation_provider_first_delta'
              : 'provider_first_delta',
          );
        }
        if (!acknowledgement) {
          full += delta;
          yield delta;
          continue;
        }

        // The acknowledgement is already being spoken. Forward every safe token so the
        // downstream assembler starts Pocket early, while allowing the complete discourse
        // plan instead of truncating every substantive reply after one sentence.
        continuation += delta;
        const safeLength = safeCommitLength(continuation);
        if (safeLength > continuationYielded) {
          yield continuation.slice(continuationYielded, safeLength);
          continuationYielded = safeLength;
        }
      }
    }
    if (!replyOpts?.signal?.aborted) {
      reportReplyTimingPhase(
        replyOpts,
        replyOpts?.spokenPrefix ? 'continuation_generation_complete' : 'generation_complete',
      );
    }
    if (acknowledgement && !continuationEmitted) {
      const tail = continuation.trim();
      if (tail) {
        full += tail;
        continuationEmitted = true;
        if (continuationYielded < continuation.length) {
          yield continuation.slice(continuationYielded);
        }
      }
    }
    if (!replyOpts?.signal?.aborted && (full.trim() || continuation.trim())) {
      cognitiveLease?.commit();
      cognitiveLeaseSettled = true;
    } else {
      cognitiveLease?.release();
      cognitiveLeaseSettled = true;
    }
  } catch (err) {
    cognitiveLease?.release();
    cognitiveLeaseSettled = true;
    logger.warn(`[voice] stream reply failed: ${err instanceof Error ? err.message : String(err)}`);
    // Yields nothing → the pipeline falls back to the blocking reply.
  } finally {
    if (!cognitiveLeaseSettled) cognitiveLease?.release();
  }
}

/**
 * Default synth for the assistant's voice. Active engine picked from
 * Pocket TTS is the realtime default. Voicebox can render a more expressive
 * voice locally or on Darkstar; Pocket and Piper remain fail-open fallbacks.
 */
function resolveBaseCacheVoice(
  engine: LocalTtsEngine,
  voice?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (engine === 'pocket') {
    const pocketVoice = env.CODEBUDDY_POCKET_VOICE?.trim() || 'estelle';
    const language = resolvePocketLanguage(env.CODEBUDDY_POCKET_LANG ?? 'french');
    const quantize = env.CODEBUDDY_POCKET_QUANTIZE === 'true';
    return `pocket:${pocketVoice}:language=${language}:quantize=${quantize}`;
  }
  if (engine === 'voicebox') {
    const voicebox = resolveVoiceboxConfig(env);
    return [
      'voicebox',
      voicebox.baseUrl,
      voicebox.profile,
      voicebox.engine,
      voicebox.language,
      voicebox.modelSize,
      voicebox.instruct ?? '',
    ].join(':');
  }
  return voice || resolveDefaultPiperVoiceModel() || 'piper:default';
}

function makeDefaultSynth(
  voice?: string,
  rootDir?: string,
  engine: LocalTtsEngine = resolveTtsEngine(),
): SynthFn {
  const resolvedVoice = voice || resolveDefaultPiperVoiceModel();
  // Cache identity covers every acoustic input. `TtsCache` hashes this string,
  // so even a long Voicebox instruction never appears in the cache filename.
  const baseCacheVoice = resolveBaseCacheVoice(engine, resolvedVoice);

  const synthFresh = async (
    text: string,
    opts: VoiceStepOptions = {}
  ): Promise<{ wav: string; cacheable: boolean }> => {
    if (opts.signal?.aborted) throw new Error('TTS synthesis was interrupted');
    const wavPath = join(tmpdir(), `cb-voice-${process.pid}-${Date.now()}.wav`);
    if (engine === 'voicebox') {
      const { synthesizeVoiceboxWav } = await import('../voice/voicebox-tts.js');
      const deliveryInstruction = opts.delivery
        ? voiceRendererDeliveryInstruction(opts.delivery)
        : undefined;
      if (await synthesizeVoiceboxWav(text, wavPath, process.env, {
        signal: opts.signal,
        ...(deliveryInstruction ? { instruct: deliveryInstruction } : {}),
      })) {
        return { wav: wavPath, cacheable: true };
      }
      if (opts.signal?.aborted) throw new Error('TTS synthesis was interrupted');
      throw new Error('Voicebox TTS synthesis failed');
    } else if (engine === 'pocket') {
      const { synthesizePocketWav } = await import('../voice/local-tts.js');
      if (await synthesizePocketWav(text, wavPath, process.env, 180_000, opts.signal)) {
        return { wav: wavPath, cacheable: true };
      }
      if (opts.signal?.aborted) throw new Error('TTS synthesis was interrupted');
      throw new Error('Pocket TTS synthesis failed');
    }
    if (opts.signal?.aborted) throw new Error('TTS synthesis was interrupted');
    const { synthesizeTextToSpeech } = await import('../tools/text-to-speech-tool.js');
    const res = await synthesizeTextToSpeech(
      {
        text,
        provider: 'piper',
        format: 'wav',
        ...(resolvedVoice ? { voice: resolvedVoice } : {}),
      },
      rootDir ? { rootDir } : {}
    );
    await normalizeWavFile(res.outputPath, process.env);
    return { wav: res.outputPath, cacheable: true };
  };
  // Reuse the synthesized WAV for repeated phrases (greeting, "oui je t'entends", …) so
  // neither engine regenerates common speech. Best-effort: any cache error falls back to a fresh
  // synth. Opt-out with CODEBUDDY_TTS_CACHE=false.
  if (process.env.CODEBUDDY_TTS_CACHE === 'false') {
    return async (text, opts) => (await synthFresh(text, opts)).wav;
  }
  return async (text: string, opts: VoiceStepOptions = {}): Promise<string> => {
    if (opts.signal?.aborted) throw new Error('TTS synthesis was interrupted');
    if (text.trim().length > SHORT_SEGMENT_CACHE_MAX_CHARS) {
      return (await synthFresh(text, opts)).wav;
    }
    const cacheVoice = opts.delivery && engine === 'voicebox'
      ? `${baseCacheVoice}:${voiceRendererDeliveryInstruction(opts.delivery)}`
      : baseCacheVoice;
    let cache: TtsCache;
    try {
      const { getTtsCache } = await import('./tts-cache.js');
      cache = getTtsCache();
      const hit = cache.lookup(text, cacheVoice); // throwaway tmp copy (caller plays+unlinks it)
      if (hit) {
        logger.info('[voice] tts cache hit');
        return hit;
      }
    } catch {
      return (await synthFresh(text, opts)).wav;
    }
    const fresh = await synthFresh(text, opts);
    if (fresh.cacheable) {
      try {
        cache.store(text, cacheVoice, fresh.wav); // cache copy survives the caller's unlink
        logger.info('[voice] tts cache store');
      } catch {
        /* cache failures never make speech fail */
      }
    }
    return fresh.wav;
  };
}

interface VoiceAudioPlayer {
  cmd: string;
  stdinArgs: string[];
  fileArgs: (file: string) => string[];
}

async function resolveVoiceAudioPlayer(): Promise<VoiceAudioPlayer | null> {
  const candidates: VoiceAudioPlayer[] = [
    {
      cmd: 'aplay',
      stdinArgs: ['-q', '-'],
      fileArgs: (file) => ['-q', file],
    },
    {
      cmd: 'ffplay',
      stdinArgs: ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-i', 'pipe:0'],
      fileArgs: (file) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', file],
    },
  ];
  for (const candidate of candidates) {
    if (await commandExists(candidate.cmd)) return candidate;
  }
  return null;
}

function waitForPlayerDrain(
  child: ReturnType<typeof spawn>,
  stdin: NonNullable<ReturnType<typeof spawn>['stdin']>,
  signal?: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      stdin.off('drain', finish);
      child.off('close', finish);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    stdin.once('drain', finish);
    child.once('close', finish);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

/**
 * Pocket and Voicebox expose WAV response streams. Pipe the selected one into a
 * stdin-capable player so the first PCM frame is heard while Pocket is still
 * generating the rest, instead of calling `arrayBuffer()` and waiting for the
 * complete clip. Any setup/runtime failure returns false and the caller uses
 * the established temporary-WAV/Piper fallback.
 */
function makeDefaultStreamSpeak(
  playerPromise: Promise<VoiceAudioPlayer | null> = resolveVoiceAudioPlayer(),
  engine: LocalTtsEngine = resolveTtsEngine(),
): StreamSpeakFn | undefined {
  const streamEnabled = engine === 'voicebox'
    ? process.env.CODEBUDDY_VOICEBOX_AUDIO_STREAM !== 'false'
    : process.env.CODEBUDDY_POCKET_AUDIO_STREAM !== 'false';
  if (engine === 'piper' || !streamEnabled) {
    return undefined;
  }

  return async (text, opts = {}): Promise<boolean> => {
    const signal = opts.signal;
    if (signal?.aborted) return false;
    const player = await playerPromise;
    if (!player) return false;

    const baseCacheVoice = resolveBaseCacheVoice(engine);
    const cacheVoice = opts.delivery && engine === 'voicebox'
      ? `${baseCacheVoice}:${voiceRendererDeliveryInstruction(opts.delivery)}`
      : baseCacheVoice;
    const cachedBackchannel = await lookupInstantBackchannelWav(
      text,
      process.env,
      undefined,
      cacheVoice,
    );
    if (cachedBackchannel) {
      try {
        // The player starts reading a ready local WAV immediately: no HTTP,
        // model queue, or synthesis step remains on this acknowledgement.
        opts.onFirstAudio?.();
        await defaultPlay(cachedBackchannel, { signal }, playerPromise);
        logger.info('[voice] instant backchannel cache hit');
        return !signal?.aborted;
      } finally {
        try {
          const { unlink } = await import('node:fs/promises');
          await unlink(cachedBackchannel);
        } catch {
          /* throwaway cache copy */
        }
      }
    }

    const stream = engine === 'voicebox'
      ? await (async () => {
          const { openVoiceboxAudioStream } = await import('../voice/voicebox-tts.js');
          return openVoiceboxAudioStream(text, process.env, {
            signal,
            ...(opts.delivery
              ? { instruct: voiceRendererDeliveryInstruction(opts.delivery) }
              : {}),
          });
        })()
      : await (async () => {
          const { openPocketAudioStream } = await import('../voice/local-tts.js');
          return openPocketAudioStream(text, process.env, { signal });
        })();
    if (!stream || signal?.aborted) return false;

    const child = spawn(player.cmd, player.stdinArgs, { stdio: ['pipe', 'ignore', 'ignore'] });
    const stdin = child.stdin;
    if (!stdin) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* failed before the pipe was created */
      }
      return false;
    }
    const reader = stream.getReader();
    const gain = new Pcm16WavStreamGain(process.env);
    let firstAudio = false;
    let closedOk = false;
    let settled = false;
    let headReleaseTimer: NodeJS.Timeout | undefined;
    const configuredHeadTimeoutMs = Number(process.env.CODEBUDDY_TTS_STREAM_HEAD_TIMEOUT_MS);
    const headTimeoutMs = Number.isFinite(configuredHeadTimeoutMs) && configuredHeadTimeoutMs > 0
      ? Math.max(50, Math.min(1_000, configuredHeadTimeoutMs))
      : 250;
    const writeGainParts = (parts: Buffer[]): boolean => {
      let accepted = true;
      for (const part of parts) {
        opts.onAudioChunk?.(part);
        accepted = stdin.write(part) && accepted;
      }
      if (!firstAudio && gain.hasOutputAudio()) {
        firstAudio = true;
        opts.onFirstAudio?.();
      }
      return accepted;
    };
    const scheduleHeadRelease = (): void => {
      if (headReleaseTimer || gain.hasOutputAudio()) return;
      headReleaseTimer = setTimeout(() => {
        headReleaseTimer = undefined;
        if (settled || signal?.aborted) return;
        try {
          // A slow/stalled HTTP body must not hold the look-ahead forever.
          // The small partial head is safe to write without awaiting backpressure.
          writeGainParts(gain.releaseHead());
        } catch (err) {
          logger.debug(
            `[voice] streaming head release failed open: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }, headTimeoutMs);
    };
    const closed = new Promise<void>((resolve) => {
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        closedOk = ok;
        resolve();
      };
      child.once('error', () => finish(false));
      child.once('close', (code) => finish(code === 0));
    });
    // A player may close early (bad device/header); never let EPIPE become an
    // unhandled process error while the fetch body is still arriving.
    stdin.on('error', () => undefined);

    const timeoutMs = Number(process.env.CODEBUDDY_VOICE_PLAY_TIMEOUT_MS) || 60_000;
    const killTimer = setTimeout(() => {
      logger.warn(
        `[voice] streaming player ${player.cmd} exceeded ${timeoutMs}ms — killing it`
      );
      try {
        child.kill('SIGKILL');
      } catch {
        /* already stopped */
      }
    }, timeoutMs);

    const onAbort = (): void => {
      void reader.cancel().catch(() => undefined);
      try {
        child.kill('SIGKILL');
      } catch {
        /* already stopped */
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      while (!signal?.aborted && !settled) {
        const { done, value } = await reader.read();
        if (done) break;
        const accepted = writeGainParts(gain.push(value));
        scheduleHeadRelease();
        if (!accepted) await waitForPlayerDrain(child, stdin, signal);
      }
      if (headReleaseTimer) clearTimeout(headReleaseTimer);
      headReleaseTimer = undefined;
      if (!writeGainParts(gain.flush())) await waitForPlayerDrain(child, stdin, signal);
      if (!stdin.destroyed) stdin.end();
      await closed;
      return firstAudio && closedOk && !signal?.aborted;
    } catch (err) {
      if (!signal?.aborted) {
        logger.debug(
          `[voice] ${engine} audio pipe failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      try {
        child.kill('SIGKILL');
      } catch {
        /* already stopped */
      }
      return false;
    } finally {
      clearTimeout(killTimer);
      if (headReleaseTimer) clearTimeout(headReleaseTimer);
      signal?.removeEventListener('abort', onAbort);
      try {
        await reader.cancel();
      } catch {
        /* already consumed/cancelled */
      }
    }
  };
}

/** Default speak: play a WAV with the first available local player, blocking until done.
 *  Interruptible: when `opts.signal` aborts (barge-in), the audio child is SIGKILLed and
 *  the play resolves immediately so the ear can re-open. */
async function defaultPlay(
  wav: string,
  opts: VoiceStepOptions = {},
  playerPromise: Promise<VoiceAudioPlayer | null> = resolveVoiceAudioPlayer()
): Promise<void> {
  const signal = opts.signal;
  // Already interrupted before we even start → don't spawn anything.
  if (signal?.aborted) return;
  // This also migrates old, quiet cache entries on first playback. New Pocket
  // and Piper files are already normalized, so the operation is idempotent.
  await normalizeWavFile(wav, process.env);
  const player = await playerPromise;
  if (!player) {
    logger.warn('[voice] no audio player available (aplay/ffplay) — staying silent');
    return;
  }
  // A player that blocks instead of exiting (malformed WAV with a huge declared duration, an ALSA
  // device that hangs) would never resolve this promise. Under withSpeakingGuard that latches
  // isSpeaking()=true forever, so the speech reaction would drop every utterance and the robot goes
  // permanently deaf. A generous timeout (far beyond any real spoken line) kills the child and
  // recovers.
  const playTimeoutMs = Number(process.env.CODEBUDDY_VOICE_PLAY_TIMEOUT_MS) || 60_000;
  await new Promise<void>((resolve) => {
    const child = spawn(player.cmd, player.fileArgs(wav), { stdio: 'ignore' });
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const killTimer = setTimeout(() => {
      logger.warn(
        `[voice] player ${player.cmd} exceeded ${playTimeoutMs}ms — killing to avoid latching the speaking guard`
      );
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish();
    }, playTimeoutMs);
    // Barge-in: the same SIGKILL, but on demand instead of only on timeout.
    const onAbort = (): void => {
      logger.info(`[voice] playback interrupted — killing ${player.cmd}`);
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', finish);
    child.on('close', finish);
  });
}

/** Narrow test seam for verifying the shared per-turn player contract. */
export const __voiceAudioPlayerTest = {
  resolveVoiceAudioPlayer,
  resolveBaseCacheVoice,
  makeDefaultSynth,
  makeDefaultStreamSpeak,
  defaultPlay,
};

/**
 * Speak an arbitrary string aloud RIGHT NOW (proactively), not as a reply to something heard.
 * The missing primitive for reminders/announcements: synthesize → play → clean up.
 * Injectable synth/play for tests. Never-throws ($0 with local Pocket/Piper).
 */
export async function sayNow(
  text: string,
  options: VoiceStepOptions & {
    voice?: string;
    rootDir?: string;
    synth?: SynthFn;
    play?: PlayFn;
    /** `never` prevents a caller with its own bridge/notification from double-sending. */
    phoneDelivery?: 'env' | 'never';
  } = {}
): Promise<void> {
  // Sanity gate before the speakers AND the phone push: strip leaked control tokens + foreign-script
  // contamination (a local model drifting into CJK the voice can't pronounce), stay silent if nothing
  // meaningful remains. Clean once so speech, Telegram voice, and logs all use the same text.
  const t = prepareSpeech(text);
  if (!t) {
    if ((text ?? '').trim()) {
      logger.info(`[voice] sayNow muted after sanitize inputChars=${(text ?? '').length}`);
    }
    return;
  }
  // A persona-specific .onnx remains meaningful for the Piper fallback. Pocket uses its
  // own preset/clone selection from CODEBUDDY_POCKET_VOICE.
  let voice = options.voice;
  if (!voice && !options.synth) {
    try {
      const { getActivePersonaVoiceAsync } = await import('../personas/persona-manager.js');
      voice = (await getActivePersonaVoiceAsync()).voice;
    } catch {
      /* keep env default */
    }
  }
  // 1. Home speakers (best-effort — a missing audio device must not block the phone push).
  try {
    const synth = options.synth ?? makeDefaultSynth(voice, options.rootDir);
    const play = options.play ?? defaultPlay;
    const wav = await synth(t, { signal: options.signal });
    if (wav) {
      // Half-duplex: mute the ear while speaking. The signal lets barge-in kill this player too.
      await withSpeakingGuard(() => {
        noteSpokenText(t);
        return play(wav, { signal: options.signal });
      });
      try {
        const { unlink } = await import('fs/promises');
        await unlink(wav);
      } catch {
        /* leave the file if cleanup fails */
      }
    }
  } catch (err) {
    logger.warn(
      `[voice] sayNow (local) failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  // 2. Phone — when traveling, push the same line as a Telegram VOICE NOTE so it reaches you
  //    even with no one at the speakers. Opt-in, best-effort.
  if (
    options.phoneDelivery !== 'never' &&
    process.env.CODEBUDDY_VOICE_TO_TELEGRAM === 'true'
  ) {
    try {
      const { sendTelegramVoice } = await import('./alert.js');
      await sendTelegramVoice(t);
    } catch (err) {
      logger.warn(
        `[voice] sayNow (telegram) failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

/**
 * An `onHeard` handler (callable as `(heard) => Promise<void>`) with an added `interrupt()`
 * method — the foundation of barge-in. It is a plain function so it drops into
 * `wireSpeechReaction({ onHeard: makeVoiceReply() })` unchanged; `.interrupt()` is an
 * extra property, not a new call contract.
 */
export interface VoiceReplyHandler {
  (heard: string, context?: VoiceTurnContext): Promise<void>;
  /** Last completed turn timing (also available through `VoiceReplyOptions.onTiming`). */
  lastTiming?: VoiceReplyTiming;
  /**
   * Cancel the in-flight spoken turn (barge-in): abort the LLM/agent think step (its HTTP
   * request), kill the TTS playback, and hard-reset the half-duplex guard so the ear re-opens
   * IMMEDIATELY (no echo tail). The handler promise then resolves, which lets the speech-reaction
   * queue drain the next utterance with no blocked state. Idempotent, never-throws; a no-op when
   * nothing is in flight.
   */
  interrupt(turnId?: string): void;
}

/**
 * Build an `onHeard` handler that thinks then speaks, with a programmatic `interrupt()`.
 * Never-throws. Wire it into `wireSpeechReaction({ onHeard: makeVoiceReply() })`.
 *
 * Interruption is driven by one correlated `AbortController` per turn: `interrupt(turnId)`
 * targets it, cancels the think step (signal → provider transport), and kills the TTS child.
 * Without an `interrupt()` call the controller is never aborted, so the turn runs exactly as
 * before (tour-par-tour bloquant) — the signal threading is inert.
 */
export function makeVoiceReply(options: VoiceReplyOptions = {}): VoiceReplyHandler {
  // Default think step: adapt `defaultReply(heard, history, opts)` to the `ReplyFn(heard, opts)`
  // contract so the barge-in signal reaches the LLM call.
  const replyFn: ReplyFn = options.replyFn ?? ((heard, opts) => defaultReply(heard, [], opts));
  // Streaming think step (pipeline: speak from the first sentence). A hybrid reply can expose
  // its matching stream as a function property; detect it here so wrapping that reply no longer
  // disables streaming accidentally. Plain injected ReplyFns keep their blocking contract.
  const embeddedReply = options.replyFn as
    | (ReplyFn & { stream?: StreamReplyFn; spokenPrefix?: SpokenPrefixFn })
    | undefined;
  const embeddedStream = embeddedReply?.stream;
  const spokenPrefixFn = embeddedReply?.spokenPrefix;
  const streamFn: StreamReplyFn | undefined =
    options.streamFn ?? embeddedStream ?? (options.replyFn ? undefined : defaultStreamReply);
  const visualGrounding: VisualGroundingFn = options.visualGrounding ?? (
    (utterance, groundingOptions) => groundExplicitVisualRequest(utterance, {
      cwd: groundingOptions?.cwd ?? options.rootDir ?? process.cwd(),
      ...(groundingOptions?.signal ? { signal: groundingOptions.signal } : {}),
    })
  );
  const visualConsent = new VisualConsentGate();
  const turnCoordinator = getVoiceTurnCoordinator();
  const env = options.env ?? process.env;
  const shortSegmentCache = new Map<string, Uint8Array>();
  let shortSegmentTempSequence = 0;

  // Resolve any persona-specific fallback voice per reply. Shared by the streaming and
  // blocking paths so synthesis selection has one source of truth.
  const resolveSynth = async (engine: LocalTtsEngine): Promise<SynthFn> => {
    let voice = options.voice;
    if (!options.synth && !voice) {
      try {
        const { getActivePersonaVoiceAsync } = await import('../personas/persona-manager.js');
        voice = (await getActivePersonaVoiceAsync()).voice;
      } catch {
        /* keep env default */
      }
    }
    const baseSynth = options.synth ?? makeDefaultSynth(voice, options.rootDir, engine);
    return cacheShortSegments(
      baseSynth,
      shortSegmentVoiceIdentity(voice, env, engine),
      shortSegmentCache,
      () => ++shortSegmentTempSequence,
      env,
    );
  };

  // Concurrent ingress can briefly overlap turns. Keep cancellation handles correlated instead
  // of letting the newest turn overwrite the previous controller.
  const activeAborts = new Map<string, AbortController>();
  let latestTurnId: string | undefined;

  const handler = async (heard: string, context?: VoiceTurnContext): Promise<void> => {
    const controller = new AbortController();
    const voiceTurnId = context?.turnId ?? createAvatarTurnId();
    activeAborts.set(voiceTurnId, controller);
    latestTurnId = voiceTurnId;
    const { signal } = controller;
    const turnTtsEngine = resolveTtsEngine(env);
    // Resolve one WAV-aware backend for the complete turn. Cached files,
    // progressive stdin audio, and blocking fallbacks all share this promise.
    const playerPromise = options.play
      ? Promise.resolve<VoiceAudioPlayer | null>(null)
      : resolveVoiceAudioPlayer();
    const play: PlayFn = options.play ?? (
      (wav, opts) => defaultPlay(wav, opts, playerPromise)
    );
    // An explicit progressive path wins even when synth/play are also injected:
    // diagnostics can consume the real HTTP stream into a null sink while
    // retaining deterministic fallbacks. Otherwise preserve the production-only
    // native stream rule so older injected synth/player tests keep their contract.
    const nativeStreamSpeak = options.streamSpeak ?? (
      !options.synth && !options.play
        ? makeDefaultStreamSpeak(playerPromise, turnTtsEngine)
        : undefined
    );
    const delivery = deriveVoiceDeliveryProfile(heard, context);
    const startedAt = Date.now();
    let replyMs = 0;
    let synthMs = 0;
    let playMs = 0;
    let promptReadyMs: number | undefined;
    let providerFirstDeltaMs: number | undefined;
    let generationCompleteMs: number | undefined;
    let semanticReviewCompleteMs: number | undefined;
    let prefixPromptReadyMs: number | undefined;
    let prefixProviderFirstDeltaMs: number | undefined;
    let prefixGenerationCompleteMs: number | undefined;
    let prefixSemanticReviewCompleteMs: number | undefined;
    let continuationPromptReadyMs: number | undefined;
    let continuationProviderFirstDeltaMs: number | undefined;
    let continuationGenerationCompleteMs: number | undefined;
    let continuationSemanticReviewCompleteMs: number | undefined;
    const spokenPrefixCauses: SpokenPrefixTelemetryCause[] = [];
    const noteSpokenPrefixCause = (cause: SpokenPrefixTelemetryCause): void => {
      if (!spokenPrefixCauses.includes(cause)) spokenPrefixCauses.push(cause);
    };
    let firstSafeReleaseMs: number | undefined;
    let firstTextMs: number | undefined;
    let firstSegmentMs: number | undefined;
    let firstAudioMs: number | undefined;
    let firstContentAudioMs: number | undefined;
    let streamFallbackSegments = 0;
    let streamRouteRemote = false;
    let semanticCorrectionPromise: Promise<string> | undefined;
    let mode: VoiceReplyTiming['mode'] = 'silent';
    let spoke = false;
    let assistantTurnPublished = false;
    let armedVisualConsent: number | undefined;
    let avatarPrepared = false;
    let avatarSpeechStarted = false;
    let avatarAudioStreamIndex = 0;
    let avatarSpeechStartedAt: number | undefined;
    let avatarFinalText = '';
    const markReplyTimingPhase = (phase: VoiceReplyTimingPhase): void => {
      const elapsed = Date.now() - startedAt;
      switch (phase) {
        case 'prompt_ready':
          promptReadyMs ??= elapsed;
          break;
        case 'provider_first_delta':
          providerFirstDeltaMs ??= elapsed;
          break;
        case 'generation_complete':
          generationCompleteMs ??= elapsed;
          break;
        case 'semantic_review_complete':
          semanticReviewCompleteMs ??= elapsed;
          break;
        case 'prefix_prompt_ready':
          prefixPromptReadyMs ??= elapsed;
          break;
        case 'prefix_provider_first_delta':
          prefixProviderFirstDeltaMs ??= elapsed;
          break;
        case 'prefix_generation_complete':
          prefixGenerationCompleteMs ??= elapsed;
          break;
        case 'prefix_semantic_review_complete':
          prefixSemanticReviewCompleteMs ??= elapsed;
          break;
        case 'continuation_prompt_ready':
          continuationPromptReadyMs ??= elapsed;
          break;
        case 'continuation_provider_first_delta':
          continuationProviderFirstDeltaMs ??= elapsed;
          break;
        case 'continuation_generation_complete':
          continuationGenerationCompleteMs ??= elapsed;
          break;
        case 'continuation_semantic_review_complete':
          continuationSemanticReviewCompleteMs ??= elapsed;
          break;
      }
    };
    const avatarTurnId = voiceTurnId;
    turnCoordinator.transition(avatarTurnId, 'thinking');
    const avatarCue = planAvatarPerformance(heard, delivery);
    const avatarEnabled = options.avatarEnabled ?? (
      process.env.CODEBUDDY_AVATAR_BRIDGE !== 'false' || Boolean(options.onAvatarEvent)
    );
    const emitAvatarEvent = (input: AvatarEventInput): void => {
      if (!avatarEnabled) return;
      try {
        const event = getAvatarEventBus().publish(input);
        options.onAvatarEvent?.(event);
      } catch (error) {
        logger.debug(
          `[voice] avatar event skipped: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    };
    const createAvatarAudioPublisher = (source: 'live' | 'buffered') => {
      // Decide once, before the first WAV byte. Enabling halfway through a live
      // stream would give a newly connected renderer PCM without its RIFF header.
      const enabled = shouldStreamAvatarAudio();
      const streamId = `${avatarTurnId}:audio:${avatarAudioStreamIndex++}`;
      let started = false;
      let chunkIndex = 0;
      let byteOffset = 0;
      const push = (chunk: Uint8Array): void => {
        if (!enabled) return;
        const pieces = splitAvatarAudioChunk(chunk);
        if (pieces.length === 0) return;
        if (!started) {
          started = true;
          emitAvatarEvent({
            type: 'avatar.audio.started',
            turnId: avatarTurnId,
            streamId,
            format: 'wav_stream',
            encoding: 'base64',
            source,
            maxChunkBytes: MAX_AVATAR_AUDIO_CHUNK_BYTES,
          });
        }
        for (const piece of pieces) {
          emitAvatarEvent({
            type: 'avatar.audio.chunk',
            turnId: avatarTurnId,
            streamId,
            format: 'wav_stream',
            chunkIndex: chunkIndex++,
            byteOffset,
            byteLength: piece.byteLength,
            data: Buffer.from(piece).toString('base64'),
          });
          byteOffset += piece.byteLength;
        }
      };
      const end = (outcome: 'complete' | 'interrupted' | 'failed'): void => {
        if (!started) return;
        emitAvatarEvent({
          type: 'avatar.audio.ended',
          turnId: avatarTurnId,
          streamId,
          totalBytes: byteOffset,
          chunks: chunkIndex,
          outcome,
        });
      };
      return { push, end };
    };
    const publishAvatarBufferedWav = async (wav: string): Promise<void> => {
      if (!shouldStreamAvatarAudio()) return;
      const publisher = createAvatarAudioPublisher('buffered');
      try {
        const { readFile } = await import('node:fs/promises');
        publisher.push(await readFile(wav));
        publisher.end('complete');
      } catch {
        publisher.end('failed');
      }
    };
    const prepareAvatarSpeech = (text: string): void => {
      const content = text.trim();
      if (!content) return;
      avatarFinalText = content;
      if (avatarPrepared) return;
      avatarPrepared = true;
      emitAvatarEvent({
        type: 'avatar.speech.prepared',
        turnId: avatarTurnId,
        text: content,
        cue: avatarCue,
        prosody: planAvatarSpeechProsody(content, avatarCue),
      });
    };
    const emitAvatarSegment = (text: string): void => {
      if (avatarPrepared || !text) return;
      emitAvatarEvent({
        type: 'avatar.speech.segment',
        turnId: avatarTurnId,
        text,
        cue: avatarCue,
        prosody: planAvatarSpeechProsody(text, avatarCue),
      });
    };
    const markAvatarSpeechStarted = (): void => {
      if (avatarSpeechStarted) return;
      avatarSpeechStarted = true;
      avatarSpeechStartedAt = Date.now();
      turnCoordinator.transition(avatarTurnId, 'speaking', {
        ...(firstAudioMs !== undefined ? { firstAudioMs } : {}),
      });
      emitAvatarEvent({ type: 'avatar.speech.started', turnId: avatarTurnId });
    };
    emitAvatarEvent({
      type: 'avatar.turn.started',
      turnId: avatarTurnId,
      cue: avatarCue,
    });
    const publishTurn = (turn: ConversationTurn): void => {
      try {
        const result = options.onConversationTurn?.(turn);
        if (result && typeof result.then === 'function') {
          void result.catch((error) => {
            logger.warn(
              `[voice] conversation mirror failed: ${error instanceof Error ? error.message : String(error)}`
            );
          });
        }
      } catch (error) {
        logger.warn(
          `[voice] conversation mirror failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      try {
        const result = options.onCorrelatedConversationTurn?.({ ...turn, turnId: avatarTurnId });
        if (result && typeof result.then === 'function') {
          void result.catch((error) => {
            logger.warn(
              `[voice] cognitive turn mirror failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        }
      } catch (error) {
        logger.warn(
          `[voice] cognitive turn mirror failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    const publishAssistantTurn = (content: string): void => {
      if (assistantTurnPublished || !content.trim()) return;
      assistantTurnPublished = true;
      avatarFinalText = content.trim();
      publishTurn({ role: 'assistant', content });
    };
    publishTurn({ role: 'user', content: heard });
    const streamedWavMetadata = new Map<string, { isContent: boolean; text: string }>();
    const timedPlay: PlayFn = async (wav, opts) => {
      const metadata = streamedWavMetadata.get(wav);
      if (metadata) noteSpokenText(metadata.text);
      if (firstAudioMs === undefined) firstAudioMs = Date.now() - startedAt;
      await publishAvatarBufferedWav(wav);
      markAvatarSpeechStarted();
      if (
        firstContentAudioMs === undefined &&
        metadata?.isContent !== false
      ) {
        firstContentAudioMs = Date.now() - startedAt;
      }
      try {
        await play(wav, { ...(opts ?? {}), delivery });
      } finally {
        streamedWavMetadata.delete(wav);
      }
    };
    const timedStreamSpeak: StreamSpeakFn | undefined = nativeStreamSpeak
      ? async (text, opts = {}) => {
            if (firstSegmentMs === undefined) firstSegmentMs = Date.now() - startedAt;
            emitAvatarSegment(text);
            noteSpokenText(text);
            const isBackchannel = INSTANT_BACKCHANNELS.has(text.trim());
            const publisher = createAvatarAudioPublisher('live');
            let streamed = false;
            try {
              streamed = await nativeStreamSpeak(text, {
                ...opts,
                delivery,
                onAudioChunk: (chunk) => {
                  publisher.push(chunk);
                  opts.onAudioChunk?.(chunk);
                },
                onFirstAudio: () => {
                  if (firstAudioMs === undefined) firstAudioMs = Date.now() - startedAt;
                  markAvatarSpeechStarted();
                  if (!isBackchannel && firstContentAudioMs === undefined) {
                    firstContentAudioMs = Date.now() - startedAt;
                  }
                  opts.onFirstAudio?.();
                },
              });
              return streamed;
            } finally {
              publisher.end(signal.aborted ? 'interrupted' : streamed ? 'complete' : 'failed');
            }
          }
      : undefined;
    const speakSemanticCorrection = async (): Promise<string> => {
      const pending = semanticCorrectionPromise;
      semanticCorrectionPromise = undefined;
      if (!pending || signal.aborted) return '';
      try {
        const correction = prepareSpeech(await pending);
        if (!correction || signal.aborted) return '';
        const guarded = guardRelationshipReply(correction).response.trim();
        if (!guarded || signal.aborted) return '';
        if (timedStreamSpeak) {
          let streamed = false;
          await withSpeakingGuard(async () => {
            streamed = await timedStreamSpeak(guarded, { signal, delivery });
          });
          if (streamed && !signal.aborted) return guarded;
        }
        const correctionSynth = await resolveSynth(turnTtsEngine);
        const wav = await correctionSynth(guarded, { signal, delivery });
        if (!wav || signal.aborted) return '';
        await withSpeakingGuard(() => timedPlay(wav, { signal, delivery }));
        try {
          const { unlink } = await import('fs/promises');
          await unlink(wav);
        } catch {
          /* throwaway correction WAV */
        }
        return signal.aborted ? '' : guarded;
      } catch (error) {
        logger.warn(
          `[voice] semantic correction unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
        return '';
      }
    };
    try {
      // ---- VISUAL GROUNDING: explicit one-shot camera request ----
      // This must precede both the stream and blocking reply functions. In
      // production those functions are the hybrid brain, whose first branch is
      // the phatic/prefetch shortcut and whose grounded branch depends on
      // SPEAK_ACT. Seeing is a perception capability, not an action-mode perk.
      let visualReply: string | undefined;
      let visualRequest = heard;
      const consent = visualConsent.consume(heard);
      if (consent.decision === 'confirmed') {
        visualRequest = consent.utterance;
      } else if (consent.decision === 'declined') {
        visualReply = "D'accord, je n'ouvre pas la caméra.";
      } else if (consent.decision === 'expired') {
        visualReply =
          "J'ai laissé expirer l'autorisation. Redis-moi simplement ce que tu veux me montrer.";
      } else if (isAmbiguousVisualGroundingRequest(heard)) {
        armedVisualConsent = visualConsent.request(heard);
        visualReply =
          "Oui, je peux regarder. Tu veux que j'ouvre la caméra juste le temps de prendre une image ?";
      }
      const shouldGroundVisual =
        consent.decision === 'confirmed' ||
        (visualReply === undefined && isExplicitVisualGroundingRequest(heard));
      if (shouldGroundVisual) {
        const visualStartedAt = Date.now();
        try {
          const result = await visualGrounding(visualRequest, {
            cwd: options.rootDir ?? process.cwd(),
            signal,
          });
          replyMs = Date.now() - visualStartedAt;
          if (signal.aborted || result?.status === 'aborted') return;
          visualReply = result?.response ||
            "Je n'ai pas réussi à obtenir une observation visuelle fiable cette fois-ci.";
          logger.info(
            `[voice] explicit visual grounding status=${result?.status ?? 'unavailable'} ` +
              `evidenceChars=${result?.evidence?.summary.length ?? 0}`,
          );
        } catch (error) {
          replyMs = Date.now() - visualStartedAt;
          logger.warn(
            `[voice] explicit visual grounding failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          visualReply =
            "Je n'ai pas réussi à obtenir une observation visuelle fiable cette fois-ci.";
        }
      }

      // ---- FAST PATH: streaming pipeline — speak from the first sentence ----
      // Never lets a streaming failure crash the turn; on nothing-spoken it falls through to
      // the blocking path below (which is the original, unchanged tour-par-tour behavior).
      if (streamFn && visualReply === undefined) {
        try {
          const relationshipSafety = new RelationshipSafetyStreamGuard();
          const timedReplyStream = (async function* (): AsyncGenerator<string> {
            let atStreamStart = true;
            let spokenPrefix = '';
            if (spokenPrefixFn) {
              const candidate = await spokenPrefixFn(heard, {
                signal,
                delivery,
                onReplyTimingPhase: markReplyTimingPhase,
                onSpokenPrefixTelemetry: noteSpokenPrefixCause,
              });
              if (signal.aborted) return;
              const causesBeforeFinalGuard = spokenPrefixCauses.length;
              spokenPrefix = prepareSpokenPrefixCandidate(
                candidate,
                noteSpokenPrefixCause,
              );
              if (candidate.trim() && !spokenPrefix) {
                noteSpokenPrefixCause('final_guard_invalid');
              } else if (!candidate.trim() && spokenPrefixCauses.length === causesBeforeFinalGuard) {
                noteSpokenPrefixCause('empty');
              }
              if (spokenPrefix) {
                noteSpokenPrefixCause('accepted');
                if (firstTextMs === undefined) firstTextMs = Date.now() - startedAt;
                firstSafeReleaseMs ??= Date.now() - startedAt;
                atStreamStart = false;
                // The assembler only commits punctuation once whitespace/EOS proves the
                // boundary. Emit that boundary now so continuation generation can fail or be
                // interrupted without trapping an already accepted prefix in its buffer.
                yield `${spokenPrefix} `;
              }
            }
            for await (const delta of streamFn(heard, {
              signal,
              delivery,
              ...(spokenPrefix ? { spokenPrefix } : {}),
              onReplyTimingPhase: markReplyTimingPhase,
              onProviderResolved: (route) => {
                streamRouteRemote = isRemoteVoiceRoute(route.baseURL);
              },
            })) {
              // Provider first-token latency is measured on the raw delta. The
              // safety gate intentionally waits for a sentence boundary before
              // release, which is a separate (and potentially much longer)
              // first-safe-sentence latency.
              if (firstTextMs === undefined && delta.length > 0) {
                firstTextMs = Date.now() - startedAt;
              }
              // These prefixes are deterministic local constants, never model
              // prose. Release the one allowlisted acknowledgement immediately
              // while the relationship gate continues to hold and inspect the
              // entire generated answer. Previously the full-answer guard also
              // trapped "Alors…" until generation finished, defeating the
              // prewarmed backchannel and leaving 6–8 seconds of dead air.
              if (atStreamStart && INSTANT_BACKCHANNELS.has(delta.trim())) {
                atStreamStart = false;
                yield delta;
                continue;
              }
              if (delta.length > 0) atStreamStart = false;
              for (const safeDelta of relationshipSafety.push(delta)) {
                firstSafeReleaseMs ??= Date.now() - startedAt;
                yield safeDelta;
              }
            }
            for (const safeDelta of relationshipSafety.finish()) {
              firstSafeReleaseMs ??= Date.now() - startedAt;
              yield safeDelta;
            }
            const safety = relationshipSafety.assessment();
            if (safety.intervened) {
              logger.warn(
                `[voice] relationship safety gate intervened: ${safety.issues.join(',')}`
              );
            }
          })();
          // Resolve the regular synthesizer in parallel with the LLM stream. Native Pocket
          // keeps this lazy (zero work on the healthy path), but can still recover the exact
          // streamed sentence without asking the LLM to generate the answer a second time.
          let baseSynthPromise: Promise<SynthFn> | undefined = timedStreamSpeak
            ? undefined
            : resolveSynth(turnTtsEngine);
          const synth: SynthFn = async (text, synthOpts) => {
            if (firstSegmentMs === undefined) firstSegmentMs = Date.now() - startedAt;
            emitAvatarSegment(text);
            baseSynthPromise ??= resolveSynth(turnTtsEngine);
            const baseSynth = await baseSynthPromise;
            const wav = await baseSynth(text, { ...(synthOpts ?? {}), delivery });
            if (wav) {
              streamedWavMetadata.set(wav, {
                isContent: !INSTANT_BACKCHANNELS.has(text.trim()),
                text,
              });
            }
            return wav;
          };
          const result = await streamToSpeech({
            stream: timedReplyStream,
            synth,
            play: timedPlay,
            sanitize: (() => {
              let firstSegment = true;
              return (raw: string): string => {
                const clean = prepareSpeech(raw);
                if (!clean) return '';
                if (!firstSegment) return clean;
                firstSegment = false;
                return rewriteRepeatedVoiceOpener(clean);
              };
            })(),
            ...(timedStreamSpeak ? { streamSpeak: timedStreamSpeak } : {}),
            signal,
            cap: options.sentenceCap ?? voiceSentenceCap(),
            audioPrebufferMs: () => streamRouteRemote ? voiceAudioPrebufferMs(env) : 0,
          });
          streamFallbackSegments = result.fallbackSegments ?? 0;
          if (signal.aborted) {
            // Preserve only sentences whose playback completed before the
            // interruption. The partial in-flight segment is deliberately
            // absent from `result.spoken` and must not enter continuity.
            if (result.spoken.trim()) {
              noteSpokenText(result.spoken);
              publishAssistantTurn(result.spoken);
            }
            return;
          }
          if (result.played) {
            mode = 'streamed';
            spoke = true;
            // Segment references protect the live playback edge; the complete
            // canonical turn protects the acoustic tail and STT transcripts
            // that merge several spoken segments into one utterance.
            noteSpokenText(result.spoken);
            recentReplyOpeners = pushOpener(recentReplyOpeners, result.spoken);
            publishAssistantTurn(result.spoken);
            logger.info(`[voice] spoke (streamed) chars=${result.spoken.length}`);
            logger.info(
              `[voice] streamed ${result.sentences.length} phrase(s) in ${Date.now() - startedAt}ms`
            );
            logger.info(
              `[voice] stream latency: text=${firstTextMs ?? -1}ms ` +
                `segment=${firstSegmentMs ?? -1}ms firstAudio=${firstAudioMs ?? -1}ms ` +
                `contentAudio=${firstContentAudioMs ?? -1}ms ` +
                `fallbackSegments=${streamFallbackSegments}`
            );
            options.onSpoke?.(result.spoken);
            return;
          }
          // Nothing speakable came through the stream (phatic, empty, all-artifact, or a stream
          // error) → fall through to the blocking reply below.
          logger.debug(
            '[voice] stream produced nothing speakable — falling back to blocking reply'
          );
        } catch (err) {
          logger.warn(
            `[voice] streaming path failed, falling back to blocking: ${err instanceof Error ? err.message : String(err)}`
          );
          if (signal.aborted) return;
        }
      }

      // ---- BLOCKING FALLBACK: the original tour-par-tour behavior, unchanged ----
      let rawReply: string;
      if (visualReply !== undefined) {
        rawReply = visualReply;
      } else {
        const replyStart = Date.now();
        rawReply = await replyFn(heard, {
          signal,
          delivery,
          onReplyTimingPhase: markReplyTimingPhase,
          onSemanticCorrection: (correction) => {
            semanticCorrectionPromise = correction.catch(() => '');
          },
        });
        replyMs = Date.now() - replyStart;
      }
      // Interrupted during the think step → abandon silently (never speak a stale reply).
      if (signal.aborted) return;
      // Sanity gate before synth: strip leaked control tokens + foreign-script contamination
      // (observed: a French reply degrading into CJK the voice can't pronounce), stay silent
      // if nothing meaningful survives. `reply` is what we synth, log, and hand to onSpoke.
      const preparedReply = prepareSpeech(rawReply);
      const relationshipGuard = guardRelationshipReply(preparedReply ?? '');
      let reply = relationshipGuard.response;
      let emptyReplyRecovery = false;
      if (reply) firstSafeReleaseMs ??= Date.now() - startedAt;
      if (relationshipGuard.intervened) {
        logger.warn(
          `[voice] relationship safety gate intervened: ${relationshipGuard.issues.join(',')}`
        );
      }
      if (!reply) {
        if ((rawReply ?? '').trim()) {
          logger.info(`[voice] reply muted after sanitize inputChars=${(rawReply ?? '').length}`);
        }
        let route: VoiceModelRoute | undefined;
        try {
          route = await (options.resolveRoute ?? ((text) => resolveVoiceModel(text, { env })))(heard);
        } catch (error) {
          logger.debug(
            `[voice] empty-reply readiness route unavailable: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const readiness = describeVoiceReadiness(env, route);
        if (readiness.ready) return;
        reply = EMPTY_REPLY_RECOVERY;
        emptyReplyRecovery = true;
        mode = 'failed';
        logger.warn(
          `[voice] empty reply with degraded readiness — speaking recovery ` +
            `modelReady=${readiness.modelReady} speakReady=${readiness.speakReady}`,
        );
      }
      if (!emptyReplyRecovery) reply = rewriteRepeatedVoiceOpener(reply);
      recentReplyOpeners = pushOpener(recentReplyOpeners, reply);
      // The textual answer is now committed even if the local audio device fails;
      // publish it to the shared channel so the conversation never disappears.
      publishAssistantTurn(reply);
      prepareAvatarSpeech(reply);
      // Pocket's server streams WAV frames natively. For a blocking agent
      // result we still cannot speak before the text exists, but we can remove
      // the former multi-second `synth(all)` wait once it does.
      if (timedStreamSpeak) {
        const playStart = Date.now();
        let streamed = false;
        await withSpeakingGuard(async () => {
          streamed = await timedStreamSpeak(reply, { signal, delivery });
        });
        playMs = Date.now() - playStart;
        if (signal.aborted) return;
        if (streamed) {
          if (!emptyReplyRecovery) mode = 'blocking';
          spoke = true;
          const correction = await speakSemanticCorrection();
          logger.info(
            `[voice] spoke (${turnTtsEngine} audio stream) chars=${reply.length}`
          );
          logger.info(
            `[voice] timings: reply=${replyMs}ms firstAudio=${firstAudioMs ?? -1}ms ` +
              `streamPlay=${playMs}ms total=${Date.now() - startedAt}ms`
          );
          options.onSpoke?.([reply, correction].filter(Boolean).join(' '));
          return;
        }
        logger.debug(
          `[voice] ${turnTtsEngine} audio stream unavailable — using WAV synthesis fallback`
        );
      }
      const synth = await resolveSynth(turnTtsEngine);
      const synthStart = Date.now();
      const wav = await synth(reply, { signal, delivery });
      synthMs = Date.now() - synthStart;
      if (!wav) return;
      // Interrupted during synth → don't start playback.
      if (signal.aborted) return;
      const playStart = Date.now();
      await withSpeakingGuard(() => {
        noteSpokenText(reply);
        return timedPlay(wav, { signal, delivery });
      }); // half-duplex + interruptible
      playMs = Date.now() - playStart;
      // A barge-in kills the player early; don't claim we "spoke" the whole line.
      if (signal.aborted) return;
      if (!emptyReplyRecovery) mode = 'blocking';
      spoke = true;
      const correction = await speakSemanticCorrection();
      logger.info(`[voice] spoke chars=${reply.length}`);
      logger.info(
        `[voice] timings: reply=${replyMs}ms synth=${synthMs}ms play=${playMs}ms total=${Date.now() - startedAt}ms`
      );
      options.onSpoke?.([reply, correction].filter(Boolean).join(' '));
      // Best-effort cleanup of the synthesized WAV.
      try {
        const { unlink } = await import('fs/promises');
        await unlink(wav);
      } catch {
        /* leave the file if cleanup fails — not worth surfacing */
      }
    } catch (err) {
      mode = 'failed';
      logger.warn(
        `[voice] reply→speak failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      // A permission question that never reached the speakers cannot authorize
      // a later camera capture. A barge-in confirmation consumes the pending
      // request before this older turn reaches its finally block.
      if (armedVisualConsent !== undefined && !spoke) {
        visualConsent.cancel(armedVisualConsent);
      }
      // If THIS turn was interrupted, hard-reset the half-duplex guard so the ear re-opens NOW
      // (barge-in), overriding the echo tail that withSpeakingGuard's finally just armed. Runs
      // last, so it wins the race against that endSpeaking(). Never re-arms after a normal turn.
      if (signal.aborted) {
        mode = 'interrupted';
        spoke = false;
        try {
          interruptSpeaking();
        } catch {
          /* never-throws */
        }
      }
      if (signal.aborted) {
        turnCoordinator.transition(avatarTurnId, 'interrupted', {
          suppressionReason: 'barge-in',
          totalMs: Date.now() - startedAt,
        });
        emitAvatarEvent({
          type: 'avatar.speech.interrupted',
          turnId: avatarTurnId,
          reason: 'barge_in',
        });
      } else if (mode === 'failed') {
        turnCoordinator.transition(avatarTurnId, 'failed', {
          errorCategory: 'unknown',
          totalMs: Date.now() - startedAt,
        });
        emitAvatarEvent({
          type: 'avatar.speech.failed',
          turnId: avatarTurnId,
          reason: 'unknown',
        });
      } else if (spoke) {
        turnCoordinator.transition(avatarTurnId, 'completed', {
          spoke: true,
          ...(firstAudioMs !== undefined ? { firstAudioMs } : {}),
          totalMs: Date.now() - startedAt,
        });
        emitAvatarEvent({
          type: 'avatar.speech.completed',
          turnId: avatarTurnId,
          text: avatarFinalText,
          durationMs: avatarSpeechStartedAt === undefined
            ? 0
            : Date.now() - avatarSpeechStartedAt,
        });
      } else {
        turnCoordinator.transition(avatarTurnId, 'suppressed', {
          suppressionReason: 'silent-reply',
          spoke: false,
          totalMs: Date.now() - startedAt,
        });
        emitAvatarEvent({ type: 'avatar.turn.silent', turnId: avatarTurnId });
      }
      const spokenPrefixOutcome = spokenPrefixCauses.at(-1);
      const hasContinuationTiming =
        continuationPromptReadyMs !== undefined ||
        continuationProviderFirstDeltaMs !== undefined ||
        continuationGenerationCompleteMs !== undefined ||
        continuationSemanticReviewCompleteMs !== undefined;
      const timing: VoiceReplyTiming = {
        mode,
        totalMs: Date.now() - startedAt,
        spoke,
        delivery,
        ...(promptReadyMs !== undefined ? { promptReadyMs } : {}),
        ...(providerFirstDeltaMs !== undefined ? { providerFirstDeltaMs } : {}),
        ...(generationCompleteMs !== undefined ? { generationCompleteMs } : {}),
        ...(semanticReviewCompleteMs !== undefined ? { semanticReviewCompleteMs } : {}),
        ...(spokenPrefixOutcome
          ? {
              spokenPrefix: {
                outcome: spokenPrefixOutcome,
                causes: [...spokenPrefixCauses],
                ...(prefixPromptReadyMs !== undefined
                  ? { promptReadyMs: prefixPromptReadyMs }
                  : {}),
                ...(prefixProviderFirstDeltaMs !== undefined
                  ? { providerFirstDeltaMs: prefixProviderFirstDeltaMs }
                  : {}),
                ...(prefixGenerationCompleteMs !== undefined
                  ? { generationCompleteMs: prefixGenerationCompleteMs }
                  : {}),
                ...(prefixSemanticReviewCompleteMs !== undefined
                  ? { semanticReviewCompleteMs: prefixSemanticReviewCompleteMs }
                  : {}),
              },
            }
          : {}),
        ...(hasContinuationTiming
          ? {
              continuation: {
                ...(continuationPromptReadyMs !== undefined
                  ? { promptReadyMs: continuationPromptReadyMs }
                  : {}),
                ...(continuationProviderFirstDeltaMs !== undefined
                  ? { providerFirstDeltaMs: continuationProviderFirstDeltaMs }
                  : {}),
                ...(continuationGenerationCompleteMs !== undefined
                  ? { generationCompleteMs: continuationGenerationCompleteMs }
                  : {}),
                ...(continuationSemanticReviewCompleteMs !== undefined
                  ? { semanticReviewCompleteMs: continuationSemanticReviewCompleteMs }
                  : {}),
              },
            }
          : {}),
        ...(firstSafeReleaseMs !== undefined ? { firstSafeReleaseMs } : {}),
        ...(firstTextMs !== undefined ? { firstTextMs } : {}),
        ...(firstSegmentMs !== undefined ? { firstSegmentMs } : {}),
        ...(firstAudioMs !== undefined ? { firstAudioMs } : {}),
        ...(firstContentAudioMs !== undefined ? { firstContentAudioMs } : {}),
        ...(streamFallbackSegments > 0 ? { streamFallbackSegments } : {}),
        ...(mode === 'blocking' ? { replyMs, synthMs, playMs } : {}),
      };
      (handler as VoiceReplyHandler).lastTiming = timing;
      if (
        promptReadyMs !== undefined ||
        providerFirstDeltaMs !== undefined ||
        generationCompleteMs !== undefined ||
        semanticReviewCompleteMs !== undefined ||
        firstSafeReleaseMs !== undefined
      ) {
        logger.info(
          `[voice] phase latency: prompt=${promptReadyMs ?? -1}ms ` +
            `providerDelta=${providerFirstDeltaMs ?? -1}ms ` +
            `generation=${generationCompleteMs ?? -1}ms ` +
            `semantic=${semanticReviewCompleteMs ?? -1}ms ` +
            `safeRelease=${firstSafeReleaseMs ?? -1}ms ` +
            `contentAudio=${firstContentAudioMs ?? -1}ms`
        );
      }
      if (timing.spokenPrefix) {
        logger.info(
          `[voice] spoken-prefix pilot outcome=${timing.spokenPrefix.outcome} ` +
            `causes=${timing.spokenPrefix.causes.join(',')} ` +
            `prompt=${timing.spokenPrefix.promptReadyMs ?? -1}ms ` +
            `generation=${timing.spokenPrefix.generationCompleteMs ?? -1}ms ` +
            `semantic=${timing.spokenPrefix.semanticReviewCompleteMs ?? -1}ms ` +
            `continuationPrompt=${timing.continuation?.promptReadyMs ?? -1}ms ` +
            `continuationGeneration=${timing.continuation?.generationCompleteMs ?? -1}ms`,
        );
      }
      try {
        options.onTiming?.(timing);
      } catch {
        /* observability must never break the voice loop */
      }
      if (activeAborts.get(voiceTurnId) === controller) activeAborts.delete(voiceTurnId);
      if (latestTurnId === voiceTurnId) latestTurnId = [...activeAborts.keys()].at(-1);
    }
  };

  (handler as VoiceReplyHandler).interrupt = (turnId?: string): void => {
    const controller = turnId
      ? activeAborts.get(turnId)
      : latestTurnId
        ? activeAborts.get(latestTurnId)
        : undefined;
    if (!controller) return; // nothing in flight → clean no-op
    try {
      controller.abort();
    } catch {
      /* never-throws */
    }
  };

  return handler as VoiceReplyHandler;
}
