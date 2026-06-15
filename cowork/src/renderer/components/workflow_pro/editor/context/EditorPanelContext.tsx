/**
 * EditorPanelContext
 *
 * Centralized state management for editor panels and modals.
 * Eliminates prop drilling by providing context-based access to panel state.
 *
 * Usage:
 * - Wrap editor with <EditorPanelProvider>
 * - Use usePanels() hook in any child component
 * - Call openPanel('config'), closePanel('config'), togglePanel('config')
 * - Check isPanelOpen('config'), isModalOpen('shortcuts')
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import type { WorkflowNode } from '../../type-mocks';

// ============================================================================
// Types
// ============================================================================

/** Panel types - side panels that slide in/out */
export type PanelType =
  | 'config'
  | 'focus'
  | 'n8nNode'
  | 'bulk'
  | 'dataPinning'
  | 'executionHistory'
  | 'nodeSearch'
  | 'variables'
  | 'customNodeCreator'
  | 'docGenerator'
  | 'collaboration'
  | 'stepDebug';

/** Modal types - overlay dialogs */
export type ModalType =
  | 'aiBuilder'
  | 'visualDesigner'
  | 'shortcuts'
  | 'templates'
  | 'performanceMonitor'
  | 'n8nImport'
  | 'commandBar'
  | 'quickSearch'
  | 'contextMenu';

/** Context menu position */
export interface ContextMenuState {
  nodeId: string;
  x: number;
  y: number;
}

/** Quick search position */
export interface QuickSearchPosition {
  x: number;
  y: number;
}

/** Panel state */
export interface PanelState {
  openPanels: Set<PanelType>;
  openModals: Set<ModalType>;
  contextMenu: ContextMenuState | null;
  quickSearchPosition: QuickSearchPosition | null;
  focusPanelNode: WorkflowNode | null;
  n8nNodePanelPosition: { x: number; y: number } | null;
  dataPreview: { nodeId: string; x: number; y: number } | null;
  pinDataPanel: { nodeId: string; nodeName: string } | null;
}

/** Panel actions */
type PanelAction =
  | { type: 'OPEN_PANEL'; panel: PanelType }
  | { type: 'CLOSE_PANEL'; panel: PanelType }
  | { type: 'TOGGLE_PANEL'; panel: PanelType }
  | { type: 'OPEN_MODAL'; modal: ModalType }
  | { type: 'CLOSE_MODAL'; modal: ModalType }
  | { type: 'TOGGLE_MODAL'; modal: ModalType }
  | { type: 'SET_CONTEXT_MENU'; menu: ContextMenuState | null }
  | { type: 'SET_QUICK_SEARCH_POSITION'; position: QuickSearchPosition | null }
  | { type: 'SET_FOCUS_NODE'; node: WorkflowNode | null }
  | { type: 'SET_N8N_NODE_PANEL_POSITION'; position: { x: number; y: number } | null }
  | { type: 'SET_DATA_PREVIEW'; preview: PanelState['dataPreview'] }
  | { type: 'SET_PIN_DATA_PANEL'; panel: PanelState['pinDataPanel'] }
  | { type: 'CLOSE_ALL_PANELS' }
  | { type: 'CLOSE_ALL_MODALS' }
  | { type: 'CLOSE_ALL' };

// ============================================================================
// Initial State
// ============================================================================

const initialState: PanelState = {
  openPanels: new Set(),
  openModals: new Set(),
  contextMenu: null,
  quickSearchPosition: null,
  focusPanelNode: null,
  n8nNodePanelPosition: null,
  dataPreview: null,
  pinDataPanel: null,
};

// ============================================================================
// Reducer
// ============================================================================

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'OPEN_PANEL': {
      const newPanels = new Set(state.openPanels);
      newPanels.add(action.panel);
      return { ...state, openPanels: newPanels };
    }

    case 'CLOSE_PANEL': {
      const newPanels = new Set(state.openPanels);
      newPanels.delete(action.panel);
      return { ...state, openPanels: newPanels };
    }

    case 'TOGGLE_PANEL': {
      const newPanels = new Set(state.openPanels);
      if (newPanels.has(action.panel)) {
        newPanels.delete(action.panel);
      } else {
        newPanels.add(action.panel);
      }
      return { ...state, openPanels: newPanels };
    }

    case 'OPEN_MODAL': {
      const newModals = new Set(state.openModals);
      newModals.add(action.modal);
      return { ...state, openModals: newModals };
    }

    case 'CLOSE_MODAL': {
      const newModals = new Set(state.openModals);
      newModals.delete(action.modal);
      return { ...state, openModals: newModals };
    }

    case 'TOGGLE_MODAL': {
      const newModals = new Set(state.openModals);
      if (newModals.has(action.modal)) {
        newModals.delete(action.modal);
      } else {
        newModals.add(action.modal);
      }
      return { ...state, openModals: newModals };
    }

    case 'SET_CONTEXT_MENU':
      return { ...state, contextMenu: action.menu };

    case 'SET_QUICK_SEARCH_POSITION':
      return { ...state, quickSearchPosition: action.position };

    case 'SET_FOCUS_NODE':
      return { ...state, focusPanelNode: action.node };

    case 'SET_N8N_NODE_PANEL_POSITION':
      return { ...state, n8nNodePanelPosition: action.position };

    case 'SET_DATA_PREVIEW':
      return { ...state, dataPreview: action.preview };

    case 'SET_PIN_DATA_PANEL':
      return { ...state, pinDataPanel: action.panel };

    case 'CLOSE_ALL_PANELS':
      return { ...state, openPanels: new Set() };

    case 'CLOSE_ALL_MODALS':
      return {
        ...state,
        openModals: new Set(),
        contextMenu: null,
        quickSearchPosition: null,
      };

    case 'CLOSE_ALL':
      return {
        ...state,
        openPanels: new Set(),
        openModals: new Set(),
        contextMenu: null,
        quickSearchPosition: null,
      };

    default:
      return state;
  }
}

