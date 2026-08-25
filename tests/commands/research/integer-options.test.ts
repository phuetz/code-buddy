import { describe, expect, it } from 'vitest';
import { parseClampedInteger } from '../../../src/commands/research/index.js';

describe('research integer options', () => {
  it('still clamps numeric values into the documented range', () => {
    expect(parseClampedInteger('0', 5, 1, 20, '--workers')).toBe(1);
    expect(parseClampedInteger('99', 5, 1, 20, '--workers')).toBe(20);
    expect(parseClampedInteger('-8', 15, 1, undefined, '--rounds')).toBe(1);
  });

  it('rejects non-integers with the received value and the accepted range', () => {
    expect(() => parseClampedInteger('abc', 5, 1, 20, '--workers')).toThrow(
      '--workers must be an integer in 1–20 (received "abc")',
    );
    expect(() => parseClampedInteger('1.5', 5, 1, 250, '--items')).toThrow(/received "1.5"/);
  });
});
