import { describe, expect, it } from 'vitest';
import path from 'path';
import { validateFilePath } from '../../src/utils/validators.js';

describe('validateFilePath', () => {
  it('confines absolute paths when a base directory is specified', () => {
    const baseDirectory = path.resolve('fixture', 'workspace');
    expect(validateFilePath(path.join(baseDirectory, 'inside.txt'), {
      allowAbsolute: true,
      baseDirectory,
    }).ok).toBe(true);
    expect(validateFilePath(path.resolve('fixture', 'outside.txt'), {
      allowAbsolute: true,
      baseDirectory,
    }).ok).toBe(false);
  });
});
