/**
 * speech-text — pure spoken-digest + command-mode helpers (no React/DOM).
 */
import { describe, it, expect } from 'vitest';
import {
  cleanForSpeech,
  condenseForSpeech,
  extractCompleteSpeechChunks,
  isVoiceCommandMode,
} from '../src/renderer/utils/speech-text';

describe('voice command mode (Cowork defaults to piloting)', () => {
  it('defaults to ON when unset (no localStorage in node → piloting)', () => {
    // localStorage is undefined here → the helper falls back to true (piloting).
    expect(isVoiceCommandMode()).toBe(true);
  });
});

describe('cleanForSpeech', () => {
  it('handles a long run of markdown markers without blocking the renderer', () => {
    const markers = '*'.repeat(80_000);
    const start = performance.now();
    expect(cleanForSpeech(markers)).toHaveLength(markers.length);
    expect(performance.now() - start).toBeLessThan(1_500);
  });
  it('conserves underscores and hashes when not emphasizing', () => {
    expect(cleanForSpeech('Ouvre my_config_file.json')).toBe('Ouvre my_config_file.json');
    expect(cleanForSpeech('Le langage C# est typé')).toBe('Le langage C# est typé');
  });

  it('removes tags when emphasizing', () => {
    expect(cleanForSpeech('**gras** et _italique_')).toBe('gras et italique');
  });
});

describe('condenseForSpeech', () => {
  it('strips markdown for natural speech', () => {
    expect(cleanForSpeech('**bold** and `code` and [link](http://x)')).toBe('bold and code and link');
  });

  it('does not split sentences on decimals', () => {
    expect(condenseForSpeech('La version 3.5 est sortie. Elle corrige tout.')).toBe('La version 3.5 est sortie. Elle corrige tout.');
    expect(condenseForSpeech('Le prix est 12.50 euros. Merci.')).toBe('Le prix est 12.50 euros. Merci.');
  });

  it('drops code blocks entirely', () => {
    const out = condenseForSpeech('Voici le résultat.\n\n```js\nconst x = 1;\n```');
    expect(out).toBe('Voici le résultat.');
    expect(out).not.toContain('const');
  });

  it('keeps only the first few sentences', () => {
    const text = 'Phrase une. Phrase deux. Phrase trois. Phrase quatre. Phrase cinq.';
    const out = condenseForSpeech(text, { maxSentences: 2 });
    expect(out).toBe('Phrase une. Phrase deux.');
  });

  it('takes the first paragraph only', () => {
    const out = condenseForSpeech('Le résumé court.\n\nUn long paragraphe de détails ignoré.');
    expect(out).toBe('Le résumé court.');
  });

  it('hard-caps the length with an ellipsis', () => {
    const long = 'a'.repeat(500); // no sentence punctuation → whole paragraph
    const out = condenseForSpeech(long, { maxChars: 100 });
    expect(out.length).toBeLessThanOrEqual(101); // 100 + ellipsis
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns empty for code-only / empty input', () => {
    expect(condenseForSpeech('```\nonly code\n```')).toBe('');
    expect(condenseForSpeech('   ')).toBe('');
  });

  it('passes through a short plain reply unchanged', () => {
    expect(condenseForSpeech('Fait, le fichier est créé.')).toBe('Fait, le fichier est créé.');
  });
});

describe('extractCompleteSpeechChunks', () => {
  it('emits complete sentences and leaves the unfinished suffix pending', () => {
    const result = extractCompleteSpeechChunks('Bonjour. Je commence une réponse');
    expect(result).toEqual({ chunks: ['Bonjour.'], nextOffset: 9 });
  });

  it('continues from the raw source offset without repeating earlier speech', () => {
    const first = extractCompleteSpeechChunks('Bonjour. Deuxième phrase. Troisième');
    const second = extractCompleteSpeechChunks(
      'Bonjour. Deuxième phrase. Troisième terminée !',
      first.nextOffset
    );
    expect(first.chunks).toEqual(['Bonjour.', 'Deuxième phrase.']);
    expect(second.chunks).toEqual(['Troisième terminée !']);
  });

  it('cleans markdown before queueing a completed sentence', () => {
    expect(extractCompleteSpeechChunks('**Terminé** avec `Pocket`.').chunks).toEqual([
      'Terminé avec Pocket.',
    ]);
  });
});
