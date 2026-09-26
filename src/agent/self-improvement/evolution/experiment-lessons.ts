/** Durable, exact-key DGM experiment memory. Failed attempts are first-class lessons. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CollectiveKnowledgeGraph, CkgRecallResult } from '../../../memory/collective-knowledge-graph.js';
import { parseExperimentFiche, type ExperimentFiche } from './experiment-fiche.js';

const resultSchema = z.object({
  status: z.enum(['passed', 'failed']),
  before: z.number().finite(),
  after: z.number().finite(),
  durationMs: z.number().finite().nonnegative(),
  costUsd: z.number().finite().nonnegative(),
  notes: z.array(z.string()),
}).strict();

const provenanceSchema = z.object({
  at: z.string().datetime(),
  revision: z.string().trim().min(1),
  machine: z.string().trim().min(1),
  model: z.string().trim().min(1),
  conditions: z.string().trim().min(1),
}).strict();

export type ExperimentResult = z.infer<typeof resultSchema>;
export type ExperimentProvenance = z.infer<typeof provenanceSchema>;
export interface ExperimentLessonInput {
  experimentId: string;
  fiche: ExperimentFiche;
  result: ExperimentResult;
  provenance: ExperimentProvenance;
}

function ideaPrefix(fiche: ExperimentFiche): string {
  const identity = JSON.stringify([
    fiche.research.articleId.toLowerCase(), fiche.feature.id.toLowerCase(), fiche.research.method.trim().toLowerCase(),
  ]);
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 24);
  return `dgm-experiment-${digest}-`;
}

/** Exact ledger view, independent of lexical or semantic top-k ranking. */
export function hasTriedExperimentLesson(graph: CollectiveKnowledgeGraph, input: unknown): boolean {
  const fiche = parseExperimentFiche(input);
  return graph.getCurrentEntitiesByNamePrefix('lesson', ideaPrefix(fiche)).length > 0;
}

export function recordExperimentLesson(graph: CollectiveKnowledgeGraph, input: ExperimentLessonInput): CkgRecallResult {
  const fiche = parseExperimentFiche(input.fiche);
  const result = resultSchema.parse(input.result);
  const parsedProvenance = provenanceSchema.parse(input.provenance);
  // A full hexadecimal Git SHA looks like a 40-character secret to CKG redaction.
  // Twelve hexadecimal digits retain an actionable revision without bypassing redaction.
  const provenance = {
    ...parsedProvenance,
    revision: /^[0-9a-f]{40,64}$/i.test(parsedProvenance.revision)
      ? parsedProvenance.revision.slice(0, 12).toLowerCase()
      : parsedProvenance.revision,
  };
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(input.experimentId)) throw new Error('Invalid experiment id');
  const name = `${ideaPrefix(fiche)}${input.experimentId}`;
  const text = JSON.stringify({ schemaVersion: 1, experimentId: input.experimentId, fiche, result, provenance });
  const stored = graph.remember({
    type: 'lesson', name, text, source: 'dgm-experiment',
    relations: [
      { predicate: 'learned_from', targetType: 'discovery', targetName: fiche.research.articleId },
      { predicate: 'works_on', targetType: 'concept', targetName: fiche.feature.id },
    ],
  });
  if (!stored) throw new Error('Experiment lesson could not be written to the collective ledger');
  return stored;
}
