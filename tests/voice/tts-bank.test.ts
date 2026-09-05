import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TtsCache } from '../../src/sensory/tts-cache.js';
import {
  buildTtsBank,
  listTtsBank,
  loadTtsBankCorpus,
  validateFixedTtsBankPhrase,
  verifyTtsBank,
} from '../../src/voice/tts-bank.js';

function fakeWav(): Buffer {
  return Buffer.from('RIFF....WAVEfmt fake bank wav');
}

describe('precomputed TTS bank', () => {
  let cwd = '';
  let cacheDir = '';
  let playbackDir = '';

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'cb-tts-bank-project-'));
    cacheDir = join(cwd, '.cache');
    playbackDir = join(cwd, '.playback');
    mkdirSync(playbackDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const writeBank = (contents: string): void => {
    const path = join(cwd, '.codebuddy', 'tts-bank.txt');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, 'utf8');
  };

  const cache = (): TtsCache => new TtsCache({
    dir: cacheDir,
    tmpDir: playbackDir,
    defer: (task) => task(),
  });

  it('loads project phrases plus built-in openings/cues, with comments and duplicates removed', () => {
    writeBank('# phrases fixes\nBonjour banque.\n\nCue locale.\nBonjour banque.\n');
    const corpus = loadTtsBankCorpus({
      cwd,
      env: { CODEBUDDY_USER_NAME: 'Patrice' },
      builtinPhrases: ['Ouverture {{name}}.', 'Cue locale.'],
    });

    expect(corpus.phrases).toEqual([
      'Bonjour banque.',
      'Cue locale.',
      'Ouverture Patrice.',
    ]);
    expect(corpus.rejected).toEqual([]);
  });

  it.each([
    ['Bonjour {{name}}.', 'placeholder'],
    ['Nous sommes le 3 septembre.', 'number'],
    ['Le rendez-vous est demain.', 'date-or-time'],
    ['Il est 14h30.', 'number'],
  ])('refuses non-fixed phrase %s', (phrase, reason) => {
    expect(validateFixedTtsBankPhrase(phrase)).toEqual({ valid: false, reason });
  });

  it('never synthesizes rejected project phrases', async () => {
    writeBank('Phrase fixe.\nBonjour {{name}}.\nRappel demain.\nVersion 42.\n');
    const synthesize = vi.fn(async (_text: string, wavPath: string) => {
      writeFileSync(wavPath, fakeWav());
      return true;
    });

    const result = await buildTtsBank({
      cwd,
      env: {
        CODEBUDDY_TTS_LOCAL_URL: 'http://127.0.0.1:8300',
        CODEBUDDY_TTS_LOCAL_N_Q: '12',
      },
      provider: 'local',
      cache: cache(),
      builtinPhrases: [],
      synthesize,
    });

    expect(result).toMatchObject({ attempted: 1, built: 1, present: 0 });
    expect(result.rejected).toHaveLength(3);
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(synthesize.mock.calls[0]![0]).toBe('Phrase fixe.');
  });

  it('builds stable local:n_q entries, lists them, and verifies without lookup/playback', async () => {
    writeBank('Bonjour banque.\nCue locale.\n');
    const ttsCache = cache();
    const lookup = vi.spyOn(ttsCache, 'lookup');
    const synthesize = vi.fn(async (_text: string, wavPath: string) => {
      writeFileSync(wavPath, fakeWav());
      return true;
    });
    const options = {
      cwd,
      env: {
        CODEBUDDY_TTS_LOCAL_URL: 'http://127.0.0.1:8300',
        CODEBUDDY_TTS_LOCAL_N_Q: '12',
      },
      provider: 'local' as const,
      cache: ttsCache,
      builtinPhrases: [] as string[],
    };

    const built = await buildTtsBank({ ...options, synthesize });
    expect(built).toMatchObject({ attempted: 2, built: 2, present: 0, failed: 0 });
    expect(ttsCache.stats()).toHaveLength(2);
    expect(ttsCache.stats().every((entry) => entry.voice?.startsWith('local:kyutai:12:'))).toBe(true);

    const listed = listTtsBank(options);
    expect(listed.entries.map((entry) => [entry.text, entry.present])).toEqual([
      ['Bonjour banque.', true],
      ['Cue locale.', true],
    ]);
    const verified = verifyTtsBank(options);
    expect(verified).toMatchObject({ expected: 2, present: 2, missing: [] });
    expect(lookup).not.toHaveBeenCalled();

    const second = await buildTtsBank({ ...options, synthesize });
    expect(second).toMatchObject({ attempted: 0, built: 0, present: 2 });
    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it('uses a distinct ElevenLabs cache identity when explicitly requested', async () => {
    writeBank('Même texte, autre voix.\n');
    const ttsCache = cache();
    const synthesize = vi.fn(async (_text: string, wavPath: string) => {
      writeFileSync(wavPath, fakeWav());
      return true;
    });
    await buildTtsBank({
      cwd,
      env: { CODEBUDDY_TTS_VOICE: 'elevenlabs:voice-a' },
      provider: 'elevenlabs',
      cache: ttsCache,
      builtinPhrases: [],
      synthesize,
    });

    expect(ttsCache.stats()[0]?.voice).toContain('elevenlabs:voice-a');
    expect(ttsCache.stats()[0]?.voice).not.toContain('local:kyutai:');
  });
});
