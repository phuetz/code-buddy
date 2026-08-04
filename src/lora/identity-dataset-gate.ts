/**
 * Fail-closed manifest gate for an identity LoRA training set.
 *
 * This complements the byte-level {@link qualityGatePassed} predicate in
 * `quality-gate.ts` (which it reuses rather than re-implements) with the
 * *identity* concerns training a person's likeness demands: rights/consent,
 * a single consistent subject, hashed references, and coverage across angles,
 * framings, expressions and lighting.
 *
 * Coverage thresholds are cautious defaults and fully configurable. They are
 * reported as warnings by default (a heuristic, not a norm); callers who want
 * to enforce them can opt into `strictCoverage`. Hard blockers are reserved for
 * things that genuinely poison an identity: missing rights/consent/approval,
 * duplicate or unhashed references, a foreign person, an inconsistent apparent
 * age, or drifting immutable traits.
 *
 * @module lora/identity-dataset-gate
 */

import { qualityGatePassed, type DatasetQualityReport } from './quality-gate.js';

export interface IdentityDatasetImage {
  path: string;
  /** SHA-256 of the image bytes (64 hex chars). */
  sha256: string;
  /** Camera-angle bucket (e.g. front, three-quarter, profile). */
  angle: string;
  /** Framing bucket (e.g. close-up, medium, full). */
  framing: string;
  /** Expression bucket (e.g. neutral, smile, serious). */
  expression: string;
  /** Lighting bucket (e.g. soft-window, hard-key, overcast). */
  lighting: string;
  /** Outfit descriptor — diversity signal. */
  outfit: string;
  /** Background descriptor — diversity signal. */
  background: string;
  /** Declared subject id — every image must be the same person. */
  personId: string;
  /** Apparent age in the image. */
  apparentAge: number;
  /** Immutable-trait fingerprint (eye color, bone structure…); required — empty is a blocker. */
  immutableTraits: string;
}

export interface IdentityDatasetManifest {
  /** The single identity this dataset trains. */
  personId: string;
  rights: {
    /** Legal/ethical basis for using the identity. */
    basis: 'consented-person' | 'synthetic-owned' | 'licensed-character';
    /** Where the material comes from (empty ⇒ blocker). */
    provenance: string;
    /** Licensing/usage rights are cleared. */
    licenseCleared: boolean;
    /** The depicted person consented to identity training; mandatory for a real person. */
    identityConsent: boolean;
    /** A human reviewed the evidence supporting the declared basis. */
    evidenceReviewed: boolean;
  };
  /** Explicit human approval of this identity for training. */
  identityApproved: boolean;
  /** Canonical immutable traits every image must respect. */
  canonicalImmutableTraits: string;
  images: IdentityDatasetImage[];
}

export interface IdentityCoverageThresholds {
  minImages: number;
  minAngles: number;
  minFramings: number;
  minExpressions: number;
  minLightings: number;
  minOutfits: number;
  minBackgrounds: number;
  /** Max tolerated spread between the youngest and oldest apparent age (years). */
  maxAgeSpread: number;
}

/** Cautious, configurable defaults — not presented as an industry norm. */
export const DEFAULT_IDENTITY_COVERAGE: IdentityCoverageThresholds = {
  minImages: 20,
  minAngles: 3,
  minFramings: 3,
  minExpressions: 3,
  minLightings: 2,
  minOutfits: 3,
  minBackgrounds: 3,
  maxAgeSpread: 6,
};

export interface IdentityDatasetAssessment {
  ok: boolean;
  imageCount: number;
  blockers: string[];
  warnings: string[];
  coverage: {
    angles: number;
    framings: number;
    expressions: number;
    lightings: number;
    outfits: number;
    backgrounds: number;
  };
  /** Paths flagged as exact SHA-256 duplicates. */
  duplicates: string[];
}

