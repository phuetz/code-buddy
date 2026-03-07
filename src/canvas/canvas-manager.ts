/**
 * Canvas Manager
 *
 * Manages visual workspace canvases, elements, and operations.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { Resvg } from '@resvg/resvg-js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  Canvas,
  CanvasConfig,
  CanvasElement,
  CanvasElementType,
  CanvasHistoryEntry,
  Position,
  Size,
  ExportOptions,
} from './types.js';
import { DEFAULT_CANVAS_CONFIG } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Canvas Manager
 */
export class CanvasManager extends EventEmitter {
  private canvases: Map<string, Canvas> = new Map();
  private history: Map<string, CanvasHistoryEntry[]> = new Map();
  private historyIndex: Map<string, number> = new Map();

  /**
   * Create a new canvas
   */
  createCanvas(config: Partial<CanvasConfig> = {}): Canvas {
    const canvas: Canvas = {
      id: crypto.randomUUID(),
      config: { ...DEFAULT_CANVAS_CONFIG, ...config },
      elements: [],
      selectedIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    };

    this.canvases.set(canvas.id, canvas);
    this.history.set(canvas.id, []);
    this.historyIndex.set(canvas.id, -1);

    this.emit('canvas-created', canvas);
    return canvas;
  }

  /**
   * Get a canvas by ID
   */
  getCanvas(canvasId: string): Canvas | undefined {
    return this.canvases.get(canvasId);
  }

  /**
   * Get all canvases
   */
  getAllCanvases(): Canvas[] {
    return Array.from(this.canvases.values());
  }

  /**
   * Delete a canvas
   */
  deleteCanvas(canvasId: string): boolean {
    const deleted = this.canvases.delete(canvasId);
    if (deleted) {
      this.history.delete(canvasId);
      this.historyIndex.delete(canvasId);
      this.emit('canvas-deleted', canvasId);
    }
    return deleted;
  }

  /**
   * Update canvas configuration
   */
  updateCanvasConfig(canvasId: string, config: Partial<CanvasConfig>): void {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) return;

    canvas.config = { ...canvas.config, ...config };
    canvas.updatedAt = new Date();
    canvas.version++;

