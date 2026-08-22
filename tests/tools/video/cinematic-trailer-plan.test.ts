import { describe, expect, it } from 'vitest';

import {
  REQUIRED_NARRATIVE_TOKENS,
  compileTrailerPreview,
  validateCinematicTrailerPlan,
  type CinematicTrailerPlan,
  type TrailerShot,
} from '../../../src/tools/video/cinematic-trailer-plan.js';
import type { HybridVideoCapacity } from '../../../src/tools/video/hybrid-video-router.js';

const SHA = 'a'.repeat(64);

const capacity: HybridVideoCapacity = {
  darkstar: true,
  ministar: true,
  googleFlow: true,
  remainingFlowCredits: 25_000,
  maxFlowCreditsPerBatch: 5_000,
};

function shot(overrides: Partial<TrailerShot> & Pick<TrailerShot, 'id' | 'token' | 'durationSeconds'>): TrailerShot {
  const editorial = overrides.token === 'brand' || overrides.token === 'cta';
  return {
    information: 'a single clue appears',
    action: 'turns',
    cameraMove: 'slow push-in',
    characters: [],
    entryHandle: true,
    exitHandle: true,
    burnedInText: false,
    rejectionConditions: ['off-model face'],
    useCase: 'hero-shot',
    ...(editorial ? {} : { manuscriptSource: { file: 'ch01.md', locator: 'scene 3' } }),
    ...overrides,
  };
}

/** A fully valid plan that legitimately reaches APPROVED_FOR_PUBLICATION. */
function validPlan(): CinematicTrailerPlan {
  return {
    schemaVersion: 1,
    status: 'APPROVED_FOR_PUBLICATION',
    contentTier: 'safe',
    book: {
      title: 'Les Oubliés',
      genre: 'thriller',
      stagingSentence: 'We move from silence to a scream, seen from the child, without revealing who survives.',
      spoilerLimit: 'no death is shown',
      commercialAction: 'read the book',
    },
    masterDurationSeconds: 72,
    characters: [
      {
        id: 'lisa',
        identityVersion: 'lisa-v3',
        reference: 'refs/lisa-approved.png',
        referenceSha256: SHA,
        castingApproved: true,
      },
    ],
    shots: [
      shot({ id: 's1', token: 'hook', durationSeconds: 6, characters: ['lisa'] }),
      shot({ id: 's2', token: 'world', durationSeconds: 10 }),
      shot({ id: 's3', token: 'protagonist', durationSeconds: 10, characters: ['lisa'] }),
      shot({ id: 's4', token: 'escalation', durationSeconds: 12, characters: ['lisa'] }),
      shot({ id: 's5', token: 'price', durationSeconds: 12 }),
      shot({ id: 's6', token: 'withheld', durationSeconds: 10 }),
      shot({ id: 's7', token: 'brand', durationSeconds: 8 }),
      shot({ id: 's8', token: 'cta', durationSeconds: 4 }),
    ],
    overlays: [{ timecodeSeconds: 68, text: 'Les Oubliés', source: 'editorial', safeZone: true }],
    sound: {
      layers: ['ambience', 'foley', 'motif', 'speech'],
      masters: ['music-approved.wav', 'sound-design-approved.wav'],
    },
    retention: {
      hookA: 'the empty crib',
      hookB: 'the scream over black',
      promise: 'a disappearance you cannot explain',
      proofWithinThreeSeconds: 'the crib is shown at 0-2s',
      deeperPayoff: 'the note found later',
      singleAbVariable: 'hook image',
    },
    cost: {
      displayedInUi: true,
      estimatedFlowCredits: 800,
      approvedCeilingFlowCredits: 5_000,
      approvedBy: 'patrice',
    },
    approvals: {
      narrativeReviewed: true,
      castingReviewed: true,
      costApproved: true,
      publicationApproved: true,
    },
    publication: {
      visibility: 'private',
      autoPublish: false,
      containsSyntheticMedia: true,
      humanReviewRequired: true,
    },
  };
}

