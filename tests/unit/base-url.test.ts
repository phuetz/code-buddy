import { describe, it, expect } from 'vitest';
import { normalizeBaseURL } from '../../src/utils/base-url.js';

describe('normalizeBaseURL', () => {
  it('normalizes trailing slash', () => {
    expect(normalizeBaseURL('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
  });

  it('rejects credentials in URL', () => {
    expect(() => normalizeBaseURL('https://user:pass@example.com/v1')).toThrow(
      'Base URL must not contain credentials'
    );
  });

  it('rejects query string', () => {
    expect(() => normalizeBaseURL('https://api.example.com/v1?x=1')).toThrow(
      'Base URL must not include query parameters or fragments'
    );
  });
});
