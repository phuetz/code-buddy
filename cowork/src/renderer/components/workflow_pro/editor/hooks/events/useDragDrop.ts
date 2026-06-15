// @ts-nocheck
/**
 * useDragDrop
 *
 * Handles drag and drop of nodes from the palette onto the canvas.
 * Supports:
 * - Basic node placement
 * - Snap to grid
 * - Edge splitting (drop on edge to insert node)
 */

import { useCallback, useRef, useState } from 'react';
import { MarkerType, useReactFlow } from '@xyflow/react';
import { WorkflowNode, WorkflowEdge, NodeData } from '../../../type-mocks';
import { useWorkflowStore } from '../../../store';
import { gridConfig } from '../../config/editorConfig';
import { nodeTypes } from '../../../data-mocks';
import { notificationService } from '../../../service-mocks';
import { logger } from '../../../service-mocks';
import { findNonOverlappingPosition } from '../../../hook-mocks';

export interface UseDragDropOptions {
  /** Reference to the ReactFlow wrapper */
  reactFlowWrapper: React.RefObject<HTMLDivElement>;
  /** Project screen coordinates to flow coordinates */
  project: (position: { x: number; y: number }) => { x: number; y: number };
  /** Generate unique node ID */
  getId: () => string;
  /** Whether snap to grid is enabled */
  snapToGrid: boolean;
  /** Create node data for a new node */
  createNodeData: (id: string, nodeType: string, position: { x: number; y: number }) => NodeData;
}

export interface UseDragDropReturn {
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  dropPreview: { x: number; y: number } | null;
}

const DROP_RADIUS = 30; // Pixels tolerance for edge drop detection

/**
 * Check if a point is near a line segment (for edge splitting)
 */
function isPointNearEdge(
  point: { x: number; y: number },
  source: { x: number; y: number },
  target: { x: number; y: number }
): { isNear: boolean; t: number } {
  const sx = source.x + 100; // Approximate node center
  const sy = source.y + 40;
  const tx = target.x + 100;
  const ty = target.y + 40;

  const lineLengthSquared = (tx - sx) ** 2 + (ty - sy) ** 2;
  if (lineLengthSquared === 0) return { isNear: false, t: 0 };

  const t = Math.max(
    0,
    Math.min(1, ((point.x - sx) * (tx - sx) + (point.y - sy) * (ty - sy)) / lineLengthSquared)
  );

  const projX = sx + t * (tx - sx);
  const projY = sy + t * (ty - sy);
  const distance = Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);

  // Check if we're in the middle section of the edge (not near endpoints)
  return {
    isNear: distance < DROP_RADIUS && t > 0.2 && t < 0.8,
    t,
  };
}

/**
 * Hook for handling drag and drop operations.
 * NODE_WIDTH/HEIGHT are the n8n-style defaults used for collision detection
 * BEFORE the new node is measured by ReactFlow. After insertion, we read the
 * real `measured` dimensions from `getInternalNode(id)` when centering.
 */
const NODE_WIDTH = 250;
const NODE_HEIGHT = 100;

