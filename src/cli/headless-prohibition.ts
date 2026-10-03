/** A negative clause cannot create a positive edit or reading obligation. */
export function isHeadlessProhibition(clause: string): boolean {
  const text = clause.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'").toLowerCase().trim()
    .replace(/^(?:please|can you|could you|would you|peux-tu|pourrais-tu|s'il te plait)\s+/, '');
  // French ne…que restricts a positive request; it is not a prohibition.
  return /^(?:do not|don't|never)\b|^ne\b.*\b(?:pas|aucun\w*|rien|jamais)\b/.test(text);
}
