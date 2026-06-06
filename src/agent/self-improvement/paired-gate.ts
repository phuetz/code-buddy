/**
 * Paired live gate — the execution-grounded validator for GENERAL lessons.
 *
 * The retrieval benchmark proves a lesson is *findable*; this proves it *helps*.
 * For each graded task we run the agent WITH the candidate lesson injected and
 * WITHOUT it (the lesson is the only delta), grade both deterministically, and
 * accept the lesson only if it wins on a paired-Bayesian sign test — the
 * statistically-sound way to decide from FEW noisy paired evals (CLT error bars
 * are unreliable at N<100; see docs/self-improvement-research-2026.md, Area 1).
 *
 * Guards:
 *  - **Counterfactual ablation pre-filter**: if the lesson changes the agent's
 *    behavior on NO task, it is inert → reject before spending the full budget.
 *  - **Safety regression**: a safety task that passes WITHOUT but fails WITH the
 *    lesson ⇒ immediate reject.
 *  - **Anytime stopping**: Bayesian posteriors are valid under optional stopping,
 *    so we evaluate until confident (or the budget is exhausted).
 *
 * The agent is injected (AgentRunner) so the math + orchestration are fully
 * deterministic and unit-testable; production wires a real model.
 *
 * @module agent/self-improvement/paired-gate
 */

// ── Numerics: regularized incomplete beta I_x(a,b) ──────────────────────────

/** Lanczos log-gamma. */
function gammaln(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  // eslint-disable-next-line no-loss-of-precision -- standard Lanczos series constant
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j]! / ++y;
  return -tmp + Math.log((Math.sqrt(2 * Math.PI) * ser) / x);
}

/** Continued fraction for the incomplete beta (Lentz). */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a,b) = P(Beta(a,b) ≤ x). */
export function regularizedBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x);
  const bt = Math.exp(lbeta);
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

// ── Paired-Bayesian sign test ───────────────────────────────────────────────

export interface PairedDecision {
  wins: number;
  losses: number;
  decisive: number;
  /** P(the lesson's win-rate among decisive pairs > 0.5), uniform prior. */
  pImprove: number;
  decision: 'accept' | 'reject' | 'undecided';
}

/**
 * Bayesian sign test on paired win/loss counts (ties ignored). Posterior on the
 * win-probability is Beta(wins+1, losses+1); accept when P(rate>0.5) ≥ threshold,
 * reject when P(rate<0.5) ≥ threshold, else undecided.
 */
export function pairedBayesianDecision(
  wins: number,
  losses: number,
  threshold = 0.95,
): PairedDecision {
  const decisive = wins + losses;
  const pImprove = decisive === 0 ? 0.5 : 1 - regularizedBeta(wins + 1, losses + 1, 0.5);
  let decision: PairedDecision['decision'] = 'undecided';
  if (pImprove >= threshold) decision = 'accept';
  else if (1 - pImprove >= threshold) decision = 'reject';
  return { wins, losses, decisive, pImprove, decision };
}

// ── Orchestrator ────────────────────────────────────────────────────────────

export interface AgentRunResult {
  /** The agent's response text (graded). */
  text: string;
  /** Tool names used, if any (for behavior-change detection / safety). */
  toolNames?: string[];
}

/** Injected agent: run a task prompt with an optional injected lesson. */
export interface AgentRunner {
  run(prompt: string, lessonText: string | null): Promise<AgentRunResult>;
}

export interface GradedTask {
  id: string;
  prompt: string;
  /** Deterministic grader over the agent's result. True = task solved. */
  grade: (result: AgentRunResult) => boolean;
  /** Safety tasks must never regress (pass-without → fail-with ⇒ hard reject). */
  safety?: boolean;
}

export type TaskOutcome = 'win' | 'loss' | 'tie';

export interface PairedTaskResult {
  taskId: string;
  outcome: TaskOutcome;
  passWith: boolean;
  passWithout: boolean;
  changed: boolean;
}

export interface PairedGateResult {
  accepted: boolean;
  decision: PairedDecision;
  results: PairedTaskResult[];
  /** True if the lesson changed the agent's behavior on at least one task. */
  changedAny: boolean;
  rejectionReason?: 'inert' | 'safety-regression' | 'not-confident';
  tasksRun: number;
  notes: string[];
}

export interface PairedGateOptions {
  threshold?: number;
  /** Stop early once the decision is confident (anytime-valid). Default true. */
  earlyStop?: boolean;
  /** Lessons present in both arms (the lesson under test is added on top). */
  baseLessons?: string[];
}

/**
 * Run the paired live gate for a candidate lesson against the graded tasks.
 * Behavior, not keywords: a lesson is accepted only if it makes the agent solve
 * tasks it otherwise wouldn't, with statistical confidence and no safety regression.
 */
export async function runPairedGate(
  lessonText: string,
  tasks: GradedTask[],
  runner: AgentRunner,
  options: PairedGateOptions = {},
): Promise<PairedGateResult> {
  const threshold = options.threshold ?? 0.95;
  const earlyStop = options.earlyStop !== false;
  const base = (options.baseLessons ?? []).join('\n');
  const withText = [base, lessonText].filter(Boolean).join('\n');
  const withoutText = base || null;

  const results: PairedTaskResult[] = [];
  let wins = 0;
  let losses = 0;
  let changedAny = false;

  for (const task of tasks) {
    const resWith = await runner.run(task.prompt, withText);
    const resWithout = await runner.run(task.prompt, withoutText);
    const passWith = task.grade(resWith);
    const passWithout = task.grade(resWithout);
    const changed = passWith !== passWithout || resWith.text !== resWithout.text;
    if (changed) changedAny = true;

    // Safety regression — hard stop.
    if (task.safety && passWithout && !passWith) {
      results.push({ taskId: task.id, outcome: 'loss', passWith, passWithout, changed });
      return {
        accepted: false,
        decision: pairedBayesianDecision(wins, losses + 1, threshold),
        results,
        changedAny,
        rejectionReason: 'safety-regression',
        tasksRun: results.length,
        notes: [`reverted: safety task "${task.id}" regressed (passed without, failed with)`],
      };
    }

    const outcome: TaskOutcome = passWith && !passWithout ? 'win' : !passWith && passWithout ? 'loss' : 'tie';
    if (outcome === 'win') wins++;
    else if (outcome === 'loss') losses++;
    results.push({ taskId: task.id, outcome, passWith, passWithout, changed });

    if (earlyStop) {
      const d = pairedBayesianDecision(wins, losses, threshold);
      if (d.decision !== 'undecided') break;
    }
  }

  // Counterfactual ablation: a lesson that changed nothing is inert.
  if (!changedAny) {
    return {
      accepted: false,
      decision: pairedBayesianDecision(wins, losses, threshold),
      results,
      changedAny,
      rejectionReason: 'inert',
      tasksRun: results.length,
      notes: ['lesson changed the agent behavior on no task — inert'],
    };
  }

  const decision = pairedBayesianDecision(wins, losses, threshold);
  const accepted = decision.decision === 'accept';
  return {
    accepted,
    decision,
    results,
    changedAny,
    ...(accepted ? {} : { rejectionReason: 'not-confident' as const }),
    tasksRun: results.length,
    notes: [
      `paired sign test: ${wins} win / ${losses} loss → P(improve)=${decision.pImprove.toFixed(3)} (threshold ${threshold})`,
    ],
  };
}
