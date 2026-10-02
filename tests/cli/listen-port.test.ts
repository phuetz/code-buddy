import { describe, expect, it } from 'vitest';
import { parseListenPort, resolveServerListenOptions } from '../../src/cli/listen-port.js';

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

describe('resolveServerListenOptions', () => {
  it('resolves env variables when no explicit option is provided', () => {
    const options = { port: '3000' };
    const env = { HOST: '127.0.0.1', PORT: '3917' };
    const getOptionValueSource = (key: string) => (key === 'port' ? 'default' : undefined);

    expect(resolveServerListenOptions(options, getOptionValueSource, env)).toEqual({
      host: '127.0.0.1',
      port: 3917,
    });
  });

  it('prioritizes explicit option over env variables', () => {
    const options = { port: '4000' };
    const env = { PORT: '3917' };
    const getOptionValueSource = (key: string) => (key === 'port' ? 'cli' : undefined);

    expect(resolveServerListenOptions(options, getOptionValueSource, env)).toEqual({
      host: '127.0.0.1',
      port: 4000,
    });
  });

  it('uses default values when no option and no env are provided', () => {
    const options = { port: '3000' };
    const env = {};
    const getOptionValueSource = (key: string) => (key === 'port' ? 'default' : undefined);

    expect(resolveServerListenOptions(options, getOptionValueSource, env)).toEqual({
      host: '127.0.0.1',
      port: 3000,
    });
  });

  it('throws an explicit error when env PORT is invalid', () => {
    const options = { port: '3000' };
    const env = { PORT: 'abc' };
    const getOptionValueSource = (key: string) => (key === 'port' ? 'default' : undefined);

    expect(() => resolveServerListenOptions(options, getOptionValueSource, env)).toThrow(/received "abc"/);
  });

  it('prioritizes an explicit host over HOST without opening the default listener', () => {
    expect(resolveServerListenOptions(
      { port: '3000', host: 'localhost' },
      (key) => key === 'host' ? 'cli' : 'default',
      { HOST: '0.0.0.0', PORT: '3917' },
    )).toEqual({ host: 'localhost', port: 3917 });
  });

  it('keeps the loopback default when environment values are empty', () => {
    expect(resolveServerListenOptions(
      { port: '3000' },
      () => 'default',
      { HOST: '', PORT: '' },
    )).toEqual({ host: '127.0.0.1', port: 3000 });
  });
});
