/**
 * Speech-engine configuration resolvers — the single source of truth for the
 * `CODEBUDDY_SPEECH_*` environment knobs.
 *
 * Both the STT hot path (`speech-reaction.ts`) and the companion control plane
 * (`companion-mode.ts`'s `buddy companion live` preflight) need to know which STT
 * engine is configured and where the Parakeet/sherpa-onnx model lives. They used
 * to keep separate copies, which drifted: companion-mode's copy never learned the
 * in-process `sherpa-rs` engine and silently reported it as `faster-whisper`.
 * Keeping the resolution here means the two can no longer disagree.
 *
 * @module sensory/speech-engine-config
 */

import { existsSync } from 'fs';
import { homedir } from 'os';
import { basename, join } from 'path';

export type SpeechRecognitionEngine = 'faster-whisper' | 'parakeet' | 'sherpa-rs' | 'auto';

export interface SpeechTranscriptionPlan {
  requestedEngine: SpeechRecognitionEngine;
  effectiveEngine: SpeechRecognitionEngine;
  language: string;
  languagePinned: boolean;
  fallbackEnabled: boolean;
  fallbackReason?: 'parakeet-language-pin-unsupported';
  blockingReason?: 'parakeet-language-pin-unsupported-and-fallback-disabled';
}

/** Expand a leading `~` / `~/` to the home directory (leaves other paths as-is). */
export function expandSpeechPath(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

/**
 * Resolve the configured STT engine from `CODEBUDDY_SPEECH_ENGINE`. Aliases:
 * `sherpa-rust`/`rust` → `sherpa-rs`; `sherpa-onnx` → `parakeet`; `whisper` →
 * `faster-whisper`. Anything unset/unknown defaults to `faster-whisper`.
 */
export function resolveSpeechRecognitionEngine(): SpeechRecognitionEngine {
  const configured = process.env.CODEBUDDY_SPEECH_ENGINE?.trim().toLowerCase();
  if (configured === 'sherpa-rs' || configured === 'sherpa-rust' || configured === 'rust') return 'sherpa-rs';
  if (configured === 'parakeet' || configured === 'sherpa-onnx') return 'parakeet';
  if (configured === 'faster-whisper' || configured === 'whisper') return 'faster-whisper';
  if (configured === 'auto') return 'auto';
  return 'faster-whisper';
}

export function resolveSpeechLanguage(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.CODEBUDDY_SPEECH_LANG?.trim()
    || env.CODEBUDDY_COMPANION_LANGUAGE?.trim()
    || 'fr'
  );
}

/**
 * Languages Parakeet-TDT 0.6B v3 decodes natively (NVIDIA model card, 25 languages). A pin
 * inside this set is honoured by the multilingual model itself — measured on the robot
 * (CONV4, 2026-09-03): five French fixtures transcribed exactly, 179 ms median versus
 * 1 216 ms for faster-whisper `small`. Only a pin OUTSIDE this set needs the fallback.
 */
export const PARAKEET_TDT_V3_LANGUAGES: ReadonlySet<string> = new Set([
  'bg', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'de', 'el', 'hu', 'it', 'lv', 'lt',
  'mt', 'pl', 'pt', 'ro', 'sk', 'sl', 'es', 'sv', 'ru', 'uk',
]);

export function parakeetSupportsLanguage(language: string): boolean {
  const base = language.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return PARAKEET_TDT_V3_LANGUAGES.has(base);
}

function languageIsPinned(env: NodeJS.ProcessEnv): boolean {
  const configured = env.CODEBUDDY_SPEECH_LANG?.trim().toLowerCase()
    || env.CODEBUDDY_COMPANION_LANGUAGE?.trim().toLowerCase();
  return Boolean(configured && !['auto', 'detect', 'automatic'].includes(configured));
}

