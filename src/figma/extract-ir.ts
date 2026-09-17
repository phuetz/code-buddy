import { uniqueName, toPascalCase } from './names.js';
import {
  childNodes,
  isVisible,
  nodeId,
  nodeName,
  nodeType,
  type FigmaFileRaw,
  type FigmaLayoutGrid,
  type FigmaNodeRaw,
  type FigmaPaint,
} from './parse-document.js';
import { figmaRgbToHex, snapColor, snapFontSize, snapSpace } from './tokens.js';
import type {
  FigmaBox,
  FigmaColor,
  FigmaImportIR,
  FigmaSourceKind,
  FigmaSpacing,
  IrComponent,
  IrLayout,
  IrNode,
  IrScreen,
  SkipEntry,
} from './types.js';

const SUPPORTED_TYPES = new Set([
  'DOCUMENT',
  'CANVAS',
  'SECTION',
  'FRAME',
  'GROUP',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'TEXT',
  'RECTANGLE',
]);

const SKIP_REASONS: Record<string, string> = {
  VECTOR: 'vector paths are not converted to code',
  BOOLEAN_OPERATION: 'boolean operations are not converted',
  STAR: 'star shapes are not converted',
  LINE: 'lines are not converted',
  ELLIPSE: 'ellipses are not converted',
  REGULAR_POLYGON: 'polygons are not converted',
  SLICE: 'slices are export guides, not UI',
  CONNECTOR: 'connectors are not converted',
  STICKY: 'sticky notes are not converted',
  SHAPE_WITH_TEXT: 'shape-with-text is not converted',
  TABLE: 'tables are not converted',
  TABLE_CELL: 'table cells are not converted',
  WIDGET: 'widgets are not converted',
  EMBED: 'embeds are not converted',
  HIGHLIGHT: 'highlights are not converted',
  WASHI_TAPE: 'washi tape is not converted',
  MEDIA: 'media nodes are not converted',
};

function absoluteBoxOf(node: FigmaNodeRaw): FigmaBox {
  const box = node.absoluteBoundingBox;
  return {
    x: Number(box?.x) || 0,
    y: Number(box?.y) || 0,
    width: Number(box?.width) || 0,
    height: Number(box?.height) || 0,
  };
}

/** CSS `position:absolute` is relative to the parent box, not the Figma canvas. */
function boxRelativeToParent(abs: FigmaBox, parentAbs: FigmaBox | undefined): FigmaBox {
  if (!parentAbs) return abs;
  return {
    x: abs.x - parentAbs.x,
    y: abs.y - parentAbs.y,
    width: abs.width,
    height: abs.height,
  };
}

function visiblePaints(paints: FigmaPaint[] | undefined): FigmaPaint[] {
  if (!Array.isArray(paints)) return [];
  return paints.filter((paint) => paint && paint.visible !== false);
}

function solidFills(paints: FigmaPaint[]): FigmaColor[] {
  const colors: FigmaColor[] = [];
  for (const paint of paints) {
    if (paint.type !== 'SOLID' || !paint.color) continue;
    const hex = figmaRgbToHex(paint.color.r ?? 0, paint.color.g ?? 0, paint.color.b ?? 0);
    const opacity = paint.opacity ?? paint.color.a ?? 1;
    colors.push(snapColor(hex, opacity));
  }
  return colors;
}

function firstImageRef(paints: FigmaPaint[]): string | undefined {
  for (const paint of paints) {
    if (paint.type === 'IMAGE' && typeof paint.imageRef === 'string' && paint.imageRef) {
      return paint.imageRef;
    }
  }
  return undefined;
}

function spacingFrom(node: FigmaNodeRaw): FigmaSpacing | undefined {
  const top = Number(node.paddingTop) || 0;
  const right = Number(node.paddingRight) || 0;
  const bottom = Number(node.paddingBottom) || 0;
  const left = Number(node.paddingLeft) || 0;
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return undefined;
  const uniform = top === right && right === bottom && bottom === left ? snapSpace(top) : undefined;
  return {
    top,
    right,
    bottom,
    left,
    ...(uniform ? { token: uniform.token } : {}),
  };
}

