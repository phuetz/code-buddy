/**
 * StagnationDetector — spots an agent that explores without ever producing.
 *
 * Field case (2026-10-04, headless `buddy -p`, 264 tool calls, zero file
 * written): the model kept re-reading the same files with a different line
 * range each time, so `ToolLoopGuard` (same tool + same arguments + same
 * result) never fired. This detector looks at EFFECT instead of identity: a
 * long streak of tool calls with no successful write, plus the same file being
 * read again and again.
 *
 * Contract: pure, per-task instance, fires AT MOST ONCE (a single refocus
 * message appended at the end of the transcript — the history is never
 * rewritten, so the prompt cache prefix stays intact). It never stops the loop.
 *
 * Defaults (corpus C1-1005): streakWithRereads=45, rereadThreshold=5,
 * streakAlone=80 — tuned so a legitimate 40-chunk read of one large file does
 * not nudge, while real re-read loops and write-less exploration still do.
 * Override via constructor options or env:
 *   CODEBUDDY_STAGNATION_STREAK_WITH_REREADS
 *   CODEBUDDY_STAGNATION_REREAD_THRESHOLD
 *   CODEBUDDY_STAGNATION_STREAK_ALONE
 */

export interface StagnationObservation {
  name: string;
  /** Raw JSON arguments string as sent by the model. */
  argumentsJson: string;
  success: boolean;
}

export interface StagnationOptions {
  /** Calls without any successful write before a repeated re-read triggers the nudge. Default 45. */
  streakWithRereads?: number;
  /** Re-reads of one file that count as "reading the same thing again". Default 5. */
  rereadThreshold?: number;
  /** Calls without any successful write that trigger the nudge on their own. Default 80. */
  streakAlone?: number;
}

/** Historical defaults before the C1-1005 corpus tune (kept for regression tests). */
export const LEGACY_STAGNATION_OPTIONS: Readonly<Required<StagnationOptions>> = {
  streakWithRereads: 30,
  rereadThreshold: 3,
  streakAlone: 60,
};

/** Current defaults (proposed after C1-1005 measurements). */
export const DEFAULT_STAGNATION_OPTIONS: Readonly<Required<StagnationOptions>> = {
  streakWithRereads: 45,
  rereadThreshold: 5,
  streakAlone: 80,
};

export interface StagnationDecision {
  message: string;
  callsWithoutWrite: number;
  mostReadTarget?: string;
  reads: number;
}

