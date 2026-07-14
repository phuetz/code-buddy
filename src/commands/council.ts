/**
 * `buddy council "<task>"` — CLI presenter over the council engine.
 *
 * The 8-step deliberation pipeline lives in `src/council/council-engine.ts`
 * (host-agnostic, returns a `CouncilRunResult`); this module only wires the
 * default dependencies (active-LLM registry, scoreboard, `CodeBuddyClient`,
 * fleet peers) and renders the result for the terminal. The pure council
 * building blocks are re-exported below so existing importers keep working.
 */

import { CodeBuddyClient } from '../codebuddy/client.js';
import { getModelScoreboard } from '../fleet/model-scoreboard.js';
import { runCouncilPipeline } from '../council/council-engine.js';
import { buildCouncilVerificationHint } from '../council/signals.js';
import { appendDeliberationHealth } from '../council/deliberation-health.js';
import {
  CouncilError,
  type CouncilCandidate,
  type CouncilChatClient,
  type CouncilOptions,
  type CouncilPeer,
  type CouncilProgressEvent,
  type CouncilRunResult,
} from '../council/types.js';

// --- re-exports (compat: tests + other hosts import these from here) ---
export { gatherPeerAnswers } from '../council/peers.js';
export {
  assignCouncilRolesToCandidates,
  buildCouncilConductorPlan,
  buildCouncilPrompt,
} from '../council/conductor.js';
export {
  buildCouncilSynthesisPrompt,
  buildCouncilVerificationHint,
  computeCouncilDecisionSignals,
  shouldRecordCouncilLearning,
} from '../council/signals.js';
export { runCouncilPipeline } from '../council/council-engine.js';
export {
  CouncilError,
  type CouncilAnswer,
  type CouncilConductorPlan,
  type CouncilDecisionSignals,
  type CouncilEngineDeps,
  type CouncilOptions,
  type CouncilPeer,
  type CouncilProgressEvent,
  type CouncilRole,
  type CouncilRunResult,
  type CouncilSynthesisCandidate,
  type CouncilSynthesisPrompt,
  type GatherPeerAnswersOptions,
  type JudgeVerdict,
  type PeerAnswer,
  type RankedCandidate,
} from '../council/types.js';

type Emit = (s: string) => void;

/** Adapt `CodeBuddyClient` to the engine's minimal chat surface. */
function toCouncilClient(c: CouncilCandidate): CouncilChatClient {
  const client = new CodeBuddyClient(c.apiKey ?? '', c.model, c.baseURL);
  return {
    async chat(messages, options) {
      const resp = await client.chat(messages, [], { signal: options?.signal });
      return {
        content: resp?.choices?.[0]?.message?.content ?? '',
        promptTokens: resp?.usage?.prompt_tokens ?? 0,
        totalTokens: resp?.usage?.total_tokens ?? 0,
      };
    },
  };
}

async function loadDefaultRegistry(): Promise<CouncilCandidate[]> {
  // Multi-model pool: every ACTIVE provider expanded to its catalog models
  // (cloud) / installed models (local). CODEBUDDY_COUNCIL_POOL=registry
  // falls back to the legacy one-model-per-provider set.
  const { listActiveLlmModelPool } = await import('../providers/active-llm-model-pool.js');
  return listActiveLlmModelPool();
}

async function loadDefaultPeers(opts: CouncilOptions): Promise<CouncilPeer[]> {
  if (!opts.fleet) return [];
  if (opts.fleetPeers) return opts.fleetPeers;
  try {
    const { getFleetRegistry } = await import('../fleet/fleet-registry.js');
    return getFleetRegistry().list().map((e) => ({ id: e.id, listener: e.listener }));
  } catch {
    return [];
  }
}

function renderProgress(event: CouncilProgressEvent, out: Emit): void {
  switch (event.type) {
    case 'panel': {
      const panelSize =
        event.peerCount > 0
          ? `${event.entries.length} locale(s) + ${event.peerCount} pair(s)`
          : `${event.entries.length}`;
      out(
        `🧠 Council — tâche "${event.taskType}" → ${panelSize} IA : ` +
          event.entries
            .map((e) => `${e.model}${e.histWinRate > 0 ? ` (${Math.round(e.histWinRate * 100)}% hist)` : ''}`)
            .join(', '),
      );
      if (event.explored) {
        out(`🎲 Exploration — ${event.explored} rejoint le panel pour étoffer son historique.`);
      }
      break;
    }
    case 'conductor':
      out(`🧭 Conductor — ${event.roles.join(' · ')}`);
      break;
    case 'fleet_no_peers':
      out("🛰️  Fleet — aucun pair connecté (lance `/fleet listen ws://… --jwt …` d'abord).");
      break;
    case 'fleet_consulting':
      out(`🛰️  Fleet — ${event.peerCount} machine(s) distante(s) consultée(s)…`);
      break;
    case 'answer_failed':
      out(`  ⚠️ ${event.source}: ${event.error.slice(0, 120)}`);
      break;
    case 'triage':
      if (event.decision === 'single') {
        out(
          `⚡ Triage — question jugée simple, réponse mono-modèle` +
            `${event.model ? ` (${event.model})` : ''}` +
            `${event.reason ? ` : ${event.reason}` : ''} — fan-out council évité.`,
        );
      } else {
        out(`⚡ Triage — question complexe, délibération council complète${event.reason ? ` : ${event.reason}` : ''}.`);
      }
      break;
  }
}