function layoutOf(node: FigmaNodeRaw, skips: SkipEntry[]): IrLayout {
  const modeRaw = typeof node.layoutMode === 'string' ? node.layoutMode.toUpperCase() : '';
  const grids = Array.isArray(node.layoutGrids) ? node.layoutGrids : [];
  const visibleGrids = grids.filter((grid) => grid && grid.visible !== false);
  const grid = visibleGrids.find((g) => g.pattern === 'GRID' || g.pattern === 'COLUMNS');

  if (typeof node.layoutWrap === 'string' && node.layoutWrap.toUpperCase() === 'WRAP') {
    skips.push({
      nodeId: nodeId(node),
      name: nodeName(node),
      type: nodeType(node),
      reason: 'auto-layout wrap is not generated; flex without wrap is used instead',
    });
  }

  if (modeRaw === 'HORIZONTAL' || modeRaw === 'VERTICAL') {
    const gap = Number(node.itemSpacing) || 0;
    const snapped = snapSpace(gap);
    return {
      mode: modeRaw === 'HORIZONTAL' ? 'horizontal' : 'vertical',
      ...(gap > 0 ? { gap } : {}),
      ...(snapped ? { gapToken: snapped.token } : {}),
      padding: spacingFrom(node),
    };
  }

  if (grid) {
    const columns = gridCount(grid);
    return {
      mode: 'grid',
      ...(columns ? { columns } : {}),
      padding: spacingFrom(node),
    };
  }

  return { mode: 'none', padding: spacingFrom(node) };
}

function gridCount(grid: FigmaLayoutGrid): number | undefined {
  if (typeof grid.count === 'number' && grid.count > 0) return Math.min(12, Math.round(grid.count));
  if (typeof grid.sectionSize === 'number' && grid.sectionSize > 0) {
    return Math.min(12, Math.max(2, Math.round(375 / grid.sectionSize)));
  }
  return undefined;
}

function visibleEffects(node: FigmaNodeRaw): boolean {
  if (!Array.isArray(node.effects)) return false;
  return node.effects.some((effect) => effect && effect.visible !== false && typeof effect.type === 'string');
}

function advancedConstraints(node: FigmaNodeRaw): boolean {
  const c = node.constraints;
  if (!c) return false;
  const h = (c.horizontal ?? 'LEFT').toUpperCase();
  const v = (c.vertical ?? 'TOP').toUpperCase();
  const simpleH = h === 'LEFT' || h === 'RIGHT' || h === 'CENTER' || h === 'SCALE';
  const simpleV = v === 'TOP' || v === 'BOTTOM' || v === 'CENTER' || v === 'SCALE';
  // LEFT_RIGHT / TOP_BOTTOM / SCALE_STRETCH are the advanced pin-to-both-sides cases.
  return !simpleH || !simpleV;
}

function collectTextProps(node: IrNode, acc: Record<string, string>): void {
  if (node.kind === 'text' && node.text?.characters) {
    const key = toPascalCase(node.name, 'text');
    const camel = key.charAt(0).toLowerCase() + key.slice(1);
    if (!(camel in acc)) acc[camel] = node.text.characters;
  }
  for (const child of node.children) collectTextProps(child, acc);
}

function convertChildren(node: FigmaNodeRaw, ctx: ExtractContext, parentAbs: FigmaBox): IrNode[] {
  const children: IrNode[] = [];
  for (const child of childNodes(node)) {
    const converted = convertNode(child, ctx, parentAbs);
    if (converted) children.push(converted);
  }
  return children;
}

