/**
 * `buddy user-model` CLI command.
 *
 * Manages the local, structured user model (Hermes "deepening model of who you
 * are"). The agent (or a human) PROPOSES observations; nothing enters the
 * active model until a human accepts one — mirroring the lesson-candidate
 * review queue. Scope is working preferences only; sensitive content is refused.
 *
 * Subcommands: show, list, observe, accept, discard, clear
 */

import { Command } from 'commander';
import {
  getUserModel,
  USER_OBSERVATION_KINDS,
  UserModelPrivacyError,
} from '../memory/user-model.js';
import type { UserObservation, UserObservationKind, UserObservationStatus } from '../memory/user-model.js';

const VALID_STATUSES: UserObservationStatus[] = ['pending', 'accepted', 'discarded'];

export function createUserModelCommand(): Command {
  const cmd = new Command('user-model');
  cmd.alias('usermodel');
  cmd.description(
    'Local model of the user\'s working preferences — propose/review (no silent write, working preferences only)',
  );

  // ---- show (the active model summary) -------------------------------------
  cmd
    .command('show')
    .description('Show the active user model (accepted observations)')
    .option('--json', 'Output JSON')
    .action((opts: { json?: boolean }) => {
      const model = getUserModel(process.cwd());
      if (opts.json) {
        console.log(JSON.stringify(model.getAccepted(), null, 2));
        return;
      }
      const summary = model.summarize();
      console.log(summary ?? 'No accepted observations about the user yet.');
    });

  // ---- list ----------------------------------------------------------------
  cmd
    .command('list')
    .alias('ls')
    .description('List observations, optionally filtered by status')
    .option('-s, --status <status>', `Filter: ${VALID_STATUSES.join('|')}`)
    .option('--json', 'Output JSON')
    .action((opts: { status?: string; json?: boolean }) => {
      const status = opts.status?.toLowerCase() as UserObservationStatus | undefined;
      if (status && !VALID_STATUSES.includes(status)) {
        console.error(`Invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}`);
        process.exit(1);
      }
      const items = getUserModel(process.cwd()).list(status);
      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
        return;
      }
      if (items.length === 0) {
        console.log(status ? `No ${status} observations.` : 'No observations yet.');
        return;
      }
      for (const item of items) {
        console.log(formatObservationLine(item));
      }
    });

  // ---- observe -------------------------------------------------------------
  cmd
    .command('observe <content>')
    .description('Propose an observation about the user (does NOT write the model)')
    .option('-k, --kind <kind>', `Kind: ${USER_OBSERVATION_KINDS.join('|')}`, 'preference')
    .option('--confidence <n>', '0..1 confidence')
    .option('--note <note>', 'Provenance note')
    .action((content: string, opts: { kind: string; confidence?: string; note?: string }) => {
      const kind = opts.kind.toLowerCase() as UserObservationKind;
      if (!USER_OBSERVATION_KINDS.includes(kind)) {
        console.error(`Invalid kind: ${opts.kind}. Must be one of: ${USER_OBSERVATION_KINDS.join(', ')}`);
        process.exit(1);
      }
      try {
        const confidence = opts.confidence !== undefined ? Number(opts.confidence) : undefined;
        const { observation, deduped } = getUserModel(process.cwd()).observe({
          kind,
          content,
          ...(typeof confidence === 'number' && Number.isFinite(confidence) ? { confidence } : {}),
          source: 'manual',
          ...(opts.note ? { provenance: { note: opts.note } } : {}),
        });
        const prefix = deduped ? 'Matched existing observation' : 'Proposed observation';
        console.log(`${prefix} [${observation.id}] (${observation.kind}): ${observation.content}`);
        console.log(`Accept it with: buddy user-model accept ${observation.id} --by <name>`);
      } catch (err) {
        if (err instanceof UserModelPrivacyError) {
          console.error(err.message);
        } else {
          console.error(err instanceof Error ? err.message : String(err));
        }
        process.exit(1);
      }
    });

  // ---- accept --------------------------------------------------------------
  cmd
    .command('accept <id>')
    .description('Accept an observation into the model (requires a reviewer)')
    .requiredOption('--by <name>', 'Human reviewer accepting the observation')
    .option('--content <content>', 'Edit the observation before accepting')
    .option('-k, --kind <kind>', `Override kind: ${USER_OBSERVATION_KINDS.join('|')}`)
    .option('--note <note>', 'Reviewer note')
    .action((id: string, opts: { by: string; content?: string; kind?: string; note?: string }) => {
      const kind = opts.kind?.toLowerCase() as UserObservationKind | undefined;
      if (kind && !USER_OBSERVATION_KINDS.includes(kind)) {
        console.error(`Invalid kind: ${opts.kind}. Must be one of: ${USER_OBSERVATION_KINDS.join(', ')}`);
        process.exit(1);
      }
      try {
        const obs = getUserModel(process.cwd()).accept(id, {
          reviewedBy: opts.by,
          ...(opts.content ? { content: opts.content } : {}),
          ...(kind ? { kind } : {}),
          ...(opts.note ? { reviewNote: opts.note } : {}),
        });
        console.log(`Accepted observation ${obs.id} (${obs.kind}): ${obs.content}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---- discard -------------------------------------------------------------
  cmd
    .command('discard <id>')
    .description('Discard an observation (removes it from the model if accepted)')
    .option('--by <name>', 'Reviewer discarding the observation')
    .option('--reason <reason>', 'Why it was discarded')
    .action((id: string, opts: { by?: string; reason?: string }) => {
      try {
        const obs = getUserModel(process.cwd()).discard(id, {
          ...(opts.by ? { reviewedBy: opts.by } : {}),
          ...(opts.reason ? { reason: opts.reason } : {}),
        });
        console.log(`Discarded observation ${obs.id}.`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ---- clear ---------------------------------------------------------------
  cmd
    .command('clear')
    .description('Remove observations (all, or by status)')
    .option('-s, --status <status>', `Remove only this status: ${VALID_STATUSES.join('|')}`)
    .option('-y, --yes', 'Skip confirmation prompt')
    .action((opts: { status?: string; yes?: boolean }) => {
      const status = opts.status?.toLowerCase() as UserObservationStatus | undefined;
      if (status && !VALID_STATUSES.includes(status)) {
        console.error(`Invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}`);
        process.exit(1);
      }
      if (!opts.yes) {
        console.log(`This will remove ${status ? `${status} observations` : 'ALL observations'}. Pass --yes to confirm.`);
        return;
      }
      const n = getUserModel(process.cwd()).clear(status);
      console.log(`Cleared ${n} observation(s)${status ? ` (${status})` : ''}.`);
    });

  return cmd;
}

function formatObservationLine(item: UserObservation): string {
  const date = new Date(item.createdAt).toISOString().slice(0, 10);
  const conf = typeof item.confidence === 'number' ? ` ~${item.confidence}` : '';
  return `[${item.id}] ${item.status.toUpperCase()} ${item.kind}${conf}: ${item.content}  — ${date}`;
}
