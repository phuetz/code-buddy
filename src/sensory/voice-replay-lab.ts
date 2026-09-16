/**
 * Offline, silent replay lab for acoustic-loop regressions.
 *
 * It never invokes an LLM, TTS, a channel, memory, or a tool. Raw text is used
 * transiently to calculate similarity and is absent from the returned report.
 */

import { readFileSync } from 'node:fs';

export interface VoiceReplayRecord {
  role?: string;
  content?: string;
  timestamp?: string | number;
}

export interface VoiceReplayOptions {
  maxEchoGapMs?: number;
  similarityThreshold?: number;
}

export interface VoiceReplayReport {
  safeMode: 'offline-silent';
  records: number;
  validTurns: number;
  assistantTurns: number;
  userTurns: number;
  echoCandidates: number;
  delayedEchoCandidates: number;
  longestFeedbackChain: number;
  maxSimilarity: number;
  suppressionCoverage: number;
  passed: boolean;
}

const TOKEN = /[\p{L}\p{N}]+/gu;

function tokens(text: string): string[] {
  return (text.toLowerCase().normalize('NFKD').match(TOKEN) ?? [])
    .filter(token => token.length > 1);
}

/** Sørensen-Dice over word bigrams, with a token fallback for short lines. */
export function voiceEchoSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.length === 0 || b.length === 0) return 0;
  const grams = (items: string[]): Set<string> => {
    if (items.length === 1) return new Set(items);
    return new Set(items.slice(0, -1).map((item, index) => `${item} ${items[index + 1]}`));
  };
  const ag = grams(a);
  const bg = grams(b);
  let overlap = 0;
  for (const gram of ag) if (bg.has(gram)) overlap++;
  return (2 * overlap) / (ag.size + bg.size);
}

function timestamp(value: string | number | undefined): number | undefined {
  const parsed = typeof value === 'number' ? value : value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function replayVoiceTimeline(
  records: VoiceReplayRecord[],
  options: VoiceReplayOptions = {},
): VoiceReplayReport {
  const maxEchoGapMs = Math.max(500, options.maxEchoGapMs ?? 30_000);
  const threshold = Math.max(0.5, Math.min(1, options.similarityThreshold ?? 0.72));
  const turns = records
    .map(record => ({
      role: record.role === 'assistant' || record.role === 'user' ? record.role : undefined,
      content: typeof record.content === 'string' ? record.content.trim() : '',
      at: timestamp(record.timestamp),
    }))
    .filter((record): record is { role: 'assistant' | 'user'; content: string; at: number | undefined } =>
      Boolean(record.role && record.content));

  let lastAssistant: (typeof turns)[number] | undefined;
  let echoCandidates = 0;
  let delayedEchoCandidates = 0;
  let chain = 0;
  let longestFeedbackChain = 0;
  let maxSimilarity = 0;

  for (const turn of turns) {
    if (turn.role === 'assistant') {
      lastAssistant = turn;
      continue;
    }
    if (!lastAssistant) {
      chain = 0;
      continue;
    }
    const gap = turn.at !== undefined && lastAssistant.at !== undefined
      ? Math.max(0, turn.at - lastAssistant.at)
      : 0;
    const similarity = voiceEchoSimilarity(lastAssistant.content, turn.content);
    maxSimilarity = Math.max(maxSimilarity, similarity);
    if (gap <= maxEchoGapMs && similarity >= threshold) {
      echoCandidates++;
      if (gap > 2_000) delayedEchoCandidates++;
      chain++;
      longestFeedbackChain = Math.max(longestFeedbackChain, chain);
    } else {
      chain = 0;
    }
  }

  // A candidate present as a user turn reached the conversation transcript: it
  // was therefore not suppressed by the live playback/tail gate. This offline
  // report must fail instead of assuming 100% coverage for the very leak it found.
  const suppressionCoverage = echoCandidates === 0 ? 1 : 0;
  return {
    safeMode: 'offline-silent',
    records: records.length,
    validTurns: turns.length,
    assistantTurns: turns.filter(turn => turn.role === 'assistant').length,
    userTurns: turns.filter(turn => turn.role === 'user').length,
    echoCandidates,
    delayedEchoCandidates,
    longestFeedbackChain,
    maxSimilarity: Math.round(maxSimilarity * 1000) / 1000,
    suppressionCoverage,
    passed: suppressionCoverage === 1,
  };
}

export function replayVoiceFile(path: string, options: VoiceReplayOptions = {}): VoiceReplayReport {
  const records: VoiceReplayRecord[] = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as VoiceReplayRecord);
    } catch {
      records.push({});
    }
  }
  return replayVoiceTimeline(records, options);
}
