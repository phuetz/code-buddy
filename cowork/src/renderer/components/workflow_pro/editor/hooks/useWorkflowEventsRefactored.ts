// @ts-nocheck
/**
 * useWorkflowEvents Hook (Refactored)
 *
 * Orchestrates all event-related logic for the workflow editor.
 * This is a simplified version that composes smaller, focused hooks.
 *
 * Event Categories:
 * - Click handlers (node, edge, pane)
 * - Connection handlers (proximity connect)
 * - Drag and drop (node palette)
 * - Context menu (right-click)
 * - Keyboard shortcuts
 * - Window events (custom events)
 */

import { useCallback } from 'react';
import { Node, Edge } from '@xyflow/react';
import { WorkflowNode, WorkflowEdge, NodeData } from '../../type-mocks';

// Import modular event hooks
import {
  useClickHandlers,
  useConnectionHandlers,
  useDragDrop,
  useContextMenu,
  useKeyboardShortcuts,
  useWindowEvents,
} from './events';

// ============================================================================
// Types
// ============================================================================

export interface UseWorkflowEventsOptions {
  // Refs
  reactFlowWrapper: React.RefObject<HTMLDivElement>;
  pendingConnectionRef: React.MutableRefObject<{ nodeId: string; handleId: string | null } | null>;

  // ReactFlow functions
  project: (position: { x: number; y: number }) => { x: number; y: number };
  fitView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomTo: (zoom: number) => void;

  // ID generation
  getId: () => string;

  // State setters (only the ones still needed)
  setSnapToGrid: React.Dispatch<React.SetStateAction<boolean>>;
  setShowMiniMap: React.Dispatch<React.SetStateAction<boolean>>;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setZoomLevel: React.Dispatch<React.SetStateAction<number>>;

  // State values
  useN8nStyle: boolean;
  snapToGrid: boolean;

  // Actions
  executeWorkflow: () => Promise<void>;
  performAutoLayout: () => void;
  createNodeData: (id: string, nodeType: string, position: { x: number; y: number }) => NodeData;
  deleteSelectedNodes: () => void;
  duplicateSelectedNodes: () => void;
}

export interface UseWorkflowEventsReturn {
  // Click handlers
  handleNodeClick: (event: React.MouseEvent, node: Node | WorkflowNode) => void;
  handleEdgeClick: (event: React.MouseEvent, edge: Edge | WorkflowEdge) => void;
  handlePaneClick: (event: React.MouseEvent) => void;
  handlePaneDoubleClick: (event: React.MouseEvent) => void;

  // Context menu
  handleNodeContextMenu: (event: React.MouseEvent, node: Node) => void;

  // Connection handlers
  onConnectStart: (
    event: React.MouseEvent | React.TouchEvent,
    params: { nodeId: string | null; handleId: string | null }
  ) => void;
  onConnectEnd: (event: MouseEvent | TouchEvent) => void;

  // Drag and drop
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  dropPreview: { x: number; y: number } | null;

  // Move handler (for zoom tracking)
  onMove: (event: unknown, viewport: { zoom: number; x: number; y: number }) => void;
}

// ============================================================================
// Main Hook
// ============================================================================

/**
 * Custom hook for workflow event handling
 *
 * This refactored version composes smaller, focused hooks:
 * - useClickHandlers: Node, edge, and pane click handling
 * - useConnectionHandlers: Proximity connect feature
 * - useDragDrop: Node palette drag and drop
 * - useContextMenu: Right-click menu
 * - useKeyboardShortcuts: Global shortcuts
 * - useWindowEvents: Custom event listeners
 */
export function useWorkflowEvents(options: UseWorkflowEventsOptions): UseWorkflowEventsReturn {
  const {
    reactFlowWrapper,
    pendingConnectionRef,
    project,
    fitView,
    zoomIn,
    zoomOut,
    zoomTo,
    getId,
    setSnapToGrid,
    setShowMiniMap,
    setSidebarOpen,
    setZoomLevel,
    useN8nStyle,
    snapToGrid,
    executeWorkflow,
    performAutoLayout,
    createNodeData,
    deleteSelectedNodes,
    duplicateSelectedNodes,
  } = options;

  // 1. Click handlers
  const { handleNodeClick, handleEdgeClick, handlePaneClick, handlePaneDoubleClick } = useClickHandlers({
    reactFlowWrapper,
    project,
    useN8nStyle,
  });

  // 2. Connection handlers
  const { onConnectStart, onConnectEnd } = useConnectionHandlers({
    pendingConnectionRef,
    reactFlowWrapper,
    project,
  });

  // 3. Drag and drop
  const { onDragOver, onDrop, onDragLeave, dropPreview } = useDragDrop({
    reactFlowWrapper,
    project,
    getId,
    snapToGrid,
    createNodeData,
  });

  // 4. Context menu
  const { handleNodeContextMenu } = useContextMenu();

  // 5. Keyboard shortcuts (no return - sets up listeners)
  useKeyboardShortcuts({
    fitView,
    zoomIn,
    zoomOut,
    zoomTo,
    executeWorkflow,
    performAutoLayout,
    deleteSelectedNodes,
    duplicateSelectedNodes,
    useN8nStyle,
    snapToGrid,
    setSnapToGrid,
    setShowMiniMap,
  });

  // 6. Window events (no return - sets up listeners)
  useWindowEvents({
    executeWorkflow,
    setSnapToGrid,
    setShowMiniMap,
    setSidebarOpen,
  });

  // 7. Move handler for zoom tracking
  const onMove = useCallback(
    (_event: unknown, viewport: { zoom: number; x: number; y: number }) => {
      setZoomLevel(viewport.zoom);
    },
    [setZoomLevel]
  );

  return {
    handleNodeClick,
    handleEdgeClick,
    handlePaneClick,
    handlePaneDoubleClick,
    handleNodeContextMenu,
    onConnectStart,
    onConnectEnd,
    onDragOver,
    onDrop,
    onDragLeave,
    dropPreview,
    onMove,
  };
}

export default useWorkflowEvents;
