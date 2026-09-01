import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveSpeechRecognitionEngine,
  resolveSpeechTranscriptionPlan,
  resolveParakeetModelDir,
  engineUsesParakeetModel,
  expandSpeechPath,
} from '../../src/sensory/speech-engine-config.js';
import { homedir } from 'os';
import { join } from 'path';

const ENGINE = 'CODEBUDDY_SPEECH_ENGINE';
const prev = process.env[ENGINE];
afterEach(() => {
  if (prev === undefined) delete process.env[ENGINE];
  else process.env[ENGINE] = prev;
  delete process.env.CODEBUDDY_PARAKEET_MODEL_DIR;
  delete process.env.CODEBUDDY_SHERPA_ONNX_MODEL_DIR;
});

describe('speech-engine-config — single source of truth (no more companion/speech-reaction drift)', () => {
  it('resolves the in-process Rust engine and its aliases', () => {
    for (const v of ['sherpa-rs', 'sherpa-rust', 'rust', 'SHERPA-RS']) {
      process.env[ENGINE] = v;
      expect(resolveSpeechRecognitionEngine()).toBe('sherpa-rs');
    }
  });

  it('maps parakeet/sherpa-onnx, whisper, auto, and defaults', () => {
    process.env[ENGINE] = 'sherpa-onnx';
    expect(resolveSpeechRecognitionEngine()).toBe('parakeet');
    process.env[ENGINE] = 'whisper';
    expect(resolveSpeechRecognitionEngine()).toBe('faster-whisper');
    process.env[ENGINE] = 'auto';
    expect(resolveSpeechRecognitionEngine()).toBe('auto');
    delete process.env[ENGINE];
    expect(resolveSpeechRecognitionEngine()).toBe('faster-whisper');
    process.env[ENGINE] = 'nonsense';
    expect(resolveSpeechRecognitionEngine()).toBe('faster-whisper');
  });

  it('knows which engines decode with the Parakeet model (incl. sherpa-rs)', () => {
    expect(engineUsesParakeetModel('parakeet')).toBe(true);
    expect(engineUsesParakeetModel('sherpa-rs')).toBe(true);
    expect(engineUsesParakeetModel('auto')).toBe(true);
    expect(engineUsesParakeetModel('faster-whisper')).toBe(false);
  });

  it('selects faster-whisper when Parakeet cannot honour the requested language', () => {
    expect(resolveSpeechTranscriptionPlan('parakeet', {
      CODEBUDDY_SPEECH_LANG: 'fr',
      CODEBUDDY_SPEECH_FALLBACK: 'true',
    })).toEqual({
      requestedEngine: 'parakeet',
      effectiveEngine: 'faster-whisper',
      language: 'fr',
      languagePinned: true,
      fallbackEnabled: true,
      fallbackReason: 'parakeet-language-pin-unsupported',
    });
    expect(resolveSpeechTranscriptionPlan('parakeet', {
      CODEBUDDY_SPEECH_FALLBACK: 'true',
    }).effectiveEngine).toBe('parakeet');
    expect(resolveSpeechTranscriptionPlan('parakeet', {
      CODEBUDDY_SPEECH_LANG: 'fr',
      CODEBUDDY_SPEECH_FALLBACK: 'false',
    })).toMatchObject({
      effectiveEngine: 'parakeet',
      fallbackEnabled: false,
      blockingReason: 'parakeet-language-pin-unsupported-and-fallback-disabled',
    });
  });

  it('resolves + expands the parakeet model dir', () => {
    expect(resolveParakeetModelDir()).toBe(join(homedir(), '.codebuddy/asr/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8'));
    process.env.CODEBUDDY_PARAKEET_MODEL_DIR = '~/custom/model';
    expect(resolveParakeetModelDir()).toBe(join(homedir(), 'custom/model'));
    expect(expandSpeechPath('/abs/path')).toBe('/abs/path');
    expect(expandSpeechPath('~')).toBe(homedir());
  });
});
