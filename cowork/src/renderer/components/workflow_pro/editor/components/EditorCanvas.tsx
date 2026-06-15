// @ts-nocheck
/**
 * EditorCanvas Component
 * Encapsulates ReactFlow with all necessary configurations and handlers
 */

import React, { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Node,
  Edge,
  Connection,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  OnConnectStart,
  OnConnectEnd,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  nodeTypesMap,
  connectionLineStyle,
  defaultEdgeOptions,
} from '../config';
import ValidationEdge from '../ValidationEdge';
import { n8nEdgeTypes, gridConfig } from '../config/editorConfig';
import DropPreviewGhost from './DropPreviewGhost';
import ConnectionLineWithValidation from '../ConnectionLineWithValidation';
import AlignmentGuides from '../AlignmentGuides';

// Custom edge types with validation visual feedback
const edgeTypes = {
  default: ValidationEdge,
  validation: ValidationEdge,
  ...n8nEdgeTypes,
};

export interface EditorCanvasProps {
  /** Nodes to display */
  nodes: Node[];
  /** Edges (connections) to display */
  edges: Edge[];
  /** Handler for node changes */
  onNodesChange: OnNodesChange;
  /** Handler for edge changes */
  onEdgesChange: OnEdgesChange;
  /** Handler for new connections */
  onConnect: OnConnect;
  /** Handler for node click */
  onNodeClick?: (event: React.MouseEvent, node: Node) => void;
  /** Handler for edge click */
  onEdgeClick?: (event: React.MouseEvent, edge: Edge) => void;
  /** Handler for node context menu (right-click) */
  onNodeContextMenu?: (event: React.MouseEvent, node: Node) => void;
  /** Handler for connection start — @xyflow/react v12 uses DOM events */
  onConnectStart?: OnConnectStart;
  /** Handler for connection end — receives FinalConnectionState as 2nd arg in v12 */
  onConnectEnd?: OnConnectEnd;
  /** Handler for drop events */
  onDrop?: (event: React.DragEvent) => void;
  /** Handler for drag over */
  onDragOver?: (event: React.DragEvent) => void;
  /** Handler for drag leave */
  onDragLeave?: (event: React.DragEvent) => void;
  /** Drop preview position for ghost indicator */
  dropPreview?: { x: number; y: number } | null;
  /** Handler for pane click */
  onPaneClick?: (event: React.MouseEvent) => void;
  /** Handler for double click */
  onDoubleClick?: (event: React.MouseEvent) => void;
  /** Handler for viewport move/zoom */
  onMove?: (event: unknown, viewport: { x: number; y: number; zoom: number }) => void;
  /** Connection validation function */
  isValidConnection?: (connection: Connection) => boolean;
  /** Whether dark mode is enabled */
  darkMode?: boolean;
  /** Whether to snap nodes to grid */
  snapToGrid?: boolean;
  /** Whether to show grid background */
  showGrid?: boolean;
  /** Whether to show alignment guides */
  showAlignmentGuides?: boolean;
  /** Reference to the wrapper div */
  wrapperRef?: React.RefObject<HTMLDivElement>;
  /** Children to render inside ReactFlow (Controls, MiniMap, etc.) */
  children?: React.ReactNode;
}

/**
 * EditorCanvas - Main ReactFlow canvas component
 *
 * Encapsulates ReactFlow with all necessary configurations for the workflow editor.
 * Handles nodes, edges, connections, and provides customizable event handlers.
 */
export const EditorCanvas: React.FC<EditorCanvasProps> = ({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onEdgeClick,
  onNodeContextMenu,
  onConnectStart,
  onConnectEnd,
  onDrop,
  onDragOver,
  onDragLeave,
  dropPreview,
  onPaneClick,
  onDoubleClick,
  onMove,
  isValidConnection,
  darkMode = false,
  snapToGrid = true,
  showGrid = true,
  showAlignmentGuides = true,
  wrapperRef,
  children,
}) => {
  // Default drag over handler
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    onDragOver?.(event);
  }, [onDragOver]);

  return (
    <div className="h-full" id="workflow-canvas" aria-label="Workflow editor canvas" ref={wrapperRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onNodeContextMenu={onNodeContextMenu}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onDrop={onDrop}
        onDragOver={handleDragOver}
        onDragLeave={onDragLeave}
        onPaneClick={onPaneClick}
        onDoubleClick={onDoubleClick}
        onMove={onMove}
        nodeTypes={nodeTypesMap}
        edgeTypes={edgeTypes}
        isValidConnection={isValidConnection}
        connectionLineComponent={ConnectionLineWithValidation}
        connectionLineStyle={connectionLineStyle}
        connectionMode={ConnectionMode.Loose}
        fitView
        colorMode={darkMode ? 'dark' : 'light'}
        className={`${darkMode ? 'bg-[#1a1a2e]' : 'bg-[#f5f5f5]'} transition-colors duration-300`}
        deleteKeyCode={null} // Handled by keyboard shortcuts
        multiSelectionKeyCode="Shift"
        selectNodesOnDrag={true}
        elevateNodesOnSelect={true}
        elevateEdgesOnSelect={true}
        nodesFocusable={true}
        zoomOnScroll={true}
        zoomOnPinch={true}
        panOnScroll={true}
        panOnDrag={[1, 2]}
        preventScrolling={false}
        autoPanOnNodeDrag={true}
        autoPanOnConnect={true}
        snapToGrid={snapToGrid}
        snapGrid={[16, 16]}
        onlyRenderVisibleElements={true}
        defaultEdgeOptions={defaultEdgeOptions}
        onError={(id, message) => console.error('[ReactFlow]', id, message)}
      >
        {/* Drop Preview Ghost */}
        {dropPreview && <DropPreviewGhost position={dropPreview} darkMode={darkMode} />}

        {/* Alignment Guides */}
        {showAlignmentGuides && <AlignmentGuides enabled={snapToGrid} />}

        {/* Background Grid - n8n-style dot pattern */}
        {showGrid && (
          <Background
            variant={BackgroundVariant.Dots}
            gap={gridConfig.size}
            size={1}
            color={darkMode ? '#374151' : '#d1d5db'}
            className="transition-colors duration-300"
          />
        )}

        {/* Additional children (MiniMap, custom overlays, etc.) */}
        {children}
      </ReactFlow>
    </div>
  );
};

export default EditorCanvas;
