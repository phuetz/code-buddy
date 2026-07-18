import { describe, expect, it } from 'vitest';

import {
  assessAudioFit,
  buildWebVtt,
  canonicalizeLocale,
  formatWebVttTimestamp,
  localePathSlug,
  renderCacheKey,
} from '../../../src/tools/video/localized-media.js';

describe('localized media locale helpers', () => {
  it('canonicalizes supported BCP-47 tags and creates stable path slugs', () => {
    expect(canonicalizeLocale('en-us', ['fr-FR', 'en-US'])).toBe('en-US');
    expect(localePathSlug('pt-BR')).toBe('pt-br');
  });

  it.each(['fr_FR', 'und', 'en-US-u-ca-gregory', 'x-private', ''])('rejects %j', (locale) => {
    expect(() => canonicalizeLocale(locale)).toThrow('locale tag');
  });

  it('rejects a valid locale that is not enabled', () => {
    expect(() => canonicalizeLocale('es-ES', ['fr-FR', 'en-US'])).toThrow('not enabled');
  });
});

describe('assessAudioFit', () => {
  const policy = {
    slotDurationMs: 4_000,
    leadInMs: 200,
    tailOutMs: 200,
    maxSpeedup: 1.08,
  };

  it('distinguishes padding, bounded speedup and overflow', () => {
    expect(assessAudioFit(3_500, policy)).toEqual({
      status: 'fits',
      playbackRate: 1,
      availableSpeechMs: 3_600,
    });
    expect(assessAudioFit(3_800, policy)).toMatchObject({ status: 'speedup', playbackRate: 1.0556 });
    expect(assessAudioFit(4_500, policy)).toMatchObject({ status: 'overflow', overflowMs: 612 });
  });
});

describe('WebVTT', () => {
  it('formats millisecond timestamps and Unicode cues', () => {
    expect(formatWebVttTimestamp(3_723)).toBe('00:00:03.723');
    expect(
      buildWebVtt(
        [
          { id: 'shot-01', startMs: 200, endMs: 3_200, text: 'Ça commence <ici>.' },
          { id: 'shot-02', startMs: 3_220, endMs: 6_000, text: 'Et ensuite --> demain.' },
        ],
        6_100,
      ),
    ).toBe(
      'WEBVTT\n\nshot-01\n00:00:00.200 --> 00:00:03.200\nÇa commence &lt;ici&gt;.\n\n' +
        'shot-02\n00:00:03.220 --> 00:00:06.000\nEt ensuite --&gt; demain.\n',
    );
  });

  it('rejects overlaps, out-of-range cues and NUL bytes', () => {
    expect(() =>
      buildWebVtt(
        [
          { startMs: 0, endMs: 1_000, text: 'one' },
          { startMs: 999, endMs: 1_500, text: 'two' },
        ],
        2_000,
      ),
    ).toThrow('overlaps');
    expect(() => buildWebVtt([{ startMs: 0, endMs: 2_001, text: 'x' }], 2_000)).toThrow('Invalid');
    expect(() => buildWebVtt([{ startMs: 0, endMs: 1, text: '\0' }], 2_000)).toThrow('NUL');
  });
});

describe('renderCacheKey', () => {
  const base = {
    rendererVersion: 'youtube-short-v2',
    sourceSha256: 'a'.repeat(64),
    motionPrompt: 'natural blink',
    locale: 'en-US',
    voiceProfileId: 'lisa-en-v1',
    voiceProfileRevision: 'rights-revision-1',
    voiceLine: 'Hello',
    clipDurationMs: 3_720,
    visualSpeechMode: 'localized-lipsync' as const,
  };

  it('is deterministic and invalidates on locale, voice or text changes', () => {
    const key = renderCacheKey(base);
    expect(renderCacheKey(base)).toBe(key);
    expect(renderCacheKey({ ...base, locale: 'fr-FR' })).not.toBe(key);
    expect(renderCacheKey({ ...base, voiceProfileId: 'lisa-en-v2' })).not.toBe(key);
    expect(renderCacheKey({ ...base, voiceProfileRevision: 'rights-revision-2' })).not.toBe(key);
    expect(renderCacheKey({ ...base, voiceLine: 'Hi' })).not.toBe(key);
  });
});
