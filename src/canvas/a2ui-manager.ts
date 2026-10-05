/**
 * A2UI Manager
 *
 * Manages A2UI surfaces, components, and data binding.
 * Processes A2UI protocol messages and renders to terminal or HTML.
 *
 * A2UI Protocol v0.8 - Agent-to-UI communication for visual workspaces.
 */

import { EventEmitter } from 'events';
import type {
  A2UIMessage,
  SurfaceUpdateMessage,
  DataModelUpdateMessage,
  BeginRenderingMessage,
  DeleteSurfaceMessage,
  A2UIComponent,
  ComponentProps,
  ComponentType,
  Surface,
  RenderedComponent,
  A2UIStyles,
  UserActionMessage,
} from './a2ui-types.js';
import { DEFAULT_SURFACE_STYLES } from './a2ui-types.js';
import {
  escapeHtml as guardEscapeHtml,
  safeUrl,
  safeToken,
  sanitizeCssValue,
} from '../security/html-render-guard.js';

// ============================================================================
// A2UI Manager Events
// ============================================================================

export interface A2UIManagerEvents {
  'surface:created': (surfaceId: string) => void;
  'surface:updated': (surfaceId: string) => void;
  'surface:deleted': (surfaceId: string) => void;
  'surface:rendered': (surfaceId: string, root: string) => void;
  'component:added': (surfaceId: string, componentId: string) => void;
  'component:updated': (surfaceId: string, componentId: string) => void;
  'data:updated': (surfaceId: string, path: string | undefined) => void;
  'user:action': (action: { surfaceId: string; componentId?: string; name: string; context?: Record<string, unknown> }) => void;
  'error': (error: Error) => void;
}

// ============================================================================
// A2UI Manager
// ============================================================================

/**
 * Maximum number of concurrent A2UI surfaces kept in memory.
 * Surfaces are created lazily by `beginRendering` / `surfaceUpdate` /
 * `dataModelUpdate` messages. Without a cap, a workflow that opens many
 * canvases without explicitly sending `deleteSurface` (e.g. a browser
 * tab closed on the client side before the server flushes) would grow
 * the Map indefinitely. The cap below plus FIFO eviction on overflow
 * bounds worst-case memory without affecting normal use.
 */
const MAX_SURFACES = 1000;

export class A2UIManager extends EventEmitter {
  private surfaces: Map<string, Surface> = new Map();
  private dataObservers: Map<string, Map<string, Array<(value: unknown) => void>>> = new Map();

  constructor() {
    super();
  }

  // ==========================================================================
  // Message Processing
  // ==========================================================================

