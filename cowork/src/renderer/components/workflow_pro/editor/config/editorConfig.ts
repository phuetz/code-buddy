// @ts-nocheck
/**
 * Editor Configuration Constants
 * Extracted from ModernWorkflowEditor for better maintainability
 */

import { MarkerType } from '@xyflow/react';
import CustomNode from '../../ui-mocks';
import { N8NStyleNode } from '../../ui-mocks';
import StickyNoteNode from '../../ui-mocks';
import SubworkflowNode from '../../ui-mocks';
import {
  N8NStyleEdge,
  ErrorBranchEdge,
  ConditionalEdge,
} from '../../../edges/N8NStyleEdge';

// Node types map for ReactFlow
export const nodeTypesMap = {
  custom: CustomNode,
  n8n: N8NStyleNode,
  'n8n-node': N8NStyleNode,
  stickyNote: StickyNoteNode,
  subworkflow: SubworkflowNode, // V18-3: V14-4 wired into editor registry
};

// N8N-style edge types
export const n8nEdgeTypes = {
  default: N8NStyleEdge,
  n8n: N8NStyleEdge,
  error: ErrorBranchEdge,
  conditional: ConditionalEdge,
};

// Connection line style during drag (n8n-style: thicker, coral accent)
export const connectionLineStyle = {
  stroke: 'var(--n8n-color-primary, #ff6d5a)',
  strokeWidth: 2.5,
  strokeDasharray: '6,4',
};

// Default edge options (n8n-style: thicker lines, subtle color)
export const defaultEdgeOptions = {
  style: { strokeWidth: 2.5, stroke: '#94a3b8' },
  markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8', width: 18, height: 18 },
  animated: false,
};

// View mode scale configuration
export const scaleConfig = {
  compact: 0.8,
  detailed: 1.2,
  normal: 1,
} as const;

// Edge style map for different states (n8n-style: thicker, more prominent)
export const edgeStyleMap = {
  default: { stroke: '#94a3b8', strokeWidth: 2.5, color: '#94a3b8', animated: false },
  running: { stroke: '#3b82f6', strokeWidth: 4, color: '#3b82f6', animated: true },
  success: { stroke: '#10b981', strokeWidth: 3, color: '#10b981', animated: false },
  error: { stroke: '#ef4444', strokeWidth: 3, color: '#ef4444', animated: false },
} as const;

// Default marker end configuration
export const defaultMarkerEnd = {
  type: MarkerType.ArrowClosed,
  width: 16,
  height: 16,
};

// Grid configuration (n8n uses GRID_SIZE = 16px)
export const gridConfig = {
  size: 16,
  snapGrid: [16, 16] as [number, number],
};

// Category colors for MiniMap
export const categoryColors: Record<string, string> = {
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
};

export type ViewMode = 'normal' | 'compact' | 'detailed';
export type ConnectionStyle = 'bezier' | 'straight' | 'smoothstep';
