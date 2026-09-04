/**
 * Strategy gate — ordered, blocking, fail-closed:
 *   G1 SCHEMA    strict Zod parse (unknown key, out-of-envelope value ⇒ reject)
 *   G2 SAFETY    directives go through the skill firewall (prompt override,
 *                exfiltration) + a forbidden-verb list (disable/bypass a guard)
 *   G3 LINEAGE   the candidate must descend from the given parent, one version up
 *   G4 INERT     a candidate byte-identical to its parent changes nothing ⇒ reject
 *   G5 EMPIRICAL paired observations (replay or live) → Bayesian sign test
 *                (`pairedBayesianDecision`) + a cost guard; no observation ⇒ reject
 *                (`no-evidence`): a strategy is never kept on schema alone.
 * Installation (store.save + activate) happens only on accept + keepOnAccept.
 *
 * @module agent/self-improvement/strategy-gate
 */

import { pairedBayesianDecision } from './paired-gate.js';
import { safetyGateSkill } from './skill-mutator.js';
import type { StrategyStore } from './strategy-store.js';
import {
  strategySpecSchema,
  type StrategyEvaluation,
  type StrategyGateOutcome,
  type StrategyProposal,
  type StrategyScope,
  type StrategySpec,
} from './strategy-types.js';

/** Port: produce paired observations for a candidate vs its parent. */
export interface StrategyEvaluator {
  evaluate(candidate: StrategySpec, parent: StrategySpec): Promise<StrategyEvaluation>;
}

export interface ValidateStrategyOptions {
  keepOnAccept: boolean;
  /** Posterior threshold for the sign test (default 0.95, as the paired gate). */
  threshold?: number;
  /** Max allowed mean cost ratio candidate/parent on decisive pairs (default 1.5). */
  maxCostRatio?: number;
  /** Minimum decisive pairs before an accept is even considered (default 3). */
  minDecisive?: number;
  /** Scope the candidate must target (the engine's scope); defaults to the parent's. */
  scope?: StrategyScope;
}

/**
 * Normalize directive text to defeat obfuscation (homoglyphs, zero-width chars,
 * HTML tags/comments, hyphenated word wraps).
 */
