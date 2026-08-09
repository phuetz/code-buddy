/**
 * Council conductor — capability requirements, panel diversity, complementary
 * roles and their assignment to ranked candidates.
 *
 * @module council/conductor
 */

import type { ModelScoreboard } from '../fleet/model-scoreboard.js';
import type { ModelStrength } from '../fleet/types.js';
import type { CouncilConductorPlan, CouncilRole, RankedCandidate } from './types.js';

export const TASK_REQUIRES: Record<string, ModelStrength[]> = {
  code: ['code', 'reasoning'],
  reasoning: ['reasoning', 'thinking'],
  french: ['french', 'reasoning'],
  vision: ['vision'],
  general: ['reasoning', 'fast'],
};

export function matchScore(strengths: ModelStrength[], required: ModelStrength[]): number {
  if (required.length === 0) return 0.5;
  const have = new Set(strengths);
  const hits = required.filter((r) => have.has(r)).length;
  return hits / required.length;
}

/** Pick top-K, favouring distinct providers for genuine diversity. */
export function pickDiverse(ranked: RankedCandidate[], k: number): RankedCandidate[] {
  const picked: RankedCandidate[] = [];
  const seen = new Set<string>();
  for (const r of ranked) {
    if (picked.length >= k) break;
    if (seen.has(r.c.provider)) continue;
    seen.add(r.c.provider);
    picked.push(r);
  }
  for (const r of ranked) {
    if (picked.length >= k) break;
    if (!picked.includes(r)) picked.push(r);
  }
  return picked;
}

export function assignCouncilRolesToCandidates(
  picked: RankedCandidate[],
  roles: CouncilRole[],
  taskType: string,
  scoreboard: Pick<ModelScoreboard, 'roleScore'>,
): RankedCandidate[] {
  const localRoles = roles.slice(0, picked.length);
  if (picked.length < 2 || localRoles.length < 2) return picked;

  const candidateIndexes = new Map(picked.map((candidate, index) => [candidate, index]));
  const scoreMatrix = localRoles.map((role) =>
    picked.map((candidate) => scoreboard.roleScore(taskType, role.id, candidate.c.model)),
  );
  const roleScore = (ordered: RankedCandidate[]): number =>
    ordered.reduce((sum, candidate, index) => {
      const candidateIndex = candidateIndexes.get(candidate);
      return sum + (candidateIndex === undefined ? 0 : (scoreMatrix[index]?.[candidateIndex] ?? 0));
    }, 0);

  let best = picked;
  let bestScore = roleScore(picked);
  if (picked.length <= 6) {
    const remaining = [...picked];
    const current: RankedCandidate[] = [];
    const visit = (): void => {
      if (current.length === picked.length) {
        const score = roleScore(current);
        if (score > bestScore + Number.EPSILON) {
          best = [...current];
          bestScore = score;
        }
        return;
      }
      for (let i = 0; i < remaining.length; i++) {
        const [candidate] = remaining.splice(i, 1);
        current.push(candidate!);
        visit();
        current.pop();
        remaining.splice(i, 0, candidate!);
      }
    };
    visit();
  } else {
    const remaining = [...picked];
    const assigned: RankedCandidate[] = [];
    for (let roleIndex = 0; roleIndex < localRoles.length; roleIndex++) {
      let bestIndex = 0;
      let bestCandidateScore = -1;
      for (let i = 0; i < remaining.length; i++) {
        const candidateIndex = candidateIndexes.get(remaining[i]!);
        const score = candidateIndex === undefined ? 0 : (scoreMatrix[roleIndex]?.[candidateIndex] ?? 0);
        if (score > bestCandidateScore) {
          bestIndex = i;
          bestCandidateScore = score;
        }
      }
      assigned.push(remaining.splice(bestIndex, 1)[0]!);
    }
    const assignedScore = roleScore(assigned);
    if (assignedScore > bestScore + Number.EPSILON) {
      best = assigned;
      bestScore = assignedScore;
    }
  }

  return bestScore > 0 ? best : picked;
}

