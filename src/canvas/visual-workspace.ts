/**
 * Visual Workspace
 *
 * Extended canvas system for creating rich visual workspaces with
 * elements like diagrams, charts, code blocks, and images.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Visual element types
 */
export type VisualElementType =
  | 'text'
  | 'code'
  | 'image'
  | 'chart'
  | 'diagram'
  | 'markdown'
  | 'table'
  | 'shape'
  | 'connection';

/**
 * Position in the workspace
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * Size of an element
 */
export interface Size {
  width: number;
  height: number;
}

/**
 * Element style options
 */
export interface VisualElementStyle {
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none';
  borderRadius?: number;
  opacity?: number;
  shadow?: boolean;
  fontSize?: number;
  fontColor?: string;
  fontFamily?: string;
  textAlign?: 'left' | 'center' | 'right';
  padding?: number;
}

/**
 * Base visual element
 */
export interface VisualElement {
  id: string;
  type: VisualElementType;
  position: Position;
  size: Size;
  zIndex: number;
  locked: boolean;
  visible: boolean;
  label?: string;
  style?: VisualElementStyle;
  content: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Text element content
 */
export interface TextContent {
  text: string;
  rich?: boolean;
}

/**
 * Code element content
 */
export interface CodeContent {
  code: string;
  language: string;
  showLineNumbers?: boolean;
  highlightLines?: number[];
}

/**
 * Image element content
 */
export interface ImageContent {
  url?: string;
  data?: string;
  alt?: string;
  fit: 'contain' | 'cover' | 'fill' | 'none';
}

/**
 * Chart types
 */
export type ChartType = 'line' | 'bar' | 'pie' | 'scatter' | 'area' | 'radar';

/**
 * Chart element content
 */
export interface ChartContent {
  chartType: ChartType;
  data: {
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
      color?: string;
    }>;
  };
  options?: {
    title?: string;
    showLegend?: boolean;
    showGrid?: boolean;
    animation?: boolean;
  };
}

/**
 * Diagram types
 */
export type DiagramType = 'flowchart' | 'sequence' | 'class' | 'mindmap' | 'gantt' | 'er';

/**
 * Diagram element content
 */
export interface DiagramContent {
  diagramType: DiagramType;
  source: string;
  format: 'mermaid' | 'plantuml' | 'dot';
  rendered?: string;
}

/**
 * Shape types
 */
export type ShapeType = 'rectangle' | 'circle' | 'ellipse' | 'triangle' | 'diamond' | 'arrow';

/**
 * Shape element content
 */
export interface ShapeContent {
  shapeType: ShapeType;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  text?: string;
}

/**
 * Connection element content
 */
export interface ConnectionContent {
  fromElement: string;
  toElement: string;
  fromAnchor?: 'top' | 'right' | 'bottom' | 'left' | 'center';
  toAnchor?: 'top' | 'right' | 'bottom' | 'left' | 'center';
  lineType?: 'straight' | 'curved' | 'orthogonal';
  arrowStart?: boolean;
  arrowEnd?: boolean;
  label?: string;
}

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  name: string;
  width: number;
  height: number;
  backgroundColor: string;
  gridSize: number;
  showGrid: boolean;
  snapToGrid: boolean;
  zoom: number;
  panOffset: Position;
  maxHistory: number;
}

/**
 * Default workspace configuration
 */
export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  name: 'Untitled Workspace',
  width: 1920,
  height: 1080,
  backgroundColor: '#ffffff',
  gridSize: 20,
  showGrid: true,
  snapToGrid: true,
  zoom: 1,
  panOffset: { x: 0, y: 0 },
  maxHistory: 50,
};

/**
 * Visual workspace
 */
export interface VisualWorkspace {
  id: string;
  config: WorkspaceConfig;
  elements: VisualElement[];
  selectedIds: string[];
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/**
 * History entry for undo/redo
 */
export interface WorkspaceHistoryEntry {
  action: 'add' | 'update' | 'delete' | 'move' | 'resize';
  elementIds: string[];
  previousState: Partial<VisualElement>[];
  newState: Partial<VisualElement>[];
  timestamp: Date;
}

// ============================================================================
// Visual Workspace Manager
// ============================================================================

/**
 * Manages visual workspaces
 */
export class VisualWorkspaceManager extends EventEmitter {
  private workspaces: Map<string, VisualWorkspace> = new Map();
  private history: Map<string, WorkspaceHistoryEntry[]> = new Map();
  private historyIndex: Map<string, number> = new Map();

