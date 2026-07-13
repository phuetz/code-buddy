import { getLessonCandidateQueue, type LessonCandidate } from '../agent/lesson-candidate-queue.js';
import type { ProvenOutcomeRecord } from './proven-outcome-memory.js';

/**
 * Feed a proven outcome into the existing human-review learning loop. Kept in
 * a separate module so read-only Cowork outcome inspection does not pull the
 * lesson/skill parser stack into Electron's main bundle.
 */
export function proposeLessonFromProvenOutcome(
  outcome: ProvenOutcomeRecord,
  workDir: string,
): { candidate: LessonCandidate; deduped: boolean } {
  const criteria = outcome.criteria.map((criterion) => criterion.title).join('; ');
  const artifactNote = outcome.artifacts.length > 0
    ? ` Content-addressed evidence: ${outcome.artifacts.map((artifact) => artifact.id).join(', ')}.`
    : '';
  return getLessonCandidateQueue(workDir).propose({
    category: 'INSIGHT',
    content:
      `Proven outcome for "${outcome.goal}"` +
      (criteria ? ` — verified criteria: ${criteria}.` : '.') +
      artifactNote,
    context: 'Code Buddy 2.0 verified outcome',
    source: 'self_observed',
    provenance: {
      outcomeId: outcome.id,
      note: `Generated only after proof coverage reached 100% (trust ${outcome.trustScore.toFixed(2)}).`,
      pedagogicalValue: outcome.trustScore,
      valueFactors: {
        proofCoverage: outcome.criteria.length > 0 ? 1 : 0.8,
        trust: outcome.trustScore,
      },
    },
  });
}
