import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  VARIATION_BUCKETS,
  bucketsForPrompt,
  buildIdentityManifest,
  canonicalImmutableTraits,
  collectCandidates,
  mapRightsBasis,
  parseApparentAge,
  runByteGate,
  type CandidateInput,
} from '../../../scripts/darkstar/build-identity-manifest.js';
import { VARIATIONS } from '../../../scripts/darkstar/generate-krea2-identity-dataset.js';
import {
  DEFAULT_IDENTITY_COVERAGE,
  assessIdentityDataset,
} from '../../../src/lora/identity-dataset-gate.js';

const HELD_IDS = ['lisa_identity_010', 'lisa_identity_018'];
const HELD_INDEXES = [9, 17];

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function candidateFor(index: number, overrides: Partial<CandidateInput['sidecar']> = {}): CandidateInput {
  const bytes = Buffer.from(`candidate-${index}`);
  return {
    sidecar: {
      id: `lisa_identity_${String(index + 1).padStart(3, '0')}`,
      prompt: VARIATIONS[index]!,
      outputSha256: sha256(bytes),
      subjectId: 'lisa',
      claimedIdentityRightsBasis: 'synthetic-owned',
      workflowRevision: 'krea2-identity-edit-v1.2.1-r64',
      referenceSha256: 'c'.repeat(64),
      ...overrides,
    },
    imagePath: `/data/lisa_identity_${String(index + 1).padStart(3, '0')}.png`,
    imageSha256: sha256(bytes),
  };
}

const BUILD_OPTIONS = { apparentAge: 25, licenseCleared: false, identityConsent: false };

describe('VARIATION_BUCKETS', () => {
  it('is aligned index-for-index with the generator prompts', () => {
    expect(VARIATION_BUCKETS).toHaveLength(VARIATIONS.length);
    for (const buckets of VARIATION_BUCKETS) {
      for (const value of Object.values(buckets)) {
        expect(value.trim()).not.toBe('');
      }
    }
  });

  it.each([
    ['full table', VARIATION_BUCKETS.map((_, index) => index)],
    ['without the held candidates', VARIATION_BUCKETS.map((_, index) => index).filter((i) => !HELD_INDEXES.includes(i))],
  ])('meets strict coverage thresholds (%s)', (_label, indexes) => {
    const t = DEFAULT_IDENTITY_COVERAGE;
    const distinct = (key: keyof (typeof VARIATION_BUCKETS)[number]) =>
      new Set(indexes.map((i) => VARIATION_BUCKETS[i]![key])).size;
    expect(indexes.length).toBeGreaterThanOrEqual(t.minImages);
    expect(distinct('angle')).toBeGreaterThanOrEqual(t.minAngles);
    expect(distinct('framing')).toBeGreaterThanOrEqual(t.minFramings);
    expect(distinct('expression')).toBeGreaterThanOrEqual(t.minExpressions);
    expect(distinct('lighting')).toBeGreaterThanOrEqual(t.minLightings);
    expect(distinct('outfit')).toBeGreaterThanOrEqual(t.minOutfits);
    expect(distinct('background')).toBeGreaterThanOrEqual(t.minBackgrounds);
  });

  it('matches a sidecar by exact prompt, not by position', () => {
    expect(bucketsForPrompt(VARIATIONS[5]!)).toEqual(VARIATION_BUCKETS[5]);
    expect(bucketsForPrompt('A totally different prompt.')).toBeUndefined();
  });
});

describe('mapRightsBasis', () => {
  it.each([
    ['synthetic-owned', 'synthetic-owned'],
    ['consented-person', 'consented-person'],
    ['licensed', 'licensed-character'],
    ['licensed-character', 'licensed-character'],
  ] as const)('maps %s → %s', (claimed, expected) => {
    expect(mapRightsBasis(claimed)).toBe(expected);
  });

  it('refuses to normalise an unverifiable claim', () => {
    expect(mapRightsBasis('unverified')).toBeUndefined();
    expect(mapRightsBasis('')).toBeUndefined();
  });
});

