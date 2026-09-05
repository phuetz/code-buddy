import { Command } from 'commander';
import {
  renderEvolutionNotesMarkdown,
} from './changelog.js';
import {
  queryEvolutionNotes,
  readEvolutionNotes,
  type EvolutionNote,
} from '../self-model/evolution-notes.js';

export interface SelfCommandDependencies {
  cwd?: string;
  stdout?: (content: string) => void;
  readEvolutionNotes?: (workDir: string) => Promise<EvolutionNote[]>;
}

interface SelfEvolutionOptions {
  since?: string;
  subject?: string;
  limit: string;
  json: boolean;
}

function writeStdout(content: string, writer?: (content: string) => void): void {
  (writer ?? ((value) => process.stdout.write(value)))(`${content.trimEnd()}\n`);
}

function limitValue(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new Error('--limit doit être un entier compris entre 1 et 50.');
  }
  return parsed;
}

function isValidDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/** `buddy self evolution` — the explicit self-model CLI surface. */
export function createSelfCommand(dependencies: SelfCommandDependencies = {}): Command {
  const command = new Command('self').description('Lire le modèle de soi de Code Buddy');
  command
    .command('evolution')
    .description('Afficher les évolutions documentées de Code Buddy')
    .option('--since <YYYY-MM-DD>', 'date de début incluse')
    .option('--subject <sujet>', 'filtrer par sujet')
    .option('--limit <n>', 'nombre maximal de notes', '5')
    .option('--json', 'sortie JSON', false)
    .action(async (options: SelfEvolutionOptions) => {
      try {
        if (options.since !== undefined && !isValidDate(options.since)) {
          throw new Error('--since doit être une date YYYY-MM-DD.');
        }
        const cwd = dependencies.cwd ?? process.cwd();
        const notes = await (dependencies.readEvolutionNotes ?? (async (workDir: string) => readEvolutionNotes({ workDir })))(cwd);
        const selected = queryEvolutionNotes(notes, {
          ...(options.since ? { since: options.since } : {}),
          ...(options.subject ? { subject: options.subject } : {}),
          limit: limitValue(options.limit),
        });
        if (options.json) {
          writeStdout(JSON.stringify({ kind: 'self_evolution', notes: selected }, null, 2), dependencies.stdout);
        } else {
          writeStdout(renderEvolutionNotesMarkdown(selected), dependencies.stdout);
        }
      } catch (error) {
        command.error(error instanceof Error ? error.message : String(error), {
          code: 'buddy.self.evolution',
          exitCode: 1,
        });
      }
    });
  return command;
}
