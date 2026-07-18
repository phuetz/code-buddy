/**
 * Voice assistant configuration core.
 *
 * The assistant daemon and Telegram companion both read plain `.env` files
 * through systemd. This module keeps edits conservative: only known assistant
 * keys are written, unrelated lines stay untouched, and all I/O is best-effort.
 *
 * @module companion/assistant-config
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { PRESET_VOICES } from '../talk-mode/providers/pocket-tts.js';
import { synthesizePocketWav } from '../voice/local-tts.js';
import { resolveSensoryResponsePolicy } from '../sensory/respond-decider.js';
import { DEFAULT_MARKET_SYMBOLS, DEFAULT_NEWS_QUERY } from './prefetch-config.js';
import {
  readVoiceRuntimeSnapshot,
  type VoiceTurnRuntimeSnapshot,
} from '../sensory/voice-turn-coordinator.js';

export type AssistantSettingGroup = 'voice' | 'speech' | 'behavior' | 'companion';
export type AssistantSettingType = 'toggle' | 'enum' | 'text' | 'voice' | 'volume';
export type AssistantEnvFile = 'vision' | 'lisa' | 'both';
export type AssistantEnvFileName = 'vision' | 'lisa';

export interface AssistantSetting {
  key: string;
  label: string;
  group: AssistantSettingGroup;
  type: AssistantSettingType;
  options?: string[];
  default: string;
  envFile: AssistantEnvFile;
  help: string;
}

export interface AssistantEnvPaths {
  vision?: string;
  lisa?: string;
}

export interface AssistantServiceRestartResult {
  service: string;
  ok: boolean;
  error?: string;
}

export interface AssistantVoicePreviewPlaybackResult {
  path: string;
  played: boolean;
}

/** Raw-free live state consumed by Cowork's voice dashboard. */
export function readAssistantVoiceDiagnostics(): VoiceTurnRuntimeSnapshot | null {
  return readVoiceRuntimeSnapshot();
}

const MANAGED_MARKER = '# --- assistant config (managed) ---';
const execFileAsync = promisify(execFile);

