/**
 * OpenAI-style transcript → Anthropic Messages API shape.
 *
 * Rules verified against Anthropic Messages API docs (2024–2026) and aligned
 * with the former inline `ClaudeProvider.formatMessages` conversion:
 *  - system is extracted (not a message role)
 *  - first message must be `user`
 *  - roles must strictly alternate user/assistant
 *  - tool_use blocks live on assistant messages
 *  - tool_result blocks live on the following user message (all results for
 *    one assistant turn merged into that single user message)
 *
 * The previous per-tool `role:user` emission produced consecutive user
 * messages after multi-tool assistants — rejected by Anthropic.
 */

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface OpenAiStyleMessage {
  role: string;
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

export interface AnthropicFormatted {
  system: string;
  messages: AnthropicMessage[];
}

function asBlocks(content: string | AnthropicContentBlock[] | undefined | null): AnthropicContentBlock[] {
  if (content == null || content === '') return [];
  if (Array.isArray(content)) return content.slice();
  return [{ type: 'text', text: String(content) }];
}

function mergeSameRole(messages: AnthropicMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const msg of messages) {
    const last = out[out.length - 1];
    if (last && last.role === msg.role) {
      last.content = [...asBlocks(last.content), ...asBlocks(msg.content)];
    } else {
      out.push({
        role: msg.role,
        content: Array.isArray(msg.content) ? msg.content.slice() : msg.content,
      });
    }
  }
  return out;
}

/**
 * Convert an OpenAI-style message list (CodeBuddy / Chat Completions) into
 * Anthropic `{ system, messages }` with valid role alternation and merged
 * tool_result user turns.
 */
export function toAnthropicMessages(
  messages: OpenAiStyleMessage[],
  options?: { starterUserContent?: string },
): AnthropicFormatted {
  let system = '';
  const raw: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = msg.content == null ? '' : String(msg.content);
      system += (system ? '\n\n' : '') + text;
      continue;
    }

    if (msg.role === 'tool') {
      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id,
        content: msg.content == null ? '' : String(msg.content),
      };
      const last = raw[raw.length - 1];
      if (
        last &&
        last.role === 'user' &&
        Array.isArray(last.content) &&
        last.content.length > 0 &&
        last.content.every((b) => b.type === 'tool_result')
      ) {
        last.content.push(block);
      } else {
        raw.push({ role: 'user', content: [block] });
      }
      continue;
    }

    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const content: AnthropicContentBlock[] = [];
      if (msg.content) {
        content.push({ type: 'text', text: String(msg.content) });
      }
      for (const tc of msg.tool_calls) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function?.arguments || '{}');
        } catch {
          input = {};
        }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function?.name,
          input,
        });
      }
      raw.push({ role: 'assistant', content });
      continue;
    }

    raw.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content == null ? '' : String(msg.content),
    });
  }

  let merged = mergeSameRole(raw);

  if (merged.length > 0 && merged[0]!.role !== 'user') {
    merged = [
      {
        role: 'user',
        content: options?.starterUserContent ?? '(conversation continues)',
      },
      ...merged,
    ];
    // starter may sit before an assistant; if we somehow created consec users, re-merge
    merged = mergeSameRole(merged);
  }

  return { system, messages: merged };
}

/** Anthropic Messages API structural checks (post-conversion). */
export function isValidAnthropicMessageOrder(messages: AnthropicMessage[]): boolean {
  if (messages.length === 0) return true;
  if (messages[0]!.role !== 'user') return false;
  for (let i = 1; i < messages.length; i++) {
    if (messages[i]!.role === messages[i - 1]!.role) return false;
  }
  const seenUses = new Set<string>();
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b.type === 'tool_use' && b.id) seenUses.add(b.id);
      }
    }
    if (m.role === 'user' && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          if (!b.tool_use_id || !seenUses.has(b.tool_use_id)) return false;
        }
      }
    }
  }
  return true;
}
