/**
 * RenderManager - Central rendering orchestrator
 *
 * Routes data to the appropriate specialized renderer based on data type.
 * Falls back to generic JSON/text rendering if no specialized renderer matches.
 */

import {
  Renderer,
  RenderContext,
  getDefaultRenderContext,
  DisplayMode,
} from './types.js';

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: RenderManager | null = null;

/**
 * Get the singleton RenderManager instance
 */
export function getRenderManager(): RenderManager {
  if (!instance) {
    instance = new RenderManager();
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetRenderManager(): void {
  instance = null;
}

// ============================================================================
// RenderManager Class
// ============================================================================

/**
 * Central manager for rendering structured data to terminal output
 */
export class RenderManager {
  private renderers: Renderer[] = [];
  private context: RenderContext;

  constructor(context?: Partial<RenderContext>) {
    this.context = {
      ...getDefaultRenderContext(),
      ...context,
    };
  }

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  /**
   * Register a renderer
   * @param renderer - Renderer to register
   */
  register<T>(renderer: Renderer<T>): this {
    // Remove existing renderer with same ID
    this.renderers = this.renderers.filter(r => r.id !== renderer.id);
    this.renderers.push(renderer as Renderer);
    // Sort by priority (higher first)
    this.renderers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return this;
  }

  /**
   * Unregister a renderer by ID
   * @param id - Renderer ID to remove
   */
  unregister(id: string): this {
    this.renderers = this.renderers.filter(r => r.id !== id);
    return this;
  }

  /**
   * Get all registered renderers
   */
  getRenderers(): Renderer[] {
    return [...this.renderers];
  }

  /**
   * Get a renderer by ID
   */
  getRenderer(id: string): Renderer | undefined {
    return this.renderers.find(r => r.id === id);
  }

  /**
   * Update render context
   * @param updates - Partial context updates
   */
  setContext(updates: Partial<RenderContext>): this {
    this.context = { ...this.context, ...updates };
    return this;
  }

  /**
   * Get current render context
   */
  getContext(): RenderContext {
    return { ...this.context };
  }

  /**
   * Set display mode
   */
  setMode(mode: DisplayMode): this {
    this.context.mode = mode;
    return this;
  }

  /**
   * Enable/disable colors
   */
  setColor(enabled: boolean): this {
    this.context.color = enabled;
    return this;
  }

  /**
   * Enable/disable emojis
   */
  setEmoji(enabled: boolean): this {
    this.context.emoji = enabled;
    return this;
  }

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  /**
   * Find a renderer that can handle the given data
   * @param data - Data to find renderer for
   * @returns The matching renderer or undefined
   */
  findRenderer(data: unknown): Renderer | undefined {
    return this.renderers.find(r => r.canRender(data));
  }

  /**
   * Render data using the appropriate renderer
   * @param data - Data to render
   * @param contextOverrides - Optional context overrides for this render
   * @returns Rendered string
   */
  render(data: unknown, contextOverrides?: Partial<RenderContext>): string {
    const ctx = contextOverrides
      ? { ...this.context, ...contextOverrides }
      : this.context;

    // Find matching renderer
    const renderer = this.findRenderer(data);

    if (renderer) {
      try {
        return renderer.render(data, ctx);
      } catch (error) {
        // Fall back to generic on error
        console.error(`Renderer ${renderer.id} failed:`, error);
      }
    }

    // Fallback: generic rendering
    return this.renderGeneric(data, ctx);
  }

  /**
   * Render multiple items
   * @param items - Array of data items to render
   * @param separator - Separator between items (default: newline)
   * @returns Combined rendered string
   */
  renderAll(items: unknown[], separator = '\n'): string {
    return items.map(item => this.render(item)).join(separator);
  }

  /**
   * Check if any registered renderer can handle the data
   */
  canRender(data: unknown): boolean {
    return this.renderers.some(r => r.canRender(data));
  }

  // --------------------------------------------------------------------------
  // Generic Fallback Rendering
  // --------------------------------------------------------------------------

  /**
   * Generic fallback renderer for unknown data types
   */
  private renderGeneric(data: unknown, ctx: RenderContext): string {
    if (data === null) return ctx.mode === 'fancy' ? 'null' : 'null';
    if (data === undefined) return ctx.mode === 'fancy' ? 'undefined' : 'undefined';

    if (typeof data === 'string') {
      return data;
    }

    if (typeof data === 'number' || typeof data === 'boolean') {
      return String(data);
    }

    if (Array.isArray(data)) {
      return this.renderArray(data, ctx);
    }

    if (typeof data === 'object') {
      return this.renderObject(data as Record<string, unknown>, ctx);
    }

    return String(data);
  }

  /**
   * Render an array
   */
  private renderArray(arr: unknown[], ctx: RenderContext): string {
    if (arr.length === 0) return '[]';

    if (ctx.mode === 'plain') {
      return JSON.stringify(arr, null, 2);
    }

    // Check if all items are simple values
    const allSimple = arr.every(
      item => typeof item !== 'object' || item === null
    );

    if (allSimple && arr.length <= 10) {
      return `[${arr.map(item => this.formatValue(item, ctx)).join(', ')}]`;
    }

    // Render as list
    const lines = arr.map((item, i) => {
      const bullet = ctx.emoji ? '•' : '-';
      const rendered = typeof item === 'object' && item !== null
        ? this.renderGeneric(item, ctx).split('\n').map((l, j) => j === 0 ? l : '  ' + l).join('\n')
        : this.formatValue(item, ctx);
      return `${bullet} ${rendered}`;
    });

    return lines.join('\n');
  }

  /**
   * Render an object
   */
  private renderObject(obj: Record<string, unknown>, ctx: RenderContext): string {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';

    if (ctx.mode === 'plain') {
      return JSON.stringify(obj, null, 2);
    }

    // Check for special rendering hints
    if ('type' in obj && typeof obj.type === 'string') {
      // Has a type field but no renderer matched - show type info
      const lines = [`[${obj.type}]`];
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'type') continue;
        lines.push(`  ${key}: ${this.formatValue(value, ctx)}`);
      }
      return lines.join('\n');
    }

    // Standard key-value rendering
    const maxKeyLen = Math.min(20, Math.max(...keys.map(k => k.length)));
    const lines = keys.map(key => {
      const value = obj[key];
      const paddedKey = key.padEnd(maxKeyLen);
      const formatted = this.formatValue(value, ctx);
      return `${paddedKey}: ${formatted}`;
    });

    return lines.join('\n');
  }

  /**
   * Format a single value for display
   */
  private formatValue(value: unknown, ctx: RenderContext): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    if (typeof value === 'string') {
      // Truncate long strings
      if (value.length > 100) {
        return `"${value.slice(0, 97)}..."`;
      }
      return `"${value}"`;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      if (value.length <= 3) {
        return `[${value.map(v => this.formatValue(v, ctx)).join(', ')}]`;
      }
      return `[${value.length} items]`;
    }

    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length === 0) return '{}';
      if (keys.length <= 3) {
        return `{${keys.join(', ')}}`;
      }
      return `{${keys.length} keys}`;
    }

    return String(value);
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Render data using the global RenderManager
 * @param data - Data to render
 * @param ctx - Optional context overrides
 */
export function renderResponse(data: unknown, ctx?: Partial<RenderContext>): string {
  return getRenderManager().render(data, ctx);
}

/**
 * Register a renderer with the global RenderManager
 * @param renderer - Renderer to register
 */
export function registerRenderer<T>(renderer: Renderer<T>): void {
  getRenderManager().register(renderer);
}

/**
 * Configure global render context from CLI options
 */
export function configureRenderContext(options: {
  plain?: boolean;
  noColor?: boolean;
  noEmoji?: boolean;
  width?: number;
}): void {
  const manager = getRenderManager();

  if (options.plain) {
    manager.setMode('plain');
  }

  if (options.noColor) {
    manager.setColor(false);
  }

  if (options.noEmoji) {
    manager.setEmoji(false);
  }

  if (options.width) {
    manager.setContext({ width: options.width });
  }
}
