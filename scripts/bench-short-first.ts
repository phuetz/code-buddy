/**
 * Offline CONV3 benchmark with a deterministic, cadence-controlled fake provider.
 *
 * Usage: npx tsx scripts/bench-short-first.ts
 */

import { makeHybridReply } from '../src/sensory/hybrid-reply.js';
import { makeVoiceReply } from '../src/sensory/voice-loop.js';
import { logger } from '../src/utils/logger.js';

const CADENCE_MS = 100;
const SENTENCE_COUNT = 6;
const ENV_KEYS = [
  'CODEBUDDY_SENSORY_SHORT_FIRST',
  'CODEBUDDY_SENSORY_REPLY_MAX_SENTENCES',
  'CODEBUDDY_VOICE_SPOKEN_PREFIX',
  'CODEBUDDY_SEMANTIC_GATE',
] as const;

interface BenchResult {
  firstContentMs: number;
  providerSegmentsAtFirstAudio: number;
  spokenSentences: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function measure(shortFirst: boolean, prefix: string): Promise<BenchResult> {
  if (shortFirst) process.env.CODEBUDDY_SENSORY_SHORT_FIRST = 'true';
  else delete process.env.CODEBUDDY_SENSORY_SHORT_FIRST;

  let providerSegments = 0;
  let providerSegmentsAtFirstAudio = -1;
  let firstContentMs = -1;
  let spokenSentences = 0;
  const startedAt = performance.now();
  const sentences = Array.from(
    { length: SENTENCE_COUNT },
    (_, index) => `${prefix} ${index + 1} apporte un contenu utile.`,
  );
  const hybrid = makeHybridReply({
    fastReply: () => null,
    prefetch: () => null,
    jokes: () => null,
    classify: () => false,
    chitchat: async () => 'Réponse bloquante inutilisée.',
    chitchatStream: async function* () {
      for (const sentence of sentences) {
        await delay(CADENCE_MS);
        providerSegments += 1;
        yield `${sentence} `;
      }
    },
    agentReply: async () => 'Réponse agent inutilisée.',
  });
  const voice = makeVoiceReply({
    replyFn: hybrid,
    streamSpeak: async (_text, options) => {
      spokenSentences += 1;
      if (firstContentMs < 0) {
        firstContentMs = Math.round(performance.now() - startedAt);
        providerSegmentsAtFirstAudio = providerSegments;
      }
      options?.onFirstAudio?.();
      return true;
    },
    synth: async () => '',
    play: async () => undefined,
    cameraShare: async () => null,
    visualGrounding: async () => ({ status: 'unavailable', response: '' }),
    avatarEnabled: false,
  });

  await voice('Raconte quelque chose de simple.');
  return { firstContentMs, providerSegmentsAtFirstAudio, spokenSentences };
}

async function main(): Promise<void> {
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  const savedLogLevel = logger.getLevel();
  logger.setLevel('error');
  process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX = 'false';
  process.env.CODEBUDDY_SEMANTIC_GATE = 'false';
  delete process.env.CODEBUDDY_SENSORY_REPLY_MAX_SENTENCES;

  try {
    await measure(false, 'Préchauffage');
    const before = await measure(false, 'Mesure avant');
    const after = await measure(true, 'Mesure après');
    console.log(`cadence fournisseur factice : ${CADENCE_MS} ms, ${SENTENCE_COUNT} phrases`);
    console.log(
      `avant — premier contenu audible : ${before.firstContentMs} ms ` +
        `(segment fournisseur ${before.providerSegmentsAtFirstAudio}/${SENTENCE_COUNT}), ` +
        `phrases jouées : ${before.spokenSentences}`,
    );
    console.log(
      `après — premier contenu audible : ${after.firstContentMs} ms ` +
        `(segment fournisseur ${after.providerSegmentsAtFirstAudio}/${SENTENCE_COUNT}), ` +
        `phrases jouées : ${after.spokenSentences}`,
    );

    if (
      before.providerSegmentsAtFirstAudio !== 2 ||
      before.spokenSentences !== SENTENCE_COUNT ||
      after.providerSegmentsAtFirstAudio !== 1 ||
      after.spokenSentences !== 3 ||
      after.firstContentMs >= before.firstContentMs
    ) {
      throw new Error('les invariants avant/après de CONV3 ne sont pas respectés');
    }
  } finally {
    logger.setLevel(savedLogLevel);
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error: unknown) => {
  console.error(`bench-short-first: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
