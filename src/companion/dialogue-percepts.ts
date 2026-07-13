/**
 * Addressed-dialogue projection over the complete hearing journal.
 *
 * The sensory journal deliberately keeps ambient speech for observability.
 * Relational memory, proactive emotion cues, and episode consolidation must
 * consume only turns that crossed the response gate.
 */

interface DialogueHearingPercept {
  summary?: unknown;
  payload?: unknown;
}

export function selectDialogueHearingTexts(
  percepts: DialogueHearingPercept[],
  limit: number
): string[] {
  const boundedLimit = Math.max(0, Math.floor(limit));
  if (boundedLimit === 0) return [];

  return percepts
    .filter((percept) => {
      const payload =
        percept.payload && typeof percept.payload === 'object' && !Array.isArray(percept.payload)
          ? (percept.payload as Record<string, unknown>)
          : null;
      return payload?.responded === true && payload.sttEmpty !== true;
    })
    .map((percept) => {
      const payload = percept.payload as Record<string, unknown>;
      const text = typeof payload.text === 'string' ? payload.text : percept.summary;
      return typeof text === 'string' ? text.replace(/^Heard:\s*/i, '').trim() : '';
    })
    .filter(Boolean)
    .slice(-boundedLimit);
}

/** Read a wider bounded window because ambient TV may dominate recent events. */
export async function readRecentDialogueHearing(
  limit: number,
  cwd?: string
): Promise<string[]> {
  try {
    const { readRecentCompanionPercepts } = await import('./percepts.js');
    const recent = await readRecentCompanionPercepts({
      modality: 'hearing',
      limit: Math.min(100, Math.max(limit, limit * 5)),
      ...(cwd ? { cwd } : {}),
    });
    // The percept API is newest-first; reflection and episode summaries need
    // the original conversational order.
    return selectDialogueHearingTexts([...recent].reverse(), limit);
  } catch {
    return [];
  }
}
