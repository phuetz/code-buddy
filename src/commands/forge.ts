import { Command, InvalidArgumentError } from 'commander';
import { CounterfactualForge, type CounterfactualBranch } from '../goals/counterfactual-forge.js';
import { getGoalManager } from '../goals/goal-manager.js';
import { buildIntentGraph } from '../goals/intent-graph.js';
import { ProofLedger } from '../goals/proof-ledger.js';

function numberOption(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new InvalidArgumentError('value must be a non-negative number');
  return parsed;
}

function currentForge(): { forge: CounterfactualForge; graph: ReturnType<typeof buildIntentGraph> } {
  const state = getGoalManager().state;
  if (!state) throw new Error('No durable intent. Start one with buddy loop "<goal>" first.');
  return { forge: new CounterfactualForge(state.goalId), graph: buildIntentGraph(state) };
}

function formatBranch(branch: CounterfactualBranch): string {
  const metrics = branch.metrics;
  return `${branch.status === 'selected' ? '◆' : '◇'} ${branch.id} · ${branch.label} · ${branch.status}` +
    (metrics
      ? ` · score ${metrics.score.toFixed(3)} · proof ${Math.round(metrics.proofCoverage * 100)}%` +
        (metrics.eligible ? ' · eligible' : ' · not eligible')
      : '');
}

export function createForgeCommand(): Command {
  const command = new Command('forge')
    .description('Compare counterfactual strategies against one shared Intent Graph proof contract');

  command
    .command('create')
    .description('Create a planned counterfactual branch')
    .argument('<label>', 'Short branch label')
    .requiredOption('--hypothesis <text>', 'What this branch expects to improve')
    .requiredOption('--strategy <text>', 'Execution strategy to test')
    .option('--parent <branchId>', 'Parent branch lineage')
    .action((label: string, options: { hypothesis: string; strategy: string; parent?: string }) => {
      const { forge, graph } = currentForge();
      const branch = forge.create(graph, {
        label,
        hypothesis: options.hypothesis,
        strategy: options.strategy,
        ...(options.parent ? { parentBranchId: options.parent } : {}),
      });
      console.log(formatBranch(branch));
    });

  command
    .command('evaluate')
    .description('Score a branch from the current intent Proof Ledger')
    .argument('<branchId>')
    .option('--proof <proofId...>', 'Restrict evaluation to selected proof ids')
    .option('--quality <0..1>', 'External quality score', numberOption)
    .option('--latency-ms <n>', 'Measured latency', numberOption)
    .option('--cost-usd <n>', 'Measured cost', numberOption)
    .option('--regression <text...>', 'Known regressions')
    .action((branchId: string, options: {
      proof?: string[];
      quality?: number;
      latencyMs?: number;
      costUsd?: number;
      regression?: string[];
    }) => {
      const { forge, graph } = currentForge();
      const proofs = new ProofLedger(graph.goalId).list(1000);
      const branch = forge.evaluate(branchId, {
        graph,
        proofs,
        ...(options.proof ? { proofIds: options.proof } : {}),
        ...(options.quality !== undefined ? { quality: options.quality } : {}),
        ...(options.latencyMs !== undefined ? { latencyMs: options.latencyMs } : {}),
        ...(options.costUsd !== undefined ? { costUsd: options.costUsd } : {}),
        ...(options.regression ? { regressions: options.regression } : {}),
      });
      console.log(formatBranch(branch));
    });

  command
    .command('compare')
    .description('Rank every counterfactual branch')
    .option('--json', 'Print structured JSON')
    .action((options: { json?: boolean }) => {
      const { forge } = currentForge();
      const branches = forge.list().sort(
        (left, right) => (right.metrics?.score ?? -1) - (left.metrics?.score ?? -1),
      );
      if (options.json) console.log(JSON.stringify(branches, null, 2));
      else if (branches.length === 0) console.log('No counterfactual branch yet.');
      else branches.forEach((branch) => console.log(formatBranch(branch)));
    });

  command
    .command('select')
    .description('Select an eligible winner; omit id to choose the best score')
    .argument('[branchId]')
    .action((branchId?: string) => {
      const { forge } = currentForge();
      const winner = forge.select(branchId);
      if (!winner) throw new Error('No eligible branch. Full criterion proof coverage is required.');
      console.log(`Selected ${formatBranch(winner)}`);
    });

  return command;
}
