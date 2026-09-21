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
import { resolveToolEffect } from './metadata.js';

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

/** French stopwords to filter during tokenization */
const FRENCH_STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'l',
  'dans', 'sur', 'pour', 'avec', 'par', 'ce', 'cet', 'cette', 'ces',
  'mon', 'ton', 'son', 'notre', 'votre', 'leur', 'en', 'au', 'aux',
  'et', 'ou', 'qui', 'que', 'quoi', 'dont', 'est', 'sont', 'a',
]);

/** English stopwords to filter during tokenization */
const ENGLISH_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are',
]);

const SYNONYM_MAP: Record<string, string[]> = {
  // Viewing / reading
  voir: ['view', 'show', 'display', 'see'],
  vue: ['view', 'show', 'display'],
  regarder: ['view', 'look', 'see', 'watch'],
  lire: ['read', 'view', 'display'],
  lecture: ['read', 'view'],
  afficher: ['display', 'show', 'view'],
  affiche: ['display', 'show', 'view'],
  montrer: ['show', 'display', 'view'],
  montre: ['show', 'display', 'view'],
  consulter: ['view', 'read', 'check'],
  examiner: ['view', 'inspect', 'examine'],
  ouvrir: ['open', 'read', 'view'],

  // Content / File / Directory
  contenu: ['content', 'contents', 'text', 'file'],
  contenus: ['contents', 'content'],
  fichier: ['file', 'files', 'document'],
  fichiers: ['files', 'file'],
  dossier: ['directory', 'folder', 'dir'],
  dossiers: ['directories', 'folders', 'directory'],
  repertoire: ['directory', 'folder', 'dir'],
  repertoires: ['directories', 'folders', 'directory'],
  lister: ['list', 'directory', 'ls', 'dir'],
  liste: ['list', 'directory', 'dir'],
  arborescence: ['tree', 'directory', 'structure'],

  // Searching / finding
  chercher: ['search', 'find', 'locate', 'grep'],
  cherche: ['search', 'find', 'grep'],
  rechercher: ['search', 'find', 'locate', 'grep'],
  recherche: ['search', 'find', 'locate', 'grep'],
  trouver: ['find', 'search', 'locate'],
  trouve: ['find', 'search', 'locate'],
  localiser: ['locate', 'find', 'search'],
  symbole: ['symbol', 'symbols'],
  symboles: ['symbols', 'symbol'],
  fonction: ['function', 'functions', 'symbol', 'symbols'],
  fonctions: ['functions', 'function', 'symbols', 'symbol'],
  reference: ['reference', 'references'],
  references: ['references', 'usages'],

  // Editing / writing / creating
  creer: ['create', 'new', 'make', 'write', 'touch'],
  creation: ['create', 'new'],
  ecrire: ['write', 'create', 'edit'],
  ecriture: ['write', 'creation'],
  nouveau: ['new', 'create'],
  nouvelle: ['new', 'create'],
  ajouter: ['add', 'create', 'append'],
  modifier: ['edit', 'modify', 'change', 'update', 'replace', 'patch'],
  modifie: ['edit', 'modify', 'change', 'update'],
  modification: ['edit', 'modify', 'change'],
  editer: ['edit', 'modify', 'editor'],
  edition: ['edit', 'editor'],
  remplacer: ['replace', 'edit', 'patch', 'substitute'],
  remplace: ['replace', 'edit', 'patch'],
  remplacement: ['replacement', 'replace'],
  corriger: ['fix', 'repair', 'correct', 'edit'],
  changer: ['change', 'modify', 'edit'],
  supprimer: ['delete', 'remove'],
  effacer: ['erase', 'clear', 'delete'],

  // Execution / Terminal / Command
  executer: ['execute', 'run', 'exec', 'bash', 'command'],
  execute: ['execute', 'run', 'exec'],
  lancer: ['run', 'launch', 'execute', 'start'],
  lance: ['run', 'launch', 'execute'],
  commande: ['command', 'bash', 'terminal', 'cmd', 'cli'],
  terminal: ['terminal', 'bash', 'shell', 'console'],

  // Git / VCS
  historique: ['history', 'log', 'commits'],
  version: ['version', 'diff', 'revision'],
  branche: ['branch', 'git'],

  // Web / Browser
  navigateur: ['browser', 'web', 'page'],
  naviguer: ['browse', 'navigate'],
  page: ['page', 'web', 'url', 'fetch'],
  telecharger: ['download', 'fetch'],

  // Self / Introspection
  soi: ['self', 'introspection', 'myself'],
  introspecter: ['introspection', 'self', 'describe'],
  introspecte: ['introspection', 'self'],
  composants: ['components', 'bricks', 'architecture'],
  briques: ['bricks', 'components'],
  memoire: ['memory', 'recall', 'remember'],
  souvenir: ['remember', 'memory'],
  rappeler: ['recall', 'remember'],
};