describe('canonicalImmutableTraits', () => {
  it('keeps only immutable fragments from the avatar bible identity', () => {
    const traits = canonicalImmutableTraits();
    expect(traits).toContain('brunette hair');
    expect(traits).toContain('dark brown eyes');
    expect(traits).toContain('olive warm skin');
    expect(traits).not.toContain('ohwx');
    expect(traits).not.toContain('85mm');
    expect(traits).not.toContain('dewy');
  });
});

describe('parseApparentAge', () => {
  it('accepts a plausible age and rejects the rest', () => {
    expect(parseApparentAge('25')).toBe(25);
    for (const bad of ['0', '-3', 'NaN', '999', '']) {
      expect(() => parseApparentAge(bad)).toThrow(/apparent-age/);
    }
  });
});

describe('buildIdentityManifest', () => {
  it('assembles a gate-shaped manifest from consistent candidates', () => {
    const { manifest, problems } = buildIdentityManifest([candidateFor(0), candidateFor(1)], BUILD_OPTIONS);
    expect(problems).toEqual([]);
    expect(manifest.personId).toBe('lisa');
    expect(manifest.rights.basis).toBe('synthetic-owned');
    expect(manifest.rights.provenance).toContain('krea2-identity-edit-v1.2.1-r64');
    expect(manifest.images).toHaveLength(2);
    expect(manifest.images[0]).toMatchObject({
      ...VARIATION_BUCKETS[0],
      personId: 'lisa',
      apparentAge: 25,
      immutableTraits: manifest.canonicalImmutableTraits,
    });
  });

  it('keeps human approvals false unless a named approver is given', () => {
    const closed = buildIdentityManifest([candidateFor(0)], BUILD_OPTIONS).manifest;
    expect(closed.rights.licenseCleared).toBe(false);
    expect(closed.rights.evidenceReviewed).toBe(false);
    expect(closed.identityApproved).toBe(false);

    const approved = buildIdentityManifest([candidateFor(0)], {
      ...BUILD_OPTIONS,
      licenseCleared: true,
      evidenceReviewedBy: 'patrice',
      identityApprovedBy: 'patrice',
    }).manifest;
    expect(approved.rights.licenseCleared).toBe(true);
    expect(approved.rights.evidenceReviewed).toBe(true);
    expect(approved.identityApproved).toBe(true);
  });

  it('flags a hash mismatch and drops the image instead of trusting the sidecar', () => {
    const tampered = candidateFor(0);
    tampered.imageSha256 = sha256(Buffer.from('other-bytes'));
    const { manifest, problems } = buildIdentityManifest([tampered, candidateFor(1)], BUILD_OPTIONS);
    expect(problems).toContain('sha-mismatch:lisa_identity_001');
    expect(manifest.images).toHaveLength(1);
  });

  it('flags unknown variations, mixed subjects and unmappable rights bases', () => {
    const foreign = candidateFor(1, { subjectId: 'other', claimedIdentityRightsBasis: 'unverified' });
    const strange = candidateFor(2, { prompt: 'An unknown prompt.' });
    const { problems } = buildIdentityManifest([candidateFor(0), foreign, strange], BUILD_OPTIONS);
    expect(problems).toEqual(
      expect.arrayContaining([
        'mixed-subjects:lisa,other',
        'mixed-rights-bases:synthetic-owned,unverified',
        'unknown-variation:lisa_identity_003',
      ]),
    );
    expect(buildIdentityManifest([], BUILD_OPTIONS).problems).toContain('no-candidates');
  });
});