export const DIRECT_ROLE: CouncilRole = {
  id: 'direct',
  label: 'Direct answer',
  mission: 'Answer the user task directly with the best complete response.',
  focus: ['correctness', 'usefulness', 'clear assumptions'],
};

/**
 * Canonical persona angle definitions per task type. Each role is a distinct
 * point of view (mission + focus) — the DIVERSITY OF PERSPECTIVES the council
 * exploits. Exported (read-only data, no behaviour change) so other pipelines
 * can REUSE the persona angles without importing the council machinery — e.g.
 * the STORM multi-perspective Deep Research path (`agent/deep-research-storm.ts`)
 * derives its diversified research perspectives from these exact angles.
 */
export const ROLE_SETS: Record<string, CouncilRole[]> = {
  code: [
    {
      id: 'architect',
      label: 'Architect',
      mission: 'Design the clean technical approach before implementation.',
      focus: ['architecture', 'interfaces', 'integration risk'],
    },
    {
      id: 'implementer',
      label: 'Implementer',
      mission: 'Find the practical implementation path and concrete next edits.',
      focus: ['minimal viable changes', 'existing code patterns', 'test impact'],
    },
    {
      id: 'reviewer',
      label: 'Reviewer',
      mission:
        'Predict the consensus answer three generic AIs would give to this task, then attack it: find where it fails in production. Your conditional verdict must state under which conditions the consensus is wrong.',
      focus: ['bugs', 'security', 'missing tests'],
    },
    {
      id: 'verifier',
      label: 'Verifier',
      mission:
        'Do not judge elegance: establish what is VERIFIABLE here and verify it yourself (step-by-step computation, counting, mental execution). Flag any claim nobody can verify.',
      focus: ['test plan', 'observability', 'rollback'],
    },
  ],
  reasoning: [
    {
      id: 'strategist',
      label: 'Strategist',
      mission: 'Build the strongest high-level solution.',
      focus: ['goal decomposition', 'tradeoffs', 'decision criteria'],
    },
    {
      id: 'skeptic',
      label: 'Skeptic',
      mission:
        'Predict the consensus answer three generic AIs would give, then look for the flawed assumption or counterexample that breaks it. Your conditional verdict must state when the consensus is wrong.',
      focus: ['failure modes', 'hidden constraints', 'overconfidence'],
    },
    {
      id: 'verifier',
      label: 'Verifier',
      mission:
        'Do not judge elegance: establish what is VERIFIABLE in this reasoning and verify it yourself (step-by-step computation, counting, mental execution). Flag any claim nobody can verify.',
      focus: ['evidence', 'consistency', 'what would falsify this'],
    },
  ],
  french: [
    {
      id: 'clarifier',
      label: 'Clarificateur',
      mission: 'Reformuler le besoin et proposer une réponse claire.',
      focus: ['nuance', 'structure', 'français naturel'],
    },
    {
      id: 'critique',
      label: 'Critique',
      mission:
        'Prédire la réponse consensuelle que donneraient trois IA génériques, puis l’attaquer : repérer les ambiguïtés, contresens et risques qui la font échouer. Ton verdict conditionnel doit dire quand le consensus a tort.',
      focus: ['contresens', 'hypothèses', 'points à demander'],
    },
    {
      id: 'synthesizer',
      label: 'Synthèse',
      mission: 'Produire la version finale la plus utile et concise.',
      focus: ['priorités', 'clarté', 'action suivante'],
    },
  ],
  vision: [
    {
      id: 'observer',
      label: 'Observer',
      mission: 'Extract the visual facts carefully without overclaiming.',
      focus: ['visible evidence', 'uncertainty', 'missing context'],
    },
    {
      id: 'risk-reviewer',
      label: 'Risk reviewer',
      mission: 'Challenge visual assumptions and unsafe conclusions.',
      focus: ['false positives', 'privacy', 'safety'],
    },
    {
      id: 'practical-synthesizer',
      label: 'Practical synthesizer',
      mission: 'Turn observations into an actionable answer.',
      focus: ['user goal', 'next step', 'confidence'],
    },
  ],
  general: [
    {
      id: 'strategist',
      label: 'Strategist',
      mission: 'Find the best overall answer and useful framing.',
      focus: ['user intent', 'options', 'tradeoffs'],
    },
    {
      id: 'skeptic',
      label: 'Skeptic',
      mission: 'Find what could be wrong, missing, or risky.',
      focus: ['assumptions', 'edge cases', 'cost of being wrong'],
    },
    {
      id: 'practitioner',
      label: 'Practitioner',
      mission: 'Make the answer operational and concrete.',
      focus: ['steps', 'constraints', 'what to do now'],
    },
  ],
};

