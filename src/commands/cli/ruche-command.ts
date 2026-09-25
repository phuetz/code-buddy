import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type { Command } from 'commander';
import { laneStatuses, recordVerdict } from '../../fleet/ruche/authority.js';
import { withLocalRuche } from '../../fleet/ruche/local-store.js';

function output(operation: () => unknown): void {
  try {
    const data = operation();
    const refused = typeof data === 'object' && data !== null && 'type' in data && data.type === 'lease.deny';
    console.log(JSON.stringify({ ok: !refused, data }));
    if (refused) process.exitCode = 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ ok: false, error: message }));
    process.exitCode = 1;
  }
}

/** JSON-only local prototype; commands run against an isolated profile when configured. */
export function registerRucheCommand(program: Command): void {
  const cmd = program.command('ruche').description('Signed coordination prototype (opt-in)');
  cmd.command('status').action(() => output(() => withLocalRuche(({ authority, agentId, arbiterId }) => ({
    agentId, arbiterId, leases: authority.activeLeases(), lanes: laneStatuses(authority.journal, Date.now()),
  }))));
  cmd.command('heartbeat <lane>')
    .option('--ttl-ms <milliseconds>', 'heartbeat validity in milliseconds', '30000')
    .action((lane: string, options: { ttlMs: string }) => output(() => withLocalRuche((state) => {
      const ttlMs = Number(options.ttlMs);
      const event = state.agent.append('heartbeat', { lane, expiresAt: Date.now() + ttlMs });
      if (state.authority.journal !== state.agent) state.authority.journal.ingest(event);
      state.persist();
      return event;
    })));
  cmd.command('bail <work>')
    .option('--ttl-ms <milliseconds>', 'lease duration in milliseconds', '30000')
    .option('--request-only', 'sign a request for a remote arbiter')
    .action((work: string, options: { ttlMs: string; requestOnly?: boolean }) => output(() => withLocalRuche((state) => {
      const ttlMs = Number(options.ttlMs);
      const request = state.agent.append('lease.request', { work, ttlMs });
      if (options.requestOnly) {
        if (state.authority.journal !== state.agent) state.authority.journal.ingest(request);
        state.persist();
        return request;
      }
      const decision = state.authority.requestLease(request);
      state.persist();
      return decision;
    })));
  cmd.command('liberer <work> <token>')
    .option('--request-only', 'sign a request for a remote arbiter')
    .action((work: string, rawToken: string, options: { requestOnly?: boolean }) => output(() => withLocalRuche((state) => {
      const request = state.agent.append('lease.release.request', { work, token: Number(rawToken) });
      if (options.requestOnly) {
        if (state.authority.journal !== state.agent) state.authority.journal.ingest(request);
        state.persist();
        return request;
      }
      const result = state.authority.release(request);
      state.persist();
      return result;
    })));
  cmd.command('renouveler <work> <token>')
    .option('--ttl-ms <milliseconds>', 'lease duration in milliseconds', '30000')
    .option('--request-only', 'sign a request for a remote arbiter')
    .action((work: string, rawToken: string, options: { ttlMs: string; requestOnly?: boolean }) => output(() => withLocalRuche((state) => {
      const request = state.agent.append('lease.renew.request', { work, token: Number(rawToken), ttlMs: Number(options.ttlMs) });
      if (options.requestOnly) {
        if (state.authority.journal !== state.agent) state.authority.journal.ingest(request);
        state.persist();
        return request;
      }
      const result = state.authority.renew(request);
      state.persist();
      return result;
    })));
  cmd.command('verdict <revision> <command> <exitCode> <logFile> <reportFile>')
    .action((revision: string, command: string, rawExitCode: string, logFile: string, reportFile: string) => output(() => withLocalRuche((state) => {
      const log = fs.readFileSync(logFile);
      const report = fs.readFileSync(reportFile);
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const event = recordVerdict(state.agent, {
        revision, expectedRevision: head, command, exitCode: Number(rawExitCode), log,
        logHash: createHash('sha256').update(log).digest('hex'),
        report, reportHash: createHash('sha256').update(report).digest('hex'),
      });
      if (state.authority.journal !== state.agent) state.authority.journal.ingest(event);
      state.persist();
      return event;
    })));
  cmd.command('journal').action(() => output(() => withLocalRuche(({ authority }) => authority.journal.events())));
}
