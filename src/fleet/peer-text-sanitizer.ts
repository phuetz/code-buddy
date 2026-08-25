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