function convertNode(
  node: FigmaNodeRaw,
  ctx: ExtractContext,
  parentAbs?: FigmaBox,
): IrNode | undefined {
  if (!isVisible(node)) return undefined;
  const type = nodeType(node);
  const abs = absoluteBoxOf(node);
  const box = boxRelativeToParent(abs, parentAbs);

  if (type === 'GROUP' || type === 'COMPONENT_SET' || type === 'CANVAS' || type === 'SECTION' || type === 'DOCUMENT') {
    const children = convertChildren(node, ctx, abs);
    if (type === 'GROUP') {
      return {
        id: nodeId(node),
        name: nodeName(node),
        kind: 'frame',
        box,
        fills: [],
        layout: { mode: 'none' },
        children,
      };
    }
    return undefined;
  }

  if (!SUPPORTED_TYPES.has(type)) {
    ctx.skips.push({
      nodeId: nodeId(node),
      name: nodeName(node),
      type,
      reason: SKIP_REASONS[type] ?? `node type ${type} is not converted`,
    });
    return undefined;
  }

  if (visibleEffects(node)) {
    ctx.skips.push({
      nodeId: nodeId(node),
      name: nodeName(node),
      type,
      reason: 'layer effects (shadow, blur, …) are omitted rather than approximated',
    });
  }

  if (advancedConstraints(node)) {
    ctx.skips.push({
      nodeId: nodeId(node),
      name: nodeName(node),
      type,
      reason: 'advanced constraints (pin to both edges) are not generated',
    });
  }

  const paints = visiblePaints(node.fills);
  for (const paint of paints) {
    if (paint.type && paint.type !== 'SOLID' && paint.type !== 'IMAGE') {
      ctx.skips.push({
        nodeId: nodeId(node),
        name: nodeName(node),
        type,
        reason: `fill type ${paint.type} is not converted`,
      });
    }
  }

  const fills = solidFills(paints);
  for (const fill of fills) ctx.colors.push(fill);
  const imageRef = firstImageRef(paints);
  const layout = layoutOf(node, ctx.skips);
  if (layout.gap) ctx.spacings.push(layout.gap);
  if (layout.padding) {
    ctx.spacings.push(layout.padding.top, layout.padding.right, layout.padding.bottom, layout.padding.left);
  }

  const children = convertChildren(node, ctx, abs);

  if (type === 'TEXT') {
    const fontSize = node.style?.fontSize;
    const snapped = fontSize ? snapFontSize(fontSize) : undefined;
    const color = fills[0];
    return {
      id: nodeId(node),
      name: nodeName(node),
      kind: 'text',
      box,
      fills,
      layout: { mode: 'none' },
      text: {
        characters: typeof node.characters === 'string' ? node.characters : '',
        ...(fontSize !== undefined ? { fontSize } : {}),
        ...(snapped ? { fontSizeToken: snapped.token } : {}),
        ...(node.style?.fontWeight !== undefined ? { fontWeight: node.style.fontWeight } : {}),
        ...(color ? { color } : {}),
      },
      children: [],
    };
  }

  if (type === 'RECTANGLE') {
    if (imageRef) {
      return {
        id: nodeId(node),
        name: nodeName(node),
        kind: 'image',
        box,
        fills,
        ...(typeof node.cornerRadius === 'number' ? { cornerRadius: node.cornerRadius } : {}),
        layout: { mode: 'none' },
        imageRef,
        children: [],
      };
    }
    return {
      id: nodeId(node),
      name: nodeName(node),
      kind: 'rectangle',
      box,
      fills,
      ...(typeof node.cornerRadius === 'number' ? { cornerRadius: node.cornerRadius } : {}),
      layout: { mode: 'none' },
      children: [],
    };
  }

  if (type === 'INSTANCE') {
    const componentId = typeof node.componentId === 'string' ? node.componentId : undefined;
    const catalogName = componentId ? ctx.componentCatalog.get(componentId) : undefined;
    const converted: IrNode = {
      id: nodeId(node),
      name: nodeName(node),
      kind: 'instance',
      box,
      fills,
      layout,
      ...(componentId ? { componentId } : {}),
      ...(catalogName ? { componentName: catalogName } : {}),
      children,
    };
    const props: Record<string, string> = {};
    collectTextProps(converted, props);
    if (Object.keys(props).length > 0) converted.instanceProps = props;
    if (componentId) {
      ctx.instanceCounts.set(componentId, (ctx.instanceCounts.get(componentId) ?? 0) + 1);
    }
    return converted;
  }

  if (type === 'COMPONENT') {
    const converted: IrNode = {
      id: nodeId(node),
      name: nodeName(node),
      kind: 'component',
      box,
      fills,
      layout,
      children,
    };
    ctx.componentNodes.set(nodeId(node), converted);
    return converted;
  }

  return {
    id: nodeId(node),
    name: nodeName(node),
    kind: imageRef ? 'image' : 'frame',
    box,
    fills,
    layout,
    ...(imageRef ? { imageRef } : {}),
    ...(typeof node.cornerRadius === 'number' ? { cornerRadius: node.cornerRadius } : {}),
    children,
  };
}

