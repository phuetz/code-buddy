// @ts-nocheck
/**
 * useClickHandlers
 *
 * Handles click events on nodes, edges, and the pane.
 * Extracted from useWorkflowEvents for better separation of concerns.
 */

import { useCallback } from 'react';
import { Node, Edge } from '@xyflow/react';
import { WorkflowNode, WorkflowEdge } from '../../../type-mocks';
import { useWorkflowStore } from '../../../store';
import { usePanels } from '../../context';

export interface UseClickHandlersOptions {
  /** Reference to the ReactFlow wrapper for position calculations */
  reactFlowWrapper: React.RefObject<HTMLDivElement>;
  /** Project screen coordinates to flow coordinates */
  project: (position: { x: number; y: number }) => { x: number; y: number };
  /** Whether to use n8n-style UI */
  useN8nStyle: boolean;
}

export interface UseClickHandlersReturn {
  handleNodeClick: (event: React.MouseEvent, node: Node | WorkflowNode) => void;
  handleEdgeClick: (event: React.MouseEvent, edge: Edge | WorkflowEdge) => void;
  handlePaneClick: (event: React.MouseEvent) => void;
  handlePaneDoubleClick: (event: React.MouseEvent) => void;
}

/**
 * Hook for handling click events in the workflow editor
 */
export function useClickHandlers(options: UseClickHandlersOptions): UseClickHandlersReturn {
  const { reactFlowWrapper: _reactFlowWrapper, project, useN8nStyle } = options;

  // Store actions
  const setSelectedNode = useWorkflowStore((state) => state.setSelectedNode);
  const setSelectedNodes = useWorkflowStore((state) => state.setSelectedNodes);
  const setSelectedEdge = useWorkflowStore((state) => state.setSelectedEdge);

  // Panel context
  const { openPanel, _closePanel, setContextMenu, setQuickSearchPosition, setFocusPanelNode } = usePanels();

  /**
   * Handle node click - single or multi-select
   */
  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node | WorkflowNode) => {
      if (event.ctrlKey || event.metaKey) {
        // Multi-selection with Ctrl/Cmd
        const currentSelectedNodes = useWorkflowStore.getState().selectedNodes;
        const isSelected = currentSelectedNodes.includes(node.id);

        if (isSelected) {
          setSelectedNodes(currentSelectedNodes.filter((id) => id !== node.id));
        } else {
          setSelectedNodes([...currentSelectedNodes, node.id]);
        }
      } else {
        // Single selection
        setSelectedNode(node as WorkflowNode);
        setSelectedNodes([]);

        // Open appropriate panel based on style
        if (useN8nStyle) {
          setFocusPanelNode(node as WorkflowNode);
          openPanel('focus');
        } else {
          openPanel('config');
        }
      }
    },
    [setSelectedNodes, setSelectedNode, useN8nStyle, setFocusPanelNode, openPanel]
  );

  /**
   * Handle edge click - select edge + open data inspector for source node
   * when that source already produced execution data on the current run.
   */
  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge | WorkflowEdge) => {
      setSelectedEdge(edge as WorkflowEdge);
      setSelectedNode(null);
      setSelectedNodes([]);

      const sourceId = (edge as Edge).source;
      if (sourceId) {
        const executionResults = useWorkflowStore.getState().executionResults;
        if (executionResults && executionResults[sourceId] !== undefined) {
          window.dispatchEvent(
            new CustomEvent('open-run-data-inspector', { detail: { nodeId: sourceId } })
          );
        }
      }
    },
    [setSelectedEdge, setSelectedNode, setSelectedNodes]
  );

  /**
   * Handle pane click - deselect all
   */
  const handlePaneClick = useCallback(
    (_event: React.MouseEvent) => {
      setSelectedEdge(null);
      setSelectedNode(null);
      setSelectedNodes([]);
      setContextMenu(null);
    },
    [setSelectedEdge, setSelectedNode, setSelectedNodes, setContextMenu]
  );

  /**
   * Handle pane double-click - open quick search at position.
   * v12: screenToFlowPosition handles wrapper offset internally.
   */
  const handlePaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const position = project({ x: event.clientX, y: event.clientY });
      setQuickSearchPosition({ x: position.x, y: position.y });
      openPanel('nodeSearch');
    },
    [project, setQuickSearchPosition, openPanel]
  );

  return {
    handleNodeClick,
    handleEdgeClick,
    handlePaneClick,
    handlePaneDoubleClick,
  };
}

export default useClickHandlers;
