/**
 * Tests de falsification logique — Mission VOIX2 (Voix de Lisa hachée).
 *
 * Ces tests modélisent de façon déterministe (hors matériel audio) les comportements
 * de la chaîne de streaming vocal (ElevenLabs stream -> Gain -> Edges -> Player stdin)
 * pour falsifier ou confirmer chaque hypothèse logique sur les silences de 30 à 130 ms.
 *
 * Les tests sont conçus pour être ROUGES sur le code actuel, prouvant formellement
 * les défauts logiques identifiés dans le rapport REVUE-VOIX-GEMINI.md.
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const playerHarness = vi.hoisted(() => ({
  spawn: vi.fn(),
  commands: [] as string[],
  args: [] as string[][],
  writtenChunks: [] as Array<{ timestamp: number; bytes: Buffer }>,
}));

const commandExists = vi.hoisted(() => vi.fn(async (cmd: string) => cmd === 'aplay'));
const openElevenLabsAudioStream = vi.hoisted(() => vi.fn());
const cacheHarness = vi.hoisted(() => ({
  lookup: vi.fn((): string | null => null),
  store: vi.fn(),
}));
const libraryCopy = vi.hoisted(() => vi.fn((): string | null => null));
const CACHE_VOICE = vi.hoisted(() => 'elevenlabs:test-voice:model=test:format=pcm_24000');

vi.mock('child_process', () => ({ spawn: playerHarness.spawn }));
vi.mock('../../src/utils/command-exists.js', () => ({ commandExists }));
vi.mock('../../src/sensory/tts-cache.js', () => ({
  getTtsCache: () => ({
    lookup: cacheHarness.lookup,
    store: cacheHarness.store,
  }),
}));
vi.mock('../../src/sensory/elevenlabs-library.js', () => ({
  getVoiceLibrary: () => ({ copyForPlayback: libraryCopy }),
}));
vi.mock('../../src/voice/local-tts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/voice/local-tts.js')>();
  return {
    ...actual,
    resolveTtsEngine: () => 'elevenlabs' as const,
    resolveElevenLabsCacheVoice: () => CACHE_VOICE,
    openElevenLabsAudioStream,
  };
});

import { __voiceAudioPlayerTest } from '../../src/sensory/voice-loop.js';
import { pcm16Mono24kStreamWavHeader } from '../../src/voice/local-tts.js';
import { Pcm16WavStreamGain } from '../../src/voice/tts-volume.js';
import { Pcm16WavStreamEdges } from '../../src/voice/pcm-edges.js';

/**
 * Génère un bloc de PCM 16-bit mono 24 kHz d'une durée donnée en millisecondes.
 * À 24 kHz mono 16-bit, chaque milliseconde représente 24 échantillons = 48 octets.
 */
function makePcmSamples(durationMs: number, amplitude = 5000): Buffer {
  const sampleCount = Math.round((24000 * durationMs) / 1000);
  const buf = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    buf.writeInt16LE(i % 2 === 0 ? amplitude : -amplitude, i * 2);
  }
  return buf;
}

/**
 * Simulateur de DAC audio ALSA (consommation temps réel à 24 kHz mono 16-bit = 48 octets/ms).
 * Enregistre tous les underruns (silences / famines) lorsque le buffer est vide alors que
 * la lecture est en cours.
 */
class SimulatedDacConsumer {
  private buffer = Buffer.alloc(0);
  private lastTime = 0;
  public underruns: Array<{ startMs: number; durationMs: number }> = [];
  public totalSilenceMs = 0;
  private headerConsumed = false;

  feed(data: Buffer, nowMs: number): void {
    this.advance(nowMs);
    if (!this.headerConsumed && data.length >= 44 && data.subarray(0, 4).toString('ascii') === 'RIFF') {
      // Ignorer l'en-tête WAV dans la consommation d'échantillons audio
      this.headerConsumed = true;
      this.buffer = Buffer.concat([this.buffer, data.subarray(44)]);
    } else {
      this.buffer = Buffer.concat([this.buffer, data]);
    }
  }

  advance(nowMs: number): void {
    if (this.lastTime === 0) {
      this.lastTime = nowMs;
      return;
    }
    const elapsedMs = nowMs - this.lastTime;
    this.lastTime = nowMs;
    if (elapsedMs <= 0) return;

    const bytesNeeded = elapsedMs * 48; // 48 octets par ms
    if (this.buffer.length >= bytesNeeded) {
      this.buffer = this.buffer.subarray(bytesNeeded);
    } else {
      const availableMs = Math.floor(this.buffer.length / 48);
      const starvedMs = elapsedMs - availableMs;
      this.buffer = Buffer.alloc(0);
      if (this.headerConsumed && starvedMs > 0) {
        this.underruns.push({
          startMs: this.lastTime - starvedMs,
          durationMs: starvedMs,
        });
        this.totalSilenceMs += starvedMs;
      }
    }
  }
}

