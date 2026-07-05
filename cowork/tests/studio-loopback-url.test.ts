import { describe, expect, it } from 'vitest';
import { isLoopbackUrl } from '../src/renderer/components/studio/utils/loopback-url.js';

describe('isLoopbackUrl', () => {
  it('accepts http(s) loopback URLs', () => {
    expect(isLoopbackUrl('http://localhost:5173')).toBe(true);
    expect(isLoopbackUrl('https://127.0.0.1:5173/app')).toBe(true);
    expect(isLoopbackUrl('http://127.42.0.9:3000')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:5173')).toBe(true);
  });

  it('rejects non-loopback and non-http URLs', () => {
    expect(isLoopbackUrl('https://example.com')).toBe(false);
    expect(isLoopbackUrl('file:///tmp/index.html')).toBe(false);
    expect(isLoopbackUrl('http://192.168.1.10:5173')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
  });
});
