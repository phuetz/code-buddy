import { describe, it, expect } from 'vitest';
import { integrationToolHints } from '../../src/tools/integration-tool-hints.js';
const tools = ['mcp__code-explorer__list_repos', 'mcp__code-explorer__context', 'mcp__code-explorer__query', 'mcp__code-explorer__rename', 'mcp__lm-resizer__lm_resizer_tool_output'];
describe('installed integration discovery', () => {
  it('keeps structural tools for the real French developer question', () => {
    expect(integrationToolHints('Où est définie calculateInvoiceTotal et qui appelle cette fonction ?', tools)).toEqual(tools.slice(0, 3));
  });
  it('never restores a tool removed by the user filter', () => {
    expect(integrationToolHints('Code Explorer callers', [])).toEqual([]);
  });
  it('does not select integrations for unrelated tasks', () => {
    expect(integrationToolHints('Bonjour, quelle heure est-il ?', tools)).toEqual([]);
  });
  it('selects the installed compressor for bulky output without a shell wrapper', () => {
    expect(integrationToolHints('Compresse cette sortie volumineuse', tools)).toEqual([tools[4]]);
  });
});
