import { beforeEach, describe, it, expect, afterEach } from 'vitest';
import {
  resolveSpeechRecognitionEngine,
  resolveSpeechTranscriptionPlan,
  resolveParakeetModelDir,
  resolveSpeechSttThreads,
  engineUsesParakeetModel,
  expandSpeechPath,
  isParakeetModelComplete,
  isFrenchParakeetModelAvailable,
} from '../../src/sensory/speech-engine-config.js';
import { homedir } from 'os';
import { join } from 'path';

const ENGINE = 'CODEBUDDY_SPEECH_ENGINE';
const MODEL_ENV_KEYS = [
  ENGINE,
  'CODEBUDDY_SPEECH_LANG',
  'CODEBUDDY_COMPANION_LANGUAGE',
  'CODEBUDDY_SPEECH_FALLBACK',
  'CODEBUDDY_PARAKEET_MODEL_DIR',
  'CODEBUDDY_SHERPA_ONNX_MODEL_DIR',
  'BUDDY_SENSE_STT_MODEL_DIR',
];
let previous: Record<string, string | undefined> = {};
beforeEach(() => {
  previous = Object.fromEntries(MODEL_ENV_KEYS.map((key) => [key, process.env[key]]));
});
afterEach(() => {
  for (const key of MODEL_ENV_KEYS) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete process.env.CODEBUDDY_PARAKEET_MODEL_DIR;
  delete process.env.CODEBUDDY_SHERPA_ONNX_MODEL_DIR;
  delete process.env.BUDDY_SENSE_STT_MODEL_DIR;
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
    // French is inside Parakeet-TDT v3's 25 languages: the pin is honoured by the model itself
    // (CONV4, 2026-09-03: 5/5 French fixtures exact at 179 ms). No fallback, no warning.
    expect(resolveSpeechTranscriptionPlan('sherpa-rs', {
      CODEBUDDY_SPEECH_LANG: 'fr',
      CODEBUDDY_SPEECH_FALLBACK: 'true',
    })).toEqual({
      requestedEngine: 'sherpa-rs',
      effectiveEngine: 'sherpa-rs',
      language: 'fr',
      languagePinned: true,
      fallbackEnabled: true,
    });
    // A pin outside that set (Japanese) still hands the turn to faster-whisper.
    expect(resolveSpeechTranscriptionPlan('parakeet', {
      CODEBUDDY_SPEECH_LANG: 'ja',
      CODEBUDDY_SPEECH_FALLBACK: 'true',
    })).toEqual({
      requestedEngine: 'parakeet',
      effectiveEngine: 'faster-whisper',
      language: 'ja',
      languagePinned: true,
      fallbackEnabled: true,
      fallbackReason: 'parakeet-language-pin-unsupported',
    });
    expect(resolveSpeechTranscriptionPlan('parakeet', {
      CODEBUDDY_SPEECH_FALLBACK: 'true',
    }).effectiveEngine).toBe('parakeet');
    expect(resolveSpeechTranscriptionPlan('parakeet', {
      CODEBUDDY_SPEECH_LANG: 'ja',
      CODEBUDDY_SPEECH_FALLBACK: 'false',
    })).toMatchObject({
      effectiveEngine: 'parakeet',
      fallbackEnabled: false,
      blockingReason: 'parakeet-language-pin-unsupported-and-fallback-disabled',
    });
    expect(resolveSpeechTranscriptionPlan('sherpa-rs', {
      CODEBUDDY_SPEECH_LANG: 'auto',
      CODEBUDDY_SPEECH_FALLBACK: 'false',
    })).toMatchObject({
      effectiveEngine: 'sherpa-rs',
      language: 'auto',
      languagePinned: false,
      fallbackEnabled: false,
    });
  });

  it('resolves + expands the parakeet model dir', () => {
    expect(resolveParakeetModelDir()).toBe(join(homedir(), '.codebuddy/asr/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8'));
    process.env.CODEBUDDY_PARAKEET_MODEL_DIR = '~/custom/model';
    expect(resolveParakeetModelDir()).toBe(join(homedir(), 'custom/model'));
    expect(expandSpeechPath('/abs/path')).toBe('/abs/path');
    expect(expandSpeechPath('~')).toBe(homedir());
  });

  it('fails closed when auto has no complete French-capable model', () => {
    expect(isParakeetModelComplete('/definitely/not-a-model')).toBe(false);
    expect(isFrenchParakeetModelAvailable('/definitely/not-a-model')).toBe(false);
    process.env.BUDDY_SENSE_STT_MODEL_DIR = '~/custom/model';
    expect(resolveParakeetModelDir()).toBe(join(homedir(), 'custom/model'));
  });

  it('honours the documented buddy-sense model and thread overrides', () => {
    expect(resolveParakeetModelDir({
      BUDDY_SENSE_STT_MODEL_DIR: '/opt/custom/parakeet-model',
      CODEBUDDY_PARAKEET_MODEL_DIR: '/opt/legacy/model',
    })).toBe('/opt/custom/parakeet-model');
    expect(resolveSpeechSttThreads({ BUDDY_SENSE_STT_THREADS: '6' })).toBe(6);
    expect(resolveSpeechSttThreads({ CODEBUDDY_SPEECH_STT_THREADS: '5' })).toBe(5);
    expect(resolveSpeechSttThreads({ CODEBUDDY_SPEECH_THREADS: '3' })).toBe(3);
    expect(resolveSpeechSttThreads({ BUDDY_SENSE_STT_THREADS: '0' })).toBe(4);
  });
});
