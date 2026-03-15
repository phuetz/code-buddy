/**
 * Mermaid Diagram Generator
 *
 * Transforms KnowledgeGraph queries into Mermaid flowcharts.
 * Used by the code_graph tool for visual call chains, class hierarchies, etc.
 */

import { KnowledgeGraph } from './knowledge-graph.js';
import type { CommunityResult } from './community-detection.js';

// ============================================================================
// Color System — consistent across all diagrams
// ============================================================================

export const MERMAID_COLORS = {
  critical:   { fill: '#f9f', stroke: '#c0c' },  // PageRank > 0.01
  important:  { fill: '#ffd', stroke: '#aa0' },  // PageRank 0.005-0.01
  standard:   { fill: '#dff', stroke: '#0aa' },  // Default
  entryPoint: { fill: '#dfd', stroke: '#0c0' },  // Entry points
  focal:      { fill: '#f9f', stroke: '#333' },  // Focal node in query
};

/** Generate a markdown legend block to append after colored diagrams */
export function generateMermaidLegend(): string {
  return '> **Legend:** 🟣 Critical path (PageRank > 0.01) · 🟡 High importance · 🔵 Standard module · 🟢 Entry point';
}

/** Classify a node by PageRank score */
function classifyNode(rank: number): keyof typeof MERMAID_COLORS {
  if (rank > 0.01) return 'critical';
  if (rank > 0.005) return 'important';
  return 'standard';
}

/** Generate style lines for a set of nodes based on their PageRank */
export function generateNodeStyles(
  graph: KnowledgeGraph,
  nodeIds: Map<string, string>,
  focalEntity?: string,
): string[] {
  const styles: string[] = [];
  for (const [entity, id] of nodeIds) {
    if (entity === focalEntity) {
      styles.push(`    style ${id} fill:${MERMAID_COLORS.focal.fill},stroke:${MERMAID_COLORS.focal.stroke},stroke-width:2px`);
    } else {
      const rank = graph.getEntityRank(entity);
      const cls = classifyNode(rank);
      const color = MERMAID_COLORS[cls];
      styles.push(`    style ${id} fill:${color.fill},stroke:${color.stroke}`);
    }
  }
  return styles;
}

// ============================================================================
// Call Flowchart
// ============================================================================

/**
 * Generate a Mermaid flowchart showing the call chain around a function.
 * @param depth - How many levels of calls to follow (default 2)
 * @param maxNodes - Max nodes to render (default 30)
 */