interface ExtractContext {
  skips: SkipEntry[];
  colors: FigmaColor[];
  spacings: number[];
  componentCatalog: Map<string, string>;
  componentNodes: Map<string, IrNode>;
  instanceCounts: Map<string, number>;
}

function walkTopLevel(
  node: FigmaNodeRaw,
  screens: FigmaNodeRaw[],
  components: FigmaNodeRaw[],
): void {
  if (!isVisible(node)) return;
  const type = nodeType(node);
  if (type === 'DOCUMENT' || type === 'CANVAS' || type === 'SECTION' || type === 'COMPONENT_SET') {
    for (const child of childNodes(node)) walkTopLevel(child, screens, components);
    return;
  }
  if (type === 'COMPONENT') {
    components.push(node);
    return;
  }
  if (type === 'FRAME') {
    screens.push(node);
  }
}

function uniqueColors(colors: FigmaColor[]): FigmaColor[] {
  const seen = new Set<string>();
  const out: FigmaColor[] = [];
  for (const color of colors) {
    const key = `${color.hex}:${color.opacity}:${color.token ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(color);
  }
  return out;
}

export function extractIr(
  file: FigmaFileRaw,
  source: { kind: FigmaSourceKind; name?: string; fileKey?: string },
): FigmaImportIR {
  const componentCatalog = new Map<string, string>();
  if (file.components) {
    for (const [id, meta] of Object.entries(file.components)) {
      if (meta?.name) componentCatalog.set(id, meta.name);
    }
  }

  const ctx: ExtractContext = {
    skips: [],
    colors: [],
    spacings: [],
    componentCatalog,
    componentNodes: new Map(),
    instanceCounts: new Map(),
  };

  const screenNodes: FigmaNodeRaw[] = [];
  const componentRoots: FigmaNodeRaw[] = [];
  walkTopLevel(file.document, screenNodes, componentRoots);

  const usedNames = new Set<string>();
  const screens: IrScreen[] = [];
  for (const node of screenNodes) {
    const root = convertNode(node, ctx);
    if (!root) continue;
    const componentName = uniqueName(toPascalCase(nodeName(node), 'Screen'), usedNames);
    screens.push({ id: nodeId(node), name: nodeName(node), componentName, root });
  }

  const components: IrComponent[] = [];
  const usedComponentNames = new Set<string>();
  const pushComponent = (id: string, name: string, root: IrNode): void => {
    if (components.some((component) => component.id === id)) return;
    const componentName = uniqueName(toPascalCase(name, 'Component'), usedComponentNames);
    components.push({
      id,
      name,
      componentName,
      root,
      instanceCount: ctx.instanceCounts.get(id) ?? 0,
    });
  };
  for (const node of componentRoots) {
    const root = ctx.componentNodes.get(nodeId(node)) ?? convertNode(node, ctx);
    if (!root) continue;
    pushComponent(nodeId(node), nodeName(node), root);
  }
  for (const [id, root] of ctx.componentNodes) {
    pushComponent(id, root.name, root);
  }

  return {
    source: {
      kind: source.kind,
      name: source.name ?? file.name ?? 'Figma file',
      ...(source.fileKey ? { fileKey: source.fileKey } : {}),
    },
    screens,
    components,
    colors: uniqueColors(ctx.colors),
    spacings: [...new Set(ctx.spacings.filter((n) => n > 0))].sort((a, b) => a - b),
    skips: ctx.skips,
  };
}