describe('filesystem integration (real files, no mocks)', () => {
  let dir: string;

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function writeCandidate(index: number, bytes: Buffer): Promise<void> {
    const id = `lisa_identity_${String(index + 1).padStart(3, '0')}`;
    await fs.writeFile(path.join(dir, `${id}.png`), bytes);
    await fs.writeFile(path.join(dir, `${id}.txt`), `ohwx lisa, ${VARIATIONS[index]!}\n`);
    await fs.writeFile(
      path.join(dir, `${id}.json`),
      JSON.stringify({
        id,
        prompt: VARIATIONS[index]!,
        outputSha256: sha256(bytes),
        subjectId: 'lisa',
        claimedIdentityRightsBasis: 'synthetic-owned',
      }),
    );
  }

  it('collects candidates, excludes held ids by default and reinstates on request', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'identity-manifest-test-'));
    await writeCandidate(0, Buffer.alloc(9000, 1));
    await writeCandidate(9, Buffer.alloc(9000, 2));
    await fs.writeFile(
      path.join(dir, 'ai-preflight.json'),
      JSON.stringify({ visualRecommendation: { holdForHumanDecision: [HELD_IDS[0]] } }),
    );

    const excluded = await collectCandidates(dir);
    expect(excluded.problems).toEqual([]);
    expect(excluded.excludedHeld).toEqual([HELD_IDS[0]]);
    expect(excluded.candidates.map((c) => c.sidecar.id)).toEqual(['lisa_identity_001']);

    const reinstated = await collectCandidates(dir, new Set([HELD_IDS[0]!]));
    expect(reinstated.excludedHeld).toEqual([]);
    expect(reinstated.candidates).toHaveLength(2);
    // Hashes are recomputed from real bytes, so the downstream gate can trust them.
    const { manifest, problems } = buildIdentityManifest(reinstated.candidates, BUILD_OPTIONS);
    expect(problems).toEqual([]);
    expect(assessIdentityDataset(manifest, { thresholds: { minImages: 2 } }).blockers).toEqual([
      'rights-not-cleared',
      'rights-evidence-not-reviewed',
      'identity-not-approved',
    ]);
  });

  it('detects tampered bytes end-to-end through the real hash', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'identity-manifest-test-'));
    await writeCandidate(0, Buffer.alloc(9000, 1));
    await fs.writeFile(path.join(dir, 'ai-preflight.json'), JSON.stringify({}));
    await fs.writeFile(
      path.join(dir, 'lisa_identity_001.png'),
      Buffer.alloc(9000, 9), // tamper after the sidecar recorded its hash
    );
    const collected = await collectCandidates(dir);
    const { problems } = buildIdentityManifest(collected.candidates, BUILD_OPTIONS);
    expect(problems).toContain('sha-mismatch:lisa_identity_001');
  });

  it('reports a missing preflight and incomplete candidates instead of guessing', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'identity-manifest-test-'));
    await writeCandidate(0, Buffer.alloc(9000, 1));
    await fs.rm(path.join(dir, 'lisa_identity_001.txt'));
    const collected = await collectCandidates(dir);
    expect(collected.problems).toEqual(
      expect.arrayContaining(['missing-or-invalid-ai-preflight', 'missing-caption:lisa_identity_001']),
    );
    expect(collected.candidates).toEqual([]);
  });

  it('runs the byte gate on exactly the selected files', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'identity-manifest-test-'));
    const a = path.join(dir, 'a.png');
    const b = path.join(dir, 'b.png');
    const c = path.join(dir, 'held.png');
    await fs.writeFile(a, Buffer.alloc(9000, 1));
    await fs.writeFile(b, Buffer.alloc(9000, 2));
    await fs.writeFile(c, Buffer.alloc(9000, 3));
    const report = await runByteGate([a, b]);
    expect(report.ok).toBe(true);
    expect(report.imageCount).toBe(2);

    const d = path.join(dir, 'dupe-of-b.png');
    await fs.writeFile(d, Buffer.alloc(9000, 2)); // same bytes as b under another name
    const withDuplicate = await runByteGate([a, b, d]);
    expect(withDuplicate.issues.some((issue) => issue.kind === 'duplicate')).toBe(true);
  });
});
