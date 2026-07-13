import { Command, InvalidArgumentError } from 'commander';
import { getGoalManager } from '../goals/goal-manager.js';
import { buildIntentGraph } from '../goals/intent-graph.js';
import { MissionConstitutionStore } from '../goals/mission-constitution.js';
import { MissionExchange } from '../goals/mission-exchange.js';
import { OutcomeCapsuleStore, type OutcomeCapsuleParameter } from '../goals/outcome-capsule.js';
import { ProvenOutcomeStore } from '../goals/proven-outcome-memory.js';
import { ShadowTwinStore } from '../goals/shadow-twin.js';

function currentCapsules() {
  const state = getGoalManager().state;
  if (!state) throw new Error('No durable intent. Start one with buddy loop "<goal>" first.');
  const graph = buildIntentGraph(state);
  const constitution = new MissionConstitutionStore(state.goalId).get(graph);
  const exchange = new MissionExchange(state.goalId);
  const evaluations = exchange.rank(graph, constitution, new ShadowTwinStore(state.goalId).list(1000));
  return {
    state,
    graph,
    constitution,
    evaluations,
    outcomes: new ProvenOutcomeStore().list(state.goalId, 100),
    capsules: new OutcomeCapsuleStore(),
  };
}

function parseParameters(value: string): OutcomeCapsuleParameter[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed as OutcomeCapsuleParameter[];
  } catch (error) {
    throw new InvalidArgumentError(`parameters must be a JSON array: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function createCapsuleCommand(): Command {
  const command = new Command('capsule')
    .description('Proof-backed portable workflows compiled from proven outcomes');

  command
    .command('list')
    .option('--json', 'Print structured JSON')
    .action((options: { json?: boolean }) => {
      const { state, capsules } = currentCapsules();
      const items = capsules.list(state.goalId);
      if (options.json) console.log(JSON.stringify(items, null, 2));
      else if (items.length === 0) console.log('No outcome capsule yet.');
      else items.forEach((capsule) => console.log(
        `${capsule.status === 'active' ? '◆' : '◇'} ${capsule.id} · ${capsule.title} · ` +
        `${capsule.portability.distinctRuntimes}/${capsule.portability.requiredRuntimes} runtimes · ${capsule.status}`,
      ));
    });

  command
    .command('create')
    .description('Compile the latest proven outcome into a portable capsule')
    .option('--outcome <id>', 'Specific proven outcome id')
    .option('--title <text>')
    .option('--description <text>')
    .option('--parameters <json>', 'JSON array of typed parameter definitions', parseParameters, [])
    .option('--required-runtimes <n>', 'Passing distinct runtimes required', (value) => {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 2 || parsed > 5) throw new InvalidArgumentError('required-runtimes must be 2..5');
      return parsed;
    }, 2)
    .action((options: {
      outcome?: string;
      title?: string;
      description?: string;
      parameters: OutcomeCapsuleParameter[];
      requiredRuntimes: number;
    }) => {
      const { constitution, evaluations, outcomes, capsules } = currentCapsules();
      const outcome = options.outcome ? outcomes.find((entry) => entry.id === options.outcome) : outcomes[0];
      if (!outcome) throw new Error('No proven outcome. Complete a proof-gated loop first.');
      const capsule = capsules.create({
        outcome,
        constitution,
        evaluations,
        ...(options.title ? { title: options.title } : {}),
        ...(options.description ? { description: options.description } : {}),
        parameters: options.parameters,
        requiredRuntimes: options.requiredRuntimes,
      });
      console.log(`Capsule ${capsule.status} · ${capsule.id} · ${capsule.portability.distinctRuntimes}/${capsule.portability.requiredRuntimes} runtimes`);
    });

  command
    .command('activate')
    .argument('<id>')
    .option('--approve', 'Explicit human approval')
    .action((id: string, options: { approve?: boolean }) => {
      const { capsules } = currentCapsules();
      console.log(`Activated ${capsules.activate(id, options.approve === true).id}`);
    });

  command
    .command('revoke')
    .argument('<id>')
    .action((id: string) => {
      const { capsules } = currentCapsules();
      console.log(`Revoked ${capsules.revoke(id).id}`);
    });

  return command;
}
