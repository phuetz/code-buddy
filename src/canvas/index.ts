/**
 * Canvas Manager - Dynamic Terminal UI Components
 *
 * Provides A2UI-style dynamic rendering for terminal interfaces.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export type ComponentType = 'text' | 'box' | 'panel' | 'progress' | 'spinner' | 'table' | 'list' | 'input';

export interface ComponentStyle {
  color?: string;
  bgColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
  border?: 'single' | 'double' | 'rounded' | 'none';
  padding?: number | { top?: number; right?: number; bottom?: number; left?: number };
  margin?: number | { top?: number; right?: number; bottom?: number; left?: number };
  width?: number | string;
  height?: number | string;
  align?: 'left' | 'center' | 'right';
}

export interface CanvasComponent {
  id: string;
  type: ComponentType;
  content: string | string[] | CanvasComponent[];
  style?: ComponentStyle;
  visible: boolean;
  zIndex: number;
  x?: number;
  y?: number;
}

export interface CanvasConfig {
  width: number;
  height: number;
  refreshRate: number;
  clearOnRender: boolean;
}

export const DEFAULT_CANVAS_CONFIG: CanvasConfig = {
  width: 80,
  height: 24,
  refreshRate: 60,
  clearOnRender: true,
};

// ============================================================================
// ANSI Helpers
// ============================================================================

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  colors: {
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
  } as Record<string, string>,

  bgColors: {
    black: '\x1b[40m',
    red: '\x1b[41m',
    green: '\x1b[42m',
    yellow: '\x1b[43m',
    blue: '\x1b[44m',
    magenta: '\x1b[45m',
    cyan: '\x1b[46m',
    white: '\x1b[47m',
  } as Record<string, string>,

  cursor: {
    hide: '\x1b[?25l',
    show: '\x1b[?25h',
    home: '\x1b[H',
    clear: '\x1b[2J',
    moveTo: (x: number, y: number) => `\x1b[${y};${x}H`,
  },

  box: {
    single: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
    double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
    rounded: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
  } as Record<string, { tl: string; tr: string; bl: string; br: string; h: string; v: string }>,
};

function applyStyle(text: string, style?: ComponentStyle): string {
  if (!style) return text;

  let result = '';

  if (style.bold) result += ANSI.bold;
  if (style.dim) result += ANSI.dim;
  if (style.italic) result += ANSI.italic;
  if (style.underline) result += ANSI.underline;
  if (style.color && ANSI.colors[style.color]) result += ANSI.colors[style.color];
  if (style.bgColor && ANSI.bgColors[style.bgColor]) result += ANSI.bgColors[style.bgColor];

  result += text + ANSI.reset;
  return result;
}

// ============================================================================
// Component Factory
// ============================================================================

let componentIdCounter = 0;

export function createComponent(
  type: ComponentType,
  content: string | string[] | CanvasComponent[],
  style?: ComponentStyle
): CanvasComponent {
  return {
    id: `comp-${++componentIdCounter}`,
    type,
    content,
    style,
    visible: true,
    zIndex: 0,
  };
}

export function createText(text: string, style?: ComponentStyle): CanvasComponent {
  return createComponent('text', text, style);
}

export function createBox(content: string | CanvasComponent[], style?: ComponentStyle): CanvasComponent {
  return createComponent('box', Array.isArray(content) ? content : [createText(content)], {
    border: 'single',
    ...style,
  });
}

export function createPanel(title: string, content: CanvasComponent[], style?: ComponentStyle): CanvasComponent {
  return createComponent('panel', [createText(title), ...content], {
    border: 'rounded',
    ...style,
  });
}

export function createProgress(percent: number, width: number = 20, style?: ComponentStyle): CanvasComponent {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return createComponent('progress', `[${bar}] ${percent}%`, style);
}

export function createSpinner(frame: number = 0, style?: ComponentStyle): CanvasComponent {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  return createComponent('spinner', frames[frame % frames.length], style);
}

export function createTable(
  headers: string[],
  rows: string[][],
  style?: ComponentStyle
): CanvasComponent {
  const lines: string[] = [];
  const colWidths = headers.map((h, i) => {
    const maxRow = Math.max(...rows.map(r => (r[i] || '').length));
    return Math.max(h.length, maxRow);
  });

  // Header
  lines.push(headers.map((h, i) => h.padEnd(colWidths[i])).join(' │ '));
  lines.push(colWidths.map(w => '─'.repeat(w)).join('─┼─'));

  // Rows
  for (const row of rows) {
    lines.push(row.map((c, i) => (c || '').padEnd(colWidths[i])).join(' │ '));
  }

  return createComponent('table', lines, style);
}

export function createList(items: string[], style?: ComponentStyle): CanvasComponent {
  return createComponent('list', items.map((item, i) => `${i + 1}. ${item}`), style);
}

// ============================================================================
// Canvas Renderer
// ============================================================================

export class CanvasRenderer {
  private buffer: string[][] = [];
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.clear();
  }

  clear(): void {
    this.buffer = Array(this.height).fill(null).map(() => Array(this.width).fill(' '));
  }

  drawText(text: string, x: number, y: number, style?: ComponentStyle): void {
    const styledText = applyStyle(text, style);
    const chars = [...text];

    for (let i = 0; i < chars.length && x + i < this.width; i++) {
      if (y >= 0 && y < this.height && x + i >= 0) {
        this.buffer[y][x + i] = chars[i];
      }
    }
  }

  drawBox(x: number, y: number, width: number, height: number, style?: ComponentStyle): void {
    const border = style?.border ?? 'single';
    if (border === 'none') return;

    const chars = ANSI.box[border] || ANSI.box.single;

    // Corners
    this.drawText(chars.tl, x, y, style);
    this.drawText(chars.tr, x + width - 1, y, style);
    this.drawText(chars.bl, x, y + height - 1, style);
    this.drawText(chars.br, x + width - 1, y + height - 1, style);

    // Horizontal lines
    for (let i = 1; i < width - 1; i++) {
      this.drawText(chars.h, x + i, y, style);
      this.drawText(chars.h, x + i, y + height - 1, style);
    }

    // Vertical lines
    for (let i = 1; i < height - 1; i++) {
      this.drawText(chars.v, x, y + i, style);
      this.drawText(chars.v, x + width - 1, y + i, style);
    }
  }

  render(): string {
    return this.buffer.map(row => row.join('')).join('\n');
  }

  toString(): string {
    return this.render();
  }
}

// ============================================================================
// Canvas Manager
// ============================================================================

export class CanvasManager extends EventEmitter {
  private config: CanvasConfig;
  private components: Map<string, CanvasComponent> = new Map();
  private renderer: CanvasRenderer;
  private renderInterval: NodeJS.Timeout | null = null;
  private dirty = true;

  constructor(config: Partial<CanvasConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CANVAS_CONFIG, ...config };
    this.renderer = new CanvasRenderer(this.config.width, this.config.height);
  }

  add(component: CanvasComponent): string {
    this.components.set(component.id, component);
    this.dirty = true;
    return component.id;
  }

  remove(id: string): boolean {
    const removed = this.components.delete(id);
    if (removed) this.dirty = true;
    return removed;
  }

  get(id: string): CanvasComponent | undefined {
    return this.components.get(id);
  }

  update(id: string, updates: Partial<CanvasComponent>): boolean {
    const component = this.components.get(id);
    if (!component) return false;

    Object.assign(component, updates);
    this.dirty = true;
    return true;
  }

  show(id: string): void {
    this.update(id, { visible: true });
  }

  hide(id: string): void {
    this.update(id, { visible: false });
  }

  clear(): void {
    this.components.clear();
    this.dirty = true;
  }

  render(): string {
    if (this.config.clearOnRender) {
      this.renderer.clear();
    }

    // Sort by zIndex
    const sorted = [...this.components.values()]
      .filter(c => c.visible)
      .sort((a, b) => a.zIndex - b.zIndex);

    let y = 0;
    for (const component of sorted) {
      const x = component.x ?? 0;
      const startY = component.y ?? y;

      this.renderComponent(component, x, startY);

      if (component.y === undefined) {
        y = startY + this.getComponentHeight(component);
      }
    }

    this.dirty = false;
    return this.renderer.render();
  }

  private renderComponent(component: CanvasComponent, x: number, y: number): void {
    switch (component.type) {
      case 'text':
        this.renderer.drawText(component.content as string, x, y, component.style);
        break;

      case 'progress':
      case 'spinner':
        this.renderer.drawText(component.content as string, x, y, component.style);
        break;

      case 'list':
      case 'table':
        const lines = component.content as string[];
        for (let i = 0; i < lines.length; i++) {
          this.renderer.drawText(lines[i], x, y + i, component.style);
        }
        break;

      case 'box':
      case 'panel':
        const width = typeof component.style?.width === 'number' ? component.style.width : 40;
        const height = typeof component.style?.height === 'number' ? component.style.height : 10;
        this.renderer.drawBox(x, y, width, height, component.style);

        // Render children
        const children = component.content as CanvasComponent[];
        let childY = y + 1;
        for (const child of children) {
          this.renderComponent(child, x + 2, childY);
          childY += this.getComponentHeight(child);
        }
        break;
    }
  }

  private getComponentHeight(component: CanvasComponent): number {
    if (Array.isArray(component.content)) {
      if (component.type === 'list' || component.type === 'table') {
        return (component.content as string[]).length;
      }
      return (component.content as CanvasComponent[]).reduce((sum, c) => sum + this.getComponentHeight(c), 0);
    }
    return 1;
  }

  startAutoRender(): void {
    if (this.renderInterval) return;

    const interval = Math.floor(1000 / this.config.refreshRate);
    this.renderInterval = setInterval(() => {
      if (this.dirty) {
        const output = this.render();
        this.emit('render', output);
      }
    }, interval);
  }

  stopAutoRender(): void {
    if (this.renderInterval) {
      clearInterval(this.renderInterval);
      this.renderInterval = null;
    }
  }

  getStats(): { componentCount: number; visibleCount: number; dirty: boolean } {
    return {
      componentCount: this.components.size,
      visibleCount: [...this.components.values()].filter(c => c.visible).length,
      dirty: this.dirty,
    };
  }
}

// Singleton
let canvasInstance: CanvasManager | null = null;

export function getCanvasManager(config?: Partial<CanvasConfig>): CanvasManager {
  if (!canvasInstance) {
    canvasInstance = new CanvasManager(config);
  }
  return canvasInstance;
}

export function resetCanvasManager(): void {
  if (canvasInstance) {
    canvasInstance.stopAutoRender();
    canvasInstance.clear();
    canvasInstance = null;
  }
}
