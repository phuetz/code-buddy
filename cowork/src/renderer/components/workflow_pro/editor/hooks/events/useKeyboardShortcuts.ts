// @ts-nocheck
/**
 * useKeyboardShortcuts
 *
 * Handles global keyboard shortcuts for the workflow editor.
 *
 * Shortcuts:
 * - Ctrl+S: Save workflow
 * - Ctrl+D: Duplicate selected nodes
 * - Ctrl+F: Fit view
 * - Ctrl+A: Select all nodes
 * - Ctrl++: Zoom in
 * - Ctrl+-: Zoom out
 * - Ctrl+0: Reset zoom
 * - Ctrl+L: Auto layout
 * - Ctrl+K: Open command bar
 * - Ctrl+E: Execute workflow
 * - Ctrl+N: Open quick search
 * - Ctrl+G: Toggle snap to grid
 * - Ctrl+M: Toggle minimap
 * - Delete/Backspace: Delete selected
 * - Escape: Deselect and close panels
 * - Tab: Open node panel
 */

import { useEffect, useCallback } from 'react';
import { useWorkflowStore } from '../../../store';
import { usePanels } from '../../context';
import { notificationService } from '../../../service-mocks';

export interface UseKeyboardShortcutsOptions {
  /** ReactFlow functions */
  fitView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomTo: (zoom: number) => void;
  /** Editor actions */
  executeWorkflow: () => Promise<void>;
  performAutoLayout: () => void;
  deleteSelectedNodes: () => void;
  duplicateSelectedNodes: () => void;
  /** Whether to use n8n-style UI */
  useN8nStyle: boolean;
  /** Current snap to grid setting */
  snapToGrid: boolean;
  /** Set snap to grid */
  setSnapToGrid: React.Dispatch<React.SetStateAction<boolean>>;
  /** Set show minimap */
  setShowMiniMap: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Hook for handling keyboard shortcuts
 */
export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  const {
    fitView,
    zoomIn,
    zoomOut,
    zoomTo,
    executeWorkflow,
    performAutoLayout,
    deleteSelectedNodes,
    duplicateSelectedNodes,
    useN8nStyle,
    setSnapToGrid,
    setShowMiniMap,
  } = options;

  // Store actions
  const saveWorkflow = useWorkflowStore((state) => state.saveWorkflow);
  const setSelectedNode = useWorkflowStore((state) => state.setSelectedNode);
  const setSelectedNodes = useWorkflowStore((state) => state.setSelectedNodes);
  const setSelectedEdge = useWorkflowStore((state) => state.setSelectedEdge);

  // Panel context
  const { openPanel, openModal, closePanel, closeModal } = usePanels();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Handle Ctrl/Cmd shortcuts
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
            openModal('commandBar');
            break;

          case 'e':
            e.preventDefault();
            executeWorkflow();
            break;

          case 'n':
            e.preventDefault();
            openPanel('nodeSearch');
            break;

          case 'g':
            e.preventDefault();
            setSnapToGrid((prev) => {
              notificationService.info('Grid', !prev ? 'Snap to grid enabled' : 'Snap to grid disabled');
              return !prev;
            });
            break;

          case 'm':
            e.preventDefault();
            setShowMiniMap((prev) => !prev);
            break;

          case 'a': {
            e.preventDefault();
            const allNodeIds = useWorkflowStore.getState().nodes.map((n) => n.id);
            setSelectedNodes(allNodeIds);
            notificationService.info('Selection', `${allNodeIds.length} nodes selected`);
            break;
            }
        }
      }

      // Delete/Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const isLocked = useWorkflowStore.getState().isCurrentWorkflowLocked;
        if (isLocked) {
          notificationService.warning('Workflow Locked', 'This workflow is locked. Unlock to delete nodes.');
          return;
        }
        deleteSelectedNodes();
      }

      // Escape - close all
      if (e.key === 'Escape') {
        setSelectedNode(null);
        setSelectedNodes([]);
        setSelectedEdge(null);
        closePanel('config');
        closePanel('nodeSearch');
        closeModal('commandBar');
      }

      // Tab - open node panel
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
          e.preventDefault();
          if (useN8nStyle) {
            openPanel('n8nNode');
          } else {
            openPanel('nodeSearch');
          }
        }
      }
    },
    [
      saveWorkflow,
      duplicateSelectedNodes,
      fitView,
      zoomIn,
      zoomOut,
      zoomTo,
      performAutoLayout,
      executeWorkflow,
      deleteSelectedNodes,
      useN8nStyle,
      setSelectedNode,
      setSelectedNodes,
      setSelectedEdge,
      setSnapToGrid,
      setShowMiniMap,
      openPanel,
      openModal,
      closePanel,
      closeModal,
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

export default useKeyboardShortcuts;
