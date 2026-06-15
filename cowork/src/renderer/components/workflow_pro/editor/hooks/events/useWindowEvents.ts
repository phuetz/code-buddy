// @ts-nocheck
/**
 * useWindowEvents
 *
 * Handles custom window events for toggling panels and executing actions.
 * These events are dispatched by other components (command palette, shortcuts, etc.)
 */

import { useEffect, useCallback } from 'react';
import { usePanels } from '../../context';
import { notificationService } from '../../../service-mocks';

export interface UseWindowEventsOptions {
  /** Execute workflow callback */
  executeWorkflow: () => Promise<void>;
  /** Set snap to grid */
  setSnapToGrid: React.Dispatch<React.SetStateAction<boolean>>;
  /** Set show minimap */
  setShowMiniMap: React.Dispatch<React.SetStateAction<boolean>>;
  /** Set sidebar open */
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Event type definitions for custom window events
 */
const PANEL_TOGGLE_EVENTS = [
  { event: 'toggle-data-pinning', panel: 'dataPinning' },
  { event: 'toggle-execution-history', panel: 'executionHistory' },
  { event: 'toggle-node-search', panel: 'nodeSearch' },
  { event: 'toggle-variables', panel: 'variables' },
  { event: 'toggle-custom-nodes', panel: 'customNodeCreator' },
  { event: 'toggle-doc-generator', panel: 'docGenerator' },
  { event: 'toggle-collaboration', panel: 'collaboration' },
  { event: 'toggle-step-debug', panel: 'stepDebug' },
  { event: 'toggle-properties', panel: 'config' },
] as const;

const MODAL_TOGGLE_EVENTS = [
  { event: 'show-shortcuts-modal', modal: 'shortcuts' },
  { event: 'show-templates-gallery', modal: 'templates' },
  { event: 'toggle-performance-monitor', modal: 'performanceMonitor' },
] as const;

/**
 * Hook for handling custom window events
 */
export function useWindowEvents(options: UseWindowEventsOptions): void {
  const { executeWorkflow, setSnapToGrid, setShowMiniMap, setSidebarOpen } = options;

  const { togglePanel, openModal } = usePanels();

  // Panel toggle handlers
  const createPanelToggleHandler = useCallback(
    (panelType: string) => () => togglePanel(panelType as Parameters<typeof togglePanel>[0]),
    [togglePanel]
  );

  // Modal open handlers
  const createModalOpenHandler = useCallback(
    (modalType: string) => () => openModal(modalType as Parameters<typeof openModal>[0]),
    [openModal]
  );

  // Other handlers
  const handleToggleMinimap = useCallback(() => setShowMiniMap((prev) => !prev), [setShowMiniMap]);
  const handleToggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), [setSidebarOpen]);
  const handleOpenQuickSearch = useCallback(() => togglePanel('nodeSearch'), [togglePanel]);
  const handleExecuteWorkflow = useCallback(() => executeWorkflow(), [executeWorkflow]);

  const handleToggleSnapToGrid = useCallback(() => {
    setSnapToGrid((prev) => {
      notificationService.info('Grid', !prev ? 'Snap to grid enabled' : 'Snap to grid disabled');
      return !prev;
    });
  }, [setSnapToGrid]);

  // Copy/Paste/Cut handlers
  const handleCopy = useCallback(() => {
    window.dispatchEvent(new CustomEvent('workflow-copy'));
  }, []);

  const handlePaste = useCallback(() => {
    window.dispatchEvent(new CustomEvent('workflow-paste'));
  }, []);

  const handleCut = useCallback(() => {
    window.dispatchEvent(new CustomEvent('workflow-cut'));
  }, []);

  useEffect(() => {
    // Panel toggle event listeners
    const panelHandlers = PANEL_TOGGLE_EVENTS.map(({ event, panel }) => ({
      event,
      handler: createPanelToggleHandler(panel),
    }));

    // Modal open event listeners
    const modalHandlers = MODAL_TOGGLE_EVENTS.map(({ event, modal }) => ({
      event,
      handler: createModalOpenHandler(modal),
    }));

    // Register all listeners
    panelHandlers.forEach(({ event, handler }) => {
      window.addEventListener(event, handler);
    });

    modalHandlers.forEach(({ event, handler }) => {
      window.addEventListener(event, handler);
    });

    // Other listeners
    window.addEventListener('toggle-minimap', handleToggleMinimap);
    window.addEventListener('toggle-sidebar', handleToggleSidebar);
    window.addEventListener('open-quick-search', handleOpenQuickSearch);
    window.addEventListener('execute-workflow', handleExecuteWorkflow);
    window.addEventListener('toggle-snap-to-grid', handleToggleSnapToGrid);
    window.addEventListener('copy-nodes', handleCopy);
    window.addEventListener('paste-nodes', handlePaste);
    window.addEventListener('cut-nodes', handleCut);

    // Cleanup
    return () => {
      panelHandlers.forEach(({ event, handler }) => {
        window.removeEventListener(event, handler);
      });

      modalHandlers.forEach(({ event, handler }) => {
        window.removeEventListener(event, handler);
      });

      window.removeEventListener('toggle-minimap', handleToggleMinimap);
      window.removeEventListener('toggle-sidebar', handleToggleSidebar);
      window.removeEventListener('open-quick-search', handleOpenQuickSearch);
      window.removeEventListener('execute-workflow', handleExecuteWorkflow);
      window.removeEventListener('toggle-snap-to-grid', handleToggleSnapToGrid);
      window.removeEventListener('copy-nodes', handleCopy);
      window.removeEventListener('paste-nodes', handlePaste);
      window.removeEventListener('cut-nodes', handleCut);
    };
  }, [
    createPanelToggleHandler,
    createModalOpenHandler,
    handleToggleMinimap,
    handleToggleSidebar,
    handleOpenQuickSearch,
    handleExecuteWorkflow,
    handleToggleSnapToGrid,
    handleCopy,
    handlePaste,
    handleCut,
  ]);
}

export default useWindowEvents;
