/** An experiment is a reviewable contract, never an instruction to edit code. */
import { z } from 'zod';

const nonempty = z.string().trim().min(1);
const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const positive = finite.positive();

export const EXPERIMENT_FICHE_SCHEMA = z.object({
  schemaVersion: z.literal(1),
  lane: z.enum(['usage', 'research']),
  problem: z.object({
    statement: nonempty,
    evidence: z.object({
      kind: z.enum(['capability-benchmark', 'fleet-failure', 'regression', 'audit-report', 'research-gap']),
      reference: nonempty,
      observedAt: z.string().datetime(),
    }).strict(),
  }).strict(),
  research: z.object({
    articleId: z.string().regex(/^(doi:10\.\d{4,9}\/.+|arxiv:\d{4}\.\d{4,5}|pmid:\d{5,10})$/i),
    method: nonempty,
  }).strict(),
  feature: z.object({
    id: nonempty,
    files: z.array(z.string().regex(/^(src|cowork|buddy-memory)\/[\w./-]+\.[\w]+$/).refine((file) => !file.split('/').includes('..'))).min(1),
  }).strict(),
  hypothesis: z.object({
    metric: nonempty,
    direction: z.enum(['increase', 'decrease']),
    minimumImprovement: positive,
  }).strict(),
  comparison: z.object({
    currentMethod: nonempty,
    proposedMethod: nonempty,
    equalBudget: z.object({
      runsPerArm: z.number().int().positive(),
      maxDurationMsPerArm: positive,
      maxCostUsdPerArm: nonnegative,
    }).strict(),
  }).strict().refine((value) => value.currentMethod !== value.proposedMethod, 'The two methods must differ'),
  acceptance: z.object({
    minResult: finite,
    maxDurationMs: positive,
    maxCostUsd: nonnegative,
  }).strict(),
}).strict();

export type ExperimentFiche = z.infer<typeof EXPERIMENT_FICHE_SCHEMA>;
export type ExperimentLane = ExperimentFiche['lane'];

/** Usage starts with an observed failure. The selected paper and method complete the fiche. */
export const USAGE_BRIEF_SCHEMA = z.object({
  schemaVersion: z.literal(1),
  lane: z.literal('usage'),
  problem: EXPERIMENT_FICHE_SCHEMA.shape.problem,
  feature: EXPERIMENT_FICHE_SCHEMA.shape.feature,
  hypothesis: EXPERIMENT_FICHE_SCHEMA.shape.hypothesis,
  comparison: z.object({
    currentMethod: nonempty,
    equalBudget: EXPERIMENT_FICHE_SCHEMA.shape.comparison.innerType().shape.equalBudget,
  }).strict(),
  acceptance: EXPERIMENT_FICHE_SCHEMA.shape.acceptance,
}).strict();
export type UsageBrief = z.infer<typeof USAGE_BRIEF_SCHEMA>;

export function parseProposalFicheInput(input: unknown): ExperimentFiche | UsageBrief {
  const complete = EXPERIMENT_FICHE_SCHEMA.safeParse(input);
  return complete.success ? complete.data : USAGE_BRIEF_SCHEMA.parse(input);
}

export function parseExperimentFiche(input: unknown): ExperimentFiche {
  return EXPERIMENT_FICHE_SCHEMA.parse(input);
}

/** Choose the lane whose reserved time budget ends closest to the target share. */
export function selectExperimentLane(
  used: { usage: number; research: number },
  config: { usageShare?: number } = {},
  nextBudgetMs = 1,
): ExperimentLane {
  const share = config.usageShare ?? 0.8;
  if (!Number.isFinite(share) || share < 0 || share > 1 ||
    !Number.isFinite(used.usage) || !Number.isFinite(used.research) ||
    used.usage < 0 || used.research < 0 || !Number.isFinite(nextBudgetMs) || nextBudgetMs <= 0) {
    throw new Error('Invalid DGM lane budget');
  }
  const next = used.usage + used.research + nextBudgetMs;
  const ifUsage = Math.abs((used.usage + nextBudgetMs) / next - share);
  const ifResearch = Math.abs(used.usage / next - share);
  return ifUsage <= ifResearch ? 'usage' : 'research';
}
