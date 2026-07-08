/**
 * subtitles — karaoke ASS builder (pure).
 */
import { describe, it, expect } from 'vitest';
import {
  estimateWordTimings,
  assTime,
  buildKaraokeAss,
} from '../../../src/tools/video/subtitles.js';

describe('estimateWordTimings', () => {
  it('produces one monotonic timing per word spanning the duration', () => {
    const w = estimateWordTimings('bonjour le monde ici', 4);
    expect(w).toHaveLength(4);
    expect(w[0]!.start).toBe(0);
    expect(w[3]!.end).toBeCloseTo(4, 1);
    for (let i = 1; i < w.length; i++) expect(w[i]!.start).toBeGreaterThanOrEqual(w[i - 1]!.start);
  });

  it('gives more time to longer words and to punctuation pauses', () => {
    const w = estimateWordTimings('a, extraordinaire', 6);
    const dot = w[0]!.end - w[0]!.start; // "a," — short but has a comma pause
    const long = w[1]!.end - w[1]!.start; // "extraordinaire" — many letters
    expect(long).toBeGreaterThan(dot);
    // the comma still buys "a," some time beyond a bare single letter
    expect(dot).toBeGreaterThan(0.2);
  });

  it('returns [] for empty text or non-positive duration', () => {
    expect(estimateWordTimings('', 5)).toEqual([]);
    expect(estimateWordTimings('mot', 0)).toEqual([]);
  });
});

describe('assTime', () => {
  it('formats seconds as H:MM:SS.cs', () => {
    expect(assTime(0)).toBe('0:00:00.00');
    expect(assTime(3.24)).toBe('0:00:03.24');
    expect(assTime(72.5)).toBe('0:01:12.50');
  });
});

describe('buildKaraokeAss', () => {
  it('emits a valid ASS with a karaoke style and \\k-tagged dialogue', () => {
    const ass = buildKaraokeAss('Voici Code Buddy maintenant', 4, 0.6, { wordsPerLine: 10 });
    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('PlayResX: 1920');
    expect(ass).toContain('Style: K,DejaVu Sans,50,&H00FFFFFF,&H00D9B36A');
    expect(ass).toContain('Dialogue: 0,');
    expect(ass).toMatch(/\{\\k\d+\}Voici/);
    // 4 words on one line (wordsPerLine 10) => exactly one Dialogue event
    expect(ass.match(/^Dialogue:/gm)!).toHaveLength(1);
  });

  it('offsets all times by the lead and splits into multiple lines', () => {
    const ass = buildKaraokeAss('un deux trois quatre cinq six sept huit', 8, 1.0, {
      wordsPerLine: 3,
    });
    // 8 words / 3 per line => 3 dialogue lines
    expect(ass.match(/^Dialogue:/gm)!).toHaveLength(3);
    // first line starts at the lead (>= 0:00:01.00)
    const first = ass.match(/^Dialogue: 0,(\d:\d\d:\d\d\.\d\d),/m)![1];
    expect(first >= '0:00:01.00').toBe(true);
  });

  it('strips ASS-breaking characters from words', () => {
    const ass = buildKaraokeAss('a{b}c \\d', 2, 0);
    expect(ass).not.toMatch(/\{b\}/);
    expect(ass).toContain('abc');
  });
});