export const ASSISTANT_SETTINGS: AssistantSetting[] = [
  {
    key: 'CODEBUDDY_TTS_ENGINE',
    label: 'TTS engine',
    group: 'voice',
    type: 'enum',
    options: ['pocket', 'voicebox', 'piper'],
    default: 'pocket',
    envFile: 'both',
    help: 'Pocket is realtime; Voicebox is expressive and GPU-ready; Piper is the final fallback.',
  },
  {
    key: 'CODEBUDDY_POCKET_VOICE',
    label: 'Pocket voice',
    group: 'voice',
    type: 'voice',
    default: 'estelle',
    envFile: 'both',
    help: 'Pocket TTS preset name or path to a short clone sample.',
  },
  {
    key: 'CODEBUDDY_POCKET_LANG',
    label: 'Pocket language',
    group: 'voice',
    type: 'text',
    default: 'french',
    envFile: 'both',
    help: 'Language token used by Pocket TTS.',
  },
  {
    key: 'CODEBUDDY_POCKET_SERVER',
    label: 'Persistent Pocket server',
    group: 'voice',
    type: 'toggle',
    default: 'true',
    envFile: 'both',
    help: 'Keeps the Pocket model resident so uncached phrases do not reload it.',
  },
  {
    key: 'CODEBUDDY_POCKET_URL',
    label: 'Pocket server URL',
    group: 'voice',
    type: 'text',
    default: 'http://127.0.0.1:8766',
    envFile: 'both',
    help: 'Loopback FastAPI endpoint used by the resident Pocket model.',
  },
  {
    key: 'CODEBUDDY_POCKET_QUANTIZE',
    label: 'Quantize Pocket TTS',
    group: 'voice',
    type: 'toggle',
    default: 'false',
    envFile: 'both',
    help: 'Uses Pocket int8 inference to reduce CPU latency and memory with unchanged WER.',
  },
  {
    key: 'CODEBUDDY_POCKET_AUDIO_STREAM',
    label: 'Stream Pocket audio',
    group: 'voice',
    type: 'toggle',
    default: 'true',
    envFile: 'both',
    help: 'Plays Pocket WAV chunks as they arrive instead of waiting for the full clip.',
  },
  {
    key: 'CODEBUDDY_VOICEBOX_URL',
    label: 'Voicebox URL',
    group: 'voice',
    type: 'text',
    default: 'http://127.0.0.1:17493',
    envFile: 'both',
    help: 'Voicebox REST endpoint. On Darkstar, expose it only through the trusted Tailscale network.',
  },
  {
    key: 'CODEBUDDY_VOICEBOX_PROFILE',
    label: 'Voicebox profile',
    group: 'voice',
    type: 'text',
    default: '',
    envFile: 'both',
    help: 'Voicebox voice profile name or id. Required when the Voicebox engine is selected.',
  },
  {
    key: 'CODEBUDDY_VOICEBOX_ENGINE',
    label: 'Voicebox renderer',
    group: 'voice',
    type: 'enum',
    options: [
      'qwen',
      'qwen_custom_voice',
      'luxtts',
      'chatterbox',
      'chatterbox_turbo',
      'tada',
      'kokoro',
    ],
    default: 'qwen',
    envFile: 'both',
    help: 'Voicebox synthesis backend. Qwen is the recommended multilingual starting point.',
  },
  {
    key: 'CODEBUDDY_VOICEBOX_LANGUAGE',
    label: 'Voicebox language',
    group: 'voice',
    type: 'enum',
    options: [
      'fr', 'en', 'zh', 'ja', 'ko', 'de', 'ru', 'pt', 'es', 'it', 'he', 'ar',
      'da', 'el', 'fi', 'hi', 'ms', 'nl', 'no', 'pl', 'sv', 'sw', 'tr',
    ],
    default: 'fr',
    envFile: 'both',
    help: 'Voicebox language code used for Lisa speech.',
  },
  {
    key: 'CODEBUDDY_VOICEBOX_MODEL_SIZE',
    label: 'Voicebox model size',
    group: 'voice',
    type: 'enum',
    options: ['0.6B', '1.7B', '1B', '3B'],
    default: '1.7B',
    envFile: 'both',
    help: 'Renderer size. 1.7B favors quality on Darkstar; 0.6B is the lower-latency option.',
  },
  {
    key: 'CODEBUDDY_VOICEBOX_INSTRUCT',
    label: 'Voicebox delivery instruction',
    group: 'voice',
    type: 'text',
    // Acoustic only — never rewrite words. Lisa default: warm intimate FR companion.
    default:
      'Speak as Lisa: warm intimate French girlfriend energy, soft smile in the voice, ' +
      'natural mid tempo, slight breathiness, never rewrite or invent words — delivery only.',
    envFile: 'both',
    help:
      'Acoustic delivery only (tone, pace, warmth), capped at 500 characters. ' +
      'Does not rewrite Lisa’s words (personality stays false on Voicebox).',
  },
  {
    key: 'CODEBUDDY_VOICEBOX_AUDIO_STREAM',
    label: 'Stream Voicebox audio',
    group: 'voice',
    type: 'toggle',
    default: 'true',
    envFile: 'both',
    help: 'Pipes Voicebox WAV output directly to speakers and the avatar as soon as it arrives.',
  },
  {
    key: 'CODEBUDDY_TTS_VOLUME',
    label: 'Assistant output volume',
    group: 'voice',
    type: 'volume',
    default: '100',
    envFile: 'both',
    help: 'Assistant-only loudness (0–100). At 100, local speech is safely normalized to -1 dBFS.',
  },
  {
    key: 'CODEBUDDY_TTS_VOICE',
    label: 'Piper fallback voice',
    group: 'voice',
    type: 'text',
    default: '',
    envFile: 'both',
    help: 'Fallback Piper .onnx voice model path.',
  },
  {
    key: 'CODEBUDDY_SENSORY_SPEAK',
    label: 'Speak responses',
    group: 'speech',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Enables spoken assistant responses on the vision daemon.',
  },
  {
    key: 'CODEBUDDY_SENSORY_SPEAK_ACT',
    label: 'Speak actions',
    group: 'speech',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Allows the assistant to speak action feedback.',
  },
  {
    key: 'CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE',
    label: 'Speech permission mode',
    group: 'speech',
    type: 'enum',
    options: ['default', 'dontAsk', 'bypassPermissions'],
    default: 'default',
    envFile: 'vision',
    help: 'Guarded per-turn posture used by spoken actions. Code planning stays scoped to its own session.',
  },
  {
    key: 'CODEBUDDY_SENSORY_SPEAK_MODEL',
    label: 'Speech model',
    group: 'speech',
    type: 'text',
    default: 'auto',
    envFile: 'vision',
    help: 'Model used for spoken assistant replies.',
  },
  {
    key: 'CODEBUDDY_SENSORY_SPEAK_BASE_URL',
    label: 'Speech model endpoint',
    group: 'speech',
    type: 'text',
    default: 'http://127.0.0.1:11434/v1',
    envFile: 'vision',
    help: 'OpenAI-compatible endpoint used by the low-latency speech model.',
  },
  {
    key: 'CODEBUDDY_SENSORY_SPEAK_FACT_MODEL',
    label: 'Factual speech model',
    group: 'speech',
    type: 'text',
    default: '',
    envFile: 'vision',
    help: 'Optional larger local model for static factual questions; ordinary conversation stays on the fast model.',
  },
  {
    key: 'CODEBUDDY_VOICE_MODEL_PREWARM',
    label: 'Prewarm voice model',
    group: 'speech',
    type: 'toggle',
    default: 'true',
    envFile: 'vision',
    help: 'Loads the selected local Ollama model before the first spoken turn.',
  },
  {
    key: 'CODEBUDDY_VOICE_MAX_TOKENS',
    label: 'Voice reply token cap',
    group: 'speech',
    type: 'text',
    default: '48',
    envFile: 'vision',
    help: 'Base token budget. Natural/developed styles raise it dynamically for substantive turns.',
  },
  {
    key: 'CODEBUDDY_VOICE_RESPONSE_STYLE',
    label: 'Conversation depth',
    group: 'speech',
    type: 'enum',
    options: ['natural', 'concise', 'developed'],
    default: 'natural',
    envFile: 'both',
    help: 'Natural adapts to the dialogue act; developed gives arguments more room; concise keeps the legacy cap.',
  },
  {
    key: 'CODEBUDDY_VOICE_TEMPERATURE',
    label: 'Voice model temperature',
    group: 'speech',
    type: 'text',
    default: '0.2',
    envFile: 'vision',
    help: 'Low temperature keeps short spoken facts stable and reduces hallucinations (0–1).',
  },
  {
    key: 'CODEBUDDY_VOICE_ROUTING_MODE',
    label: 'Voice routing mode',
    group: 'speech',
    type: 'enum',
    options: ['realtime', 'grounded'],
    default: 'realtime',
    envFile: 'vision',
    help: 'Realtime keeps ordinary questions on the fast model; grounded sends every question to the full agent.',
  },
  {
    key: 'CODEBUDDY_VOICE_BACKCHANNEL',
    label: 'Instant voice backchannel',
    group: 'speech',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Optional spoken filler while a slow answer starts. Off by default because the local realtime lane reaches useful speech faster.',
  },
  {
    key: 'CODEBUDDY_VOICE_SENTENCE_CAP',
    label: 'Streaming segment chars',
    group: 'speech',
    type: 'text',
    default: '96',
    envFile: 'vision',
    help: 'Maximum text segment sent to streaming TTS before a soft cut (32–240); 96 preserves natural French clauses.',
  },
  {
    key: 'CODEBUDDY_VOICE_MODEL_KEEP_ALIVE',
    label: 'Voice model keep-alive',
    group: 'speech',
    type: 'text',
    default: '30m',
    envFile: 'vision',
    help: 'Ollama residency requested by voice prewarming.',
  },
  {
    key: 'CODEBUDDY_VOICE_MODEL_REFRESH_MS',
    label: 'Voice model refresh ms',
    group: 'speech',
    type: 'text',
    default: '900000',
    envFile: 'vision',
    help: 'How often the daemon refreshes local voice-model residency; zero disables refresh.',
  },
  {
    key: 'CODEBUDDY_TTS_PREWARM',
    label: 'Prewarm common phrases',
    group: 'speech',
    type: 'toggle',
    default: 'true',
    envFile: 'vision',
    help: 'Synthesizes the most common assistant phrases in the background at startup.',
  },
  {
    key: 'CODEBUDDY_TTS_PREWARM_LIMIT',
    label: 'TTS prewarm phrase count',
    group: 'speech',
    type: 'text',
    default: '16',
    envFile: 'vision',
    help: 'Maximum common phrases warmed at startup (capped at 64).',
  },
  {
    key: 'CODEBUDDY_SENSORY_SPEECH',
    label: 'Listen for speech',
    group: 'behavior',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Enables speech input in the sensory daemon.',
  },
  {
    key: 'CODEBUDDY_ROBOT_NAME',
    label: 'Assistant name',
    group: 'behavior',
    type: 'text',
    default: 'Lisa',
    envFile: 'both',
    help: 'Name the voice assistant uses for itself.',
  },
  {
    key: 'CODEBUDDY_USER_NAME',
    label: 'Your name',
    group: 'behavior',
    type: 'text',
    default: '',
    envFile: 'both',
    help: 'How the assistant addresses you (left empty falls back to a default).',
  },
  {
    key: 'CODEBUDDY_SENSORY_RESPONSE_POLICY',
    label: 'Response policy',
    group: 'behavior',
    type: 'enum',
    options: ['contextual', 'addressed', 'always'],
    default: 'contextual',
    envFile: 'vision',
    help: 'Contextual keeps natural follow-ups and optional judged chime-ins; addressed disables chime-ins; always is only for push-to-talk or testing.',
  },
  {
    key: 'CODEBUDDY_SENSORY_CHIME_IN',
    label: 'Chime in',
    group: 'behavior',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Allows opportunistic judged interjections when the response policy is contextual.',
  },
  {
    key: 'CODEBUDDY_SENSORY_ENGAGE_WINDOW_MS',
    label: 'Engage window ms',
    group: 'behavior',
    type: 'text',
    default: '120000',
    envFile: 'vision',
    help: 'Sliding attention window during which directed follow-ups stay engaged without repeating Lisa’s name.',
  },
  {
    key: 'CODEBUDDY_SENSORY_CONVERSATION_MODE',
    label: 'Conversation mode',
    group: 'behavior',
    type: 'toggle',
    default: 'true',
    envFile: 'vision',
    help: 'Keep a live dialogue going: extend the window on directed follow-ups (no need to re-say the name).',
  },
  {
    key: 'CODEBUDDY_SENSORY_CONVERSATION_MAX_MS',
    label: 'Conversation max ms',
    group: 'behavior',
    type: 'text',
    default: '600000',
    envFile: 'vision',
    help: 'Hard cap on a continuous dialogue before a re-address is required.',
  },
  {
    key: 'BUDDY_SENSE_AEC',
    label: 'Acoustic echo cancellation',
    group: 'speech',
    type: 'enum',
    options: ['auto', 'off'],
    default: 'auto',
    envFile: 'vision',
    help: 'Automatically selects a PipeWire/PulseAudio echo-cancel source when available and safely falls back to the microphone.',
  },
  {
    key: 'BUDDY_SENSE_AEC_SOURCE',
    label: 'AEC capture source',
    group: 'speech',
    type: 'text',
    default: '',
    envFile: 'vision',
    help: 'Optional explicit PulseAudio echo-cancel source; leave empty for automatic discovery.',
  },
  {
    key: 'CODEBUDDY_SPEECH_LANG',
    label: 'Speech language',
    group: 'behavior',
    type: 'text',
    default: 'fr',
    envFile: 'vision',
    help: 'Primary language code for speech recognition.',
  },
  {
    key: 'CODEBUDDY_SPEECH_DEBOUNCE_MS',
    label: 'Speech debounce ms',
    group: 'behavior',
    type: 'text',
    default: '800',
    envFile: 'vision',
    help: 'Deduplicates repeated speech events; lower values make follow-up turns feel faster.',
  },
  {
    key: 'CODEBUDDY_SENSORY_GREET',
    label: 'Greeting',
    group: 'companion',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Enables assistant greetings.',
  },
  {
    key: 'CODEBUDDY_ROBOT_NAME',
    label: 'Companion name',
    group: 'companion',
    type: 'text',
    default: 'Lisa',
    envFile: 'both',
    help: 'Default identity of this companion prototype; other companions can reuse the same runtime.',
  },
  {
    key: 'CODEBUDDY_REMINDERS',
    label: 'Reminders',
    group: 'companion',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Enables companion reminders.',
  },
  {
    key: 'CODEBUDDY_COMPANION_RELATIONAL',
    label: 'Relational memory',
    group: 'companion',
    type: 'toggle',
    default: 'false',
    envFile: 'both',
    help: 'Injects relational context into companion replies.',
  },
  {
    key: 'CODEBUDDY_COMPANION_INNER_LIFE',
    label: 'Inner life',
    group: 'companion',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Gives Lisa an interior: what she did while you were away (digital-authentic only) + a mood that drifts on its own. Surfaced via relational memory.',
  },
  {
    key: 'CODEBUDDY_INNER_LIFE_EVERY',
    label: 'Inner-life cadence (heartbeats)',
    group: 'companion',
    type: 'text',
    default: '50',
    envFile: 'vision',
    help: 'How many heartbeats between inner-life ticks (a new "what I did" vignette + mood drift).',
  },
  {
    key: 'CODEBUDDY_CONVERSATION_BRIDGE',
    label: 'Voice/channel continuity',
    group: 'companion',
    type: 'toggle',
    default: 'true',
    envFile: 'both',
    help: 'Shares one Lisa conversation between resident voice and the configured messaging channel.',
  },
  {
    key: 'CODEBUDDY_CONVERSATION_CHANNEL',
    label: 'Conversation channel',
    group: 'companion',
    type: 'enum',
    options: ['telegram', 'discord', 'slack', 'whatsapp', 'signal', 'matrix', 'teams', 'webchat'],
    default: 'telegram',
    envFile: 'both',
    help: 'Transport that receives voice transcripts and can continue the same conversation.',
  },
  {
    key: 'CODEBUDDY_CONVERSATION_CHANNEL_ID',
    label: 'Conversation channel ID',
    group: 'companion',
    type: 'text',
    default: '',
    envFile: 'both',
    help: 'Chat/room ID used for the shared conversation; Telegram falls back to the sensory alert chat.',
  },
  {
    key: 'CODEBUDDY_CONVERSATION_CHANNEL_THREAD',
    label: 'Channel topic/thread ID',
    group: 'companion',
    type: 'text',
    default: '',
    envFile: 'both',
    help: 'Optional Telegram topic or channel thread; empty shares the whole configured chat.',
  },
  {
    key: 'CODEBUDDY_CONVERSATION_THREAD_ID',
    label: 'Lisa conversation ID',
    group: 'companion',
    type: 'text',
    default: 'lisa',
    envFile: 'both',
    help: 'Stable logical thread name used for cross-channel history.',
  },
  {
    key: 'CODEBUDDY_CONVERSATION_MIRROR_VOICE',
    label: 'Mirror voice turns',
    group: 'companion',
    type: 'toggle',
    default: 'true',
    envFile: 'vision',
    help: 'Posts both the recognized speech and Lisa reply to the configured channel.',
  },
  {
    key: 'CODEBUDDY_CONVERSATION_COWORK',
    label: 'Cowork companion continuity',
    group: 'companion',
    type: 'toggle',
    default: 'true',
    envFile: 'both',
    help: 'Lets explicitly linked Cowork sessions continue the private Lisa thread.',
  },
  {
    key: 'CODEBUDDY_CONVERSATION_MIRROR_COWORK',
    label: 'Mirror Cowork turns',
    group: 'companion',
    type: 'toggle',
    default: 'true',
    envFile: 'both',
    help: 'Posts linked Cowork user and Lisa turns to the configured conversation channel.',
  },
  {
    key: 'CODEBUDDY_CONVERSATION_COWORK_HISTORY',
    label: 'Cowork shared history turns',
    group: 'companion',
    type: 'text',
    default: '24',
    envFile: 'both',
    help: 'Maximum recent cross-surface turns imported into a linked Cowork session (4-80).',
  },
  {
    key: 'CODEBUDDY_CONVERSATION_PERSIST',
    label: 'Persist shared history',
    group: 'companion',
    type: 'toggle',
    default: 'true',
    envFile: 'both',
    help: 'Keeps the bounded shared thread in a private local JSONL journal across restarts.',
  },
  {
    key: 'CODEBUDDY_CONVERSATION_MAX_HISTORY_BYTES',
    label: 'Shared journal byte limit',
    group: 'companion',
    type: 'text',
    default: '819200',
    envFile: 'both',
    help: 'Compacts the private cross-surface journal at this byte bound (32768-67108864).',
  },
  {
    key: 'CODEBUDDY_PREFETCH',
    label: 'Warm fresh context',
    group: 'companion',
    type: 'toggle',
    default: 'true',
    envFile: 'both',
    help: 'Preloads structured news, agenda, date and configured weather context for instant grounded replies.',
  },
  {
    key: 'CODEBUDDY_SEMANTIC_GATE',
    label: 'Deep-answer semantic review',
    group: 'companion',
    type: 'enum',
    options: ['auto', 'true', 'false'],
    default: 'auto',
    envFile: 'both',
    help: 'Audits developed answers and permits at most one independently re-audited revision before delivery.',
  },
  {
    key: 'CODEBUDDY_PREFETCH_INTERVAL_MS',
    label: 'Fresh-context interval ms',
    group: 'companion',
    type: 'text',
    default: '900000',
    envFile: 'vision',
    help: 'Wall-clock refresh interval for fresh context; defaults to fifteen minutes.',
  },
  {
    key: 'CODEBUDDY_MARKET_SYMBOLS',
    label: 'Additional market symbols',
    group: 'companion',
    type: 'text',
    default: '',
    envFile: 'both',
    help: `Comma-separated watchlist added to ${DEFAULT_MARKET_SYMBOLS.join(', ')} (maximum ten symbols total).`,
  },
  {
    key: 'CODEBUDDY_NEWS_QUERY',
    label: 'Preferred news topics',
    group: 'companion',
    type: 'text',
    default: DEFAULT_NEWS_QUERY,
    envFile: 'both',
    help: 'Query warmed in the background. Lisa can still search a different topic on demand.',
  },
  {
    key: 'CODEBUDDY_NEWS_LOCALE',
    label: 'News locale',
    group: 'companion',
    type: 'text',
    default: 'fr-FR',
    envFile: 'both',
    help: 'Language and country used for fresh news sources.',
  },
  {
    key: 'CODEBUDDY_COMPANION_RELATIONAL_BUDGET_MS',
    label: 'Relational cold budget ms',
    group: 'companion',
    type: 'text',
    default: '75',
    envFile: 'both',
    help: 'Maximum first-turn wait for relational memory; later turns use stale-while-revalidate.',
  },
  {
    key: 'CODEBUDDY_COMPANION_RELATIONAL_TTL_MS',
    label: 'Relational cache TTL ms',
    group: 'companion',
    type: 'text',
    default: '5000',
    envFile: 'both',
    help: 'Freshness window for the cached relationship, episode, guidance, and presence context.',
  },
  {
    key: 'CODEBUDDY_EPISODE_JOURNAL',
    label: 'Conversation episodes',
    group: 'companion',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Consolidates the complete cross-channel thread into a private where-we-were memory.',
  },
  {
    key: 'CODEBUDDY_EPISODE_EVERY',
    label: 'Episode consolidation beats',
    group: 'companion',
    type: 'text',
    default: '40',
    envFile: 'vision',
    help: 'Heartbeat interval for deduplicated conversation episode consolidation.',
  },
  {
    key: 'CODEBUDDY_COMPANION_PROACTIVE',
    label: 'Proactive companion',
    group: 'companion',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Allows proactive companion behaviors.',
  },
  {
    key: 'CODEBUDDY_VOICE_IMPROVE',
    label: 'Voice improvement',
    group: 'companion',
    type: 'toggle',
    default: 'false',
    envFile: 'vision',
    help: 'Enables the voice assistant improvement loop.',
  },
  {
    key: 'CODEBUDDY_CONVERSATION_EVAL',
    label: 'Conversation quality loop',
    group: 'companion',
    type: 'toggle',
    default: 'true',
    envFile: 'vision',
    help: 'Scores complete user/Lisa exchanges locally and learns only from recurring weaknesses.',
  },
  {
    key: 'CODEBUDDY_CONVERSATION_EVAL_EVERY',
    label: 'Quality evaluation beats',
    group: 'companion',
    type: 'text',
    default: '30',
    envFile: 'vision',
    help: 'Heartbeat interval between deterministic conversation-quality evaluations.',
  },
  {
    key: 'CODEBUDDY_CONVERSATION_EVAL_MIN_STREAK',
    label: 'Recurring issue threshold',
    group: 'companion',
    type: 'text',
    default: '2',
    envFile: 'vision',
    help: 'Number of consecutive evaluations that must confirm a weakness before Lisa adapts.',
  },
  {
    key: 'CODEBUDDY_CONVERSATION_EVAL_COOLDOWN_MS',
    label: 'Quality guidance cooldown ms',
    group: 'companion',
    type: 'text',
    default: '21600000',
    envFile: 'vision',
    help: 'Minimum delay between automatically learned conversation guidance lines.',
  },
  {
    key: 'CODEBUDDY_AVATAR_BRIDGE',
    label: 'Avatar performance bridge',
    group: 'companion',
    type: 'toggle',
    default: 'true',
    envFile: 'vision',
    help: 'Publishes scoped speech, affect, gesture and interruption events for Unreal/MetaHuman.',
  },
  {
    key: 'CODEBUDDY_AVATAR_STREAM_AUDIO',
    label: 'Stream avatar audio',
    group: 'companion',
    type: 'enum',
    options: ['auto', 'true', 'false'],
    default: 'auto',
    envFile: 'vision',
    help: 'Auto streams bounded WAV only while a compatible authenticated renderer is alive.',
  },
];