// ============================================================================
// Context
// ============================================================================

export interface EditorPanelContextValue {
  state: PanelState;

  // Panel operations
  openPanel: (panel: PanelType) => void;
  closePanel: (panel: PanelType) => void;
  togglePanel: (panel: PanelType) => void;
  isPanelOpen: (panel: PanelType) => boolean;
  closeAllPanels: () => void;

  // Modal operations
  openModal: (modal: ModalType) => void;
  closeModal: (modal: ModalType) => void;
  toggleModal: (modal: ModalType) => void;
  isModalOpen: (modal: ModalType) => boolean;
  closeAllModals: () => void;

  // Context menu
  showContextMenu: (menu: ContextMenuState) => void;
  hideContextMenu: () => void;

  // Quick search
  showQuickSearch: (position: QuickSearchPosition) => void;
  hideQuickSearch: () => void;

  // Focus panel
  setFocusPanelNode: (node: WorkflowNode | null) => void;
  openFocusPanel: (node: WorkflowNode) => void;
  closeFocusPanel: () => void;

  // N8N Node panel
  setN8nNodePanelPosition: (position: { x: number; y: number } | null) => void;
  openN8nNodePanel: (position?: { x: number; y: number }) => void;
  closeN8nNodePanel: () => void;

  // Data preview
  setDataPreview: (preview: PanelState['dataPreview']) => void;

  // Pin data panel
  setPinDataPanel: (panel: PanelState['pinDataPanel']) => void;

  // Close all
  closeAll: () => void;
}

const EditorPanelContext = createContext<EditorPanelContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

export interface EditorPanelProviderProps {
  children: ReactNode;
}