describe('validateCinematicTrailerPlan', () => {
  it('accepts a complete plan at every gate (happy path)', () => {
    const v = validateCinematicTrailerPlan(validPlan());
    expect(v.blockers).toEqual([]);
    expect(v.qualifiedStatus).toBe('APPROVED_FOR_PUBLICATION');
    expect(v.status).toBe('APPROVED_FOR_PUBLICATION');
  });

  it('exposes the required narrative tokens without revelation/false-resolution', () => {
    expect(REQUIRED_NARRATIVE_TOKENS).toContain('withheld');
    expect(REQUIRED_NARRATIVE_TOKENS).not.toContain('revelation');
    expect(REQUIRED_NARRATIVE_TOKENS).not.toContain('false-resolution');
  });

  it('downgrades a lying status fail-closed and reports narrative blockers', () => {
    const plan = validPlan();
    plan.shots = plan.shots.filter((s) => s.token !== 'price'); // drop a required function
    plan.masterDurationSeconds = 60; // keep close-ish but timeline now mismatches too
    const v = validateCinematicTrailerPlan(plan);
    expect(v.claimedStatus).toBe('APPROVED_FOR_PUBLICATION');
    expect(v.qualifiedStatus).toBe('INCOMPLETE');
    expect(v.status).toBe('INCOMPLETE');
    expect(v.blockers).toContain('missing-function:price');
  });

  it('requires a manuscript source for every narrative shot but not editorial shots', () => {
    const plan = validPlan();
    const hook = plan.shots.find((s) => s.id === 's1')!;
    delete hook.manuscriptSource;
    const v = validateCinematicTrailerPlan(plan);
    expect(v.blockers).toContain('missing-manuscript-source:s1');
  });

  it('rejects shots packing more than one action or camera move', () => {
    const plan = validPlan();
    plan.shots[0]!.action = 'turns then runs';
    plan.shots[1]!.cameraMove = 'push-in while panning';
    const v = validateCinematicTrailerPlan(plan);
    expect(v.blockers).toContain('multiple-action:s1');
    expect(v.blockers).toContain('multiple-camera-move:s2');
  });

  it('forbids text baked into the generated frame', () => {
    const plan = validPlan();
    plan.shots[0]!.burnedInText = true;
    const v = validateCinematicTrailerPlan(plan);
    expect(v.blockers).toContain('burned-in-text-forbidden:s1');
  });

  it('flags a timeline that does not sum to the master duration', () => {
    const plan = validPlan();
    plan.shots[0]!.durationSeconds = 3; // 72 -> 69, still in [60,90] but mismatched
    const v = validateCinematicTrailerPlan(plan);
    expect(v.blockers).toContain('timeline-duration-mismatch');
  });

  it('requires approved SHA-256 references for recurring characters', () => {
    const plan = validPlan();
    plan.status = 'APPROVED_FOR_GENERATION';
    plan.characters[0]!.referenceSha256 = 'not-a-hash';
    plan.characters[0]!.castingApproved = false;
    const v = validateCinematicTrailerPlan(plan);
    expect(v.blockers).toContain('invalid-character-sha:lisa');
    expect(v.blockers).toContain('character-casting-not-approved:lisa');
    expect(v.qualifiedStatus).toBe('READY_FOR_PREFLIGHT');
  });

  it('keeps generation blocked until cost is displayed AND approved within ceiling', () => {
    const plan = validPlan();
    plan.status = 'APPROVED_FOR_GENERATION';
    plan.cost.estimatedFlowCredits = 6_000; // over ceiling 5000
    plan.approvals.costApproved = false;
    const v = validateCinematicTrailerPlan(plan);
    expect(v.blockers).toContain('cost-not-approved');
    expect(v.blockers).toContain('cost-exceeds-ceiling');
    expect(v.qualifiedStatus).toBe('READY_FOR_PREFLIGHT');
  });

  it('blocks generation on NaN / negative cost estimate or ceiling', () => {
    const plan = validPlan();
    plan.status = 'APPROVED_FOR_GENERATION';
    plan.cost.estimatedFlowCredits = Number.NaN;
    const nanV = validateCinematicTrailerPlan(plan);
    expect(nanV.blockers).toContain('invalid-cost-estimate');
    // A NaN estimate must not sneak past the ceiling comparison as "not >".
    expect(nanV.blockers).not.toContain('cost-exceeds-ceiling');
    expect(nanV.qualifiedStatus).toBe('READY_FOR_PREFLIGHT');

    const negative = validPlan();
    negative.status = 'APPROVED_FOR_GENERATION';
    negative.cost.estimatedFlowCredits = -10;
    negative.cost.approvedCeilingFlowCredits = Number.NaN;
    const negV = validateCinematicTrailerPlan(negative);
    expect(negV.blockers).toContain('invalid-cost-estimate');
    expect(negV.blockers).toContain('invalid-cost-ceiling');
    expect(negV.qualifiedStatus).toBe('READY_FOR_PREFLIGHT');
  });

  it('blocks an overlay timecode that is NaN or outside [0, masterDuration]', () => {
    const plan = validPlan();
    plan.overlays = [
      { timecodeSeconds: Number.NaN, text: 'a', source: 'editorial', safeZone: true },
      { timecodeSeconds: -1, text: 'b', source: 'editorial', safeZone: true },
      { timecodeSeconds: 999, text: 'c', source: 'editorial', safeZone: true }, // > 72
    ];
    const v = validateCinematicTrailerPlan(plan);
    expect(v.blockers).toContain('overlay-timecode-out-of-range:NaN');
    expect(v.blockers).toContain('overlay-timecode-out-of-range:-1');
    expect(v.blockers).toContain('overlay-timecode-out-of-range:999');
    expect(v.qualifiedStatus).toBe('INCOMPLETE');
  });

  it('requires four DISTINCT non-empty sound layers, not repeats', () => {
    const plan = validPlan();
    plan.sound.layers = ['ambience', 'ambience', 'AMBIENCE', '  ']; // one real layer
    const v = validateCinematicTrailerPlan(plan);
    expect(v.blockers).toContain('incomplete-sound-layers');
    expect(v.qualifiedStatus).toBe('INCOMPLETE');
  });

  it('blocks empty and duplicate character declarations', () => {
    const plan = validPlan();
    plan.characters = [
      { id: '  ', identityVersion: 'v', reference: 'r', referenceSha256: SHA, castingApproved: true },
      { id: 'lisa', identityVersion: 'lisa-v3', reference: 'refs/lisa.png', referenceSha256: SHA, castingApproved: true },
      { id: 'lisa', identityVersion: 'lisa-v3', reference: 'refs/lisa.png', referenceSha256: SHA, castingApproved: true },
    ];
    const v = validateCinematicTrailerPlan(plan);
    expect(v.blockers).toContain('empty-character-id');
    expect(v.blockers).toContain('duplicate-character-declaration:lisa');
  });

  it('does not treat a character repeated within one shot as recurring', () => {
    const plan = validPlan();
    plan.status = 'APPROVED_FOR_GENERATION';
    // "bob" declared but appears twice in ONE shot only — not recurring across shots.
    plan.characters.push({
      id: 'bob',
      identityVersion: '',
      reference: '',
      referenceSha256: 'not-a-hash',
      castingApproved: false,
    });
    plan.shots[1]!.characters = ['bob', 'bob'];
    const v = validateCinematicTrailerPlan(plan);
    // Deduped to a single appearance ⇒ no recurring-identity blockers for bob.
    expect(v.blockers.some((b) => b.endsWith(':bob'))).toBe(false);
  });

  it('flags a character used in shots but never declared', () => {
    const plan = validPlan();
    plan.status = 'APPROVED_FOR_GENERATION';
    plan.shots[1]!.characters = ['ghost'];
    const v = validateCinematicTrailerPlan(plan);
    expect(v.blockers).toContain('undeclared-character:ghost');
  });

  it('always surfaces narrative/structural blockers even when the claim is INCOMPLETE', () => {
    const plan = validPlan();
    plan.status = 'INCOMPLETE';
    plan.shots = plan.shots.filter((s) => s.token !== 'price');
    const v = validateCinematicTrailerPlan(plan);
    expect(v.claimedStatus).toBe('INCOMPLETE');
    // Diagnostic narrative blockers are visible despite the humble claim.
    expect(v.blockers).toContain('missing-function:price');
  });

  it('accepts an unknown / malformed value without throwing (null and {})', () => {
    const nullV = validateCinematicTrailerPlan(null);
    expect(nullV.status).toBe('INCOMPLETE');
    expect(nullV.qualifiedStatus).toBe('INCOMPLETE');
    expect(nullV.blockers).toContain('malformed-plan');

    const emptyV = validateCinematicTrailerPlan({});
    expect(emptyV.status).toBe('INCOMPLETE');
    expect(emptyV.blockers).toContain('malformed-plan:book');
    expect(emptyV.blockers).toContain('malformed-plan:shots');
    // Business problems that survive coercion are not masked.
    expect(emptyV.blockers).toContain('missing-book-metadata');
  });

  it('treats publication approval as a separate gate', () => {
    const plan = validPlan();
    plan.approvals.publicationApproved = false;
    const v = validateCinematicTrailerPlan(plan);
    // Generation is fully met, only publication is missing.
    expect(v.qualifiedStatus).toBe('APPROVED_FOR_GENERATION');
    expect(v.blockers).toContain('publication-not-approved');
  });

  it('enforces private visibility and autoPublish false', () => {
    const plan = validPlan();
    // Deliberately unsafe publication to prove the gate bites (cast around the literal type).
    plan.publication = {
      visibility: 'public',
      autoPublish: true,
      containsSyntheticMedia: true,
      humanReviewRequired: true,
    } as unknown as CinematicTrailerPlan['publication'];
    const v = validateCinematicTrailerPlan(plan);
    expect(v.blockers).toContain('unsafe-publication-gate');
  });

  it('rejects a non-safe content tier for advertiser-facing trailers', () => {
    const plan = validPlan();
    plan.contentTier = 'sensual';
    const v = validateCinematicTrailerPlan(plan);
    expect(v.blockers).toContain('non-safe-trailer-tier:sensual');
    expect(v.qualifiedStatus).toBe('INCOMPLETE');
  });
});

