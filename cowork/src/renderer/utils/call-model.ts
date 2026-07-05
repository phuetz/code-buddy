/**
 * Pure helpers for rendered phone-call transcripts.
 *
 * @module renderer/utils/call-model
 */

export interface CallTurn {
  id: string;
  speaker: string;
  text: string;
  startSec: number;
  endSec?: number;
}

export interface CallSummaryStats {
  durationSec: number;
  speakerCount: number;
}

export function summarizeCall(turns: CallTurn[]): CallSummaryStats {
  if (turns.length === 0) return { durationSec: 0, speakerCount: 0 };
  const speakers = new Set(turns.map((turn) => turn.speaker).filter(Boolean));
  const maxEnd = turns.reduce((max, turn) => Math.max(max, turn.endSec ?? turn.startSec), 0);
  const minStart = turns.reduce((min, turn) => Math.min(min, turn.startSec), turns[0]?.startSec ?? 0);
  return {
    durationSec: Math.max(0, Math.round(maxEnd - minStart)),
    speakerCount: speakers.size,
  };
}
