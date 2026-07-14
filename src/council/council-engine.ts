/**
 * Council engine — the 8-step deliberation pipeline, host-agnostic.
 *
 *  1. List usable LLMs            → deps.loadRegistry (active-llm-registry in prod)
 *  2. Route by capability         → strengths heuristic × learned selection bias,
 *                                   with an ε-exploration seat so the scoreboard
 *                                   never locks in its first winner
 *  3. Conductor roles             → complementary roles, not N copies of the same prompt
 *  4. Ask several in parallel     → per-model timeouts (timers cleared + unref'd)
 *  5. Judge → keep the best       → neutral judge, abstains instead of guessing
 *  6. Synthesize collective view  → merge complementary roles in collective mode
 *  7. Consensus on divergence     → computeTextConsensus (lexical, weak signal)
 *  8. Learn / prefer the best     → ModelScoreboard, only from neutral parsed verdicts
 *
 * Takes injected dependencies and returns a `CouncilRunResult` (data, no
 * rendering) so the CLI, server, Cowork and the voice loop can all run
 * councils and present them their own way.
 *
 * @module council/council-engine
 */

import { computeTextConsensus, type ConsensusSource } from '../fleet/result-aggregator.js';
import { inferStrengths, inferTaskType } from '../fleet/model-capability-heuristics.js';
import {
  assignCouncilRolesToCandidates,
  buildCouncilConductorPlan,
  buildCouncilPrompt,
  matchScore,
  pickDiverse,
  TASK_REQUIRES,
} from './conductor.js';
import { judgeAnswers, selectNeutralJudge } from './judge.js';
import {
  buildCouncilSynthesisPrompt,
  computeCouncilDecisionSignals,
  shouldRecordCouncilLearning,
} from './signals.js';
import { gatherPeerAnswers } from './peers.js';
import { withTimeout } from './with-timeout.js';
import { computeDeliberationHealth } from './deliberation-health.js';
import { isCouncilTriageEnabled, runCouncilTriage } from './triage.js';
import { sanitizeModelOutput } from '../utils/output-sanitizer.js';
import {
  CouncilError,
  type CouncilAnswer,
  type CouncilCandidate,
  type CouncilChatClient,
  type CouncilDecisionSignals,
  type CouncilEngineDeps,
  type CouncilOptions,
  type CouncilProgressEvent,
  type CouncilRunResult,
  type CouncilSynthesisCandidate,
  type JudgeVerdict,
  type RankedCandidate,
} from './types.js';