/**
 * Resolve the decoder that can actually honour an explicit language pin.
 * Parakeet-TDT v3 is multilingual and auto-detects language, but the sherpa-rs
 * transducer API has no per-request language field. A pin the multilingual model covers
 * (see PARAKEET_TDT_V3_LANGUAGES) stays on Parakeet; when the operator pins a language
 * outside that set and fallback is allowed, faster-whisper owns that turn.
 */
export function resolveSpeechTranscriptionPlan(
  requestedEngine = resolveSpeechRecognitionEngine(),
  env: NodeJS.ProcessEnv = process.env,
): SpeechTranscriptionPlan {
  const language = resolveSpeechLanguage(env);
  const languagePinned = languageIsPinned(env);
  const fallbackEnabled = env.CODEBUDDY_SPEECH_FALLBACK?.trim().toLowerCase() !== 'false';
  if (engineUsesParakeetModel(requestedEngine) && languagePinned && !parakeetSupportsLanguage(language)) {
    if (fallbackEnabled) {
      return {
        requestedEngine,
        effectiveEngine: 'faster-whisper',
        language,
        languagePinned,
        fallbackEnabled,
        fallbackReason: 'parakeet-language-pin-unsupported',
      };
    }
    return {
      requestedEngine,
      effectiveEngine: requestedEngine,
      language,
      languagePinned,
      fallbackEnabled,
      blockingReason: 'parakeet-language-pin-unsupported-and-fallback-disabled',
    };
  }
  return {
    requestedEngine,
    effectiveEngine: requestedEngine,
    language,
    languagePinned,
    fallbackEnabled,
  };
}

/**
 * Location of the NeMo Parakeet / sherpa-onnx model directory (shared by the
 * `parakeet` and `sherpa-rs` engines). The buddy-sense names take precedence,
 * matching the Rust worker, while the historical Code Buddy aliases remain
 * supported.
 */
export function resolveParakeetModelDir(env: NodeJS.ProcessEnv = process.env): string {
  return expandSpeechPath(
    env.BUDDY_SENSE_STT_MODEL_DIR?.trim()
      || env.CODEBUDDY_PARAKEET_MODEL_DIR?.trim()
      || env.CODEBUDDY_SHERPA_ONNX_MODEL_DIR?.trim()
      || '~/.codebuddy/asr/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
  );
}

const PARAKEET_MODEL_FILES = [
  'encoder.int8.onnx',
  'decoder.int8.onnx',
  'joiner.int8.onnx',
  'tokens.txt',
] as const;

/** A directory existing on disk is not enough to make a decoder usable. */
export function isParakeetModelComplete(modelDir = resolveParakeetModelDir()): boolean {
  return PARAKEET_MODEL_FILES.every((file) => existsSync(join(modelDir, file)));
}

/**
 * The generic auto route is allowed to select sherpa-rs only for a model whose
 * French support is locally evidenced. The shipped Parakeet-TDT v3 int8 model
 * is a known multilingual French model; custom model directories may carry the
 * same evidence as the installed model's `test_wavs/fr.wav` witness.
 */
export function isFrenchParakeetModelAvailable(modelDir = resolveParakeetModelDir()): boolean {
  if (!isParakeetModelComplete(modelDir)) return false;
  const modelName = basename(modelDir).toLowerCase();
  return modelName.includes('parakeet-tdt-0.6b-v3')
    || existsSync(join(modelDir, 'test_wavs', 'fr.wav'));
}

/** Resolve the positive decoder thread count passed to the buddy-sense worker. */
export function resolveSpeechSttThreads(env: NodeJS.ProcessEnv = process.env): number {
  for (const name of [
    'BUDDY_SENSE_STT_THREADS',
    'CODEBUDDY_SPEECH_STT_THREADS',
    'CODEBUDDY_SPEECH_THREADS',
  ]) {
    const value = Number(env[name]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 4;
}

/** True when the configured/resolved engine decodes with the Parakeet model. */
export function engineUsesParakeetModel(engine: SpeechRecognitionEngine): boolean {
  return engine === 'parakeet' || engine === 'sherpa-rs' || engine === 'auto';
}
