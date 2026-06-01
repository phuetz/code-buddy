/**
 * Lesson auto-proposer (D2 / Hermes closed-learning-loop autonomy).
 *
 * Mirrors `runUserDialecticInference` (user model): after a complex successful
 * session, analyse the transcript with the LLM and PROPOSE reusable procedural
 * lessons into the candidate queue. Strictly review-gated — `propose()` only
 * enqueues PENDING candidates; nothing reaches `lessons.md` until a human
 * approves (the existing `buddy lessons candidate approve` / Cowork panel).
 *
 * No-ops safely when there is no transcript or no configured LLM provider, so
 * it can be auto-invoked from a session-end hook without risk.
 *
 * @module agent/lesson-auto-proposer
 */

import { CodeBuddyClient } from '../codebuddy/client.js';
import { detectProviderFromEnv } from '../utils/provider-detector.js';
import type { ChatEntry } from './types.js';
import {
  getLessonCandidateQueue,
  type LessonCandidate,
} from './lesson-candidate-queue.js';
import { logger } from '../utils/logger.js';

type Category = 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT';
const VALID: Category[] = ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'];

const SYSTEM_PROMPT = `You extract REUSABLE PROCEDURAL LESSONS from a coding session that just completed.
A good lesson is a generalizable rule/pattern/insight that would help on a FUTURE, similar task —
not a restatement of what happened. Examples: "Run \`npm run typecheck\` before marking a task done",
"This repo's ESM imports need .js extensions even from .ts".

Rules:
1. Only durable, transferable lessons. Skip task-specific narration, secrets, and trivia.
2. 0 to 4 lessons. If nothing is reusable, return [].
3. Output ONLY a raw JSON array matching:
Array<{ category: 'PATTERN'|'RULE'|'CONTEXT'|'INSIGHT'; content: string; context?: string }>`;

function formatTranscript(history: ChatEntry[]): string {
  const lines: string[] = [];
  for (const e of history) {
    if (e.type === 'user') lines.push(`User: ${e.content}`);
    else if (e.type === 'assistant') lines.push(`Assistant: ${e.content}`);
    else if (e.type === 'tool_result') {
      const tool = e.toolCall?.function?.name || 'tool';
      const out = e.content.length > 400 ? e.content.slice(0, 400) + '…' : e.content;
      lines.push(`[${tool}]: ${out}`);
    }
  }
  return lines.join('\n');
}

function parseCandidates(reply: string): Array<{ category: string; content: string; context?: string }> {
  let text = reply.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const fenced = fence?.[1];
  if (fenced !== undefined) text = fenced.trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Analyse a finished session and propose reusable lessons (PENDING only).
 * @returns the proposed candidates (empty when no provider / nothing worthwhile).
 */
export async function proposeLessonsFromSession(
  chatHistory: ChatEntry[],
  workDir: string = process.cwd(),
  client?: CodeBuddyClient,
): Promise<LessonCandidate[]> {
  if (!chatHistory || chatHistory.length === 0) return [];

  let llm: CodeBuddyClient;
  if (client) {
    llm = client;
  } else {
    const detected = detectProviderFromEnv();
    if (!detected) {
      logger.debug('[lesson-auto-proposer] no provider configured; skipping');
      return [];
    }
    llm = new CodeBuddyClient(detected.apiKey, detected.defaultModel, detected.baseURL);
  }

  let reply: string;
  try {
    const res = await llm.chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Session transcript:\n\n${formatTranscript(chatHistory)}` },
    ]);
    reply = res.choices[0]?.message?.content || '';
  } catch (err) {
    logger.debug('[lesson-auto-proposer] LLM call failed', { err });
    return [];
  }

  const queue = getLessonCandidateQueue(workDir);
  const proposed: LessonCandidate[] = [];
  for (const cand of parseCandidates(reply)) {
    const category = String(cand.category || '').toUpperCase() as Category;
    const content = (cand.content || '').trim();
    if (!content || !VALID.includes(category)) continue;
    try {
      const { candidate } = queue.propose({
        category,
        content,
        context: typeof cand.context === 'string' ? cand.context : undefined,
        source: 'self_observed',
        provenance: { note: 'auto-proposed after a complex session (D2)' },
      });
      if (candidate) proposed.push(candidate);
    } catch (err) {
      logger.debug('[lesson-auto-proposer] propose failed', { err });
    }
  }
  return proposed;
}
