#!/usr/bin/env node
/**
 * Persistent local Smart Turn v3 worker.
 *
 * Protocol (JSONL):
 *   stdout {"ready":true,"model":"..."}
 *   stdin  {"id":"...","pcmPath":"/tmp/16khz-mono-i16le.pcm"}
 *   stdout {"id":"...","complete":true,"probability":0.91,"durationMs":42}
 *
 * The Rust ear writes candidate PCM into a private temporary file. Keeping the
 * ONNX session and Whisper feature extractor resident avoids model-load latency
 * on every pause. stdout is protocol-only; diagnostics go to stderr.
 */
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { WhisperFeatureExtractor } from '@huggingface/transformers';

// Resolve ONNX Runtime from the modern Transformers dependency. Code Buddy
// still carries an older top-level runtime for legacy call sites; it cannot
// load Smart Turn's ONNX IR v10 model.
const transformerRequire = createRequire(
  new URL('../node_modules/@huggingface/transformers/package.json', import.meta.url),
);
const ort = transformerRequire('onnxruntime-node');

const SAMPLE_RATE = 16_000;
const WINDOW_SECONDS = 8;
const WINDOW_SAMPLES = SAMPLE_RATE * WINDOW_SECONDS;
const DEFAULT_MODEL = path.join(
  homedir(),
  '.codebuddy',
  'turn-detection',
  'smart-turn-v3.2-cpu.onnx',
);

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function normalizeAndLeftPad(raw) {
  const source = raw.length > WINDOW_SAMPLES
    ? raw.subarray(raw.length - WINDOW_SAMPLES)
    : raw;
  let mean = 0;
  for (const value of source) mean += value;
  mean /= Math.max(1, source.length);
  let variance = 0;
  for (const value of source) variance += (value - mean) ** 2;
  variance /= Math.max(1, source.length);
  const scale = Math.sqrt(variance + 1e-7);
  const padded = new Float32Array(WINDOW_SAMPLES);
  const offset = WINDOW_SAMPLES - source.length;
  for (let index = 0; index < source.length; index += 1) {
    padded[offset + index] = (source[index] - mean) / scale;
  }
  return padded;
}

function readPcm16(filePath) {
  const bytes = readFileSync(filePath);
  const samples = new Float32Array(Math.floor(bytes.length / 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = bytes.readInt16LE(index * 2) / 32768;
  }
  return samples;
}

const modelPath = path.resolve(process.env.BUDDY_SENSE_SMART_TURN_MODEL || DEFAULT_MODEL);
if (!existsSync(modelPath)) {
  emit({ error: `Smart Turn model not found: ${modelPath}` });
  process.exit(1);
}

const extractor = new WhisperFeatureExtractor({
  feature_size: 80,
  sampling_rate: SAMPLE_RATE,
  hop_length: 160,
  n_fft: 400,
  chunk_length: WINDOW_SECONDS,
  n_samples: WINDOW_SAMPLES,
  nb_max_frames: 800,
  padding_value: 0,
  return_attention_mask: false,
});
const session = await ort.InferenceSession.create(modelPath, {
  executionMode: 'sequential',
  graphOptimizationLevel: 'all',
  interOpNumThreads: 1,
  intraOpNumThreads: Math.max(1, Number(process.env.BUDDY_SENSE_SMART_TURN_THREADS || 2)),
});
emit({ ready: true, model: modelPath });

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  let request;
  try {
    request = JSON.parse(line);
    const startedAt = performance.now();
    const audio = normalizeAndLeftPad(readPcm16(request.pcmPath));
    const features = await extractor(audio, { max_length: WINDOW_SAMPLES });
    const tensor = new ort.Tensor(
      'float32',
      features.input_features.data,
      features.input_features.dims,
    );
    const output = await session.run({ input_features: tensor });
    const first = output[session.outputNames[0]];
    const probability = Number(first?.data?.[0]);
    if (!Number.isFinite(probability)) throw new Error('Smart Turn returned no probability');
    emit({
      id: request.id,
      complete: probability > Number(process.env.BUDDY_SENSE_SMART_TURN_THRESHOLD || 0.5),
      probability,
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    emit({
      id: request?.id || '',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
