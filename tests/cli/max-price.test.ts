import { describe, expect, it, afterEach, vi } from 'vitest';
import { resolveMaxPriceEnv } from '../../src/cli/max-price.js';

describe('resolveMaxPriceEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('respects env variable when no explicit cli option provided', () => {
    process.env.MAX_COST = '2';
    resolveMaxPriceEnv('10.0', 'default', process.env);
    expect(process.env.MAX_COST).toBe('2');
  });

  it('sets env variable from explicit cli option', () => {
    delete process.env.MAX_COST;
    resolveMaxPriceEnv('7.5', 'cli', process.env);
    expect(process.env.MAX_COST).toBe('7.5');
  });

  it('throws an error for non-numeric cli value', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => resolveMaxPriceEnv('abc', 'cli', process.env)).toThrow('process.exit');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('attend un nombre de dollars > 0'));
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('throws an error for zero cli value', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => resolveMaxPriceEnv('0', 'cli', process.env)).toThrow('process.exit');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('attend un nombre de dollars > 0'));
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('throws an error for negative cli value', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => resolveMaxPriceEnv('-1', 'cli', process.env)).toThrow('process.exit');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('attend un nombre de dollars > 0'));
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it.each(['7usd', 'Infinity', '   '])('rejects malformed cli value %j', (value) => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => resolveMaxPriceEnv(value, 'cli', process.env)).toThrow('process.exit');
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('does nothing when no option and no env var', () => {
    delete process.env.MAX_COST;
    resolveMaxPriceEnv('10.0', 'default', process.env);
    expect(process.env.MAX_COST).toBeUndefined();
  });
});
