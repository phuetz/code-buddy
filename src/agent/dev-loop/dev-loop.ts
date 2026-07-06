/**
 * Dev-loop — boucle de développement autonome unifiée (façon Claude Code /loop).
 *
 * Par itération : (plan) → EXECUTE (vrai agent + outils) → VERIFY (Verifier
 * indépendant, fresh-context, verdict CONFIRMED / NEEDS REVIEW) → JUDGE
 * (goal-judge) → décider continuer/arrêter. Réutilise TOUT l'existant :
 * `GoalManager` (budget de tours + décision-ladder), `judgeGoal`,
 * `decomposeGoal`, le `VerifierAgent` via `executeOn('verifier', …)`, et
 * `getCostTracker()` (budget $). Le gate Verifier est l'apport clé : un
 * « done » du juge est ANNULÉ (→ continue) tant que la vérification
 * indépendante ne CONFIRME pas — un « fait » non prouvé n'est jamais accepté.
 *
 * Le seul code neuf est cet orchestrateur ; `buddy goal` reste inchangé.
 */

import type { ChatEntry } from '../codebuddy-agent.js';
import type { CodeBuddyClient, CodeBuddyMessage, CodeBuddyTool } from '../../codebuddy/client.js';
import { decomposeGoal, shouldAutoDecomposeGoal } from '../../goals/goal-decomposer.js';
import { judgeGoal, type GoalJudgeFn } from '../../goals/goal-judge.js';
import { getGoalManager, resolveGoalsConfig } from '../../goals/goal-manager.js';
import type { GoalStatus } from '../../goals/goal-state.js';
import { getAgentRegistry, initializeAgentRegistry } from '../specialized/agent-registry.js';
import { getCostTracker } from '../../utils/cost-tracker.js';
import { logger } from '../../utils/logger.js';

export type VerifierVerdict = 'CONFIRMED' | 'NEEDS REVIEW' | 'unverified';

/** Tranche de CodeBuddyAgent dont la boucle a besoin — injectable pour les tests. */
export interface DevLoopAgent {
  processUserMessage(input: string): Promise<ChatEntry[]>;
  getClient(): CodeBuddyClient;
  executeToolByName(
    name: string,
    params?: Record<string, unknown>,
  ): Promise<{ success: boolean; output?: string; error?: string }>;
}

/** Résultat d'une vérification indépendante. */
export interface VerifyOutcome {
  verdict: VerifierVerdict;
  evidence: string;
}

/** Seam de vérification — injectable pour tester le gate sans le vrai registry. */
export type DevLoopVerifier = (ctx: {
  agent: DevLoopAgent;
  goal: string;
  evidence: string;
}) => Promise<VerifyOutcome>;

export interface DevLoopOptions {
  maxTurns?: number;
  /** Budget coût session en USD. Dépassé → pause propre. Absent → pas de borne coût. */
  budgetUsd?: number;
  judgeModel?: string;
  judgeClient?: CodeBuddyClient;
  /** Désactiver la décomposition en plan (défaut: auto sur objectifs complexes). */
  noPlan?: boolean;
  /** Désactiver le gate Verifier (retombe sur la boucle juge-seule, comme `goal`). */
  noVerify?: boolean;
  /** Override du vérificateur (tests) ; défaut = Verifier agent via le registry. */
  verify?: DevLoopVerifier;
  /** Lecteur de coût session (tests) ; défaut = getCostTracker. */
  currentCostUsd?: () => number;
  onMessage?: (text: string) => void;
}

export interface DevLoopResult {
  status: GoalStatus | 'unknown';
  turnsUsed: number;
  lastReason?: string;
  lastVerifierVerdict: VerifierVerdict;
  costUsd: number;
}

const TOOL_RESULT_SNIPPET_CHARS = 1600;

/** Résume un tour en évidences (assistant + [tool:x success|error]) pour le juge. */
function summarizeTurn(entries: ChatEntry[]): string {
  const parts: string[] = [];
  let hasToolResult = false;
  for (const e of entries) {
    if (e.type === 'assistant' && e.content.trim()) {
      parts.push(e.content.trim());
      continue;
    }
    if (e.type !== 'tool_result') continue;
    hasToolResult = true;
    const out = (e.toolResult?.success ? e.toolResult.output : e.toolResult?.error) ?? e.content;
    const s = String(out ?? '').trim();
    if (!s) continue;
    const name = e.toolCall?.function?.name ?? 'tool';
    const status = e.toolResult ? (e.toolResult.success ? 'success' : 'error') : 'result';
    const snippet = s.length > TOOL_RESULT_SNIPPET_CHARS ? `${s.slice(0, TOOL_RESULT_SNIPPET_CHARS)}... [truncated]` : s;
    parts.push(`[tool:${name} ${status}]\n${snippet}`);
  }
  const summary = parts.join('\n\n');
  return summary && !hasToolResult ? `[tool evidence: none]\n\n${summary}` : summary;
}

/**
 * Vérification indépendante via le VerifierAgent (fresh context, oracles réels).
 * Utilise le MÊME bridge llmCall/executeTool que codebuddy-agent.ts câble pour
 * le tool `verify` (client de l'agent + executeToolByName). Fail-open : toute
 * erreur → 'unverified' (ne bloque jamais, mais ne CONFIRME pas non plus).
 */
