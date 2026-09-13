import { describe, expect, it } from 'vitest';
import { normalizeJson, stableStringify } from '../../src/utils/stable-json';

describe('stable JSON serialization', () => {
  it('preserves Date serialization', () => {
    const date = new Date('2026-01-02T03:04:05.000Z');
    expect(stableStringify({ when: date })).toBe('{"when":"2026-01-02T03:04:05.000Z"}');
  });

  it('preserves nested Date serialization in objects and arrays', () => {
    const date = new Date('2026-01-02T03:04:05.000Z');
    const value = { z: [{ createdAt: date }], a: { updatedAt: date } };
    expect(stableStringify(value)).toBe(
      JSON.stringify({ a: { updatedAt: date }, z: [{ createdAt: date }] }),
    );
  });

  it('serializes Dates directly in arrays', () => {
    expect(stableStringify([new Date('2026-01-02T03:04:05.000Z')])).toBe(
      '["2026-01-02T03:04:05.000Z"]',
    );
  });

  it('serializes invalid Dates as null like JSON.stringify', () => {
    expect(stableStringify({ when: new Date('invalid') })).toBe('{"when":null}');
  });

  it('sorts valid JSON recursively in normalizeJson', () => {
    expect(normalizeJson('{"z":{"b":2,"a":1},"a":[3,2,1]}')).toBe(
      '{"a":[3,2,1],"z":{"a":1,"b":2}}',
    );
  });

  it('sorts nested object keys while preserving array order', () => {
    expect(stableStringify({ z: [{ b: 2, a: 1 }], a: 0 })).toBe('{"a":0,"z":[{"a":1,"b":2}]}');
  });

  it('supports indentation', () => {
    expect(stableStringify({ b: 2, a: 1 }, 2)).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('returns invalid JSON unchanged', () => {
    const invalid = '{not-json';
    expect(normalizeJson(invalid)).toBe(invalid);
  });

  it('preserves circular object failures', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => stableStringify(circular)).toThrow(RangeError);
  });
});