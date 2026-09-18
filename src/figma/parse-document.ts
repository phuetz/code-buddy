import { FigmaImportError } from './types.js';

export interface FigmaPaint {
  type?: string;
  visible?: boolean;
  opacity?: number;
  color?: { r?: number; g?: number; b?: number; a?: number };
  imageRef?: string;
  scaleMode?: string;
}

export interface FigmaEffect {
  type?: string;
  visible?: boolean;
}

export interface FigmaLayoutGrid {
  pattern?: string;
  visible?: boolean;
  sectionSize?: number;
  count?: number;
}

export interface FigmaBoxRaw {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface FigmaStyleRaw {
  fontSize?: number;
  fontWeight?: number;
}

export interface FigmaNodeRaw {
  id?: string;
  name?: string;
  type?: string;
  visible?: boolean;
  children?: FigmaNodeRaw[];
  absoluteBoundingBox?: FigmaBoxRaw;
  fills?: FigmaPaint[];
  effects?: FigmaEffect[];
  layoutGrids?: FigmaLayoutGrid[];
  layoutMode?: string;
  layoutWrap?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  cornerRadius?: number;
  characters?: string;
  style?: FigmaStyleRaw;
  componentId?: string;
  constraints?: { horizontal?: string; vertical?: string };
}

export interface FigmaFileRaw {
  name?: string;
  document: FigmaNodeRaw;
  components?: Record<string, { name?: string; key?: string }>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNode(value: unknown): FigmaNodeRaw | null {
  const rec = asRecord(value);
  if (!rec) return null;
  return rec as FigmaNodeRaw;
}

export function parseFigmaFile(raw: unknown): FigmaFileRaw {
  const rec = asRecord(raw);
  if (!rec) {
    throw new FigmaImportError('Figma export must be a JSON object');
  }

  const document = asNode(rec.document);
  if (!document) {
    throw new FigmaImportError('Missing document — this is not a Figma REST file export');
  }
  if (document.type !== 'DOCUMENT') {
    throw new FigmaImportError(
      `document.type must be DOCUMENT, got ${document.type === undefined ? 'undefined' : String(document.type)}`,
    );
  }

  const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : 'Figma file';
  const components = asRecord(rec.components) as FigmaFileRaw['components'];
  return { name, document, ...(components ? { components } : {}) };
}

export function isVisible(node: FigmaNodeRaw): boolean {
  return node.visible !== false;
}

export function nodeType(node: FigmaNodeRaw): string {
  return typeof node.type === 'string' ? node.type : 'UNKNOWN';
}

export function nodeId(node: FigmaNodeRaw): string {
  return typeof node.id === 'string' && node.id ? node.id : 'unknown';
}

export function nodeName(node: FigmaNodeRaw): string {
  return typeof node.name === 'string' && node.name.trim() ? node.name.trim() : nodeType(node);
}

export function childNodes(node: FigmaNodeRaw): FigmaNodeRaw[] {
  return Array.isArray(node.children) ? node.children.filter((child) => asNode(child) !== null) : [];
}
