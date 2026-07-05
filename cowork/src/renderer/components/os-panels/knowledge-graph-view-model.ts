export type KnowledgeNodeType = 'lesson' | 'decision' | 'fact' | 'discovery';

export interface KnowledgeGraphNode {
  id: string;
  type: KnowledgeNodeType;
  label: string;
  confidence?: number;
}

export interface KnowledgeGraphEdge {
  from: string;
  to: string;
  kind: string;
}

export interface KnowledgeNodeGroup {
  type: KnowledgeNodeType;
  label: string;
  count: number;
  averageConfidence: number | null;
  nodes: KnowledgeGraphNode[];
}

export interface KnowledgeGraphSummary {
  totalNodes: number;
  totalEdges: number;
  averageConfidence: number | null;
  groups: KnowledgeNodeGroup[];
}

const TYPE_LABELS: Record<KnowledgeNodeType, string> = {
  lesson: 'Leçons',
  decision: 'Décisions',
  fact: 'Faits',
  discovery: 'Découvertes',
};

const TYPE_ORDER: KnowledgeNodeType[] = ['lesson', 'decision', 'fact', 'discovery'];

export function normalizeConfidence(confidence: number | undefined): number | null {
  if (confidence === undefined || !Number.isFinite(confidence)) return null;
  return Math.max(0, Math.min(1, confidence));
}

export function formatConfidence(confidence: number | null): string {
  if (confidence === null) return '—';
  return String(Math.round(confidence * 100)) + ' %';
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function summarizeKnowledgeGraph(nodes: KnowledgeGraphNode[], edges: KnowledgeGraphEdge[]): KnowledgeGraphSummary {
  const groups = TYPE_ORDER.map((type) => {
    const groupNodes = nodes
      .filter((node) => node.type === type)
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
    const confidences = groupNodes
      .map((node) => normalizeConfidence(node.confidence))
      .filter((confidence): confidence is number => confidence !== null);

    return {
      type,
      label: TYPE_LABELS[type],
      count: groupNodes.length,
      averageConfidence: average(confidences),
      nodes: groupNodes,
    };
  });

  const allConfidences = nodes
    .map((node) => normalizeConfidence(node.confidence))
    .filter((confidence): confidence is number => confidence !== null);

  return {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    averageConfidence: average(allConfidences),
    groups,
  };
}

export function countEdgesForNode(nodeId: string, edges: KnowledgeGraphEdge[]): number {
  return edges.filter((edge) => edge.from === nodeId || edge.to === nodeId).length;
}