export function generateCallFlowchart(
  graph: KnowledgeGraph,
  entity: string,
  depth: number = 2,
  maxNodes: number = 30,
): string {
  const visited = new Set<string>();
  const edges: Array<[string, string]> = [];

  // BFS outward (what does entity call?)
  const outQueue: Array<{ node: string; d: number }> = [{ node: entity, d: 0 }];
  while (outQueue.length > 0) {
    const { node, d } = outQueue.shift()!;
    if (visited.has(node) || d > depth || visited.size >= maxNodes) continue;
    visited.add(node);

    const callsOut = graph.query({ subject: node, predicate: 'calls' });
    for (const t of callsOut) {
      edges.push([node, t.object]);
      if (!visited.has(t.object) && d + 1 <= depth) {
        outQueue.push({ node: t.object, d: d + 1 });
      }
    }
  }

  // BFS inward (who calls entity?)
  const inVisited = new Set<string>();
  const inQueue: Array<{ node: string; d: number }> = [{ node: entity, d: 0 }];
  while (inQueue.length > 0) {
    const { node, d } = inQueue.shift()!;
    if (inVisited.has(node) || d > depth || visited.size + inVisited.size >= maxNodes) continue;
    inVisited.add(node);

    const callsIn = graph.query({ predicate: 'calls', object: node });
    for (const t of callsIn) {
      edges.push([t.subject, node]);
      visited.add(t.subject);
      if (!inVisited.has(t.subject) && d + 1 <= depth) {
        inQueue.push({ node: t.subject, d: d + 1 });
      }
    }
  }

  if (edges.length === 0) return '';

  const lines = ['graph TD'];
  const nodeIds = new Map<string, string>();
  let counter = 0;

  function nodeId(name: string): string {
    if (!nodeIds.has(name)) {
      nodeIds.set(name, `N${counter++}`);
    }
    return nodeIds.get(name)!;
  }

  function label(name: string): string {
    // Strip prefix (fn:, cls:, mod:)
    return name.replace(/^(fn|cls|mod|iface):/, '');
  }

  // Declare nodes
  for (const name of visited) {
    const id = nodeId(name);
    const lbl = label(name);
    if (name === entity) {
      lines.push(`    ${id}[["${lbl}"]]`); // Double bracket = highlight
    } else if (name.startsWith('cls:')) {
      lines.push(`    ${id}[/"${lbl}"/]`); // Parallelogram = class
    } else {
      lines.push(`    ${id}["${lbl}"]`);
    }
  }

  // Declare edges
  const seenEdges = new Set<string>();
  for (const [from, to] of edges) {
    const key = `${from}→${to}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    lines.push(`    ${nodeId(from)} --> ${nodeId(to)}`);
  }

  // Apply PageRank-based coloring to all nodes
  lines.push(...generateNodeStyles(graph, nodeIds, entity));

  return lines.join('\n');
}

// ============================================================================
// Class Hierarchy Tree
// ============================================================================

/**
 * Generate a Mermaid flowchart showing class inheritance hierarchy.
 */
export function generateClassHierarchy(
  graph: KnowledgeGraph,
  entity: string,
  maxNodes: number = 30,
): string {
  const visited = new Set<string>();
  const edges: Array<{ from: string; to: string; type: 'extends' | 'implements' }> = [];

  // BFS: find all related classes via extends/implements
  const queue = [entity];
  while (queue.length > 0 && visited.size < maxNodes) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    // Who does this extend?
    const extendsTriples = graph.query({ subject: current, predicate: 'extends' });
    for (const t of extendsTriples) {
      edges.push({ from: current, to: t.object, type: 'extends' });
      if (!visited.has(t.object)) queue.push(t.object);
    }

    // Who extends this?
    const extendedBy = graph.query({ predicate: 'extends', object: current });
    for (const t of extendedBy) {
      edges.push({ from: t.subject, to: current, type: 'extends' });
      if (!visited.has(t.subject)) queue.push(t.subject);
    }

    // What does this implement?
    const implTriples = graph.query({ subject: current, predicate: 'implements' });
    for (const t of implTriples) {
      edges.push({ from: current, to: t.object, type: 'implements' });
      if (!visited.has(t.object)) queue.push(t.object);
    }

    // Who implements this? (if it's an interface)
    const implBy = graph.query({ predicate: 'implements', object: current });
    for (const t of implBy) {
      edges.push({ from: t.subject, to: current, type: 'implements' });
      if (!visited.has(t.subject)) queue.push(t.subject);
    }
  }

  if (edges.length === 0) return '';

  const lines = ['graph BT'];
  const nodeIds = new Map<string, string>();
  let counter = 0;

  function nodeId(name: string): string {
    if (!nodeIds.has(name)) nodeIds.set(name, `C${counter++}`);
    return nodeIds.get(name)!;
  }

  function label(name: string): string {
    return name.replace(/^(cls|iface):/, '');
  }

  for (const name of visited) {
    const id = nodeId(name);
    const lbl = label(name);
    if (name.startsWith('iface:')) {
      lines.push(`    ${id}[/"${lbl} (interface)"/]`);
    } else if (name === entity) {
      lines.push(`    ${id}[["${lbl}"]]`);
    } else {
      lines.push(`    ${id}["${lbl}"]`);
    }
  }

  const seenEdges = new Set<string>();
  for (const { from, to, type } of edges) {
    const key = `${from}→${to}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    if (type === 'extends') {
      lines.push(`    ${nodeId(from)} -->|extends| ${nodeId(to)}`);
    } else {
      lines.push(`    ${nodeId(from)} -.->|implements| ${nodeId(to)}`);
    }
  }

  lines.push(...generateNodeStyles(graph, nodeIds, entity));
  return lines.join('\n');
}

// ============================================================================
// Module Dependency Diagram
// ============================================================================

/**
 * Generate a Mermaid flowchart showing module import relationships.
 */
