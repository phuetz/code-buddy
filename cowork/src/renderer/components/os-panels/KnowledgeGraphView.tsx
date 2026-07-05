import { Brain, GitBranch } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState.js';
import { Pill } from '../ui/Pill.js';
import { SectionCard } from '../ui/SectionCard.js';
import { countEdgesForNode, formatConfidence, summarizeKnowledgeGraph, type KnowledgeGraphEdge, type KnowledgeGraphNode } from './knowledge-graph-view-model.js';

export interface KnowledgeGraphViewProps {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

export function KnowledgeGraphView({ nodes, edges }: KnowledgeGraphViewProps) {
  const summary = summarizeKnowledgeGraph(nodes, edges);

  return (
    <SectionCard
      title="Graphe de connaissance"
      description="Leçons, décisions, faits et découvertes classés par type."
      actions={<Pill tone="info">{summary.totalEdges} liens</Pill>}
    >
      {summary.totalNodes === 0 ? (
        <EmptyState title="Aucune connaissance" hint="Les éléments apparaîtront ici quand Fable injectera les données." icon={<Brain className="h-5 w-5" />} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted p-3">
              <div className="text-xs text-muted-foreground">Nœuds</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{summary.totalNodes}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted p-3">
              <div className="text-xs text-muted-foreground">Liens</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{summary.totalEdges}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted p-3">
              <div className="text-xs text-muted-foreground">Confiance moyenne</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{formatConfidence(summary.averageConfidence)}</div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {summary.groups.map((group) => (
              <section key={group.type} className="rounded-lg border border-border bg-surface p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
                    <p className="text-xs text-muted-foreground">{group.count} items · confiance {formatConfidence(group.averageConfidence)}</p>
                  </div>
                  <Pill tone={group.count > 0 ? 'success' : 'default'}>{group.count}</Pill>
                </div>
                {group.nodes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun item pour ce type.</p>
                ) : (
                  <div className="space-y-2">
                    {group.nodes.map((node) => (
                      <div key={node.id} className="rounded-md border border-border bg-muted px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">{node.label}</div>
                            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                              <GitBranch className="h-3 w-3" />
                              <span className="tabular-nums">{countEdgesForNode(node.id, edges)} liens</span>
                            </div>
                          </div>
                          <span className="tabular-nums text-xs text-muted-foreground">{formatConfidence(formatNodeConfidence(node.confidence))}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function formatNodeConfidence(confidence: number | undefined): number | null {
  if (confidence === undefined || !Number.isFinite(confidence)) return null;
  return Math.max(0, Math.min(1, confidence));
}