const WRITE_TOOLS = new Set([
  'str_replace_editor', 'str_replace', 'create_file', 'write_file', 'file_write',
  'multi_edit', 'apply_patch', 'edit_file', 'git_commit',
]);
const SHELL_TOOLS = new Set(['bash', 'execute_code', 'shell_exec']);
/** Shell redirection, tee, cp/mv, in-place sed, git add/commit, patch, mkdir. */
const SHELL_WRITE_RE =
  /(?:^|[\n;&|]\s*|\bsudo\s+)(?:tee|cp|mv|mkdir|patch)\s|(?:^|[^<>=&|-])>{1,2}\s*(?!&|\/dev\/null)[A-Za-z./~"'$_][^\n]*$|\bsed\s+-[a-z]*i|\bgit\s+(?:add|commit)\b|\|\s*tee\b/m;
const PATH_TOKEN_RE = /(?:\/|\.\/)?[\w@~.-]+(?:\/[\w@~.-]+)*\.[A-Za-z][\w]{0,5}\b/g;

function parseArgs(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function shellText(args: Record<string, unknown>): string {
  const command = args.command ?? args.code ?? args.script ?? '';
  return typeof command === 'string' ? command : '';
}

export function isWriteCall(name: string, argumentsJson: string): boolean {
  if (WRITE_TOOLS.has(name)) return true;
  if (SHELL_TOOLS.has(name)) return SHELL_WRITE_RE.test(shellText(parseArgs(argumentsJson)));
  return false;
}

/** File-like targets a call looks at (path argument, or file names in a shell command). */
function readTargets(name: string, argumentsJson: string): string[] {
  const args = parseArgs(argumentsJson);
  const direct = [args.path, args.file_path, args.target_file]
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (direct.length > 0) return direct;
  if (SHELL_TOOLS.has(name)) {
    const text = shellText(args);
    return [...new Set(text.match(PATH_TOKEN_RE) ?? [])].filter((token) => token.length > 3);
  }
  return [];
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2 || n > 10_000) return fallback;
  return n;
}

/**
 * Resolve options from explicit overrides, then env, then defaults.
 * Env keys (optional): CODEBUDDY_STAGNATION_STREAK_WITH_REREADS,
 * CODEBUDDY_STAGNATION_REREAD_THRESHOLD, CODEBUDDY_STAGNATION_STREAK_ALONE.
 */
export function resolveStagnationOptions(overrides: StagnationOptions = {}): Required<StagnationOptions> {
  const envStreak = readPositiveInt(
    process.env.CODEBUDDY_STAGNATION_STREAK_WITH_REREADS,
    DEFAULT_STAGNATION_OPTIONS.streakWithRereads,
  );
  const envReread = readPositiveInt(
    process.env.CODEBUDDY_STAGNATION_REREAD_THRESHOLD,
    DEFAULT_STAGNATION_OPTIONS.rereadThreshold,
  );
  const envAlone = readPositiveInt(
    process.env.CODEBUDDY_STAGNATION_STREAK_ALONE,
    DEFAULT_STAGNATION_OPTIONS.streakAlone,
  );
  const streakWithRereads = overrides.streakWithRereads ?? envStreak;
  const rereadThreshold = overrides.rereadThreshold ?? envReread;
  const streakAlone = overrides.streakAlone ?? envAlone;
  return {
    streakWithRereads: Math.max(2, streakWithRereads),
    rereadThreshold: Math.max(2, rereadThreshold),
    streakAlone: Math.max(Math.max(2, streakWithRereads), streakAlone),
  };
}

export class StagnationDetector {
  private readonly streakWithRereads: number;
  private readonly rereadThreshold: number;
  private readonly streakAlone: number;
  private streak = 0;
  private fired = false;
  private readonly reads = new Map<string, number>();

  constructor(options: StagnationOptions = {}) {
    const resolved = resolveStagnationOptions(options);
    this.streakWithRereads = resolved.streakWithRereads;
    this.rereadThreshold = resolved.rereadThreshold;
    this.streakAlone = resolved.streakAlone;
  }

  get hasFired(): boolean {
    return this.fired;
  }

  observe(observation: StagnationObservation): StagnationDecision | null {
    if (this.fired) return null;
    if (observation.success && isWriteCall(observation.name, observation.argumentsJson)) {
      // Real production: the streak and the read counts start over.
      this.streak = 0;
      this.reads.clear();
      return null;
    }
    this.streak++;
    for (const target of readTargets(observation.name, observation.argumentsJson)) {
      this.reads.set(target, (this.reads.get(target) ?? 0) + 1);
    }
    let mostRead: string | undefined;
    let mostReads = 0;
    for (const [target, count] of this.reads) {
      if (count > mostReads) {
        mostRead = target;
        mostReads = count;
      }
    }
    const rereading = mostReads >= this.rereadThreshold && this.streak >= this.streakWithRereads;
    if (!rereading && this.streak < this.streakAlone) return null;
    this.fired = true;
    const detail = mostRead && mostReads >= this.rereadThreshold
      ? ` The file "${mostRead}" was read ${mostReads} times.`
      : '';
    return {
      callsWithoutWrite: this.streak,
      ...(mostRead ? { mostReadTarget: mostRead } : {}),
      reads: mostReads,
      message:
        `No file has been written or edited during your last ${this.streak} tool calls.${detail} ` +
        'Stop exploring and re-reading: decide with what you already know, write the requested deliverable now ' +
        'at the requested path (inside the workspace), commit if the task asks for it, then give your final answer. ' +
        'If a write is refused, say so explicitly in your final answer instead of searching further.',
    };
  }
}