function renderResult(result: CouncilRunResult, opts: CouncilOptions, out: Emit): void {
  const { verdict, signals, consensus } = result;

  // Triaged (single-model) short-circuit: render the answer plainly, no council
  // scaffolding (no lexical-agreement / DHI lines apply to one answer).
  if (result.triaged) {
    const answer = result.answers[0];
    out(
      `\n⚡ Réponse mono-modèle (triage${result.singleModel ? ` · ${result.singleModel}` : ''})` +
        `${result.triageReason ? ` — ${result.triageReason}` : ''}\n`,
    );
    out((answer?.content ?? result.finalText).trim());
    out('\nℹ️  Council complet non convoqué (question jugée simple). Réglez `CODEBUDDY_COUNCIL_TRIAGE` pour changer.');
    return;
  }

  if (!result.learned) {
    out(`\n📊 Apprentissage council ignoré (${result.learnSkipReason ?? 'signal non fiable'}).`);
  }

  const winner = verdict.winnerIdx !== null ? result.answers[verdict.winnerIdx] : undefined;
  if (result.synthesis) {
    out(`\n🧬 Synthèse collective — ${result.answers.length} réponses spécialisées\n`);
    out(result.synthesis.trim());
    if (winner) {
      out(`\n🏆 Référence du juge — ${winner.displayName}${verdict.rationale ? ` : ${verdict.rationale}` : ''}`);
    } else {
      out(`\n⚖️ Juge abstenu — ${verdict.rationale}`);
    }
  } else if (winner) {
    out(`\n🏆 Meilleure réponse — ${winner.displayName}${verdict.rationale ? ` : ${verdict.rationale}` : ''}\n`);
    out(winner.content.trim());
  } else {
    out(`\n⚖️ Pas de verdict fiable — ${verdict.rationale}`);
    out(`Toutes les réponses ci-dessous, à évaluer soi-même :\n`);
    out(result.finalText);
  }

  if (opts.consensus !== false && result.answers.length > 1) {
    const pct = Math.round(consensus.score * 100);
    // Jaccard word-overlap on free-form prose is informational, NOT a verdict:
    // two good answers phrased differently legitimately score low. The judge
    // above is the real quality evaluator; this just flags how lexically close
    // the wordings were (high overlap ⇒ the models genuinely converged).
    out(`\n🤝 Accord lexical inter-IA : ${pct}% (recouvrement de mots — le juge ci-dessus évalue le fond).`);
  }
  out(
    `\n🧭 Confiance council : ${signals.confidence} ` +
      `(marge juge ${signals.margin.toFixed(2)}, accord ${Math.round(signals.consensusScore * 100)}% — ` +
      `${signals.reasons.join('; ')})`,
  );
  if (verdict.judgeModel) {
    out(`⚖️ Juge : ${verdict.judgeModel}${verdict.neutral ? '' : ' (membre du panel — verdict non appris)'}`);
  }
  if (verdict.verified) {
    out(`🔬 Vérifié par le juge : ${verdict.verified}`);
  }
  const h = result.health;
  const healthDetails = [
    `divergence ${Math.round(h.stanceDivergence * 100)}%`,
    `discrimination juge ${h.judgeDiscrimination.toFixed(2)}`,
    ...(h.dissentRetention !== null ? [`rétention dissent ${Math.round(h.dissentRetention * 100)}%`] : []),
    ...(h.anchorRatio !== null ? [`ancrage gagnant ×${h.anchorRatio.toFixed(1)}`] : []),
  ];
  out(`🩺 Santé délibération : DHI ${h.dhi.toFixed(2)} (${healthDetails.join(', ')})`);
  const verificationHint = buildCouncilVerificationHint(signals, result.taskType);
  if (verificationHint) {
    out(`🔎 ${verificationHint}`);
  }

  out('\n📊 Détail par IA :');
  result.answers.forEach((answer, i) => {
    const mark = i === verdict.winnerIdx ? '🏆' : '  ';
    const role = answer.role?.label ? ` [${answer.role.label}]` : '';
    out(
      `${mark} ${(answer.displayName + role).padEnd(22)} score ${(verdict.scores[i] ?? 0).toFixed(2)}  ` +
        `${answer.latencyMs}ms  ${answer.tokensUsed} tok`,
    );
  });
}

