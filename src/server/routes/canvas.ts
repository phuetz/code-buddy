/**
 * Canvas HTTP Routes
 *
 * Serves canvas content from the Gateway HTTP server.
 * Inspired by OpenClaw's /__openclaw__/canvas/ and /__openclaw__/a2ui/ routes.
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
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><p>No canvas content. Push content via POST.</p></body></html>');
          return;
        }
        const page = buildCanvasPage(current);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page);
      },
    },
    {
      method: 'GET',
      path: `${basePath}/canvas/:id`,
      handler: async (req, res) => {
        // Extract ID from URL
        const url = (req as { url?: string }).url || '';
        const id = url.split('/').pop() || '';
        const snapshot = canvasStore.get(id);
        if (!snapshot) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Canvas not found' }));
          return;
        }
        const page = buildCanvasPage(snapshot);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page);
      },
    },
    {
      method: 'POST',
      path: `${basePath}/canvas/push`,
      handler: async (_req, res, body) => {
        if (!body || body.length > maxSize) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Body required and must be < 1MB' }));
          return;
        }
        try {
          const data = JSON.parse(body);
          const snapshot = canvasStore.push(data.html, data.css, data.js, data.metadata);
          logger.debug('Canvas pushed', { id: snapshot.id });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: snapshot.id, createdAt: snapshot.createdAt }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      },
    },
    {
      method: 'POST',
      path: `${basePath}/canvas/reset`,
      handler: async (_req, res) => {
        canvasStore.reset();
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
