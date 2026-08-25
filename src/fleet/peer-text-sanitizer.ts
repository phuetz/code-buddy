/**
 * Sanitization of free-form text received from a fleet peer.
 *
 * A peer is ANOTHER Code Buddy instance, on another machine, possibly driven by
 * someone else. Its `peer.chat` / `peer.chat-session.*` replies are model prose
 * that we fold straight into local reasoning: the council judge prompt, an agent
 * tool result, a terminal transcript. Local model output is already stripped of
 * leakage/control tokens before it reaches any of those surfaces (agent-executor,
 * council engine, triage); peer text has to get the SAME treatment at the door,
 * otherwise a peer can smuggle `<think>`, `<|im_start|>`, `[INST]`, `<<SYS>>` or
 * invisible characters into a prompt we build — a cross-machine prompt-injection
 * channel. Sanitizing at the emitter would be pointless: a hostile peer simply
 * doesn't run our code. Reception is the only enforceable point.
 *
 * Scope note (deliberate): this is for MODEL PROSE only. It must NOT be applied
 * to structured peer payloads — `peer.describe` capability JSON, peer ids,
 * session ids — nor to `peer.tool.invoke` output, which is verbatim file/
 * directory content where `<think>` or `[INST]` may legitimately appear.
 *
 * `defangPeerKnowledgeText` is the second, deliberately weaker rule, for peer
 * text that is PERSISTED and re-injected later (`peer.ckg.sync`). It neutralizes
 * the same markers without deleting anything — see its own doc for why deletion
 * is the wrong trade there.
 *
 * @module fleet/peer-text-sanitizer
 */

import { sanitizeModelOutput, stripInvisibleChars } from '../utils/output-sanitizer.js';

/**
 * Clean one free-form text answer coming from a peer machine.
 *
 * Strips model control/leakage tokens (`sanitizeModelOutput`) AND invisible
 * Unicode (`stripInvisibleChars`) — the local agent path does both
 * (`agent/execution/context-pipeline.ts`), and untrusted remote prose has no
 * legitimate use for zero-width characters.
 *
 * @param text - Raw text as returned on the wire by a peer.
 * @returns The sanitized text (empty string for a non-string / empty input).
 */
export function sanitizePeerText(text: unknown): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  return stripInvisibleChars(sanitizeModelOutput(text));
}

/**
 * Control-token shapes, and where to break them.
 *
 * Each rule inserts ONE ASCII space just after the opening delimiter. Every
 * character of the payload survives and stays readable to a human; the marker
 * simply stops being an exact match for any tokenizer special token or prompt
 * parser. Order matters only in that invisible characters must already be gone
 * (see `defangPeerKnowledgeText`): a zero-width space wedged between the `<`
 * and the `|` would slip past these rules, then re-form into a live token the
 * moment something else strips it.
 */
const KNOWLEDGE_DEFANG_RULES: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // ChatML and every other `<|…|>` control token.
  { pattern: /<\|/g, replacement: '< |' },
  // Its JSON-escaped form, which survives a round-trip through a JSON payload.
  { pattern: /\\u003c\|/gi, replacement: '\\u003c |' },
  // GLM-5 full-width variant ＜｜…｜＞.
  { pattern: /＜｜/g, replacement: '＜ ｜' },
  // Half-formed pipe markers leaked by local runtimes: `<channel|>`, `<message|>`, …
  { pattern: /<(channel|message|tool_call|constrain)\|>/gi, replacement: '< $1|>' },
  // DeepSeek / Qwen reasoning fences.
  { pattern: /<(\/?)(think|reasoning)>/gi, replacement: '< $1$2>' },
  // LLaMA instruction and system markers.
  { pattern: /\[(\/?)INST\]/gi, replacement: '[ $1INST]' },
  { pattern: /<<(\/?)SYS>>/gi, replacement: '< <$1SYS>>' },
];

/**
 * Neutralize control tokens in peer text that will be PERSISTED rather than read once.
 *
 * `sanitizePeerText` is right for a one-shot answer: it DELETES the offending
 * spans, and a `<think>…</think>` block a peer's model leaked is worth nothing.
 * That rule cannot be reused for `peer.ckg.sync`, whose entries land in the
 * append-only collective ledger and are injected into later prompts: an entry
 * can be derived from indexed code (`buddy research ingest-code`), where
 * `[INST]…[/INST]` or `<|im_start|>` are the very subject of the knowledge.
 * Deleting the span would silently destroy the payload of a legitimate entry,
 * permanently, and the loss would only surface much later.
 *
 * So this variant defangs instead of deleting: invisible characters go (they
 * have no use in a knowledge entry, and they can hide a token from the rules
 * below), then one space is inserted inside each control-token delimiter. The
 * text stays complete and readable; the marker stops parsing as a role switch.
 *
 * @param text - Raw `name` / `text` field of an entry received from a peer.
 * @returns The defanged text (empty string for a non-string / empty input).
 */
export function defangPeerKnowledgeText(text: unknown): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  let defanged = stripInvisibleChars(text);
  for (const rule of KNOWLEDGE_DEFANG_RULES) {
    defanged = defanged.replace(rule.pattern, rule.replacement);
  }
  return defanged;
}
