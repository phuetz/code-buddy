/**
 * BM25 Tool Search
 *
 * When the agent has access to many tools (especially via MCP),
 * this tool allows searching for relevant tools by keyword using
 * BM25/TF-IDF ranking over tool metadata.
 *
 * Inspired by OpenAI Codex CLI's tool_search with BM25.
 */

import { BaseTool, ParameterDefinition } from './base-tool.js';
import { ToolResult } from '../types/index.js';
import { resolveToolEffect } from './tool-effect.js';
import type { IToolExecutionContext } from './registry/types.js';

// ============================================================================
// BM25 Implementation
// ============================================================================

const QUERY_EQUIVALENTS: Record<string, readonly string[]> = {
  lire: ['read', 'view'],
  voir: ['view', 'read'],
  contenu: ['content', 'contents'],
  contenus: ['content', 'contents'],
  consulter: ['view', 'read'],
  ouvrir: ['open', 'read', 'view'],
  afficher: ['show', 'display', 'view', 'list'],
  fichier: ['file'],
  fichiers: ['file', 'files'],
  dossier: ['directory', 'folder'],
  dossiers: ['directory', 'directories', 'folder', 'folders'],
  repertoire: ['directory', 'folder'],
  repertoires: ['directory', 'directories', 'folder', 'folders'],
  chercher: ['search', 'find'],
  rechercher: ['search', 'find'],
  trouver: ['find', 'search'],
  modifier: ['edit', 'replace'],
  remplacer: ['replace', 'edit'],
  creer: ['create'],
  supprimer: ['delete', 'remove'],
  memoire: ['memory'],
  executer: ['execute', 'run'],
  lancer: ['run', 'execute'],
  commande: ['command'],
  terminal: ['terminal', 'bash', 'shell'],
  lister: ['list', 'directory'],
  symbole: ['symbol', 'symbols'],
  symboles: ['symbol', 'symbols'],
  fonction: ['function', 'symbol', 'symbols'],
  fonctions: ['function', 'functions', 'symbol', 'symbols'],
  texte: ['text'],
};

/**
 * Words that carry no intent. Dropped from the QUERY only: a French request
 * ("voir le contenu du fichier") otherwise spends half its weight on "le",
 * "du", which match whatever description happens to contain them.
 */
const QUERY_STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'l',
  'dans', 'sur', 'pour', 'avec', 'par', 'ce', 'cet', 'cette', 'ces',
  'mon', 'ton', 'son', 'notre', 'votre', 'leur', 'en', 'au', 'aux',
  'et', 'ou', 'qui', 'que', 'quoi', 'dont', 'est', 'sont',
  'the', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are',
]);

/** BM25 parameters */
const K1 = 1.2;   // Term frequency saturation
const B = 0.75;    // Length normalization

export interface SearchableTool {
  name: string;
  description: string;
  keywords?: string[];
  parameters?: unknown;
}

interface ToolDocument {
  name: string;
  description: string;
  keywords: string[];
  /** Tokenized words (lowercased) */
  tokens: string[];
  /** Token frequency map */
  tf: Map<string, number>;
  /** Total token count */
  length: number;
}

/**
 * Tokenize text into searchable terms.
 */
