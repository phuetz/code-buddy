import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AudioReader speak format', () => {
  it('does not hard-code response_format wav in speakWithAudioReader', () => {
    const source = readFileSync(
      new URL('../../src/input/text-to-speech.ts', import.meta.url),
      'utf8',
    );
    const start = source.indexOf('private async speakWithAudioReader');
    const end = source.indexOf('private async playAudio', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body).not.toMatch(/response_format:\s*'wav'/);
    expect(body).toMatch(/response_format:\s*format/);
  });
});
