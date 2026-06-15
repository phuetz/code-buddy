// @ts-nocheck
/**
 * useProcessedNodes Hook
 * Optimized node processing with memoization
 */

import { useMemo } from 'react';
import { Node } from '@xyflow/react';
import { WorkflowNode } from '../../type-mocks';
import { nodeTypes } from '../../data-mocks';
import { scaleConfig, ViewMode } from '../config/editorConfig';

interface UseProcessedNodesParams {
  nodes: WorkflowNode[];
  nodeExecutionStatus: Record<string, string>;
  selectedNodeIds: Set<string>;
  viewMode: ViewMode;
}

export function useProcessedNodes({
  nodes,
  nodeExecutionStatus,
  selectedNodeIds,
  viewMode,
}: UseProcessedNodesParams): Node[] {
  return useMemo(() => {
    const scaleByViewMode = viewMode === 'compact' ? scaleConfig.compact :
                            viewMode === 'detailed' ? scaleConfig.detailed :
                            scaleConfig.normal;
    const showLabelsFlag = viewMode !== 'compact';
    const showMetricsFlag = viewMode === 'detailed';

    return nodes.map((node: WorkflowNode) => {
      const nodeType = nodeTypes[node.data.type];
      const status = nodeExecutionStatus[node.id];
      const isSelected = selectedNodeIds.has(node.id);
      const scale = scaleByViewMode;

      // Build className efficiently
      const classNames = [
        'animate-fadeIn transition-all duration-300',
        nodeType?.category && `node-${nodeType.category}`,
        status ? `node-${status}` : 'node-idle',
        isSelected && 'ring-2 ring-primary-500 ring-opacity-50'
      ].filter(Boolean).join(' ');

      return {
        ...node,
        className: classNames,
        style: {
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          filter: status === 'running' ? 'brightness(1.1)' : undefined,
        },
        data: {
          ...node.data,
          showLabels: showLabelsFlag,
          showMetrics: showMetricsFlag && !!status,
          status,
        }
      };
    });
  }, [nodes, nodeExecutionStatus, selectedNodeIds, viewMode]);
}

export function useSelectedNodeIds(
  selectedNodes: Node[],
  selectedNode: Node | null
): Set<string> {
  return useMemo(() =>
    new Set([
      ...selectedNodes.map(node => node.id),
      ...(selectedNode ? [selectedNode.id] : [])
    ]), [selectedNodes, selectedNode]);
}
