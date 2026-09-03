import { mkdtemp, rm } from 'fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveSpeechRecognitionEngine,
  transcribeWav,
  warnSpeechFallbackOnce,
  wireSpeechReaction,
} from '../../src/sensory/speech-reaction.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import { logger } from '../../src/utils/logger.js';

const ENV_KEYS = [
  'CODEBUDDY_SPEECH_ENGINE',
  'CODEBUDDY_SPEECH_STT_BIN',
  'CODEBUDDY_SPEECH_STT_READY_TIMEOUT_MS',
  'CODEBUDDY_SPEECH_FALLBACK',
  'CODEBUDDY_SPEECH_WORKER',
  'CODEBUDDY_SPEECH_MODEL',
  'CODEBUDDY_SPEECH_PYTHON',
  'CODEBUDDY_SPEECH_STT_THREADS',
  'CODEBUDDY_SPEECH_LANG',
  'CODEBUDDY_COMPANION_LANGUAGE',
  'CODEBUDDY_PARAKEET_MODEL_DIR',
  'CODEBUDDY_SHERPA_ONNX_MODEL_DIR',
  'BUDDY_SENSE_STT_MODEL_DIR',
];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
});
function setEnv(values: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('sherpa-rs STT engine selection', () => {
  it('logs the same language-pin fallback only once per process', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const plan = {
      requestedEngine: 'parakeet' as const,
      effectiveEngine: 'faster-whisper' as const,
      language: 'fr',
      languagePinned: true,
      fallbackEnabled: true,
      fallbackReason: 'parakeet-language-pin-unsupported',
    };
    try {
      warnSpeechFallbackOnce(plan, 'faster-whisper', 4);
      warnSpeechFallbackOnce(plan, 'faster-whisper', 4);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('parakeet-language-pin-unsupported');
    } finally {
      warn.mockRestore();
    }
  });

  it('maps the sherpa-rs aliases to the sherpa-rs engine', () => {
    for (const alias of ['sherpa-rs', 'sherpa-rust', 'rust', 'SHERPA-RS']) {
      setEnv({ CODEBUDDY_SPEECH_ENGINE: alias });
      expect(resolveSpeechRecognitionEngine()).toBe('sherpa-rs');
    }
  });

  it('leaves the other engines unchanged', () => {
    setEnv({ CODEBUDDY_SPEECH_ENGINE: 'parakeet' });
    expect(resolveSpeechRecognitionEngine()).toBe('parakeet');
    setEnv({ CODEBUDDY_SPEECH_ENGINE: 'faster-whisper' });
    expect(resolveSpeechRecognitionEngine()).toBe('faster-whisper');
    setEnv({ CODEBUDDY_SPEECH_ENGINE: undefined });
    expect(resolveSpeechRecognitionEngine()).toBe('faster-whisper');
  });
});

