import { describe, it, expect } from 'vitest';
import { computeAutogrowHeight } from '../src/renderer/hooks/use-textarea-autogrow';

describe('computeAutogrowHeight', () => {
  const opts = { minPx: 44, maxPx: 200 };

  it('returns minPx when scrollHeight is below the floor', () => {
    expect(computeAutogrowHeight(20, opts)).toBe(44);
    expect(computeAutogrowHeight(0, opts)).toBe(44);
  });

  it('returns scrollHeight as-is between min and max', () => {
    expect(computeAutogrowHeight(80, opts)).toBe(80);
    expect(computeAutogrowHeight(150, opts)).toBe(150);
  });

  it('caps at maxPx when scrollHeight exceeds the ceiling', () => {
    expect(computeAutogrowHeight(250, opts)).toBe(200);
    expect(computeAutogrowHeight(2000, opts)).toBe(200);
  });

  it('handles edge cases at exact boundaries', () => {
    expect(computeAutogrowHeight(44, opts)).toBe(44);
    expect(computeAutogrowHeight(200, opts)).toBe(200);
    expect(computeAutogrowHeight(45, opts)).toBe(45);
    expect(computeAutogrowHeight(199, opts)).toBe(199);
  });

  it('respects custom min/max', () => {
    expect(computeAutogrowHeight(50, { minPx: 60, maxPx: 100 })).toBe(60);
    expect(computeAutogrowHeight(80, { minPx: 60, maxPx: 100 })).toBe(80);
    expect(computeAutogrowHeight(120, { minPx: 60, maxPx: 100 })).toBe(100);
  });
});