  /**
   * Process an A2UI message
   */
  processMessage(message: A2UIMessage): void {
    try {
      if ('surfaceUpdate' in message) {
        this.processSurfaceUpdate(message);
      } else if ('dataModelUpdate' in message) {
        this.processDataModelUpdate(message);
      } else if ('beginRendering' in message) {
        this.processBeginRendering(message);
      } else if ('deleteSurface' in message) {
        this.processDeleteSurface(message);
      }
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Process multiple A2UI messages
   */
  processMessages(messages: A2UIMessage[]): void {
    for (const message of messages) {
      this.processMessage(message);
    }
  }

  /**
   * Process surfaceUpdate message
   */
  private processSurfaceUpdate(message: SurfaceUpdateMessage): void {
    const { surfaceId, components } = message.surfaceUpdate;

    // Get or create surface
    let surface = this.surfaces.get(surfaceId);
    const isNew = !surface;

    if (!surface) {
      surface = this.createSurface(surfaceId);
    }

    // Add/update components
    for (const component of components) {
      const existing = surface.components.has(component.id);
      surface.components.set(component.id, component);
      surface.updatedAt = new Date();

      if (existing) {
        this.emit('component:updated', surfaceId, component.id);
      } else {
        this.emit('component:added', surfaceId, component.id);
      }
    }

    if (isNew) {
      this.emit('surface:created', surfaceId);
    } else {
      this.emit('surface:updated', surfaceId);
    }
  }

  /**
   * Process dataModelUpdate message
   */
  private processDataModelUpdate(message: DataModelUpdateMessage): void {
    const { surfaceId, path, contents } = message.dataModelUpdate;

    let surface = this.surfaces.get(surfaceId);
    if (!surface) {
      surface = this.createSurface(surfaceId);
    }

    if (path) {
      // Update nested path
      this.setNestedValue(surface.dataModel, path, contents);
    } else {
      // Merge at root
      if (Array.isArray(contents)) {
        surface.dataModel = { items: contents };
      } else {
        Object.assign(surface.dataModel, contents);
      }
    }

    surface.updatedAt = new Date();
    this.emit('data:updated', surfaceId, path);
    this.notifyDataObservers(surfaceId, path);
  }

  /**
   * Process beginRendering message
   */
  private processBeginRendering(message: BeginRenderingMessage): void {
    const { surfaceId, root, catalogId, styles } = message.beginRendering;

    let surface = this.surfaces.get(surfaceId);
    if (!surface) {
      surface = this.createSurface(surfaceId);
    }

    surface.root = root;
    surface.catalogId = catalogId;
    surface.styles = styles;
    surface.visible = true;
    surface.updatedAt = new Date();

    this.emit('surface:rendered', surfaceId, root);
  }

  /**
   * Process deleteSurface message
   */
  private processDeleteSurface(message: DeleteSurfaceMessage): void {
    const { surfaceId } = message.deleteSurface;

    if (this.surfaces.has(surfaceId)) {
      this.surfaces.delete(surfaceId);
      this.emit('surface:deleted', surfaceId);
    }
  }

  // ==========================================================================
  // Surface Management
  // ==========================================================================

  /**
   * Create a new surface.
   *
   * If the Map has reached `MAX_SURFACES`, FIFO-evict the oldest entry
   * and also purge its associated data observers so we don't leak those
   * either. This mirrors the pattern used by RestorableCompressor.
   */
  private createSurface(id: string): Surface {
    if (this.surfaces.size >= MAX_SURFACES) {
      const oldestKey = this.surfaces.keys().next().value;
      if (oldestKey !== undefined) {
        this.surfaces.delete(oldestKey);
        this.dataObservers.delete(oldestKey);
      }
    }
    const surface: Surface = {
      id,
      components: new Map(),
      dataModel: {},
      visible: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.surfaces.set(id, surface);
    return surface;
  }

  /**
   * Get a surface by ID
   */
  getSurface(surfaceId: string): Surface | undefined {
    return this.surfaces.get(surfaceId);
  }

  /**
   * Get all surfaces
   */
  getAllSurfaces(): Surface[] {
    return Array.from(this.surfaces.values());
  }

  /**
   * Get visible surfaces
   */
  getVisibleSurfaces(): Surface[] {
    return this.getAllSurfaces().filter(s => s.visible);
  }

  /**
   * Check if surface exists
   */
  hasSurface(surfaceId: string): boolean {
    return this.surfaces.has(surfaceId);
  }

  // ==========================================================================
  // Component Tree Building
  // ==========================================================================

  /**
   * Build rendered component tree from adjacency list
   */
  buildComponentTree(surfaceId: string): RenderedComponent | null {
    const surface = this.surfaces.get(surfaceId);
    if (!surface || !surface.root) {
      return null;
    }

    const rootComponent = surface.components.get(surface.root);
    if (!rootComponent) {
      return null;
    }

    return this.buildComponentNode(rootComponent, surface);
  }

  /**
   * Build a single component node with children
   */
  private buildComponentNode(
    component: A2UIComponent,
    surface: Surface
  ): RenderedComponent {
    const { type, props } = this.extractComponentInfo(component.component);
    const resolvedProps = this.resolveDataBindings(props, surface.dataModel);

    // Get children IDs from props
    const childrenIds = this.getChildrenIds(props);

    // Recursively build children
    const children: RenderedComponent[] = [];
    for (const childId of childrenIds) {
      const childComponent = surface.components.get(childId);
      if (childComponent) {
        children.push(this.buildComponentNode(childComponent, surface));
      }
    }

    return {
      id: component.id,
      type,
      props: resolvedProps,
      children,
    };
  }

  /**
   * Extract component type and props from ComponentProps union
   */
  private extractComponentInfo(
    componentProps: ComponentProps
  ): { type: ComponentType; props: Record<string, unknown> } {
    const keys = Object.keys(componentProps) as ComponentType[];
    const type = keys[0];
    if (type === undefined) {
      throw new Error('extractComponentInfo: componentProps has no component type key');
    }
    const props = (componentProps as Record<string, unknown>)[type] as Record<string, unknown>;
    return { type, props: props || {} };
  }

  /**
   * Get children IDs from component props
   */
  private getChildrenIds(props: Record<string, unknown>): string[] {
    if (Array.isArray(props.children)) {
      return props.children as string[];
    }
    if (Array.isArray(props.actions)) {
      return props.actions as string[];
    }
    return [];
  }

  // ==========================================================================
  // Data Binding
  // ==========================================================================

  /**
   * Resolve data bindings in props
   */
  private resolveDataBindings(
    props: Record<string, unknown>,
    dataModel: Record<string, unknown>
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(props)) {
      if (key === 'path' && typeof value === 'string') {
        // Resolve path binding
        const boundValue = this.getNestedValue(dataModel, value);
        resolved['value'] = boundValue;
      } else if (key === 'optionsPath' && typeof value === 'string') {
        // Resolve options from path
        resolved['options'] = this.getNestedValue(dataModel, value);
      } else if (key === 'dataPath' && typeof value === 'string') {
        // Resolve data array from path
        resolved['data'] = this.getNestedValue(dataModel, value);
      } else if (key === 'itemsPath' && typeof value === 'string') {
        // Resolve items from path
        resolved['items'] = this.getNestedValue(dataModel, value);
      } else if (key === 'groupPath' && typeof value === 'string') {
        // Resolve group value from path
        resolved['groupValue'] = this.getNestedValue(dataModel, value);
      } else if (key !== 'children' && key !== 'actions') {
        // Copy other props directly
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Get nested value from object using dot notation path
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Set nested value in object using dot notation path
   */
  private setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown
  ): void {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part === undefined) {
        continue;
      }
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    const lastPart = parts[parts.length - 1];
    if (lastPart !== undefined) {
      current[lastPart] = value;
    }
  }

  // ==========================================================================
  // User Actions
  // ==========================================================================

  /**
   * Handle user action from client
   */
  handleUserAction(action: UserActionMessage): void {
    const { surfaceId, componentId, name, context } = action.userAction;

    // Emit event for handlers to process
    this.emit('user:action', {
      surfaceId,
      componentId,
      name,
      context,
    });
  }

  /**
   * Create a user action message
   */
  createUserAction(
    surfaceId: string,
    name: string,
    componentId?: string,
    context?: Record<string, unknown>
  ): UserActionMessage {
    return {
      userAction: {
        name,
        surfaceId,
        componentId,
        context,
      },
    };
  }

  // ==========================================================================
  // Rendering - Terminal
  // ==========================================================================

  /**
   * Render surface to terminal (text format)
   */
  renderToTerminal(surfaceId: string): string {
    const tree = this.buildComponentTree(surfaceId);
    if (!tree) {
      return `[Surface ${surfaceId} not found or has no root]`;
    }

    const lines: string[] = [];
    lines.push(`╔══════════════════════════════════════════════════════════════╗`);
    lines.push(`║ Surface: ${surfaceId.substring(0, 52).padEnd(52)} ║`);
    lines.push(`╠══════════════════════════════════════════════════════════════╣`);

    this.renderNodeToTerminal(tree, lines, 0);

    lines.push(`╚══════════════════════════════════════════════════════════════╝`);

    return lines.join('\n');
  }

  /**
   * Render a component node to terminal lines
   */
  private renderNodeToTerminal(
    node: RenderedComponent,
    lines: string[],
    indent: number
  ): void {
    const prefix = '║ ' + '  '.repeat(indent);
    const maxWidth = 60 - indent * 2;

    switch (node.type) {
      case 'heading': {
        const level = (node.props.level as number) || 1;
        const text = (node.props.value as string) || '';
        const marker = '#'.repeat(level);
        lines.push(`${prefix}${marker} ${text}`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'text': {
        const text = (node.props.value as string) || '';
        const wrapped = this.wrapText(text, maxWidth);
        for (const line of wrapped) {
          lines.push(`${prefix}${line}`.substring(0, 64).padEnd(64) + '║');
        }
        break;
      }

      case 'button': {
        const label = (node.props.label as string) || 'Button';
        const variant = (node.props.variant as string) || 'primary';
        const btnStyle = variant === 'primary' ? '▶' : '○';
        lines.push(`${prefix}[${btnStyle} ${label}]`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'textField':
      case 'textArea': {
        const label = (node.props.label as string) || '';
        const value = (node.props.value as string) || '';
        const placeholder = (node.props.placeholder as string) || '';
        if (label) {
          lines.push(`${prefix}${label}:`.substring(0, 64).padEnd(64) + '║');
        }
        const display = value || placeholder || '___________';
        const boxWidth = Math.min(maxWidth - 2, 30);
        lines.push(`${prefix}┌${'─'.repeat(boxWidth)}┐`.substring(0, 64).padEnd(64) + '║');
        lines.push(`${prefix}│ ${display.substring(0, boxWidth - 2).padEnd(boxWidth - 2)} │`.substring(0, 64).padEnd(64) + '║');
        lines.push(`${prefix}└${'─'.repeat(boxWidth)}┘`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'checkbox': {
        const label = (node.props.label as string) || '';
        const checked = node.props.checked as boolean;
        const box = checked ? '☑' : '☐';
        lines.push(`${prefix}${box} ${label}`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'switch': {
        const label = (node.props.label as string) || '';
        const checked = node.props.checked as boolean;
        const sw = checked ? '[●━━━]' : '[━━━○]';
        lines.push(`${prefix}${sw} ${label}`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'radio': {
        const label = (node.props.label as string) || '';
        const selected = node.props.value === node.props.groupValue;
        const radio = selected ? '◉' : '○';
        lines.push(`${prefix}${radio} ${label}`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'select': {
        const label = (node.props.label as string) || '';
        const value = (node.props.value as string) || '';
        if (label) {
          lines.push(`${prefix}${label}:`.substring(0, 64).padEnd(64) + '║');
        }
        lines.push(`${prefix}[▼ ${value || 'Select...'}]`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'slider': {
        const value = (node.props.value as number) || 0;
        const min = (node.props.min as number) || 0;
        const max = (node.props.max as number) || 100;
        const percent = ((value - min) / (max - min)) * 100;
        const barWidth = 20;
        const filled = Math.round((percent / 100) * barWidth);
        const bar = '━'.repeat(filled) + '○' + '─'.repeat(barWidth - filled);
        lines.push(`${prefix}[${bar}] ${value}`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'divider': {
        lines.push(`${prefix}${'─'.repeat(maxWidth)}`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'spacer': {
        const size = (node.props.size as number) || 1;
        for (let i = 0; i < Math.min(size, 3); i++) {
          lines.push(`${prefix}`.padEnd(64) + '║');
        }
        break;
      }

      case 'card': {
        const title = (node.props.title as string) || '';
        const boxWidth = Math.max(0, maxWidth - 2);
        lines.push(`${prefix}┌${'─'.repeat(boxWidth)}┐`.substring(0, 64).padEnd(64) + '║');
        if (title) {
          lines.push(`${prefix}│ ${title.padEnd(boxWidth - 2)} │`.substring(0, 64).padEnd(64) + '║');
          lines.push(`${prefix}├${'─'.repeat(boxWidth)}┤`.substring(0, 64).padEnd(64) + '║');
        }
        // Render children inside card
        for (const child of node.children) {
          this.renderNodeToTerminal(child, lines, indent + 1);
        }
        lines.push(`${prefix}└${'─'.repeat(boxWidth)}┘`.substring(0, 64).padEnd(64) + '║');
        // Skip default children rendering below
        break;
      }

      case 'code': {
        const code = (node.props.value as string) || '';
        const lang = (node.props.language as string) || '';
        const boxWidth = Math.max(0, maxWidth - 2);
        lines.push(`${prefix}┌── ${lang} ${'─'.repeat(Math.max(0, boxWidth - 6 - lang.length))}┐`.substring(0, 64).padEnd(64) + '║');
        const codeLines = code.split('\n').slice(0, 10);
        for (const codeLine of codeLines) {
          lines.push(`${prefix}│ ${codeLine.substring(0, boxWidth - 4).padEnd(boxWidth - 4)} │`.substring(0, 64).padEnd(64) + '║');
        }
        lines.push(`${prefix}└${'─'.repeat(boxWidth)}┘`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'progress': {
        const value = (node.props.value as number) || 0;
        const max = (node.props.max as number) || 100;
        const percent = Math.round((value / max) * 100);
        const barWidth = 20;
        const filled = Math.round((percent / 100) * barWidth);
        const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
        lines.push(`${prefix}[${bar}] ${percent}%`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'badge': {
        const value = String(node.props.value || '');
        lines.push(`${prefix}〔${value}〕`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'chip': {
        const label = (node.props.label as string) || '';
        lines.push(`${prefix}⌈${label}⌉`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'avatar': {
        const name = (node.props.name as string) || '?';
        const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        lines.push(`${prefix}(${initials})`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'image': {
        const alt = (node.props.alt as string) || 'image';
        lines.push(`${prefix}[🖼 ${alt}]`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'icon': {
        const name = (node.props.name as string) || 'icon';
        lines.push(`${prefix}[${name}]`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'markdown': {
        const md = (node.props.value as string) || '';
        const wrapped = this.wrapText(md, maxWidth);
        for (const line of wrapped.slice(0, 5)) {
          lines.push(`${prefix}${line}`.substring(0, 64).padEnd(64) + '║');
        }
        if (wrapped.length > 5) {
          lines.push(`${prefix}...`.substring(0, 64).padEnd(64) + '║');
        }
        break;
      }

      case 'table': {
        const columns = (node.props.columns as Array<{ key: string; label: string }>) || [];
        const data = (node.props.data as Array<Record<string, unknown>>) || [];

        // Header
        const header = columns.map(c => c.label.substring(0, 10).padEnd(10)).join('│');
        lines.push(`${prefix}┌${'─'.repeat(Math.min(maxWidth, header.length + 2))}┐`.substring(0, 64).padEnd(64) + '║');
        lines.push(`${prefix}│${header}│`.substring(0, 64).padEnd(64) + '║');
        lines.push(`${prefix}├${'─'.repeat(Math.min(maxWidth, header.length + 2))}┤`.substring(0, 64).padEnd(64) + '║');

        // Rows (max 5)
        for (const row of data.slice(0, 5)) {
          const rowStr = columns.map(c => String(row[c.key] || '').substring(0, 10).padEnd(10)).join('│');
          lines.push(`${prefix}│${rowStr}│`.substring(0, 64).padEnd(64) + '║');
        }
        if (data.length > 5) {
          lines.push(`${prefix}│ ... ${data.length - 5} more rows`.padEnd(maxWidth) + '│'.substring(0, 64).padEnd(64) + '║');
        }
        lines.push(`${prefix}└${'─'.repeat(Math.min(maxWidth, header.length + 2))}┘`.substring(0, 64).padEnd(64) + '║');
        break;
      }

      case 'row':
      case 'column':
      case 'list':
      case 'stack':
      case 'grid':
      default:
        // Container - just render children
        break;
    }

    // Render children (except for card which handles its own children)
    // Use explicit list of types that handle their own children
    const typesWithChildrenHandled = ['card'];
    if (!typesWithChildrenHandled.includes(node.type)) {
      for (const child of node.children) {
        this.renderNodeToTerminal(child, lines, indent + 1);
      }
    }
  }

  /**
   * Wrap text to fit within width
   */
  private wrapText(text: string, width: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if (currentLine.length + word.length + 1 <= width) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) {
          lines.push(currentLine);
        }
        currentLine = word;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length ? lines : [''];
  }

  // ==========================================================================
  // Rendering - HTML
  // ==========================================================================

  /**
   * Render surface to HTML
   */
  renderToHTML(surfaceId: string): string {
    const tree = this.buildComponentTree(surfaceId);
    if (!tree) {
      return `<div class="a2ui-error">Surface ${surfaceId} not found</div>`;
    }

    const surface = this.surfaces.get(surfaceId)!;
    const styles = surface.styles || DEFAULT_SURFACE_STYLES;

    const html: string[] = [];
    html.push(`<!DOCTYPE html>`);
    html.push(`<html>`);
    html.push(`<head>`);
    html.push(`  <meta charset="UTF-8">`);
    html.push(`  <meta name="viewport" content="width=device-width, initial-scale=1.0">`);
    const safeSurfaceId = this.escapeHTML(this.safeIdent(surfaceId, 'surface'));
    html.push(`  <title>A2UI Surface: ${safeSurfaceId}</title>`);
    html.push(`  <style>`);
    html.push(this.getDefaultCSS());
    html.push(`  </style>`);
    html.push(`</head>`);
    html.push(`<body style="${this.stylesToCSS(styles)}">`);
    html.push(`  <div class="a2ui-surface" data-surface-id="${safeSurfaceId}">`);
    html.push(this.renderNodeToHTML(tree, 4));
    html.push(`  </div>`);
    html.push(`  <script>`);
    html.push(this.getClientScript(surfaceId));
    html.push(`  </script>`);
    html.push(`</body>`);
    html.push(`</html>`);

    return html.join('\n');
  }

  /**
   * Render a component node to HTML
   */
  private renderNodeToHTML(node: RenderedComponent, indent: number): string {
    const pad = '  '.repeat(indent);
    const styles = (node.props.styles as A2UIStyles) || {};
    const styleAttr = this.stylesToCSS(styles);

    switch (node.type) {
      case 'heading': {
        const level = Math.min(6, Math.max(1, (node.props.level as number) || 1));
        const text = this.escapeHTML((node.props.value as string) || '');
        return `${pad}<h${level} class="a2ui-heading" style="${styleAttr}">${text}</h${level}>`;
      }

      case 'text': {
        const text = this.escapeHTML((node.props.value as string) || '');
        return `${pad}<p class="a2ui-text" style="${styleAttr}">${text}</p>`;
      }

      case 'button': {
        const label = this.escapeHTML((node.props.label as string) || 'Button');
        const variant = this.safeIdent((node.props.variant as string) || 'primary', 'primary');
        const disabled = node.props.disabled ? ' disabled' : '';
        const actionName = this.escapeHTML(this.safeIdent((node.props.action as { name?: string })?.name || ''));
        const id = this.escapeHTML(this.safeIdent(node.id, 'unknown'));
        return `${pad}<button class="a2ui-button a2ui-button--${variant}" data-action="${actionName}" data-component-id="${id}" style="${styleAttr}"${disabled}>${label}</button>`;
      }

      case 'textField': {
        const label = this.escapeHTML((node.props.label as string) || '');
        const value = this.escapeHTML((node.props.value as string) || '');
        const placeholder = this.escapeHTML((node.props.placeholder as string) || '');
        const type = this.safeIdent((node.props.type as string) || 'text', 'text');
        const disabled = node.props.disabled ? ' disabled' : '';
        const required = node.props.required ? ' required' : '';
        const id = this.escapeHTML(this.safeIdent(node.id, 'unknown'));
        let html = `${pad}<div class="a2ui-field" style="${styleAttr}">`;
        if (label) {
          html += `\n${pad}  <label class="a2ui-label">${label}</label>`;
        }
        html += `\n${pad}  <input type="${type}" class="a2ui-input" value="${value}" placeholder="${placeholder}" data-component-id="${id}"${disabled}${required}>`;
        html += `\n${pad}</div>`;
        return html;
      }

      case 'textArea': {
        const label = this.escapeHTML((node.props.label as string) || '');
        const value = this.escapeHTML((node.props.value as string) || '');
        const placeholder = this.escapeHTML((node.props.placeholder as string) || '');
        const rows = (node.props.rows as number) || 4;
        const disabled = node.props.disabled ? ' disabled' : '';
        let html = `${pad}<div class="a2ui-field" style="${styleAttr}">`;
        if (label) {
          html += `\n${pad}  <label class="a2ui-label">${label}</label>`;
        }
        html += `\n${pad}  <textarea class="a2ui-textarea" rows="${rows}" placeholder="${placeholder}" data-component-id="${node.id}"${disabled}>${value}</textarea>`;
        html += `\n${pad}</div>`;
        return html;
      }

      case 'checkbox': {
        const label = this.escapeHTML((node.props.label as string) || '');
        const checked = node.props.checked ? ' checked' : '';
        const disabled = node.props.disabled ? ' disabled' : '';
        return `${pad}<label class="a2ui-checkbox" style="${styleAttr}"><input type="checkbox" data-component-id="${node.id}"${checked}${disabled}> ${label}</label>`;
      }

      case 'switch': {
        const label = this.escapeHTML((node.props.label as string) || '');
        const checked = node.props.checked ? ' checked' : '';
        const disabled = node.props.disabled ? ' disabled' : '';
        return `${pad}<label class="a2ui-switch" style="${styleAttr}"><input type="checkbox" data-component-id="${node.id}"${checked}${disabled}><span class="a2ui-switch-slider"></span> ${label}</label>`;
      }

      case 'radio': {
        const label = this.escapeHTML((node.props.label as string) || '');
        const value = this.escapeHTML((node.props.value as string) || '');
        const disabled = node.props.disabled ? ' disabled' : '';
        return `${pad}<label class="a2ui-radio" style="${styleAttr}"><input type="radio" value="${value}" data-component-id="${node.id}"${disabled}> ${label}</label>`;
      }

      case 'select': {
        const label = this.escapeHTML((node.props.label as string) || '');
        const value = (node.props.value as string) || '';
        const options = (node.props.options as Array<{ value: string; label: string }>) || [];
        const disabled = node.props.disabled ? ' disabled' : '';
        let html = `${pad}<div class="a2ui-field" style="${styleAttr}">`;
        if (label) {
          html += `\n${pad}  <label class="a2ui-label">${label}</label>`;
        }
        html += `\n${pad}  <select class="a2ui-select" data-component-id="${node.id}"${disabled}>`;
        for (const opt of options) {
          const selected = opt.value === value ? ' selected' : '';
          html += `\n${pad}    <option value="${this.escapeHTML(opt.value)}"${selected}>${this.escapeHTML(opt.label)}</option>`;
        }
        html += `\n${pad}  </select>`;
        html += `\n${pad}</div>`;
        return html;
      }

      case 'slider': {
        const value = (node.props.value as number) || 0;
        const min = (node.props.min as number) || 0;
        const max = (node.props.max as number) || 100;
        const step = (node.props.step as number) || 1;
        const disabled = node.props.disabled ? ' disabled' : '';
        return `${pad}<input type="range" class="a2ui-slider" value="${value}" min="${min}" max="${max}" step="${step}" data-component-id="${node.id}" style="${styleAttr}"${disabled}>`;
      }

      case 'divider':
        return `${pad}<hr class="a2ui-divider" style="${styleAttr}">`;

      case 'spacer': {
        const size = (node.props.size as number) || 16;
        return `${pad}<div class="a2ui-spacer" style="height: ${size}px;"></div>`;
      }

      case 'card': {
        const title = this.escapeHTML((node.props.title as string) || '');
        const subtitle = this.escapeHTML((node.props.subtitle as string) || '');
        let html = `${pad}<div class="a2ui-card" style="${styleAttr}">`;
        if (title) {
          html += `\n${pad}  <div class="a2ui-card-header">`;
          html += `\n${pad}    <h3 class="a2ui-card-title">${title}</h3>`;
          if (subtitle) {
            html += `\n${pad}    <p class="a2ui-card-subtitle">${subtitle}</p>`;
          }
          html += `\n${pad}  </div>`;
        }
        html += `\n${pad}  <div class="a2ui-card-body">`;
        for (const child of node.children) {
          html += '\n' + this.renderNodeToHTML(child, indent + 2);
        }
        html += `\n${pad}  </div>`;
        html += `\n${pad}</div>`;
        return html;
      }

      case 'code': {
        const code = this.escapeHTML((node.props.value as string) || '');
        const lang = this.escapeHTML(this.safeIdent((node.props.language as string) || ''));
        return `${pad}<pre class="a2ui-code" data-language="${lang}" style="${styleAttr}"><code>${code}</code></pre>`;
      }

      case 'markdown': {
        const md = this.escapeHTML((node.props.value as string) || '');
        return `${pad}<div class="a2ui-markdown" style="${styleAttr}">${md}</div>`;
      }

      case 'image': {
        const src = this.safeSrc((node.props.src as string) || '');
        const alt = this.escapeHTML((node.props.alt as string) || '');
        if (!src) {
          return `${pad}<span class="a2ui-image a2ui-image--blocked" style="${styleAttr}" role="img" aria-label="${alt || 'image blocked'}"></span>`;
        }
        return `${pad}<img class="a2ui-image" src="${this.escapeHTML(src)}" alt="${alt}" style="${styleAttr}">`;
      }

      case 'progress': {
        const value = (node.props.value as number) || 0;
        const max = (node.props.max as number) || 100;
        const percent = Math.round((value / max) * 100);
        const showLabel = node.props.showLabel !== false;
        let html = `${pad}<div class="a2ui-progress" style="${styleAttr}">`;
        html += `\n${pad}  <div class="a2ui-progress-bar" style="width: ${percent}%;"></div>`;
        if (showLabel) {
          html += `\n${pad}  <span class="a2ui-progress-label">${percent}%</span>`;
        }
        html += `\n${pad}</div>`;
        return html;
      }

      case 'badge': {
        const value = this.escapeHTML(String(node.props.value || ''));
        const variant = this.safeIdent((node.props.variant as string) || 'default', 'default');
        return `${pad}<span class="a2ui-badge a2ui-badge--${variant}" style="${styleAttr}">${value}</span>`;
      }

      case 'chip': {
        const label = this.escapeHTML((node.props.label as string) || '');
        const actionName = this.escapeHTML(this.safeIdent((node.props.action as { name?: string })?.name || ''));
        const id = this.escapeHTML(this.safeIdent(node.id, 'unknown'));
        return `${pad}<span class="a2ui-chip" data-action="${actionName}" data-component-id="${id}" style="${styleAttr}">${label}</span>`;
      }

      case 'avatar': {
        const src = this.safeSrc((node.props.src as string) || '');
        const name = this.escapeHTML((node.props.name as string) || '');
        const size = typeof node.props.size === 'number' && Number.isFinite(node.props.size) ? node.props.size : 40;
        if (src) {
          return `${pad}<img class="a2ui-avatar" src="${this.escapeHTML(src)}" alt="${name}" style="width: ${size}px; height: ${size}px; ${styleAttr}">`;
        }
        const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        return `${pad}<div class="a2ui-avatar a2ui-avatar--initials" style="width: ${size}px; height: ${size}px; ${styleAttr}">${initials}</div>`;
      }

      case 'row': {
        let html = `${pad}<div class="a2ui-row" style="display: flex; flex-direction: row; ${styleAttr}">`;
        for (const child of node.children) {
          html += '\n' + this.renderNodeToHTML(child, indent + 1);
        }
        html += `\n${pad}</div>`;
        return html;
      }

      case 'column': {
        let html = `${pad}<div class="a2ui-column" style="display: flex; flex-direction: column; ${styleAttr}">`;
        for (const child of node.children) {
          html += '\n' + this.renderNodeToHTML(child, indent + 1);
        }
        html += `\n${pad}</div>`;
        return html;
      }

      case 'list': {
        const dividers = node.props.dividers !== false;
        let html = `${pad}<ul class="a2ui-list${dividers ? ' a2ui-list--dividers' : ''}" style="${styleAttr}">`;
        for (const child of node.children) {
          html += `\n${pad}  <li class="a2ui-list-item">`;
          html += '\n' + this.renderNodeToHTML(child, indent + 2);
          html += `\n${pad}  </li>`;
        }
        html += `\n${pad}</ul>`;
        return html;
      }

      case 'table': {
        const columns = (node.props.columns as Array<{ key: string; label: string; width?: string | number }>) || [];
        const data = (node.props.data as Array<Record<string, unknown>>) || [];
        let html = `${pad}<table class="a2ui-table" style="${styleAttr}">`;
        html += `\n${pad}  <thead><tr>`;
        for (const col of columns) {
          const width = col.width ? ` style="width: ${typeof col.width === 'number' ? col.width + 'px' : col.width}"` : '';
          html += `<th${width}>${this.escapeHTML(col.label)}</th>`;
        }
        html += `</tr></thead>`;
        html += `\n${pad}  <tbody>`;
        for (const row of data) {
          html += `\n${pad}    <tr>`;
          for (const col of columns) {
            html += `<td>${this.escapeHTML(String(row[col.key] || ''))}</td>`;
          }
          html += `</tr>`;
        }
        html += `\n${pad}  </tbody>`;
        html += `\n${pad}</table>`;
        return html;
      }

      default: {
        let html = `${pad}<div class="a2ui-${node.type}" data-component-id="${node.id}" style="${styleAttr}">`;
        for (const child of node.children) {
          html += '\n' + this.renderNodeToHTML(child, indent + 1);
        }
        html += `\n${pad}</div>`;
        return html;
      }
    }
  }

  /**
   * Convert A2UIStyles to CSS string
   */
  private stylesToCSS(styles: A2UIStyles): string {
    const cssProps: string[] = [];
    const push = (prop: string, raw: unknown, asPx = false) => {
      if (raw === undefined || raw === null) return;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        cssProps.push(`${prop}: ${asPx ? `${raw}px` : raw}`);
        return;
      }
      const v = sanitizeCssValue(raw);
      if (v) cssProps.push(`${prop}: ${v}`);
    };

    push('width', styles.width, true);
    push('height', styles.height, true);
    push('min-width', styles.minWidth, true);
    push('min-height', styles.minHeight, true);
    push('max-width', styles.maxWidth, true);
    push('max-height', styles.maxHeight, true);
    push('padding', styles.padding, true);
    push('margin', styles.margin, true);
    push('gap', styles.gap, true);
    push('flex', styles.flex);
    push('flex-grow', styles.flexGrow);
    push('flex-shrink', styles.flexShrink);
    push('align-items', styles.alignItems);
    push('justify-content', styles.justifyContent);
    push('align-self', styles.alignSelf);
    push('background-color', styles.backgroundColor);
    push('color', styles.color);
    push('font-size', styles.fontSize, true);
    push('font-weight', styles.fontWeight);
    push('font-family', styles.fontFamily);
    push('text-align', styles.textAlign);
    push('text-decoration', styles.textDecoration);
    push('border-radius', styles.borderRadius, true);
    push('border-color', styles.borderColor);
    if (styles.borderWidth !== undefined && Number.isFinite(styles.borderWidth as number)) {
      cssProps.push(`border-width: ${styles.borderWidth}px`);
    }
    push('border-style', styles.borderStyle);
    push('opacity', styles.opacity);
    push('overflow', styles.overflow);
    push('box-shadow', styles.shadow);
    push('display', styles.display);
    push('visibility', styles.visibility);

    return cssProps.join('; ');
  }

  /**
   * Convert value to CSS value string (fail-closed).
   */
  private toCSSValue(value: string | number): string {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? `${value}px` : '';
    }
    return sanitizeCssValue(value);
  }

  /**
   * Escape HTML special characters
   */
  private escapeHTML(str: string): string {
    return guardEscapeHtml(str);
  }

  /** Fail-closed id / action / class token for attributes. */
  private safeIdent(str: string, fallback = ''): string {
    return safeToken(str, fallback);
  }

  /** Fail-closed URL for img/avatar src (http(s), relative, data:image). */
  private safeSrc(str: string): string {
    return safeUrl(str, { allowDataImage: true, allowRelative: true });
  }

  /**
   * Get default CSS styles
   */
  private getDefaultCSS(): string {
    return `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
    .a2ui-surface { padding: 16px; }
    .a2ui-heading { margin: 0 0 8px 0; }
    .a2ui-text { margin: 0 0 8px 0; line-height: 1.5; }
    .a2ui-button {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      transition: opacity 0.2s;
    }
    .a2ui-button:hover { opacity: 0.9; }
    .a2ui-button--primary { background: #3b82f6; color: white; }
    .a2ui-button--secondary { background: #6b7280; color: white; }
    .a2ui-button--outline { background: transparent; border: 1px solid #3b82f6; color: #3b82f6; }
    .a2ui-button--ghost { background: transparent; color: #3b82f6; }
    .a2ui-button--danger { background: #ef4444; color: white; }
    .a2ui-button:disabled { opacity: 0.5; cursor: not-allowed; }
    .a2ui-field { margin-bottom: 12px; }
    .a2ui-label { display: block; margin-bottom: 4px; font-weight: 500; }
    .a2ui-input, .a2ui-textarea, .a2ui-select {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 14px;
      transition: border-color 0.2s;
    }
    .a2ui-input:focus, .a2ui-textarea:focus, .a2ui-select:focus {
      outline: none;
      border-color: #3b82f6;
    }
    .a2ui-checkbox, .a2ui-radio { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .a2ui-switch { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .a2ui-switch input { display: none; }
    .a2ui-switch-slider {
      width: 40px; height: 20px;
      background: #d1d5db;
      border-radius: 10px;
      position: relative;
      transition: background 0.2s;
    }
    .a2ui-switch-slider::after {
      content: '';
      position: absolute;
      width: 16px; height: 16px;
      background: white;
      border-radius: 50%;
      top: 2px; left: 2px;
      transition: transform 0.2s;
    }
    .a2ui-switch input:checked + .a2ui-switch-slider { background: #3b82f6; }
    .a2ui-switch input:checked + .a2ui-switch-slider::after { transform: translateX(20px); }
    .a2ui-slider { width: 100%; }
    .a2ui-divider { border: none; border-top: 1px solid #e5e7eb; margin: 16px 0; }
    .a2ui-card {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 16px;
    }
    .a2ui-card-header { padding: 16px; border-bottom: 1px solid #e5e7eb; }
    .a2ui-card-title { margin: 0; font-size: 18px; }
    .a2ui-card-subtitle { margin: 4px 0 0 0; color: #6b7280; font-size: 14px; }
    .a2ui-card-body { padding: 16px; }
    .a2ui-code {
      background: #1e293b;
      color: #e2e8f0;
      padding: 16px;
      border-radius: 4px;
      overflow-x: auto;
      font-family: 'Fira Code', 'Consolas', monospace;
      font-size: 13px;
      line-height: 1.5;
    }
    .a2ui-markdown { line-height: 1.6; }
    .a2ui-progress {
      height: 8px;
      background: #e5e7eb;
      border-radius: 4px;
      overflow: hidden;
      position: relative;
    }
    .a2ui-progress-bar {
      height: 100%;
      background: #3b82f6;
      transition: width 0.3s ease;
    }
    .a2ui-progress-label {
      position: absolute;
      right: 0;
      top: -20px;
      font-size: 12px;
    }
    .a2ui-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
    }
    .a2ui-badge--default { background: #e5e7eb; color: #374151; }
    .a2ui-badge--primary { background: #dbeafe; color: #1d4ed8; }
    .a2ui-badge--success { background: #dcfce7; color: #15803d; }
    .a2ui-badge--warning { background: #fef3c7; color: #b45309; }
    .a2ui-badge--danger { background: #fee2e2; color: #b91c1c; }
    .a2ui-chip {
      display: inline-flex;
      align-items: center;
      padding: 4px 12px;
      background: #f3f4f6;
      border-radius: 9999px;
      font-size: 14px;
      cursor: pointer;
    }
    .a2ui-chip:hover { background: #e5e7eb; }
    .a2ui-avatar {
      border-radius: 50%;
      object-fit: cover;
    }
    .a2ui-avatar--initials {
      display: flex;
      align-items: center;
      justify-content: center;
      background: #3b82f6;
      color: white;
      font-weight: 600;
    }
    .a2ui-row { display: flex; gap: 16px; }
    .a2ui-column { display: flex; flex-direction: column; gap: 16px; }
    .a2ui-list { list-style: none; padding: 0; margin: 0; }
    .a2ui-list--dividers .a2ui-list-item { border-bottom: 1px solid #e5e7eb; }
    .a2ui-list--dividers .a2ui-list-item:last-child { border-bottom: none; }
    .a2ui-list-item { padding: 12px 0; }
    .a2ui-table { width: 100%; border-collapse: collapse; }
    .a2ui-table th, .a2ui-table td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e5e7eb;
    }
    .a2ui-table th { font-weight: 600; background: #f9fafb; }
    .a2ui-table tr:hover { background: #f9fafb; }
    .a2ui-image { max-width: 100%; height: auto; }
    `;
  }

  /**
   * Get client-side JavaScript for user actions
   */
  private getClientScript(surfaceId: string): string {
    const safeId = this.safeIdent(surfaceId, 'surface');
    return `
    (function() {
      const surface = document.querySelector('[data-surface-id="${safeId}"]');
      if (!surface) return;

      function sendCanvasEvent(componentId, eventType, value) {
        const event = {
          canvasEvent: {
            surfaceId: '${safeId}',
            componentId: componentId,
            eventType: eventType,
            value: value,
            timestamp: Date.now()
          }
        };
        if (window.a2uiSocket && window.a2uiSocket.readyState === 1) {
          window.a2uiSocket.send(JSON.stringify(event));
        }
        document.dispatchEvent(new CustomEvent('a2ui:canvasEvent', { detail: event }));
      }

      // Handle button clicks
      surface.addEventListener('click', function(e) {
        const button = e.target.closest('[data-action]');
        if (button && button.dataset.action) {
          const componentId = button.dataset.componentId || '';
          sendCanvasEvent(componentId, 'click', button.dataset.action);
          // Also emit legacy userAction
          var action = {
            userAction: {
              name: button.dataset.action,
              surfaceId: '${safeId}',
              componentId: componentId,
              context: {}
            }
          };
          if (window.a2uiSocket && window.a2uiSocket.readyState === 1) {
            window.a2uiSocket.send(JSON.stringify(action));
          }
          document.dispatchEvent(new CustomEvent('a2ui:action', { detail: action }));
        }
      });

      // Handle input changes
      surface.addEventListener('change', function(e) {
        var input = e.target;
        if (input.dataset && input.dataset.componentId) {
          var value = input.type === 'checkbox' ? input.checked : input.value;
          sendCanvasEvent(input.dataset.componentId, 'input_change', value);
        }
      });

      // Handle select changes
      surface.addEventListener('change', function(e) {
        var select = e.target;
        if (select.tagName === 'SELECT' && select.dataset && select.dataset.componentId) {
          sendCanvasEvent(select.dataset.componentId, 'select', select.value);
        }
      });

      // Handle form submissions
      surface.addEventListener('submit', function(e) {
        e.preventDefault();
        var form = e.target;
        var formData = {};
        var inputs = form.querySelectorAll('[data-component-id]');
        inputs.forEach(function(input) {
          formData[input.dataset.componentId] = input.type === 'checkbox' ? input.checked : input.value;
        });
        var surfaceEl = form.closest('[data-surface-id]');
        var surfaceId = surfaceEl ? surfaceEl.dataset.surfaceId : '${surfaceId}';
        sendCanvasEvent(form.dataset.componentId || 'form', 'submit', formData);
      });
    })();
    `;
  }

  // ==========================================================================
  // Data Observers (reactive binding)
  // ==========================================================================

  /**
   * Observe changes to a data path in a surface.
   * The callback fires whenever processDataModelUpdate touches the observed path.
   */
  observeDataPath(surfaceId: string, dataPath: string, callback: (value: unknown) => void): void {
    if (!this.dataObservers.has(surfaceId)) {
      this.dataObservers.set(surfaceId, new Map());
    }
    const surfaceObservers = this.dataObservers.get(surfaceId)!;
    if (!surfaceObservers.has(dataPath)) {
      surfaceObservers.set(dataPath, []);
    }
    surfaceObservers.get(dataPath)!.push(callback);
  }

  /**
   * Remove all observers for a surface.
   */
  removeDataObservers(surfaceId: string): void {
    this.dataObservers.delete(surfaceId);
  }

  /**
   * Notify data observers when data changes.
   * Called from processDataModelUpdate.
   */
  private notifyDataObservers(surfaceId: string, updatedPath: string | undefined): void {
    const surfaceObservers = this.dataObservers.get(surfaceId);
    if (!surfaceObservers) return;

    const surface = this.surfaces.get(surfaceId);
    if (!surface) return;

    for (const [observedPath, callbacks] of surfaceObservers) {
      // Fire if the update is at the root or matches/overlaps the observed path
      const shouldFire = !updatedPath ||
        observedPath.startsWith(updatedPath) ||
        updatedPath.startsWith(observedPath);

      if (shouldFire) {
        const value = this.getNestedValue(surface.dataModel, observedPath);
        for (const cb of callbacks) {
          try {
            cb(value);
          } catch {
            // Ignore observer errors
          }
        }
      }
    }
  }

  // ==========================================================================
  // State Queries (for agent access)
  // ==========================================================================

  /**
   * Get a value from a surface's data model by dot-path.
   */
  getDataValue(surfaceId: string, dataPath: string): unknown {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return undefined;
    return this.getNestedValue(surface.dataModel, dataPath);
  }

  /**
   * Get the full data model for a surface.
   */
  getDataModel(surfaceId: string): Record<string, unknown> | undefined {
    return this.surfaces.get(surfaceId)?.dataModel;
  }

  /**
   * Get a component by ID from a surface.
   */
  getComponent(surfaceId: string, componentId: string): A2UIComponent | undefined {
    return this.surfaces.get(surfaceId)?.components.get(componentId);
  }

  /**
   * Get a full snapshot of a surface (components, data, state).
   */
  getSurfaceSnapshot(surfaceId: string): {
    id: string;
    visible: boolean;
    root?: string;
    componentCount: number;
    components: Array<{ id: string; type: string }>;
    dataModel: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  } | null {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return null;

    const components = Array.from(surface.components.values()).map(c => ({
      id: c.id,
      type: Object.keys(c.component)[0] ?? '',
    }));

    return {
      id: surface.id,
      visible: surface.visible,
      root: surface.root,
      componentCount: components.length,
      components,
      dataModel: { ...surface.dataModel },
      createdAt: surface.createdAt.toISOString(),
      updatedAt: surface.updatedAt.toISOString(),
    };
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Clear all surfaces
   */
  clear(): void {
    const surfaceIds = Array.from(this.surfaces.keys());
    this.surfaces.clear();
    for (const id of surfaceIds) {
      this.emit('surface:deleted', id);
    }
  }

  /**
   * Get surface count
   */
  getSurfaceCount(): number {
    return this.surfaces.size;
  }

  /**
   * Shutdown manager
   */
  shutdown(): void {
    this.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let a2uiManagerInstance: A2UIManager | null = null;

/**
 * Get singleton A2UI Manager instance
 */
export function getA2UIManager(): A2UIManager {
  if (!a2uiManagerInstance) {
    a2uiManagerInstance = new A2UIManager();
  }
  return a2uiManagerInstance;
}

/**
 * Reset A2UI Manager (for testing)
 */
export function resetA2UIManager(): void {
  if (a2uiManagerInstance) {
    a2uiManagerInstance.shutdown();
  }
  a2uiManagerInstance = null;
}

export default A2UIManager;
