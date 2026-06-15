/**
 * useWorkflowState Hook
 *
 * Manages the state for the workflow editor including:
 * - Local UI state (sidebar, panels, modals)
 * - View settings (zoom, grid, minimap)
 * - Selection state (clipboard, context menu)
 * - Feature panel states
 */

import { useState, useRef, useCallback } from 'react';
import { Node, Edge } from '@xyflow/react';
import { WorkflowNode } from '../../type-mocks';

// Types for UI state
export type ViewMode = 'normal' | 'compact' | 'detailed';
export type ConnectionStyleType = 'bezier' | 'straight' | 'smoothstep';

export interface ContextMenuState {
  nodeId: string;
  x: number;
  y: number;
}

export interface DataPreviewState {
  nodeId: string;
  x: number;
  y: number;
}

export interface PinDataPanelState {
  nodeId: string;
  nodeName: string;
}

export interface ClipboardState {
  nodes: Node[];
  edges: Edge[];
}

export interface QuickSearchPosition {
  x: number;
  y: number;
}

export interface N8nNodePanelPosition {
  x: number;
  y: number;
}

export interface WorkflowExecutionResultState {
  success: boolean;
  data: unknown;
}

export interface WorkflowExecutionErrorState {
  message: string;
  details: unknown;
}

export interface UseWorkflowStateReturn {
  // Sidebar state
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Config panel state
  configPanelOpen: boolean;
  setConfigPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // N8N style state
  useN8nStyle: boolean;
  setUseN8nStyle: React.Dispatch<React.SetStateAction<boolean>>;
  n8nNodePanelOpen: boolean;
  setN8nNodePanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  n8nNodePanelPosition: N8nNodePanelPosition | undefined;
  setN8nNodePanelPosition: React.Dispatch<React.SetStateAction<N8nNodePanelPosition | undefined>>;
  focusPanelOpen: boolean;
  setFocusPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  focusPanelNode: WorkflowNode | null;
  setFocusPanelNode: React.Dispatch<React.SetStateAction<WorkflowNode | null>>;

  // View settings
  viewMode: ViewMode;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
  snapToGrid: boolean;
  setSnapToGrid: React.Dispatch<React.SetStateAction<boolean>>;
  showMiniMap: boolean;
  setShowMiniMap: React.Dispatch<React.SetStateAction<boolean>>;
  showGrid: boolean;
  setShowGrid: React.Dispatch<React.SetStateAction<boolean>>;
  connectionStyle: ConnectionStyleType;
  setConnectionStyle: React.Dispatch<React.SetStateAction<ConnectionStyleType>>;
  autoLayout: boolean;
  setAutoLayout: React.Dispatch<React.SetStateAction<boolean>>;
  zoomLevel: number;
  setZoomLevel: React.Dispatch<React.SetStateAction<number>>;
  showMetrics: boolean;
  setShowMetrics: React.Dispatch<React.SetStateAction<boolean>>;

  // Search and filter state
  searchTerm: string;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  filterCategory: string;
  setFilterCategory: React.Dispatch<React.SetStateAction<string>>;

  // Modal states
  aiBuilderOpen: boolean;
  setAiBuilderOpen: React.Dispatch<React.SetStateAction<boolean>>;
  visualDesignerOpen: boolean;
  setVisualDesignerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  shortcutsModalOpen: boolean;
  setShortcutsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  templatesGalleryOpen: boolean;
  setTemplatesGalleryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  performanceMonitorOpen: boolean;
  setPerformanceMonitorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  n8nImportModalOpen: boolean;
  setN8nImportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  commandBarOpen: boolean;
  setCommandBarOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Context menu and quick search
  contextMenu: ContextMenuState | null;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  quickSearchOpen: boolean;
  setQuickSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  quickSearchPosition: QuickSearchPosition | undefined;
  setQuickSearchPosition: React.Dispatch<React.SetStateAction<QuickSearchPosition | undefined>>;

  // Data preview and pin data
  dataPreview: DataPreviewState | null;
  setDataPreview: React.Dispatch<React.SetStateAction<DataPreviewState | null>>;
  pinDataPanel: PinDataPanelState | null;
  setPinDataPanel: React.Dispatch<React.SetStateAction<PinDataPanelState | null>>;

