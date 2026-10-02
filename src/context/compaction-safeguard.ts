/**
 * Inspiration: OpenClaw safeguard (MIT, e8dc33b3f) and Hermes structured
 * compaction/circuit breaker (MIT, 34f8ec3b4). Independently written.
 * This guard wraps the existing synchronous/extractive compressor; no LLM cost.
 */
import type { CodeBuddyMessage } from '../codebuddy/client.js';

export interface CompactionRequirements {
  objective: string[];
  modifiedFiles: string[];
  decisions: string[];
  openTasks: string[];
}

export function extractCompactionRequirements(messages: readonly CodeBuddyMessage[]): CompactionRequirements {
  const result: CompactionRequirements = { objective: [], modifiedFiles: [], decisions: [], openTasks: [] };
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (typeof lastUser?.content === 'string') result.objective.push(lastUser.content);
  const successfulIds = new Set(messages.filter(m => m.role === 'tool' && typeof m.content === 'string' &&
    !/error|failed|"success"\s*:\s*false/i.test(m.content)).map(m =>
      (m as { tool_call_id?: string }).tool_call_id));
  for (const message of messages) {
    if (typeof message.content === 'string' && message.role !== 'tool') {
      for (const line of message.content.split('\n').map(s => s.trim()).filter(Boolean)) {
        if (/^(?:[-*]\s*)?(?:objective|objectif|current goal|goal)\s*:/i.test(line)) result.objective.push(line);
        if (/^(?:[-*]\s*)?(?:decision|décision|decided|we decided|nous avons décidé)\s*[:\s]/i.test(line)) result.decisions.push(line.replace(/^[-*]\s+/, ''));
        if (/^(?:[-*]\s*)?(?:\[ \]|todo\b|open task\b|tâche ouverte\b|à faire\b)/i.test(line)) result.openTasks.push(line.replace(/^[-*]\s+/, ''));
        const file = line.match(/^(?:[-*]\s*)?(?:modified|changed|created|edited|file modified|fichier modifié)\s*:\s*(.+)$/i);
        if (file?.[1]) result.modifiedFiles.push(file[1]);
      }
    }
    const calls = (message as { tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }).tool_calls;
    for (const call of calls ?? []) {
      if (!successfulIds.has(call.id) || !/^(?:create_file|write_file|edit_file|str_replace|str_replace_editor|multi_edit|apply_patch)$/.test(call.function.name)) continue;
      try {
        const args = JSON.parse(call.function.arguments) as { path?: string; file_path?: string; patch?: string };
        const file = args.path ?? args.file_path;
        if (typeof file === 'string') result.modifiedFiles.push(file);
        if (typeof args.patch === 'string') {
          for (const match of args.patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
            if (match[1]) result.modifiedFiles.push(match[1]);
          }
        }
      } catch { /* malformed calls cannot establish a changed file */ }
    }
  }
  for (const key of Object.keys(result) as Array<keyof CompactionRequirements>) result[key] = [...new Set(result[key])];
  return result;
}

export function retainsCompactionRequirements(messages: readonly CodeBuddyMessage[], required: CompactionRequirements): boolean {
  const text = messages.map(m => typeof m.content === 'string' ? m.content : '').join('\n');
  return Object.values(required).every(values => values.every((value: string) => text.includes(value)));
}

export function structuredCompactionSummary(required: CompactionRequirements): string {
  return (Object.keys(required) as Array<keyof CompactionRequirements>)
    .map(key => `${key}:\n${required[key].map(value => `- ${key === 'modifiedFiles' ? 'Modified: ' : ''}${value}`).join('\n') || '- (none recorded)'}`).join('\n\n');
}

export interface CompactionSafeguardState {
  failureLimit: number;
  failures: number;
  rejected: number;
  retries: number;
  fallbacks: number;
}

export class CompactionSafeguard {
  private failures = 0;
  private rejected = 0;
  private retries = 0;
  private fallbacks = 0;
  constructor(private readonly failureLimit = 2) {}

  exportState(): CompactionSafeguardState {
    return { failureLimit: this.failureLimit, failures: this.failures,
      rejected: this.rejected, retries: this.retries, fallbacks: this.fallbacks };
  }

  static fromState(state: CompactionSafeguardState): CompactionSafeguard {
    const guard = new CompactionSafeguard(state.failureLimit);
    guard.failures = state.failures;
    guard.rejected = state.rejected;
    guard.retries = state.retries;
    guard.fallbacks = state.fallbacks;
    return guard;
  }

  getStats(): { failures: number; rejected: number; retries: number; fallbacks: number; circuitOpen: boolean } {
    return { failures: this.failures, rejected: this.rejected, retries: this.retries,
      fallbacks: this.fallbacks, circuitOpen: this.failures >= this.failureLimit };
  }

  protect(
    original: CodeBuddyMessage[],
    summarize: (required: CompactionRequirements, structured: boolean) => CodeBuddyMessage[],
    truncate: () => CodeBuddyMessage[],
    fits: (messages: CodeBuddyMessage[]) => boolean,
  ): CodeBuddyMessage[] {
    if (this.failures < this.failureLimit) {
      const required = extractCompactionRequirements(original);
      for (const structured of [false, true]) {
        if (structured) this.retries++;
        try {
          const candidate = summarize(required, structured);
          if (fits(candidate) && retainsCompactionRequirements(candidate, required)) {
            this.failures = 0;
            return candidate;
          }
        } catch { /* broken summarizers receive the same bounded retry */ }
        this.rejected++;
      }
      this.failures++;
    }
    this.fallbacks++;
    return truncate();
  }
}
