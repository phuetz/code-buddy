/**
 * OpenClaw's src/agents/embedded-agent-helpers/bootstrap.ts policy digest
 * inspired this independently written selector.
 * Whole imperative lines come first; nearer project files retain precedence.
 * The canonical loader still owns exclusions, variants, imports and dedup.
 */
export function compactRuleDigest(context: string, ceiling = 1000): string {
  const sections = context.split(/(?=<!-- context:)/);
  const imperative = /\b(?:must|never|required|always|do not|shall|respond|reply|exactly|test|commit|ne pas|jamais|toujours|obligatoire|reponds|repondre|exactement|interdit|conserver|preserver)\b/i;
  const picked: Array<{ line: string; section: number; order: number }> = [];
  const seen = new Set<string>();
  const header = '<project_rules>\n';
  const footer = '\n</project_rules>';
  let used = header.length + footer.length;
  for (let section = sections.length - 1; section >= 0; section--) {
    const lines = sections[section]!.split('\n');
    for (const [order, raw] of lines.entries()) {
      const line = raw.trim();
      const normalized = line.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (!line || line.startsWith('<!--') || !imperative.test(normalized) || seen.has(line)) continue;
      if (used + line.length + 1 > ceiling) continue;
      picked.push({ line, section, order });
      seen.add(line);
      used += line.length + 1;
    }
  }
  if (!picked.length) return '';
  picked.sort((a, b) => a.section - b.section || a.order - b.order);
  return header + picked.map(p => p.line).join('\n') + footer;
}
