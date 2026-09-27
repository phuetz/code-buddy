/**
 * Map a Cowork agent session's messages into the StudioChatPanel's lightweight
 * StudioMessage shape (bolt.new-style iterate chat). Pure + structurally typed
 * so it needs no store/session imports and is trivially testable.
 */
import type { StudioMessage } from '../studio-iterate/iterate-model.js';
import { stripPlanBlocks } from './dev-plan.js';

/**
 * Les messages d'itération partent enveloppés de consignes (édition ciblée,
 * verrous, mode discussion — voir iteration-prompt.ts) ; la bulle n'affiche
 * que la demande de l'utilisateur, préfixée en mode discussion.
 */
export function visibleUserText(text: string): string {
  const match = /^\[App Studio — (mode discussion|modification ciblée)\][\s\S]*?\nDemande :\n([\s\S]*)$/.exec(text);
  if (!match) return text;
  const request = (match[2] ?? '').trim();
  return match[1] === 'mode discussion' ? `💬 ${request}` : request;
}

export interface ChatSourceMessage {
  id: string;
  role: string; // 'user' | 'assistant' | 'system'
  content: ReadonlyArray<{ type: string; text?: string }>;
}

function textOf(content: ReadonlyArray<{ type: string; text?: string }>): string {
  // ```plan blocks render as the Plan de vol card, not as raw JSON in a bubble.
  return stripPlanBlocks(
    content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text ?? '')
      .join(''),
  );
}

/**
 * Keep only user/assistant messages that carry visible text; while the turn is
 * running, append the live partial assistant response (bolt.new-style streaming)
 * or mark the last assistant bubble as streaming.
 */
export function sessionToStudioMessages(
  messages: ReadonlyArray<ChatSourceMessage>,
  opts: { running?: boolean; partial?: string } = {},
): StudioMessage[] {
  const out: StudioMessage[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const raw = textOf(m.content);
    const text = m.role === 'user' ? visibleUserText(raw) : raw;
    if (!text) continue;
    out.push({ id: m.id, role: m.role, text });
  }
  if (opts.running) {
    const partial = stripPlanBlocks(opts.partial ?? '');
    if (partial) {
      // The turn is streaming a fresh assistant reply not yet in `messages`.
      out.push({ id: 'partial-stream', role: 'assistant', text: partial, streaming: true });
    } else {
      const last = out[out.length - 1];
      if (last && last.role === 'assistant') last.streaming = true;
      else out.push({ id: 'partial-stream', role: 'assistant', text: '', streaming: true });
    }
  }
  return out;
}
