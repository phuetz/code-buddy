import { describe, expect, it } from 'vitest';
import { requireProviderText } from '../../src/plugins/bundled/response-content.js';

describe('requireProviderText', () => {
  it('returns non-empty provider text', () => {
    expect(requireProviderText('Provider', 'hello')).toBe('hello');
  });

  it('throws when provider text is missing or blank', () => {
    expect(() => requireProviderText('Provider', undefined)).toThrow(
      'Provider returned empty response content'
    );
    expect(() => requireProviderText('Provider', '  ')).toThrow(
      'Provider returned empty response content'
    );
  });
});
