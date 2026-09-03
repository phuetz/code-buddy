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

function languageIsPinned(env: NodeJS.ProcessEnv): boolean {
  const configured = env.CODEBUDDY_SPEECH_LANG?.trim().toLowerCase()
    || env.CODEBUDDY_COMPANION_LANGUAGE?.trim().toLowerCase();
  return Boolean(configured && !['auto', 'detect', 'automatic'].includes(configured));
}

/**
 * Resolve the decoder that can actually honour an explicit language pin.
 * Parakeet-TDT v3 is multilingual and auto-detects language, but the sherpa-rs
 * transducer API has no per-request language field. When the operator explicitly
 * pins a language and fallback is allowed, faster-whisper owns that turn.
 */
export function resolveSpeechTranscriptionPlan(
  requestedEngine = resolveSpeechRecognitionEngine(),
  env: NodeJS.ProcessEnv = process.env,
): SpeechTranscriptionPlan {
  const language = resolveSpeechLanguage(env);
  const languagePinned = languageIsPinned(env);
  const fallbackEnabled = env.CODEBUDDY_SPEECH_FALLBACK?.trim().toLowerCase() !== 'false';
  if (engineUsesParakeetModel(requestedEngine) && languagePinned) {
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
 * `parakeet` and `sherpa-rs` engines). Override via `CODEBUDDY_PARAKEET_MODEL_DIR`
 * or `CODEBUDDY_SHERPA_ONNX_MODEL_DIR`; the buddy-sense side uses the same
 * `BUDDY_SENSE_STT_MODEL_DIR` variable.
 */
export function resolveParakeetModelDir(): string {
  return expandSpeechPath(
    process.env.BUDDY_SENSE_STT_MODEL_DIR?.trim()
      || process.env.CODEBUDDY_PARAKEET_MODEL_DIR?.trim()
      || process.env.CODEBUDDY_SHERPA_ONNX_MODEL_DIR?.trim()
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

/** True when the configured/resolved engine decodes with the Parakeet model. */
export function engineUsesParakeetModel(engine: SpeechRecognitionEngine): boolean {
  return engine === 'parakeet' || engine === 'sherpa-rs' || engine === 'auto';
}
