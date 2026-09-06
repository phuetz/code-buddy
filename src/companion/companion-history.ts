/**
 * The companion conversation primitives shared by every surface.
 *
 * Kept in its own module so the selfie router can read the history without
 * importing the turn runner (which imports the router back).
 *
 * @module companion/companion-history
 */

/**
 * One recorded conversation turn. `kind` marks an assistant turn that served a
 * selfie, so an elliptical follow-up ("encore une ?") can be resolved. Image
 * bytes are NEVER stored here.
 */
export interface CompanionHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
  kind?: 'selfie';
}

/**
 * True when the LAST assistant turn served a selfie — the only state under
 * which an elliptical follow-up means "another photo of you".
 */
export function historyHasRecentSelfie(
  history: readonly CompanionHistoryTurn[] = [],
): boolean {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (!turn || turn.role !== 'assistant') continue;
    return turn.kind === 'selfie';
  }
  return false;
}