export const EditorPanelProvider: React.FC<EditorPanelProviderProps> = ({
  children,
}) => {
  const [state, dispatch] = useReducer(panelReducer, initialState);

  // Panel operations
  const openPanel = useCallback((panel: PanelType) => {
    dispatch({ type: 'OPEN_PANEL', panel });
  }, []);

  const closePanel = useCallback((panel: PanelType) => {
    dispatch({ type: 'CLOSE_PANEL', panel });
  }, []);

  const togglePanel = useCallback((panel: PanelType) => {
    dispatch({ type: 'TOGGLE_PANEL', panel });
  }, []);

  const isPanelOpen = useCallback(
    (panel: PanelType) => state.openPanels.has(panel),
    [state.openPanels]
  );

  const closeAllPanels = useCallback(() => {
    dispatch({ type: 'CLOSE_ALL_PANELS' });
  }, []);

  // Modal operations
  const openModal = useCallback((modal: ModalType) => {
    dispatch({ type: 'OPEN_MODAL', modal });
  }, []);

  const closeModal = useCallback((modal: ModalType) => {
    dispatch({ type: 'CLOSE_MODAL', modal });
  }, []);

  const toggleModal = useCallback((modal: ModalType) => {
    dispatch({ type: 'TOGGLE_MODAL', modal });
  }, []);

  const isModalOpen = useCallback(
    (modal: ModalType) => state.openModals.has(modal),
    [state.openModals]
  );

  const closeAllModals = useCallback(() => {
    dispatch({ type: 'CLOSE_ALL_MODALS' });
  }, []);

  // Context menu
  const showContextMenu = useCallback((menu: ContextMenuState) => {
    dispatch({ type: 'SET_CONTEXT_MENU', menu });
  }, []);

  const hideContextMenu = useCallback(() => {
    dispatch({ type: 'SET_CONTEXT_MENU', menu: null });
  }, []);

  // Quick search
  const showQuickSearch = useCallback((position: QuickSearchPosition) => {
    dispatch({ type: 'SET_QUICK_SEARCH_POSITION', position });
    dispatch({ type: 'OPEN_MODAL', modal: 'quickSearch' });
  }, []);

  const hideQuickSearch = useCallback(() => {
    dispatch({ type: 'SET_QUICK_SEARCH_POSITION', position: null });
    dispatch({ type: 'CLOSE_MODAL', modal: 'quickSearch' });
  }, []);

  // Focus panel
  const setFocusPanelNode = useCallback((node: WorkflowNode | null) => {
    dispatch({ type: 'SET_FOCUS_NODE', node });
  }, []);

  const openFocusPanel = useCallback((node: WorkflowNode) => {
    dispatch({ type: 'SET_FOCUS_NODE', node });
    dispatch({ type: 'OPEN_PANEL', panel: 'focus' });
  }, []);

  const closeFocusPanel = useCallback(() => {
    dispatch({ type: 'SET_FOCUS_NODE', node: null });
    dispatch({ type: 'CLOSE_PANEL', panel: 'focus' });
  }, []);

  // N8N Node panel
  const setN8nNodePanelPosition = useCallback(
    (position: { x: number; y: number } | null) => {
      dispatch({ type: 'SET_N8N_NODE_PANEL_POSITION', position });
    },
    []
  );

  const openN8nNodePanel = useCallback(
    (position?: { x: number; y: number }) => {
      if (position) {
        dispatch({ type: 'SET_N8N_NODE_PANEL_POSITION', position });
      }
      dispatch({ type: 'OPEN_PANEL', panel: 'n8nNode' });
    },
    []
  );

  const closeN8nNodePanel = useCallback(() => {
    dispatch({ type: 'SET_N8N_NODE_PANEL_POSITION', position: null });
    dispatch({ type: 'CLOSE_PANEL', panel: 'n8nNode' });
  }, []);

  // Data preview
  const setDataPreview = useCallback((preview: PanelState['dataPreview']) => {
    dispatch({ type: 'SET_DATA_PREVIEW', preview });
  }, []);

  // Pin data panel
  const setPinDataPanel = useCallback((panel: PanelState['pinDataPanel']) => {
    dispatch({ type: 'SET_PIN_DATA_PANEL', panel });
  }, []);

  // Close all
  const closeAll = useCallback(() => {
    dispatch({ type: 'CLOSE_ALL' });
  }, []);

  // Memoize context value
  const value = useMemo<EditorPanelContextValue>(
    () => ({
      state,
      openPanel,
      closePanel,
      togglePanel,
      isPanelOpen,
      closeAllPanels,
      openModal,
      closeModal,
      toggleModal,
      isModalOpen,
      closeAllModals,
      showContextMenu,
      hideContextMenu,
      showQuickSearch,
      hideQuickSearch,
      setFocusPanelNode,
      openFocusPanel,
      closeFocusPanel,
      setN8nNodePanelPosition,
      openN8nNodePanel,
      closeN8nNodePanel,
      setDataPreview,
      setPinDataPanel,
      closeAll,
    }),
    [
      state,
      openPanel,
      closePanel,
      togglePanel,
      isPanelOpen,
      closeAllPanels,
      openModal,
      closeModal,
      toggleModal,
      isModalOpen,
      closeAllModals,
      showContextMenu,
      hideContextMenu,
      showQuickSearch,
      hideQuickSearch,
      setFocusPanelNode,
      openFocusPanel,
      closeFocusPanel,
      setN8nNodePanelPosition,
      openN8nNodePanel,
      closeN8nNodePanel,
      setDataPreview,
      setPinDataPanel,
      closeAll,
    ]
  );

  return (
    <EditorPanelContext.Provider value={value}>
      {children}
    </EditorPanelContext.Provider>
  );
};

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access editor panel context
 *
 * @example
 * const { openPanel, isPanelOpen, closeAll } = usePanels();
 *
 * // Open config panel
 * openPanel('config');
 *
 * // Check if panel is open
 * if (isPanelOpen('config')) { ... }
 *
 * // Close all panels and modals
 * closeAll();
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePanels(): EditorPanelContextValue {
  const context = useContext(EditorPanelContext);

  if (!context) {
    throw new Error('usePanels must be used within an EditorPanelProvider');
  }

  return context;
}

/**
 * Hook to check if a specific panel is open
 * More performant than usePanels when you only need to check one panel
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useIsPanelOpen(panel: PanelType): boolean {
  const { isPanelOpen } = usePanels();
  return isPanelOpen(panel);
}

/**
 * Hook to check if a specific modal is open
 * More performant than usePanels when you only need to check one modal
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useIsModalOpen(modal: ModalType): boolean {
  const { isModalOpen } = usePanels();
  return isModalOpen(modal);
}

export default EditorPanelContext;