export function generateModuleDependencies(
  graph: KnowledgeGraph,
  entity: string,
  depth: number = 1,
  maxNodes: number = 25,
): string {
  const visited = new Set<string>();
  const edges: Array<[string, string]> = [];
  const queue: Array<{ node: string; d: number }> = [{ node: entity, d: 0 }];

  while (queue.length > 0) {
    const { node, d } = queue.shift()!;
    if (visited.has(node) || d > depth || visited.size >= maxNodes) continue;
    visited.add(node);

    // Outgoing imports
    const imports = graph.query({ subject: node, predicate: 'imports' });
    for (const t of imports) {
      edges.push([node, t.object]);
      if (!visited.has(t.object) && d + 1 <= depth) {
        queue.push({ node: t.object, d: d + 1 });
      }
    }

    // Incoming imports (usedBy)
    const usedBy = graph.query({ predicate: 'imports', object: node });
    for (const t of usedBy) {
      edges.push([t.subject, node]);
      if (!visited.has(t.subject) && d + 1 <= depth) {
        queue.push({ node: t.subject, d: d + 1 });
      }
    }
  }

  if (edges.length === 0) return '';

  const lines = ['graph LR'];
  const nodeIds = new Map<string, string>();
  let counter = 0;

  function nodeId(name: string): string {
    if (!nodeIds.has(name)) nodeIds.set(name, `M${counter++}`);
    return nodeIds.get(name)!;
  }

  function label(name: string): string {
    const stripped = name.replace(/^mod:/, '');
    // Show only last 2 segments for readability
    const parts = stripped.split('/');
    return parts.length > 2 ? parts.slice(-2).join('/') : stripped;
  }

  for (const name of visited) {
    const id = nodeId(name);
    if (name === entity) {
      lines.push(`    ${id}[["${label(name)}"]]`);
    } else {
      lines.push(`    ${id}["${label(name)}"]`);
    }
  }

  const seenEdges = new Set<string>();
  for (const [from, to] of edges) {
    const key = `${from}→${to}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    lines.push(`    ${nodeId(from)} -->|imports| ${nodeId(to)}`);
  }

  lines.push(...generateNodeStyles(graph, nodeIds, entity));
  return lines.join('\n');
}

// ============================================================================
// Community Diagram
// ============================================================================

/**
 * Generate a Mermaid diagram showing communities as subgraphs
 * with inter-community import edges.
 */
export function generateCommunityDiagram(
  graph: KnowledgeGraph,
  communities: CommunityResult,
  maxNodes: number = 40,
  maxCommunities: number = 10,
): string {
  if (communities.communityMembers.size === 0) return '';

  const lines = ['graph LR'];
  const nodeIds = new Map<string, string>();
  let counter = 0;
  let totalNodes = 0;

  function nodeId(name: string): string {
    if (!nodeIds.has(name)) nodeIds.set(name, `N${counter++}`);
    return nodeIds.get(name)!;
  }

  function label(name: string): string {
    const stripped = name.replace(/^mod:/, '');
    const parts = stripped.split('/');
    return parts.length > 2 ? parts.slice(-2).join('/') : stripped;
  }

  // Sort communities by size (largest first)
  const sortedCommunities = [...communities.communityMembers.entries()]
    .sort((a, b) => b[1].length - a[1].length);

  // Render subgraphs (capped to maxCommunities)
  let communityCount = 0;
  for (const [cid, members] of sortedCommunities) {
    if (totalNodes >= maxNodes || communityCount >= maxCommunities) break;
    communityCount++;

    // Community label: common path prefix
    const paths = members.map(m => m.replace(/^mod:/, ''));
    const prefix = commonDirPrefix(paths);
    const communityLabel = prefix || `Community ${cid}`;

    const shown = members.slice(0, Math.min(6, maxNodes - totalNodes));
    const more = members.length > shown.length ? members.length - shown.length : 0;

    lines.push(`  subgraph C${cid}["${communityLabel} (${members.length} modules)"]`);
    for (const member of shown) {
      lines.push(`    ${nodeId(member)}["${label(member)}"]`);
      totalNodes++;
    }
    if (more > 0) {
      const moreId = `more_${cid}`;
      nodeIds.set(moreId, moreId);
      lines.push(`    ${moreId}["+${more} more"]`);
      totalNodes++;
    }
    lines.push('  end');
  }

  // Inter-community edges: count imports between communities
  const interEdges = new Map<string, number>(); // "cidA→cidB" → count
  const importTriples = graph.query({ predicate: 'imports' });
  for (const t of importTriples) {
    const fromCid = communities.communities.get(t.subject);
    const toCid = communities.communities.get(t.object);
    if (fromCid !== undefined && toCid !== undefined && fromCid !== toCid) {
      const key = `${fromCid}→${toCid}`;
      interEdges.set(key, (interEdges.get(key) ?? 0) + 1);
    }
  }

  // Render inter-community edges (top-10 by count)
  const sortedEdges = [...interEdges.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  for (const [key, count] of sortedEdges) {
    const [fromCid, toCid] = key.split('→');
    lines.push(`  C${fromCid} -->|"${count} imports"| C${toCid}`);
  }

  return lines.join('\n');
}

/** Find the common directory prefix of multiple paths */
function commonDirPrefix(paths: string[]): string {
  if (paths.length === 0) return '';
  if (paths.length === 1) {
    const i = paths[0].lastIndexOf('/');
    return i >= 0 ? paths[0].substring(0, i) : paths[0];
  }
  const sorted = [...paths].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  let i = 0;
  while (i < first.length && i < last.length && first[i] === last[i]) i++;
  const prefix = first.substring(0, i);
  const lastSlash = prefix.lastIndexOf('/');
  return lastSlash >= 0 ? prefix.substring(0, lastSlash) : '';
}
