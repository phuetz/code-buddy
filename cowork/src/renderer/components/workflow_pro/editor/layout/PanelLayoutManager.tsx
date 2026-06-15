// @ts-nocheck
/**
 * PanelLayoutManager
 *
 * Manages the layout and positioning of editor panels.
 * Handles panel priorities, responsive behavior, and prevents overlaps.
 *
 * Panel positions:
 * - left: Left side panels (e.g., sidebar)
 * - right: Right side panels (e.g., config, focus)
 * - top: Top panels (rarely used)
 * - bottom: Bottom panels (e.g., bulk operations)
 * - center: Center modals (overlays)
 */

import React, { useMemo, ReactNode, CSSProperties } from 'react';
import { usePanels, type PanelType } from '../context';

// ============================================================================
// Types
// ============================================================================

export type PanelPosition = 'left' | 'right' | 'top' | 'bottom' | 'center';

export interface PanelConfig {
  position: PanelPosition;
  priority: number;
  width?: number;
  height?: number;
  minWidth?: number;
  maxWidth?: number;
  resizable?: boolean;
  type?: 'panel' | 'modal';
}

// ============================================================================
// Panel Configuration
// ============================================================================

// eslint-disable-next-line react-refresh/only-export-components
export const PANEL_CONFIG: Record<PanelType, PanelConfig> = {
  // Right panels (ordered by priority, highest = on top)
  config: { position: 'right', priority: 10, width: 384, minWidth: 320, resizable: true },
  focus: { position: 'right', priority: 20, width: 420, minWidth: 360, resizable: true },
  dataPinning: { position: 'right', priority: 15, width: 360, minWidth: 300 },
  executionHistory: { position: 'right', priority: 12, width: 420, minWidth: 360 },
  nodeSearch: { position: 'left', priority: 25, width: 320, minWidth: 280 },
  variables: { position: 'right', priority: 14, width: 380, minWidth: 320 },
  customNodeCreator: { position: 'center', priority: 22, width: 520, type: 'modal' },
  docGenerator: { position: 'right', priority: 13, width: 480, minWidth: 400 },
  collaboration: { position: 'right', priority: 8, width: 300, minWidth: 260 },
  stepDebug: { position: 'right', priority: 18, width: 420, minWidth: 360 },

  // Center panels (modals)
  n8nNode: { position: 'center', priority: 30, width: 420, type: 'modal' },

  // Bottom panels
  bulk: { position: 'bottom', priority: 5, height: 60 },
};

// ============================================================================
// Layout Calculation
// ============================================================================

interface LayoutInfo {
  left: Array<{ id: PanelType; config: PanelConfig }>;
  right: Array<{ id: PanelType; config: PanelConfig }>;
  top: Array<{ id: PanelType; config: PanelConfig }>;
  bottom: Array<{ id: PanelType; config: PanelConfig }>;
  center: Array<{ id: PanelType; config: PanelConfig }>;
}

function calculateLayout(openPanels: Set<PanelType>): LayoutInfo {
  const layout: LayoutInfo = {
    left: [],
    right: [],
    top: [],
    bottom: [],
    center: [],
  };

  openPanels.forEach((panelId) => {
    const config = PANEL_CONFIG[panelId];
    if (config) {
      layout[config.position].push({ id: panelId, config });
    }
  });

  // Sort by priority (highest first)
  Object.values(layout).forEach((panels) => {
    panels.sort((a, b) => b.config.priority - a.config.priority);
  });

  return layout;
}

// ============================================================================
// Canvas Style Calculation
// ============================================================================

interface CanvasMargins {
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
}

function calculateCanvasMargins(layout: LayoutInfo): CanvasMargins {
  // Only account for the highest priority panel on each side
  const leftPanel = layout.left[0];
  const rightPanel = layout.right[0];
  const topPanel = layout.top[0];
  const bottomPanel = layout.bottom[0];

  return {
    marginLeft: leftPanel?.config.width || 0,
    marginRight: rightPanel?.config.width || 0,
    marginTop: topPanel?.config.height || 0,
    marginBottom: bottomPanel?.config.height || 0,
  };
}

// ============================================================================
// Panel Slot Components
// ============================================================================

interface PanelSlotProps {
  children: ReactNode;
  position: PanelPosition;
  width?: number;
  height?: number;
  zIndex?: number;
  className?: string;
}

export const PanelSlot: React.FC<PanelSlotProps> = ({
  children,
  position,
  width,
  height,
  zIndex = 200,
  className = '',
}) => {
  const baseStyles: CSSProperties = {
    position: 'fixed',
    zIndex,
  };

  const positionStyles: Record<PanelPosition, CSSProperties> = {
    left: {
      ...baseStyles,
      top: 56, // Header height
      left: 0,
      bottom: 32, // Status bar height
      width: width || 320,
    },
    right: {
      ...baseStyles,
      top: 56, // Header height
      right: 0,
      bottom: 32, // Status bar height
      width: width || 384,
    },
    top: {
      ...baseStyles,
      top: 56, // Header height
      left: 0,
      right: 0,
      height: height || 48,
    },
    bottom: {
      ...baseStyles,
      bottom: 32, // Status bar height
      left: 0,
      right: 0,
      height: height || 60,
    },
    center: {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 410,
    },
  };

  return (
    <div style={positionStyles[position]} className={className}>
      {children}
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

interface PanelLayoutManagerProps {
  children: ReactNode;
  className?: string;
}

/**
 * PanelLayoutManager
 *
 * Wraps the main canvas and manages panel layout.
 * Automatically adjusts canvas margins based on open panels.
 *
 * @example
 * <PanelLayoutManager>
 *   <EditorCanvas />
 * </PanelLayoutManager>
 */
export const PanelLayoutManager: React.FC<PanelLayoutManagerProps> = ({
  children,
  className = '',
}) => {
  const { state } = usePanels();

  // Calculate layout
  const layout = useMemo(
    () => calculateLayout(state.openPanels),
    [state.openPanels]
  );

  // Calculate canvas margins
  const margins = useMemo(() => calculateCanvasMargins(layout), [layout]);

  // Canvas style with dynamic margins
  const canvasStyle: CSSProperties = useMemo(
    () => ({
      marginLeft: margins.marginLeft,
      marginRight: margins.marginRight,
      marginTop: margins.marginTop,
      marginBottom: margins.marginBottom,
      transition: 'margin 200ms ease-out',
    }),
    [margins]
  );

  return (
    <div className={`relative h-full w-full ${className}`}>
      {/* Main canvas area with dynamic margins */}
      <div style={canvasStyle} className="h-full">
        {children}
      </div>
    </div>
  );
};

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Hook to get the current layout configuration
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useLayout(): LayoutInfo {
  const { state } = usePanels();
  return useMemo(() => calculateLayout(state.openPanels), [state.openPanels]);
}

/**
 * Hook to get canvas margins based on open panels
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useCanvasMargins(): CanvasMargins {
  const layout = useLayout();
  return useMemo(() => calculateCanvasMargins(layout), [layout]);
}

/**
 * Hook to check if there's an active right panel
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useHasRightPanel(): boolean {
  const layout = useLayout();
  return layout.right.length > 0;
}

/**
 * Hook to check if there's an active left panel
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useHasLeftPanel(): boolean {
  const layout = useLayout();
  return layout.left.length > 0;
}

export default PanelLayoutManager;