  /**
   * Create a new workspace
   */
  createWorkspace(config: Partial<WorkspaceConfig> = {}): VisualWorkspace {
    const workspace: VisualWorkspace = {
      id: crypto.randomUUID(),
      config: { ...DEFAULT_WORKSPACE_CONFIG, ...config },
      elements: [],
      selectedIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    };

    this.workspaces.set(workspace.id, workspace);
    this.history.set(workspace.id, []);
    this.historyIndex.set(workspace.id, -1);

    this.emit('workspace-created', workspace);
    return workspace;
  }

  /**
   * Get a workspace by ID
   */
  getWorkspace(workspaceId: string): VisualWorkspace | undefined {
    return this.workspaces.get(workspaceId);
  }

  /**
   * Get all workspaces
   */
  getAllWorkspaces(): VisualWorkspace[] {
    return Array.from(this.workspaces.values());
  }

  /**
   * Delete a workspace
   */
  deleteWorkspace(workspaceId: string): boolean {
    const deleted = this.workspaces.delete(workspaceId);
    if (deleted) {
      this.history.delete(workspaceId);
      this.historyIndex.delete(workspaceId);
      this.emit('workspace-deleted', workspaceId);
    }
    return deleted;
  }

  /**
   * Add an element to workspace
   */
  addElement(
    workspaceId: string,
    type: VisualElementType,
    content: unknown,
    position: Position,
    size: Size,
    style?: VisualElementStyle
  ): VisualElement {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    const element: VisualElement = {
      id: crypto.randomUUID(),
      type,
      content,
      position: this.snapToGrid(workspace, position),
      size: this.snapSizeToGrid(workspace, size),
      zIndex: workspace.elements.length,
      locked: false,
      visible: true,
      style,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    workspace.elements.push(element);
    workspace.updatedAt = new Date();
    workspace.version++;

    this.addHistoryEntry(workspaceId, {
      action: 'add',
      elementIds: [element.id],
      previousState: [],
      newState: [element],
      timestamp: new Date(),
    });

    this.emit('element-added', element);
    return element;
  }

  /**
   * Update an element
   */
  updateElement(
    workspaceId: string,
    elementId: string,
    updates: Partial<VisualElement>
  ): VisualElement | null {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return null;

    const index = workspace.elements.findIndex((e) => e.id === elementId);
    if (index === -1) return null;

    const previousState = { ...workspace.elements[index] };
    const updatedElement = {
      ...workspace.elements[index],
      ...updates,
      id: elementId,
      updatedAt: new Date(),
    };

    workspace.elements[index] = updatedElement;
    workspace.updatedAt = new Date();
    workspace.version++;

    this.addHistoryEntry(workspaceId, {
      action: 'update',
      elementIds: [elementId],
      previousState: [previousState],
      newState: [updatedElement],
      timestamp: new Date(),
    });

    this.emit('element-updated', updatedElement);
    return updatedElement;
  }

  /**
   * Delete an element
   */
  deleteElement(workspaceId: string, elementId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;

    const index = workspace.elements.findIndex((e) => e.id === elementId);
    if (index === -1) return false;

    const deletedElement = workspace.elements[index];
    workspace.elements.splice(index, 1);
    workspace.selectedIds = workspace.selectedIds.filter((id) => id !== elementId);
    workspace.updatedAt = new Date();
    workspace.version++;

    this.addHistoryEntry(workspaceId, {
      action: 'delete',
      elementIds: [elementId],
      previousState: [deletedElement],
      newState: [],
      timestamp: new Date(),
    });

    this.emit('element-deleted', elementId);
    return true;
  }

  /**
   * Move an element
   */
  moveElement(workspaceId: string, elementId: string, position: Position): VisualElement | null {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return null;

    const element = workspace.elements.find((e) => e.id === elementId);
    if (!element || element.locked) return null;

    return this.updateElement(workspaceId, elementId, {
      position: this.snapToGrid(workspace, position),
    });
  }

  /**
   * Resize an element
   */
  resizeElement(workspaceId: string, elementId: string, size: Size): VisualElement | null {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return null;

    const element = workspace.elements.find((e) => e.id === elementId);
    if (!element || element.locked) return null;

    return this.updateElement(workspaceId, elementId, {
      size: this.snapSizeToGrid(workspace, size),
    });
  }

  /**
   * Snap position to grid
   */
  private snapToGrid(workspace: VisualWorkspace, position: Position): Position {
    if (!workspace.config.snapToGrid || workspace.config.gridSize === 0) {
      return position;
    }

    const gridSize = workspace.config.gridSize;
    return {
      x: Math.round(position.x / gridSize) * gridSize,
      y: Math.round(position.y / gridSize) * gridSize,
    };
  }

  /**
   * Snap size to grid
   */
  private snapSizeToGrid(workspace: VisualWorkspace, size: Size): Size {
    if (!workspace.config.snapToGrid || workspace.config.gridSize === 0) {
      return size;
    }

    const gridSize = workspace.config.gridSize;
    return {
      width: Math.max(gridSize, Math.round(size.width / gridSize) * gridSize),
      height: Math.max(gridSize, Math.round(size.height / gridSize) * gridSize),
    };
  }

  /**
   * Add history entry
   */
  private addHistoryEntry(workspaceId: string, entry: WorkspaceHistoryEntry): void {
    const workspace = this.workspaces.get(workspaceId);
    const hist = this.history.get(workspaceId);
    const idx = this.historyIndex.get(workspaceId);

    if (!workspace || !hist || idx === undefined) return;

    hist.splice(idx + 1);
    hist.push(entry);

    while (hist.length > workspace.config.maxHistory) {
      hist.shift();
    }

    this.historyIndex.set(workspaceId, hist.length - 1);
  }

  /**
   * Undo last action
   */
  undo(workspaceId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    const hist = this.history.get(workspaceId);
    const idx = this.historyIndex.get(workspaceId);

    if (!workspace || !hist || idx === undefined || idx < 0) return false;

    const entry = hist[idx];
    this.historyIndex.set(workspaceId, idx - 1);

    for (let i = 0; i < entry.elementIds.length; i++) {
      const elementId = entry.elementIds[i];

      if (entry.action === 'add') {
        workspace.elements = workspace.elements.filter((e) => e.id !== elementId);
      } else if (entry.action === 'delete') {
        workspace.elements.push(entry.previousState[i] as VisualElement);
      } else {
        const idx = workspace.elements.findIndex((e) => e.id === elementId);
        if (idx >= 0) {
          workspace.elements[idx] = entry.previousState[i] as VisualElement;
        }
      }
    }

    workspace.updatedAt = new Date();
    workspace.version++;

    this.emit('undo', entry);
    return true;
  }

  /**
   * Redo last undone action
   */
  redo(workspaceId: string): boolean {
    const hist = this.history.get(workspaceId);
    const idx = this.historyIndex.get(workspaceId);

    if (!hist || idx === undefined || idx >= hist.length - 1) return false;

    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;

    this.historyIndex.set(workspaceId, idx + 1);
    const entry = hist[idx + 1];

    for (let i = 0; i < entry.elementIds.length; i++) {
      const elementId = entry.elementIds[i];

      if (entry.action === 'delete') {
        workspace.elements = workspace.elements.filter((e) => e.id !== elementId);
      } else if (entry.action === 'add') {
        workspace.elements.push(entry.newState[i] as VisualElement);
      } else {
        const idx = workspace.elements.findIndex((e) => e.id === elementId);
        if (idx >= 0) {
          workspace.elements[idx] = entry.newState[i] as VisualElement;
        }
      }
    }

    workspace.updatedAt = new Date();
    workspace.version++;

    this.emit('redo', entry);
    return true;
  }

  /**
   * Render workspace to terminal
   */
  renderToTerminal(workspaceId: string, width = 80, height = 24): string {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return '';

    const buffer: string[][] = Array(height)
      .fill(null)
      .map(() => Array(width).fill(' '));

    const scaleX = width / workspace.config.width;
    const scaleY = height / workspace.config.height;

    // Draw grid
    if (workspace.config.showGrid) {
      const gridX = Math.max(1, Math.floor(workspace.config.gridSize * scaleX));
      const gridY = Math.max(1, Math.floor(workspace.config.gridSize * scaleY));

      for (let y = 0; y < height; y += gridY) {
        for (let x = 0; x < width; x++) {
          if (buffer[y]) buffer[y][x] = '·';
        }
      }
    }

    // Draw elements
    const sortedElements = [...workspace.elements]
      .sort((a, b) => a.zIndex - b.zIndex)
      .filter((e) => e.visible);

    for (const element of sortedElements) {
      const x1 = Math.floor(element.position.x * scaleX);
      const y1 = Math.floor(element.position.y * scaleY);
      const x2 = Math.min(width - 1, Math.floor((element.position.x + element.size.width) * scaleX));
      const y2 = Math.min(height - 1, Math.floor((element.position.y + element.size.height) * scaleY));

      // Draw border
      for (let x = x1; x <= x2; x++) {
        if (buffer[y1]) buffer[y1][x] = '─';
        if (buffer[y2]) buffer[y2][x] = '─';
      }
      for (let y = y1; y <= y2; y++) {
        if (buffer[y]) {
          buffer[y][x1] = '│';
          buffer[y][x2] = '│';
        }
      }

      // Corners
      if (buffer[y1]) {
        buffer[y1][x1] = '┌';
        buffer[y1][x2] = '┐';
      }
      if (buffer[y2]) {
        buffer[y2][x1] = '└';
        buffer[y2][x2] = '┘';
      }

      // Label
      let label = element.label || `[${element.type}]`;
      const maxLen = x2 - x1 - 2;
      if (label.length > maxLen) {
        label = label.substring(0, maxLen - 1) + '…';
      }

      const labelY = Math.floor((y1 + y2) / 2);
      const labelX = x1 + 1 + Math.floor((maxLen - label.length) / 2);

      if (buffer[labelY]) {
        for (let i = 0; i < label.length && labelX + i < x2; i++) {
          buffer[labelY][labelX + i] = label[i];
        }
      }
    }

    return buffer.map((row) => row.join('')).join('\n');
  }

  /**
   * Export workspace to JSON
   */
  exportToJSON(workspaceId: string): string {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);
    return JSON.stringify(workspace, null, 2);
  }