// Build reverse synonym map (English -> French)
const REVERSE_SYNONYM_MAP: Record<string, string[]> = {};
for (const [fr, engList] of Object.entries(SYNONYM_MAP)) {
  for (const eng of engList) {
    if (!REVERSE_SYNONYM_MAP[eng]) {
      REVERSE_SYNONYM_MAP[eng] = [];
    }
    REVERSE_SYNONYM_MAP[eng].push(fr);
  }
}

/**
 * Tokenize text into searchable terms with accent normalization.
 */
function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !FRENCH_STOPWORDS.has(t) && !ENGLISH_STOPWORDS.has(t));
}

/**
 * Expand tokens with synonyms (French <-> English).
 */
function expandTokens(tokens: string[]): string[] {
  const result = new Set<string>(tokens);
  for (const token of tokens) {
    const frSynonyms = SYNONYM_MAP[token];
    if (frSynonyms) {
      for (const s of frSynonyms) result.add(s);
    }
    const enSynonyms = REVERSE_SYNONYM_MAP[token];
    if (enSynonyms) {
      for (const s of enSynonyms) result.add(s);
    }
  }
  return Array.from(result);
}

interface ToolDocument {
  name: string;
  nameTokens: string[];
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
 * Build a BM25 index from tool definitions.
 */
export class BM25Index {
  private documents: ToolDocument[] = [];
  private avgDL = 0;
  private idf = new Map<string, number>();

  /**
   * Add tool definitions to the index.
   */
  index(tools: Array<{ name: string; description: string; keywords?: string[]; priority?: number }>): void {
    this.documents = tools.map((t) => {
      const baseNameTokens = tokenize(t.name);
      const nameTokens = expandTokens(baseNameTokens);
      const baseTokens = [
        ...baseNameTokens,
        ...tokenize(t.description),
        ...(t.keywords ?? []).flatMap((k) => tokenize(k)),
      ];

      const tf = new Map<string, number>();
      for (const token of baseNameTokens) {
        tf.set(token, (tf.get(token) ?? 0) + 5);
      }
      for (const token of tokenize(t.description)) {
        tf.set(token, (tf.get(token) ?? 0) + 2);
      }
      for (const kw of t.keywords ?? []) {
        for (const token of tokenize(kw)) {
          tf.set(token, (tf.get(token) ?? 0) + 2);
        }
      }

      // Propagate synonyms into TF map with discount
      for (const [token, count] of Array.from(tf.entries())) {
        const frSynonyms = SYNONYM_MAP[token];
        if (frSynonyms) {
          for (const s of frSynonyms) {
            tf.set(s, Math.max(tf.get(s) ?? 0, Math.ceil(count * 0.8)));
          }
        }
        const enSynonyms = REVERSE_SYNONYM_MAP[token];
        if (enSynonyms) {
          for (const s of enSynonyms) {
            tf.set(s, Math.max(tf.get(s) ?? 0, Math.ceil(count * 0.8)));
          }
        }
      }

      return {
        name: t.name,
        nameTokens,
        description: t.description,
        keywords: t.keywords ?? [],
        tokens: Array.from(tf.keys()),
        tf,
        length: baseTokens.length,
      };
    });

    // Compute average document length
    this.avgDL = this.documents.reduce((sum, d) => sum + d.length, 0) / Math.max(this.documents.length, 1);

    // Compute IDF for all terms
    const N = this.documents.length;
    const allTerms = new Set<string>();
    for (const doc of this.documents) {
      for (const token of doc.tf.keys()) {
        allTerms.add(token);
      }
    }

    for (const term of allTerms) {
      const df = this.documents.filter((d) => d.tf.has(term)).length;
      this.idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
    }
  }

  /**
   * Search for tools matching a query.
   * Returns results sorted by BM25 score (highest first).
   */
  search(query: string, maxResults: number = 10): Array<{ name: string; description: string; score: number }> {
    const rawTokens = tokenize(query);
    const queryTokens = expandTokens(rawTokens);
    if (queryTokens.length === 0) return [];

    const scored = this.documents.map((doc) => {
      let score = 0;
      let nameMatches = 0;
      for (const qToken of queryTokens) {
        const tf = doc.tf.get(qToken) ?? 0;
        const idf = this.idf.get(qToken) ?? 0;

        // BM25 formula
        const numerator = tf * (K1 + 1);
        const denominator = tf + K1 * (1 - B + B * (doc.length / this.avgDL));
        score += idf * (numerator / denominator);

        if (doc.nameTokens.includes(qToken)) {
          nameMatches += 1;
        }
      }

      // Bonus for name matches
      if (nameMatches > 0) {
        score += nameMatches * 5.0;
      }

      return { name: doc.name, description: doc.description, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
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
export function initToolSearchIndex(tools: Array<{ name: string; description: string; keywords?: string[] }>): void {
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
      const effect = resolveToolEffect(r.name);
      let line = `${i + 1}. **${r.name}** (score: ${r.score.toFixed(2)})\n   effect: ${effect}\n   ${r.description}`;

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
      effects: Object.fromEntries(results.map((r) => [r.name, resolveToolEffect(r.name)])),
    });
  }
}