  // Bulk operations
  bulkPanelOpen: boolean;
  setBulkPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Clipboard
  clipboard: ClipboardState | null;
  setClipboard: React.Dispatch<React.SetStateAction<ClipboardState | null>>;

  // Feature panels
  dataPinningPanelOpen: boolean;
  setDataPinningPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  executionHistoryOpen: boolean;
  setExecutionHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  nodeSearchOpen: boolean;
  setNodeSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  variablesPanelOpen: boolean;
  setVariablesPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  customNodeCreatorOpen: boolean;
  setCustomNodeCreatorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  docGeneratorOpen: boolean;
  setDocGeneratorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  collaborationOpen: boolean;
  setCollaborationOpen: React.Dispatch<React.SetStateAction<boolean>>;
  stepDebugPanelOpen: boolean;
  setStepDebugPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  highlightedDebugNode: string | null;
  setHighlightedDebugNode: React.Dispatch<React.SetStateAction<string | null>>;

  // Workflow execution state (local, not per-node)
  workflowExecutionResult: WorkflowExecutionResultState | null;
  setWorkflowExecutionResult: React.Dispatch<React.SetStateAction<WorkflowExecutionResultState | null>>;
  workflowExecutionError: WorkflowExecutionErrorState | null;
  setWorkflowExecutionError: React.Dispatch<React.SetStateAction<WorkflowExecutionErrorState | null>>;

  // Refs
  idRef: React.MutableRefObject<number>;
  reactFlowWrapper: React.RefObject<HTMLDivElement>;
  pendingConnectionRef: React.MutableRefObject<{ nodeId: string; handleId: string | null } | null>;

  // ID generation
  getId: () => string;
}

export interface UseWorkflowStateOptions {
  initialUseN8nStyle?: boolean;
  initialViewMode?: ViewMode;
  initialSnapToGrid?: boolean;
  initialShowMiniMap?: boolean;
  initialShowGrid?: boolean;
  initialConnectionStyle?: ConnectionStyleType;
  initialShowMetrics?: boolean;
}

/**
 * Custom hook for managing workflow editor state
 * Extracts all useState, useRef, and related logic from ModernWorkflowEditor
 */