describe('compileTrailerPreview', () => {
  it('estimates and distributes without ever authorizing execution or publication', () => {
    const preview = compileTrailerPreview(validPlan(), capacity);
    expect(preview.executionAuthorized).toBe(false);
    expect(preview.publicationAuthorized).toBe(false);
    expect(preview.readyForGeneration).toBe(true);
    expect(preview.readyForPublication).toBe(true);
    expect(preview.requests).toHaveLength(8);
    expect(preview.routing.routes).toHaveLength(8);
    expect(preview.routing.estimatedFlowCredits).toBeGreaterThan(0);
  });

  it('propagates the plan content tier into hybrid requests and stays unauthorized when incomplete', () => {
    const plan = validPlan();
    plan.shots = plan.shots.slice(0, 4); // narrative incomplete
    plan.masterDurationSeconds = 38;
    const preview = compileTrailerPreview(plan, capacity);
    expect(preview.executionAuthorized).toBe(false);
    expect(preview.readyForGeneration).toBe(false);
    expect(preview.requests.every((r) => r.contentTier === 'safe')).toBe(true);
    expect(preview.blockers.length).toBeGreaterThan(0);
  });

  it('never throws on a malformed / unknown plan; yields empty requests and routing', () => {
    for (const bad of [null, {}, 42, 'nope', []] as unknown[]) {
      const preview = compileTrailerPreview(bad, capacity);
      expect(preview.executionAuthorized).toBe(false);
      expect(preview.publicationAuthorized).toBe(false);
      expect(preview.readyForGeneration).toBe(false);
      expect(preview.readyForPublication).toBe(false);
      expect(preview.requests).toEqual([]);
      expect(preview.routing.routes).toEqual([]);
      expect(preview.status).toBe('INCOMPLETE');
      expect(preview.blockers.length).toBeGreaterThan(0);
    }
  });

  it('never throws when the router has no available engine — surfaces a diagnostic blocker', () => {
    const noEngines: HybridVideoCapacity = {
      darkstar: false,
      ministar: false,
      googleFlow: false,
      remainingFlowCredits: 0,
      maxFlowCreditsPerBatch: 0,
    };
    const preview = compileTrailerPreview(validPlan(), noEngines);
    expect(preview.routing.routes).toEqual([]);
    expect(preview.readyForGeneration).toBe(false);
    expect(preview.readyForPublication).toBe(false);
    expect(preview.blockers.some((b) => b.startsWith('routing-unavailable:'))).toBe(true);
  });

  it('blocks when the actually-routed cost exceeds the approved ceiling', () => {
    const plan = validPlan();
    // The declared estimate is honest against a low ceiling, so validation passes…
    plan.cost.estimatedFlowCredits = 200;
    plan.cost.approvedCeilingFlowCredits = 300;
    const gateOnly = validateCinematicTrailerPlan(plan);
    expect(gateOnly.qualifiedStatus).toBe('APPROVED_FOR_PUBLICATION');
    // …but the router distributes ~800 credits, which busts the 300 ceiling.
    const preview = compileTrailerPreview(plan, capacity);
    expect(preview.routing.estimatedFlowCredits).toBeGreaterThan(300);
    expect(preview.blockers.some((b) => b.startsWith('routed-cost-exceeds-ceiling:'))).toBe(true);
    expect(preview.readyForGeneration).toBe(false);
    expect(preview.readyForPublication).toBe(false);
  });
});
