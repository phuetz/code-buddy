/**
 * useProcessedEdges Hook
 * Optimized edge processing with memoization
 * Injects execution item counts and n8n variant styling
 */

import { useMemo } from 'react';
import { Edge } from '@xyflow/react';
import { WorkflowEdge } from '../../type-mocks';
import { edgeStyleMap, defaultMarkerEnd, ConnectionStyle } from '../config/editorConfig';

interface UseProcessedEdgesParams {
  edges: WorkflowEdge[];
  nodeExecutionStatus: Record<string, string>;
  connectionStyle: ConnectionStyle;
  executionResults?: Record<string, unknown>;
}

export function useProcessedEdges({
  edges,
  nodeExecutionStatus,
  connectionStyle,
  executionResults,
}: UseProcessedEdgesParams): Edge[] {
  return useMemo(() => {
    return edges.map((edge: WorkflowEdge) => {
      // Determine edge style based on source node status
      const sourceStatus = nodeExecutionStatus[edge.source];
      const edgeConfig = sourceStatus === 'running' ? edgeStyleMap.running :
                         sourceStatus === 'success' ? edgeStyleMap.success :
                         sourceStatus === 'error' ? edgeStyleMap.error :
                         edgeStyleMap.default;

      const style = {
        ...edge.style,
        strokeWidth: edgeConfig.strokeWidth,
        stroke: edgeConfig.stroke,
        transition: 'all 0.3s ease',
      };

      const markerEnd = {
        ...defaultMarkerEnd,
        color: edgeConfig.color,
      };

      // Determine edge type based on connection style
      const type = connectionStyle === 'straight' ? 'straight' :
                   connectionStyle === 'smoothstep' ? 'smoothstep' : 'default';

      // Calculate item count from execution results of source node
      let itemCount: number | undefined;
      if (executionResults && sourceStatus === 'success') {
        const sourceResult = executionResults[edge.source];
        if (sourceResult) {
          if (Array.isArray(sourceResult)) {
            itemCount = sourceResult.length;
          } else if (typeof sourceResult === 'object' && sourceResult !== null) {
            const result = sourceResult as Record<string, unknown>;
            if (Array.isArray(result.data)) {
              itemCount = result.data.length;
            } else if (result.data) {
              itemCount = 1;
            }
          }
        }
      }

      // Map source status to n8n edge variant
      const variant = sourceStatus === 'running' ? 'executing' :
                      sourceStatus === 'success' ? 'success' :
                      sourceStatus === 'error' ? 'error' : 'default';

      // ValidationEdge reads `data.executionStatus` / `data.isExecuting` to
      // toggle the animateMotion flow particles, status icon, and stroke
      // colour. Without these fields the running animation never fires.
      const edgeExecutionStatus: 'running' | 'success' | 'error' | 'pending' | undefined =
        sourceStatus === 'running' ? 'running' :
        sourceStatus === 'success' ? 'success' :
        sourceStatus === 'error'   ? 'error'   :
        undefined;

      return {
        ...edge,
        style,
        animated: edgeConfig.animated,
        markerEnd,
        type,
        className: 'transition-all duration-300',
        data: {
          ...((edge as Edge).data || {}),
          variant,
          itemCount,
          executionStatus: edgeExecutionStatus,
          isExecuting: sourceStatus === 'running',
          dataFlowCount: itemCount,
        },
      };
    });
  }, [edges, nodeExecutionStatus, connectionStyle, executionResults]);
}