export function normalizeDirectiveText(text: string): string {
  return text
    // Remove zero-width characters and soft hyphens
    .replace(/[\u200B-\u200D\uFEFF\u00AD\u2060]/g, '')
    // Rejoin hyphenated words across lines: e.g. "ign-\nore" -> "ignore"
    .replace(/(\w+)-[\r\n]+\s*(\w+)/g, '$1$2')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Remove HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Normalize unicode canonical composition
    .normalize('NFKC')
    // Map common Cyrillic confusable homoglyphs to Latin equivalents
    .replace(/\u043e/gi, 'o')
    .replace(/\u0430/gi, 'a')
    .replace(/\u0435/gi, 'e')
    .replace(/\u0440/gi, 'p')
    .replace(/\u0441/gi, 'c')
    .replace(/\u0456/gi, 'i')
    .replace(/\u0443/gi, 'y')
    .replace(/\u0445/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A directive that tries to switch off a guard. The schema already has no field
 * for that; this catches an attempt smuggled into prose ("skip the sandbox").
 */
export const FORBIDDEN_DIRECTIVE_RE =
  /\b(?:disable|bypass|skip|ignore|turn\s*off|désactiv\w*|contourn\w*|ignor\w*|saute\w*)\w*.{0,60}\b(?:sandbox|confirmation|permission\w*|firewall|pare-feu|guard\w*|garde-fou\w*|validator\w*|validateur\w*|middleware|safety|sécurité|approval\w*|approbation\w*)/is;

export const FORBIDDEN_PERMISSION_BYPASS_RE =
  /\b(?:bypassPermissions|bypass-permissions)\b|\b(?:bypass|disable|skip|override)[\s_-]*permissions?\b/i;

export const FORBIDDEN_YOLO_RE =
  /\b(?:--yolo|yolo(?:-mode)?)\b/i;

export const FORBIDDEN_DESTRUCTIVE_FS_RE =
  /\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r\s+-f|-f\s+-r|--recursive\s+--force|--force\s+--recursive)\b/i;

export const FORBIDDEN_EXFILTRATION_RE =
  /\b(?:exfiltrat\w*|exfiltr\w*|upload|send|transmit|post|leak|dump|reveal|print|cat|read|copy|expos\w*|affich\w*|divulgu\w*|copi\w*|transmet\w*|envoy\w*)\b.{0,180}(?:\.env|\.ssh|\.aws|\b(?:credentials?|private[_ -]?key|api[_ -]?key|secret|token))\b/is;

export const PROMPT_OVERRIDE_EN_RE =
  /\b(?:ignore|disregard|override|forget|bypass)\b.{0,80}\b(?:all|any|previous|prior|system|developer|past)\b.{0,80}\b(?:instruction|prompt|directive|message|rule)s?\b/is;

export const PROMPT_OVERRIDE_FR_RE =
  /\b(?:ignore\w*|oubli\w*|outrepass\w*|contourn\w*|annul\w*)\b.{0,80}\b(?:toutes|tous|tout|les|mes|tes|chaque|précédent\w*|antérieur\w*|système|développeur)\b.{0,80}\b(?:instruction|consigne|directive|règle|message|prompt)s?\b/is;

export function staticStrategyProblems(candidate: StrategySpec): string[] {
  const problems: string[] = [];

  for (const directive of candidate.directives) {
    const norm = normalizeDirectiveText(directive);

    if (FORBIDDEN_DIRECTIVE_RE.test(directive) || FORBIDDEN_DIRECTIVE_RE.test(norm)) {
      problems.push(`directive tries to switch off a guard: ${JSON.stringify(directive.slice(0, 80))}`);
    }
    if (FORBIDDEN_PERMISSION_BYPASS_RE.test(directive) || FORBIDDEN_PERMISSION_BYPASS_RE.test(norm)) {
      problems.push(`directive pushes to bypass permissions: ${JSON.stringify(directive.slice(0, 80))}`);
    }
    if (FORBIDDEN_YOLO_RE.test(directive) || FORBIDDEN_YOLO_RE.test(norm)) {
      problems.push(`directive pushes to --yolo mode: ${JSON.stringify(directive.slice(0, 80))}`);
    }
    if (FORBIDDEN_DESTRUCTIVE_FS_RE.test(directive) || FORBIDDEN_DESTRUCTIVE_FS_RE.test(norm)) {
      problems.push(`directive contains destructive command (rm -rf): ${JSON.stringify(directive.slice(0, 80))}`);
    }
    if (FORBIDDEN_EXFILTRATION_RE.test(directive) || FORBIDDEN_EXFILTRATION_RE.test(norm)) {
      problems.push(`directive attempts to exfiltrate secrets or .env: ${JSON.stringify(directive.slice(0, 80))}`);
    }
    if (
      PROMPT_OVERRIDE_EN_RE.test(directive) ||
      PROMPT_OVERRIDE_EN_RE.test(norm) ||
      PROMPT_OVERRIDE_FR_RE.test(directive) ||
      PROMPT_OVERRIDE_FR_RE.test(norm)
    ) {
      problems.push(`directive attempts prompt injection: ${JSON.stringify(directive.slice(0, 80))}`);
    }
  }

  if (candidate.directives.length > 0) {
    const rawJoined = candidate.directives.join('\n');
    const normJoined = normalizeDirectiveText(rawJoined);
    if (
      PROMPT_OVERRIDE_EN_RE.test(rawJoined) ||
      PROMPT_OVERRIDE_EN_RE.test(normJoined) ||
      PROMPT_OVERRIDE_FR_RE.test(rawJoined) ||
      PROMPT_OVERRIDE_FR_RE.test(normJoined)
    ) {
      problems.push(`directives combined attempt prompt injection`);
    }
    const firewall = safetyGateSkill(rawJoined);
    if (!firewall.ok) problems.push(...firewall.reasons.map((r) => `firewall: ${r}`));
    if (normJoined !== rawJoined) {
      const firewallNorm = safetyGateSkill(normJoined);
      if (!firewallNorm.ok) problems.push(...firewallNorm.reasons.map((r) => `firewall (normalized): ${r}`));
    }
  }
  return [...new Set(problems)];
}

function specEquals(a: StrategySpec, b: StrategySpec): boolean {
  const strip = (s: StrategySpec) => {
    const { id: _id, version: _v, parentId: _p, provenance: _pr, ...rest } = s;
    return JSON.stringify(rest);
  };
  return strip(a) === strip(b);
}

export async function validateStrategyProposal(
  proposal: StrategyProposal,
  parent: StrategySpec,
  evaluator: StrategyEvaluator | null,
  store: StrategyStore,
  options: ValidateStrategyOptions,
): Promise<StrategyGateOutcome> {
  const base = { proposalId: proposal.id, parentId: parent.id };
  const reject = (rejectionReason: StrategyGateOutcome['rejectionReason'], reasons: string[]): StrategyGateOutcome => ({
    ...base,
    accepted: false,
    rejectionReason,
    reasons,
  });

  // G1 — strict schema.
  const parsed = strategySpecSchema.safeParse(proposal.candidate);
  if (!parsed.success) {
    return reject(
      'schema',
      parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
    );
  }
  const candidate = parsed.data;

  // G2 — safety of directives.
  const safety = staticStrategyProblems(candidate);
  if (safety.length > 0) return reject('safety', safety);

  // G3 — lineage: descends from the parent, exactly one version up, same scope, fresh id.
  const lineage: string[] = [];
  if (candidate.parentId !== parent.id) lineage.push(`parentId ${candidate.parentId ?? '<none>'} ≠ ${parent.id}`);
  if (candidate.version !== parent.version + 1) lineage.push(`version ${candidate.version} ≠ ${parent.version + 1}`);
  const expectedScope = options.scope ?? parent.scope;
  if (candidate.scope !== expectedScope && !(parent.id === 'baseline' && !options.scope)) {
    lineage.push(`scope ${candidate.scope} ≠ ${expectedScope}`);
  }
  if (candidate.id === parent.id || store.has(candidate.id)) lineage.push(`id ${candidate.id} already exists`);
  if (lineage.length > 0) return reject('lineage', lineage);

  // G4 — inert candidate.
  if (specEquals(candidate, parent)) return reject('inert', ['candidate is identical to its parent — nothing to measure']);

  // G5 — empirical.
  if (!evaluator) return reject('no-evidence', ['no evaluator configured — a strategy is never kept on schema alone']);
  const evaluation = await evaluator.evaluate(candidate, parent);
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let costNum = 0;
  let costDen = 0;
  for (const o of evaluation.observations) {
    if (o.candidateOk && !o.parentOk) wins++;
    else if (!o.candidateOk && o.parentOk) losses++;
    else ties++;
    if (
      typeof o.parentCostUsd === 'number' &&
      typeof o.candidateCostUsd === 'number' &&
      Number.isFinite(o.parentCostUsd) &&
      Number.isFinite(o.candidateCostUsd)
    ) {
      if (o.parentCostUsd < 0 || o.candidateCostUsd < 0) {
        return {
          ...reject('cost', ['evaluator produced negative cost observation']),
          paired: { wins, losses, ties, pImprove: 0, evidence: evaluation.evidence },
        };
      }
      if (o.parentCostUsd > 0) {
        costNum += o.candidateCostUsd;
        costDen += o.parentCostUsd;
      }
    }
  }
  const threshold = options.threshold ?? 0.95;
  const decision = pairedBayesianDecision(wins, losses, threshold);
  const paired = { wins, losses, ties, pImprove: decision.pImprove, evidence: evaluation.evidence };
  const costRatio = costDen > 0 ? costNum / costDen : 1;
  if (!Number.isFinite(costRatio) || costRatio < 0) {
    return { ...reject('cost', ['invalid cost ratio calculated from observations']), paired, costRatio: 1 };
  }
  const minDecisive = options.minDecisive ?? 3;

  if (evaluation.observations.length === 0) {
    return { ...reject('no-evidence', ['evaluator produced no paired observation']), paired };
  }
  if (decision.decision === 'reject' || (losses > 0 && wins === 0)) {
    return { ...reject('regression', [`candidate loses ${losses} paired task(s), wins ${wins}`]), paired, costRatio };
  }
  if (decision.decision !== 'accept' || decision.decisive < minDecisive) {
    return {
      ...reject('undecided', [
        `sign test undecided: wins=${wins} losses=${losses} P(improve)=${decision.pImprove.toFixed(3)} (need ≥ ${threshold} on ≥ ${minDecisive} decisive pairs)`,
      ]),
      paired,
      costRatio,
    };
  }
  const maxCostRatio = options.maxCostRatio ?? 1.5;
  if (costRatio > maxCostRatio) {
    return { ...reject('cost', [`mean cost ratio ${costRatio.toFixed(2)} exceeds ${maxCostRatio}`]), paired, costRatio };
  }

  // Accepted.
  let appliedRef: string | undefined;
  if (options.keepOnAccept) {
    try {
      const currentActive = store.resolveActive(candidate.scope);
      if (currentActive.id !== parent.id) {
        return {
          ...reject('lineage', [`concurrent modification detected: active strategy changed from ${parent.id} to ${currentActive.id}`]),
          paired,
          costRatio,
        };
      }
      store.save(candidate);
      store.activate(candidate.scope, candidate.id);
      appliedRef = candidate.id;
    } catch (err) {
      return {
        ...base,
        accepted: false,
        rejectionReason: 'undecided',
        reasons: [`storage failed: ${err instanceof Error ? err.message : String(err)}`],
        paired,
        costRatio,
      };
    }
  }
  return {
    ...base,
    accepted: true,
    reasons: [
      `${evaluation.evidence} evidence: wins=${wins} losses=${losses} ties=${ties} P(improve)=${decision.pImprove.toFixed(3)}, cost ratio ${costRatio.toFixed(2)}`,
      options.keepOnAccept ? 'installed + activated (auto-apply)' : 'accepted (propose-only) — not installed',
    ],
    paired,
    costRatio,
    ...(appliedRef ? { appliedRef } : {}),
  };
}
