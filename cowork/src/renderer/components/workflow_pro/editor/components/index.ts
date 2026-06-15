// @ts-nocheck
/**
 * Editor Components
 * Barrel export for all editor sub-components
 *
 * These components are extracted from ModernWorkflowEditor for better
 * maintainability and reusability.
 */

// Canvas - Main ReactFlow wrapper
export { EditorCanvas } from './EditorCanvas';
export type { EditorCanvasProps } from './EditorCanvas';

// Toolbar - Action buttons
export { EditorToolbar } from './EditorToolbar';
export type { EditorToolbarProps } from './EditorToolbar';

// Sidebar - Node configuration panel
export { EditorSidebar } from './EditorSidebar';
export type { EditorSidebarProps } from './EditorSidebar';

// Minimap - Bird's eye view with custom styling
export { EditorMinimap, EditorMinimapLegend } from './EditorMinimap';
export type { EditorMinimapProps, EditorMinimapLegendProps } from './EditorMinimap';

// Header - Top bar with title, save, execute buttons
export { EditorHeader } from './EditorHeader';
export type { EditorHeaderProps, ViewMode, ConnectionStyleType } from './EditorHeader';

// StatusBar - Bottom status bar
export { EditorStatusBar } from './EditorStatusBar';
export type { EditorStatusBarProps } from './EditorStatusBar';

// Modals - All modal components (AI Builder, Templates, etc.)
export { EditorModals } from './EditorModals';
export type {
  EditorModalsProps,
  ContextMenuState,
  QuickSearchPosition,
} from './EditorModals';

// Panels - Side panels (Config, Focus, Bulk ops, etc.)
// Original version (prop-based state management)
export { EditorPanels } from './EditorPanels';
export type {
  EditorPanelsProps,
  DataPreviewState,
  PinDataPanelState,
  N8nNodePanelPosition,
} from './EditorPanels';

// Refactored version (context-based state management)
export { EditorPanels as EditorPanelsRefactored } from './EditorPanelsRefactored';
export type { EditorPanelsProps as EditorPanelsRefactoredProps } from './EditorPanelsRefactored';