  /**
   * Import workspace from JSON
   */
  importFromJSON(json: string): VisualWorkspace {
    const data = JSON.parse(json) as VisualWorkspace;
    const newId = crypto.randomUUID();

    const workspace: VisualWorkspace = {
      ...data,
      id: newId,
      createdAt: new Date(),
      updatedAt: new Date(),
      elements: data.elements.map((e) => ({
        ...e,
        id: crypto.randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    };

    this.workspaces.set(workspace.id, workspace);
    this.history.set(workspace.id, []);
    this.historyIndex.set(workspace.id, -1);

    this.emit('workspace-created', workspace);
    return workspace;
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    this.workspaces.clear();
    this.history.clear();
    this.historyIndex.clear();
    this.removeAllListeners();
  }
}

// Singleton
let visualWorkspaceManagerInstance: VisualWorkspaceManager | null = null;

export function getVisualWorkspaceManager(): VisualWorkspaceManager {
  if (!visualWorkspaceManagerInstance) {
    visualWorkspaceManagerInstance = new VisualWorkspaceManager();
  }
  return visualWorkspaceManagerInstance;
}

export function resetVisualWorkspaceManager(): void {
  if (visualWorkspaceManagerInstance) {
    visualWorkspaceManagerInstance.shutdown();
    visualWorkspaceManagerInstance = null;
  }
}

export default VisualWorkspaceManager;
