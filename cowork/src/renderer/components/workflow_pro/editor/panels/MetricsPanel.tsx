// @ts-nocheck
/**
 * MetricsPanel Component
 * Displays workflow metrics in the editor
 */

import React from 'react';
import { Panel } from '@xyflow/react';
import { WorkflowNode, WorkflowEdge } from '../../type-mocks';
import { nodeTypes } from '../../data-mocks';

interface MetricsPanelProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  zoomLevel: number;
  darkMode: boolean;
}

const MetricsPanelComponent: React.FC<MetricsPanelProps> = ({ nodes, edges, zoomLevel, darkMode }) => {
  const triggerCount = nodes.filter(
    n => nodeTypes[n.data.type]?.category === 'trigger'
  ).length;

  return (
    <Panel position="top-right" className="mt-20">
      <div className={`${
        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      } rounded-lg shadow-xl p-4 border transition-colors duration-300`}>
        <h3 className="text-sm font-semibold mb-2">Métriques</h3>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span>Nœuds:</span>
            <span className="font-mono">{nodes.length}</span>
          </div>
          <div className="flex justify-between">
            <span>Connexions:</span>
            <span className="font-mono">{edges.length}</span>
          </div>
          <div className="flex justify-between">
            <span>Zoom:</span>
            <span className="font-mono">{Math.round(zoomLevel * 100)}%</span>
          </div>
          <div className="flex justify-between">
            <span>Triggers:</span>
            <span className="font-mono text-orange-500">{triggerCount}</span>
          </div>
        </div>
      </div>
    </Panel>
  );
};

export const MetricsPanel = React.memo(MetricsPanelComponent, (prev, next) => {
  return (
    prev.nodes.length === next.nodes.length &&
    prev.edges.length === next.edges.length &&
    prev.zoomLevel === next.zoomLevel &&
    prev.darkMode === next.darkMode
  );
});

export default MetricsPanel;
