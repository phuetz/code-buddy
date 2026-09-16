import readline from 'node:readline';
import { Command, InvalidArgumentError } from 'commander';
import { getCheckpointManager, type CheckpointManager } from '../checkpoints/checkpoint-manager.js';
import { SessionFacade } from '../agent/facades/session-facade.js';
import { SessionStore } from '../persistence/session-store.js';
import { SessionTimeline, type TimelineEntry } from '../sessions/timeline.js';

interface ReplayOptions {
  at?: number;
  fork?: string;
  yes?: boolean;
}

export interface ReplayCommandDependencies {
  timeline?: SessionTimeline;
  sessionFacade?: SessionFacade;
  checkpointManager?: Pick<CheckpointManager, 'rewindTo'>;
  confirm?: (prompt: string) => Promise<boolean>;
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('turn must be a positive integer');
  }
  return parsed;
}

function defaultConfirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(['y', 'yes'].includes(answer.trim().toLowerCase()));
    });
  });
}

function renderTools(entry: TimelineEntry): string {
  return entry.toolCalls.map((call) => `${call.name}:${call.ok ? 'ok' : 'failed'}`).join(', ') || '-';
}

function renderTimeline(entries: TimelineEntry[]): string {
  if (entries.length === 0) return 'No timeline entries found.';
  const rows = entries.map((entry) => ({
    turn: String(entry.turn),
    time: new Date(entry.ts).toLocaleTimeString(),
    preview: entry.textPreview.replace(/\s+/g, ' '),
    tools: renderTools(entry),
    files: entry.filesTouched.join(', ') || '-',
  }));
  const widths = {
    turn: Math.max(4, ...rows.map((row) => row.turn.length)),
    time: Math.max(4, ...rows.map((row) => row.time.length)),
    preview: Math.max(7, ...rows.map((row) => row.preview.length)),
    tools: Math.max(5, ...rows.map((row) => row.tools.length)),
  };
  const header = [
    'turn'.padEnd(widths.turn),
    'time'.padEnd(widths.time),
    'preview'.padEnd(widths.preview),
    'tools'.padEnd(widths.tools),
    'files',
  ].join(' | ');
  const separator = '-'.repeat(header.length);
  return [
    header,
    separator,
    ...rows.map((row) => [
      row.turn.padEnd(widths.turn),
      row.time.padEnd(widths.time),
      row.preview.padEnd(widths.preview),
      row.tools.padEnd(widths.tools),
      row.files,
    ].join(' | ')),
  ].join('\n');
}

function renderTurn(entry: TimelineEntry): string {
  return [
    `Turn ${entry.turn} · ${entry.ts} · ${entry.role}`,
    `Preview: ${entry.textPreview}`,
    `Tools: ${renderTools(entry)}`,
    `Files: ${entry.filesTouched.join(', ') || '-'}`,
    `Checkpoint: ${entry.checkpointId ?? '-'}`,
  ].join('\n');
}

export function createReplayCommand(deps: ReplayCommandDependencies = {}): Command {
  const command = new Command('replay')
    .description('Inspect, restore, or fork a time-travel session timeline')
    .argument('<sessionId>', 'Session id to replay')
    .option('--at <turn>', 'Inspect a specific turn', positiveInteger)
    .option('--fork <newSessionId>', 'Fork the session through --at into this exact id')
    .option('-y, --yes', 'Restore without an interactive confirmation', false)
    .action(async (sessionId: string, options: ReplayOptions) => {
      const timeline = deps.timeline ?? new SessionTimeline();
      if (options.fork && options.at === undefined) {
        throw new Error('--fork requires --at <turn>');
      }

      if (options.at === undefined) {
        console.log(renderTimeline(await timeline.list(sessionId)));
        return;
      }

      const entry = await timeline.get(sessionId, options.at);
      if (!entry) {
        console.log(`Turn ${options.at} not found for session ${sessionId}.`);
        process.exit(1);
        return;
      }
      console.log(renderTurn(entry));

      if (options.fork) {
        const sessionFacade = deps.sessionFacade ?? new SessionFacade({
          checkpointManager: getCheckpointManager(),
          sessionStore: new SessionStore({ useSQLite: false }),
        });
        const forked = await sessionFacade.forkSessionAtTurn(
          sessionId,
          options.fork,
          options.at,
        );
        console.log(`Forked ${sessionId} through turn ${options.at} as ${forked.id}.`);
        return;
      }

      if (!entry.checkpointId) return;
      const confirm = deps.confirm ?? defaultConfirm;
      const approved = options.yes === true || await confirm(
        `Restore files from checkpoint ${entry.checkpointId}? This changes the working tree. (y/N): `,
      );
      if (!approved) {
        console.log('Restore cancelled.');
        return;
      }

      if (!deps.checkpointManager) {
        const { restoreTimelineSnapshot } = await import('../sessions/timeline-snapshot.js');
        const snapshot = restoreTimelineSnapshot(entry.checkpointId);
        if (snapshot.found) {
          if (!snapshot.success) {
            throw new Error(snapshot.errors.join('\n') || `Failed to restore snapshot ${entry.checkpointId}`);
          }
          console.log(`Restored checkpoint ${entry.checkpointId}: ${snapshot.restored.join(', ') || 'no file changes'}.`);
          return;
        }
      }

      const checkpointManager = deps.checkpointManager ?? getCheckpointManager();
      const result = checkpointManager.rewindTo(entry.checkpointId);
      if (!result.success) {
        throw new Error(result.errors.join('\n') || `Failed to restore checkpoint ${entry.checkpointId}`);
      }
      console.log(`Restored checkpoint ${entry.checkpointId}: ${result.restored.join(', ') || 'no file changes'}.`);
    });

  return command;
}
