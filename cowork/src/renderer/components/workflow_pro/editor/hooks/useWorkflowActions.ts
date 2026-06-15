// @ts-nocheck
/**
 * useWorkflowActions Hook
 *
 * Provides actions for manipulating workflow nodes and edges:
 * - Node operations: add, delete, duplicate, copy, paste, cut
 * - Edge operations: connect, disconnect, update
 * - Bulk operations: align, distribute, delete multiple
 * - Helper functions: createNodeData
 */

import { useCallback } from 'react';
import {
  Node,
  Edge,
  Connection,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  NodeChange,
  EdgeChange,
  MarkerType,
  useReactFlow,
} from '@xyflow/react';
import { WorkflowNode, WorkflowEdge, NodeData } from '../../type-mocks';
import { useWorkflowStore } from '../../store';
import { nodeTypes } from '../../data-mocks';
import { notificationService } from '../../service-mocks';
import { validateConnection, getConnectionStyle } from '../../data-mocks';
import { logger } from '../../service-mocks';
import { gridConfig } from '../config/editorConfig';

export interface ClipboardData {
  nodes: Node[];
  edges: Edge[];
}

export interface UseWorkflowActionsOptions {
  getId: () => string;
  snapToGrid: boolean;
  clipboard: ClipboardData | null;
  setClipboard: React.Dispatch<React.SetStateAction<ClipboardData | null>>;
}

export interface UseWorkflowActionsReturn {
  // Node data creation
  createNodeData: (id: string, nodeType: string, position: { x: number; y: number }) => NodeData;

  // Node/Edge change handlers
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (params: Connection) => void;
  isValidConnection: (connection: Connection) => boolean;