// Real end-to-end: spawn the actual `buddy-sense stt` binary and decode the model's
// bundled French sample through the full TS worker path (no mocks). Self-skips unless
// the binary (built with `--features stt`) and the model+sample are present, so the
// default CI run isn't hardware/build coupled.
describe('sherpa-rs STT end-to-end (real binary)', () => {
  const repoRoot = process.cwd();
  const bin = ['release', 'debug']
    .map((p) => path.join(repoRoot, 'buddy-sense', 'target', p, 'buddy-sense'))
    .find((p) => existsSync(p));
  const modelDir = path.join(os.homedir(), '.codebuddy/asr/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8');
  const frWav = path.join(modelDir, 'test_wavs/fr.wav');
  const runnable = Boolean(bin) && existsSync(frWav);
  const fixtureDir = path.join(repoRoot, 'tests/fixtures/stt-conv4');
  const fixtures = [
    'fr-reference.wav',
    'fr-quiet.wav',
    'fr-loud.wav',
    'fr-padded.wav',
    'fr-bandlimited.wav',
  ].map((name) => path.join(fixtureDir, name));
  const fixturesRunnable = runnable && fixtures.every((wav) => existsSync(wav));

  it.runIf(runnable)('decodes the French sample through the Rust worker', async () => {
    setEnv({
      CODEBUDDY_SPEECH_ENGINE: 'sherpa-rs',
      CODEBUDDY_SPEECH_STT_BIN: bin!,
      // Model initialization can be slower while the complete Vitest suite is
      // saturating the machine. Keep the production fail-fast default unchanged.
      CODEBUDDY_SPEECH_STT_READY_TIMEOUT_MS: '20000',
      CODEBUDDY_SPEECH_FALLBACK: 'false', // assert the Rust path itself, no python fallback
      BUDDY_SENSE_STT_MODEL_DIR: modelDir,
    });
    const text = await transcribeWav(frWav);
    expect(text.toLowerCase()).toContain('pays');
    expect(text.toLowerCase()).toContain('demand');
  }, 45_000);

  it.runIf(runnable)('auto-selects sherpa-rs when the binary and French model are present', async () => {
    setEnv({
      CODEBUDDY_SPEECH_ENGINE: 'auto',
      CODEBUDDY_SPEECH_STT_BIN: bin!,
      CODEBUDDY_SPEECH_STT_READY_TIMEOUT_MS: '20000',
      CODEBUDDY_SPEECH_FALLBACK: 'false',
      CODEBUDDY_SPEECH_WORKER: 'true',
      CODEBUDDY_SPEECH_STT_THREADS: '4',
      BUDDY_SENSE_STT_MODEL_DIR: modelDir,
    });
    const text = await transcribeWav(frWav, 'auto');
    expect(text.toLowerCase()).toContain('pays');
    expect(text.toLowerCase()).toContain('demand');
  }, 45_000);

  it.runIf(fixturesRunnable)('decodes five French fixtures through the persistent Rust worker', async () => {
    setEnv({
      CODEBUDDY_SPEECH_ENGINE: 'sherpa-rs',
      CODEBUDDY_SPEECH_STT_BIN: bin!,
      CODEBUDDY_SPEECH_STT_READY_TIMEOUT_MS: '20000',
      CODEBUDDY_SPEECH_FALLBACK: 'false',
      CODEBUDDY_SPEECH_WORKER: 'true',
      CODEBUDDY_SPEECH_STT_THREADS: '4',
      BUDDY_SENSE_STT_MODEL_DIR: modelDir,
    });
    for (const wav of fixtures) {
      const text = await transcribeWav(wav);
      expect(text.toLowerCase()).toContain('pays');
      expect(text.toLowerCase()).toContain('demandez');
    }
  }, 90_000);

  it.runIf(fixturesRunnable)('carries speech_end through the Rust worker to heard', async () => {
    setEnv({
      CODEBUDDY_SPEECH_ENGINE: 'sherpa-rs',
      CODEBUDDY_SPEECH_STT_BIN: bin!,
      CODEBUDDY_SPEECH_STT_READY_TIMEOUT_MS: '20000',
      CODEBUDDY_SPEECH_FALLBACK: 'false',
      CODEBUDDY_SPEECH_WORKER: 'true',
      CODEBUDDY_SPEECH_STT_THREADS: '4',
      BUDDY_SENSE_STT_MODEL_DIR: modelDir,
    });
    const runtime = await mkdtemp(path.join(repoRoot, '.conv4-e2e-'));
    let unwire = () => {};
    try {
      const heard = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('heard timeout')), 45_000);
        unwire = wireSpeechReaction({
          cwd: runtime,
          debounceMs: 0,
          onHeard: async (text) => {
            clearTimeout(timer);
            resolve(text);
          },
        });
        getGlobalEventBus().emit('sensory:perception', {
          source: 'conv4-fixture',
          metadata: {
            modality: 'audio',
            kind: 'speech_end',
            payload: { wav: fixtures[0] },
          },
        });
      });
      const text = await heard;
      expect(text.toLowerCase()).toContain('pays');
      expect(text.toLowerCase()).toContain('demandez');
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      unwire();
      await rm(runtime, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    }
  }, 60_000);
});
