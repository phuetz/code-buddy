import { toCamelCase } from './names.js';
import { cssVar } from './tokens.js';
import type { GeneratedFile, FigmaColor, FigmaImportIR, IrComponent, IrNode, IrScreen } from './types.js';

function indent(level: number): string {
  return '  '.repeat(level);
}

function jsxText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

function classNames(parts: Array<string | undefined | false>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ');
}

function fillClass(color: FigmaColor | undefined): string | undefined {
  if (!color?.token) return undefined;
  return `figma-fill-${color.token}`;
}

function textColorClass(color: FigmaColor | undefined): string | undefined {
  if (!color?.token) return undefined;
  if (color.token === 'fg' || color.token === 'muted' || color.token === 'accent') {
    return `figma-color-${color.token}`;
  }
  return undefined;
}

function inlineColor(color: FigmaColor | undefined, prop: 'color' | 'background'): string | undefined {
  if (!color) return undefined;
  if (color.token && (prop === 'background' ? fillClass(color) : textColorClass(color))) return undefined;
  const value = color.token
    ? cssVar(color.token, color.hex)
    : color.opacity < 1
      ? `color-mix(in srgb, ${color.hex} ${Math.round(color.opacity * 100)}%, transparent)`
      : color.hex;
  return `${prop}: '${value}'`;
}

function sizeStyle(node: IrNode, positioned: boolean): string[] {
  const styles: string[] = [];
  if (node.box.width > 0) styles.push(`width: ${Math.round(node.box.width)}`);
  if (node.layout.mode === 'none' && node.box.height > 0) {
    styles.push(`height: ${Math.round(node.box.height)}`);
  } else if (node.box.height > 0 && node.kind !== 'text') {
    styles.push(`minHeight: ${Math.round(node.box.height)}`);
  }
  if (positioned) {
    styles.push('position: \'absolute\'');
    styles.push(`left: ${Math.round(node.box.x)}`);
    styles.push(`top: ${Math.round(node.box.y)}`);
  }
  if (node.cornerRadius !== undefined && node.cornerRadius > 0 && node.cornerRadius !== 8 && node.cornerRadius < 40) {
    styles.push(`borderRadius: ${Math.round(node.cornerRadius)}`);
  }
  return styles;
}

function styleAttr(styles: string[]): string {
  if (styles.length === 0) return '';
  return ` style={{ ${styles.join(', ')} }}`;
}

function padClass(node: IrNode): string | undefined {
  const token = node.layout.padding?.token;
  if (!token) return undefined;
  return `figma-pad-${token.replace('space-', '')}`;
}

function gapClass(node: IrNode): string | undefined {
  const token = node.layout.gapToken;
  if (!token) return undefined;
  return `figma-gap-${token.replace('space-', '')}`;
}

function layoutClass(node: IrNode): string | undefined {
  if (node.kind === 'text' || node.kind === 'rectangle' || node.kind === 'image') return undefined;
  if (node.layout.mode === 'horizontal') return 'figma-frame figma-frame-row';
  if (node.layout.mode === 'vertical') return 'figma-frame figma-frame-col';
  if (node.layout.mode === 'grid') return 'figma-frame figma-frame-grid';
  return 'figma-frame figma-frame-abs';
}

function radiusClass(node: IrNode): string | undefined {
  if (node.cornerRadius === undefined) return undefined;
  if (node.cornerRadius >= 999) return 'figma-radius-pill';
  if (node.cornerRadius >= 40) return 'figma-radius-sm';
  if (node.cornerRadius >= 6) return 'figma-radius-md';
  return undefined;
}

interface RenderOpts {
  parentAbsolute: boolean;
  components: Map<string, IrComponent>;
  hostComponentId?: string;
}

function isHostComponent(node: IrNode, opts: RenderOpts): boolean {
  if (!opts.hostComponentId) return false;
  if (node.kind === 'component') return node.id === opts.hostComponentId;
  if (node.kind === 'instance') return node.componentId === opts.hostComponentId;
  return false;
}

