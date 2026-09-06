#!/usr/bin/env node
/**
 * Reproduce the robot's language-aware WAV STT path with an explicit trace.
 *
 * Usage (the service loads the same two env files):
 *   node --env-file=.env --env-file=$HOME/.codebuddy/vision.env --import tsx \
 *     scripts/reproduce-stt-francais.ts path/to/phrase.wav
 */

import { access } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import {
  resolveFasterWhisperOptions,
  transcribeWav,
} from '../src/sensory/speech-reaction.js';
import {
  resolveParakeetModelDir,
  resolveSpeechTranscriptionPlan,
} from '../src/sensory/speech-engine-config.js';

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) {
    throw new Error('usage: reproduce-stt-francais.ts <wav>');
  }
  const wav = isAbsolute(input) ? input : resolve(process.cwd(), input);
  await access(wav);

  const plan = resolveSpeechTranscriptionPlan();
  const options = resolveFasterWhisperOptions();
  const hotwords = options.hotwords
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  const model = plan.effectiveEngine === 'faster-whisper'
    ? process.env.CODEBUDDY_SPEECH_MODEL?.trim() || 'base'
    : resolveParakeetModelDir();

  console.log(JSON.stringify({
    phase: 'stt-plan',
    wav,
    requestedEngine: plan.requestedEngine,
    effectiveEngine: plan.effectiveEngine,
    model,
    language: plan.language,
    languagePinned: plan.languagePinned,
    fallbackEnabled: plan.fallbackEnabled,
    fallbackReason: plan.fallbackReason ?? null,
    blockingReason: plan.blockingReason ?? null,
    hotwords,
  }));

  const started = performance.now();
  const transcript = await transcribeWav(wav);
  const decodeMs = Math.round(performance.now() - started);
  console.log(JSON.stringify({
    phase: 'stt-result',
    effectiveEngine: plan.effectiveEngine,
    language: plan.language,
    hotwordCount: hotwords.length,
    decodeMs,
    transcript,
  }));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ phase: 'stt-error', error: message }));
    process.exit(1);
  });
