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

// ============================================================================
// BM25 Implementation
// ============================================================================

/** BM25 parameters */
const K1 = 1.2;   // Term frequency saturation
const B = 0.75;    // Length normalization

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
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

/**
 * Build a BM25 index from tool definitions.
 */
export class BM25Index {
  private documents: ToolDocument[] = [];
  private avgDL = 0;
  private idf = new Map<string, number>();

  /**
   * Add tool definitions to the index.
   */
  index(tools: Array<{ name: string; description: string; keywords?: string[] }>): void {
    this.documents = tools.map(t => {
      const tokens = [
        ...tokenize(t.name),
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
    const documentFrequencies = new Map<string, number>();
    for (const doc of this.documents) {
      for (const token of doc.tf.keys()) {
        documentFrequencies.set(token, (documentFrequencies.get(token) ?? 0) + 1);
      }
    }

    this.idf.clear();
    for (const [term, df] of documentFrequencies) {
      this.idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
    }
  }

  /**
   * Search for tools matching a query.
   * Returns results sorted by BM25 score (highest first).
   */
  search(query: string, maxResults: number = 10): Array<{ name: string; description: string; score: number }> {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const scored = this.documents.map(doc => {
      let score = 0;
      for (const qToken of queryTokens) {
        const tf = doc.tf.get(qToken) ?? 0;
        const idf = this.idf.get(qToken) ?? 0;

        // BM25 formula
        const numerator = tf * (K1 + 1);
        const denominator = tf + K1 * (1 - B + B * (doc.length / this.avgDL));
        score += idf * (numerator / denominator);
      }
      return { name: doc.name, description: doc.description, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }
}

// ============================================================================
// Tool Implementation
// ============================================================================

/** Singleton index */
let _index: BM25Index | null = null;
let _indexSignature: string | null = null;

function getIndexSignature(
  tools: Array<{ name: string; description: string; keywords?: string[] }>,
): string {
  return tools
    .map(tool => [
      tool.name,
      tool.description,
      [...(tool.keywords ?? [])].sort().join('\u0001'),
    ].join('\u0002'))
    .sort()
    .join('\u0003');
}

/**
 * Initialize the BM25 index with available tools.
 */
export function initToolSearchIndex(tools: Array<{ name: string; description: string; keywords?: string[] }>): void {
  const signature = getIndexSignature(tools);
  if (_index && _indexSignature === signature) return;

  _index = new BM25Index();
  _index.index(tools);
  _indexSignature = signature;
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

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    if (!query) return this.error('query is required');

    const maxResults = typeof input.max_results === 'number' ? input.max_results : 10;
    const index = getToolSearchIndex();
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

    const lines = results.map((r, i) => {
      let line = `${i + 1}. **${r.name}** (score: ${r.score.toFixed(2)})\n   ${r.description}`;

      // If deferred, include the full schema so the LLM can call it
      if (deferredSchemas?.has(r.name)) {
        const fullTool = deferredSchemas.get(r.name) as { function: { parameters: unknown } };
        if (fullTool?.function?.parameters) {
          line += `\n   Schema: ${JSON.stringify(fullTool.function.parameters)}`;
        }
      }

      return line;
    });

    // data.names lets the executor EXPAND the current turn's tool selection
    // with what was discovered — finding a tool must make it invocable on the
    // next round (true progressive disclosure), not just describe it.
    return this.success(`Found ${results.length} tools:\n\n${lines.join('\n\n')}`, {
      names: results.map((r) => r.name),
    });
  }
}