describe('Revue logique de la chaîne audio — Falsifications Vitest', () => {
  beforeEach(() => {
    playerHarness.commands.length = 0;
    playerHarness.args.length = 0;
    playerHarness.writtenChunks.length = 0;
    openElevenLabsAudioStream.mockReset();
    cacheHarness.lookup.mockReset();
    commandExists.mockClear();
  });

  /**
   * HYPOTHÈSE 1 : Absence totale de tampon de gigue (jitter buffer) sur streamSpeak
   *
   * Dans le code actuel, chaque chunk reçu du flux réseau ElevenLabs est écrit immédiatement
   * sur le stdin d'aplay. Quand le réseau ou le modèle ElevenLabs présente une gigue
   * de 80 à 120 ms entre morceaux de 40 ms, aplay vide son buffer en 40 ms et subit
   * des underruns de 40 à 80 ms, créant le motif précis mesuré (trous de 30 à 110 ms).
   *
   * Le contrat attendu d'un lecteur de flux réseau résilient est de disposer d'un
   * tampon de gigue (jitter buffer) avant/pendant la lecture évitant la famine du DAC.
   */
  it('HYPOTHÈSE 1 (ROUGE) : la gigue réseau ElevenLabs provoque des silences de 30-100 ms faute de tampon de gigue dans streamSpeak', async () => {
    const dac = new SimulatedDacConsumer();

    playerHarness.spawn.mockImplementation((command: string, args: string[], _options: { stdio: unknown }) => {
      playerHarness.commands.push(command);
      playerHarness.args.push(args);
      const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; kill: () => boolean };
      child.stdin = new PassThrough();
      child.kill = () => {
        queueMicrotask(() => child.emit('close', null));
        return true;
      };
      child.stdin.on('data', (chunk: Buffer) => {
        const now = Date.now() - t0;
        playerHarness.writtenChunks.push({ timestamp: now, bytes: chunk });
        dac.feed(chunk, now);
      });
      child.stdin.once('finish', () => queueMicrotask(() => child.emit('close', 0)));
      return child;
    });

    const t0 = Date.now();
    let chunkIndex = 0;
    const header = pcm16Mono24kStreamWavHeader();
    const chunkPcm = makePcmSamples(40, 6000); // 40 ms = 1920 octets

    const jitteryStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (chunkIndex === 0) {
          // Premier chunk (40 ms d'audio) à t = 0
          controller.enqueue(new Uint8Array(Buffer.concat([header, chunkPcm])));
          chunkIndex++;
          return;
        }
        if (chunkIndex < 5) {
          // Gigue réseau : le chunk suivant met 80 ms à arriver (alors que le chunk précédent ne contenait que 40 ms d'audio)
          await new Promise((r) => setTimeout(r, 80));
          const now = Date.now() - t0;
          dac.advance(now);
          controller.enqueue(new Uint8Array(chunkPcm));
          chunkIndex++;
          return;
        }
        controller.close();
      },
    });

    const speak = __voiceAudioPlayerTest.makeDefaultStreamSpeak(
      __voiceAudioPlayerTest.resolveVoiceAudioPlayer(),
      'elevenlabs',
    );

    expect(speak).toBeDefined();

    openElevenLabsAudioStream.mockResolvedValueOnce(jitteryStream);

    await speak!('Test de phrase avec gigue réseau', {
      ttsNormalizationFactor: 1.5,
    });

    expect(dac.underruns).toHaveLength(0);
    expect(dac.totalSilenceMs).toBe(0);
  });

  /**
   * HYPOTHÈSE 2 : Court-circuit du head-buffer sur les phrases suivantes (frozenFactor)
   *
   * Dans `Pcm16WavStreamGain` (src/voice/tts-volume.ts:334-338) :
   * Lorsque `frozenFactor` est défini (cas de la phrase 2 et de la phrase 3 d'un tour),
   * `this.mode` passe immédiatement à 'gain' et NE TAMPONNE RIEN (0 ms).
   * La phrase 3 commence donc sans le moindre buffer d'absorption, ce qui explique
   * les 6 micro-trous consécutifs mesurés sur la 3e phrase de `mesure-charge.wav`.
   */
  it('HYPOTHÈSE 2 (ROUGE) : Pcm16WavStreamGain avec frozenFactor n’accumule aucun buffer de tête', () => {
    // Avec frozenFactor = undefined (phrase 1) : il attend 400 ms (19 200 octets)
    const unfrozenGain = new Pcm16WavStreamGain({}, undefined);
    const header = pcm16Mono24kStreamWavHeader();
    const smallChunk = makePcmSamples(50); // 50 ms = 2400 octets

    const outputUnfrozen = unfrozenGain.push(Buffer.concat([header, smallChunk]));
    // Unfrozen ne renvoie que l'en-tête (44 octets), le payload audio de 50 ms est retenu dans le head buffer
    const audioBytesUnfrozen = outputUnfrozen.slice(1).reduce((acc, b) => acc + b.length, 0);
    expect(audioBytesUnfrozen).toBe(0); // Le payload est bien retenu en attendant 400 ms

    // Avec frozenFactor = 1.2 (phrase 2 ou 3) :
    const frozenGain = new Pcm16WavStreamGain({}, 1.2);
    const outputFrozen = frozenGain.push(Buffer.concat([header, smallChunk]));
    const audioBytesFrozen = outputFrozen.slice(1).reduce((acc, b) => acc + b.length, 0);

    // Contrat de robustesse anti-gigue : même avec un gain gelé, le processeur de streaming
    // DOIT conserver un tampon de sécurité avant d'alimenter le lecteur.
    // Sur le code actuel : ROUGE ! audioBytesFrozen > 0 (2400 octets immédiatement expulsés)
    expect(audioBytesFrozen).toBe(0);
  });

  /**
   * HYPOTHÈSE 3 (FALSIFIÉE) : Pcm16WavStreamEdges retient le tail temporairement mais le restitue intégralement
   *
   * Dans `Pcm16WavStreamEdges` (src/voice/pcm-edges.ts:185-199) :
   * `bufferTail` retient les échantillons de fin de chunk potentiellement silencieux (occlusives)
   * afin de pouvoir appliquer le fondu de sortie si le flux s'arrête.
   * Cette retenue (~40 ms) n'est PAS un défaut : dès que le chunk suivant arrive, tous les
   * échantillons retenus sont concaténés et délivrés sans perte. Avec le tampon de gigue
   * de 250 ms (Point 1), le DAC n'est jamais affamé par cette micro-rétention de bordure.
   */
  it('HYPOTHÈSE 3 (FALSIFIÉE) : Pcm16WavStreamEdges restitue les échantillons d’occlusives dès le chunk suivant', () => {
    const edges = new Pcm16WavStreamEdges({ prependSilenceMs: 0 });
    const header = pcm16Mono24kStreamWavHeader();

    // Chunk 1 : 100 ms d'audio fort, suivi de 40 ms d'occlusive (silence à 0)
    // Au total 140 ms = 6720 octets
    const loudPart1 = makePcmSamples(100, 8000);
    const stopConsonantPart = makePcmSamples(40, 0); // Silence occlusif
    const payload1 = Buffer.concat([loudPart1, stopConsonantPart]);

    const result1 = edges.push(Buffer.concat([header, payload1]));
    // Chunk 1 retient la queue occlusive en attente du chunk suivant
    const emittedChunk1 = result1.slice(1).reduce((acc, b) => acc + b.length, 0);
    expect(emittedChunk1).toBeLessThan(payload1.length);

    // Chunk 2 : suite de la parole (100 ms d'audio fort)
    const loudPart2 = makePcmSamples(100, 8000);
    const result2 = edges.push(loudPart2);

    // Résultat vérifié : chunk 2 émet les 40 ms d'occlusive retenues de chunk 1 + la majeure partie de chunk 2
    const emittedChunk2 = result2.reduce((acc, b) => acc + b.length, 0);
    expect(emittedChunk2).toBeGreaterThanOrEqual(stopConsonantPart.length);

    // À la fin du flux, flush restitue le reste et aucun échantillon de parole n'est perdu
    const flushed = edges.flush();
    const totalEmitted = emittedChunk1 + emittedChunk2 + flushed.reduce((acc, b) => acc + b.length, 0);
    // L'intégralité du contenu audio utile (240 ms = 11520 octets) est délivrée
    expect(totalEmitted).toBeGreaterThanOrEqual((100 + 40 + 100 - 5) * 48);
  });

  /**
   * HYPOTHÈSE 4 : Arguments d'aplay dépourvus de `--buffer-time` / `--buffer-size`
   *
   * Dans `src/sensory/voice-loop.ts:2219` :
   * `cmd: 'aplay', stdinArgs: ['-q', '-']`
   *
   * Par défaut, aplay n'impose aucune taille de ring-buffer ALSA. Sous PipeWire
   * avec le module echo-cancel (quantum de 20 ms), ALSA utilise un buffer minuscule
   * qui underrun dès qu'un retard d'écriture de 30 ms survient sur stdin.
   * Spécifier `--buffer-time=300000` (300 ms) ou 500 ms permettrait au buffer matériel/driver
   * d'absorber les à-coups de stdin sans interruption sonore.
   */
  it('HYPOTHÈSE 4 (ROUGE) : la configuration aplay n’impose aucun buffer-time pour absorber les goulots d’étranglement de stdin', async () => {
    const player = await __voiceAudioPlayerTest.resolveVoiceAudioPlayer();
    expect(player).not.toBeNull();
    expect(player?.cmd).toBe('aplay');

    // Vérifier que stdinArgs contient une directive de dimensionnement de tampon
    // (--buffer-time ou --buffer-size)
    // Dans le code actuel : ROUGE ! stdinArgs vaut uniquement ['-q', '-']
    const hasBufferConfig = player?.stdinArgs.some((arg) => arg.includes('--buffer-time') || arg.includes('--buffer-size'));
    expect(hasBufferConfig).toBe(true);
  });
});
