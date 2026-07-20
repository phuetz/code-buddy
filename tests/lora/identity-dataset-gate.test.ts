import { describe, expect, it } from 'vitest';

import {
  DEFAULT_IDENTITY_COVERAGE,
  assessIdentityDataset,
  type IdentityDatasetImage,
  type IdentityDatasetManifest,
} from '../../src/lora/identity-dataset-gate.js';
import type { DatasetQualityReport } from '../../src/lora/quality-gate.js';

const ANGLES = ['front', 'three-quarter', 'profile'];
const FRAMINGS = ['close-up', 'medium', 'full'];
const EXPRESSIONS = ['neutral', 'smile', 'serious'];
const LIGHTINGS = ['soft-window', 'hard-key'];
const OUTFITS = ['black top', 'white blouse', 'denim jacket', 'silk dress'];
const BACKGROUNDS = ['studio', 'street', 'home', 'cafe'];

function sha(i: number): string {
  return i.toString(16).padStart(64, '0');
}

function image(i: number, overrides: Partial<IdentityDatasetImage> = {}): IdentityDatasetImage {
  return {
    path: `images/lisa-${i}.png`,
    sha256: sha(i + 1),
    angle: ANGLES[i % ANGLES.length]!,
    framing: FRAMINGS[i % FRAMINGS.length]!,
    expression: EXPRESSIONS[i % EXPRESSIONS.length]!,
    lighting: LIGHTINGS[i % LIGHTINGS.length]!,
    outfit: OUTFITS[i % OUTFITS.length]!,
    background: BACKGROUNDS[i % BACKGROUNDS.length]!,
    personId: 'lisa',
    apparentAge: 25,
    immutableTraits: 'dark eyes, oval face',
    ...overrides,
  };
}

function validManifest(): IdentityDatasetManifest {
  return {
    personId: 'lisa',
    rights: {
      basis: 'consented-person',
      provenance: 'internally generated companion set',
      licenseCleared: true,
      identityConsent: true,
      evidenceReviewed: true,
    },
    identityApproved: true,
    canonicalImmutableTraits: 'dark eyes, oval face',
    images: Array.from({ length: 24 }, (_unused, i) => image(i)),
  };
}

