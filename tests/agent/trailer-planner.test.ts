import { describe, expect, it, vi } from 'vitest';

import { planBookTrailer } from '../../src/agent/film/trailer-planner.js';
import type {
  BookManuscript,
  CandidateExcerpt,
} from '../../src/tools/video/book-manuscript-source.js';
import type {
  CinematicTrailerPlan,
  TrailerShot,
} from '../../src/tools/video/cinematic-trailer-plan.js';

const manuscript: BookManuscript = {
  title: 'Les Veilleurs',
  chapters: [{ file: '01.md', heading: 'Le seuil', text: '# Le seuil\n\nMara ouvre la porte.\n' }],
};

const excerpts: CandidateExcerpt[] = [{
  id: 'excerpt-001',
  text: 'Mara ouvre la porte. Une ombre traverse la chambre.',
  chapterIndex: 0,
  lineStart: 3,
  lineEnd: 3,
  manuscriptSource: { file: '01.md', locator: 'chapter:1;lines:3-3' },
}];

function shot(
  id: string,
  token: TrailerShot['token'],
  durationSeconds: number,
): TrailerShot {
  const editorial = token === 'brand' || token === 'cta';
  return {
    id,
    token,
    ...(editorial ? {} : { manuscriptSource: excerpts[0]!.manuscriptSource }),
    information: 'Une menace devient visible',
    action: 'avance',
    cameraMove: 'slow push-in',
    durationSeconds,
    characters: [],
    entryHandle: true,
    exitHandle: true,
    burnedInText: false,
    rejectionConditions: ['texte dans le cadre'],
    useCase: 'hero-shot',
  };
}

function validPlan(): CinematicTrailerPlan {
  return {
    schemaVersion: 1,
    status: 'READY_FOR_PREFLIGHT',
    contentTier: 'safe',
    book: {
      title: 'Les Veilleurs',
      genre: 'thriller fantastique',
      stagingSentence: 'We move from refuge to pursuit, seen from Mara, without revealing the watcher.',
      spoilerLimit: 'Ne pas révéler l’identité du veilleur',
      commercialAction: 'Lire Les Veilleurs',
    },
    masterDurationSeconds: 60,
    characters: [],
    shots: [
      shot('shot-01', 'hook', 3),
      shot('shot-02', 'world', 9),
      shot('shot-03', 'protagonist', 9),
      shot('shot-04', 'escalation', 9),
      shot('shot-05', 'price', 9),
      shot('shot-06', 'withheld', 9),
      shot('shot-07', 'brand', 8),
      shot('shot-08', 'cta', 4),
    ],
    overlays: [
      { timecodeSeconds: 52, text: 'Les Veilleurs', source: 'editorial', safeZone: true },
      { timecodeSeconds: 57, text: 'Découvrez le roman', source: 'editorial', safeZone: true },
    ],
    sound: {
      layers: ['ambience', 'foley', 'motif', 'speech'],
      masters: ['trailer-mix.wav'],
    },
    retention: {
      hookA: 'Une porte s’ouvre seule',
      hookB: 'Une ombre traverse la chambre',
      promise: 'Le refuge observe ses habitants',
      proofWithinThreeSeconds: 'L’ombre apparaît au hook',
      deeperPayoff: 'Mara comprend que la maison la suit',
      singleAbVariable: 'Image du hook',
    },
    cost: {
      displayedInUi: false,
      estimatedFlowCredits: 0,
      approvedCeilingFlowCredits: 0,
    },
    approvals: {
      narrativeReviewed: false,
      castingReviewed: false,
      costApproved: false,
      publicationApproved: false,
    },
    publication: {
      visibility: 'private',
      autoPublish: false,
      containsSyntheticMedia: true,
      humanReviewRequired: true,
    },
  };
}

describe('planBookTrailer', () => {
  it('accepts a valid grounded plan from an injected provider', async () => {
    const provider = vi.fn(async () => JSON.stringify(validPlan()));

    const plan = await planBookTrailer({ manuscript, excerpts, provider, durationTargetSeconds: 60 });

    expect(plan.status).toBe('READY_FOR_PREFLIGHT');
    expect(plan.shots).toHaveLength(8);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0]?.[0]).toContain('hook de 3 secondes maximum');
    expect(provider.mock.calls[0]?.[1]).toContain('chapter:1;lines:3-3');
  });

  it('makes one repair attempt and then fails when the plan stays invalid', async () => {
    const invalid = validPlan();
    invalid.shots = invalid.shots.filter((candidate) => candidate.token !== 'price');
    const provider = vi.fn(async () => JSON.stringify(invalid));

    await expect(planBookTrailer({ manuscript, excerpts, provider })).rejects.toThrow(
      /after one repair.*missing-function:price/i,
    );
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[1]?.[1]).toContain('missing-function:price');
  });

  it('rejects a hallucinated manuscript provenance after one repair', async () => {
    const hallucinated = validPlan();
    hallucinated.shots[0]!.manuscriptSource = {
      file: 'chapitre-invente.md',
      locator: 'scene:imaginaire',
    };
    const provider = vi.fn(async () => JSON.stringify(hallucinated));

    await expect(planBookTrailer({ manuscript, excerpts, provider })).rejects.toThrow(
      /unknown-manuscript-source:shot-01/i,
    );
    expect(provider).toHaveBeenCalledTimes(2);
  });
});
