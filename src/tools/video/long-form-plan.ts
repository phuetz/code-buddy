/** Quality and monetization-readiness gate for original long-form episodes. */

import { canonicalizeLocale } from './localized-media.js';

export interface LongFormScene {
  id: string;
  durationSeconds: number;
  narration: string;
  visualPrompt: string;
}

export interface LongFormChapter {
  id: string;
  title: string;
  scenes: LongFormScene[];
}

export interface LongFormEpisodePlan {
  schemaVersion: 1;
  episodeId: string;
  locale: string;
  title: string;
  description: string;
  chapters: LongFormChapter[];
  publication: {
    visibility: 'private';
    autoPublish: false;
    madeForKids: false;
    containsSyntheticMedia: true;
    humanReviewRequired: true;
  };
}

export interface LongFormPlanAssessment {
  ready: boolean;
  durationSeconds: number;
  narrationWords: number;
  uniqueVisualRatio: number;
  midRollEligible: boolean;
  suggestedAdBreakSeconds: number[];
  failures: string[];
}

function normalizedPrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/gu, ' ').trim();
}

export function assessLongFormPlan(plan: LongFormEpisodePlan): LongFormPlanAssessment {
  const failures: string[] = [];
  if (plan.schemaVersion !== 1) failures.push('unsupported-schema');
  try {
    canonicalizeLocale(plan.locale);
  } catch {
    failures.push('invalid-locale');
  }
  if (!plan.episodeId.trim() || !plan.title.trim() || !plan.description.trim()) {
    failures.push('missing-editorial-metadata');
  }
  if (plan.chapters.length < 5) failures.push('insufficient-chapters');

  const chapterIds = new Set<string>();
  const sceneIds = new Set<string>();
  const prompts = new Set<string>();
  let durationSeconds = 0;
  let narrationWords = 0;
  const chapterEndSeconds: number[] = [];

  for (const chapter of plan.chapters) {
    if (!chapter.id.trim() || chapterIds.has(chapter.id) || !chapter.title.trim() || !chapter.scenes.length) {
      failures.push('invalid-chapter');
    }
    chapterIds.add(chapter.id);
    for (const scene of chapter.scenes) {
      if (!scene.id.trim() || sceneIds.has(scene.id)) failures.push('duplicate-or-empty-scene-id');
      sceneIds.add(scene.id);
      if (!Number.isFinite(scene.durationSeconds) || scene.durationSeconds < 4 || scene.durationSeconds > 30) {
        failures.push('invalid-scene-duration');
      }
      if (!scene.narration.trim() || !scene.visualPrompt.trim()) failures.push('incomplete-scene');
      durationSeconds += scene.durationSeconds;
      narrationWords += scene.narration.trim().split(/\s+/u).filter(Boolean).length;
      prompts.add(normalizedPrompt(scene.visualPrompt));
    }
    chapterEndSeconds.push(durationSeconds);
  }

  if (durationSeconds < 480) failures.push('shorter-than-eight-minutes');
  if (durationSeconds > 1_200) failures.push('longer-than-twenty-minutes');
  if (sceneIds.size < 24) failures.push('insufficient-visual-scenes');
  if (narrationWords < 600) failures.push('insufficient-original-narration');
  const uniqueVisualRatio = sceneIds.size ? prompts.size / sceneIds.size : 0;
  if (uniqueVisualRatio < 0.8) failures.push('repetitive-visual-plan');
  if (
    plan.publication.visibility !== 'private' ||
    plan.publication.autoPublish !== false ||
    plan.publication.madeForKids !== false ||
    plan.publication.containsSyntheticMedia !== true ||
    plan.publication.humanReviewRequired !== true
  ) {
    failures.push('unsafe-publication-gate');
  }

  const suggestedAdBreakSeconds: number[] = [];
  let previousBreak = 0;
  for (const boundary of chapterEndSeconds.slice(0, -1)) {
    if (boundary >= 150 && boundary - previousBreak >= 150 && durationSeconds - boundary >= 90) {
      suggestedAdBreakSeconds.push(Math.round(boundary));
      previousBreak = boundary;
    }
  }

  return {
    ready: failures.length === 0,
    durationSeconds: Math.round(durationSeconds * 100) / 100,
    narrationWords,
    uniqueVisualRatio: Math.round(uniqueVisualRatio * 1_000) / 1_000,
    midRollEligible: durationSeconds >= 480,
    suggestedAdBreakSeconds,
    failures: [...new Set(failures)],
  };
}
