import { describe, expect, it } from 'vitest';

import { parseReconciledFactText } from '../../src/memory/persistent-memory.js';

describe('autoCapture fact keys', () => {
  it('keeps a key longer than 50 characters instead of falling back to a generated id', () => {
    const key = 'preference-theme-contrast-and-typography-for-the-companion-ui';
    expect(key.length).toBeGreaterThan(50);
    const parsed = parseReconciledFactText(`${key}: sombre`);
    expect(parsed).toEqual({ key, value: 'sombre' });
  });
});