function defaultTimeoutMs(): number {
  const raw = Number(process.env.CODEBUDDY_COUNCIL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 45000;
}

function defaultExploreEpsilon(): number {
  const raw = Number(process.env.CODEBUDDY_COUNCIL_EXPLORE);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.1;
}

function safeClient(deps: CouncilEngineDeps, candidate: CouncilCandidate): CouncilChatClient | null {
  try {
    return deps.clientFactory(candidate);
  } catch {
    return null;
  }
}

function sourceId(answer: CouncilAnswer): string {
  return answer.source.kind === 'local' ? answer.source.provider : answer.source.peerId;
}

function labelledConcat(answers: CouncilAnswer[]): string {
  return answers
    .map((a) => {
      const role = a.role?.label ? ` · ${a.role.label}` : '';
      return `--- ${a.displayName}${role} ---\n${a.content.trim()}`;
    })
    .join('\n\n');
}

async function synthesizeCouncilAnswer(
  client: CouncilChatClient,
  task: string,
  candidates: CouncilSynthesisCandidate[],
  consensusScore: number,
  signals: CouncilDecisionSignals,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const prompt = buildCouncilSynthesisPrompt(task, candidates, consensusScore, signals);
    const resp = await withTimeout(
      client.chat([
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ]),
      timeoutMs,
      'synthesis',
    );
    const text = sanitizeModelOutput(resp.content).trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function runCouncilPipeline(
  task: string,
  opts: CouncilOptions,
  deps: CouncilEngineDeps,
  onProgress: (e: CouncilProgressEvent) => void = () => {},
): Promise<CouncilRunResult> {
  const scoreboard = deps.scoreboard;
  const rng = deps.rng ?? Math.random;
  const timeoutMs = deps.timeoutMs ?? defaultTimeoutMs();

  // 0. Cheap triage gate (opt-in `CODEBUDDY_COUNCIL_TRIAGE`, default OFF ⇒
  // skipped entirely — behaviour unchanged). One cheap classification call
  // decides SINGLE vs COUNCIL; a SINGLE verdict returns a well-formed triaged
  // result and the expensive fan-out below is NEVER reached. Any failure /
  // ambiguity returns null here, so the full council runs (fail-safe toward
  // quality — triage can only save cost, never downgrade a hard question).
  if (isCouncilTriageEnabled(deps.env ?? process.env)) {
    const triaged = await runCouncilTriage(task, opts, deps, onProgress);
    if (triaged) return triaged;
  }

  // 1. usable LLMs
  let candidates = (await deps.loadRegistry()).filter((c) => c.apiKey);
  if (candidates.length === 0) {
    throw new CouncilError('no-candidates', 'no active LLMs detected');
  }
  if (opts.models) {
    const wanted = opts.models.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const filtered = candidates.filter((c) =>
      wanted.some((w) => c.provider.toLowerCase().includes(w) || c.model.toLowerCase().includes(w)),
    );
    if (filtered.length) candidates = filtered;
  }

  // 2. capability routing × learned bias
  const taskType = (opts.taskType || inferTaskType(task)).toLowerCase();
  const required = TASK_REQUIRES[taskType] ?? TASK_REQUIRES.general!;
  const ranked: RankedCandidate[] = candidates
    .map((c) => {
      const strengths = inferStrengths(c.model);
      const cap = matchScore(strengths, required);
      const cheapBonus = c.costInputUsdPerMtok === 0 ? 0.05 : 0;
      // selectionBias is Laplace-smoothed AND confidence-weighted (a 1/1 model
      // no longer beats a 9/10 one), unlike the raw `(1 + winRate)` it replaces.
      const bias = scoreboard.selectionBias(taskType, c.model);
      return {
        c,
        strengths,
        score: (cap + 0.1 + cheapBonus) * Math.max(0.1, 1 + bias),
        hist: scoreboard.winRate(taskType, c.model),
      };
    })
    .sort((a, b) => b.score - a.score);

  const k = Math.max(1, Math.min(opts.count ?? 3, ranked.length));
  let picked = pickDiverse(ranked, k);

  // ε-exploration seat: occasionally swap the last seat for the least-observed
  // candidate, so unseen models eventually accumulate history.
  const epsilon = deps.exploreEpsilon ?? defaultExploreEpsilon();
  let explored: string | undefined;
  if (picked.length >= 2 && ranked.length > picked.length && rng() < epsilon) {
    const rest = ranked.filter((r) => !picked.includes(r));
    const leastSeen = rest.reduce((a, b) =>
      scoreboard.runCount(taskType, b.c.model) < scoreboard.runCount(taskType, a.c.model) ? b : a,
    );
    picked = [...picked.slice(0, -1), leastSeen];
    explored = leastSeen.c.model;
  }

  // 3. conductor roles
  const peers = opts.fleet ? deps.peers : [];
  const plan = buildCouncilConductorPlan(task, taskType, picked.length + peers.length, opts.conductor !== false);
  picked = assignCouncilRolesToCandidates(picked, plan.roles, taskType, scoreboard);

  onProgress({
    type: 'panel',
    taskType,
    entries: picked.map((p) => ({ model: p.c.model, histWinRate: p.hist })),
    peerCount: peers.length,
    ...(explored ? { explored } : {}),
  });
  if (plan.mode === 'collective') {
    onProgress({ type: 'conductor', roles: plan.roles.map((role) => role.label) });
  }

  // 4. parallel fan-out with per-model timeout — one slow model never blocks
  // the council; timed-out / failed models are simply dropped from the panel.
  if (opts.fleet) {
    if (peers.length === 0) onProgress({ type: 'fleet_no_peers' });
    else onProgress({ type: 'fleet_consulting', peerCount: peers.length });
  }
  // Start local models and Fleet peers in one wave. The old two-wave layout
  // waited for every local timeout before even contacting another machine.
  const localRound = Promise.allSettled(
    picked.map(async (p, index): Promise<CouncilAnswer> => {
      const client = deps.clientFactory(p.c);
      const t0 = Date.now();
      const prompt = buildCouncilPrompt(task, plan, index);
      const controller = new AbortController();
      const resp = await withTimeout(
        client.chat([{ role: 'user', content: prompt }], { signal: controller.signal }),
        timeoutMs,
        p.c.model,
        controller,
      );
      // Council answers bypass the agent-executor, so leakage tokens
      // (<think>, CJK artifacts, zero-width chars) must be stripped here.
      const content = sanitizeModelOutput(resp.content);
      if (!content.trim()) throw new Error('réponse vide');
      return {
        source: { kind: 'local', provider: p.c.provider, model: p.c.model },
        displayName: p.c.model,
        ...(plan.roles[index] ? { role: plan.roles[index] } : {}),
        content,
        latencyMs: Date.now() - t0,
        tokensUsed: resp.totalTokens,
        costUsd: (resp.promptTokens / 1_000_000) * p.c.costInputUsdPerMtok,
      };
    }),
  );
  const peerRound =
    opts.fleet && peers.length > 0
      ? gatherPeerAnswers(
          task,
          peers,
          deps.peerTimeoutMs ?? opts.peerTimeoutMs ?? timeoutMs,
          {
            promptForPeer: (_peer, index) =>
              buildCouncilPrompt(task, plan, picked.length + index),
            roleForPeer: (_peer, index) => plan.roles[picked.length + index],
          },
        )
      : Promise.resolve({
          answers: [],
          errors: [] as Array<{ id: string; message: string }>,
        });
  const [settled, peerResult] = await Promise.all([localRound, peerRound]);
  const answers: CouncilAnswer[] = [];
  const failures: Array<{ source: string; error: string }> = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      answers.push(s.value);
    } else {
      const error = s.reason instanceof Error ? s.reason.message : String(s.reason);
      failures.push({ source: picked[i]!.c.model, error });
      onProgress({ type: 'answer_failed', source: picked[i]!.c.model, error });
      // A dead model (404 / timeout / empty reply) must stop being re-seated:
      // record the failure UNCONDITIONALLY — observing a failure needs no
      // judge, and without this a retired catalog model with a strong name
      // heuristic would occupy a panel seat forever (only successes used to
      // be recorded). Failed records bias selection down without polluting
      // the quality stats (see OutcomeRecord.failed).
      try {
        scoreboard.recordOutcome({
          at: (deps.now?.() ?? new Date()).toISOString(),
          taskType,
          model: picked[i]!.c.model,
          provider: picked[i]!.c.provider,
          won: false,
          quality: 0,
          latencyMs: 0,
          costUsd: 0,
          failed: true,
        });
      } catch {
        /* the ledger must never block the council */
      }
    }
  });

  // Fleet — fold peer answers into the SAME judged set (judge/consensus/
  // scoreboard are source-agnostic: they score answers, not their origin).
  if (opts.fleet && peers.length > 0) {
    for (const a of peerResult.answers) {
      answers.push({
        source: { kind: 'peer', peerId: a.modelId, model: a.modelName },
        displayName: a.modelName,
        ...(a.role ? { role: a.role } : {}),
        content: a.content,
        latencyMs: a.latency,
        tokensUsed: a.tokensUsed,
        costUsd: a.cost,
      });
    }
    for (const e of peerResult.errors) {
      failures.push({ source: e.id, error: e.message });
      onProgress({ type: 'answer_failed', source: e.id, error: e.message });
    }
  }

  if (answers.length === 0) {
    throw new CouncilError('all-failed', 'all council models failed');
  }

  // 5. judge — strict neutrality for learning, availability for display: when
  // no neutral judge exists we still judge with the top panel member, but the
  // verdict is flagged non-neutral and never trains the scoreboard. Models
  // whose recent history is consecutive failures are excluded from the seat,
  // and a judge whose CALL fails is penalised then REPLACED within the same
  // run — a dead judge must not cost a whole deliberation.
  const pickedModels = new Set(picked.map((p) => p.c.model));
  const answersForJudge = answers.map((a) => ({
    content: a.content,
    ...(a.role?.label ? { roleLabel: a.role.label } : {}),
  }));
  const excludedJudges = new Set<string>();
  let verdict: JudgeVerdict = {
    kind: 'abstained',
    winnerIdx: null,
    scores: answers.map(() => 0),
    roleScores: answers.map(() => 0),
    rationale: '(aucun juge disponible)',
    verified: '',
    judgeModel: null,
    neutral: false,
  };
  let judgeClient: CouncilChatClient | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    let selection = selectNeutralJudge(
      candidates.filter((c) => !excludedJudges.has(c.model)),
      pickedModels,
      attempt === 0 ? opts.judge : undefined,
      scoreboard,
    );
    if (!selection && attempt === 0 && picked[0]) {
      selection = { candidate: picked[0].c, neutral: false };
    }
    if (!selection) break;

    const client = safeClient(deps, selection.candidate);
    if (!client) {
      excludedJudges.add(selection.candidate.model);
      continue;
    }
    const attemptVerdict = await judgeAnswers(
      client,
      task,
      answersForJudge,
      { timeoutMs, judgeModel: selection.candidate.model, neutral: selection.neutral },
      rng,
    );
    if (attemptVerdict.judgeCallFailed) {
      // Dead judge: penalise it (so future selections skip it) and retry once.
      try {
        scoreboard.recordOutcome({
          at: (deps.now?.() ?? new Date()).toISOString(),
          taskType,
          model: selection.candidate.model,
          provider: selection.candidate.provider,
          won: false,
          quality: 0,
          latencyMs: 0,
          costUsd: 0,
          failed: true,
        });
      } catch {
        /* the ledger must never block the council */
      }
      excludedJudges.add(selection.candidate.model);
      verdict = attemptVerdict; // kept if the retry finds no judge either
      continue;
    }
    verdict = attemptVerdict;
    judgeClient = client;
    break;
  }

  // 7. lexical consensus (weak, informational signal)
  const sources: ConsensusSource[] = answers.map((a) => ({ peerId: sourceId(a), model: a.displayName, text: a.content }));
  const consensus = computeTextConsensus(sources);
  const signals = computeCouncilDecisionSignals(verdict.scores, verdict.winnerIdx, consensus.score, {
    collective: plan.mode === 'collective',
  });

  // 6. collective synthesis
  const synthesisCandidates: CouncilSynthesisCandidate[] = answers.map((answer, index) => ({
    modelName: answer.displayName,
    ...(answer.role?.label ? { roleLabel: answer.role.label } : {}),
    score: verdict.scores[index] ?? 0,
    winner: index === verdict.winnerIdx,
    content: answer.content,
  }));
  const synthesis =
    opts.synthesis !== false && plan.mode === 'collective' && answers.length > 1 && judgeClient
      ? await synthesizeCouncilAnswer(judgeClient, task, synthesisCandidates, consensus.score, signals, timeoutMs)
      : null;

  // 8. learn — only from a neutral judge's parsed verdict on a non-low-confidence run
  const learnable = verdict.kind === 'judged' && verdict.neutral;
  const learned = shouldRecordCouncilLearning(learnable, signals.confidence);
  let learnSkipReason: string | undefined;
  if (learned) {
    const at = (deps.now?.() ?? new Date()).toISOString();
    answers.forEach((answer, i) => {
      scoreboard.recordOutcome({
        at,
        taskType,
        model: answer.displayName,
        provider: sourceId(answer),
        ...(answer.role?.id ? { role: answer.role.id } : {}),
        won: i === verdict.winnerIdx,
        quality: verdict.scores[i] ?? 0,
        roleQuality: verdict.roleScores[i] ?? verdict.scores[i] ?? 0,
        latencyMs: answer.latencyMs,
        costUsd: answer.costUsd,
      });
    });
  } else {
    learnSkipReason =
      verdict.kind !== 'judged'
        ? 'juge abstenu ou indisponible'
        : !verdict.neutral
          ? 'juge non neutre (membre du panel)'
          : 'confiance basse';
  }

  const winner = verdict.winnerIdx !== null ? answers[verdict.winnerIdx] : undefined;
  const finalText = synthesis ?? winner?.content.trim() ?? labelledConcat(answers);

  // Deliberation Health Index — measures the QUALITY of this deliberation
  // (panel survival, judge aliveness, stance divergence, dissent retention,
  // winner anchoring). Pure computation; persistence is the host's sink.
  const health = computeDeliberationHealth({
    at: (deps.now?.() ?? new Date()).toISOString(),
    taskType,
    planMode: plan.mode,
    seats: picked.length + peers.length,
    answers: answers.map((a, i) => ({ content: a.content, winner: i === verdict.winnerIdx })),
    judgeAlive: verdict.kind === 'judged' && verdict.neutral,
    scores: verdict.scores,
    consensusScore: consensus.score,
    synthesis,
  });
  try {
    deps.healthSink?.(health);
  } catch {
    /* the health ledger must never block the council */
  }

  return {
    taskType,
    plan,
    answers,
    failures,
    verdict,
    consensus,
    signals,
    synthesis,
    finalText,
    learned,
    ...(learnSkipReason ? { learnSkipReason } : {}),
    health,
  };
}
