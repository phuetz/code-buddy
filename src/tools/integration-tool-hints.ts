/** Keep installed native integrations discoverable for their actual tasks.
 * Only selects names present after the user's tool filter; never grants access.
 */
export function integrationToolHints(query: string, availableNames: string[]): string[] {
  const names = new Set(availableNames);
  const selected: string[] = [];
  if (/code[ -]?explorer|callers?|callees?|who calls|qui appelle|appelants?|relations? (?:du|de|between)|impact|blast radius|dépendanc|dependencies/i.test(query)) {
    const prefix = availableNames.find(name => /^mcp__(?:code-explorer|gitnexus)__context$/.test(name))?.replace(/context$/, '');
    if (prefix) selected.push(`${prefix}list_repos`, `${prefix}context`, `${prefix}query`);
    else if (names.has('code_explorer_ask')) selected.push('code_explorer_ask');
  }
  if (/lm[ -]?resizer|compress|rédui.{0,20}(?:sortie|contexte)|sortie.{0,25}(?:volumineuse|répétitive)|noisy output/i.test(query)) {
    selected.push(...availableNames.filter(name => /^mcp__[^_]+__lm_resizer_(?:tool_output|retrieve|stats)$/.test(name)));
  }
  return [...new Set(selected)].filter(name => names.has(name));
}
