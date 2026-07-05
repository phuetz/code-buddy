import { describe, expect, it } from 'vitest';

import { recommendPath } from '../src/renderer/utils/onboarding-steps';

describe('recommendPath', () => {
  it('prefers Ollama when available', () => {
    expect(recommendPath({ hasOllama: true }).primary).toContain('Ollama');
  });

  it('prefers OAuth login when already available', () => {
    expect(recommendPath({ hasLogin: true }).primary).toContain('OAuth');
  });

  it('falls back to login when nothing is detected', () => {
    expect(recommendPath({}).primary).toContain('connecter');
  });
});
