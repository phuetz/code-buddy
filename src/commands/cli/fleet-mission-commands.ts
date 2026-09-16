import type { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MissionStore, type MissionHandoff } from '../../harness/mission-store.js';
import { runMission } from '../../harness/mission-runner.js';
import { parseSupervisorManifest } from '../../harness/fleet-supervisor.js';

/** All paths/manifests are operator input. No provider or server is booted. */
export function registerFleetMissionCommands(fleet: Command): void {
  const group = fleet.command('mission').description('Durable local mission ownership, handoff and results');
  const output = (action: (...args: string[]) => unknown) => async (...args: unknown[]) => {
    try { console.log(JSON.stringify(await action(...args.filter(a => typeof a === 'string') as string[]))); }
    catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
  };
  group.command('list <store>')
    .description('List mission metadata, with bounded pages and unreadable-record notices')
    .option('--limit <count>', 'Maximum records examined in this page (1..100)', '25')
    .option('--cursor <hash>', 'Continue after the previous page nextCursor')
    .action((directory: string, options: { limit: string; cursor?: string }) => {
      try {
        console.log(JSON.stringify(new MissionStore(directory).list({ limit: Number(options.limit), cursor: options.cursor })));
      } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
    });
  group.command('create <store> <id> <manifest> <operation>').action(output(async (directory, id, manifestPath, name) => {
    const file = path.resolve(manifestPath!);
    const manifest = parseSupervisorManifest(JSON.parse(await fs.readFile(file, 'utf8')), path.dirname(file), 43200000);
    const op = manifest.operations.get(name!);
    if (!op) throw new Error('Unknown manifest operation');
    return new MissionStore(directory!).create(id!, { command: op.command, args: op.args, timeoutMs: op.timeoutMs, workspace: manifest.workspace });
  }));
  group.command('show <store> <id>').action(output((directory, id) => new MissionStore(directory!).get(id!)));
  group.command('claim <store> <id> <owner>').action(output((directory, id, owner) => new MissionStore(directory!).claim(id!, owner!)));
  group.command('renew <store> <id> <owner> <generation>').action(output((directory, id, owner, generation) => new MissionStore(directory!).renew(id!, { owner: owner!, generation: generation! })));
  group.command('run <store> <id> <owner> <generation>').action(output(async (directory, id, owner, generation) => {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      const mission = await runMission(new MissionStore(directory!), id!, { owner: owner!, generation: generation! }, controller.signal);
      if (!mission.result?.success) process.exitCode = 1;
      return mission;
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  }));
  group.command('handoff <store> <id> <owner> <generation> <capsule>').action(output(async (directory, id, owner, generation, capsule) =>
    new MissionStore(directory!).handoff(id!, { owner: owner!, generation: generation! }, JSON.parse(await fs.readFile(capsule!, 'utf8')) as MissionHandoff)));
  group.command('reconcile <store> <id> <generation> <resolution> <evidence>').action(output((directory, id, generation, resolution, evidence) =>
    new MissionStore(directory!).reconcile(id!, generation!, resolution as 'retry' | 'completed', evidence!)));
  group.command('ack <store> <id> <consumer>').action(output((directory, id, consumer) => new MissionStore(directory!).acknowledge(id!, consumer!)));
  const head = (workspace: string) => execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: workspace, encoding: 'utf8', timeout: 5000 }).trim();
  group.command('submit <store> <id> <owner> <generation>').action(output((directory, id, owner, generation) => {
    const store = new MissionStore(directory!);
    return store.submit(id!, { owner: owner!, generation: generation! }, head(store.get(id!).operation.workspace));
  }));
  group.command('approve <store> <id> <reviewer> <commit>').action(output((directory, id, reviewer, commit) => {
    const store = new MissionStore(directory!);
    return store.approve(id!, reviewer!, commit!);
  }));
}