export interface AssessIdentityDatasetOptions {
  thresholds?: Partial<IdentityCoverageThresholds>;
  /** Promote angle/framing/expression/lighting coverage shortfalls to blockers. */
  strictCoverage?: boolean;
  /** Optional byte-level quality report; its predicate is reused, not copied. */
  qualityReport?: DatasetQualityReport;
}

const SHA256_RE = /^[a-f0-9]{64}$/i;
const RIGHTS_BASES = new Set(['consented-person', 'synthetic-owned', 'licensed-character']);
function isSha256(value: string): boolean {
  return SHA256_RE.test(value.trim());
}

function bucket(value: string): string {
  return value.trim().toLowerCase();
}

/** Widest apparent age we will treat as plausible for a human likeness. */
const MAX_PLAUSIBLE_AGE = 120;

/** Count thresholds must be non-negative integers; a NaN would neutralise a check. */
const COUNT_THRESHOLD_KEYS: readonly (keyof IdentityCoverageThresholds)[] = [
  'minImages',
  'minAngles',
  'minFramings',
  'minExpressions',
  'minLightings',
  'minOutfits',
  'minBackgrounds',
];

/**
 * Pure assessment of an identity dataset manifest. Never touches the filesystem
 * or throws for content problems — everything surfaces as blockers/warnings.
 */
