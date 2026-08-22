import { describe, expect, it } from 'vitest';

import {
  buildPlatePrompt,
  SIGNATURE_LOCATIONS,
  type SignatureLocationAngle,
  type SignatureLocationId,
} from '../../src/companion/signature-locations.js';

const EXPECTED_LOCATIONS: SignatureLocationId[] = [
  'european-street-goldenhour',
  'stone-staircase',
  'balustrade-terrace',
  'cozy-loft-interior',
  'corner-cafe',
  'rooftop-dusk',
];

const VALID_ANGLES: SignatureLocationAngle[] = [
  'wide-establishing',
  'medium-frontal',
  'threequarter',
  'detail',
];

describe('signature location catalog', () => {
  it('contains all six complete canonical locations', () => {
    expect(Object.keys(SIGNATURE_LOCATIONS)).toEqual(EXPECTED_LOCATIONS);
    for (const locationId of EXPECTED_LOCATIONS) {
      const location = SIGNATURE_LOCATIONS[locationId];
      expect(location.locationId).toBe(locationId);
      expect(location.label).not.toBe('');
      expect(location.description.split(/[.!?](?:\s|$)/u).filter(Boolean)).toHaveLength(2);
      expect(location.angles.length).toBeGreaterThanOrEqual(3);
      expect(location.angles.length).toBeLessThanOrEqual(4);
      expect(location.paletteTag).not.toBe('');
    }
  });

  it('uses only canonical angles and valid per-angle focal lengths', () => {
    for (const location of Object.values(SIGNATURE_LOCATIONS)) {
      for (const angle of location.angles) {
        expect(VALID_ANGLES).toContain(angle);
        expect(['35mm', '50mm', '85mm']).toContain(location.focal[angle]);
      }
    }
  });

  it('reuses each frozen lighting specification exactly for every angle', () => {
    for (const location of Object.values(SIGNATURE_LOCATIONS)) {
      const prompts = location.angles.map((angle) => buildPlatePrompt(location.locationId, angle));
      for (const prompt of prompts) expect(prompt).toContain(location.lightingSpec);
      expect(new Set(prompts.map((prompt) => location.lightingSpec && prompt.includes(location.lightingSpec))).size).toBe(1);
    }
  });

  it('builds empty-scene prompts with no character vocabulary', () => {
    for (const location of Object.values(SIGNATURE_LOCATIONS)) {
      for (const angle of location.angles) {
        const prompt = buildPlatePrompt(location.locationId, angle);
        expect(prompt).toContain('empty scene, no people');
        const withoutRequiredNegative = prompt.replace('no people', '');
        expect(withoutRequiredNegative).not.toMatch(/\b(?:woman|women|man|men|person|people|girl|boy|character|subject|model)\b/iu);
        expect(prompt).toContain(`simulated ${location.focal[angle]} photographic lens`);
        expect(prompt).toContain('subtle fine photographic grain');
        expect(prompt).toContain('no text');
        expect(prompt).toContain('no moving vehicles');
      }
    }
  });

  it('is deterministic for every location and angle', () => {
    for (const location of Object.values(SIGNATURE_LOCATIONS)) {
      for (const angle of location.angles) {
        expect(buildPlatePrompt(location.locationId, angle)).toBe(buildPlatePrompt(location.locationId, angle));
      }
    }
  });
});
