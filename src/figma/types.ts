/**
 * Intermediate representation for a Figma file import.
 * Only the supported subset is materialized; everything else is listed in skips.
 */

export type FigmaSourceKind = 'local-json' | 'file-key';

export interface FigmaColor {
  hex: string;
  opacity: number;
  /** Nearest design-system CSS variable when the snap is close enough. */
  token?: string;
}

export interface FigmaBox {
  /** Offset from the immediate parent box; canvas-absolute only for top-level screens/components. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigmaSpacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
  token?: string;
}

export type IrLayoutMode = 'none' | 'horizontal' | 'vertical' | 'grid';

export interface IrLayout {
  mode: IrLayoutMode;
  gap?: number;
  gapToken?: string;
  padding?: FigmaSpacing;
  columns?: number;
}

export interface IrText {
  characters: string;
  fontSize?: number;
  fontSizeToken?: string;
  fontWeight?: number;
  color?: FigmaColor;
}

export type IrNodeKind = 'frame' | 'text' | 'rectangle' | 'image' | 'component' | 'instance';

export interface IrNode {
  id: string;
  name: string;
  kind: IrNodeKind;
  box: FigmaBox;
  fills: FigmaColor[];
  cornerRadius?: number;
  layout: IrLayout;
  text?: IrText;
  imageRef?: string;
  componentId?: string;
  componentName?: string;
  instanceProps?: Record<string, string>;
  children: IrNode[];
}

export interface IrScreen {
  id: string;
  name: string;
  componentName: string;
  root: IrNode;
}

export interface IrComponent {
  id: string;
  name: string;
  componentName: string;
  root: IrNode;
  instanceCount: number;
}

export interface SkipEntry {
  nodeId: string;
  name: string;
  type: string;
  reason: string;
}

export interface FigmaImportIR {
  source: {
    kind: FigmaSourceKind;
    name: string;
    fileKey?: string;
  };
  screens: IrScreen[];
  components: IrComponent[];
  colors: FigmaColor[];
  spacings: number[];
  skips: SkipEntry[];
}

export interface GeneratedFile {
  relativePath: string;
  content: string;
}

export interface FigmaImportResult {
  ir: FigmaImportIR;
  files: GeneratedFile[];
  reportMarkdown: string;
  outDir?: string;
  written: string[];
}

export class FigmaImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FigmaImportError';
  }
}