export const defaultDevLoopVerifier: DevLoopVerifier = async ({ agent, goal, evidence }) => {
  try {
    const registry = getAgentRegistry();
    if (registry.getAll().length === 0) await initializeAgentRegistry();
    const instruction =
      `Verify that this goal is FULLY achieved by the work just done. ` +
      `Reproduce and run real oracles; show raw evidence.\n\nGoal:\n${goal}\n\n` +
      `Agent's turn evidence:\n${evidence.slice(0, 3000)}`;
    const result = await registry.executeOn('verifier', {
      action: 'verify',
      params: {
        instruction,
        llmCall: async (messages: unknown, tools: unknown) => {
          const resp = await agent.getClient().chat(messages as CodeBuddyMessage[], tools as CodeBuddyTool[]);
          const msg = resp.choices?.[0]?.message;
          return { content: msg?.content ?? '', tool_calls: msg?.tool_calls ?? [] };
        },
        executeTool: async (name: string, args: Record<string, unknown>) => {
          const r = await agent.executeToolByName(name, args);
          return { success: r.success, output: r.output, error: r.error };
        },
      },
    });
    if (!result.success) return { verdict: 'unverified', evidence: result.error ?? 'verifier failed' };
    const verdict: VerifierVerdict = (result.metadata?.verdict as string) === 'CONFIRMED' ? 'CONFIRMED' : 'NEEDS REVIEW';
    return { verdict, evidence: result.output ?? '' };
  } catch (error) {
    logger.debug('dev-loop verifier failed (fail-open)', { error: String(error) });
    return { verdict: 'unverified', evidence: String(error) };
  }
};

/**
 * Drive the unified dev-loop headlessly on an in-process agent.
 * Sets the goal, (optionally) decomposes it, then per iteration:
 * execute → verify (gate) → judge → decide, until done/budget/stagnation.
 */
export async function runDevLoop(
  agent: DevLoopAgent,
  goalText: string,
  options: DevLoopOptions = {},
): Promise<DevLoopResult> {
  const cfg = resolveGoalsConfig();
  const emit = options.onMessage ?? (() => {});
  const judgeClient = options.judgeClient ?? agent.getClient();
  const judgeModel = options.judgeModel || cfg.judgeModel;
  const verify = options.verify ?? defaultDevLoopVerifier;
  const readCost = options.currentCostUsd ?? (() => getCostTracker().getReport().sessionCost);

  const manager = getGoalManager();
  const state = manager.set(goalText, options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {});
  emit(`⊙ Dev-loop démarrée (budget ${state.maxTurns} tours${options.budgetUsd ? `, $${options.budgetUsd}` : ''}) : ${state.goal}`);

  // Plan (itération 0) — réutilise goal-decomposer, best-effort.
  if (!options.noPlan && shouldAutoDecomposeGoal(goalText)) {
    try {
      const plan = await decomposeGoal(goalText, agent.getClient(), judgeModel ? { model: judgeModel } : {});
      if (plan) {
        manager.attachGoalPlan(plan);
        emit(`↳ Plan : ${plan.tasks.length} tâche(s)`);
      }
    } catch (error) {
      logger.debug('dev-loop decompose failed (fail-open)', { error: String(error) });
    }
  }

  let prompt = state.goal;
  let lastVerifierVerdict: VerifierVerdict = 'unverified';
  const maxIterations = state.maxTurns + 1;

  for (let i = 0; i < maxIterations; i++) {
    // 1) EXECUTE
    const entries = await agent.processUserMessage(prompt);
    const turnSummary = summarizeTurn(entries);

    // 2) VERIFY (indépendant) — gate le « done ».
    let evidence = turnSummary;
    if (!options.noVerify && turnSummary.trim()) {
      const v = await verify({ agent, goal: state.goal, evidence: turnSummary });
      lastVerifierVerdict = v.verdict;
      emit(`🔎 Verifier : ${v.verdict}`);
      evidence = `${turnSummary}\n\n[Verifier verdict: ${v.verdict}]\n${v.evidence.slice(0, 2000)}`;
    }

    // 3) JUDGE — un « done » du juge est ANNULÉ tant que le Verifier n'a pas CONFIRMED.
    const gatedJudge: GoalJudgeFn = async (params) => {
      const base = await judgeGoal(judgeClient, {
        ...params,
        ...(judgeModel ? { model: judgeModel } : {}),
        maxTokens: cfg.judgeMaxTokens,
        timeoutMs: cfg.judgeTimeoutMs,
      });
      if (!options.noVerify && base.verdict === 'done' && lastVerifierVerdict !== 'CONFIRMED') {
        return {
          verdict: 'continue',
          reason: `verification not CONFIRMED (verifier=${lastVerifierVerdict}); judge said done (${base.reason})`,
          parseFailed: false,
        };
      }
      return base;
    };

    const decision = await manager.evaluateAfterTurn(evidence.trim() || turnSummary, { judge: gatedJudge });
    if (decision.message) emit(decision.message);

    // 4) BUDGET COÛT — stop-condition indépendante du budget de tours.
    if (options.budgetUsd !== undefined && readCost() >= options.budgetUsd) {
      manager.pause(`cost budget exhausted ($${readCost().toFixed(4)}/$${options.budgetUsd})`);
      emit(`⏸ Dev-loop en pause — budget coût atteint ($${readCost().toFixed(4)}).`);
      break;
    }

    if (!turnSummary.trim() && manager.isActive()) {
      manager.pause('empty response (nothing to evaluate)');
      emit("⏸ Dev-loop en pause — l'agent n'a produit aucune réponse évaluable.");
      break;
    }
    if (!decision.shouldContinue || !decision.continuationPrompt) break;
    prompt = decision.continuationPrompt;
  }

  const final = manager.state;
  return {
    status: final?.status ?? 'unknown',
    turnsUsed: final?.turnsUsed ?? 0,
    ...(final?.lastReason ? { lastReason: final.lastReason } : {}),
    lastVerifierVerdict,
    costUsd: readCost(),
  };
}
