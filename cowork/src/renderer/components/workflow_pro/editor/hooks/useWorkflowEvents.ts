// @ts-nocheck
/**
 * useWorkflowEvents Hook
 *
 * Handles all event-related logic for the workflow editor:
 * - Node click, edge click, pane click
 * - Drag and drop
 * - Context menu (right-click)
 * - Connection start/end (proximity connect)
 * - Keyboard shortcuts
 * - Custom event listeners
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Node, Edge, MarkerType, useReactFlow } from '@xyflow/react';
import type { OnConnectStart, OnConnectEnd } from '@xyflow/react';
import { gridConfig } from '../config/editorConfig';
import { WorkflowNode, WorkflowEdge, NodeData } from '../../type-mocks';
import { useWorkflowStore } from '../../store';
import { nodeTypes } from '../../data-mocks';
import { notificationService } from '../../service-mocks';
import { logger } from '../../service-mocks';

export interface ContextMenuState {
  nodeId: string;
  x: number;
  y: number;
}

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

  // State setters
  setConfigPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  setQuickSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setQuickSearchPosition: React.Dispatch<React.SetStateAction<{ x: number; y: number } | undefined>>;
  setFocusPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setFocusPanelNode: React.Dispatch<React.SetStateAction<WorkflowNode | null>>;
  setN8nNodePanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCommandBarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShortcutsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTemplatesGalleryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPerformanceMonitorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowMiniMap: React.Dispatch<React.SetStateAction<boolean>>;
  setShowGrid: React.Dispatch<React.SetStateAction<boolean>>;
  setSnapToGrid: React.Dispatch<React.SetStateAction<boolean>>;
  setDataPinningPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setExecutionHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setNodeSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setVariablesPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCustomNodeCreatorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDocGeneratorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCollaborationOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setStepDebugPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setZoomLevel: React.Dispatch<React.SetStateAction<number>>;

  // State values
  useN8nStyle: boolean;
  snapToGrid: boolean;
  showMiniMap: boolean;

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

  // Connection handlers (@xyflow/react v12 types)
  onConnectStart: OnConnectStart;
  onConnectEnd: OnConnectEnd;

  // Drag and drop
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  dropPreview: { x: number; y: number } | null;

  // Move handler (for zoom tracking)
  onMove: (event: unknown, viewport: { zoom: number; x: number; y: number }) => void;
}

/**
 * Custom hook for workflow event handling
 * Extracts all event handlers from ModernWorkflowEditor
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
    setConfigPanelOpen,
    setContextMenu,
    setQuickSearchOpen,
    setQuickSearchPosition,
    setFocusPanelOpen,
    setFocusPanelNode,
    setN8nNodePanelOpen,
    setCommandBarOpen,
    setShortcutsModalOpen,
    setTemplatesGalleryOpen,
    setPerformanceMonitorOpen,
    setSidebarOpen,
    setShowMiniMap,
    setSnapToGrid,
    setDataPinningPanelOpen,
    setExecutionHistoryOpen,
    setNodeSearchOpen,
    setVariablesPanelOpen,
    setCustomNodeCreatorOpen,
    setDocGeneratorOpen,
    setCollaborationOpen,
    setStepDebugPanelOpen,
    setZoomLevel,
    useN8nStyle,
    snapToGrid,
    executeWorkflow,
    performAutoLayout,
    createNodeData,
    deleteSelectedNodes,
    duplicateSelectedNodes,
  } = options;

  const { setCenter: rfSetCenter, getViewport: rfGetViewport } = useReactFlow();
  const [dropPreview, setDropPreview] = useState<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number>(0);

  // Get store actions
  const setNodes = useWorkflowStore((state) => state.setNodes);
  const setEdges = useWorkflowStore((state) => state.setEdges);
  const setSelectedNode = useWorkflowStore((state) => state.setSelectedNode);
  const setSelectedNodes = useWorkflowStore((state) => state.setSelectedNodes);
  const setSelectedEdge = useWorkflowStore((state) => state.setSelectedEdge);
  const addToHistory = useWorkflowStore((state) => state.addToHistory);
  const saveWorkflow = useWorkflowStore((state) => state.saveWorkflow);

  // Node click handler
  const handleNodeClick = useCallback((event: React.MouseEvent, node: Node | WorkflowNode) => {
    if (event.ctrlKey || event.metaKey) {
      // Get fresh selectedNodes from store
      const currentSelectedNodes = useWorkflowStore.getState().selectedNodes;
      const isSelected = currentSelectedNodes.includes(node.id);

      // Multi-selection
      if (isSelected) {
        setSelectedNodes(currentSelectedNodes.filter(id => id !== node.id));
      } else {
        setSelectedNodes([...currentSelectedNodes, node.id]);
      }
    } else {
      // Single selection
      setSelectedNode(node as WorkflowNode);
      setSelectedNodes([]);

      // Use Focus Panel in n8n mode, Config Panel otherwise
      if (useN8nStyle) {
        setFocusPanelNode(node as WorkflowNode);
        setFocusPanelOpen(true);
      } else {
        setConfigPanelOpen(true);
      }
    }
  }, [setSelectedNodes, setSelectedNode, useN8nStyle, setFocusPanelNode, setFocusPanelOpen, setConfigPanelOpen]);

  // Edge click handler
  const handleEdgeClick = useCallback((event: React.MouseEvent, edge: Edge | WorkflowEdge) => {
    setSelectedEdge(edge as WorkflowEdge);
    setSelectedNode(null);
    setSelectedNodes([]);
  }, [setSelectedEdge, setSelectedNode, setSelectedNodes]);

  // Pane click handler (deselect)
  const handlePaneClick = useCallback((_event: React.MouseEvent) => {
    setSelectedEdge(null);
    setSelectedNode(null);
    setSelectedNodes([]);
    setContextMenu(null);
  }, [setSelectedEdge, setSelectedNode, setSelectedNodes, setContextMenu]);

  // Pane double click handler (open quick search).
  // v12: screenToFlowPosition handles wrapper offset internally.
  const handlePaneDoubleClick = useCallback((event: React.MouseEvent) => {
    const position = project({ x: event.clientX, y: event.clientY });
    setQuickSearchPosition({ x: position.x, y: position.y });
    setQuickSearchOpen(true);
  }, [project, setQuickSearchPosition, setQuickSearchOpen]);

  // Context menu handler (right-click)
  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setContextMenu({
      nodeId: node.id,
      x: event.clientX,
      y: event.clientY,
    });
  }, [setContextMenu]);

  // Connection start - track where connection starts (v12 OnConnectStart)
  const onConnectStart = useCallback<OnConnectStart>(
    (_event, { nodeId, handleId }) => {
      if (nodeId) {
        pendingConnectionRef.current = { nodeId, handleId };
      }
    },
    [pendingConnectionRef]
  );

  // Connection end - proximity connect using v12 structured connectionState
  // (avoids fragile DOM className inspection on `react-flow__pane`).
  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      const droppedOnEmpty = !connectionState.isValid && !connectionState.toNode;

      if (droppedOnEmpty && pendingConnectionRef.current) {
        const clientX = 'clientX' in event ? event.clientX : event.changedTouches[0].clientX;
        const clientY = 'clientY' in event ? event.clientY : event.changedTouches[0].clientY;

        // v12: screenToFlowPosition handles wrapper offset internally
        const position = project({ x: clientX, y: clientY });

        setQuickSearchPosition({ x: position.x, y: position.y });
        setQuickSearchOpen(true);

        try {
          localStorage.setItem('pendingConnection', JSON.stringify(pendingConnectionRef.current));
        } catch { /* localStorage may be disabled */ }

        notificationService.info('Quick Connect', 'Select a node to connect');
      }

      pendingConnectionRef.current = null;
    },
    [project, pendingConnectionRef, setQuickSearchPosition, setQuickSearchOpen]
  );

  // Drag over handler — v12 screenToFlowPosition handles wrapper offset.
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const pos = project({ x: event.clientX, y: event.clientY });
      if (snapToGrid) {
        pos.x = Math.round(pos.x / gridConfig.size) * gridConfig.size;
        pos.y = Math.round(pos.y / gridConfig.size) * gridConfig.size;
      }
      setDropPreview(pos);
    });
  }, [project, snapToGrid]);

  const onDragLeave = useCallback((_event: React.DragEvent) => {
    cancelAnimationFrame(rafRef.current);
    setDropPreview(null);
  }, []);

  // Drop handler
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDropPreview(null);

      // Prevent modifications when workflow is locked
      const isLocked = useWorkflowStore.getState().isCurrentWorkflowLocked;
      if (isLocked) {
        notificationService.warning('Workflow Locked', 'This workflow is locked. Unlock to add nodes.');
        return;
      }

      const type = event.dataTransfer.getData('text/plain');
      logger.info('Drop event - type:', type);
      logger.info('All dataTransfer types:', event.dataTransfer.types);

      if (typeof type === 'undefined' || !type) {
        logger.info('No type found in dataTransfer');
        return;
      }

      // v12: screenToFlowPosition handles wrapper offset internally
      const position = project({ x: event.clientX, y: event.clientY });

      logger.info('Drop position:', position);

      // Snap to grid if enabled
      if (snapToGrid) {
        position.x = Math.round(position.x / gridConfig.size) * gridConfig.size;
        position.y = Math.round(position.y / gridConfig.size) * gridConfig.size;
      }

      const nodeConfig = nodeTypes[type];
      if (!nodeConfig) {
        logger.error(`Node type ${type} not found in nodeTypes`);
        return;
      }

      const newNodeId = getId();
      const newNode: WorkflowNode = {
        id: newNodeId,
        type: 'custom',
        position,
        data: createNodeData(newNodeId, type, position),
      };

      // Get fresh state from store
      const currentNodes = useWorkflowStore.getState().nodes;
      const currentEdges = useWorkflowStore.getState().edges;

      // Check if dropping on an edge - insert node in the middle
      const dropRadius = 30; // Pixels tolerance for edge drop detection
      let edgeToSplit: WorkflowEdge | null = null;

      for (const edge of currentEdges) {
        const sourceNode = currentNodes.find(n => n.id === edge.source);
        const targetNode = currentNodes.find(n => n.id === edge.target);

        if (sourceNode && targetNode) {
          // Calculate if drop position is near the edge line
          const sx = sourceNode.position.x + 100; // Approximate node center
          const sy = sourceNode.position.y + 40;
          const tx = targetNode.position.x + 100;
          const ty = targetNode.position.y + 40;

          // Distance from point to line segment
          const lineLengthSquared = (tx - sx) ** 2 + (ty - sy) ** 2;
          if (lineLengthSquared > 0) {
            const t = Math.max(0, Math.min(1,
              ((position.x - sx) * (tx - sx) + (position.y - sy) * (ty - sy)) / lineLengthSquared
            ));
            const projX = sx + t * (tx - sx);
            const projY = sy + t * (ty - sy);
            const distance = Math.sqrt((position.x - projX) ** 2 + (position.y - projY) ** 2);

            // Check if we're in the middle section of the edge (not near endpoints)
            if (distance < dropRadius && t > 0.2 && t < 0.8) {
              edgeToSplit = edge;
              break;
            }
          }
        }
      }

      let updatedEdges = currentEdges;

      if (edgeToSplit) {
        // Insert node in the middle of the edge
        const newEdge1 = {
          id: `edge_${Date.now()}_1`,
          source: edgeToSplit.source,
          target: newNodeId,
          sourceHandle: edgeToSplit.sourceHandle,
          animated: true,
          style: { stroke: '#22c55e', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e', width: 16, height: 16 },
        };
        const newEdge2 = {
          id: `edge_${Date.now()}_2`,
          source: newNodeId,
          target: edgeToSplit.target,
          targetHandle: edgeToSplit.targetHandle,
          animated: true,
          style: { stroke: '#22c55e', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e', width: 16, height: 16 },
        };

        // Remove old edge, add two new edges
        updatedEdges = [
          ...currentEdges.filter(e => e.id !== edgeToSplit!.id),
          newEdge1,
          newEdge2,
        ];

        notificationService.success(
          `Node inserted into connection`,
          'Edge Split'
        );
      }

      setNodes([...currentNodes, newNode]);
      setEdges(updatedEdges);
      addToHistory(currentNodes, currentEdges);

      // Center viewport on new node if not fully visible
      const wrapperBounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (wrapperBounds) {
        const viewport = rfGetViewport();
        const nodeW = 250, nodeH = 100;
        const visibleLeft = -viewport.x / viewport.zoom;
        const visibleTop = -viewport.y / viewport.zoom;
        const visibleRight = visibleLeft + wrapperBounds.width / viewport.zoom;
        const visibleBottom = visibleTop + wrapperBounds.height / viewport.zoom;

        const isFullyVisible =
          position.x >= visibleLeft &&
          position.x + nodeW <= visibleRight &&
          position.y >= visibleTop &&
          position.y + nodeH <= visibleBottom;

        if (!isFullyVisible) {
          requestAnimationFrame(() => {
            rfSetCenter(position.x + nodeW / 2, position.y + nodeH / 2, { duration: 400 });
          });
        }
      }

      const addLog = useWorkflowStore.getState().addLog;
      addLog({
        level: 'info',
        message: `Node added: ${nodeConfig.label}`,
        data: { nodeId: newNode.id, type, position }
      });
    },
    [project, setNodes, setEdges, addToHistory, snapToGrid, getId, reactFlowWrapper, createNodeData, rfSetCenter, rfGetViewport]
  );

  // Move handler (for zoom tracking)
  const onMove = useCallback((event: unknown, viewport: { zoom: number; x: number; y: number }) => {
    setZoomLevel(viewport.zoom);
  }, [setZoomLevel]);

  // Keyboard shortcuts effect
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 's':
            e.preventDefault();
            saveWorkflow();
            break;
          case 'd':
            e.preventDefault();
            duplicateSelectedNodes();
            break;
          case 'f':
            e.preventDefault();
            fitView();
            break;
          case '+':
          case '=':
            e.preventDefault();
            zoomIn();
            break;
          case '-':
            e.preventDefault();
            zoomOut();
            break;
          case '0':
            e.preventDefault();
            zoomTo(1);
            break;
          case 'l':
            e.preventDefault();
            performAutoLayout();
            break;
          case 'k':
            e.preventDefault();
            setCommandBarOpen(true);
            break;
          case 'e':
            e.preventDefault();
            executeWorkflow();
            break;
          case 'n':
            e.preventDefault();
            setQuickSearchOpen(true);
            break;
          case 'g':
            e.preventDefault();
            setSnapToGrid(prev => {
              notificationService.info(
                'Grid',
                !prev ? 'Snap to grid enabled' : 'Snap to grid disabled'
              );
              return !prev;
            });
            break;
          case 'm':
            e.preventDefault();
            setShowMiniMap(prev => !prev);
            break;
          case 'a': {
            e.preventDefault();
            const allNodeIds = useWorkflowStore.getState().nodes.map(n => n.id);
            setSelectedNodes(allNodeIds);
            notificationService.info('Selection', `${allNodeIds.length} nodes selected`);
            break;
            }
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Prevent modifications when workflow is locked
        const isLocked = useWorkflowStore.getState().isCurrentWorkflowLocked;
        if (isLocked) {
          notificationService.warning('Workflow Locked', 'This workflow is locked. Unlock to delete nodes.');
          return;
        }

        deleteSelectedNodes();
      }

      if (e.key === 'Escape') {
        setSelectedNode(null);
        setSelectedNodes([]);
        setSelectedEdge(null);
        setConfigPanelOpen(false);
        setQuickSearchOpen(false);
      }

      // Tab key opens N8N-style Node Panel (or Quick Search if n8n style disabled)
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        // Only open if not in an input field
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
          e.preventDefault();
          if (useN8nStyle) {
            setN8nNodePanelOpen(true);
          } else {
            setQuickSearchOpen(true);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    saveWorkflow, duplicateSelectedNodes, fitView, zoomIn, zoomOut, zoomTo,
    performAutoLayout, executeWorkflow, deleteSelectedNodes, useN8nStyle,
    setSelectedNode, setSelectedNodes, setSelectedEdge, setConfigPanelOpen,
    setQuickSearchOpen, setN8nNodePanelOpen, setCommandBarOpen, setSnapToGrid, setShowMiniMap
  ]);

  // Event listeners for keyboard shortcuts custom events
  useEffect(() => {
    const handleToggleMinimap = () => setShowMiniMap(prev => !prev);
    const handleToggleSidebar = () => setSidebarOpen(prev => !prev);
    const handleToggleProperties = () => setConfigPanelOpen(prev => !prev);
    const handleShowShortcuts = () => setShortcutsModalOpen(true);
    const handleShowTemplatesGallery = () => setTemplatesGalleryOpen(true);
    const handleTogglePerformanceMonitor = () => setPerformanceMonitorOpen(prev => !prev);
    const handleOpenQuickSearch = () => setQuickSearchOpen(true);
    const handleExecuteWorkflow = () => executeWorkflow();
    const handleToggleSnapToGrid = () => {
      setSnapToGrid(prev => {
        const newValue = !prev;
        notificationService.info('Grid', newValue ? 'Snap to grid enabled' : 'Snap to grid disabled');
        return newValue;
      });
    };

    // New panel toggles
    const handleToggleDataPinning = () => setDataPinningPanelOpen(prev => !prev);
    const handleToggleExecutionHistory = () => setExecutionHistoryOpen(prev => !prev);
    const handleToggleNodeSearch = () => setNodeSearchOpen(prev => !prev);
    const handleToggleVariables = () => setVariablesPanelOpen(prev => !prev);
    const handleToggleCustomNodes = () => setCustomNodeCreatorOpen(prev => !prev);
    const handleToggleDocGenerator = () => setDocGeneratorOpen(prev => !prev);
    const handleToggleCollaboration = () => setCollaborationOpen(prev => !prev);
    const handleToggleStepDebug = () => setStepDebugPanelOpen(prev => !prev);

    window.addEventListener('toggle-minimap', handleToggleMinimap);
    window.addEventListener('toggle-sidebar', handleToggleSidebar);
    window.addEventListener('toggle-properties', handleToggleProperties);
    window.addEventListener('show-shortcuts-modal', handleShowShortcuts);
    window.addEventListener('show-templates-gallery', handleShowTemplatesGallery);
    window.addEventListener('toggle-performance-monitor', handleTogglePerformanceMonitor);
    window.addEventListener('open-quick-search', handleOpenQuickSearch);
    window.addEventListener('execute-workflow', handleExecuteWorkflow);
    window.addEventListener('toggle-snap-to-grid', handleToggleSnapToGrid);
    window.addEventListener('toggle-data-pinning', handleToggleDataPinning);
    window.addEventListener('toggle-execution-history', handleToggleExecutionHistory);
    window.addEventListener('toggle-node-search', handleToggleNodeSearch);
    window.addEventListener('toggle-variables', handleToggleVariables);
    window.addEventListener('toggle-custom-nodes', handleToggleCustomNodes);
    window.addEventListener('toggle-doc-generator', handleToggleDocGenerator);
    window.addEventListener('toggle-collaboration', handleToggleCollaboration);
    window.addEventListener('toggle-step-debug', handleToggleStepDebug);

    return () => {
      window.removeEventListener('toggle-minimap', handleToggleMinimap);
      window.removeEventListener('toggle-sidebar', handleToggleSidebar);
      window.removeEventListener('toggle-properties', handleToggleProperties);
      window.removeEventListener('show-shortcuts-modal', handleShowShortcuts);
      window.removeEventListener('show-templates-gallery', handleShowTemplatesGallery);
      window.removeEventListener('toggle-performance-monitor', handleTogglePerformanceMonitor);
      window.removeEventListener('open-quick-search', handleOpenQuickSearch);
      window.removeEventListener('execute-workflow', handleExecuteWorkflow);
      window.removeEventListener('toggle-snap-to-grid', handleToggleSnapToGrid);
      window.removeEventListener('toggle-data-pinning', handleToggleDataPinning);
      window.removeEventListener('toggle-execution-history', handleToggleExecutionHistory);
      window.removeEventListener('toggle-node-search', handleToggleNodeSearch);
      window.removeEventListener('toggle-variables', handleToggleVariables);
      window.removeEventListener('toggle-custom-nodes', handleToggleCustomNodes);
      window.removeEventListener('toggle-doc-generator', handleToggleDocGenerator);
      window.removeEventListener('toggle-collaboration', handleToggleCollaboration);
      window.removeEventListener('toggle-step-debug', handleToggleStepDebug);
    };
  }, [
    executeWorkflow, setShowMiniMap, setSidebarOpen, setConfigPanelOpen,
    setShortcutsModalOpen, setTemplatesGalleryOpen, setPerformanceMonitorOpen,
    setQuickSearchOpen, setSnapToGrid, setDataPinningPanelOpen, setExecutionHistoryOpen,
    setNodeSearchOpen, setVariablesPanelOpen, setCustomNodeCreatorOpen, setDocGeneratorOpen,
    setCollaborationOpen, setStepDebugPanelOpen
  ]);

  // Copy/Paste/Cut event listeners
  useEffect(() => {
    const handleCopy = () => {
      // Trigger copy operation through custom event
      window.dispatchEvent(new CustomEvent('workflow-copy'));
    };
    const handlePaste = () => {
      // Trigger paste operation through custom event
      window.dispatchEvent(new CustomEvent('workflow-paste'));
    };
    const handleCut = () => {
      // Trigger cut operation through custom event
      window.dispatchEvent(new CustomEvent('workflow-cut'));
    };

    window.addEventListener('copy-nodes', handleCopy);
    window.addEventListener('paste-nodes', handlePaste);
    window.addEventListener('cut-nodes', handleCut);

    return () => {
      window.removeEventListener('copy-nodes', handleCopy);
      window.removeEventListener('paste-nodes', handlePaste);
      window.removeEventListener('cut-nodes', handleCut);
    };
  }, []);

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
