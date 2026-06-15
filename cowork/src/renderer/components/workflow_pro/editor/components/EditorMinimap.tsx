// @ts-nocheck
/**
 * EditorMinimap Component
 * Customized MiniMap wrapper for ReactFlow with design system styles
 */

import React, { useCallback, useMemo } from 'react';
import { MiniMap, Node } from '@xyflow/react';
import { nodeTypes } from '../../data-mocks';
import { categoryColors } from '../config/editorConfig';

export interface EditorMinimapProps {
  /** Whether the minimap is visible */
  isVisible?: boolean;
  /** Whether dark mode is enabled */
  darkMode?: boolean;
  /** Position of the minimap */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Width of the minimap */
  width?: number;
  /** Height of the minimap */
  height?: number;
  /** Custom node color function override */
  nodeColorOverride?: (node: Node) => string;
  /** Additional CSS classes */
  className?: string;
  /** Whether to show node stroke */
  nodeStrokeWidth?: number;
  /** Border radius for nodes in minimap */
  nodeBorderRadius?: number;
  /** Whether minimap is pannable */
  pannable?: boolean;
  /** Whether minimap is zoomable */
  zoomable?: boolean;
  /** Callback when minimap viewport changes */
  onViewportChange?: () => void;
}

/**
 * Default color map for node categories
 */
const defaultCategoryColors: Record<string, string> = {
  trigger: '#f59e0b',
  communication: '#3b82f6',
  database: '#8b5cf6',
  ai: '#10b981',
  cloud: '#06b6d4',
  core: '#6b7280',
  flow: '#6366f1',
  microsoft: '#0078d4',
  google: '#4285f4',
  ecommerce: '#ec4899',
  marketing: '#f59e0b',
  analytics: '#10b981',
  crm: '#8b5cf6',
  devops: '#ef4444',
  support: '#06b6d4',
  data: '#8b5cf6',
  transform: '#6366f1',
  action: '#3b82f6',
  condition: '#f59e0b',
  default: '#6b7280',
};

/**
 * EditorMinimap - Customized MiniMap for the workflow editor
 *
 * Provides a bird's eye view of the entire workflow with node coloring
 * based on category types. Supports dark mode and custom styling.
 */
export const EditorMinimap: React.FC<EditorMinimapProps> = ({
  isVisible = true,
  darkMode = false,
  position = 'bottom-right',
  width = 250,
  height = 150,
  nodeColorOverride,
  className = '',
  nodeStrokeWidth = 0,
  nodeBorderRadius = 2,
  pannable = true,
  zoomable = true,
  _onViewportChange,
}) => {
  /**
   * Get color for a node based on its type/category
   */
  const getNodeColor = useCallback(
    (node: Node): string => {
      // Use override if provided
      if (nodeColorOverride) {
        return nodeColorOverride(node);
      }

      // Get node type configuration
      const nodeType = node.data?.type;
      const nodeConfig = nodeType ? nodeTypes[nodeType] : null;
      const category = nodeConfig?.category || 'default';

      // Use category colors from config, fallback to defaults
      return (
        categoryColors[category] ||
        defaultCategoryColors[category] ||
        defaultCategoryColors.default
      );
    },
    [nodeColorOverride]
  );

  /**
   * Get mask color based on dark mode
   */
  const maskColor = useMemo(() => {
    return darkMode ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)';
  }, [darkMode]);

  /**
   * Container classes based on dark mode and position
   */
  const containerClasses = useMemo(() => {
    const baseClasses = `
      shadow-xl rounded-lg border transition-colors duration-300
      ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}
    `;

    return `${baseClasses} ${className}`.trim();
  }, [darkMode, className]);

  if (!isVisible) {
    return null;
  }

  return (
    <MiniMap
      className={containerClasses}
      maskColor={maskColor}
      nodeColor={getNodeColor}
      nodeStrokeWidth={nodeStrokeWidth}
      nodeBorderRadius={nodeBorderRadius}
      position={position}
      pannable={pannable}
      zoomable={zoomable}
      style={{
        width,
        height,
      }}
    />
  );
};

/**
 * EditorMinimapLegend - Optional legend component for the minimap
 * Shows category colors and their meanings
 */
export interface EditorMinimapLegendProps {
  /** Categories to show in legend */
  categories?: string[];
  /** Whether dark mode is enabled */
  darkMode?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export const EditorMinimapLegend: React.FC<EditorMinimapLegendProps> = ({
  categories = ['trigger', 'action', 'condition', 'data', 'ai'],
  darkMode = false,
  className = '',
}) => {
  const allColors = { ...defaultCategoryColors, ...categoryColors };

  return (
    <div
      className={`
        flex flex-wrap gap-2 p-2 rounded-lg text-xs
        ${darkMode ? 'bg-gray-800 text-gray-300' : 'bg-white text-gray-700'}
        border ${darkMode ? 'border-gray-700' : 'border-gray-200'}
        shadow-sm
        ${className}
      `}
    >
      {categories.map((category) => (
        <div key={category} className="flex items-center gap-1">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: allColors[category] || allColors.default }}
          />
          <span className="capitalize">{category}</span>
        </div>
      ))}
    </div>
  );
};

export default EditorMinimap;
