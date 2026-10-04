/**
 * Failure visibility for model-facing tool observations (lm-resizer enabled).
 *
 * Rule: a failed command (exit != 0) must never look like a success. Whatever
 * reduction happened (lm-resizer view, head/tail cap), the view
 *   1. starts with `[command failed: exit N]` followed by the error-looking
 *      lines of the full output that the view does not show, and
 *   2. never carries a success-looking summary line (`make: completed`,
 *      `0 failed`, `ok`, `done`...) without an explicit `(despite exit N)`.
 */

// Strong signals: a failure keyword.
const STRONG = /\b(?:error|erreur|fail(?:ed|ure|ures|s)?|[ée]chec|panic(?:ked)?|exception|fatal|traceback|segfault|segmentation|abort(?:ed)?|denied|refus\w*|timed? ?out|cannot|can't|not found|crash(?:ed|es)?|killed|core dumped|terminated|assert\w*|unhandled|out of memory|oom|stack trace|caused by|not ok)\b|[✗✘]/i;
// Weak signal: a bare file:line reference (kept only after the strong ones).
const WEAK = /[\w@./\\-]+\.[A-Za-z]{1,6}:\d+/;
// A line that reports success never counts as a failure line.
const SUCCESS_LINE = /^\s*(?:ok|pass(?:ed)?|✓|✔|done|success(?:ful(?:ly)?)?|succeeded|all (?:tests? )?pass(?:ed)?|build (?:succeeded|successful)|completed(?: successfully)?|finished(?: successfully)?|[\w./+-]+: completed)\b/i;
// Whole-line success summaries that contradict an exit status != 0.
const SUCCESS_SUMMARY = /^\s*(?:ok|done|success(?:ful(?:ly)?)?|succeeded|passed|all (?:tests? )?pass(?:ed)?|build (?:succeeded|successful)|completed(?: successfully)?|finished(?: successfully)?|[\w./+-]+: completed)[.!]?\s*$|\b0 (?:failed|failures?|errors?)\b/i;

const MAX_STRONG = 40;
const MAX_WEAK = 10;
const MAX_CHARS = 6_000;
const LINE_WINDOW = 400;

/** The real exit status when the text carries one (sandbox trailer / host message), else `fallback`. */
export function exitCodeFromText(text: string, fallback = 1): number {
  const all = [...text.matchAll(/exit code[: ]+(-?\d+)/gi)];
  const last = all.at(-1)?.[1];
  const parsed = last === undefined ? NaN : Number(last);
  return Number.isInteger(parsed) && parsed !== 0 ? parsed : fallback;
}

/** A <= LINE_WINDOW slice of a long line that still contains the match. */
function windowAround(line: string, match: RegExpExecArray | null): string {
  if (line.length <= LINE_WINDOW) return line;
  const at = match?.index ?? 0;
  const start = Math.max(0, Math.min(at - 150, line.length - LINE_WINDOW));
  return `${start > 0 ? '…' : ''}${line.slice(start, start + LINE_WINDOW)}${start + LINE_WINDOW < line.length ? '…' : ''}`;
}

/** `[command failed]` header + the failure lines of `raw` that `view` does not already show. */
export function failureHeaderFor(raw: string, view: string, exitCode: number | string): string {
  const lines = raw.split('\n');
  const strong: number[] = [];
  const weak: number[] = [];
  const shown = new Map<number, string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || SUCCESS_LINE.test(line)) continue;
    const s = STRONG.exec(line);
    const w = s ? null : WEAK.exec(line);
    if (!s && !w) continue;
    const windowed = windowAround(line, s ?? w);
    if (view.includes(windowed.replace(/^…|…$/g, '').slice(0, 200))) continue;
    if (s && strong.length < MAX_STRONG) { strong.push(i); shown.set(i, windowed); }
    else if (w && weak.length < MAX_WEAK) { weak.push(i); shown.set(i, windowed); }
    if (strong.length >= MAX_STRONG && weak.length >= MAX_WEAK) break;
  }
  const header = `[command failed: exit ${exitCode}]\n`;
  const picked = [...strong, ...weak];
  if (picked.length === 0) return header;
  const keep = new Set<number>(picked);
  strong.slice(0, 12).forEach((index) => {
    if (index > 0 && !shown.has(index - 1)) keep.add(index - 1);
    if (index + 1 < lines.length && !shown.has(index + 1)) keep.add(index + 1);
  });
  const out: string[] = [];
  let chars = 0;
  let previous = -2;
  for (const index of [...keep].sort((a, b) => a - b)) {
    const text = shown.get(index) ?? lines[index]!.slice(0, LINE_WINDOW);
    if (chars + text.length > MAX_CHARS) { out.push('…'); break; }
    if (index !== previous + 1 && out.length > 0) out.push('…');
    out.push(`${index + 1}: ${text}`);
    chars += text.length + 1;
    previous = index;
  }
  return `${header}[failure lines from the full output, not in the reduced view below]\n${out.join('\n')}\n\n`;
}

/** Mark success-looking lines as contradicted by the exit status. Returns the text and how many lines were marked. */
export function annotateSuccessLines(view: string, exitCode: number | string): { text: string; marked: number } {
  let marked = 0;
  const text = view.split('\n').map((line) => {
    if (line.length > 300 || !SUCCESS_SUMMARY.test(line) || line.includes('(despite exit')) return line;
    marked += 1;
    return `${line}  (despite exit ${exitCode}: the command FAILED)`;
  }).join('\n');
  return { text, marked };
}

/**
 * Final guard for a failed command's model view: annotate contradicting success
 * lines and make sure the view opens with the failure header. `shortened` says
 * the view is a reduction of the full output (a header is then always added).
 */
export function ensureFailureVisible(view: string, raw: string, exitCode: number, shortened: boolean): string {
  const annotated = annotateSuccessLines(view, exitCode);
  const hasHeader = annotated.text.includes('[command failed: exit');
  if (hasHeader || (!shortened && annotated.marked === 0)) return annotated.text;
  return `${failureHeaderFor(raw, annotated.text, exitCode)}${annotated.text}`;
}