function hasOwn(obj: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function readTextFile(path: string): string {
  try {
    if (!existsSync(path)) return '';
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function writeTextFile(path: string, content: string): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function resolveEnvFilePath(which: AssistantEnvFileName, paths?: AssistantEnvPaths): string {
  return paths?.[which] ?? envFilePath(which);
}

function validateSettingValue(setting: AssistantSetting, value: string): boolean {
  if (setting.type === 'enum') return setting.options?.includes(value) ?? false;
  if (setting.type === 'volume') {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
  }
  return true;
}

function validUpdateEntries(updates: Record<string, string>): Array<[AssistantSetting, string]> {
  const entries: Array<[AssistantSetting, string]> = [];
  for (const setting of ASSISTANT_SETTINGS) {
    if (!hasOwn(updates, setting.key)) continue;
    const value = updates[setting.key] ?? '';
    if (!validateSettingValue(setting, value)) continue;
    entries.push([setting, value]);
  }
  return entries;
}

export function envFilePath(which: AssistantEnvFileName): string {
  return join(homedir(), '.codebuddy', `${which}.env`);
}

export function parseEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

export function mergeEnv(content: string, updates: Record<string, string>): string {
  const entries = Object.entries(updates).filter(([key]) => key.trim().length > 0);
  if (entries.length === 0) return content;

  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const hadTrailingNewline = /\r?\n$/.test(content);
  const lines = content.length === 0 ? [] : content.split(/\r?\n/);
  if (hadTrailingNewline) lines.pop();

  const pending = new Map(entries);
  let markerSeen = false;
  const merged = lines.map((line) => {
    if (line.trim() === MANAGED_MARKER) markerSeen = true;
    const match = line.match(/^(\s*([^=\s#]+)\s*=\s*)(.*)$/);
    const key = match?.[2];
    if (!match || !key || !pending.has(key)) return line;
    const value = pending.get(key) ?? '';
    pending.delete(key);
    return `${match[1] ?? ''}${value}`;
  });

  const willAppend = pending.size > 0;
  if (willAppend) {
    if (!markerSeen) {
      if (merged.length > 0 && merged[merged.length - 1]?.trim() !== '') merged.push('');
      merged.push(MANAGED_MARKER);
    }
    for (const [key, value] of pending) merged.push(`${key}=${value}`);
  }

  return `${merged.join(newline)}${hadTrailingNewline || willAppend ? newline : ''}`;
}

export function readAssistantConfig(paths?: AssistantEnvPaths): Record<string, string> {
  try {
    const vision = parseEnv(readTextFile(resolveEnvFilePath('vision', paths)));
    const lisa = parseEnv(readTextFile(resolveEnvFilePath('lisa', paths)));
    const config: Record<string, string> = {};

    for (const setting of ASSISTANT_SETTINGS) {
      if (setting.envFile === 'vision') {
        config[setting.key] = hasOwn(vision, setting.key)
          ? (vision[setting.key] ?? setting.default)
          : setting.default;
      } else if (setting.envFile === 'lisa') {
        config[setting.key] = hasOwn(lisa, setting.key)
          ? (lisa[setting.key] ?? setting.default)
          : setting.default;
      } else {
        config[setting.key] = hasOwn(vision, setting.key)
          ? (vision[setting.key] ?? setting.default)
          : hasOwn(lisa, setting.key)
            ? (lisa[setting.key] ?? setting.default)
            : setting.default;
      }

      // `plan` was the historical always-on assistant default. Surface the new
      // guarded resident posture immediately without mutating the user's env
      // file; runtime applies the same migration. Explicit `/plan` code sessions
      // are separate and remain untouched.
      if (
        setting.key === 'CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE' &&
        config[setting.key]?.toLowerCase() === 'plan'
      ) {
        config[setting.key] = 'default';
      }
    }

    // Surface the same non-mutating legacy/invalid-value migration used by the daemon.
    // Otherwise an old ALWAYS_RESPOND=true file would run unfiltered while the UI falsely
    // displayed the new contextual default.
    config.CODEBUDDY_SENSORY_RESPONSE_POLICY = resolveSensoryResponsePolicy({
      ...lisa,
      ...vision,
    }).policy;

    return config;
  } catch {
    return Object.fromEntries(ASSISTANT_SETTINGS.map((setting) => [setting.key, setting.default]));
  }
}

/**
 * Privileged daemon environment for main-process integrations.
 *
 * Unlike `readAssistantConfig`, this includes operational keys that are not
 * exposed by the schema (for example the Telegram bot token). Callers must
 * keep the returned object inside a trusted Node/Electron main process and
 * must never serialize it to a renderer or log it.
 */
export function readAssistantRuntimeEnv(paths?: AssistantEnvPaths): Record<string, string> {
  try {
    const lisa = parseEnv(readTextFile(resolveEnvFilePath('lisa', paths)));
    const vision = parseEnv(readTextFile(resolveEnvFilePath('vision', paths)));
    return { ...lisa, ...vision };
  } catch {
    return {};
  }
}

export function writeAssistantConfig(
  updates: Record<string, string>,
  paths?: AssistantEnvPaths
): { vision: string[]; lisa: string[] } {
  const result: { vision: string[]; lisa: string[] } = { vision: [], lisa: [] };

  try {
    const byFile: Record<AssistantEnvFileName, Record<string, string>> = { vision: {}, lisa: {} };
    for (const [setting, value] of validUpdateEntries(updates)) {
      if (setting.envFile === 'vision' || setting.envFile === 'both') {
        byFile.vision[setting.key] = value;
      }
      if (setting.envFile === 'lisa' || setting.envFile === 'both') {
        byFile.lisa[setting.key] = value;
      }
    }

    for (const which of ['vision', 'lisa'] as const) {
      const fileUpdates = byFile[which];
      const keys = Object.keys(fileUpdates);
      if (keys.length === 0) continue;
      const path = resolveEnvFilePath(which, paths);
      const next = mergeEnv(readTextFile(path), fileUpdates);
      if (writeTextFile(path, next)) result[which] = keys;
    }
  } catch {
    return result;
  }

  return result;
}

export function listPocketVoices(): string[] {
  return [...PRESET_VOICES];
}

/** Default sentence used to test a voice (kept in sync with the Cowork panel's pre-fill). */
export const DEFAULT_VOICE_PREVIEW_TEXT =
  'Bonjour ! Voici un aperçu de ma voix. Est-ce qu’elle te plaît ?';

/** Tiny stable string hash (djb2, base36) — for keying the preview cache on the text. Pure. */
function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Stable on-disk path for a voice's preview sample, keyed on BOTH the voice and
 * the (hashed) test text so a custom sentence gets its own cache entry while the
 * default sentence stays stable (prewarm-friendly). Pure/testable.
 */
export function voicePreviewCachePath(
  name: string,
  text: string = DEFAULT_VOICE_PREVIEW_TEXT
): string {
  const safeName = name.trim().replace(/[^a-z0-9._-]/gi, '-') || 'voice';
  const effective = text.trim() || DEFAULT_VOICE_PREVIEW_TEXT;
  return join(
    homedir(),
    '.codebuddy',
    'companion',
    'voice-previews',
    `${safeName}-${hashText(effective)}.wav`
  );
}

/**
 * Synthesize (or reuse) a short voice preview WAV, returning its path. Cached at
 * a stable path per (voice, text) so re-listening the same sentence is instant
 * (the resident Pocket server avoids paying model startup for every custom
 * sentence). `force` regenerates. Never throws.
 */
export async function previewVoice(
  name: string,
  text?: string,
  opts?: { force?: boolean }
): Promise<string | null> {
  try {
    const voiceName = name.trim();
    if (!voiceName) return null;
    const effectiveText = (text ?? '').trim() || DEFAULT_VOICE_PREVIEW_TEXT;
    const outPath = voicePreviewCachePath(voiceName, effectiveText);
    const assistantEnv = readAssistantConfig();

    // Cache hit: a non-empty WAV already exists for this voice+text → return instantly.
    if (!opts?.force) {
      try {
        if (existsSync(outPath) && statSync(outPath).size > 44) {
          // Migrate previews synthesized before assistant loudness normalization.
          const { normalizeWavFile } = await import('../voice/tts-volume.js');
          await normalizeWavFile(outPath, { ...process.env, ...assistantEnv });
          return outPath;
        }
      } catch {
        /* fall through to (re)synthesis */
      }
    }

    mkdirSync(dirname(outPath), { recursive: true });
    const generated = await synthesizePocketWav(
      effectiveText,
      outPath,
      {
        ...process.env,
        ...assistantEnv,
        CODEBUDDY_TTS_ENGINE: 'pocket',
        CODEBUDDY_POCKET_VOICE: voiceName,
        CODEBUDDY_POCKET_LANG: assistantEnv.CODEBUDDY_POCKET_LANG ?? 'french',
      },
      180_000
    );
    if (!generated) return null;
    return outPath;
  } catch {
    return null;
  }
}

/**
 * Generate (or reuse) a preview and play it through the platform audio player.
 * Playback happens in the Node/Electron main process so Chromium file URL and
 * autoplay policies cannot silently swallow the user's click.
 */
export async function playVoicePreview(
  name: string,
  text?: string
): Promise<AssistantVoicePreviewPlaybackResult | null> {
  const path = await previewVoice(name, text);
  if (!path) return null;

  const { tryPlayWavFile } = await import('../utils/audio-player.js');
  return { path, played: await tryPlayWavFile(path) };
}

export async function restartAssistantServices(
  which: Array<'buddy-vision-brain' | 'lisa-telegram'> = ['buddy-vision-brain']
): Promise<AssistantServiceRestartResult[]> {
  const results: AssistantServiceRestartResult[] = [];
  for (const service of which) {
    try {
      await execFileAsync('systemctl', ['--user', 'restart', `${service}.service`]);
      results.push({ service, ok: true });
    } catch (error) {
      results.push({
        service,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

// ============================================================================
// System output volume (live control — applies immediately, not an env var)
// ============================================================================

/** Extract the first "NN%" from `pactl`/`amixer` output → clamped 0..150. Pure. */
export function parseVolumePercent(output: string): number | null {
  const match = output.match(/(\d+)\s*%/);
  if (!match) return null;
  return Math.max(0, Math.min(150, Number(match[1])));
}

/** Read the current default-sink volume percent (pactl, falling back to amixer). null if unavailable. */
export async function getSystemVolume(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('pactl', ['get-sink-volume', '@DEFAULT_SINK@']);
    return parseVolumePercent(stdout);
  } catch {
    try {
      const { stdout } = await execFileAsync('amixer', ['sget', 'Master']);
      return parseVolumePercent(stdout);
    } catch {
      return null;
    }
  }
}

/** Set the default-sink volume (unmutes first). Clamped 0..150. never-throws. */
export async function setSystemVolume(percent: number): Promise<boolean> {
  const pct = Math.max(0, Math.min(150, Math.round(percent)));
  try {
    await execFileAsync('pactl', ['set-sink-mute', '@DEFAULT_SINK@', '0']);
    await execFileAsync('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${pct}%`]);
    return true;
  } catch {
    try {
      await execFileAsync('amixer', ['-q', 'sset', 'Master', 'unmute']);
      await execFileAsync('amixer', ['-q', 'sset', 'Master', `${pct}%`]);
      return true;
    } catch {
      return false;
    }
  }
}