export function useDragDrop(options: UseDragDropOptions): UseDragDropReturn {
  const { reactFlowWrapper, project, getId, snapToGrid, createNodeData } = options;

  const { setCenter, getViewport, getInternalNode } = useReactFlow();
  const [dropPreview, setDropPreview] = useState<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number>(0);

  // Store actions
  const setNodes = useWorkflowStore((state) => state.setNodes);
  const setEdges = useWorkflowStore((state) => state.setEdges);
  const addToHistory = useWorkflowStore((state) => state.addToHistory);

  /**
   * Handle drag over - allow drop.
   * v12: pass raw clientX/clientY to screenToFlowPosition — the function
   * subtracts the wrapper's bounding-rect internally. Subtracting it again
   * here produced an offset bug (drops landed shifted by the wrapper's left).
   */
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

  /**
   * Handle drop - create node at drop position
   */
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

      if (!type) {
        logger.info('No type found in dataTransfer');
        return;
      }

      // v12: screenToFlowPosition subtracts the wrapper bounds internally.
      // Pass raw client coordinates from the event.
      const position = project({ x: event.clientX, y: event.clientY });

      // Snap to grid if enabled
      if (snapToGrid) {
        position.x = Math.round(position.x / gridConfig.size) * gridConfig.size;
        position.y = Math.round(position.y / gridConfig.size) * gridConfig.size;
      }

      // Avoid overlapping existing nodes
      const currentNodesForCollision = useWorkflowStore.getState().nodes;
      const adjusted = findNonOverlappingPosition(
        position,
        currentNodesForCollision,
        NODE_WIDTH,
        NODE_HEIGHT,
        snapToGrid ? gridConfig.size : 0
      );
      position.x = adjusted.x;
      position.y = adjusted.y;

      const nodeConfig = nodeTypes[type];
      if (!nodeConfig) {
        logger.error(`Node type ${type} not found in nodeTypes`);
        return;
      }

      // Create new node
      const newNodeId = getId();
      const newNode: WorkflowNode = {
        id: newNodeId,
        type: 'custom',
        position,
        data: createNodeData(newNodeId, type, position),
      };

      // Get current state
      const currentNodes = useWorkflowStore.getState().nodes;
      const currentEdges = useWorkflowStore.getState().edges;

      // Check if dropping on an edge - insert node in the middle
      let edgeToSplit: WorkflowEdge | null = null;

      for (const edge of currentEdges) {
        const sourceNode = currentNodes.find((n) => n.id === edge.source);
        const targetNode = currentNodes.find((n) => n.id === edge.target);

        if (sourceNode && targetNode) {
          const result = isPointNearEdge(position, sourceNode.position, targetNode.position);
          if (result.isNear) {
            edgeToSplit = edge;
            break;
          }
        }
      }

      let updatedEdges = currentEdges;

      if (edgeToSplit) {
        // Insert node in the middle of the edge
        const newEdge1: WorkflowEdge = {
          id: `edge_${Date.now()}_1`,
          source: edgeToSplit.source,
          target: newNodeId,
          sourceHandle: edgeToSplit.sourceHandle,
          animated: true,
          style: { stroke: '#22c55e', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e', width: 16, height: 16 },
        };

        const newEdge2: WorkflowEdge = {
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
          ...currentEdges.filter((e) => e.id !== edgeToSplit!.id),
          newEdge1,
          newEdge2,
        ];

        notificationService.success('Edge Split', 'Node inserted into connection');
      }

      // Update store
      setNodes([...currentNodes, newNode]);
      setEdges(updatedEdges);
      addToHistory(currentNodes, currentEdges);

      // Center viewport on new node if not fully visible. Wait one rAF so
      // ReactFlow can measure the node, then read the real dimensions from
      // `getInternalNode(id).measured` instead of relying on hardcoded values.
      const wrapperBounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (wrapperBounds) {
        const viewport = getViewport();
        const visibleLeft = -viewport.x / viewport.zoom;
        const visibleTop = -viewport.y / viewport.zoom;
        const visibleRight = visibleLeft + wrapperBounds.width / viewport.zoom;
        const visibleBottom = visibleTop + wrapperBounds.height / viewport.zoom;

        const isFullyVisible =
          position.x >= visibleLeft &&
          position.x + NODE_WIDTH <= visibleRight &&
          position.y >= visibleTop &&
          position.y + NODE_HEIGHT <= visibleBottom;

        if (!isFullyVisible) {
          requestAnimationFrame(() => {
            const internal = getInternalNode(newNodeId);
            const w = internal?.measured?.width ?? NODE_WIDTH;
            const h = internal?.measured?.height ?? NODE_HEIGHT;
            setCenter(position.x + w / 2, position.y + h / 2, { duration: 400 });
          });
        }
      }

      // Log the action
      const addLog = useWorkflowStore.getState().addLog;
      addLog({
        level: 'info',
        message: `Node added: ${nodeConfig.label}`,
        data: { nodeId: newNode.id, type, position },
      });
    },
    [project, setNodes, setEdges, addToHistory, snapToGrid, getId, reactFlowWrapper, createNodeData, setCenter, getViewport, getInternalNode]
  );

  return {
    onDragOver,
    onDrop,
    onDragLeave,
    dropPreview,
  };
}

export default useDragDrop;