export async function runCouncil(task: string, opts: CouncilOptions, out: Emit): Promise<void> {
  const scoreboard = getModelScoreboard();

  if (opts.scoreboard) {
    out(scoreboard.print(opts.taskType));
    return;
  }
  if (!task || !task.trim()) {
    out('Usage: buddy council "<task>"   (or --scoreboard to see what it has learned)');
    return;
  }

  const peers = await loadDefaultPeers(opts);
  let result: CouncilRunResult;
  try {
    result = await runCouncilPipeline(
      task,
      opts,
      {
        loadRegistry: loadDefaultRegistry,
        scoreboard,
        clientFactory: toCouncilClient,
        peers,
        healthSink: appendDeliberationHealth,
      },
      (event) => renderProgress(event, out),
    );
  } catch (err) {
    if (err instanceof CouncilError) {
      out(
        err.code === 'no-candidates'
          ? 'No active LLMs detected. Run `buddy login`, set an API key, or start Ollama.'
          : '❌ Toutes les IA ont échoué.',
      );
      return;
    }
    throw err;
  }

  renderResult(result, opts, out);
  out(`\n${scoreboard.print(result.taskType)}`);
  // A triaged run had no multi-model deliberation → no disagreement signal to
  // mine for a lesson candidate. Skip the lesson bridge entirely.
  if (!result.triaged) {
    await maybeProposeCouncilLesson(task, result, out);
  }
}

/**
 * Close the learning-loop gap with the saga council: a CLI run that carries a
 * real disagreement signal proposes a HUMAN-GATED lesson candidate (reviewed
 * via `buddy lessons`), exactly like Cowork's SagaRunner does for fleet
 * councils. Host policy lives here (not in the engine): only inside a project
 * (`.codebuddy/` must already exist — never create one in an arbitrary cwd),
 * best-effort, never blocks the council output. Note this also covers the
 * channel-handler surface (Telegram `/council`), whose candidates land in the
 * server process's project queue — reviewable the same way.
 */
async function maybeProposeCouncilLesson(task: string, result: CouncilRunResult, out: Emit): Promise<void> {
  try {
    const [{ existsSync }, path] = await Promise.all([import('node:fs'), import('node:path')]);
    const workDir = process.cwd();
    if (!existsSync(path.join(workDir, '.codebuddy'))) return;

    const { proposeFromCouncilRunResult } = await import('../agent/council-lesson-proposer.js');
    // Positions = each member's stance: the contract's first "VERDICT:" line
    // when present (guaranteed on post-contract collective runs), else the
    // answer head. This is what makes a candidate readable without reopening
    // the transcript.
    const positions = result.answers.map((answer) => {
      const firstVerdictLine = answer.content
        .split('\n')
        .map((l) => l.trim())
        .find((l) => /^verdict\s*:/i.test(l));
      return {
        label: answer.role?.label ?? answer.displayName,
        stance: (firstVerdictLine ?? answer.content.trim().slice(0, 160)).replace(/^verdict\s*:\s*/i, ''),
      };
    });
    const winner = result.verdict.winnerIdx !== null ? result.answers[result.verdict.winnerIdx] : undefined;
    const proposal = proposeFromCouncilRunResult(
      {
        task,
        planMode: result.plan.mode,
        confidence: result.signals.confidence,
        verdictKind: result.verdict.kind,
        consensus: {
          score: result.consensus.score,
          threshold: result.consensus.threshold,
          total: result.consensus.total,
          disagreements: result.consensus.disagreements,
        },
        positions,
        ...(result.verdict.kind === 'judged'
          ? {
              resolution: {
                ...(winner ? { winner: winner.role?.label ?? winner.displayName } : {}),
                ...(result.verdict.rationale ? { rationale: result.verdict.rationale } : {}),
                ...(result.verdict.verified ? { verified: result.verdict.verified } : {}),
              },
            }
          : {}),
      },
      workDir,
    );
    if (proposal.proposed && proposal.candidate) {
      out(`\n💡 Leçon candidate proposée (${proposal.candidate.id}) — désaccord du council à revoir via \`buddy lessons\`.`);
    }
  } catch {
    /* best-effort: the lesson bridge must never break the council */
  }
}