function renderNode(node: IrNode, level: number, opts: RenderOpts): string {
  const pad = indent(level);
  if (node.kind === 'component' && !isHostComponent(node, opts)) {
    const def = opts.components.get(node.id);
    if (def) return `${pad}<${def.componentName} />`;
  }
  if (node.kind === 'instance' && node.componentId && !isHostComponent(node, opts)) {
    const def = opts.components.get(node.componentId);
    if (def) {
      const props = node.instanceProps ?? {};
      const assignments = Object.entries(props)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(' ');
      return `${pad}<${def.componentName}${assignments ? ` ${assignments}` : ''} />`;
    }
  }

  const positioned = opts.parentAbsolute && node.layout.mode === 'none';
  const fill = node.kind === 'text' ? node.text?.color : node.fills[0];
  const classes = classNames([
    node.kind === 'text' ? 'figma-text' : undefined,
    node.kind === 'text' && node.text?.fontSizeToken
      ? `figma-text-${node.text.fontSizeToken.replace('text-', '')}`
      : undefined,
    node.kind === 'text' ? textColorClass(node.text?.color) : undefined,
    node.kind === 'rectangle' ? 'figma-rect' : undefined,
    node.kind === 'image' ? 'figma-image' : undefined,
    layoutClass(node),
    node.kind !== 'text' ? fillClass(node.kind === 'image' ? undefined : fill) : undefined,
    padClass(node),
    gapClass(node),
    radiusClass(node),
  ]);

  const styles = sizeStyle(node, positioned);
  if (node.kind === 'text') {
    const colorStyle = inlineColor(node.text?.color, 'color');
    if (colorStyle) styles.push(colorStyle);
    if (node.text?.fontWeight) styles.push(`fontWeight: ${node.text.fontWeight}`);
    if (node.text?.fontSize && !node.text.fontSizeToken) styles.push(`fontSize: ${node.text.fontSize}`);
  } else if (node.kind !== 'image') {
    const bg = inlineColor(fill, 'background');
    if (bg) styles.push(bg);
  }
  if (node.layout.mode === 'grid' && node.layout.columns) {
    styles.push(`gridTemplateColumns: 'repeat(${node.layout.columns}, minmax(0, 1fr))'`);
  }

  const dataAttrs = [`data-figma-id=${JSON.stringify(node.id)}`];
  if (node.imageRef) dataAttrs.push(`data-figma-image-ref=${JSON.stringify(node.imageRef)}`);

  if (node.kind === 'text') {
    const tag = (node.text?.fontSize ?? 16) >= 24 ? 'h1' : 'p';
    return `${pad}<${tag} className="${classes}" ${dataAttrs.join(' ')}${styleAttr(styles)}>${jsxText(node.text?.characters ?? '')}</${tag}>`;
  }

  const childParentAbsolute = node.layout.mode === 'none';
  if (node.children.length === 0) {
    return `${pad}<div className="${classes}" ${dataAttrs.join(' ')}${styleAttr(styles)} />`;
  }

  const children = node.children
    .map((child) =>
      renderNode(child, level + 1, {
        parentAbsolute: childParentAbsolute,
        components: opts.components,
        hostComponentId: opts.hostComponentId,
      }),
    )
    .join('\n');
  return `${pad}<div className="${classes}" ${dataAttrs.join(' ')}${styleAttr(styles)}>\n${children}\n${pad}</div>`;
}

function componentPropsType(
  component: IrComponent,
  components: Map<string, IrComponent>,
): { type: string; defaults: string; usage: string } {
  const props: Record<string, string> = {};
  const collect = (node: IrNode): void => {
    if (node.kind === 'text' && node.text) {
      const key = toCamelCase(node.name, 'text');
      if (!(key in props)) props[key] = node.text.characters;
    }
    for (const child of node.children) collect(child);
  };
  collect(component.root);
  const keys = Object.keys(props);
  const renderOpts: RenderOpts = {
    parentAbsolute: false,
    components,
    hostComponentId: component.id,
  };
  if (keys.length === 0) {
    return { type: '', defaults: '', usage: renderNode(component.root, 2, renderOpts) };
  }
  const fields = keys.map((key) => `  ${key}?: string;`).join('\n');
  const type = `\nexport interface ${component.componentName}Props {\n${fields}\n}\n`;
  const defaults = keys.map((key) => `    ${key} = ${JSON.stringify(props[key])},`).join('\n');
  const usage = renderNode(withTextOverrides(component.root, keys), 2, renderOpts);
  return { type, defaults, usage };
}

function withTextOverrides(node: IrNode, keys: string[]): IrNode {
  if (node.kind === 'text' && node.text) {
    const key = toCamelCase(node.name, 'text');
    if (keys.includes(key)) {
      return { ...node, text: { ...node.text, characters: `{${key}}` } };
    }
  }
  return { ...node, children: node.children.map((child) => withTextOverrides(child, keys)) };
}

