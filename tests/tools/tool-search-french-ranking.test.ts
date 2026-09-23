import { beforeEach, describe, expect, it } from 'vitest';
import { BM25Index, initToolSearchIndex, ToolSearchTool } from '../../src/tools/tool-search.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';

describe('ToolSearchTool & BM25 ranking — French equivalences and query paraphrases', () => {
  beforeEach(() => {
    initToolSearchIndex(
      TOOL_METADATA.map((entry) => ({
        name: entry.name,
        description: entry.description,
        keywords: entry.keywords,
      })),
    );
  });

  // `read_file` (Hermes-compatible, line ranges) and `view_file` both read a
  // file: either is a correct first answer, as long as view_file stays in view.
  it('"voir le contenu" returns a file-reading tool first, view_file in the top 3', async () => {
    const tool = new ToolSearchTool();
    const result = await tool.execute({ query: 'voir le contenu' });

    expect(result.success).toBe(true);
    const data = result.data as { names?: string[] };
    expect(data?.names).toBeDefined();
    expect(['view_file', 'read_file']).toContain(data.names![0]);
    expect(data.names!.slice(0, 3)).toContain('view_file');
  });

  it('ranks French reading paraphrases appropriately', async () => {
    const tool = new ToolSearchTool();

    const r1 = await tool.execute({ query: 'lire un fichier' });
    expect(r1.success).toBe(true);
    const names1 = (r1.data as { names: string[] }).names;
    expect(names1.slice(0, 3)).toEqual(expect.arrayContaining(['view_file']));

    const r2 = await tool.execute({ query: 'afficher le contenu du code' });
    expect(r2.success).toBe(true);
    const names2 = (r2.data as { names: string[] }).names;
    expect(names2.slice(0, 2)).toContain('view_file');
  });

  it('ranks French search and navigation paraphrases appropriately', async () => {
    const tool = new ToolSearchTool();

    const rSearch = await tool.execute({ query: 'chercher du texte dans le projet' });
    expect(rSearch.success).toBe(true);
    const namesSearch = (rSearch.data as { names: string[] }).names;
    expect(namesSearch.slice(0, 3)).toEqual(expect.arrayContaining(['search']));

    const rList = await tool.execute({ query: 'lister le contenu du répertoire' });
    expect(rList.success).toBe(true);
    const namesList = (rList.data as { names: string[] }).names;
    expect(namesList.slice(0, 3)).toEqual(expect.arrayContaining(['list_directory']));

    const rSym = await tool.execute({ query: 'trouver un symbole ou une fonction' });
    expect(rSym.success).toBe(true);
    const namesSym = (rSym.data as { names: string[] }).names;
    expect(namesSym.slice(0, 3)).toContain('find_symbols');
  });

  it('ranks French editing and execution paraphrases appropriately', async () => {
    const tool = new ToolSearchTool();

    const rEdit = await tool.execute({ query: 'modifier et remplacer du texte' });
    expect(rEdit.success).toBe(true);
    const namesEdit = (rEdit.data as { names: string[] }).names;
    expect(namesEdit.slice(0, 3)).toContain('str_replace_editor');

    const rExec = await tool.execute({ query: 'lancer et exécuter une commande terminal' });
    expect(rExec.success).toBe(true);
    const namesExec = (rExec.data as { names: string[] }).names;
    expect(namesExec.slice(0, 3)).toContain('bash');
  });

  it('does not degrade standard English query rankings', async () => {
    const tool = new ToolSearchTool();

    const r1 = await tool.execute({ query: 'view file' });
    expect((r1.data as { names: string[] }).names[0]).toBe('view_file');

    const r2 = await tool.execute({ query: 'stock quote' });
    expect((r2.data as { names: string[] }).names[0]).toBe('stock_quote');

    const r3 = await tool.execute({ query: 'replace text in file' });
    expect(['str_replace_editor', 'patch']).toContain((r3.data as { names: string[] }).names[0]);
    expect((r3.data as { names: string[] }).names.slice(0, 2)).toEqual(expect.arrayContaining(['str_replace_editor', 'patch']));
  });

  it('handles accent normalization gracefully', () => {
    const index = new BM25Index();
    index.index([
      { name: 'mem_tool', description: 'Gère la mémoire et les souvenirs', keywords: ['mémoire', 'souvenir'] },
      { name: 'other_tool', description: 'Other utility', keywords: ['misc'] },
    ]);

    const resultsWithAccent = index.search('mémoire');
    expect(resultsWithAccent.length).toBeGreaterThan(0);
    expect(resultsWithAccent[0].name).toBe('mem_tool');

    const resultsWithoutAccent = index.search('memoire');
    expect(resultsWithoutAccent.length).toBeGreaterThan(0);
    expect(resultsWithoutAccent[0].name).toBe('mem_tool');
  });
});
