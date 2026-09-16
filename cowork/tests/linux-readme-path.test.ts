import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Cowork README path on Linux', () => {
  it('exposes README.md so a clone following getting-started finds the documented file', () => {
    // Proven GK1: the file on disk is readme.md. Linux is case-sensitive, so
    // `cat cowork/README.md` (the name getting-started / GitHub convention
    // use) fails for an unknown installing from source.
    const coworkDir = process.cwd();
    expect(fs.existsSync(path.join(coworkDir, 'README.md'))).toBe(true);
  });
});