describe('assessIdentityDataset', () => {
  it('passes a well-covered, rights-cleared identity set (happy path)', () => {
    const r = assessIdentityDataset(validManifest());
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.coverage.angles).toBe(3);
    expect(r.imageCount).toBe(24);
  });

  it('blocks on missing rights, consent or identity approval', () => {
    const manifest = validManifest();
    manifest.rights.licenseCleared = false;
    manifest.rights.identityConsent = false;
    manifest.rights.evidenceReviewed = false;
    manifest.rights.provenance = '   ';
    manifest.identityApproved = false;
    const r = assessIdentityDataset(manifest);
    expect(r.blockers).toEqual(
      expect.arrayContaining([
        'missing-provenance',
        'rights-not-cleared',
        'rights-evidence-not-reviewed',
        'identity-consent-missing',
        'identity-not-approved',
      ]),
    );
    expect(r.ok).toBe(false);
  });

  it('accepts a reviewed synthetic-owned identity without impossible human consent', () => {
    const manifest = validManifest();
    manifest.rights.basis = 'synthetic-owned';
    manifest.rights.identityConsent = false;
    const r = assessIdentityDataset(manifest);
    expect(r.ok).toBe(true);
    expect(r.blockers).not.toContain('identity-consent-missing');
  });

  it('fails closed on an unknown rights basis', () => {
    const manifest = validManifest();
    manifest.rights.basis = 'unknown' as typeof manifest.rights.basis;
    const r = assessIdentityDataset(manifest);
    expect(r.blockers).toContain('invalid-rights-basis');
    expect(r.ok).toBe(false);
  });

  it('blocks invalid SHA-256 references and exact duplicates', () => {
    const manifest = validManifest();
    manifest.images[0]!.sha256 = 'nope';
    manifest.images[2]!.sha256 = manifest.images[1]!.sha256; // duplicate of image 1
    const r = assessIdentityDataset(manifest);
    expect(r.blockers).toContain('invalid-sha:images/lisa-0.png');
    expect(r.blockers).toContain('duplicate-image:images/lisa-2.png');
    expect(r.duplicates).toContain('images/lisa-2.png');
  });

  it('blocks a foreign person, inconsistent age and drifting immutable traits', () => {
    const manifest = validManifest();
    manifest.images[3]!.personId = 'other';
    manifest.images[4]!.apparentAge = 45; // spread 20 > 6
    manifest.images[5]!.immutableTraits = 'blue eyes, round face';
    const r = assessIdentityDataset(manifest);
    expect(r.blockers).toContain('foreign-person:images/lisa-3.png');
    expect(r.blockers).toContain('immutable-trait-mismatch:images/lisa-5.png');
    expect(r.blockers.some((b) => b.startsWith('inconsistent-age-spread:'))).toBe(true);
  });

  it('reports coverage shortfalls as warnings by default, blockers under strictCoverage', () => {
    const manifest = validManifest();
    // Collapse every image onto one angle/framing/expression/lighting bucket.
    manifest.images = manifest.images.map((img) => ({
      ...img,
      angle: 'front',
      framing: 'close-up',
      expression: 'neutral',
      lighting: 'soft-window',
    }));
    const lenient = assessIdentityDataset(manifest);
    expect(lenient.ok).toBe(true);
    expect(lenient.warnings.some((w) => w.startsWith('insufficient-angle-coverage:'))).toBe(true);

    const strict = assessIdentityDataset(manifest, { strictCoverage: true });
    expect(strict.ok).toBe(false);
    expect(strict.blockers.some((b) => b.startsWith('insufficient-angle-coverage:'))).toBe(true);
  });

  it('always keeps wardrobe/background diversity as warnings only', () => {
    const manifest = validManifest();
    manifest.images = manifest.images.map((img) => ({ ...img, outfit: 'black top', background: 'studio' }));
    const r = assessIdentityDataset(manifest, { strictCoverage: true });
    expect(r.warnings.some((w) => w.startsWith('low-outfit-diversity:'))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith('low-background-diversity:'))).toBe(true);
    expect(r.blockers.some((b) => b.startsWith('low-outfit-diversity:'))).toBe(false);
  });

  it('blocks when the dataset is too small', () => {
    const manifest = validManifest();
    manifest.images = manifest.images.slice(0, 5);
    const r = assessIdentityDataset(manifest);
    expect(r.blockers.some((b) => b.startsWith('insufficient-images:'))).toBe(true);
  });

  it('reuses the byte-level quality predicate when a report is supplied', () => {
    const failing: DatasetQualityReport = {
      ok: false,
      imageCount: 24,
      issues: [{ path: 'images/lisa-0.png', kind: 'unreadable', detail: 'boom' }],
      warnings: [],
      kept: [],
      reject: ['images/lisa-0.png'],
    };
    const r = assessIdentityDataset(validManifest(), { qualityReport: failing });
    expect(r.blockers).toContain('dataset-quality-gate-failed');
  });

  it('honours configurable thresholds', () => {
    const manifest = validManifest();
    const r = assessIdentityDataset(manifest, { thresholds: { minImages: 40 } });
    expect(r.blockers).toContain('insufficient-images:24<40');
    expect(DEFAULT_IDENTITY_COVERAGE.minImages).toBe(20);
  });

  it('blocks an empty manifest personId or empty canonical immutable traits', () => {
    const manifest = validManifest();
    manifest.personId = '  ';
    manifest.canonicalImmutableTraits = '';
    const r = assessIdentityDataset(manifest);
    expect(r.blockers).toContain('missing-person-id');
    expect(r.blockers).toContain('missing-canonical-traits');
    expect(r.ok).toBe(false);
  });

  it('blocks an empty image personId and a missing immutable-trait fingerprint', () => {
    const manifest = validManifest();
    manifest.images[1]!.personId = '   ';
    manifest.images[2]!.immutableTraits = '';
    const r = assessIdentityDataset(manifest);
    expect(r.blockers).toContain('empty-image-person:images/lisa-1.png');
    expect(r.blockers).toContain('missing-immutable-traits:images/lisa-2.png');
  });

  it('blocks empty and duplicate image paths', () => {
    const manifest = validManifest();
    manifest.images[0]!.path = '   ';
    manifest.images[2]!.path = manifest.images[1]!.path; // duplicate of image 1
    const r = assessIdentityDataset(manifest);
    expect(r.blockers).toContain('empty-image-path');
    expect(r.blockers.some((b) => b.startsWith('duplicate-image-path:'))).toBe(true);
  });

  it('blocks a NaN, negative or implausible apparent age', () => {
    const manifest = validManifest();
    manifest.images[0]!.apparentAge = Number.NaN;
    manifest.images[1]!.apparentAge = -3;
    manifest.images[2]!.apparentAge = 900;
    const r = assessIdentityDataset(manifest);
    expect(r.blockers).toContain('invalid-apparent-age:images/lisa-0.png');
    expect(r.blockers).toContain('invalid-apparent-age:images/lisa-1.png');
    expect(r.blockers).toContain('invalid-apparent-age:images/lisa-2.png');
    // A NaN age must not silently sabotage the spread check into a false pass.
    expect(r.ok).toBe(false);
  });

  it('blocks invalid thresholds so a NaN cannot neutralise a check', () => {
    const manifest = validManifest();
    const r = assessIdentityDataset(manifest, {
      thresholds: { minImages: Number.NaN, minAngles: -1, minFramings: 2.5, maxAgeSpread: Number.NaN },
    });
    expect(r.blockers).toContain('invalid-threshold:minImages');
    expect(r.blockers).toContain('invalid-threshold:minAngles');
    expect(r.blockers).toContain('invalid-threshold:minFramings');
    expect(r.blockers).toContain('invalid-threshold:maxAgeSpread');
    // The NaN minImages did not silently pass the image-count gate.
    expect(r.ok).toBe(false);
  });
});
