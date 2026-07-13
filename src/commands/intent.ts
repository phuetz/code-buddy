/**
 * `buddy intent` — inspect the Code Buddy 2.0 Intent Graph and Proof Ledger.
 * Read-only by design: goal mutations stay under buddy goal/loop.
 */

import { Command, InvalidArgumentError } from 'commander';
import { getGoalManager } from '../goals/goal-manager.js';
import { buildIntentGraph, formatIntentGraph } from '../goals/intent-graph.js';
import { formatProofLedger, ProofLedger } from '../goals/proof-ledger.js';
import { deriveIntentProgress } from '../goals/criterion-progress.js';
import { ProvenOutcomeStore } from '../goals/proven-outcome-memory.js';
import { MissionConstitutionStore } from '../goals/mission-constitution.js';
import { MissionExchange } from '../goals/mission-exchange.js';
import { ShadowTwinStore } from '../goals/shadow-twin.js';

type IntentView = 'graph' | 'proofs' | 'progress' | 'integrity' | 'outcomes' | 'constitution' | 'exchange' | 'shadows';

function parseLimit(value: string): number {
  if (!/^[1-9]\d*$/.test(value.trim())) {
    throw new InvalidArgumentError('--limit must be a positive integer');
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit)) {
    throw new InvalidArgumentError('--limit must be a safe integer');
  }
  return limit;
}

export function createIntentCommand(): Command {
  return new Command('intent')
    .description('Inspect the current durable Intent Graph or its secret-redacted Proof Ledger')
    .argument('[view]', 'graph|proofs|progress|integrity|outcomes|constitution|exchange|shadows', 'graph')
    .option('--json', 'Print structured JSON')
    .option('--limit <n>', 'Maximum proof records to show', parseLimit, 100)
    .action((rawView: string, options: { json?: boolean; limit: number }) => {
      const view = rawView.toLowerCase() as IntentView;
      if (!['graph', 'proofs', 'progress', 'integrity', 'outcomes', 'constitution', 'exchange', 'shadows'].includes(view)) {
        throw new InvalidArgumentError('view must be graph, proofs, progress, integrity, outcomes, constitution, exchange or shadows');
      }

      const state = getGoalManager().state;
      if (!state) {
        console.log('No durable intent. Start one with buddy loop "<goal>" or /loop <goal>.');
        return;
      }

      if (view === 'graph') {
        const graph = buildIntentGraph(state);
        console.log(options.json ? JSON.stringify(graph, null, 2) : formatIntentGraph(graph));
        return;
      }

      if (view === 'constitution' || view === 'exchange' || view === 'shadows') {
        const graph = buildIntentGraph(state);
        const constitution = new MissionConstitutionStore(state.goalId).get(graph);
        const rehearsals = new ShadowTwinStore(state.goalId).list(options.limit);
        const value = view === 'constitution'
          ? constitution
          : view === 'shadows'
            ? rehearsals
            : new MissionExchange(state.goalId).rank(graph, constitution, rehearsals);
        if (options.json) console.log(JSON.stringify(value, null, 2));
        else if (view === 'constitution') {
          console.log(
            `Mission constitution: ${constitution.privacy} · $${constitution.maxCostUsd} · ` +
            `${constitution.maxLatencyMs}ms · reversible=${constitution.requireReversible} · approval=${constitution.approval}`,
          );
        } else if (view === 'shadows') {
          if (rehearsals.length === 0) console.log('No Shadow Twin rehearsal for this intent yet.');
          else rehearsals.forEach((entry) => console.log(
            `${entry.status === 'pass' ? '✓' : '✗'} ${entry.id} · bid ${entry.bidId} · drift ${(entry.drift.score * 100).toFixed(1)}%`,
          ));
        } else {
          const ranking = value as ReturnType<MissionExchange['rank']>;
          if (ranking.length === 0) console.log('No Mission Exchange bid for this intent yet.');
          else ranking.forEach((entry) => console.log(
            `${entry.bid.status === 'awarded' ? '◆' : '◇'} ${entry.bid.label} · score ${entry.score.toFixed(3)} · ` +
            `${entry.policy.allowed ? 'policy-ok' : 'blocked'} · ${entry.settlement.readyToAward ? 'ready' : 'not-ready'}`,
          ));
        }
        return;
      }

      const ledger = new ProofLedger(state.goalId);
      const records = ledger.list(options.limit);
      if (view === 'progress') {
        const progress = deriveIntentProgress(buildIntentGraph(state), records);
        if (options.json) {
          console.log(JSON.stringify(progress, null, 2));
        } else {
          console.log(
            `Intent progress ${progress.passed}/${progress.total} proven (${Math.round(progress.coverage * 100)}%)`,
          );
          for (const criterion of progress.criteria) {
            const glyph = criterion.status === 'passed' ? '✓' : criterion.status === 'failed' ? '✗' : '?';
            console.log(`${glyph} ${criterion.title} · ${criterion.status}/${criterion.assurance}`);
          }
        }
        return;
      }
      if (view === 'integrity') {
        const integrity = ledger.verifyIntegrity();
        console.log(
          options.json
            ? JSON.stringify(integrity, null, 2)
            : `Proof integrity: ${integrity.status} · ${integrity.checked} chained · ${integrity.legacy} legacy` +
              (integrity.errors.length > 0 ? `\n${integrity.errors.join('\n')}` : ''),
        );
        return;
      }
      if (view === 'outcomes') {
        const outcomes = new ProvenOutcomeStore().list(state.goalId, options.limit);
        if (options.json) {
          console.log(JSON.stringify(outcomes, null, 2));
        } else if (outcomes.length === 0) {
          console.log('No proven outcome for this intent yet.');
        } else {
          for (const outcome of outcomes) {
            console.log(
              `◉ ${outcome.id} · trust ${outcome.trustScore.toFixed(2)} · ` +
              `${outcome.criteria.length} criterion/criteria · ${outcome.artifacts.length} artifact(s)`,
            );
          }
        }
        return;
      }
      if (options.json) {
        console.log(JSON.stringify({
          goalId: state.goalId,
          ledgerPath: ledger.getFilePath(),
          records,
        }, null, 2));
      } else {
        console.log(`Proof Ledger ${state.goalId} · ${ledger.getFilePath()}`);
        console.log(formatProofLedger(records));
      }
    });
}
