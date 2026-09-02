/**
 * The voice library sits on the speak hot path, so these tests hold it to the same
 * contract as the TTS cache: it either returns a playable paid recording, or it
 * returns null — it never throws, and it never hands back a path that would fail.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ElevenLabsVoiceLibrary,
  normalizePhrase,
  getVoiceLibrary,
  resetVoiceLibrary,
} from '../../src/sensory/elevenlabs-library.js';

let dir: string;

function writeLibrary(entries: unknown, files: Record<string, string> = {}): void {
  fs.writeFileSync(
    path.join(dir, 'index.json'),
    JSON.stringify({ voice: 'elevenlabs:test', count: 0, entries }),
  );
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-lib-'));
  resetVoiceLibrary();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  resetVoiceLibrary();
});

describe('normalizePhrase', () => {
  it('matches phrases a listener would hear as identical', () => {
    // The library was built over months by different tools: the same sentence can
    // differ by a curly apostrophe, doubled spaces or capitalization.
    expect(normalizePhrase('Coucou Patrice.')).toBe(normalizePhrase('  coucou   patrice.  '));
    expect(normalizePhrase("Je t'écoute")).toBe(normalizePhrase('Je t’écoute'));
  });

  it('keeps punctuation that changes the delivery', () => {
    // "Oui." and "Oui !" are different readings — playing the wrong one is worse
    // than synthesizing fresh.
    expect(normalizePhrase('Oui.')).not.toBe(normalizePhrase('Oui !'));
  });
});

describe('ElevenLabsVoiceLibrary', () => {
  it('returns a paid recording for a known phrase', () => {
    writeLibrary(
      [{ key: 'a', text: 'Coucou Patrice. Je suis là.', voice: 'elevenlabs:x', file: 'a.wav' }],
      { 'a.wav': 'RIFFdata' },
    );
    const hit = new ElevenLabsVoiceLibrary({ dir }).lookup('Coucou Patrice. Je suis là.');
    expect(hit).not.toBeNull();
    expect(hit?.file).toBe(path.join(dir, 'a.wav'));
    expect(hit?.text).toBe('Coucou Patrice. Je suis là.');
  });

  it('matches despite a curly apostrophe and stray whitespace', () => {
    writeLibrary([{ text: "Je t'entends, on peut ralentir.", file: 'b.wav' }], {
      'b.wav': 'RIFFdata',
    });
    const lib = new ElevenLabsVoiceLibrary({ dir });
    expect(lib.lookup('  Je t’entends, on peut ralentir.  ')).not.toBeNull();
  });

  it('returns null for an unknown phrase instead of guessing', () => {
    writeLibrary([{ text: 'Bonjour !', file: 'c.wav' }], { 'c.wav': 'RIFFdata' });
    expect(new ElevenLabsVoiceLibrary({ dir }).lookup('Une phrase jamais synthétisée')).toBeNull();
  });

  // The failure modes below are the whole point: on the speak path, a broken
  // library must be indistinguishable from no library at all.
  it('returns null — never throws — when the index is missing', () => {
    const lib = new ElevenLabsVoiceLibrary({ dir: path.join(dir, 'nope') });
    expect(() => lib.lookup('Coucou')).not.toThrow();
    expect(lib.lookup('Coucou')).toBeNull();
  });

  it('returns null — never throws — when the index is corrupt', () => {
    fs.writeFileSync(path.join(dir, 'index.json'), '{ this is not json');
    const lib = new ElevenLabsVoiceLibrary({ dir });
    expect(() => lib.lookup('Coucou')).not.toThrow();
    expect(lib.lookup('Coucou')).toBeNull();
  });

  it('refuses an entry whose audio file was deleted', () => {
    // An index that outlived its files must not hand back a path the player fails on.
    writeLibrary([{ text: 'Disparu', file: 'gone.wav' }]);
    expect(new ElevenLabsVoiceLibrary({ dir }).lookup('Disparu')).toBeNull();
  });

  it('refuses an entry whose audio file is empty', () => {
    writeLibrary([{ text: 'Vide', file: 'empty.wav' }], { 'empty.wav': '' });
    expect(new ElevenLabsVoiceLibrary({ dir }).lookup('Vide')).toBeNull();
  });

  it('skips malformed entries without losing the valid ones', () => {
    writeLibrary(
      [
        { text: 'sans fichier' },
        { file: 'orphan.wav' },
        null,
        { text: 'Bonne entrée', file: 'ok.wav' },
      ],
      { 'ok.wav': 'RIFFdata' },
    );
    const lib = new ElevenLabsVoiceLibrary({ dir });
    expect(lib.lookup('Bonne entrée')).not.toBeNull();
    expect(lib.size()).toBe(1);
  });

  it('keeps the first synthesis when a phrase appears twice', () => {
    // The library is append-only; the earliest take is the one that was heard and kept.
    writeLibrary(
      [
        { text: 'Doublon', file: 'first.wav' },
        { text: 'doublon', file: 'second.wav' },
      ],
      { 'first.wav': 'RIFFdata', 'second.wav': 'RIFFdata' },
    );
    expect(new ElevenLabsVoiceLibrary({ dir }).lookup('Doublon')?.file).toBe(
      path.join(dir, 'first.wav'),
    );
  });

  it('can be turned off explicitly', () => {
    writeLibrary([{ text: 'Coucou', file: 'a.wav' }], { 'a.wav': 'RIFFdata' });
    expect(new ElevenLabsVoiceLibrary({ dir, disabled: true }).lookup('Coucou')).toBeNull();
  });

  it('ignores blank input', () => {
    writeLibrary([{ text: 'Coucou', file: 'a.wav' }], { 'a.wav': 'RIFFdata' });
    const lib = new ElevenLabsVoiceLibrary({ dir });
    expect(lib.lookup('')).toBeNull();
    expect(lib.lookup('   ')).toBeNull();
  });

  it('reuses the shared instance so the index is parsed once', () => {
    expect(getVoiceLibrary()).toBe(getVoiceLibrary());
  });
});

describe('copyForPlayback — le contrat qui protège les audios payés', () => {
  it('rend une COPIE, jamais le fichier de la bibliothèque', () => {
    // sayNow supprime ce qu'il joue : rendre le chemin d'origine effacerait un
    // audio payé. C'est le test le plus important du module.
    writeLibrary([{ text: 'Coucou', file: 'a.wav' }], { 'a.wav': 'RIFFdata' });
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-out-'));
    const copy = new ElevenLabsVoiceLibrary({ dir }).copyForPlayback('Coucou', out);
    expect(copy).not.toBeNull();
    expect(copy).not.toBe(path.join(dir, 'a.wav'));
    expect(fs.existsSync(copy!)).toBe(true);

    // et supprimer la copie laisse l'original intact
    fs.unlinkSync(copy!);
    expect(fs.existsSync(path.join(dir, 'a.wav'))).toBe(true);
  });

  it('rend null pour une phrase inconnue, sans rien écrire', () => {
    writeLibrary([{ text: 'Coucou', file: 'a.wav' }], { 'a.wav': 'RIFFdata' });
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-out-'));
    expect(new ElevenLabsVoiceLibrary({ dir }).copyForPlayback('Inconnue', out)).toBeNull();
    expect(fs.readdirSync(out)).toHaveLength(0);
  });

  it('ne laisse aucun fichier partiel quand le transcodage échoue', () => {
    // mp3 + ffmpeg introuvable → null, et surtout aucun .wav vide abandonné
    writeLibrary([{ text: 'Mp3', file: 'a.mp3' }], { 'a.mp3': 'ID3fake' });
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-out-'));
    const prev = process.env.CODEBUDDY_FFMPEG_BIN;
    process.env.CODEBUDDY_FFMPEG_BIN = '/nonexistent/ffmpeg';
    try {
      expect(new ElevenLabsVoiceLibrary({ dir }).copyForPlayback('Mp3', out)).toBeNull();
      expect(fs.readdirSync(out)).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.CODEBUDDY_FFMPEG_BIN;
      else process.env.CODEBUDDY_FFMPEG_BIN = prev;
    }
  });
});