function wrapJsxExpression(source: string): string {
  // Text nodes that hold `{prop}` were escaped; restore them as JSX expressions.
  return source.replace(/&#123;([A-Za-z_][A-Za-z0-9]*)&#125;/g, '{$1}');
}

export function generateComponentFile(component: IrComponent, components: IrComponent[] = []): GeneratedFile {
  const map = new Map(components.map((entry) => [entry.id, entry]));
  const { type, defaults, usage } = componentPropsType(component, map);
  const imports = collectInstanceImports(component.root, map, new Set(), component.id);
  const importBlock = imports.map((name) => `import { ${name} } from './${name}.js';`).join('\n');
  const body = wrapJsxExpression(usage);
  const signature = defaults
    ? `export function ${component.componentName}({\n${defaults}\n  }: ${component.componentName}Props) {`
    : `export function ${component.componentName}() {`;
  const content = `import React from 'react';
${importBlock ? `${importBlock}\n` : ''}${type}
${signature}
  return (
${body}
  );
}
`;
  return {
    relativePath: `src/components/${component.componentName}.tsx`,
    content,
  };
}

export function generateScreenFile(screen: IrScreen, components: IrComponent[]): GeneratedFile {
  const map = new Map(components.map((component) => [component.id, component]));
  const imports = collectInstanceImports(screen.root, map);
  const importBlock = imports
    .map((name) => `import { ${name} } from '../components/${name}.js';`)
    .join('\n');
  const body = renderNode(screen.root, 2, { parentAbsolute: false, components: map });
  const content = `import React from 'react';
${importBlock ? `${importBlock}\n` : ''}
export function ${screen.componentName}() {
  return (
    <section className="figma-screen" data-figma-screen=${JSON.stringify(screen.name)} data-figma-id=${JSON.stringify(screen.id)}>
${body}
    </section>
  );
}
`;
  return {
    relativePath: `src/screens/${screen.componentName}.tsx`,
    content,
  };
}

function collectInstanceImports(
  node: IrNode,
  components: Map<string, IrComponent>,
  acc = new Set<string>(),
  hostComponentId?: string,
): string[] {
  if (node.kind === 'component') {
    const def = components.get(node.id);
    if (def && def.id !== hostComponentId) acc.add(def.componentName);
  }
  if (node.kind === 'instance' && node.componentId) {
    const def = components.get(node.componentId);
    if (def && def.id !== hostComponentId) acc.add(def.componentName);
  }
  for (const child of node.children) collectInstanceImports(child, components, acc, hostComponentId);
  return [...acc];
}

export function generateIndexFiles(ir: FigmaImportIR): GeneratedFile[] {
  const screenExports = ir.screens
    .map((screen) => `export { ${screen.componentName} } from './${screen.componentName}.js';`)
    .join('\n');
  const componentExports = ir.components
    .map((component) => `export { ${component.componentName} } from './${component.componentName}.js';`)
    .join('\n');
  const screenImports = ir.screens
    .map((screen) => `import { ${screen.componentName} } from './screens/${screen.componentName}.js';`)
    .join('\n');
  const screenList = ir.screens
    .map((screen) => `      <${screen.componentName} />`)
    .join('\n');

  const files: GeneratedFile[] = [
    {
      relativePath: 'src/screens/index.ts',
      content: `${screenExports || 'export {};'}\n`,
    },
    {
      relativePath: 'src/components/index.ts',
      content: `${componentExports || 'export {};'}\n`,
    },
    {
      relativePath: 'src/FigmaImportRoot.tsx',
      content: `import React from 'react';
${screenImports}

export function FigmaImportRoot() {
  return (
    <main className="figma-import-root">
${screenList || '      {null}'}
    </main>
  );
}
`,
    },
    {
      relativePath: 'src/main.tsx',
      content: `import './figma-utilities.css';
import React from 'react';
import { FigmaImportRoot } from './FigmaImportRoot.js';

export function mountFigmaImport(): React.ReactElement {
  return <FigmaImportRoot />;
}
`,
    },
  ];
  return files;
}

export function generateReactFiles(ir: FigmaImportIR): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  for (const component of ir.components) files.push(generateComponentFile(component, ir.components));
  for (const screen of ir.screens) files.push(generateScreenFile(screen, ir.components));
  files.push(...generateIndexFiles(ir));
  return files;
}