export function useWorkflowState(options: UseWorkflowStateOptions = {}): UseWorkflowStateReturn {
  const {
    initialUseN8nStyle = true,
    initialViewMode = 'normal',
    initialSnapToGrid = true,
    initialShowMiniMap = true,
    initialShowGrid = true,
    initialConnectionStyle = 'bezier',
    initialShowMetrics = true,
  } = options;

  // Sidebar and config panel state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [configPanelOpen, setConfigPanelOpen] = useState(false);

  // N8N-style UI state
  const [useN8nStyle, setUseN8nStyle] = useState(initialUseN8nStyle);
  const [n8nNodePanelOpen, setN8nNodePanelOpen] = useState(false);
  const [n8nNodePanelPosition, setN8nNodePanelPosition] = useState<N8nNodePanelPosition | undefined>();
  const [focusPanelOpen, setFocusPanelOpen] = useState(false);
  const [focusPanelNode, setFocusPanelNode] = useState<WorkflowNode | null>(null);

  // View settings
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [snapToGrid, setSnapToGrid] = useState(initialSnapToGrid);
  const [showMiniMap, setShowMiniMap] = useState(initialShowMiniMap);
  const [showGrid, setShowGrid] = useState(initialShowGrid);
  const [connectionStyle, setConnectionStyle] = useState<ConnectionStyleType>(initialConnectionStyle);
  const [autoLayout, setAutoLayout] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showMetrics, setShowMetrics] = useState(initialShowMetrics);

  // Search and filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');

  // Modal states
  const [aiBuilderOpen, setAiBuilderOpen] = useState(false);
  const [visualDesignerOpen, setVisualDesignerOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [templatesGalleryOpen, setTemplatesGalleryOpen] = useState(false);
  const [performanceMonitorOpen, setPerformanceMonitorOpen] = useState(false);
  const [n8nImportModalOpen, setN8nImportModalOpen] = useState(false);
  const [commandBarOpen, setCommandBarOpen] = useState(false);

  // Context menu and quick search
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [quickSearchPosition, setQuickSearchPosition] = useState<QuickSearchPosition | undefined>();

  // Data preview and pin data
  const [dataPreview, setDataPreview] = useState<DataPreviewState | null>(null);
  const [pinDataPanel, setPinDataPanel] = useState<PinDataPanelState | null>(null);

  // Bulk operations
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);

  // Clipboard
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);

  // Feature panels
  const [dataPinningPanelOpen, setDataPinningPanelOpen] = useState(false);
  const [executionHistoryOpen, setExecutionHistoryOpen] = useState(false);
  const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
  const [variablesPanelOpen, setVariablesPanelOpen] = useState(false);
  const [customNodeCreatorOpen, setCustomNodeCreatorOpen] = useState(false);
  const [docGeneratorOpen, setDocGeneratorOpen] = useState(false);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [stepDebugPanelOpen, setStepDebugPanelOpen] = useState(false);
  const [highlightedDebugNode, setHighlightedDebugNode] = useState<string | null>(null);

  // Workflow-level execution state (not per-node)
  const [workflowExecutionResult, setWorkflowExecutionResult] = useState<WorkflowExecutionResultState | null>(null);
  const [workflowExecutionError, setWorkflowExecutionError] = useState<WorkflowExecutionErrorState | null>(null);

  // Refs
  const idRef = useRef<number>(0);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const pendingConnectionRef = useRef<{ nodeId: string; handleId: string | null } | null>(null);

  // getId function defined as stable reference
  const getId = useCallback(() => {
    idRef.current += 1;
    return `node_${idRef.current}_${Date.now()}`;
  }, []);

  return {
    // Sidebar state
    sidebarOpen,
    setSidebarOpen,

    // Config panel state
    configPanelOpen,
    setConfigPanelOpen,

    // N8N style state
    useN8nStyle,
    setUseN8nStyle,
    n8nNodePanelOpen,
    setN8nNodePanelOpen,
    n8nNodePanelPosition,
    setN8nNodePanelPosition,
    focusPanelOpen,
    setFocusPanelOpen,
    focusPanelNode,
    setFocusPanelNode,

    // View settings
    viewMode,
    setViewMode,
    snapToGrid,
    setSnapToGrid,
    showMiniMap,
    setShowMiniMap,
    showGrid,
    setShowGrid,
    connectionStyle,
    setConnectionStyle,
    autoLayout,
    setAutoLayout,
    zoomLevel,
    setZoomLevel,
    showMetrics,
    setShowMetrics,

    // Search and filter state
    searchTerm,
    setSearchTerm,
    filterCategory,
    setFilterCategory,

    // Modal states
    aiBuilderOpen,
    setAiBuilderOpen,
    visualDesignerOpen,
    setVisualDesignerOpen,
    shortcutsModalOpen,
    setShortcutsModalOpen,
    templatesGalleryOpen,
    setTemplatesGalleryOpen,
    performanceMonitorOpen,
    setPerformanceMonitorOpen,
    n8nImportModalOpen,
    setN8nImportModalOpen,
    commandBarOpen,
    setCommandBarOpen,

    // Context menu and quick search
    contextMenu,
    setContextMenu,
    quickSearchOpen,
    setQuickSearchOpen,
    quickSearchPosition,
    setQuickSearchPosition,

    // Data preview and pin data
    dataPreview,
    setDataPreview,
    pinDataPanel,
    setPinDataPanel,

    // Bulk operations
    bulkPanelOpen,
    setBulkPanelOpen,

    // Clipboard
    clipboard,
    setClipboard,

    // Feature panels
    dataPinningPanelOpen,
    setDataPinningPanelOpen,
    executionHistoryOpen,
    setExecutionHistoryOpen,
    nodeSearchOpen,
    setNodeSearchOpen,
    variablesPanelOpen,
    setVariablesPanelOpen,
    customNodeCreatorOpen,
    setCustomNodeCreatorOpen,
    docGeneratorOpen,
    setDocGeneratorOpen,
    collaborationOpen,
    setCollaborationOpen,
    stepDebugPanelOpen,
    setStepDebugPanelOpen,
    highlightedDebugNode,
    setHighlightedDebugNode,

    // Workflow execution state
    workflowExecutionResult,
    setWorkflowExecutionResult,
    workflowExecutionError,
    setWorkflowExecutionError,

    // Refs
    idRef,
    reactFlowWrapper,
    pendingConnectionRef,

    // ID generation
    getId,
  };
}

export default useWorkflowState;
