import { describe, it, expect } from 'vitest';
import {
  frenchIntegerToWords,
  normalizeFrenchNumbers,
  prepareSpeech,
  stripForeignScript,
} from '../../src/sensory/speech-sanitizer.js';

describe('prepareSpeech — the gate before text reaches the speakers', () => {
  it('keeps a clean French reply unchanged (modulo trim)', () => {
    expect(prepareSpeech('  Bonjour Patrice, tout va bien ?  ')).toBe('Bonjour Patrice, tout va bien ?');
    expect(prepareSpeech('Oui.')).toBe('Oui.');
    expect(prepareSpeech('42')).toBe('quarante-deux');
  });

  it('strips a foreign-script (CJK) run that leaked mid-reply, keeping the French part', () => {
    // The real observed bug: a French reply degrading into a Chinese self-instruction.
    const raw =
      'Voilà ce qu’il faut faire : vérifie la date sur ton passeport, pour voir si tu peux延长一下句子，使其更加自然流畅。';
    const out = prepareSpeech(raw);
    expect(out).toBe('Voilà ce qu’il faut faire : vérifie la date sur ton passeport, pour voir si tu peux');
    expect(out).not.toMatch(/[一-鿿]/); // no Han characters survive
  });

  it('strips CJK mid-sentence and closes the gap', () => {
    expect(prepareSpeech('Bonjour 你好 Patrice')).toBe('Bonjour Patrice');
  });

  it('mutes (returns null) when nothing pronounceable remains', () => {
    expect(prepareSpeech('延长一下句子，使其更加自然流畅。')).toBeNull(); // pure CJK
    expect(prepareSpeech('👍')).toBeNull(); // emoji only — a Latin voice can't say it
    expect(prepareSpeech('   ')).toBeNull(); // whitespace
    expect(prepareSpeech('!!!???')).toBeNull(); // punctuation only
    expect(prepareSpeech('')).toBeNull();
    // @ts-expect-error — defensive against non-string input
    expect(prepareSpeech(undefined)).toBeNull();
  });

  it('strips leaked model control tokens / thinking blocks', () => {
    expect(prepareSpeech('<think>je réfléchis</think>Bonjour')).toBe('Bonjour');
    expect(prepareSpeech('<|im_end|>Salut Patrice')).toBe('Salut Patrice');
    expect(prepareSpeech('<think>only reasoning, no answer</think>')).toBeNull();
  });

  it('keeps a reply that mixes letters and emoji', () => {
    expect(prepareSpeech('D’accord 👍')).toBe('D’accord');
  });

  it('normalizes French numbers, hours, percentages, and ordinals', () => {
    expect(normalizeFrenchNumbers('Le 1er à 9h30, en 2026 : 25 %, puis le 2e.')).toBe(
      'Le premier à neuf heures trente, en deux mille vingt-six : vingt-cinq pour cent, puis le deuxième.',
    );
    expect(frenchIntegerToWords(9_999)).toBe('neuf mille neuf cent quatre-vingt-dix-neuf');
  });

  it('spaces short uppercase acronyms and canonicalizes vocal punctuation', () => {
    expect(prepareSpeech('Le PDF… est prêt!!! 😄')).toBe('Le P D F… est prêt!');
    expect(prepareSpeech('Alpha — bêta???')).toBe('Alpha, bêta?');
  });

  it('preserves natural attack interjections and expressive punctuation for prosody', () => {
    expect(prepareSpeech('Ah, oui… Hmm, on peut essayer ! Oh, attends.')).toBe(
      'Ah, oui… Hmm, on peut essayer ! Oh, attends.',
    );
  });

  it('turns list bullets into spoken comma pauses', () => {
    expect(prepareSpeech('- alpha\n- bêta')).toBe('alpha, bêta');
  });
});

describe('stripForeignScript', () => {
  it('removes Han/Hiragana/Katakana/Hangul runs, leaves Latin + Thai untouched', () => {
    expect(stripForeignScript('abc漢字def').replace(/\s+/g, ' ').trim()).toBe('abc def');
    expect(stripForeignScript('한국어 test').replace(/\s+/g, ' ').trim()).toBe('test');
    // Thai is NOT stripped — it's not in the unpronounceable set we target (err toward speaking).
    expect(stripForeignScript('ตลาด')).toBe('ตลาด');
  });
});
