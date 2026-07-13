import { Command, InvalidArgumentError } from 'commander';
import { CounterfactualForge } from '../goals/counterfactual-forge.js';
import { getGoalManager } from '../goals/goal-manager.js';
import { buildIntentGraph } from '../goals/intent-graph.js';
import { MissionConstitutionStore, type MissionApprovalPolicy, type MissionPrivacy, type MissionRiskLevel } from '../goals/mission-constitution.js';
import { MissionExchange, type MissionBidEvaluation } from '../goals/mission-exchange.js';
import { ShadowTwinStore } from '../goals/shadow-twin.js';

function nonNegative(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new InvalidArgumentError('value must be non-negative');
  return parsed;
}

function unit(value: string): number {
  const parsed = nonNegative(value);
  if (parsed > 1) throw new InvalidArgumentError('value must be between 0 and 1');
  return parsed;
}

function choice<T extends string>(value: string, choices: readonly T[], label: string): T {
  if (!choices.includes(value as T)) throw new InvalidArgumentError(`${label} must be ${choices.join(', ')}`);
  return value as T;
}

function currentExchange() {
  const state = getGoalManager().state;
  if (!state) throw new Error('No durable intent. Start one with buddy loop "<goal>" first.');
  const graph = buildIntentGraph(state);
  return {
    state,
    graph,
    constitutionStore: new MissionConstitutionStore(state.goalId),
    exchange: new MissionExchange(state.goalId),
    shadow: new ShadowTwinStore(state.goalId),
  };
}

function formatEvaluation(entry: MissionBidEvaluation): string {
  const policy = entry.policy.allowed ? 'policy-ok' : `blocked: ${entry.policy.violations.join('; ')}`;
  const settlement = entry.settlement.readyToAward ? 'ready' : 'not-ready';
  return `${entry.bid.status === 'awarded' ? '◆' : '◇'} ${entry.bid.id} · ${entry.bid.label} · ` +
    `${entry.bid.provider}/${entry.bid.model} · score ${entry.score.toFixed(3)} · ` +
    `${entry.pareto ? 'Pareto · ' : ''}${policy} · ${settlement}`;
}

