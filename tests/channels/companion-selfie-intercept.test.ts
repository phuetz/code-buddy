import { describe, expect, it } from 'vitest';

import { shouldUseCompanionChannelProfile } from '../../src/channels/companion-channel-profile.js';
import { isLisaSelfieRequest } from '../../src/companion/lisa-selfie.js';

describe('companion channel selfie intercept contract', () => {
  it('companion profile is on for a photo request when the persona is set', () => {
    expect(shouldUseCompanionChannelProfile({
      text: 'Envoie-moi une photo de toi',
      env: { CODEBUDDY_COMPANION_PERSONA: 'copine' },
    })).toBe(true);
  });

  it('companion profile stays off without persona or explicit profile (byte-identical)', () => {
    expect(shouldUseCompanionChannelProfile({
      text: 'Envoie-moi une photo de toi',
      env: {},
    })).toBe(false);
  });

  it('photo-of-you phrases are classified before any LLM turn', () => {
    expect(isLisaSelfieRequest('Envoie-moi une photo de toi')).toBe(true);
    expect(isLisaSelfieRequest('Send me a picture of you')).toBe(true);
    expect(isLisaSelfieRequest('Génère une image de paysage')).toBe(false);
  });
});