  // Bulk operations
  handleBulkDelete: () => void;
  handleBulkDuplicate: () => void;
  handleBulkAlign: (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  handleBulkDistribute: (direction: 'horizontal' | 'vertical') => void;
  handleBulkToggleEnabled: (enabled: boolean) => void;

  // Copy/Paste/Cut operations
  handleCopyNodes: () => void;
  handlePasteNodes: () => void;
  handleCutNodes: () => void;

  // Node manipulation
  addNode: (nodeType: string, position: { x: number; y: number }) => WorkflowNode;
  deleteNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => WorkflowNode | null;
  deleteSelectedNodes: () => void;
  duplicateSelectedNodes: () => void;
}

/**
 * Custom hook for workflow node and edge actions
 * Extracts all action logic from ModernWorkflowEditor
 */
export function useWorkflowActions(options: UseWorkflowActionsOptions): UseWorkflowActionsReturn {
  const { getId, snapToGrid, clipboard, setClipboard } = options;

  const { fitView } = useReactFlow();

  // Get store actions
  const setNodes = useWorkflowStore((state) => state.setNodes);
  const setEdges = useWorkflowStore((state) => state.setEdges);
  const setSelectedNode = useWorkflowStore((state) => state.setSelectedNode);
  const setSelectedNodes = useWorkflowStore((state) => state.setSelectedNodes);
  const addToHistory = useWorkflowStore((state) => state.addToHistory);

  // Helper to create NodeData from nodeType
  const createNodeData = useCallback((id: string, nodeType: string, position: { x: number; y: number }): NodeData => {
    const nodeConfig = nodeTypes[nodeType];
    return {
      id,
      type: nodeType,
      label: nodeConfig?.label || nodeType,
      position,
      icon: nodeConfig?.icon || '?',
      color: nodeConfig?.color || '#6b7280',
      inputs: nodeConfig?.inputs || 1,
      outputs: nodeConfig?.outputs || 1,
      config: {}
    };
  }, []);

  // Handle node changes
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Prevent modifications when workflow is locked
      const isLocked = useWorkflowStore.getState().isCurrentWorkflowLocked;
      if (isLocked) {
        // Only allow selection changes when locked
        const selectionChanges = changes.filter(c => c.type === 'select');
        if (selectionChanges.length === 0) {
          notificationService.warning('Workflow Locked', 'This workflow is locked. Unlock to make changes.');
          return;
        }
        changes = selectionChanges;
      }

      // Get fresh state from store to avoid infinite loops
      const currentNodes = useWorkflowStore.getState().nodes;
      const currentEdges = useWorkflowStore.getState().edges;

      const hasSignificantChange = changes.some(change =>
        change.type === 'add' || change.type === 'remove'
      );

      if (hasSignificantChange) {
        addToHistory(currentNodes, currentEdges);
      }

      setNodes(applyNodeChanges(changes, currentNodes) as WorkflowNode[]);
    },
    [setNodes, addToHistory]
  );

  // Handle edge changes
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      // Prevent modifications when workflow is locked
      const isLocked = useWorkflowStore.getState().isCurrentWorkflowLocked;
      if (isLocked) {
        // Only allow selection changes when locked
        const selectionChanges = changes.filter(c => c.type === 'select');
        if (selectionChanges.length === 0) {
          notificationService.warning('Workflow Locked', 'This workflow is locked. Unlock to make changes.');
          return;
        }
        changes = selectionChanges;
      }

      // Get fresh state from store
      const currentNodes = useWorkflowStore.getState().nodes;
      const currentEdges = useWorkflowStore.getState().edges;

      const hasSignificantChange = changes.some(change =>
        change.type === 'add' || change.type === 'remove'
      );

      if (hasSignificantChange) {
        addToHistory(currentNodes, currentEdges);
      }

      setEdges(applyEdgeChanges(changes, currentEdges as Edge[]) as WorkflowEdge[]);
    },
    [setEdges, addToHistory]
  );

  // Handle connection with validation
  const onConnect = useCallback(
    (params: Connection) => {
      // Prevent modifications when workflow is locked
      const isLocked = useWorkflowStore.getState().isCurrentWorkflowLocked;
      if (isLocked) {
        notificationService.warning('Workflow Locked', 'This workflow is locked. Unlock to add connections.');
        return;
      }

      // Get fresh state from store
      const currentNodes = useWorkflowStore.getState().nodes;
      const currentEdges = useWorkflowStore.getState().edges;

      // Validate connection before adding
      const validationResult = validateConnection(currentNodes, currentEdges as Edge[], params);

      if (!validationResult.isValid) {
        notificationService.error(
          'Connection Rejected',
          validationResult.error || 'Invalid connection'
        );
        logger.warn('Connection rejected:', validationResult.error);
        return;
      }

      // Show warning if present
      if (validationResult.warning) {
        notificationService.warning('Connection Warning', validationResult.warning);
      }

      addToHistory(currentNodes, currentEdges);

      // Get connection style based on validation
      const connectionStyleResult = getConnectionStyle(validationResult.isValid);

      const newEdge = addEdge({
        ...params,
        id: `edge_${Date.now()}`,
        animated: true,
        style: {
          ...connectionStyleResult,
          transition: 'all 0.3s ease'
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: connectionStyleResult.stroke as string || '#94a3b8',
          width: 16,
          height: 16,
        },
      }, currentEdges as Edge[]);

      setEdges(newEdge as WorkflowEdge[]);

      // Animation feedback. v12 renders edges with `data-id`/`data-testid="rf__edge-{id}"`
      // — the previous selector `[data-edge-id="…"]` matched nothing and the
      // pulse animation never ran. Use data-testid for a stable selector.
      setTimeout(() => {
        if (newEdge.length > 0) {
          const lastEdge = newEdge[newEdge.length - 1];
          const edgeElement = document.querySelector(`[data-testid="rf__edge-${lastEdge.id}"]`);
          if (edgeElement) {
            edgeElement.classList.add('animate-pulse');
            setTimeout(() => {
              edgeElement.classList.remove('animate-pulse');
            }, 1000);
          }
        }
      }, 100);
    },
    [setEdges, addToHistory]
  );

  // Real-time connection validation
  const isValidConnection = useCallback(
    (connection: Connection) => {
      const currentNodes = useWorkflowStore.getState().nodes;
      const currentEdges = useWorkflowStore.getState().edges;
      const result = validateConnection(currentNodes, currentEdges as Edge[], connection);
      return result.isValid;
    },
    []
  );

  // Bulk delete
  const handleBulkDelete = useCallback(() => {
    const currentNodes = useWorkflowStore.getState().nodes;
    const currentEdges = useWorkflowStore.getState().edges;
    const currentSelectedNodes = useWorkflowStore.getState().selectedNodes;
    addToHistory(currentNodes, currentEdges);

    const nodeIdsToDelete = new Set(currentSelectedNodes);
    setNodes(currentNodes.filter(n => !nodeIdsToDelete.has(n.id)));
    setEdges(currentEdges.filter(e => !nodeIdsToDelete.has(e.source) && !nodeIdsToDelete.has(e.target)));
    setSelectedNodes([]);
    notificationService.success('Delete', `${currentSelectedNodes.length} nodes deleted`);
  }, [addToHistory, setNodes, setEdges, setSelectedNodes]);

  // Bulk duplicate
  const handleBulkDuplicate = useCallback(() => {
    const currentNodes = useWorkflowStore.getState().nodes;
    const currentEdges = useWorkflowStore.getState().edges;
    const currentSelectedNodes = useWorkflowStore.getState().selectedNodes;
    addToHistory(currentNodes, currentEdges);

    const nodesToDuplicate = currentNodes.filter(n => currentSelectedNodes.includes(n.id));
    const newNodes = nodesToDuplicate.map((node: any, index: any) => ({
      ...node,
      id: `${node.id}-copy-${Date.now()}-${index}`,
      position: {
        x: node.position.x + 50,
        y: node.position.y + 50,
      },
    }));

    setNodes([...currentNodes, ...newNodes]);
    setTimeout(() => {
      fitView({ nodes: newNodes as WorkflowNode[], padding: 0.5, duration: 300 });
    }, 50);
    notificationService.success('Duplicate', `${newNodes.length} nodes duplicated`);
  }, [addToHistory, setNodes, fitView]);

  // Bulk align
  const handleBulkAlign = useCallback((alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    const currentNodes = useWorkflowStore.getState().nodes;
    const currentSelectedNodes = useWorkflowStore.getState().selectedNodes;

    if (currentSelectedNodes.length < 2) return;

    const selectedIds = new Set(currentSelectedNodes);
    const selectedNodesArray = currentNodes.filter(n => selectedIds.has(n.id));
    const positions = selectedNodesArray.map(n => n.position);

    let alignValue: number;
    switch (alignment) {
      case 'left':
        alignValue = Math.min(...positions.map(p => p.x));
        break;
      case 'right':
        alignValue = Math.max(...positions.map(p => p.x));
        break;
      case 'center':
        alignValue = (Math.min(...positions.map(p => p.x)) + Math.max(...positions.map(p => p.x))) / 2;
        break;
      case 'top':
        alignValue = Math.min(...positions.map(p => p.y));
        break;
      case 'bottom':
        alignValue = Math.max(...positions.map(p => p.y));
        break;
      case 'middle':
        alignValue = (Math.min(...positions.map(p => p.y)) + Math.max(...positions.map(p => p.y))) / 2;
        break;
    }

    const updatedNodes = currentNodes.map(node => {
      if (!selectedIds.has(node.id)) return node;
      return {
        ...node,
        position: {
          x: ['left', 'center', 'right'].includes(alignment) ? alignValue : node.position.x,
          y: ['top', 'middle', 'bottom'].includes(alignment) ? alignValue : node.position.y,
        },
      };
    });

    setNodes(updatedNodes);
    notificationService.success('Align', `Nodes aligned ${alignment}`);
  }, [setNodes]);

  // Bulk distribute
  const handleBulkDistribute = useCallback((direction: 'horizontal' | 'vertical') => {
    const currentNodes = useWorkflowStore.getState().nodes;
    const currentSelectedNodes = useWorkflowStore.getState().selectedNodes;
    if (currentSelectedNodes.length < 2) return;

    const selectedIds = new Set(currentSelectedNodes);
    const selectedNodeObjects = currentNodes.filter(n => selectedIds.has(n.id));
    const sortedNodes = [...selectedNodeObjects].sort((a, b) =>
      direction === 'horizontal' ? a.position.x - b.position.x : a.position.y - b.position.y
    );

    const first = sortedNodes[0].position;
    const last = sortedNodes[sortedNodes.length - 1].position;
    const spacing = direction === 'horizontal'
      ? (last.x - first.x) / (sortedNodes.length - 1)
      : (last.y - first.y) / (sortedNodes.length - 1);

    const updatedNodes = currentNodes.map(node => {
      if (!selectedIds.has(node.id)) return node;
      const index = sortedNodes.findIndex(n => n.id === node.id);
      return {
        ...node,
        position: {
          x: direction === 'horizontal' ? first.x + spacing * index : node.position.x,
          y: direction === 'vertical' ? first.y + spacing * index : node.position.y,
        },
      };
    });

    setNodes(updatedNodes);
    notificationService.success('Distribute', `Nodes distributed ${direction}ly`);
  }, [setNodes]);

  // Bulk toggle enabled
  const handleBulkToggleEnabled = useCallback((enabled: boolean) => {
    const currentNodes = useWorkflowStore.getState().nodes;
    const currentSelectedNodes = useWorkflowStore.getState().selectedNodes;
    const selectedIds = new Set(currentSelectedNodes);

    const updatedNodes = currentNodes.map(node => {
      if (!selectedIds.has(node.id)) return node;
      return {
        ...node,
        data: { ...node.data, enabled },
      };
    });

    setNodes(updatedNodes);
    notificationService.success('Toggle Enabled', `${currentSelectedNodes.length} nodes ${enabled ? 'enabled' : 'disabled'}`);
  }, [setNodes]);

  // Copy nodes
  const handleCopyNodes = useCallback(() => {
    const currentNodes = useWorkflowStore.getState().nodes;
    const currentEdges = useWorkflowStore.getState().edges;
    const currentSelectedNodes = useWorkflowStore.getState().selectedNodes;
    const currentSelectedNode = useWorkflowStore.getState().selectedNode;

    const nodesToCopy = currentSelectedNodes.length > 0
      ? currentNodes.filter(n => currentSelectedNodes.includes(n.id))
      : currentSelectedNode
        ? [currentSelectedNode]
        : [];

    if (nodesToCopy.length === 0) {
      notificationService.warning('Copy', 'No nodes selected to copy');
      return;
    }

    const nodeIds = new Set(nodesToCopy.map(n => n.id));
    const edgesToCopy = currentEdges.filter(
      edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)
    );

    setClipboard({ nodes: nodesToCopy as Node[], edges: edgesToCopy as Edge[] });
    notificationService.success('Copy', `${nodesToCopy.length} node(s) copied`);
  }, [setClipboard]);

  // Paste nodes
  const handlePasteNodes = useCallback(() => {
    if (!clipboard || clipboard.nodes.length === 0) {
      notificationService.warning('Paste', 'Nothing to paste');
      return;
    }

    const currentNodes = useWorkflowStore.getState().nodes;
    const currentEdges = useWorkflowStore.getState().edges;
    addToHistory(currentNodes, currentEdges);

    const idMap = new Map<string, string>();
    const offset = { x: 50, y: 50 };

    const newNodes = clipboard.nodes.map((node: any, index: any) => {
      const newId = `${node.id}-paste-${Date.now()}-${index}`;
      idMap.set(node.id, newId);
      return {
        ...node,
        id: newId,
        position: {
          x: node.position.x + offset.x,
          y: node.position.y + offset.y,
        },
        selected: true,
      };
    });

    const newEdges = clipboard.edges.map((edge, index) => ({
      ...edge,
      id: `${edge.id}-paste-${Date.now()}-${index}`,
      source: idMap.get(edge.source) || edge.source,
      target: idMap.get(edge.target) || edge.target,
    }));

    const updatedNodes = currentNodes.map(n => ({ ...n, selected: false }));
    setNodes([...updatedNodes, ...newNodes] as WorkflowNode[]);
    setEdges([...currentEdges, ...newEdges] as WorkflowEdge[]);
    setSelectedNodes(newNodes.map(n => n.id));

    // Center viewport on pasted nodes
    setTimeout(() => {
      fitView({ nodes: newNodes as WorkflowNode[], padding: 0.5, duration: 300 });
    }, 50);

    notificationService.success('Paste', `${newNodes.length} node(s) pasted`);
  }, [clipboard, addToHistory, setNodes, setEdges, setSelectedNodes, fitView]);

  // Cut nodes
  const handleCutNodes = useCallback(() => {
    const currentNodes = useWorkflowStore.getState().nodes;
    const currentEdges = useWorkflowStore.getState().edges;
    const currentSelectedNodes = useWorkflowStore.getState().selectedNodes;
    const currentSelectedNode = useWorkflowStore.getState().selectedNode;

    const nodesToCut = currentSelectedNodes.length > 0
      ? currentNodes.filter(n => currentSelectedNodes.includes(n.id))
      : currentSelectedNode
        ? [currentSelectedNode]
        : [];

    if (nodesToCut.length === 0) {
      notificationService.warning('Cut', 'No nodes selected to cut');
      return;
    }

    const nodeIds = new Set(nodesToCut.map(n => n.id));
    const edgesToCut = currentEdges.filter(
      edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)
    );

    setClipboard({ nodes: nodesToCut as Node[], edges: edgesToCut as Edge[] });

    addToHistory(currentNodes, currentEdges);
    setNodes(currentNodes.filter(n => !nodeIds.has(n.id)));
    setEdges(currentEdges.filter(e => !nodeIds.has(e.source) && !nodeIds.has(e.target)));
    setSelectedNodes([]);
    setSelectedNode(null);

    notificationService.success('Cut', `${nodesToCut.length} node(s) cut`);
  }, [addToHistory, setNodes, setEdges, setSelectedNodes, setSelectedNode, setClipboard]);

  // Add node
  const addNode = useCallback((nodeType: string, position: { x: number; y: number }): WorkflowNode => {
    const currentNodes = useWorkflowStore.getState().nodes;
    const currentEdges = useWorkflowStore.getState().edges;

    // Apply snap to grid if enabled
    if (snapToGrid) {
      position.x = Math.round(position.x / gridConfig.size) * gridConfig.size;
      position.y = Math.round(position.y / gridConfig.size) * gridConfig.size;
    }

    const newNodeId = getId();
    const newNode: WorkflowNode = {
      id: newNodeId,
      type: 'custom',
      position,
      data: createNodeData(newNodeId, nodeType, position),
    };

    addToHistory(currentNodes, currentEdges);
    setNodes([...currentNodes, newNode]);

    // Animation feedback
    setTimeout(() => {
      const nodeElement = document.querySelector(`[data-id="${newNode.id}"]`);
      if (nodeElement) {
        nodeElement.classList.add('animate-bounce');
        setTimeout(() => {
          nodeElement.classList.remove('animate-bounce');
        }, 600);
      }
    }, 100);

    return newNode;
  }, [getId, snapToGrid, createNodeData, addToHistory, setNodes]);

  // Delete node
  const deleteNode = useCallback((nodeId: string) => {
    const currentNodes = useWorkflowStore.getState().nodes;
    const currentEdges = useWorkflowStore.getState().edges;

    addToHistory(currentNodes, currentEdges);
    setNodes(currentNodes.filter(n => n.id !== nodeId));
    setEdges(currentEdges.filter(e => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
  }, [addToHistory, setNodes, setEdges, setSelectedNode]);

  // Duplicate node
  const duplicateNode = useCallback((nodeId: string): WorkflowNode | null => {
    const currentNodes = useWorkflowStore.getState().nodes;
    const currentEdges = useWorkflowStore.getState().edges;
    const nodeToDuplicate = currentNodes.find(n => n.id === nodeId);

    if (!nodeToDuplicate) return null;

    const newNode: WorkflowNode = {
      ...nodeToDuplicate,
      id: getId(),
      position: {
        x: nodeToDuplicate.position.x + 50,
        y: nodeToDuplicate.position.y + 50,
      },
    };

    addToHistory(currentNodes, currentEdges);
    setNodes([...currentNodes, newNode]);
    setSelectedNode(newNode);

    return newNode;
  }, [getId, addToHistory, setNodes, setSelectedNode]);

  // Delete selected nodes
  const deleteSelectedNodes = useCallback(() => {
    const currentNodes = useWorkflowStore.getState().nodes;
    const currentEdges = useWorkflowStore.getState().edges;
    const currentSelectedNodes = useWorkflowStore.getState().selectedNodes;
    const currentSelectedNode = useWorkflowStore.getState().selectedNode;

    if (currentSelectedNodes.length > 0) {
      const nodeIdsToDelete = currentSelectedNodes;
      addToHistory(currentNodes, currentEdges);
      setNodes(currentNodes.filter(n => !nodeIdsToDelete.includes(n.id)));
      setEdges(currentEdges.filter(e => !nodeIdsToDelete.includes(e.source) && !nodeIdsToDelete.includes(e.target)));
      setSelectedNodes([]);
    } else if (currentSelectedNode) {
      addToHistory(currentNodes, currentEdges);
      setNodes(currentNodes.filter(n => n.id !== currentSelectedNode.id));
      setEdges(currentEdges.filter(e => e.source !== currentSelectedNode.id && e.target !== currentSelectedNode.id));
      setSelectedNode(null);
    }
  }, [addToHistory, setNodes, setEdges, setSelectedNodes, setSelectedNode]);

  // Duplicate selected nodes
  const duplicateSelectedNodes = useCallback(() => {
    const currentNodes = useWorkflowStore.getState().nodes;
    const currentEdges = useWorkflowStore.getState().edges;
    const currentSelectedNodes = useWorkflowStore.getState().selectedNodes;
    const currentSelectedNode = useWorkflowStore.getState().selectedNode;

    if (currentSelectedNodes.length > 0) {
      const nodesToDuplicate = currentNodes.filter(n => currentSelectedNodes.includes(n.id));
      const newNodes = nodesToDuplicate.map((node, idx) => ({
        ...node,
        id: `node_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 9)}`,
        position: { x: node.position.x + 50, y: node.position.y + 50 },
      }));
      addToHistory(currentNodes, currentEdges);
      setNodes([...currentNodes, ...newNodes]);
      setTimeout(() => {
        fitView({ nodes: newNodes as WorkflowNode[], padding: 0.5, duration: 300 });
      }, 50);
      notificationService.success('Duplicate', `${newNodes.length} nodes duplicated`);
    } else if (currentSelectedNode) {
      const newNode = {
        ...currentSelectedNode,
        id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        position: { x: currentSelectedNode.position.x + 50, y: currentSelectedNode.position.y + 50 },
      };
      addToHistory(currentNodes, currentEdges);
      setNodes([...currentNodes, newNode]);
      setSelectedNode(newNode);
      setTimeout(() => {
        fitView({ nodes: [newNode] as WorkflowNode[], padding: 0.5, duration: 300 });
      }, 50);
      notificationService.success('Duplicate', 'Node duplicated');
    }
  }, [addToHistory, setNodes, setSelectedNode, fitView]);

  return {
    createNodeData,
    onNodesChange,
    onEdgesChange,
    onConnect,
    isValidConnection,
    handleBulkDelete,
    handleBulkDuplicate,
    handleBulkAlign,
    handleBulkDistribute,
    handleBulkToggleEnabled,
    handleCopyNodes,
    handlePasteNodes,
    handleCutNodes,
    addNode,
    deleteNode,
    duplicateNode,
    deleteSelectedNodes,
    duplicateSelectedNodes,
  };
}

export default useWorkflowActions;
