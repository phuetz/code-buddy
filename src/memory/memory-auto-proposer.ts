/**
 * Session transcript -> review-gated long-term memory candidates.
 *
 * This mirrors modern assistant memory systems: the model may infer durable
 * facts from a conversation, but those facts are queued with evidence and only
 * become prompt-injected memory after explicit acceptance.
 */

import { CodeBuddyClient } from '../codebuddy/client.js';
import { scanForSecrets } from '../fleet/privacy-lint.js';
import { logger } from '../utils/logger.js';
import { resolveAuxiliaryLlm, selectAuxiliaryClient } from '../providers/auxiliary-llm.js';
import type { ChatEntry } from '../agent/types.js';
import {
  getMemoryCandidateQueue,
  type MemoryCandidate,
  type MemoryCandidateCitation,
} from './memory-candidate-queue.js';
import type { MemoryCategory, MemoryScope } from './persistent-memory.js';

const VALID_CATEGORIES: MemoryCategory[] = [
  'project',
  'preferences',
  'decisions',
  'patterns',
  'context',
  'custom',
];

interface RawMemoryCandidate {
  key?: string;
  value?: string;
  scope?: string;
  category?: string;
  confidence?: number;
  rationale?: string;
}

interface NormalizedMemoryCandidate {
  key: string;
  value: string;
  scope: MemoryScope;
  category: MemoryCategory;
  confidence?: number;
  rationale?: string;
}

const SYSTEM_PROMPT = `You extract durable declarative long-term memory candidates for an AI coding assistant.

Return only facts that are useful in future sessions. Skip transient task narration, guesses, secrets, PII, credentials, and anything that merely repeats the assistant's own plan.

Output ONLY a raw JSON array matching:
Array<{
  key: string;
  value: string;
  scope: 'project'|'user';
  category: 'project'|'preferences'|'decisions'|'patterns'|'context'|'custom';
  confidence?: number;
  rationale?: string;
}>

Rules:
- 0 to 6 candidates. Return [] when nothing durable is present.
- "user" scope is only for stable user preferences/profile; most repo facts are "project".
- key must be short kebab-case.
- value must be a concise self-contained sentence under 220 characters.`;

export function buildMemoryCitations(
  history: ChatEntry[],
  needle: string,
  sessionId?: string,
  maxCitations = 2,
): MemoryCandidateCitation[] {
  const terms = compactText(needle)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9_@./:-]+/g)
    .filter((token) => token.length >= 4)
    .slice(0, 6);
  const matches: Array<{ score: number; index: number; entry: ChatEntry; compact: string }> = [];

  for (let index = 0; index < history.length; index++) {
    const entry = history[index];
    if (!entry?.content || entry.type === 'tool_call' || entry.type === 'reasoning') continue;
    const compact = compactText(entry.content);
    if (!compact) continue;
    const lower = compact
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (lower.includes(term)) score++;
    }
    if (score > 0 || terms.length === 0) {
      matches.push({ score, index, entry, compact });
    }
  }

  if (matches.length > 0) {
    return matches
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.entry.type === 'user' && b.entry.type !== 'user') return -1;
        if (b.entry.type === 'user' && a.entry.type !== 'user') return 1;
        return a.index - b.index;
      })
      .slice(0, maxCitations)
      .map((match) => ({
        ...(sessionId ? { sessionId } : {}),
        messageIndex: match.index + 1,
        role: match.entry.type,
        snippet: snippetAround(match.compact, terms),
      }));
  }

  const reversed = [...history].reverse();
  const fallback = reversed.find((entry) => entry.type === 'user' && entry.content.trim())
    ?? reversed.find((entry) => entry.type === 'assistant' && entry.content.trim());
  if (!fallback) return [];
  return [{
    ...(sessionId ? { sessionId } : {}),
    messageIndex: history.indexOf(fallback) + 1,
    role: fallback.type,
    snippet: compactText(fallback.content).slice(0, 220),
  }];
}

export function extractHeuristicMemoryCandidates(history: ChatEntry[]): NormalizedMemoryCandidate[] {
  const candidates: NormalizedMemoryCandidate[] = [];

  for (const entry of history) {
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    const text = compactText(entry.content);
    if (text.length < 20) continue;

    const userOnly = entry.type === 'user';
    const patterns: Array<{
      regex: RegExp;
      scope: MemoryScope;
      category: MemoryCategory;
      keyPrefix: string;
      confidence: number;
    }> = [
      {
        regex: /\b(?:remember|note|keep in memory|garde en memoire|souviens-toi)(?:\s+that|\s+que)?\s+([^.!?\n]{20,220})/i,
        scope: 'project',
        category: 'context',
        keyPrefix: 'remember',
        confidence: 0.68,
      },
      {
        regex: /\b(?:i|we|je|nous)\s+(?:prefer|prefere|preferons|always prefer)\s+([^.!?\n]{10,180})/i,
        scope: 'user',
        category: 'preferences',
        keyPrefix: 'preference',
        confidence: 0.72,
      },
      {
        regex: /\b(?:this repo|the project|codebase|ce projet|le projet)\s+(?:uses|is using|runs on|utilise|tourne sur)\s+([^.!?\n]{10,180})/i,
        scope: 'project',
        category: 'project',
        keyPrefix: 'project',
        confidence: 0.7,
      },
      {
        regex: /\b(?:we decided|decision:|decided to|nous avons decide|on a decide)\s+([^.!?\n]{10,180})/i,
        scope: 'project',
        category: 'decisions',
        keyPrefix: 'decision',
        confidence: 0.74,
      },
    ];

    for (const pattern of patterns) {
      if (!userOnly && pattern.scope === 'user') continue;
      const match = text.match(pattern.regex);
      const captured = match?.[1]?.trim();
      if (!captured) continue;
      candidates.push({
        key: makeKey(pattern.keyPrefix, captured),
        value: captured,
        scope: pattern.scope,
        category: pattern.category,
        confidence: pattern.confidence,
        rationale: 'deterministic transcript pattern',
      });
    }
  }

  return dedupeCandidates(candidates).slice(0, 6);
}