function isCollectiveTask(task: string, taskType: string, count: number): boolean {
  if (count < 2) return false;
  const text = task.toLowerCase();
  if (task.length > 180) return true;
  if (taskType === 'code' || taskType === 'reasoning' || taskType === 'vision') return true;
  return /\b(audit|analyse|architecture|modernise|refactor|sécurité|security|risque|risk|compare|versus|vs|plan|stratégie|strategy|design|review|vérifie|verify|complexe|deep|fond)\b/.test(text);
}

export function buildCouncilConductorPlan(
  task: string,
  taskType: string,
  count: number,
  enabled = true,
): CouncilConductorPlan {
  if (!enabled || !isCollectiveTask(task, taskType, count)) {
    return {
      mode: 'direct',
      reason: enabled ? 'simple task: direct fan-out' : 'disabled by option',
      roles: Array.from({ length: Math.max(1, count) }, () => DIRECT_ROLE),
    };
  }

  const base = ROLE_SETS[taskType] ?? ROLE_SETS.general!;
  const roles = Array.from({ length: count }, (_, index) => {
    const role = base[index % base.length]!;
    if (index < base.length) return role;
    // Extra seats keep the SAME role id: the scoreboard learns per stable role
    // id, and a suffixed id ('reviewer-4') would fragment that history by
    // panel position. Only the label is disambiguated for display.
    return {
      ...role,
      label: `${role.label} ${index + 1}`,
      focus: [...role.focus, 'independent angle'],
    };
  });
  return {
    mode: 'collective',
    reason: 'complex task: complementary council roles',
    roles,
  };
}

export function buildCouncilPrompt(task: string, plan: CouncilConductorPlan, roleIndex: number): string {
  const role = plan.roles[roleIndex] ?? DIRECT_ROLE;
  if (plan.mode === 'direct' || role.id === DIRECT_ROLE.id) return task;

  // Output contract: forces a judgeable stance out of every role (a pure
  // critique used to be scored 0.25 by the judge for "refusing to decide" —
  // conditional verdicts make critics judgeable WITHOUT betraying their
  // mission), makes claims falsifiable, and surfaces the reversal conditions
  // the synthesizer must aggregate.
  return [
    `You are the ${role.label} in Code Buddy Council.`,
    role.mission,
    '',
    'Focus on:',
    ...role.focus.map((item) => `- ${item}`),
    '',
    'Original user task:',
    task,
    '',
    'MANDATORY output contract:',
    '1. First line: "VERDICT: <your position in one sentence>". If your mission is',
    '   critique/verification, give a CONDITIONAL verdict ("yes if X / no if Y") —',
    '   pure abstention is forbidden; your conditions ARE your added value.',
    '2. Then 2-5 numbered CLAIMS, each falsifiable, each with your confidence',
    '   (high/medium/low) and what would refute it. State your assumptions and risks.',
    '3. End with "WOULD CHANGE MY MIND: <the data or answer that would flip you>".',
    'Forbidden: restating the question beyond two sentences, hedged filler, and',
    'imitating a generic consensus answer. Your value comes from what the other',
    'members will NOT say.',
  ].join('\n');
}