export function assessIdentityDataset(
  manifest: IdentityDatasetManifest,
  options: AssessIdentityDatasetOptions = {},
): IdentityDatasetAssessment {
  const t = { ...DEFAULT_IDENTITY_COVERAGE, ...options.thresholds };
  const blockers: string[] = [];
  const warnings: string[] = [];

  // ── Threshold sanity — a NaN/negative/non-integer must not quietly ──
  // neutralise the check it drives (e.g. `length < NaN` is always false).
  for (const key of COUNT_THRESHOLD_KEYS) {
    const value = t[key];
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      blockers.push(`invalid-threshold:${key}`);
    }
  }
  if (!Number.isFinite(t.maxAgeSpread) || t.maxAgeSpread < 0) {
    blockers.push('invalid-threshold:maxAgeSpread');
  }

  // ── Identity anchor — the manifest must name a single, trait-pinned person ─
  if (!manifest.personId.trim()) blockers.push('missing-person-id');
  if (!manifest.canonicalImmutableTraits.trim()) blockers.push('missing-canonical-traits');

  // ── Rights / provenance / identity approval — hard blockers ─────────
  if (!manifest.rights.provenance.trim()) blockers.push('missing-provenance');
  if (!RIGHTS_BASES.has(manifest.rights.basis)) blockers.push('invalid-rights-basis');
  if (!manifest.rights.licenseCleared) blockers.push('rights-not-cleared');
  if (!manifest.rights.evidenceReviewed) blockers.push('rights-evidence-not-reviewed');
  if (manifest.rights.basis === 'consented-person' && !manifest.rights.identityConsent) {
    blockers.push('identity-consent-missing');
  }
  if (!manifest.identityApproved) blockers.push('identity-not-approved');

  // Reuse the shared byte-level predicate rather than re-deriving it.
  if (options.qualityReport && !qualityGatePassed(options.qualityReport)) {
    blockers.push('dataset-quality-gate-failed');
  }

  const images = manifest.images;
  if (images.length < t.minImages) blockers.push(`insufficient-images:${images.length}<${t.minImages}`);

  const seenSha = new Map<string, string>();
  const seenPath = new Set<string>();
  const duplicates: string[] = [];
  const angles = new Set<string>();
  const framings = new Set<string>();
  const expressions = new Set<string>();
  const lightings = new Set<string>();
  const outfits = new Set<string>();
  const backgrounds = new Set<string>();
  const canonicalTraits = manifest.canonicalImmutableTraits.trim().toLowerCase();
  let ageMin = Number.POSITIVE_INFINITY;
  let ageMax = Number.NEGATIVE_INFINITY;

  for (const img of images) {
    // A usable manifest entry needs a distinct path to key everything else on.
    const trimmedPath = img.path.trim();
    if (!trimmedPath) {
      blockers.push('empty-image-path');
    } else if (seenPath.has(trimmedPath)) {
      blockers.push(`duplicate-image-path:${img.path}`);
    } else {
      seenPath.add(trimmedPath);
    }

    if (!isSha256(img.sha256)) {
      blockers.push(`invalid-sha:${img.path}`);
    } else {
      const prior = seenSha.get(img.sha256.toLowerCase());
      if (prior) {
        duplicates.push(img.path);
        blockers.push(`duplicate-image:${img.path}`);
      } else {
        seenSha.set(img.sha256.toLowerCase(), img.path);
      }
    }

    // A dataset must depict exactly one, explicitly-identified person.
    if (!img.personId.trim()) {
      blockers.push(`empty-image-person:${img.path}`);
    } else if (img.personId !== manifest.personId) {
      blockers.push(`foreign-person:${img.path}`);
    }

    // Immutable traits are required and must not drift.
    if (!img.immutableTraits.trim()) {
      blockers.push(`missing-immutable-traits:${img.path}`);
    } else if (canonicalTraits && img.immutableTraits.trim().toLowerCase() !== canonicalTraits) {
      blockers.push(`immutable-trait-mismatch:${img.path}`);
    }

    // Apparent age must be a finite, positive, plausible number to constrain the
    // spread — a NaN/negative/implausible value poisons a single-identity LoRA.
    if (!Number.isFinite(img.apparentAge) || img.apparentAge <= 0 || img.apparentAge > MAX_PLAUSIBLE_AGE) {
      blockers.push(`invalid-apparent-age:${img.path}`);
    } else {
      ageMin = Math.min(ageMin, img.apparentAge);
      ageMax = Math.max(ageMax, img.apparentAge);
    }

    if (img.angle.trim()) angles.add(bucket(img.angle));
    if (img.framing.trim()) framings.add(bucket(img.framing));
    if (img.expression.trim()) expressions.add(bucket(img.expression));
    if (img.lighting.trim()) lightings.add(bucket(img.lighting));
    if (img.outfit.trim()) outfits.add(bucket(img.outfit));
    if (img.background.trim()) backgrounds.add(bucket(img.background));
  }

  // Inconsistent apparent age poisons a single-identity LoRA.
  if (images.length && ageMax - ageMin > t.maxAgeSpread) {
    blockers.push(`inconsistent-age-spread:${ageMax - ageMin}>${t.maxAgeSpread}`);
  }

  // Identity-critical coverage: warnings by default, blockers under strictCoverage.
  const sink = options.strictCoverage ? blockers : warnings;
  if (angles.size < t.minAngles) sink.push(`insufficient-angle-coverage:${angles.size}<${t.minAngles}`);
  if (framings.size < t.minFramings) sink.push(`insufficient-framing-coverage:${framings.size}<${t.minFramings}`);
  if (expressions.size < t.minExpressions) sink.push(`insufficient-expression-coverage:${expressions.size}<${t.minExpressions}`);
  if (lightings.size < t.minLightings) sink.push(`insufficient-lighting-coverage:${lightings.size}<${t.minLightings}`);

  // Wardrobe/background diversity is always a warning only.
  if (outfits.size < t.minOutfits) warnings.push(`low-outfit-diversity:${outfits.size}<${t.minOutfits}`);
  if (backgrounds.size < t.minBackgrounds) warnings.push(`low-background-diversity:${backgrounds.size}<${t.minBackgrounds}`);

  return {
    ok: blockers.length === 0,
    imageCount: images.length,
    blockers,
    warnings,
    coverage: {
      angles: angles.size,
      framings: framings.size,
      expressions: expressions.size,
      lightings: lightings.size,
      outfits: outfits.size,
      backgrounds: backgrounds.size,
    },
    duplicates,
  };
}
