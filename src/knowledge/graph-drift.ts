/**
 * Architecture Drift Monitor
 *
 * Compares the current code graph against a saved snapshot to detect:
 *   - New/removed modules, classes, and functions
 *   - New coupling (import edges) between previously uncoupled modules
 *   - PageRank shifts (entities that gained/lost importance)
 *   - Community merges/splits
 *
 * Snapshot lifecycle:
 *   saveSnapshot(graph, cwd) → .codebuddy/code-graph-snapshot.json
 *   detectDrift(graph, cwd)  → DriftResult
 */

import fs from 'fs';
import path from 'path';
import { KnowledgeGraph, type Triple } from './knowledge-graph.js';
import { computePageRank } from './graph-pagerank.js';
import { logger } from '../utils/logger.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

const SNAPSHOT_FILENAME = '.codebuddy/code-graph-snapshot.json';

interface SnapshotFile {
  version: 1;
  savedAt: string;
  tripleCount: number;
  triples: Triple[];
}

// ============================================================================
// Snapshot Save/Load
// ============================================================================

/**
 * Save the current graph state as a snapshot for future drift comparison.
 */
export function saveSnapshot(graph: KnowledgeGraph, cwd: string): void {
  const filePath = path.join(cwd, SNAPSHOT_FILENAME);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const data: SnapshotFile = {
    version: 1,
    savedAt: new Date().toISOString(),
    tripleCount: graph.getStats().tripleCount,
    triples: graph.toJSON(),
  };

  writeJsonAtomicSync(filePath, data);
  logger.debug(`GraphDrift: snapshot saved (${data.tripleCount} triples)`);
}

/**
 * Load a previous snapshot (returns null if none exists).
 */
export function loadSnapshot(cwd: string): KnowledgeGraph | null {
  const filePath = path.join(cwd, SNAPSHOT_FILENAME);
  try {
    const data = readJsonAtomicSync<SnapshotFile | null>(filePath, null, {
      isValid: (value): value is SnapshotFile => Boolean(
        value && typeof value === 'object' &&
        (value as SnapshotFile).version === 1 &&
        Array.isArray((value as SnapshotFile).triples)
      ),
    });
    if (!data) return null;

    const snap = new KnowledgeGraph();
    snap.loadJSON(data.triples);
    return snap;
  } catch {
    return null;
  }
}

/**
 * Get snapshot metadata without loading all triples.
 */
export function getSnapshotInfo(cwd: string): { savedAt: string; tripleCount: number } | null {
  const filePath = path.join(cwd, SNAPSHOT_FILENAME);
  try {
    const data = readJsonAtomicSync<SnapshotFile | null>(filePath, null, {
      isValid: (value): value is SnapshotFile => Boolean(
        value && typeof value === 'object' &&
        (value as SnapshotFile).version === 1 &&
        Array.isArray((value as SnapshotFile).triples)
      ),
    });
    return data ? { savedAt: data.savedAt, tripleCount: data.tripleCount } : null;
  } catch {
    return null;
  }
}

// ============================================================================
// Drift Detection
// ============================================================================

export interface DriftResult {
  /** New modules not in the snapshot */
  addedModules: string[];
  /** Modules removed since snapshot */
  removedModules: string[];
  /** New classes */
  addedClasses: string[];
  /** Removed classes */
  removedClasses: string[];
  /** New coupling edges (A imports B that wasn't imported before) */
  newCoupling: Array<{ from: string; to: string }>;
  /** Removed coupling edges */
  removedCoupling: Array<{ from: string; to: string }>;
  /** Entities with biggest PageRank increase */
  rankGainers: Array<{ entity: string; oldRank: number; newRank: number; delta: number }>;
  /** Entities with biggest PageRank decrease */
  rankLosers: Array<{ entity: string; oldRank: number; newRank: number; delta: number }>;
  /** Summary stats */
  summary: {
    snapshotDate: string;
    oldTripleCount: number;
    newTripleCount: number;
    netModuleChange: number;
    netCouplingChange: number;
  };
}

/**
 * Compare current graph against a saved snapshot.
 * Returns null if no snapshot exists.
 */
