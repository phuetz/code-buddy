/**
 * Terminal session picker and local recap (comparatif plan P6).
 *
 * - `filterSessions`: case-insensitive match on name, id and working directory
 *   (substring first, then in-order subsequence).
 * - `buildSessionRecap`: pure local summary (no model call): message counts,
 *   last user/assistant excerpts, files touched by tool calls.
 * - `pickSession`: minimal keyboard picker (type to filter, ↑/↓, Enter, Esc).
 */

import readline from 'node:readline';

export interface PickableSession {
  id: string;
  name: string;
  workingDirectory?: string;
  lastAccessedAt: Date;
  messages: Array<{ type: string; content: string; toolCall?: { function?: { name?: string; arguments?: string } } }>;
}

function subsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const char of haystack) {
    if (char === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

export function filterSessions<T extends PickableSession>(sessions: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...sessions];
  const fields = (s: T) => [s.name, s.id, s.workingDirectory ?? ''].map((v) => v.toLowerCase());
  const direct = sessions.filter((s) => fields(s).some((f) => f.includes(q)));
  const fuzzy = sessions.filter((s) => !direct.includes(s) && fields(s).some((f) => subsequence(q, f)));
  return [...direct, ...fuzzy];
}

function excerpt(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export interface SessionRecap {
  messageCount: number;
  userTurns: number;
  assistantTurns: number;
  toolCalls: number;
  lastUser?: string;
  lastAssistant?: string;
  filesTouched: string[];
}

export function buildSessionRecap(session: Pick<PickableSession, 'messages'>): SessionRecap {
  const files = new Set<string>();
  let toolCalls = 0;
  for (const message of session.messages) {
    const call = message.toolCall?.function;
    if (!call?.name) continue;
    toolCalls += 1;
    try {
      const args = JSON.parse(call.arguments || '{}') as Record<string, unknown>;
      for (const key of ['path', 'file_path', 'target_file', 'filePath']) {
        if (typeof args[key] === 'string' && args[key]) files.add(args[key] as string);
      }
    } catch { /* malformed tool arguments are ignored */ }
  }
  const last = (type: string) => [...session.messages].reverse().find((m) => m.type === type && m.content.trim());
  return {
    messageCount: session.messages.length,
    userTurns: session.messages.filter((m) => m.type === 'user').length,
    assistantTurns: session.messages.filter((m) => m.type === 'assistant').length,
    toolCalls,
    ...(last('user') ? { lastUser: excerpt(last('user')!.content) } : {}),
    ...(last('assistant') ? { lastAssistant: excerpt(last('assistant')!.content) } : {}),
    filesTouched: [...files].slice(0, 5),
  };
}

export function formatSessionRecap(recap: SessionRecap): string[] {
  const lines = [`   Recap (local, no model call): ${recap.userTurns} user / ${recap.assistantTurns} assistant turns, ${recap.toolCalls} tool call(s)`];
  if (recap.filesTouched.length) lines.push(`   Files touched: ${recap.filesTouched.join(', ')}`);
  if (recap.lastUser) lines.push(`   Last request: ${recap.lastUser}`);
  if (recap.lastAssistant) lines.push(`   Last answer: ${recap.lastAssistant}`);
  return lines;
}

export interface PickerStreams {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
}

/** Interactive picker. Resolves the chosen session, or null when cancelled. */
export function pickSession<T extends PickableSession>(sessions: readonly T[], streams: PickerStreams, pageSize = 10): Promise<T | null> {
  const { input, output } = streams;
  return new Promise((resolve) => {
    let query = '';
    let index = 0;
    let rendered = 0;
    const visible = () => filterSessions(sessions, query);
    const render = () => {
      if (rendered > 0) output.write(`\x1b[${rendered}A\x1b[0J`);
      const items = visible();
      index = Math.min(index, Math.max(0, items.length - 1));
      const lines = [`Resume a session — type to filter, ↑/↓ to move, Enter to resume, Esc to cancel`, `> ${query}`];
      const start = Math.max(0, Math.min(index - Math.floor(pageSize / 2), items.length - pageSize));
      items.slice(start, start + pageSize).forEach((s, i) => {
        const pointer = start + i === index ? '❯' : ' ';
        lines.push(`${pointer} ${s.id.slice(0, 8)}  ${s.name}  (${s.messages.length} msg, ${s.lastAccessedAt.toLocaleString()})`);
      });
      if (items.length === 0) lines.push('  no matching session');
      output.write(`${lines.join('\n')}\n`);
      rendered = lines.length;
    };
    const finish = (value: T | null) => {
      input.off('keypress', onKey);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
      resolve(value);
    };
    const onKey = (text: string | undefined, key: { name?: string; ctrl?: boolean } = {}) => {
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) return finish(null);
      if (key.name === 'return' || key.name === 'enter') return finish(visible()[index] ?? null);
      if (key.name === 'up') index = Math.max(0, index - 1);
      else if (key.name === 'down') index = Math.min(visible().length - 1, index + 1);
      else if (key.name === 'backspace') query = query.slice(0, -1);
      else if (text && !key.ctrl && text >= ' ') { query += text; index = 0; }
      render();
    };
    readline.emitKeypressEvents(input);
    if (input.isTTY) input.setRawMode(true);
    input.on('keypress', onKey);
    input.resume();
    render();
  });
}
