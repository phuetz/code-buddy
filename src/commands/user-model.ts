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
  runUserLocalInference,
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
    .option('--json', 'Output JSON')
    .action((content: string, opts: { kind: string; confidence?: string; json?: boolean; note?: string }) => {
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
        const reviewCommand = observation.status === 'pending'
          ? `buddy user-model accept ${observation.id} --by <name>`
          : undefined;
        if (opts.json) {
          console.log(JSON.stringify({
            deduped,
            observation,
            ...(reviewCommand ? { reviewCommand } : {}),
          }, null, 2));
          return;
        }
        const prefix = deduped ? 'Matched existing observation' : 'Proposed observation';
        console.log(`${prefix} [${observation.id}] (${observation.kind}): ${observation.content}`);
        if (reviewCommand) {
          console.log(`Accept it with: ${reviewCommand}`);
        } else {
          console.log(`Observation is already ${observation.status}; no review action is required.`);
        }
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

  // ---- analyze -------------------------------------------------------------
  cmd
    .command('analyze')
    .description('Analyze a session to propose review-gated user preferences')
    .option('--session <id>', 'Specific session ID (defaults to latest)')
    .option('--local', 'Use deterministic local inference instead of an LLM provider')
    .option('--json', 'Output JSON')
    .action(async (opts: { session?: string; local?: boolean; json?: boolean }) => {
      try {
        const { getSessionStore } = await import('../persistence/session-store.js');
        const sessionStore = getSessionStore();
        let sessionId = opts.session;
        if (!sessionId) {
          sessionId = sessionStore.getCurrentSessionId() || undefined;
        }
        if (!sessionId) {
          // Fallback to latest session in list
          const sessions = sessionStore.listSessions();
          if (sessions.length > 0) {
            sessionId = sessions[0]!.id;
          }
        }

        if (!sessionId) {
          console.error('No session found to analyze.');
          process.exit(1);
        }

        if (!opts.json) {
          console.log(`Loading history for session: ${sessionId}...`);
        }
        const session = await sessionStore.loadSession(sessionId);
        if (!session) {
          console.error(`Session ${sessionId} not found.`);
          process.exit(1);
        }
        const chatHistory = sessionStore.convertMessagesToChatEntries(session.messages);
        if (!chatHistory || chatHistory.length === 0) {
          console.error('Session has no chat history.');
          process.exit(1);
        }

        let proposed: UserObservation[];
        if (opts.local) {
          if (!opts.json) {
            console.log('Running deterministic local inference to detect obvious working preferences...');
          }
          proposed = runUserLocalInference(chatHistory, process.cwd(), {
            provenance: {
              sessionId,
              note: 'Local deterministic inference from user-model analyze',
            },
          });
        } else {
          if (!opts.json) {
            console.log('Running LLM dialectic inference to detect preferences...');
          }
          const { runUserDialecticInference } = await import('../memory/user-model.js');
          proposed = await runUserDialecticInference(chatHistory, process.cwd());
        }

        if (opts.json) {
          console.log(JSON.stringify({
            mode: opts.local ? 'local' : 'llm',
            sessionId,
            count: proposed.length,
            observations: proposed,
            reviewCommand: 'buddy user-model list --status pending',
          }, null, 2));
          return;
        }

        if (proposed.length === 0) {
          console.log('No new user preferences detected.');
        } else {
          console.log(`\nSuccessfully proposed ${proposed.length} new preference candidate(s):`);
          for (const obs of proposed) {
            console.log(`- [${obs.id}] (${obs.kind}): ${obs.content}`);
          }
          console.log('\nReview pending observations with: buddy user-model list --status pending');
        }
      } catch (err) {
        console.error('Failed to run dialectic analysis:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return cmd;
}

function formatObservationLine(item: UserObservation): string {
  const date = new Date(item.createdAt).toISOString().slice(0, 10);
  const conf = typeof item.confidence === 'number' ? ` ~${item.confidence}` : '';
  return `[${item.id}] ${item.status.toUpperCase()} ${item.kind}${conf}: ${item.content}  — ${date}`;
}
