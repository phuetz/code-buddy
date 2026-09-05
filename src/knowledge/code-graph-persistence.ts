/**
 * Code Graph Persistence
 *
 * Save/load the KnowledgeGraph to `.codebuddy/code-graph.json`.
 * Lazy loading: graph is loaded on first access, not at startup.
 */

import fs from 'fs';
import path from 'path';
import { KnowledgeGraph, Triple } from './knowledge-graph.js';
import { logger } from '../utils/logger.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

const CODE_GRAPH_FILENAME = '.codebuddy/code-graph.json';

interface CodeGraphFile {
  version: 1;
  buildTime: string;
  tripleCount: number;
  triples: Triple[];
}

/**
 * Save the knowledge graph to disk.
 */
export function saveCodeGraph(graph: KnowledgeGraph, cwd: string): void {
  const filePath = path.join(cwd, CODE_GRAPH_FILENAME);
  const dir = path.dirname(filePath);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data: CodeGraphFile = {
      version: 1,
      buildTime: new Date().toISOString(),
      tripleCount: graph.getStats().tripleCount,
      triples: graph.toJSON(),
    };

    writeJsonAtomicSync(filePath, data, { mode: 0o600 });
    logger.debug(`CodeGraph: saved ${data.tripleCount} triples to ${CODE_GRAPH_FILENAME}`);
  } catch (err) {
    logger.debug('CodeGraph: failed to save', { err });
  }
}

/**
 * Load the knowledge graph from disk into the given graph instance.
 * Returns true if loaded successfully, false otherwise.
 */
export function loadCodeGraph(graph: KnowledgeGraph, cwd: string): boolean {
  const filePath = path.join(cwd, CODE_GRAPH_FILENAME);

  try {
    const data = readJsonAtomicSync<CodeGraphFile | null>(filePath, null, {
      isValid: (value): value is CodeGraphFile => Boolean(
        value && typeof value === 'object' &&
        (value as CodeGraphFile).version === 1 &&
        Array.isArray((value as CodeGraphFile).triples)
      ),
    });
    if (!data) return false;

    graph.loadJSON(data.triples);
    logger.debug(`CodeGraph: loaded ${data.tripleCount} triples from ${CODE_GRAPH_FILENAME}`);
    return true;
  } catch (err) {
    logger.warn('CodeGraph: failed to load (file may be corrupted)', { error: String(err) });
    return false;
  }
}

/**
 * Check if the code graph file exists.
 */
export function codeGraphExists(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, CODE_GRAPH_FILENAME));
}
