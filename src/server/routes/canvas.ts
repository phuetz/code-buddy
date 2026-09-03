/**
 * Canvas HTTP Routes
 *
 * Serves canvas content from the Gateway HTTP server.
 *
 * Endpoints:
 *   GET /__codebuddy__/canvas/         — Serve canvas HTML
 *   GET /__codebuddy__/canvas/:id      — Serve specific canvas snapshot
 *   POST /__codebuddy__/canvas/push    — Push canvas update
 *   POST /__codebuddy__/canvas/reset   — Reset canvas
 *   GET /__codebuddy__/a2ui/           — Serve A2UI host page
 *   POST /__codebuddy__/a2ui/eval      — Evaluate A2UI expression
 *   GET /__codebuddy__/a2ui/snapshot   — Get A2UI snapshot
 */

import { Router, type Request, type Response } from 'express';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface CanvasSnapshot {
  id: string;
  html: string;
  css?: string;
  js?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface CanvasRouteConfig {
  basePath: string;
  maxCanvasSize: number;
  enableA2UI: boolean;
}

// ============================================================================
// Canvas Store (in-memory, production would persist)
// ============================================================================

class CanvasStore {
  private snapshots: Map<string, CanvasSnapshot> = new Map();
  private current: CanvasSnapshot | null = null;
  private idCounter = 0;

  push(html: string, css?: string, js?: string, metadata?: Record<string, unknown>): CanvasSnapshot {
    const id = `canvas_${++this.idCounter}_${Date.now()}`;
    const snapshot: CanvasSnapshot = { id, html, css, js, metadata, createdAt: new Date() };
    this.snapshots.set(id, snapshot);
    this.current = snapshot;
    return snapshot;
  }

  get(id: string): CanvasSnapshot | undefined {
    return this.snapshots.get(id);
  }

  getCurrent(): CanvasSnapshot | null {
    return this.current;
  }

  reset(): void {
    this.current = null;
  }

  /** Wipe every snapshot. Tests and POST /reset use this so a blank canvas stays blank. */
  clear(): void {
    this.snapshots.clear();
    this.current = null;
    this.idCounter = 0;
  }

  list(): CanvasSnapshot[] {
    return Array.from(this.snapshots.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }
}

const canvasStore = new CanvasStore();

// ============================================================================
// Route Handlers
// ============================================================================

export interface RouteHandler {
  method: 'GET' | 'POST';
  path: string;
  handler: (req: unknown, res: {
    writeHead: (status: number, headers?: Record<string, string>) => void;
    end: (body?: string) => void;
  }, body?: string) => Promise<void>;
}

function isFullHtmlDocument(html: string): boolean {
  return /^\s*<(!doctype\s+html\b|html[\s>])/i.test(html);
}

function snapshotPage(snapshot: CanvasSnapshot): string {
  if (isFullHtmlDocument(snapshot.html) && !snapshot.css && !snapshot.js) {
    return snapshot.html;
  }
  return buildCanvasPage(snapshot);
}

function extractHtml(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const html = (payload as { html?: unknown }).html;
  if (typeof html !== 'string' || html.trim().length === 0) return null;
  return html;
}

function parsePushBody(raw: string | undefined, maxSize: number): {
  html: string;
  css?: string;
  js?: string;
  metadata?: Record<string, unknown>;
} | { error: string } {
  if (!raw || raw.length > maxSize) {
    return { error: 'Body required and must be < 1MB' };
  }
  try {
    const data: unknown = JSON.parse(raw);
    const html = extractHtml(data);
    if (!html) return { error: 'HTML required' };
    if (Buffer.byteLength(html, 'utf8') > maxSize) {
      return { error: 'Body required and must be < 1MB' };
    }
    const record = data as { css?: unknown; js?: unknown; metadata?: unknown };
    return {
      html,
      ...(typeof record.css === 'string' ? { css: record.css } : {}),
      ...(typeof record.js === 'string' ? { js: record.js } : {}),
      ...(record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? { metadata: record.metadata as Record<string, unknown> }
        : {}),
    };
  } catch {
    return { error: 'Invalid JSON body' };
  }
}

function canvasIdFromUrl(url: string): string {
  const path = url.split('?')[0] ?? url;
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

export function createCanvasRoutes(config?: Partial<CanvasRouteConfig>): RouteHandler[] {
  const basePath = config?.basePath || '/__codebuddy__';
  const maxSize = config?.maxCanvasSize || 1024 * 1024; // 1MB

  const routes: RouteHandler[] = [
    {
      method: 'GET',
      path: `${basePath}/canvas/`,
      handler: async (_req, res) => {
        const current = canvasStore.getCurrent();
        if (!current) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body><p>No canvas content. Push content via POST.</p></body></html>');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(snapshotPage(current));
      },
    },
    {
      method: 'GET',
      path: `${basePath}/canvas/:id`,
      handler: async (req, res) => {
        const url = (req as { url?: string }).url || '';
        const id = canvasIdFromUrl(url);
        const snapshot = canvasStore.get(id);
        if (!snapshot) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Canvas not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(snapshotPage(snapshot));
      },
    },
    {
      method: 'POST',
      path: `${basePath}/canvas/push`,
      handler: async (_req, res, body) => {
        const parsed = parsePushBody(body, maxSize);
        if ('error' in parsed) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: parsed.error }));
          return;
        }
        const snapshot = canvasStore.push(parsed.html, parsed.css, parsed.js, parsed.metadata);
        logger.debug('Canvas pushed', { id: snapshot.id });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: snapshot.id, createdAt: snapshot.createdAt }));
      },
    },
    {
      method: 'POST',
      path: `${basePath}/canvas/reset`,
      handler: async (_req, res) => {
        canvasStore.clear();
        logger.debug('Canvas reset');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reset: true }));
      },
    },
    {
      method: 'GET',
      path: `${basePath}/a2ui/`,
      handler: async (_req, res) => {
        const page = buildA2UIPage();
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page);
      },
    },
    {
      method: 'POST',
      path: `${basePath}/a2ui/eval`,
      handler: async (_req, res, body) => {
        if (!body) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Body required' }));
          return;
        }
        try {
          const data = JSON.parse(body);
          logger.debug('A2UI eval', { expression: data.expression?.slice(0, 100) });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ evaluated: true, expression: data.expression }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      },
    },
    {
      method: 'GET',
      path: `${basePath}/a2ui/snapshot`,
      handler: async (_req, res) => {
        const current = canvasStore.getCurrent();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          hasCanvas: !!current,
          snapshot: current ? { id: current.id, createdAt: current.createdAt } : null,
        }));
      },
    },
  ];

  return routes;
}

