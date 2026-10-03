/** Remove courtesy/reminder framing, retaining the actual obligation and its polarity. */
export function unwrapHeadlessRequest(clause: string): string {
  return clause.trim()
    .replace(/^(?:please|can you|could you|would you|will you|est-ce que tu peux|est-ce que vous pouvez|peux-tu|pourrais-tu|s'il te pla[iî]t)\s+/i, '')
    .replace(/^(?:(?:do not|don['’‘]t|never|you\s+(?:must|should|may)\s+not)\s+(?:forget|hesitate|fail)\s+to\s+|(?:n['’‘]|ne\s+)(?:oublie[sz]?|h[ée]site[sz]?)\s+(?:(?:surtout|vraiment)\s+)?(?:pas|jamais)\s+(?:d['’‘]|de\s+|[àa]\s+|que\s+(?:tu\s+dois|vous\s+devez|je\s+dois|nous\s+devons)\s+))/i, '')
    // A bare file reminder is a request to consult that file, not a ban.
    .replace(/^(?:n['’‘]|ne\s+)oublie[sz]?\s+(?:surtout\s+)?pas\s+(?=[\w./-]+\.[a-zA-Z])/i, 'lis ');
}

/** A negative clause cannot create a positive edit or reading obligation. */
export function isHeadlessProhibition(clause: string): boolean {
  const text = unwrapHeadlessRequest(clause).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'").toLowerCase().trim()
    .replace(/^(?:please|can you|could you|would you|peux-tu|pourrais-tu|s'il te plait)\s+/, '');
  // French ne…que restricts a positive request; it is not a prohibition.
  return /^(?:not|do not|don't|never|you\s+(?:must|should|may)\s+not)\b|^(?:ne\b|n').*\b(?:pas|aucun\w*|rien|jamais)\b/.test(text);
}