    this.emit('canvas-updated', canvas);
  }

  // ============================================================================
  // Element Operations
  // ============================================================================

  /**
   * Add an element to canvas
   */
  addElement(canvasId: string, element: Omit<CanvasElement, 'id' | 'createdAt' | 'updatedAt' | 'zIndex'>): CanvasElement {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) throw new Error(`Canvas ${canvasId} not found`);

    const newElement: CanvasElement = {
      ...element,
      id: crypto.randomUUID(),
      zIndex: canvas.elements.length,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as CanvasElement;

    canvas.elements.push(newElement);
    canvas.updatedAt = new Date();
    canvas.version++;

    this.addHistoryEntry(canvasId, {
      action: 'add',
      elementIds: [newElement.id],
      previousState: [],
      newState: [newElement],
      timestamp: new Date(),
    });

    this.emit('element-added', newElement);
    return newElement;
  }

  /**
   * Update an element
   */
  updateElement(canvasId: string, elementId: string, updates: Partial<CanvasElement>): CanvasElement | null {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) return null;

    const index = canvas.elements.findIndex((e) => e.id === elementId);
    if (index === -1) return null;

    const previousState = { ...canvas.elements[index] };
    const updatedElement = {
      ...canvas.elements[index],
      ...updates,
      id: elementId, // Prevent ID change
      updatedAt: new Date(),
    } as CanvasElement;

    canvas.elements[index] = updatedElement;
    canvas.updatedAt = new Date();
    canvas.version++;

    this.addHistoryEntry(canvasId, {
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
  deleteElement(canvasId: string, elementId: string): boolean {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) return false;

    const index = canvas.elements.findIndex((e) => e.id === elementId);
    if (index === -1) return false;

    const deletedElement = canvas.elements[index];
    canvas.elements.splice(index, 1);
    canvas.selectedIds = canvas.selectedIds.filter((id) => id !== elementId);
    canvas.updatedAt = new Date();
    canvas.version++;

    this.addHistoryEntry(canvasId, {
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
   * Get an element by ID
   */
  getElement(canvasId: string, elementId: string): CanvasElement | undefined {
    const canvas = this.canvases.get(canvasId);
    return canvas?.elements.find((e) => e.id === elementId);
  }

  /**
   * Get elements by type
   */
  getElementsByType(canvasId: string, type: CanvasElementType): CanvasElement[] {
    const canvas = this.canvases.get(canvasId);
    return canvas?.elements.filter((e) => e.type === type) || [];
  }

  // ============================================================================
  // Position & Size Operations
  // ============================================================================

  /**
   * Move an element
   */
  moveElement(canvasId: string, elementId: string, position: Position): CanvasElement | null {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) return null;

    const element = canvas.elements.find((e) => e.id === elementId);
    if (!element || element.locked) return null;

    // Snap to grid if enabled
    const snappedPosition = this.snapToGrid(canvas, position);

    return this.updateElement(canvasId, elementId, { position: snappedPosition });
  }

  /**
   * Resize an element
   */
  resizeElement(canvasId: string, elementId: string, size: Size): CanvasElement | null {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) return null;

    const element = canvas.elements.find((e) => e.id === elementId);
    if (!element || element.locked) return null;

    // Snap to grid if enabled
    const snappedSize = this.snapSizeToGrid(canvas, size);

    return this.updateElement(canvasId, elementId, { size: snappedSize });
  }

  /**
   * Snap position to grid
   */
  private snapToGrid(canvas: Canvas, position: Position): Position {
    if (!canvas.config.snapToGrid || canvas.config.gridSize === 0) {
      return position;
    }

    const gridSize = canvas.config.gridSize;
    return {
      x: Math.round(position.x / gridSize) * gridSize,
      y: Math.round(position.y / gridSize) * gridSize,
    };
  }

  /**
   * Snap size to grid
   */
  private snapSizeToGrid(canvas: Canvas, size: Size): Size {
    if (!canvas.config.snapToGrid || canvas.config.gridSize === 0) {
      return size;
    }

    const gridSize = canvas.config.gridSize;
    return {
      width: Math.max(gridSize, Math.round(size.width / gridSize) * gridSize),
      height: Math.max(gridSize, Math.round(size.height / gridSize) * gridSize),
    };
  }

  // ============================================================================
  // Selection Operations
  // ============================================================================

  /**
   * Select an element
   */
  selectElement(canvasId: string, elementId: string, addToSelection = false): void {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) return;

    if (!addToSelection) {
      canvas.selectedIds = [elementId];
    } else if (!canvas.selectedIds.includes(elementId)) {
      canvas.selectedIds.push(elementId);
    }

    this.emit('selection-changed', canvas.selectedIds);
  }

  /**
   * Deselect an element
   */
  deselectElement(canvasId: string, elementId: string): void {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) return;

    canvas.selectedIds = canvas.selectedIds.filter((id) => id !== elementId);
    this.emit('selection-changed', canvas.selectedIds);
  }

  /**
   * Clear selection
   */
  clearSelection(canvasId: string): void {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) return;

    canvas.selectedIds = [];
    this.emit('selection-changed', []);
  }

  /**
   * Get selected elements
   */
  getSelectedElements(canvasId: string): CanvasElement[] {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) return [];

    return canvas.elements.filter((e) => canvas.selectedIds.includes(e.id));
  }

  // ============================================================================
  // Z-Order Operations
  // ============================================================================

  /**
   * Bring element to front
   */
  bringToFront(canvasId: string, elementId: string): void {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) return;

    const maxZ = Math.max(...canvas.elements.map((e) => e.zIndex));
    this.updateElement(canvasId, elementId, { zIndex: maxZ + 1 });
  }

  /**
   * Send element to back
   */
  sendToBack(canvasId: string, elementId: string): void {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) return;

    const minZ = Math.min(...canvas.elements.map((e) => e.zIndex));
    this.updateElement(canvasId, elementId, { zIndex: minZ - 1 });
  }

  // ============================================================================
  // History Operations
  // ============================================================================

  /**
   * Add history entry
   */
  private addHistoryEntry(canvasId: string, entry: CanvasHistoryEntry): void {
    const canvas = this.canvases.get(canvasId);
    const hist = this.history.get(canvasId);
    const idx = this.historyIndex.get(canvasId);

    if (!canvas || !hist || idx === undefined) return;

    // Remove any redo entries
    hist.splice(idx + 1);

    // Add new entry
    hist.push(entry);

    // Trim history if needed
    while (hist.length > canvas.config.maxHistory) {
      hist.shift();
    }

    this.historyIndex.set(canvasId, hist.length - 1);
  }

  /**
   * Undo last action
   */
  undo(canvasId: string): boolean {
    const canvas = this.canvases.get(canvasId);
    const hist = this.history.get(canvasId);
    const idx = this.historyIndex.get(canvasId);

    if (!canvas || !hist || idx === undefined || idx < 0) return false;

    const entry = hist[idx];
    this.historyIndex.set(canvasId, idx - 1);

    // Restore previous state
    for (let i = 0; i < entry.elementIds.length; i++) {
      const elementId = entry.elementIds[i];

      if (entry.action === 'add') {
        // Remove the added element
        canvas.elements = canvas.elements.filter((e) => e.id !== elementId);
      } else if (entry.action === 'delete') {
        // Restore the deleted element
        canvas.elements.push(entry.previousState[i] as CanvasElement);
      } else {
        // Restore previous state
        const idx = canvas.elements.findIndex((e) => e.id === elementId);
        if (idx >= 0) {
          canvas.elements[idx] = entry.previousState[i] as CanvasElement;
        }
      }
    }

    canvas.updatedAt = new Date();
    canvas.version++;

    this.emit('undo', entry);
    this.emit('canvas-updated', canvas);
    return true;
  }

  /**
   * Redo last undone action
   */
  redo(canvasId: string): boolean {
    const hist = this.history.get(canvasId);
    const idx = this.historyIndex.get(canvasId);

    if (!hist || idx === undefined || idx >= hist.length - 1) return false;

    const canvas = this.canvases.get(canvasId);
    if (!canvas) return false;

    this.historyIndex.set(canvasId, idx + 1);
    const entry = hist[idx + 1];

    // Apply new state
    for (let i = 0; i < entry.elementIds.length; i++) {
      const elementId = entry.elementIds[i];

      if (entry.action === 'delete') {
        // Remove the element again
        canvas.elements = canvas.elements.filter((e) => e.id !== elementId);
      } else if (entry.action === 'add') {
        // Add the element again
        canvas.elements.push(entry.newState[i] as CanvasElement);
      } else {
        // Apply new state
        const idx = canvas.elements.findIndex((e) => e.id === elementId);
        if (idx >= 0) {
          canvas.elements[idx] = entry.newState[i] as CanvasElement;
        }
      }
    }

    canvas.updatedAt = new Date();
    canvas.version++;

    this.emit('redo', entry);
    this.emit('canvas-updated', canvas);
    return true;
  }

  /**
   * Check if can undo
   */
  canUndo(canvasId: string): boolean {
    const idx = this.historyIndex.get(canvasId);
    return idx !== undefined && idx >= 0;
  }

  /**
   * Check if can redo
   */
  canRedo(canvasId: string): boolean {
    const hist = this.history.get(canvasId);
    const idx = this.historyIndex.get(canvasId);
    return hist !== undefined && idx !== undefined && idx < hist.length - 1;
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  /**
   * Render canvas to terminal (ASCII/ANSI)
   */
  renderToTerminal(canvasId: string, width = 80, height = 24): string {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) return '';

    // Create character buffer
    const buffer: string[][] = Array(height)
      .fill(null)
      .map(() => Array(width).fill(' '));

    // Scale factors
    const scaleX = width / canvas.config.width;
    const scaleY = height / canvas.config.height;

    // Draw grid if enabled
    if (canvas.config.showGrid) {
      const gridX = Math.floor(canvas.config.gridSize * scaleX);
      const gridY = Math.floor(canvas.config.gridSize * scaleY);

      for (let y = 0; y < height; y += gridY || 1) {
        for (let x = 0; x < width; x++) {
          if (buffer[y]) buffer[y][x] = '·';
        }
      }
      for (let x = 0; x < width; x += gridX || 1) {
        for (let y = 0; y < height; y++) {
          if (buffer[y]) buffer[y][x] = '·';
        }
      }
    }

    // Sort elements by z-index
    const sortedElements = [...canvas.elements].sort((a, b) => a.zIndex - b.zIndex);

    // Render each element
    for (const element of sortedElements) {
      if (!element.visible) continue;

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

      // Content preview
      let content = '';
      if (element.type === 'text' && 'content' in element) {
        content = (element.content as { text: string }).text;
      } else if (element.type === 'code' && 'content' in element) {
        content = `[${(element.content as { language: string }).language}]`;
      } else if (element.type === 'image') {
        content = '[IMG]';
      } else if (element.type === 'chart') {
        content = '[CHART]';
      } else if (element.type === 'diagram') {
        content = '[DIAG]';
      }

      // Truncate and center content
      const maxLen = x2 - x1 - 2;
      if (content.length > maxLen) {
        content = content.substring(0, maxLen - 1) + '…';
      }

      const contentY = Math.floor((y1 + y2) / 2);
      const contentX = x1 + 1 + Math.floor((maxLen - content.length) / 2);

      if (buffer[contentY]) {
        for (let i = 0; i < content.length && contentX + i < x2; i++) {
          buffer[contentY][contentX + i] = content[i];
        }
      }
    }

    return buffer.map((row) => row.join('')).join('\n');
  }

  /**
   * Render canvas to HTML
   */
  renderToHTML(canvasId: string): string {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) return '';

    const elements = [...canvas.elements]
      .sort((a, b) => a.zIndex - b.zIndex)
      .filter((e) => e.visible)
      .map((e) => this.elementToHTML(e))
      .join('\n');

    return `<!DOCTYPE html>
<html>
<head>
  <style>
    .canvas {
      position: relative;
      width: ${canvas.config.width}px;
      height: ${canvas.config.height}px;
      background-color: ${canvas.config.backgroundColor};
      ${canvas.config.showGrid ? `background-image: linear-gradient(to right, #eee 1px, transparent 1px), linear-gradient(to bottom, #eee 1px, transparent 1px); background-size: ${canvas.config.gridSize}px ${canvas.config.gridSize}px;` : ''}
    }
    .element {
      position: absolute;
      box-sizing: border-box;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <div class="canvas">
    ${elements}
  </div>
</body>
</html>`;
  }

  /**
   * Convert element to HTML
   */
  private elementToHTML(element: CanvasElement): string {
    const style = `
      left: ${element.position.x}px;
      top: ${element.position.y}px;
      width: ${element.size.width}px;
      height: ${element.size.height}px;
      z-index: ${element.zIndex};
      ${element.style?.backgroundColor ? `background-color: ${element.style.backgroundColor};` : ''}
      ${element.style?.borderColor ? `border: ${element.style.borderWidth || 1}px ${element.style.borderStyle || 'solid'} ${element.style.borderColor};` : ''}
      ${element.style?.borderRadius ? `border-radius: ${element.style.borderRadius}px;` : ''}
      ${element.style?.opacity !== undefined ? `opacity: ${element.style.opacity};` : ''}
    `;

    let content = '';

    switch (element.type) {
      case 'text':
        content = `<div>${(element.content as { text: string }).text}</div>`;
        break;
      case 'code':
        content = `<pre><code class="language-${(element.content as { language: string }).language}">${(element.content as { code: string }).code}</code></pre>`;
        break;
      case 'image':
        content = `<img src="${(element.content as { url?: string }).url}" alt="${(element.content as { alt?: string }).alt || ''}" style="width: 100%; height: 100%; object-fit: ${(element.content as { fit: string }).fit};">`;
        break;
      case 'markdown':
        content = `<div class="markdown">${(element.content as { rendered?: string }).rendered || (element.content as { markdown: string }).markdown}</div>`;
        break;
      default:
        content = `<div>[${element.type}]</div>`;
    }

    return `<div class="element element-${element.type}" data-id="${element.id}" style="${style}">${content}</div>`;
  }

  /**
   * Export canvas
   */
  async export(canvasId: string, options: ExportOptions): Promise<Buffer | string> {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) throw new Error(`Canvas ${canvasId} not found`);

    switch (options.format) {
      case 'json':
        return JSON.stringify(canvas, null, 2);
      case 'html':
        return this.renderToHTML(canvasId);
      case 'svg':
        return this.renderToSVG(canvasId);
      case 'png':
        return this.renderToPNG(canvasId, options);
      case 'pdf':
        return this.renderToPDF(canvasId);
      default:
        throw new Error(`Unsupported export format: ${options.format}`);
    }
  }

  /**
   * Render to PNG using resvg (SVG rasterization).
   */
  private renderToPNG(canvasId: string, options: ExportOptions): Buffer {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) {
      throw new Error(`Canvas ${canvasId} not found`);
    }

    const scale = options.scale && options.scale > 0 ? options.scale : 1;
    const width = Math.max(1, Math.round(canvas.config.width * scale));
    const svg = this.renderToSVG(canvasId);
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      background: options.transparentBackground ? undefined : canvas.config.backgroundColor,
      font: { loadSystemFonts: false },
    });

    return resvg.render().asPng();
  }

  /**
   * Render to PDF.
   *
   * Uses wkhtmltopdf when available for richer rendering and falls back to
   * a minimal built-in PDF generator if the binary is unavailable.
   */
  private async renderToPDF(canvasId: string): Promise<Buffer> {
    const html = this.renderToHTML(canvasId);
    const pdfFromBinary = await this.renderToPDFWithWkhtmltopdf(html);
    if (pdfFromBinary) {
      return pdfFromBinary;
    }
    return this.renderMinimalPDF(canvasId);
  }

  private async renderToPDFWithWkhtmltopdf(html: string): Promise<Buffer | null> {
    const { mkdtemp, writeFile, readFile, rm } = await import('fs/promises');
    const { join } = await import('path');
    const { tmpdir } = await import('os');

    const tmp = await mkdtemp(join(tmpdir(), 'canvas-export-'));
    const htmlPath = join(tmp, 'canvas.html');
    const pdfPath = join(tmp, 'canvas.pdf');

    try {
      await writeFile(htmlPath, html, 'utf8');
      await execFileAsync('wkhtmltopdf', [htmlPath, pdfPath], { timeout: 15000 });
      return await readFile(pdfPath);
    } catch {
      return null;
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  /**
   * Build a basic PDF payload with canvas metadata and element list.
   * This guarantees a valid PDF even without external PDF tooling.
   */
  private renderMinimalPDF(canvasId: string): Buffer {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) {
      throw new Error(`Canvas ${canvasId} not found`);
    }

    const elementLines = canvas.elements
      .sort((a, b) => a.zIndex - b.zIndex)
      .slice(0, 120)
      .map((element) => {
        const label = element.label || this.getElementSummary(element);
        return `[${element.type}] ${label}`.trim();
      });

    const lines = [
      `Canvas: ${canvas.config.name}`,
      `Size: ${canvas.config.width}x${canvas.config.height}`,
      `Elements: ${canvas.elements.length}`,
      '',
      ...elementLines,
    ];

    return this.buildSimplePdf(lines);
  }

  private getElementSummary(element: CanvasElement): string {
    if (element.type === 'text' && 'content' in element) {
      const text = (element.content as { text: string }).text || '';
      return text.slice(0, 80);
    }
    if (element.type === 'code' && 'content' in element) {
      const language = (element.content as { language?: string }).language || 'code';
      return `[${language}]`;
    }
    if (element.type === 'markdown' && 'content' in element) {
      const md = (element.content as { markdown?: string }).markdown || '';
      return md.slice(0, 80);
    }
    return `${element.id.slice(0, 8)}...`;
  }

  private buildSimplePdf(rawLines: string[]): Buffer {
    const normalized = rawLines
      .flatMap((line) => this.wrapText(line.replace(/[^\x20-\x7E]/g, '?'), 95))
      .slice(0, 220);
    const escaped = normalized.map((line) => this.escapePdfText(line));

    const streamLines: string[] = [
      'BT',
      '/F1 10 Tf',
      '1 0 0 1 40 760 Tm',
    ];
    for (const line of escaped) {
      streamLines.push(`(${line}) Tj`);
      streamLines.push('0 -12 Td');
    }
    streamLines.push('ET');
    const contentStream = `${streamLines.join('\n')}\n`;

    const objects: string[] = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}endstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];

    const header = '%PDF-1.4\n';
    let body = '';
    const offsets: number[] = [];

    for (let i = 0; i < objects.length; i++) {
      offsets.push(Buffer.byteLength(header + body, 'utf8'));
      body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }

    const xrefOffset = Buffer.byteLength(header + body, 'utf8');
    const xrefEntries = [
      '0000000000 65535 f ',
      ...offsets.map((offset) => `${offset.toString().padStart(10, '0')} 00000 n `),
    ];

    const xref = `xref\n0 ${objects.length + 1}\n${xrefEntries.join('\n')}\n`;
    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(header + body + xref + trailer, 'utf8');
  }

  private wrapText(input: string, maxLen: number): string[] {
    if (input.length <= maxLen) {
      return [input];
    }

    const out: string[] = [];
    let rest = input;
    while (rest.length > maxLen) {
      out.push(rest.slice(0, maxLen));
      rest = rest.slice(maxLen);
    }
    if (rest.length > 0) {
      out.push(rest);
    }
    return out;
  }

  private escapePdfText(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  /**
   * Render to SVG
   */
  private renderToSVG(canvasId: string): string {
    const canvas = this.canvases.get(canvasId);
    if (!canvas) return '';

    const elements = [...canvas.elements]
      .sort((a, b) => a.zIndex - b.zIndex)
      .filter((e) => e.visible)
      .map((e) => this.elementToSVG(e))
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.config.width}" height="${canvas.config.height}" viewBox="0 0 ${canvas.config.width} ${canvas.config.height}">
  <rect width="100%" height="100%" fill="${canvas.config.backgroundColor}"/>
  ${elements}
</svg>`;
  }

  /**
   * Convert element to SVG
   */
  private elementToSVG(element: CanvasElement): string {
    const { x, y } = element.position;
    const { width, height } = element.size;

    let content = '';

    switch (element.type) {
      case 'text':
        content = `<text x="${x + 10}" y="${y + 20}">${(element.content as { text: string }).text}</text>`;
        break;
      case 'shape':
        const shape = element.content as { shapeType: string; fill?: string; stroke?: string };
        if (shape.shapeType === 'rectangle') {
          content = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${shape.fill || 'none'}" stroke="${shape.stroke || '#000'}"/>`;
        } else if (shape.shapeType === 'circle') {
          const r = Math.min(width, height) / 2;
          content = `<circle cx="${x + r}" cy="${y + r}" r="${r}" fill="${shape.fill || 'none'}" stroke="${shape.stroke || '#000'}"/>`;
        }
        break;
      default:
        content = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="#999" stroke-dasharray="5,5"/>
          <text x="${x + width / 2}" y="${y + height / 2}" text-anchor="middle">[${element.type}]</text>`;
    }

    return `<g id="${element.id}">${content}</g>`;
  }

  /**
   * Import canvas from JSON
   */
  importCanvas(json: string): Canvas {
    const data = JSON.parse(json) as Canvas;

    // Generate new IDs
    const idMap = new Map<string, string>();
    const newId = crypto.randomUUID();
    idMap.set(data.id, newId);

    const canvas: Canvas = {
      ...data,
      id: newId,
      createdAt: new Date(),
      updatedAt: new Date(),
      elements: data.elements.map((e) => {
        const elementId = crypto.randomUUID();
        idMap.set(e.id, elementId);
        return {
          ...e,
          id: elementId,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }),
    };

    // Update connection references
    for (const element of canvas.elements) {
      if (element.type === 'connection') {
        const content = element.content as { fromElement: string; toElement: string };
        content.fromElement = idMap.get(content.fromElement) || content.fromElement;
        content.toElement = idMap.get(content.toElement) || content.toElement;
      }
    }

    this.canvases.set(canvas.id, canvas);
    this.history.set(canvas.id, []);
    this.historyIndex.set(canvas.id, -1);

    this.emit('canvas-created', canvas);
    return canvas;
  }

  /**
   * Shutdown and cleanup
   */
  shutdown(): void {
    this.canvases.clear();
    this.history.clear();
    this.historyIndex.clear();
    this.removeAllListeners();
  }
}

// Singleton instance
let canvasManagerInstance: CanvasManager | null = null;

/**
 * Get canvas manager instance
 */
export function getCanvasManager(): CanvasManager {
  if (!canvasManagerInstance) {
    canvasManagerInstance = new CanvasManager();
  }
  return canvasManagerInstance;
}

/**
 * Reset canvas manager
 */
export function resetCanvasManager(): void {
  if (canvasManagerInstance) {
    canvasManagerInstance.shutdown();
    canvasManagerInstance = null;
  }
}

export default CanvasManager;