/**
 * Express router mounted at `/__codebuddy__`. Same store as createCanvasRoutes.
 */
export function createCanvasRouter(config?: Partial<CanvasRouteConfig>): Router {
  const maxSize = config?.maxCanvasSize || 1024 * 1024;
  const router = Router();

  const sendHtml = (res: Response, html: string): void => {
    res.status(200).type('html').send(html);
  };

  router.get('/canvas/', (_req: Request, res: Response) => {
    const current = canvasStore.getCurrent();
    if (!current) {
      sendHtml(res, '<html><body><p>No canvas content. Push content via POST.</p></body></html>');
      return;
    }
    sendHtml(res, snapshotPage(current));
  });

  router.post('/canvas/push', (req: Request, res: Response) => {
    const html = extractHtml(req.body);
    if (!html) {
      res.status(400).json({ error: 'HTML required' });
      return;
    }
    if (Buffer.byteLength(html, 'utf8') > maxSize) {
      res.status(400).json({ error: 'Body required and must be < 1MB' });
      return;
    }
    const record = req.body as { css?: unknown; js?: unknown; metadata?: unknown };
    const snapshot = canvasStore.push(
      html,
      typeof record.css === 'string' ? record.css : undefined,
      typeof record.js === 'string' ? record.js : undefined,
      record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? record.metadata as Record<string, unknown>
        : undefined,
    );
    logger.debug('Canvas pushed', { id: snapshot.id });
    res.status(200).json({ id: snapshot.id, createdAt: snapshot.createdAt });
  });

  router.post('/canvas/reset', (_req: Request, res: Response) => {
    canvasStore.clear();
    logger.debug('Canvas reset');
    res.status(200).json({ reset: true });
  });

  router.get('/canvas/:id', (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const snapshot = canvasStore.get(id);
    if (!snapshot) {
      res.status(404).json({ error: 'Canvas not found' });
      return;
    }
    sendHtml(res, snapshotPage(snapshot));
  });

  router.get('/a2ui/', (_req: Request, res: Response) => {
    sendHtml(res, buildA2UIPage());
  });

  router.post('/a2ui/eval', (req: Request, res: Response) => {
    const expression = (req.body as { expression?: unknown } | undefined)?.expression;
    if (typeof expression !== 'string') {
      res.status(400).json({ error: 'Body required' });
      return;
    }
    logger.debug('A2UI eval', { expression: expression.slice(0, 100) });
    res.status(200).json({ evaluated: true, expression });
  });

  router.get('/a2ui/snapshot', (_req: Request, res: Response) => {
    const current = canvasStore.getCurrent();
    res.status(200).json({
      hasCanvas: !!current,
      snapshot: current ? { id: current.id, createdAt: current.createdAt } : null,
    });
  });

  return router;
}

// ============================================================================
// HTML Builders
// ============================================================================

function buildCanvasPage(snapshot: CanvasSnapshot): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Code Buddy Canvas</title>
  <style>
    body { margin: 0; padding: 0; font-family: system-ui, sans-serif; }
    ${snapshot.css || ''}
  </style>
</head>
<body>
  ${snapshot.html}
  ${snapshot.js ? `<script>${snapshot.js}</script>` : ''}
</body>
</html>`;
}

function buildA2UIPage(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Code Buddy A2UI Host</title>
  <style>
    body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0; }
    h1 { color: #64ffda; }
    #canvas-container { border: 1px solid #333; border-radius: 8px; padding: 16px; min-height: 200px; }
    .status { color: #888; font-size: 12px; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>A2UI Host</h1>
  <div id="canvas-container">
    <p>Agent-driven visual workspace. Canvas content will appear here.</p>
  </div>
  <div class="status">Connected to Code Buddy Gateway</div>
  <script>
    // A2UI WebSocket connection placeholder
    console.log('A2UI host ready');
  </script>
</body>
</html>`;
}

// ============================================================================
// Exports
// ============================================================================

export { canvasStore, CanvasStore };
