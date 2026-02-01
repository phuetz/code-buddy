/**
 * Canvas Types
 *
 * Type definitions for visual workspace and canvas elements.
 */

// ============================================================================
// Element Types
// ============================================================================

/**
 * Canvas element types
 */
export type CanvasElementType =
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
 * Position in the canvas
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
export interface ElementStyle {
  /** Background color */
  backgroundColor?: string;
  /** Border color */
  borderColor?: string;
  /** Border width */
  borderWidth?: number;
  /** Border style */
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none';
  /** Border radius */
  borderRadius?: number;
  /** Opacity (0-1) */
  opacity?: number;
  /** Shadow */
  shadow?: boolean;
  /** Font size */
  fontSize?: number;
  /** Font color */
  fontColor?: string;
  /** Font family */
  fontFamily?: string;
  /** Text alignment */
  textAlign?: 'left' | 'center' | 'right';
  /** Padding */
  padding?: number | { top: number; right: number; bottom: number; left: number };
}

/**
 * Base canvas element
 */
export interface CanvasElementBase {
  /** Unique element ID */
  id: string;
  /** Element type */
  type: CanvasElementType;
  /** Position on canvas */
  position: Position;
  /** Size */
  size: Size;
  /** Z-index for layering */
  zIndex: number;
  /** Is element locked */
  locked: boolean;
  /** Is element visible */
  visible: boolean;
  /** Element label */
  label?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** Style options */
  style?: ElementStyle;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Text element
 */
export interface TextElement extends CanvasElementBase {
  type: 'text';
  content: {
    text: string;
    rich?: boolean;
  };
}

/**
 * Code element
 */
export interface CodeElement extends CanvasElementBase {
  type: 'code';
  content: {
    code: string;
    language: string;
    showLineNumbers?: boolean;
    highlightLines?: number[];
  };
}

/**
 * Image element
 */
export interface ImageElement extends CanvasElementBase {
  type: 'image';
  content: {
    url?: string;
    data?: string;
    alt?: string;
    fit: 'contain' | 'cover' | 'fill' | 'none';
  };
}

/**
 * Chart types
 */
export type ChartType = 'line' | 'bar' | 'pie' | 'scatter' | 'area' | 'radar';

/**
 * Chart element
 */
export interface ChartElement extends CanvasElementBase {
  type: 'chart';
  content: {
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
  };
}

/**
 * Diagram types
 */
export type DiagramType = 'flowchart' | 'sequence' | 'class' | 'mindmap' | 'gantt' | 'er';

/**
 * Diagram element
 */
export interface DiagramElement extends CanvasElementBase {
  type: 'diagram';
  content: {
    diagramType: DiagramType;
    source: string; // Mermaid, PlantUML, etc.
    format: 'mermaid' | 'plantuml' | 'dot';
    rendered?: string; // SVG output
  };
}

/**
 * Markdown element
 */
export interface MarkdownElement extends CanvasElementBase {
  type: 'markdown';
  content: {
    markdown: string;
    rendered?: string;
  };
}

/**
 * Table element
 */
export interface TableElement extends CanvasElementBase {
  type: 'table';
  content: {
    headers: string[];
    rows: string[][];
    sortable?: boolean;
    filterable?: boolean;
  };
}

/**
 * Shape types
 */
export type ShapeType = 'rectangle' | 'circle' | 'ellipse' | 'triangle' | 'diamond' | 'arrow';

/**
 * Shape element
 */
export interface ShapeElement extends CanvasElementBase {
  type: 'shape';
  content: {
    shapeType: ShapeType;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    text?: string;
  };
}

/**
 * Connection element (arrow between elements)
 */
export interface ConnectionElement extends CanvasElementBase {
  type: 'connection';
  content: {
    fromElement: string;
    toElement: string;
    fromAnchor?: 'top' | 'right' | 'bottom' | 'left' | 'center';
    toAnchor?: 'top' | 'right' | 'bottom' | 'left' | 'center';
    lineType?: 'straight' | 'curved' | 'orthogonal';
    arrowStart?: boolean;
    arrowEnd?: boolean;
    label?: string;
  };
}

/**
 * Union of all element types
 */
export type CanvasElement =
  | TextElement
  | CodeElement
  | ImageElement
  | ChartElement
  | DiagramElement
  | MarkdownElement
  | TableElement
  | ShapeElement
  | ConnectionElement;

// ============================================================================
// Canvas Types
// ============================================================================

/**
 * Canvas configuration
 */
export interface CanvasConfig {
  /** Canvas name */
  name: string;
  /** Canvas width */
  width: number;
  /** Canvas height */
  height: number;
  /** Background color */
  backgroundColor: string;
  /** Grid size (0 = no grid) */
  gridSize: number;
  /** Show grid */
  showGrid: boolean;
  /** Snap to grid */
  snapToGrid: boolean;
  /** Zoom level (1 = 100%) */
  zoom: number;
  /** Pan offset */
  panOffset: Position;
  /** Selection color */
  selectionColor: string;
  /** Max undo history */
  maxHistory: number;
}

/**
 * Default canvas configuration
 */
export const DEFAULT_CANVAS_CONFIG: CanvasConfig = {
  name: 'Untitled Canvas',
  width: 1920,
  height: 1080,
  backgroundColor: '#ffffff',
  gridSize: 20,
  showGrid: true,
  snapToGrid: true,
  zoom: 1,
  panOffset: { x: 0, y: 0 },
  selectionColor: '#3b82f6',
  maxHistory: 50,
};

/**
 * Canvas state
 */
export interface Canvas {
  /** Canvas ID */
  id: string;
  /** Configuration */
  config: CanvasConfig;
  /** Elements */
  elements: CanvasElement[];
  /** Selected element IDs */
  selectedIds: string[];
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
  /** Version for conflict resolution */
  version: number;
}

/**
 * Canvas history entry
 */
export interface CanvasHistoryEntry {
  /** Action type */
  action: 'add' | 'update' | 'delete' | 'move' | 'resize' | 'style';
  /** Affected element IDs */
  elementIds: string[];
  /** Previous state */
  previousState: Partial<CanvasElement>[];
  /** New state */
  newState: Partial<CanvasElement>[];
  /** Timestamp */
  timestamp: Date;
}

/**
 * Canvas export formats
 */
export type ExportFormat = 'svg' | 'png' | 'pdf' | 'html' | 'json';

/**
 * Export options
 */
export interface ExportOptions {
  /** Export format */
  format: ExportFormat;
  /** Quality (for PNG) */
  quality?: number;
  /** Scale factor */
  scale?: number;
  /** Include grid */
  includeGrid?: boolean;
  /** Background transparent */
  transparentBackground?: boolean;
  /** Selection only */
  selectionOnly?: boolean;
}

/**
 * Canvas events
 */
export interface CanvasEvents {
  'element-added': (element: CanvasElement) => void;
  'element-updated': (element: CanvasElement) => void;
  'element-deleted': (elementId: string) => void;
  'element-selected': (elementId: string) => void;
  'element-deselected': (elementId: string) => void;
  'selection-changed': (selectedIds: string[]) => void;
  'canvas-updated': (canvas: Canvas) => void;
  'zoom-changed': (zoom: number) => void;
  'pan-changed': (offset: Position) => void;
  'undo': (entry: CanvasHistoryEntry) => void;
  'redo': (entry: CanvasHistoryEntry) => void;
}
