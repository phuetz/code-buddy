// @ts-nocheck
/**
 * ModernWorkflowEditor
 *
 * Main visual workflow editor component using ReactFlow.
 * Refactored from 2183 lines to ~380 lines by extracting to components and hooks.
 */

import React, { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { useReactFlow, useOnSelectionChange, useOnViewportChange, useNodesInitialized, MiniMap, Node, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../../../styles/design-system.css';

import { useWorkflowStore } from '../store';
import { nodeTypes } from '../data-mocks';
import { useUpdateTimestamp } from '../service-mocks';
import { useKeyboardShortcuts } from '../hook-mocks';
import { UnifiedSidebar } from '../ui-mocks';
import NodeConfigPanel from '../ui-mocks';

import {
  useWorkflowState,
  useWorkflowActions,
  useWorkflowEvents,
  useProcessedNodes,
  useProcessedEdges,
  useSelectedNodeIds,
  useWorkflowExecution,
} from './hooks';
import { isNodeBreakpointed, waitForDebugResume } from './hooks/useWorkflowExecution';
import { useElkLayout } from './hooks/layout/useElkLayout';

import { EditorCanvas, EditorHeader, EditorStatusBar, EditorModals, EditorPanels } from './components';
import { MetricsPanel, StatusIndicator, EmptyState } from './panels';
import SplitPaneExecutionView from '../execution/SplitPaneExecutionView';
import ExecutionWaterfall from '../execution/ExecutionWaterfall';
import { EditorPanelProvider } from './context';
import CanvasSelectionToolbar from '../ui-mocks';

const NodeTestPanel = lazy(() => import('./panels/NodeTestPanel'));
const NodeRunDataInspector = lazy(() => import('../ui-mocks'));
const NodeDetailView = lazy(() => import('./panels/NodeDetailView'));
const SettingsDrawer = lazy(() => import('./components/SettingsDrawer'));

function ModernWorkflowEditorInner() {
  // @xyflow/react v12 renamed `project` → `screenToFlowPosition`. We alias
  // it back so useDragDrop / useConnectionHandlers / useCanvasControls keep
  // working with the legacy name they were typed against.
  const { screenToFlowPosition, fitView, zoomIn, zoomOut, zoomTo } = useReactFlow();
  const project = screenToFlowPosition;

  // Store state (only what's needed at this level)
  const store = useWorkflowStore();
  const { nodes, edges, selectedNode, selectedNodes, darkMode, isExecuting,
          nodeExecutionStatus, currentEnvironment, isCurrentWorkflowLocked,
          setSelectedNode, setSelectedNodes, saveWorkflow, exportWorkflow, importWorkflow } = store;

  // Local UI state hook
  const state = useWorkflowState();

  // Actions hook
  const actions = useWorkflowActions({
    getId: state.getId,
    snapToGrid: state.snapToGrid,
    clipboard: state.clipboard,
    setClipboard: state.setClipboard,
  });

  // Auto-layout and execution hooks
  const { performAutoLayout, _isLayingOut } = useElkLayout();
  const { executeWorkflow, executeNode } = useWorkflowExecution({ nodes, edges });

  // NodeTestPanel + NodeRunDataInspector (lazy) open/close state
  const [testPanelNodeId, setTestPanelNodeId] = useState<string | null>(null);
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const [detailViewNodeId, setDetailViewNodeId] = useState<string | null>(null);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  // Right-pane view toggle: 'auto' picks SplitPane after a run, 'config'
  // forces the plain NodeConfigPanel so the user can re-edit a node after
  // its execution status was set (was previously stuck on SplitPane).
  const [rightPaneMode, setRightPaneMode] = useState<'auto' | 'config'>('auto');

  // Reset right-pane mode whenever the selected node changes so the next
  // node picked from the canvas opens in its natural view.
  useEffect(() => {
    setRightPaneMode('auto');
  }, [selectedNode?.id]);

  // Listen for `nodeDetailView:open` events emitted by node double-click or
  // the NDV keyboard shortcut. Falling back to the legacy inspector if the
  // event payload lacks a nodeId.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId?: string }>).detail;
      if (detail?.nodeId) setDetailViewNodeId(detail.nodeId);
    };
    window.addEventListener('workflow:openNodeDetail', handler as EventListener);
    return () => window.removeEventListener('workflow:openNodeDetail', handler as EventListener);
  }, []);

  // Drill into a sub-workflow from a SubworkflowNode (V14-4 host wiring).
  // SubworkflowNode dispatches this event on double-click / "Open" button
  // when no explicit `onOpenSubworkflow` data callback is provided.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ workflowId?: string }>).detail;
      if (!detail?.workflowId) return;
      const storeApi = useWorkflowStore.getState();
      void storeApi.loadWorkflow(detail.workflowId);
    };
    window.addEventListener('open-subworkflow', handler as EventListener);
    return () => window.removeEventListener('open-subworkflow', handler as EventListener);
  }, []);

  // Run a partial execution (upstream or downstream) from a node, client-side.
  // Bypasses the API path because the backend doesn't yet expose partial
  // execution endpoints. Uses WorkflowExecutor.executeFromNode /
  // executeUpstream and pipes node-level callbacks back into the store so
  // the canvas / waterfall react in real time.
  const runPartialExecution = useCallback(
    async (nodeId: string, direction: 'upstream' | 'downstream') => {
      const storeApi = useWorkflowStore.getState();
      if (storeApi.isExecuting) return;
      const targetNode = storeApi.nodes.find((n) => n.id === nodeId);
      if (!targetNode) return;

      try {
        storeApi.setIsExecuting(true);
        storeApi.clearNodeStatuses();
        storeApi.addLog({
          level: 'info',
          message: `Running ${direction} from ${targetNode.data?.label || nodeId}…`,
        });

        const { WorkflowExecutor } = await import('../../ExecutionEngine');
        const executor = new WorkflowExecutor(
          storeApi.nodes as never,
          storeApi.edges as never,
          {
            // Wire breakpoint hook: pause this node and await user
            // Continue/Step before running its logic.
            checkBreakpoint: (nodeId: string) => isNodeBreakpointed(nodeId),
            waitForResume: async (nodeId: string) => {
              storeApi.setNodeStatus(nodeId, 'paused');
              await waitForDebugResume();
            },
          }
        );

        const onNodeStart = (id: string) => {
          storeApi.setCurrentExecutingNode(id);
          storeApi.setNodeStatus(id, 'running');
        };
        const onNodeComplete = (id: string, result: { data?: unknown }) => {
          storeApi.setNodeStatus(id, 'success');
          if (result?.data !== undefined) {
            storeApi.setNodeExecutionData(id, { output: result.data });
            storeApi.setExecutionResult(id, result.data);
          }
        };
        const onNodeError = (id: string, error: unknown) => {
          storeApi.setNodeStatus(id, 'error');
          storeApi.setNodeExecutionData(id, { error });
        };

        if (direction === 'downstream') {
          const previous = new Map(
            Object.entries(storeApi.executionResults || {}).map(([id, data]) => [
              id,
              { success: true, data, status: 'success', duration: 0, timestamp: new Date().toISOString() } as never,
            ])
          );
          await executor.executeFromNode(nodeId, previous, onNodeStart, onNodeComplete, onNodeError);
        } else {
          await executor.executeUpstream(nodeId, onNodeStart, onNodeComplete, onNodeError);
        }

        storeApi.addLog({
          level: 'success',
          message: `Partial ${direction} run complete.`,
        });
      } catch (err) {
        storeApi.addLog({
          level: 'error',
          message: `Partial ${direction} run failed`,
          data: err instanceof Error ? err.message : String(err),
        });
      } finally {
        storeApi.setIsExecuting(false);
        storeApi.setCurrentExecutingNode(null);
      }
    },
    []
  );

  // Custom Event Listeners for actions from detached components (e.g. CustomNode)
  useEffect(() => {
    const handleExecuteNode = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId: string }>).detail;
      if (detail?.nodeId) executeNode(detail.nodeId);
    };

    const handleOpenPinData = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId: string, nodeName: string }>).detail;
      if (detail?.nodeId) {
        state.setPinDataPanel({ nodeId: detail.nodeId, nodeName: detail.nodeName });
      }
    };

    const handleOpenTestPanel = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId: string }>).detail;
      if (detail?.nodeId) setTestPanelNodeId(detail.nodeId);
    };

    const handleOpenRunDataInspector = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId: string }>).detail;
      if (detail?.nodeId) setInspectorNodeId(detail.nodeId);
    };

    const handleRunUpstream = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId: string }>).detail;
      if (detail?.nodeId) void runPartialExecution(detail.nodeId, 'upstream');
    };

    const handleRunDownstream = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId: string }>).detail;
      if (detail?.nodeId) void runPartialExecution(detail.nodeId, 'downstream');
    };

    // B3#7 — Re-run full workflow from the execution history panel.
    const handleRerunWorkflow = () => {
      void executeWorkflow();
    };

    // Open the workflow Settings drawer (general + notifications)
    const handleOpenSettings = () => setSettingsDrawerOpen(true);

    // Insert-on-edge: store the edge-split context so QuickNodeSearch's
    // onAddNode (in EditorModals) can split the original edge once the
    // user picks a node type, then open the search at the edge midpoint.
    const handleInsertOnEdge = (e: Event) => {
      const detail = (e as CustomEvent<{
        edgeId: string;
        source: string;
        target: string;
        sourceHandle: string | null;
        targetHandle: string | null;
        position: { x: number; y: number };
      }>).detail;
      if (!detail) return;
      try {
        localStorage.setItem('pendingEdgeSplit', JSON.stringify({
          edgeId: detail.edgeId,
          source: detail.source,
          target: detail.target,
          sourceHandle: detail.sourceHandle,
          targetHandle: detail.targetHandle,
        }));
      } catch { /* localStorage may be disabled */ }
      state.setQuickSearchPosition(detail.position);
      state.setQuickSearchOpen(true);
    };

    window.addEventListener('execute-node', handleExecuteNode);
    window.addEventListener('open-pin-data', handleOpenPinData);
    window.addEventListener('open-test-panel', handleOpenTestPanel);
    window.addEventListener('open-run-data-inspector', handleOpenRunDataInspector);
    window.addEventListener('run-upstream', handleRunUpstream);
    window.addEventListener('run-downstream', handleRunDownstream);
    window.addEventListener('rerun-workflow', handleRerunWorkflow);
    window.addEventListener('insert-on-edge', handleInsertOnEdge);
    window.addEventListener('open-workflow-settings', handleOpenSettings);

    return () => {
      window.removeEventListener('execute-node', handleExecuteNode);
      window.removeEventListener('open-pin-data', handleOpenPinData);
      window.removeEventListener('open-test-panel', handleOpenTestPanel);
      window.removeEventListener('open-run-data-inspector', handleOpenRunDataInspector);
      window.removeEventListener('run-upstream', handleRunUpstream);
      window.removeEventListener('run-downstream', handleRunDownstream);
      window.removeEventListener('rerun-workflow', handleRerunWorkflow);
      window.removeEventListener('insert-on-edge', handleInsertOnEdge);
      window.removeEventListener('open-workflow-settings', handleOpenSettings);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executeNode, executeWorkflow, state.setPinDataPanel, state.setQuickSearchOpen, state.setQuickSearchPosition, runPartialExecution]);

  // Events hook (refactored modular version)
  const events = useWorkflowEvents({
    reactFlowWrapper: state.reactFlowWrapper,
    pendingConnectionRef: state.pendingConnectionRef,
    project, fitView, zoomIn, zoomOut, zoomTo,
    getId: state.getId,
    setSnapToGrid: state.setSnapToGrid,
    setShowMiniMap: state.setShowMiniMap,
    setSidebarOpen: state.setSidebarOpen,
    setZoomLevel: state.setZoomLevel,
    useN8nStyle: state.useN8nStyle,
    snapToGrid: state.snapToGrid,
    executeWorkflow,
    performAutoLayout,
    createNodeData: actions.createNodeData,
    deleteSelectedNodes: actions.deleteSelectedNodes,
    duplicateSelectedNodes: actions.duplicateSelectedNodes,
  });

  // Process nodes/edges for rendering
  const selectedNodeIds = useSelectedNodeIds(selectedNodes as unknown as Node[], selectedNode as unknown as Node);
  const processedNodes = useProcessedNodes({ nodes, nodeExecutionStatus, selectedNodeIds, viewMode: state.viewMode });
  const processedEdges = useProcessedEdges({ edges, nodeExecutionStatus, connectionStyle: state.connectionStyle, executionResults: store.executionResults });

  const workflowLastUpdate = useUpdateTimestamp();
  useKeyboardShortcuts(true);

  // ReactFlow v12: Reactive selection sync
  const onSelectionChange = useCallback(({ nodes: selected }: { nodes: Node[] }) => {
    if (selected.length === 1) {
      setSelectedNode(selected[0] as unknown as typeof selectedNode);
      setSelectedNodes([]);
    } else if (selected.length > 1) {
      setSelectedNode(null);
      setSelectedNodes(selected.map(n => n.id));
    } else {
      setSelectedNode(null);
      setSelectedNodes([]);
    }
  }, [setSelectedNode, setSelectedNodes]);
  useOnSelectionChange({ onChange: onSelectionChange });

  // ReactFlow v12: Viewport zoom tracking
  useOnViewportChange({
    onChange: useCallback((viewport: { zoom: number }) => {
      state.setZoomLevel(viewport.zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.setZoomLevel]),
  });

  // ReactFlow v12: fitView once after initial node measurement only.
  // Depending on `nodes.length` would re-fit on every drop — disorienting UX.
  // Use a ref guard so adding/removing nodes later doesn't move the viewport.
  const nodesInitialized = useNodesInitialized();
  const didInitialFitRef = useRef(false);
  useEffect(() => {
    if (nodesInitialized && nodes.length > 0 && !didInitialFitRef.current) {
      didInitialFitRef.current = true;
      fitView({ padding: 0.2, duration: 300 });
    }
  }, [nodesInitialized, fitView, nodes.length]);

  // Auto-show bulk panel when multiple nodes selected
  useEffect(() => {
    state.setBulkPanelOpen(selectedNodes.length > 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodes.length, state.setBulkPanelOpen]);

  // Copy/paste event listeners
  useEffect(() => {
    const handlers = {
      'copy-nodes': actions.handleCopyNodes,
      'paste-nodes': actions.handlePasteNodes,
      'cut-nodes': actions.handleCutNodes,
    };
    Object.entries(handlers).forEach(([event, handler]) => window.addEventListener(event, handler));
    return () => Object.entries(handlers).forEach(([event, handler]) => window.removeEventListener(event, handler));
  }, [actions.handleCopyNodes, actions.handlePasteNodes, actions.handleCutNodes]);

  return (
    <div className={`h-screen w-full flex flex-col ${darkMode ? 'bg-[#1a1a2e]' : 'bg-[#f5f5f5]'}`}>
      {/* Skip to content link for keyboard/screen reader users */}
      <a
        href="#workflow-canvas"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-2 focus:bg-blue-600 focus:text-white focus:rounded"
      >
        Skip to canvas
      </a>

      {/* Top bar - n8n style compact header */}
      <EditorHeader
        onExecute={executeWorkflow}
        onSave={saveWorkflow}
        onExport={exportWorkflow}
        onImport={importWorkflow}
        onDebug={() => state.setStepDebugPanelOpen(true)}
        isExecuting={isExecuting}
      />

      {/* Main content area: sidebar | canvas */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - node picker */}
        <UnifiedSidebar
          showNodePalette
          isExpanded={state.sidebarOpen}
          onExpandedChange={state.setSidebarOpen}
        />

        {/* Canvas area */}
        <div className="flex-1 relative min-w-0 flex flex-col" ref={state.reactFlowWrapper}>
          {/* Floating bulk-action toolbar — visible when 1+ nodes are multi-selected (V14-3) */}
          <CanvasSelectionToolbar darkMode={darkMode} />
          {/* Breadcrumb for sub-workflow navigation (rendered when workflowNavStack is available) */}
          <EditorCanvas
          nodes={processedNodes}
          edges={processedEdges}
          onNodesChange={actions.onNodesChange}
          onEdgesChange={actions.onEdgesChange}
          onConnect={actions.onConnect}
          onNodeClick={events.handleNodeClick}
          onEdgeClick={events.handleEdgeClick}
          onNodeContextMenu={events.handleNodeContextMenu}
          onConnectStart={events.onConnectStart}
          onConnectEnd={events.onConnectEnd}
          onDrop={events.onDrop}
          onDragOver={events.onDragOver}
          onDragLeave={events.onDragLeave}
          dropPreview={events.dropPreview}
          onPaneClick={events.handlePaneClick}
          onDoubleClick={events.handlePaneDoubleClick}
          onMove={events.onMove}
          isValidConnection={actions.isValidConnection}
          darkMode={darkMode}
          snapToGrid={state.snapToGrid}
          showGrid={state.showGrid}
          showAlignmentGuides={state.snapToGrid}
          wrapperRef={state.reactFlowWrapper}
        >
          {state.showMiniMap && (
            <MiniMap
              className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} shadow-xl rounded-lg border`}
              maskColor={darkMode ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)'}
              nodeColor={(node) => {
                const colors: Record<string, string> = { trigger: '#f59e0b', communication: '#3b82f6', database: '#8b5cf6', ai: '#10b981', cloud: '#06b6d4', core: '#6b7280', flow: '#6366f1' };
                return colors[nodeTypes[node.data.type]?.category] || '#6b7280';
              }}
              position="bottom-right"
              style={{ width: 250, height: 150 }}
            />
          )}
          {state.showMetrics && <MetricsPanel nodes={nodes} edges={edges} zoomLevel={state.zoomLevel} darkMode={darkMode} />}
          <StatusIndicator isExecuting={isExecuting} darkMode={darkMode} />
          {isCurrentWorkflowLocked && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg border ${darkMode ? 'bg-amber-900/90 text-amber-200 border-amber-700' : 'bg-amber-100 text-amber-800 border-amber-300'}`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <span className="font-medium">Workflow Locked</span>
                <span className="text-sm opacity-75">- Modifications disabled</span>
              </div>
            </div>
          )}
        </EditorCanvas>

          {nodes.length === 0 && <EmptyState />}
        </div>

        {/* Right panel - split-pane (config + execution) or config-only.
            The user can force the plain config view via rightPaneMode='config'
            so they can re-edit a node after a run without losing the selection. */}
        {selectedNode && (() => {
          const status = nodeExecutionStatus[selectedNode.id];
          const hasRun = !!status && status !== 'idle';
          const showSplit = hasRun && rightPaneMode === 'auto';
          return (
            <div className={`w-[420px] flex-shrink-0 border-l ${darkMode ? 'border-gray-700' : 'border-gray-200'} transition-all duration-300 animate-slideIn flex flex-col`}>
              {hasRun && (
                <div className={`flex items-center justify-end gap-1 px-2 py-1 text-xs border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                  <button
                    type="button"
                    onClick={() => setRightPaneMode('auto')}
                    className={`px-2 py-0.5 rounded ${rightPaneMode === 'auto' ? 'bg-blue-600 text-white' : darkMode ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-600 hover:bg-gray-100'}`}
                  >
                    Run
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightPaneMode('config')}
                    className={`px-2 py-0.5 rounded ${rightPaneMode === 'config' ? 'bg-blue-600 text-white' : darkMode ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-600 hover:bg-gray-100'}`}
                  >
                    Config
                  </button>
                </div>
              )}
              <div className="flex-1 min-h-0">
                {showSplit ? (
                  <SplitPaneExecutionView onClose={() => setSelectedNode(null)} />
                ) : (
                  <NodeConfigPanel onClose={() => setSelectedNode(null)} />
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Execution waterfall timeline - shown during/after execution */}
      {(isExecuting || Object.keys(nodeExecutionStatus).length > 0) && (
        <div className={`border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'} flex-shrink-0`}>
          <ExecutionWaterfall />
        </div>
      )}

      {/* Bottom status bar */}
      <EditorStatusBar
        nodeCount={nodes.length}
        edgeCount={edges.length}
        currentEnvironment={currentEnvironment}
        isLocked={isCurrentWorkflowLocked}
        zoomLevel={state.zoomLevel}
        viewMode={state.viewMode}
        lastUpdate={String(workflowLastUpdate)}
        darkMode={darkMode}
      />

      <EditorModals
        darkMode={darkMode}
        aiBuilderOpen={state.aiBuilderOpen}
        setAiBuilderOpen={state.setAiBuilderOpen}
        visualDesignerOpen={state.visualDesignerOpen}
        setVisualDesignerOpen={state.setVisualDesignerOpen}
        shortcutsModalOpen={state.shortcutsModalOpen}
        setShortcutsModalOpen={state.setShortcutsModalOpen}
        templatesGalleryOpen={state.templatesGalleryOpen}
        setTemplatesGalleryOpen={state.setTemplatesGalleryOpen}
        performanceMonitorOpen={state.performanceMonitorOpen}
        setPerformanceMonitorOpen={state.setPerformanceMonitorOpen}
        n8nImportModalOpen={state.n8nImportModalOpen}
        setN8nImportModalOpen={state.setN8nImportModalOpen}
        commandBarOpen={state.commandBarOpen}
        setCommandBarOpen={state.setCommandBarOpen}
        contextMenu={state.contextMenu}
        setContextMenu={state.setContextMenu}
        quickSearchOpen={state.quickSearchOpen}
        setQuickSearchOpen={state.setQuickSearchOpen}
        quickSearchPosition={state.quickSearchPosition}
        getId={state.getId}
        createNodeData={actions.createNodeData}
        performAutoLayout={performAutoLayout}
      />

      <EditorPanels
        darkMode={darkMode}
        sidebarOpen={state.sidebarOpen}
        setSidebarOpen={state.setSidebarOpen}
        searchTerm={state.searchTerm}
        setSearchTerm={state.setSearchTerm}
        filterCategory={state.filterCategory}
        setFilterCategory={state.setFilterCategory}
        useN8nStyle={state.useN8nStyle}
        configPanelOpen={state.configPanelOpen}
        setConfigPanelOpen={state.setConfigPanelOpen}
        n8nNodePanelOpen={state.n8nNodePanelOpen}
        setN8nNodePanelOpen={state.setN8nNodePanelOpen}
        n8nNodePanelPosition={state.n8nNodePanelPosition}
        focusPanelOpen={state.focusPanelOpen}
        setFocusPanelOpen={state.setFocusPanelOpen}
        focusPanelNode={state.focusPanelNode}
        setFocusPanelNode={state.setFocusPanelNode}
        isExecuting={isExecuting}
        dataPreview={state.dataPreview}
        setDataPreview={state.setDataPreview}
        pinDataPanel={state.pinDataPanel}
        setPinDataPanel={state.setPinDataPanel}
        bulkPanelOpen={state.bulkPanelOpen}
        setBulkPanelOpen={state.setBulkPanelOpen}
        dataPinningPanelOpen={state.dataPinningPanelOpen}
        setDataPinningPanelOpen={state.setDataPinningPanelOpen}
        executionHistoryOpen={state.executionHistoryOpen}
        setExecutionHistoryOpen={state.setExecutionHistoryOpen}
        nodeSearchOpen={state.nodeSearchOpen}
        setNodeSearchOpen={state.setNodeSearchOpen}
        variablesPanelOpen={state.variablesPanelOpen}
        setVariablesPanelOpen={state.setVariablesPanelOpen}
        customNodeCreatorOpen={state.customNodeCreatorOpen}
        setCustomNodeCreatorOpen={state.setCustomNodeCreatorOpen}
        docGeneratorOpen={state.docGeneratorOpen}
        setDocGeneratorOpen={state.setDocGeneratorOpen}
        collaborationOpen={state.collaborationOpen}
        setCollaborationOpen={state.setCollaborationOpen}
        stepDebugPanelOpen={state.stepDebugPanelOpen}
        setStepDebugPanelOpen={state.setStepDebugPanelOpen}
        setHighlightedDebugNode={state.setHighlightedDebugNode}
        zoomLevel={state.zoomLevel}
        viewMode={state.viewMode}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        zoomTo={zoomTo}
        fitView={fitView}
        showGrid={state.showGrid}
        setShowGrid={state.setShowGrid}
        showMiniMap={state.showMiniMap}
        setShowMiniMap={state.setShowMiniMap}
        setShortcutsModalOpen={state.setShortcutsModalOpen}
        handleBulkDelete={actions.handleBulkDelete}
        handleBulkDuplicate={actions.handleBulkDuplicate}
        handleBulkAlign={actions.handleBulkAlign}
        handleBulkDistribute={actions.handleBulkDistribute}
        handleBulkToggleEnabled={actions.handleBulkToggleEnabled}
        getId={state.getId}
        createNodeData={actions.createNodeData}
      />

      {/* Test a single node in isolation (Ctrl+Shift+T or quick-action Play) */}
      {testPanelNodeId && (
        <Suspense fallback={null}>
          <NodeTestPanel
            isOpen
            nodeId={testPanelNodeId}
            onClose={() => setTestPanelNodeId(null)}
          />
        </Suspense>
      )}

      {/* Inspect execution data that transited on an edge (edge click) */}
      {inspectorNodeId && (
        <Suspense fallback={null}>
          <NodeRunDataInspector
            isOpen
            nodeId={inspectorNodeId}
            onClose={() => setInspectorNodeId(null)}
          />
        </Suspense>
      )}

      {/* NDV — n8n-style 3-panel detail view (Input | Params | Output) */}
      {detailViewNodeId && (
        <Suspense fallback={null}>
          <NodeDetailView
            isOpen
            nodeId={detailViewNodeId}
            onClose={() => setDetailViewNodeId(null)}
          />
        </Suspense>
      )}

      {/* Workflow settings drawer (Ctrl+,) — General + Notifications tabs */}
      {settingsDrawerOpen && (
        <Suspense fallback={null}>
          <SettingsDrawer
            isOpen
            darkMode={darkMode}
            onClose={() => setSettingsDrawerOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

/**
 * Public entry point — wraps the inner editor with `EditorPanelProvider`
 * so that every hook in the event chain (usePanels, useClickHandlers,
 * useContextMenu, useWindowEvents, useKeyboardShortcuts, …) can read
 * the panel context. Without this wrapper, `/workflows` would crash
 * immediately on render with "usePanels must be used within an
 * EditorPanelProvider" and fall back to the global error boundary.
 */
function ModernWorkflowEditor() {
  // @xyflow/react v12 requires `useReactFlow()` to be called inside a
  // `<ReactFlowProvider>` — otherwise instance methods like
  // `screenToFlowPosition` are undefined and downstream hooks crash with
  // "project is not a function" on first drag. Wrap once at the top.
  return (
    <ReactFlowProvider>
      <EditorPanelProvider>
        <ModernWorkflowEditorInner />
      </EditorPanelProvider>
    </ReactFlowProvider>
  );
}

export default ModernWorkflowEditor;
