import { describe, expect, it } from 'vitest';

import {
  assessLongFormPlan,
  type LongFormEpisodePlan,
} from '../../../src/tools/video/long-form-plan.js';

function plan(): LongFormEpisodePlan {
  const words = Array.from({ length: 26 }, (_, index) => `word${index}`).join(' ');
  return {
    schemaVersion: 1,
    episodeId: 'why-humans-keep-imperfect-photos',
    locale: 'en-US',
    title: 'Why we keep imperfect photos',
    description: 'An original chaptered story about memory and imperfect images.',
    chapters: Array.from({ length: 5 }, (_, chapterIndex) => ({
      id: `chapter-${chapterIndex + 1}`,
      title: `Chapter ${chapterIndex + 1}`,
      scenes: Array.from({ length: 5 }, (_, sceneIndex) => ({
        id: `chapter-${chapterIndex + 1}-scene-${sceneIndex + 1}`,
        durationSeconds: 20,
        narration: `${words} chapter ${chapterIndex} scene ${sceneIndex}`,
        visualPrompt: `unique cinematic setting ${chapterIndex}-${sceneIndex}, distinct action and composition`,
      })),
    })),
    publication: {
      visibility: 'private',
      autoPublish: false,
      madeForKids: false,
      containsSyntheticMedia: true,
      humanReviewRequired: true,
    },
  };
}

describe('assessLongFormPlan', () => {
  it('accepts an original eight-minute chaptered episode and proposes natural ad breaks', () => {
    expect(assessLongFormPlan(plan())).toEqual({
      ready: true,
      durationSeconds: 500,
      narrationWords: 750,
      uniqueVisualRatio: 1,
      midRollEligible: true,
      suggestedAdBreakSeconds: [200, 400],
      failures: [],
    });
  });

  it('rejects a short repetitive mass-produced plan and unsafe publication', () => {
    const value = plan();
    value.chapters = value.chapters.slice(0, 2);
    for (const chapter of value.chapters) {
      for (const scene of chapter.scenes) {
        scene.durationSeconds = 5;
        scene.narration = 'same words';
        scene.visualPrompt = 'same template';
      }
    }
    value.publication.visibility = 'public' as 'private';
    const assessment = assessLongFormPlan(value);
    expect(assessment.ready).toBe(false);
    expect(assessment.midRollEligible).toBe(false);
    expect(assessment.failures).toEqual(expect.arrayContaining([
      'insufficient-chapters',
      'shorter-than-eight-minutes',
      'insufficient-visual-scenes',
      'insufficient-original-narration',
      'repetitive-visual-plan',
      'unsafe-publication-gate',
    ]));
  });
});
