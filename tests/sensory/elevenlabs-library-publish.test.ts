/**
 * Doctrine (Patrice, 2026-08-16): a phrase in Lisa's ElevenLabs voice is paid ONCE
 * and reused by every product — MySoulmate, the phone assistant, the robot. Until
 * now Code Buddy only read this library; what the robot paid for stayed in its own
 * evicting cache. These tests hold the publisher to the shared contract, because a
 * corrupt index breaks three products at once.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ElevenLabsVoiceLibrary,
  publishToVoiceLibrary,
  isPaidElevenLabsVoice,
  resetVoiceLibrary,
} from '../../src/sensory/elevenlabs-library.js';

let dir: string;
let src: string;
const VOICE = 'elevenlabs:3fxbs2pB9bs8S6Z1N38A';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-pub-'));
  src = path.join(dir, 'fresh.wav');
  fs.writeFileSync(src, 'RIFFpaidaudio');
  resetVoiceLibrary();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  resetVoiceLibrary();
});

function readIndex(): { count?: number; entries?: { text: string; file: string }[] } {
  return JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
}

describe('publishToVoiceLibrary', () => {
  it('makes a freshly paid phrase findable by the other products', () => {
    expect(publishToVoiceLibrary('Bonjour Patrice, bien dormi ?', VOICE, src, dir)).not.toBeNull();
    const idx = readIndex();
    expect(idx.entries).toHaveLength(1);
    expect(idx.count).toBe(1);
    // MySoulmate's own lookup is case-sensitive: the text must stay as spoken.
    expect(idx.entries?.[0]?.text).toBe('Bonjour Patrice, bien dormi ?');
    expect(new ElevenLabsVoiceLibrary({ dir }).lookup('Bonjour Patrice, bien dormi ?')).not.toBeNull();
  });

  it('never publishes a phrase that is already paid for', () => {
    publishToVoiceLibrary('On y va.', VOICE, src, dir);
    const first = readIndex().entries?.[0]?.file;
    fs.writeFileSync(src, 'RIFFdifferentaudio');
    expect(publishToVoiceLibrary('  on   Y VA.  ', VOICE, src, dir)).toBeNull();
    const idx = readIndex();
    expect(idx.entries).toHaveLength(1);
    expect(idx.entries?.[0]?.file).toBe(first);
  });

  it('refuses anything that is not the paid voice', () => {
    expect(publishToVoiceLibrary('Coucou', 'pocket:estelle', src, dir)).toBeNull();
    expect(publishToVoiceLibrary('Coucou', undefined, src, dir)).toBeNull();
    expect(fs.existsSync(path.join(dir, 'index.json'))).toBe(false);
  });

  it('refuses to publish an empty rendition', () => {
    fs.writeFileSync(src, '');
    expect(publishToVoiceLibrary('Silence', VOICE, src, dir)).toBeNull();
  });

  it('gives similar openers distinct files instead of colliding', () => {
    // The library's legacy naming keeps only the first 16 characters of the text.
    const a = 'Bonjour Patrice, tu veux un café ?';
    const b = 'Bonjour Patrice, on attaque le rapport ?';
    publishToVoiceLibrary(a, VOICE, src, dir);
    publishToVoiceLibrary(b, VOICE, src, dir);
    const files = readIndex().entries?.map((e) => e.file) ?? [];
    expect(new Set(files).size).toBe(2);
    const lib = new ElevenLabsVoiceLibrary({ dir });
    expect(lib.lookup(a)?.file).not.toBe(lib.lookup(b)?.file);
  });

  it('leaves an unreadable index untouched rather than replacing it', () => {
    // Three products read this file; clobbering it on a parse error would be worse
    // than not publishing.
    fs.writeFileSync(path.join(dir, 'index.json'), '{ corrupted');
    expect(publishToVoiceLibrary('Nouvelle phrase', VOICE, src, dir)).toBeNull();
    expect(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).toBe('{ corrupted');
  });

  it('can be turned off explicitly', () => {
    const saved = process.env.CODEBUDDY_TTS_LIBRARY_PUBLISH;
    process.env.CODEBUDDY_TTS_LIBRARY_PUBLISH = 'off';
    try {
      expect(publishToVoiceLibrary('Rien', VOICE, src, dir)).toBeNull();
    } finally {
      if (saved === undefined) delete process.env.CODEBUDDY_TTS_LIBRARY_PUBLISH;
      else process.env.CODEBUDDY_TTS_LIBRARY_PUBLISH = saved;
    }
  });

  it('skips publishing rather than waiting when another writer holds the index', () => {
    fs.writeFileSync(path.join(dir, 'index.lock'), '');
    expect(publishToVoiceLibrary('Concurrent', VOICE, src, dir)).toBeNull();
  });
});

describe('isPaidElevenLabsVoice', () => {
  it('recognises the paid voice descriptor only', () => {
    expect(isPaidElevenLabsVoice(VOICE)).toBe(true);
    expect(isPaidElevenLabsVoice('ELEVENLABS:abc')).toBe(true);
    expect(isPaidElevenLabsVoice('pocket:estelle')).toBe(false);
    expect(isPaidElevenLabsVoice(undefined)).toBe(false);
  });
});
