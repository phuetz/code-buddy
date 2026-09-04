import { getModelScoreboard, type ModelScoreboard } from '../fleet/model-scoreboard.js';

type Emit = (message: string) => void;

export interface ScoreboardCommandOptions {
  task?: string;
}

function parseTask(args: string[], override?: string): { task?: string; json: boolean; error?: string } {
  let task = override?.trim() || undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--task' && i + 1 < args.length) {
      task = args[++i]?.trim() || undefined;
    } else if (arg?.startsWith('--task=')) {
      task = arg.slice('--task='.length).trim() || undefined;
    } else if (arg) {
      return { json, error: `Unknown scoreboard option or argument: ${arg}` };
    }
  }
  return { task, json };
}

/** Run `buddy council scoreboard import|best` against an injected or default ledger. */
export function runScoreboardCommand(
  args: string[],
  out: Emit,
  scoreboard: ModelScoreboard = getModelScoreboard(),
  options: ScoreboardCommandOptions = {},
): boolean {
  const action = args[0]?.toLowerCase();
  if (action === 'import') {
    const source = args[1];
    if (!source || args.length !== 2) {
      out('Usage: buddy council scoreboard import <fichier.jsonl>');
      return false;
    }
    try {
      const result = scoreboard.importJsonl(source);
      out(
        `Scoreboard import: ${result.imported} ajouté(s), `
        + `${result.skippedDuplicates} doublon(s) ignoré(s), ${result.rejected} ligne(s) rejetée(s).`,
      );
      return result.rejected === 0;
    } catch (err) {
      out(`Scoreboard import impossible : ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  if (action === 'best') {
    const parsed = parseTask(args.slice(1), options.task);
    if (parsed.error || !parsed.task) {
      out(parsed.error ?? 'Usage: buddy council scoreboard best --task <task-type>');
      return false;
    }
    const best = scoreboard.best(parsed.task);
    if (!best) {
      if (parsed.json) out(JSON.stringify({ taskType: parsed.task, model: null }));
      else out(`No scoreboard history for task type "${parsed.task}".`);
      return false;
    }
    if (parsed.json) {
      out(JSON.stringify({ taskType: parsed.task, ...best }));
    } else {
      out(
        `Best model for "${parsed.task}": ${best.model} `
        + `(provider ${best.provider}, win ${Math.round(best.winRate * 100)}%, q${best.avgQuality.toFixed(2)}).`,
      );
    }
    return true;
  }

  out('Usage: buddy council scoreboard import <fichier.jsonl> | best --task <task-type>');
  return false;
}