export function detectDrift(graph: KnowledgeGraph, cwd: string): DriftResult | null {
  const snapshotGraph = loadSnapshot(cwd);
  if (!snapshotGraph) return null;

  const info = getSnapshotInfo(cwd)!;

  // --- Extract entity sets ---
  const extractEntitiesByPrefix = (g: KnowledgeGraph, prefix: string): Set<string> => {
    const entities = new Set<string>();
    for (const t of g.toJSON()) {
      if (t.subject.startsWith(prefix)) entities.add(t.subject);
      if (t.object.startsWith(prefix)) entities.add(t.object);
    }
    return entities;
  };

  // Modules
  const oldModules = extractEntitiesByPrefix(snapshotGraph, 'mod:');
  const newModules = extractEntitiesByPrefix(graph, 'mod:');
  const addedModules = [...newModules].filter(m => !oldModules.has(m)).sort();
  const removedModules = [...oldModules].filter(m => !newModules.has(m)).sort();

  // Classes
  const oldClasses = extractEntitiesByPrefix(snapshotGraph, 'cls:');
  const newClasses = extractEntitiesByPrefix(graph, 'cls:');
  const addedClasses = [...newClasses].filter(c => !oldClasses.has(c)).sort();
  const removedClasses = [...oldClasses].filter(c => !newClasses.has(c)).sort();

  // --- Coupling changes ---
  const extractImportEdges = (g: KnowledgeGraph): Set<string> => {
    const edges = new Set<string>();
    for (const t of g.query({ predicate: 'imports' })) {
      edges.add(`${t.subject}→${t.object}`);
    }
    return edges;
  };

  const oldImports = extractImportEdges(snapshotGraph);
  const newImports = extractImportEdges(graph);

  const newCoupling: Array<{ from: string; to: string }> = [];
  for (const edge of newImports) {
    if (!oldImports.has(edge)) {
      const [from, to] = edge.split('→');
      if (from === undefined || to === undefined) continue;
      newCoupling.push({ from, to });
    }
  }

  const removedCoupling: Array<{ from: string; to: string }> = [];
  for (const edge of oldImports) {
    if (!newImports.has(edge)) {
      const [from, to] = edge.split('→');
      if (from === undefined || to === undefined) continue;
      removedCoupling.push({ from, to });
    }
  }

  // --- PageRank shifts ---
  const oldPR = computePageRank(snapshotGraph).scores;
  let newPR: Map<string, number>;
  try { newPR = graph.getPageRank(); } catch { newPR = computePageRank(graph).scores; }

  const allRankedEntities = new Set([...oldPR.keys(), ...newPR.keys()]);
  const rankDeltas: Array<{ entity: string; oldRank: number; newRank: number; delta: number }> = [];

  for (const entity of allRankedEntities) {
    const oldRank = oldPR.get(entity) ?? 0;
    const newRank = newPR.get(entity) ?? 0;
    const delta = newRank - oldRank;
    if (Math.abs(delta) > 0.05) {
      rankDeltas.push({ entity, oldRank, newRank, delta });
    }
  }

  rankDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const rankGainers = rankDeltas.filter(d => d.delta > 0).slice(0, 10);
  const rankLosers = rankDeltas.filter(d => d.delta < 0).slice(0, 10);

  return {
    addedModules,
    removedModules,
    addedClasses,
    removedClasses,
    newCoupling: newCoupling.slice(0, 20),
    removedCoupling: removedCoupling.slice(0, 20),
    rankGainers,
    rankLosers,
    summary: {
      snapshotDate: info.savedAt,
      oldTripleCount: snapshotGraph.getStats().tripleCount,
      newTripleCount: graph.getStats().tripleCount,
      netModuleChange: addedModules.length - removedModules.length,
      netCouplingChange: newCoupling.length - removedCoupling.length,
    },
  };
}

/**
 * Format drift result as readable text.
 */
export function formatDrift(drift: DriftResult): string {
  const lines: string[] = [];
  const s = drift.summary;

  lines.push(`Architecture Drift Report (since ${s.snapshotDate})`);
  lines.push(`  Triples: ${s.oldTripleCount} → ${s.newTripleCount} (${s.newTripleCount - s.oldTripleCount >= 0 ? '+' : ''}${s.newTripleCount - s.oldTripleCount})`);
  lines.push(`  Modules: ${s.netModuleChange >= 0 ? '+' : ''}${s.netModuleChange} net`);
  lines.push(`  Coupling: ${s.netCouplingChange >= 0 ? '+' : ''}${s.netCouplingChange} net import edges`);
  lines.push('');

  if (drift.addedModules.length > 0) {
    lines.push(`New modules (${drift.addedModules.length}):`);
    for (const m of drift.addedModules.slice(0, 15)) lines.push(`  + ${m}`);
    if (drift.addedModules.length > 15) lines.push(`  +${drift.addedModules.length - 15} more`);
    lines.push('');
  }

  if (drift.removedModules.length > 0) {
    lines.push(`Removed modules (${drift.removedModules.length}):`);
    for (const m of drift.removedModules.slice(0, 15)) lines.push(`  - ${m}`);
    if (drift.removedModules.length > 15) lines.push(`  +${drift.removedModules.length - 15} more`);
    lines.push('');
  }

  if (drift.addedClasses.length > 0) {
    lines.push(`New classes (${drift.addedClasses.length}):`);
    for (const c of drift.addedClasses.slice(0, 10)) lines.push(`  + ${c}`);
    if (drift.addedClasses.length > 10) lines.push(`  +${drift.addedClasses.length - 10} more`);
    lines.push('');
  }

  if (drift.newCoupling.length > 0) {
    lines.push(`New coupling edges (${drift.newCoupling.length}):`);
    for (const e of drift.newCoupling.slice(0, 10)) {
      lines.push(`  ${e.from} → ${e.to}`);
    }
    if (drift.newCoupling.length > 10) lines.push(`  +${drift.newCoupling.length - 10} more`);
    lines.push('');
  }

  if (drift.rankGainers.length > 0) {
    lines.push('PageRank gainers (grew in importance):');
    for (const g of drift.rankGainers.slice(0, 5)) {
      lines.push(`  ↑ ${g.entity}: ${g.oldRank.toFixed(3)} → ${g.newRank.toFixed(3)} (+${g.delta.toFixed(3)})`);
    }
    lines.push('');
  }

  if (drift.rankLosers.length > 0) {
    lines.push('PageRank losers (decreased in importance):');
    for (const l of drift.rankLosers.slice(0, 5)) {
      lines.push(`  ↓ ${l.entity}: ${l.oldRank.toFixed(3)} → ${l.newRank.toFixed(3)} (${l.delta.toFixed(3)})`);
    }
  }

  return lines.join('\n');
}