export function createExchangeCommand(): Command {
  const command = new Command('exchange')
    .description('Sovereign execution market: constitution → bids → Shadow Twin → proof-gated award');

  command
    .command('constitution')
    .description('Inspect or update the mission autonomy constitution')
    .option('--privacy <mode>', 'local-only|private-peers|cloud-allowed')
    .option('--budget-usd <n>', 'Maximum mission cost', nonNegative)
    .option('--latency-ms <n>', 'Maximum predicted p95 latency', nonNegative)
    .option('--require-reversible', 'Require a checkpoint and validated rollback')
    .option('--allow-irreversible', 'Allow irreversible bids')
    .option('--approval <mode>', 'never|on-risk|always')
    .option('--max-risk <level>', 'low|medium|high')
    .option('--json', 'Print structured JSON')
    .action((options: {
      privacy?: string;
      budgetUsd?: number;
      latencyMs?: number;
      requireReversible?: boolean;
      allowIrreversible?: boolean;
      approval?: string;
      maxRisk?: string;
      json?: boolean;
    }) => {
      if (options.requireReversible && options.allowIrreversible) {
        throw new InvalidArgumentError('choose either --require-reversible or --allow-irreversible');
      }
      const { graph, constitutionStore } = currentExchange();
      const shouldUpdate = [
        options.privacy,
        options.budgetUsd,
        options.latencyMs,
        options.requireReversible,
        options.allowIrreversible,
        options.approval,
        options.maxRisk,
      ].some((value) => value !== undefined);
      const constitution = shouldUpdate
        ? constitutionStore.set(graph, {
            ...(options.privacy ? { privacy: choice(options.privacy, ['local-only', 'private-peers', 'cloud-allowed'] as const, 'privacy') as MissionPrivacy } : {}),
            ...(options.budgetUsd !== undefined ? { maxCostUsd: options.budgetUsd } : {}),
            ...(options.latencyMs !== undefined ? { maxLatencyMs: options.latencyMs } : {}),
            ...(options.requireReversible ? { requireReversible: true } : {}),
            ...(options.allowIrreversible ? { requireReversible: false } : {}),
            ...(options.approval ? { approval: choice(options.approval, ['never', 'on-risk', 'always'] as const, 'approval') as MissionApprovalPolicy } : {}),
            ...(options.maxRisk ? { maxRisk: choice(options.maxRisk, ['low', 'medium', 'high'] as const, 'max-risk') as MissionRiskLevel } : {}),
          })
        : constitutionStore.get(graph);
      console.log(options.json ? JSON.stringify(constitution, null, 2) :
        `Constitution ${constitution.privacy} · $${constitution.maxCostUsd} · ${constitution.maxLatencyMs}ms · ` +
        `${constitution.requireReversible ? 'reversible' : 'irreversible allowed'} · approval ${constitution.approval}`);
    });

  command
    .command('bid')
    .description('Submit a model or fleet offer against the current intent contract')
    .argument('<label>')
    .requiredOption('--provider <id>')
    .requiredOption('--model <id>')
    .requiredOption('--strategy <text>')
    .requiredOption('--hypothesis <text>')
    .requiredOption('--evidence-plan <text>')
    .requiredOption('--quality <0..1>', 'Predicted quality', unit)
    .requiredOption('--latency-ms <n>', 'Predicted p95 latency', nonNegative)
    .requiredOption('--cost-usd <n>', 'Predicted cost', nonNegative)
    .requiredOption('--privacy <mode>', 'local|private|cloud')
    .requiredOption('--risk <level>', 'low|medium|high')
    .option('--criterion <id...>', 'Acceptance criteria covered by the proof plan')
    .option('--irreversible', 'Declare that the strategy cannot be rolled back')
    .action((label: string, options: {
      provider: string;
      model: string;
      strategy: string;
      hypothesis: string;
      evidencePlan: string;
      quality: number;
      latencyMs: number;
      costUsd: number;
      privacy: string;
      risk: string;
      criterion?: string[];
      irreversible?: boolean;
    }) => {
      const { graph, exchange } = currentExchange();
      const bid = exchange.submit(graph, {
        label,
        provider: options.provider,
        model: options.model,
        strategy: options.strategy,
        hypothesis: options.hypothesis,
        evidencePlan: options.evidencePlan,
        ...(options.criterion ? { criterionIds: options.criterion } : {}),
        prediction: { quality: options.quality, latencyMs: options.latencyMs, costUsd: options.costUsd },
        privacy: choice(options.privacy, ['local', 'private', 'cloud'] as const, 'privacy'),
        reversible: !options.irreversible,
        risk: choice(options.risk, ['low', 'medium', 'high'] as const, 'risk'),
      });
      console.log(`Submitted ${bid.id} · ${bid.label}`);
    });

  command
    .command('rank')
    .description('Rank bids on the policy-compatible Pareto frontier')
    .option('--json', 'Print structured JSON')
    .action((options: { json?: boolean }) => {
      const { graph, constitutionStore, exchange, shadow } = currentExchange();
      const ranking = exchange.rank(graph, constitutionStore.get(graph), shadow.list(1000));
      if (options.json) console.log(JSON.stringify(ranking, null, 2));
      else if (ranking.length === 0) console.log('No mission bid yet.');
      else ranking.forEach((entry) => console.log(formatEvaluation(entry)));
    });

  command
    .command('rehearse')
    .description('Record measured Shadow Twin observations for a bid')
    .argument('<bidId>')
    .requiredOption('--quality <0..1>', 'Observed quality', unit)
    .requiredOption('--latency-ms <n>', 'Observed p95 latency', nonNegative)
    .requiredOption('--cost-usd <n>', 'Observed cost', nonNegative)
    .option('--max-drift <0..1>', 'Maximum acceptable prediction drift', unit, 0.1)
    .option('--checkpoint', 'A checkpoint was captured')
    .option('--rollback', 'Rollback was executed successfully')
    .option('--no-persistent-side-effects', 'No persistent side effects were detected')
    .action((bidId: string, options: {
      quality: number;
      latencyMs: number;
      costUsd: number;
      maxDrift: number;
      checkpoint?: boolean;
      rollback?: boolean;
      persistentSideEffects?: boolean;
    }) => {
      const { graph, exchange, shadow } = currentExchange();
      const bid = exchange.get(bidId);
      if (!bid) throw new Error(`mission bid not found: ${bidId}`);
      const rehearsal = shadow.record(graph, {
        bidId,
        prediction: bid.prediction,
        observation: { quality: options.quality, latencyMs: options.latencyMs, costUsd: options.costUsd },
        reversibility: {
          checkpointTaken: options.checkpoint === true,
          rollbackValidated: options.rollback === true,
          noPersistentSideEffects: options.persistentSideEffects === false,
        },
        maxDrift: options.maxDrift,
      });
      exchange.linkRehearsal(bid.id, rehearsal);
      console.log(`Shadow ${rehearsal.status} · drift ${(rehearsal.drift.score * 100).toFixed(1)}% · ${rehearsal.id}`);
    });

  command
    .command('award')
    .description('Award a ready bid and create its proof-gated Forge branch')
    .argument('<bidId>')
    .option('--approve', 'Explicit human approval when the constitution requires it')
    .action((bidId: string, options: { approve?: boolean }) => {
      const { state, graph, constitutionStore, exchange, shadow } = currentExchange();
      const forge = new CounterfactualForge(state.goalId);
      const awarded = exchange.award(
        graph,
        constitutionStore.get(graph),
        shadow.list(1000),
        bidId,
        {
          humanApproved: options.approve === true,
          createForgeBranch: (bid) => forge.create(graph, {
            label: bid.label,
            hypothesis: bid.hypothesis,
            strategy: bid.strategy,
          }).id,
        },
      );
      console.log(`Awarded ${awarded.id} · Forge ${awarded.forgeBranchId}`);
    });

  command
    .command('reject')
    .description('Reject a bid without mutating the intent contract')
    .argument('<bidId>')
    .action((bidId: string) => {
      const { exchange } = currentExchange();
      console.log(`Rejected ${exchange.reject(bidId).id}`);
    });

  return command;
}