export async function proposeMemoryCandidatesFromSession(
  chatHistory: ChatEntry[],
  workDir: string = process.cwd(),
  client?: CodeBuddyClient,
  sessionId?: string,
): Promise<MemoryCandidate[]> {
  if (!chatHistory || chatHistory.length === 0) return [];

  const rawCandidates = await extractWithLlm(chatHistory, client);
  const normalized = rawCandidates.length > 0
    ? rawCandidates
    : extractHeuristicMemoryCandidates(chatHistory);

  if (normalized.length === 0) return [];

  const queue = getMemoryCandidateQueue(workDir);
  const proposed: MemoryCandidate[] = [];
  for (const candidate of normalized) {
    const lint = scanForSecrets(`${candidate.key}\n${candidate.value}\n${candidate.rationale ?? ''}`);
    if (lint.hasSecrets) {
      logger.warn('[memory-auto-proposer] candidate dropped: contains secret/PII material', {
        kinds: lint.matches.map((match) => match.kind),
      });
      continue;
    }

    try {
      const result = queue.propose({
        ...candidate,
        source: 'session_end',
        citations: buildMemoryCitations(chatHistory, `${candidate.key} ${candidate.value}`, sessionId),
      });
      proposed.push(result.candidate);
    } catch (err) {
      logger.debug('[memory-auto-proposer] propose failed', { err });
    }
  }

  return proposed;
}

async function extractWithLlm(
  chatHistory: ChatEntry[],
  client?: CodeBuddyClient,
): Promise<NormalizedMemoryCandidate[]> {
  const decision = resolveAuxiliaryLlm({ role: 'memory' });
  // Ambient discovery stays off under Vitest so a login on the machine
  // cannot turn every memory unit test into a provider call. An explicit
  // role setting, the published session route, or an injected client still runs.
  const reusableInTests = Boolean(client) || (
    decision.status === 'resolved'
    && (decision.source === 'explicit' || decision.source === 'session')
  );
  if ((process.env.NODE_ENV === 'test' || process.env.VITEST) && !reusableInTests) {
    return [];
  }
  const llm = selectAuxiliaryClient('memory', client);
  if (!llm) return [];

  try {
    const res = await llm.chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Session transcript:\n\n${formatTranscript(chatHistory)}` },
    ]);
    const reply = res.choices[0]?.message?.content || '';
    return parseMemoryCandidates(reply);
  } catch (err) {
    logger.debug('[memory-auto-proposer] LLM call failed', { err });
    return [];
  }
}

function parseMemoryCandidates(reply: string): NormalizedMemoryCandidate[] {
  let text = reply.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const fenced = fence?.[1];
  if (fenced !== undefined) text = fenced.trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return dedupeCandidates(parsed.map(normalizeRawCandidate).filter(isCandidate));
  } catch {
    return [];
  }
}

function normalizeRawCandidate(raw: unknown): NormalizedMemoryCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as RawMemoryCandidate;
  const key = makeSafeKey(item.key ?? '');
  const value = compactText(item.value ?? '').slice(0, 240);
  const scope: MemoryScope = item.scope === 'user' ? 'user' : 'project';
  const category = VALID_CATEGORIES.includes(item.category as MemoryCategory)
    ? item.category as MemoryCategory
    : 'context';
  if (!key || !value) return null;
  return {
    key,
    value,
    scope,
    category,
    ...(typeof item.confidence === 'number' ? { confidence: Math.max(0, Math.min(1, item.confidence)) } : {}),
    ...(item.rationale?.trim() ? { rationale: compactText(item.rationale).slice(0, 240) } : {}),
  };
}

function isCandidate(candidate: NormalizedMemoryCandidate | null): candidate is NormalizedMemoryCandidate {
  return candidate !== null;
}

function formatTranscript(history: ChatEntry[]): string {
  return history
    .slice(-80)
    .map((entry, index) => {
      const role = entry.type === 'tool_result'
        ? `[${entry.toolCall?.function?.name || 'tool'}]`
        : entry.type;
      return `${index + 1}. ${role}: ${compactText(entry.content).slice(0, 800)}`;
    })
    .join('\n');
}

function dedupeCandidates(candidates: NormalizedMemoryCandidate[]): NormalizedMemoryCandidate[] {
  const seen = new Set<string>();
  const unique: NormalizedMemoryCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.scope}:${candidate.key}:${candidate.value}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

function compactText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function snippetAround(text: string, terms: string[], maxLength = 220): string {
  const lower = text.toLowerCase();
  const indexes = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0);
  const first = indexes.length > 0 ? Math.min(...indexes) : 0;
  const start = Math.max(0, first - 60);
  const end = Math.min(text.length, start + maxLength);
  return `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`;
}

function makeKey(prefix: string, text: string): string {
  const base = makeSafeKey(text).split('-').slice(0, 5).join('-') || prefix;
  return `${prefix}-${base}`.slice(0, 72);
}

function makeSafeKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 72);
}
