/** Shared grammatical boundaries for action and reading obligations.
 * Quoted literals retain punctuation and conjunctions as literal text.
 */
export function splitHeadlessClauses(prompt: string): string[] {
  const tokens = /`[^`]*`|"[^"\n]*"|(?<![\w])'[^'\n]*'|([?!;,\n]\s*|\.(?=\s|$)\s*|\b(?:then|puis|ensuite|but|mais|and|et)\s+)/gi;
  const clauses: string[] = [];
  let start = 0;
  for (const token of prompt.matchAll(tokens)) {
    if (!token[1]) continue;
    clauses.push(prompt.slice(start, token.index).trim());
    start = token.index! + token[0].length;
  }
  clauses.push(prompt.slice(start).trim());
  return clauses.filter(Boolean);
}

/** A separate statement of presence supplies context, not an imperative. */
export function isIncidentalHeadlessClause(clause: string, index: number): boolean {
  // Only a complete presence statement is incidental. Matching just its
  // prefix would discard a following means, condition or obligation.
  const text = clause.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return index > 0 && /^(?:(?:the|an?|this|that)\s+[\w\s-]+\s+(?:appears?|exists?|occurs?)\s+(?:in|inside)|(?:le|la|les|un|une|ce|cet|cette)\s+[\w\s-]+\s+(?:existe(?:nt)?|apparait|apparaissent|se trouve(?:nt)?)\s+dans)\s+[^\s]+[.!?]?$/i.test(text.trim());
}