function tokenize(text: string): string[] {
  return text
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Build a BM25 index from tool definitions.
 */
export class BM25Index {
  private documents: ToolDocument[] = [];
  private avgDL = 0;
  private catalog = new Map<string, SearchableTool>();

  getTool(name: string): SearchableTool | undefined { return this.catalog.get(name); }
  private idf = new Map<string, number>();

  /**
   * Add tool definitions to the index.
   */
  index(tools: SearchableTool[]): void {
    this.idf.clear();
    this.catalog = new Map(tools.map(tool => [tool.name, tool]));
    this.documents = [...this.catalog.values()].map(t => {
      const tokens = [
        ...Array.from({ length: 3 }, () => tokenize(t.name)).flat(),
        ...tokenize(t.description),
        ...(t.keywords ?? []).flatMap(k => tokenize(k)),
      ];
      const tf = new Map<string, number>();
      for (const token of tokens) {
        tf.set(token, (tf.get(token) ?? 0) + 1);
      }
      return {
        name: t.name,
        description: t.description,
        keywords: t.keywords ?? [],
        tokens,
        tf,
        length: tokens.length,
      };
    });

    // Compute average document length
    this.avgDL = this.documents.reduce((sum, d) => sum + d.length, 0) / Math.max(this.documents.length, 1);

    // Compute IDF for all terms
    const N = this.documents.length;
    const frequencies = new Map<string, number>();
    for (const doc of this.documents) {
      for (const token of doc.tf.keys()) {
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      }
    }

    for (const [term, df] of frequencies) {
      this.idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
    }
  }

  /**
   * Search for tools matching a query.
   * Returns results sorted by BM25 score (highest first).
   */
  search(query: string, maxResults: number = 10): Array<{ name: string; description: string; score: number }> {
    const queryTokens = [...new Set(tokenize(query).filter(term => !QUERY_STOPWORDS.has(term)).flatMap(term => [term, ...(QUERY_EQUIVALENTS[term] ?? [])]))];
    const limit = Number.isFinite(maxResults) ? Math.max(1, Math.min(50, Math.floor(maxResults))) : 10;
    if (queryTokens.length === 0) return [];

    const scored = this.documents.map(doc => {
      let score = doc.name.toLowerCase() === query.trim().toLowerCase() ? 100 : 0;
      for (const qToken of queryTokens) {
        const tf = doc.tf.get(qToken) ?? 0;
        const idf = this.idf.get(qToken) ?? 0;

        // BM25 formula
        const numerator = tf * (K1 + 1);
        const denominator = tf + K1 * (1 - B + B * (doc.length / this.avgDL));
        score += idf * (numerator / denominator);
      }
      const nameTerms = new Set(tokenize(doc.name));
      if (queryTokens.every(term => nameTerms.has(term))) score += 5;
      return { name: doc.name, description: doc.description, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, limit);
  }
}

// ============================================================================
// Tool Implementation
// ============================================================================

/** Singleton index */
let _index: BM25Index | null = null;

/**
 * Initialize the BM25 index with available tools.
 */
export function initToolSearchIndex(tools: SearchableTool[]): void {
  _index = new BM25Index();
  _index.index(tools);
}

/**
 * Get the BM25 index (creates empty if not initialized).
 */
export function getToolSearchIndex(): BM25Index {
  if (!_index) {
    _index = new BM25Index();
  }
  return _index;
}

export class ToolSearchTool extends BaseTool {
  readonly name = 'tool_search';
  readonly description = 'Search for available tools by keyword. Useful when you need to find a specific tool from a large set (especially MCP tools).';

  protected getParameters(): Record<string, ParameterDefinition> {
    return {
      query: {
        type: 'string',
        description: 'Search query — keywords describing what you need to do.',
        required: true,
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results (default: 10).',
      },
    };
  }

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    const query = input.query;
    if (typeof query !== 'string' || !query.trim() || query.length > 2000) return this.error('query must be a nonempty string of at most 2000 characters');
    if (input.max_results !== undefined && (typeof input.max_results !== 'number' || !Number.isInteger(input.max_results) || input.max_results < 1 || input.max_results > 50)) return this.error('max_results must be an integer between 1 and 50');

    const maxResults = typeof input.max_results === 'number' ? input.max_results : 10;
    const catalog = context?.extra?.toolSearchCatalog;
    const index = Array.isArray(catalog) ? new BM25Index() : getToolSearchIndex();
    if (Array.isArray(catalog)) index.index(catalog as SearchableTool[]);
    const results = index.search(query, maxResults);

    if (results.length === 0) {
      return this.success(`No tools found matching "${query}".`);
    }

    // Check if deferred MCP schema loading is active
    let deferredSchemas: Map<string, unknown> | null = null;
    try {
      const { getDeferredMCPSchemas, isDeferredSchemaMode } = await import('./deferred-schema-state.js');
      if (isDeferredSchemaMode()) {
        deferredSchemas = getDeferredMCPSchemas();
      }
    } catch {
      // tools.js not available — skip deferred schema resolution
    }

    const tools = results.map(result => ({
      ...result,
      effect: resolveToolEffect(result.name),
      parameters: index.getTool(result.name)?.parameters ??
        (deferredSchemas?.get(result.name) as { function?: { parameters?: unknown } } | undefined)?.function?.parameters,
    }));
    const lines = tools.map((r, i) => {
      const effect = resolveToolEffect(r.name);
      let line = `${i + 1}. **${r.name}** (score: ${r.score.toFixed(2)})\n   effect: ${effect}\n   ${r.description}`;

      if (r.parameters) line += `\n   Schema: ${JSON.stringify(r.parameters)}`;

      return line;
    });

    // data.names lets the executor EXPAND the current turn's tool selection
    // with what was discovered — finding a tool must make it invocable on the
    // next round (true progressive disclosure), not just describe it.
    return this.success(`Found ${results.length} tools:\n\n${lines.join('\n\n')}`, {
      tools,
      names: results.map((r) => r.name),
      effects: Object.fromEntries(results.map((r) => [r.name, resolveToolEffect(r.name)])),
    });
  }
}
