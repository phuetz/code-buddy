import { describe, expect, it } from 'vitest';
import { parseListenPort } from '../../src/cli/listen-port.js';

describe('parseListenPort', () => {
  it('accepts a port in range', () => {
    expect(parseListenPort('3000')).toBe(3000);
    expect(parseListenPort('1')).toBe(1);
    expect(parseListenPort('65535')).toBe(65535);
  });

  it('names the received value and the accepted range', () => {
    expect(() => parseListenPort('abc')).toThrow(/received "abc"/);
    expect(() => parseListenPort('-1')).toThrow(/1–65535/);
    expect(() => parseListenPort('0')).toThrow(/received "0"/);
    expect(() => parseListenPort('65536')).toThrow(/received "65536"/);
  });
});
