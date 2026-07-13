import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveSpeechRecognitionEngine,
  transcribeWav,
} from '../../src/sensory/speech-reaction.js';

const ENV_KEYS = [
  'CODEBUDDY_SPEECH_ENGINE',
  'CODEBUDDY_SPEECH_STT_BIN',
  'CODEBUDDY_SPEECH_STT_READY_TIMEOUT_MS',
  'CODEBUDDY_SPEECH_FALLBACK',
  'BUDDY_SENSE_STT_MODEL_DIR',
];
const saved: Record<string, string | undefined> = {};
function setEnv(values: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
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
});
