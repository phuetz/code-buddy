/**
 * Visual Workflow Builder Routes
 *
 * Serves a self-contained DAG editor UI and provides API endpoints
 * for workflow CRUD, validation, and execution ordering.
 *
 * Endpoints:
 *   GET  /__codebuddy__/workflows/           — Serve workflow builder UI
 *   GET  /__codebuddy__/workflows/api/list   — List saved workflows
 *   GET  /__codebuddy__/workflows/api/get    — Get a workflow by ID (?id=...)
 *   POST /__codebuddy__/workflows/api/save   — Save/update a workflow
 *   POST /__codebuddy__/workflows/api/validate — Validate a workflow
 *   POST /__codebuddy__/workflows/api/order  — Get execution order
 *   DELETE /__codebuddy__/workflows/api/delete — Delete a workflow (?id=...)
 */

import { logger } from '../../utils/logger.js';
import type { LobsterWorkflow } from '../../workflows/lobster-engine.js';
import type { RouteHandler } from './canvas.js';

// ============================================================================
// Workflow Store (in-memory)
// ============================================================================

export interface StoredWorkflow {
  id: string;
  workflow: LobsterWorkflow;
  /** Visual positions for the UI */
  positions: Record<string, { x: number; y: number }>;
  createdAt: Date;
  updatedAt: Date;
}

class WorkflowStore {
  private workflows = new Map<string, StoredWorkflow>();
  private idCounter = 0;

  save(workflow: LobsterWorkflow, positions: Record<string, { x: number; y: number }>, id?: string): StoredWorkflow {
    const now = new Date();
    const existing = id ? this.workflows.get(id) : undefined;

    const stored: StoredWorkflow = {
      id: existing?.id ?? `wf_${++this.idCounter}_${Date.now().toString(36)}`,
      workflow,
      positions,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.workflows.set(stored.id, stored);
    return stored;
  }

  get(id: string): StoredWorkflow | undefined {
    return this.workflows.get(id);
  }

  list(): StoredWorkflow[] {
    return [...this.workflows.values()].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  }

  delete(id: string): boolean {
    return this.workflows.delete(id);
  }
}

const workflowStore = new WorkflowStore();

// ============================================================================
// Validation + Ordering (inline, avoids importing full LobsterEngine)
// ============================================================================

function validateWorkflow(wf: LobsterWorkflow): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!wf.name) errors.push('Missing workflow name');
  if (!wf.version) errors.push('Missing workflow version');
  if (!wf.steps || wf.steps.length === 0) errors.push('No steps defined');

  const stepIds = new Set(wf.steps?.map(s => s.id) ?? []);
  if (wf.steps && stepIds.size !== wf.steps.length) errors.push('Duplicate step IDs');

  for (const step of wf.steps ?? []) {
    if (!step.id) errors.push(`Step missing id`);
    if (!step.name) errors.push(`Step '${step.id}' missing name`);
    if (!step.command) errors.push(`Step '${step.id}' missing command`);
    for (const dep of step.dependsOn ?? []) {
      if (!stepIds.has(dep)) errors.push(`Step '${step.id}' depends on unknown '${dep}'`);
    }
  }

  // Cycle detection (DFS)
  if (wf.steps) {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const colors = new Map<string, number>();
    wf.steps.forEach(s => colors.set(s.id, WHITE));
    const stepMap = new Map(wf.steps.map(s => [s.id, s]));

    const dfs = (id: string): boolean => {
      colors.set(id, GRAY);
      for (const dep of stepMap.get(id)?.dependsOn ?? []) {
        const c = colors.get(dep);
        if (c === GRAY) return true;
        if (c === WHITE && dfs(dep)) return true;
      }
      colors.set(id, BLACK);
      return false;
    };

    for (const step of wf.steps) {
      if (colors.get(step.id) === WHITE && dfs(step.id)) {
        errors.push('Workflow contains a dependency cycle');
        break;
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function getExecutionOrder(wf: LobsterWorkflow): string[] {
  const stepMap = new Map(wf.steps.map(s => [s.id, s]));
  const visited = new Set<string>();
  const order: string[] = [];

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const dep of stepMap.get(id)?.dependsOn ?? []) {
      visit(dep);
    }
    order.push(id);
  };

  for (const step of wf.steps) visit(step.id);
  return order;
}

// ============================================================================
// Route Factory
// ============================================================================

export function createWorkflowBuilderRoutes(basePath = '/__codebuddy__'): RouteHandler[] {
  const prefix = `${basePath}/workflows`;

  return [
    // Serve the UI
    {
      method: 'GET',
      path: `${prefix}/`,
      handler: async (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(buildWorkflowBuilderPage());
      },
    },

    // List workflows
    {
      method: 'GET',
      path: `${prefix}/api/list`,
      handler: async (_req, res) => {
        const list = workflowStore.list().map(w => ({
          id: w.id,
          name: w.workflow.name,
          version: w.workflow.version,
          stepCount: w.workflow.steps.length,
          updatedAt: w.updatedAt,
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(list));
      },
    },

    // Get workflow
    {
      method: 'GET',
      path: `${prefix}/api/get`,
      handler: async (req, res) => {
        const url = (req as { url?: string }).url || '';
        const id = new URL(url, 'http://localhost').searchParams.get('id');
        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing ?id= parameter' }));
          return;
        }
        const stored = workflowStore.get(id);
        if (!stored) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Workflow not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stored));
      },
    },

    // Save workflow
    {
      method: 'POST',
      path: `${prefix}/api/save`,
      handler: async (_req, res, body) => {
        if (!body) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Body required' }));
          return;
        }
        try {
          const data = JSON.parse(body);
          const { workflow, positions, id } = data as {
            workflow: LobsterWorkflow;
            positions: Record<string, { x: number; y: number }>;
            id?: string;
          };
          if (!workflow) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing workflow field' }));
            return;
          }
          const stored = workflowStore.save(workflow, positions ?? {}, id);
          logger.debug('Workflow saved', { id: stored.id, name: workflow.name });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: stored.id, updatedAt: stored.updatedAt }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      },
    },

    // Validate workflow
    {
      method: 'POST',
      path: `${prefix}/api/validate`,
      handler: async (_req, res, body) => {
        if (!body) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Body required' }));
          return;
        }
        try {
          const workflow = JSON.parse(body) as LobsterWorkflow;
          const result = validateWorkflow(workflow);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      },
    },

    // Get execution order
    {
      method: 'POST',
      path: `${prefix}/api/order`,
      handler: async (_req, res, body) => {
        if (!body) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Body required' }));
          return;
        }
        try {
          const workflow = JSON.parse(body) as LobsterWorkflow;
          const validation = validateWorkflow(workflow);
          if (!validation.valid) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid workflow', errors: validation.errors }));
            return;
          }
          const order = getExecutionOrder(workflow);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ order }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      },
    },

    // Delete workflow
    {
      method: 'GET', // Using GET with ?id= for simplicity (DELETE not always supported)
      path: `${prefix}/api/delete`,
      handler: async (req, res) => {
        const url = (req as { url?: string }).url || '';
        const id = new URL(url, 'http://localhost').searchParams.get('id');
        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing ?id= parameter' }));
          return;
        }
        const deleted = workflowStore.delete(id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ deleted }));
      },
    },
  ];
}

// ============================================================================
// Self-Contained Workflow Builder UI
// ============================================================================

function buildWorkflowBuilderPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Code Buddy — Workflow Builder</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --text-muted: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --red: #f85149; --yellow: #d29922; --purple: #bc8cff;
    --node-w: 200; --node-h: 80;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); overflow: hidden; height: 100vh; display: flex; flex-direction: column; }

  /* Toolbar */
  .toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: var(--surface); border-bottom: 1px solid var(--border); z-index: 10; flex-shrink: 0; }
  .toolbar h1 { font-size: 14px; font-weight: 600; margin-right: 16px; white-space: nowrap; }
  .toolbar button { background: var(--border); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 4px 12px; font-size: 12px; cursor: pointer; white-space: nowrap; }
  .toolbar button:hover { background: var(--accent); border-color: var(--accent); color: #000; }
  .toolbar button.danger:hover { background: var(--red); border-color: var(--red); }
  .toolbar .sep { width: 1px; height: 20px; background: var(--border); }
  .toolbar input, .toolbar select { background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; font-size: 12px; }
  .toolbar .spacer { flex: 1; }

  /* Canvas */
  .canvas-wrap { flex: 1; position: relative; overflow: hidden; }
  canvas { display: block; }

  /* Side Panel */
  .panel { position: absolute; right: 0; top: 0; bottom: 0; width: 320px; background: var(--surface); border-left: 1px solid var(--border); z-index: 5; overflow-y: auto; padding: 16px; display: none; }
  .panel.open { display: block; }
  .panel h2 { font-size: 14px; margin-bottom: 12px; color: var(--accent); }
  .panel label { display: block; font-size: 11px; color: var(--text-muted); margin: 8px 0 2px; }
  .panel input, .panel textarea, .panel select { width: 100%; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px; padding: 6px 8px; font-size: 12px; font-family: monospace; }
  .panel textarea { resize: vertical; min-height: 60px; }
  .panel .btn-row { display: flex; gap: 8px; margin-top: 12px; }
  .panel .btn-row button { flex: 1; }

  /* Status bar */
  .statusbar { display: flex; align-items: center; gap: 12px; padding: 4px 16px; background: var(--surface); border-top: 1px solid var(--border); font-size: 11px; color: var(--text-muted); flex-shrink: 0; }
  .statusbar .dot { width: 6px; height: 6px; border-radius: 50%; }
  .statusbar .dot.ok { background: var(--green); }
  .statusbar .dot.err { background: var(--red); }

  /* Modal */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100; display: none; align-items: center; justify-content: center; }
  .modal-overlay.open { display: flex; }
  .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 24px; min-width: 400px; max-width: 600px; }
  .modal h2 { margin-bottom: 12px; font-size: 16px; }
  .modal textarea { width: 100%; min-height: 200px; background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px; padding: 8px; font-family: monospace; font-size: 12px; }
  .modal .btn-row { display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end; }
</style>
</head>
<body>

<!-- Toolbar -->
<div class="toolbar">
  <h1>Workflow Builder</h1>
  <input id="wf-name" placeholder="Workflow name" value="my-workflow" style="width:140px">
  <input id="wf-version" placeholder="Version" value="1.0.0" style="width:80px">
  <div class="sep"></div>
  <button onclick="addNode('command')">+ Step</button>
  <button onclick="addNode('approval')">+ Approval</button>
  <div class="sep"></div>
  <button onclick="validateWf()">Validate</button>
  <button onclick="showOrder()">Order</button>
  <div class="sep"></div>
  <button onclick="exportJSON()">Export JSON</button>
  <button onclick="showImportModal()">Import</button>
  <div class="spacer"></div>
  <button onclick="saveWorkflow()">Save</button>
  <button onclick="loadList()">Load</button>
  <button class="danger" onclick="clearAll()">Clear</button>
</div>

<!-- Canvas -->
<div class="canvas-wrap">
  <canvas id="dag"></canvas>
  <!-- Side panel for editing a node -->
  <div class="panel" id="nodePanel">
    <h2 id="panelTitle">Edit Step</h2>
    <label>ID</label>
    <input id="np-id" readonly>
    <label>Name</label>
    <input id="np-name">
    <label>Command</label>
    <textarea id="np-command"></textarea>
    <label>Type</label>
    <select id="np-type">
      <option value="command">Command</option>
      <option value="approval">Approval Gate</option>
    </select>
    <label>Depends On (comma-separated IDs)</label>
    <input id="np-deps">
    <label>Condition</label>
    <input id="np-condition" placeholder="e.g. $build.exitCode == 0">
    <label>Timeout (ms)</label>
    <input id="np-timeout" type="number">
    <div class="btn-row">
      <button onclick="applyNodeEdit()">Apply</button>
      <button class="danger" onclick="deleteSelectedNode()">Delete</button>
      <button onclick="closePanel()">Close</button>
    </div>
  </div>
</div>

<!-- Status bar -->
<div class="statusbar">
  <div class="dot ok" id="statusDot"></div>
  <span id="statusText">Ready — click canvas to add steps, drag to move, click edge handles to connect</span>
  <div class="spacer"></div>
  <span id="stepCount">0 steps</span>
</div>

<!-- Import Modal -->
<div class="modal-overlay" id="importModal">
  <div class="modal">
    <h2>Import Workflow JSON</h2>
    <textarea id="importText" placeholder='Paste Lobster workflow JSON here...'></textarea>
    <div class="btn-row">
      <button onclick="closeImportModal()">Cancel</button>
      <button onclick="doImport()">Import</button>
    </div>
  </div>
</div>

<!-- Order Modal -->
<div class="modal-overlay" id="orderModal">
  <div class="modal">
    <h2>Execution Order</h2>
    <div id="orderContent" style="font-family:monospace; font-size:13px; white-space:pre-wrap;"></div>
    <div class="btn-row">
      <button onclick="document.getElementById('orderModal').classList.remove('open')">Close</button>
    </div>
  </div>
</div>

<script>
// ============================================================================
// State
// ============================================================================
const nodes = []; // { id, name, command, type, x, y, dependsOn, condition, timeout, approval }
let edges = [];   // { from, to }
let selectedNode = null;
let dragging = null;       // { node, offsetX, offsetY }
let connecting = null;     // { fromId }
let panOffset = { x: 0, y: 0 };
let isPanning = false;
let panStart = { x: 0, y: 0 };
let nodeIdCounter = 0;

const NW = 200, NH = 80, PORT_R = 6;
const canvas = document.getElementById('dag');
const ctx = canvas.getContext('2d');

// ============================================================================
// Resize
// ============================================================================
function resize() {
  const wrap = canvas.parentElement;
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  draw();
}
window.addEventListener('resize', resize);

// ============================================================================
// Drawing
// ============================================================================
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(panOffset.x, panOffset.y);

  // Draw grid
  ctx.strokeStyle = '#1a2030';
  ctx.lineWidth = 1;
  const gs = 40;
  const ox = panOffset.x % gs, oy = panOffset.y % gs;
  for (let x = -panOffset.x - ox; x < canvas.width - panOffset.x; x += gs) {
    ctx.beginPath(); ctx.moveTo(x, -panOffset.y); ctx.lineTo(x, canvas.height - panOffset.y); ctx.stroke();
  }
  for (let y = -panOffset.y - oy; y < canvas.height - panOffset.y; y += gs) {
    ctx.beginPath(); ctx.moveTo(-panOffset.x, y); ctx.lineTo(canvas.width - panOffset.x, y); ctx.stroke();
  }

  // Draw edges
  for (const edge of edges) {
    const from = nodes.find(n => n.id === edge.from);
    const to = nodes.find(n => n.id === edge.to);
    if (!from || !to) continue;

    const fx = from.x + NW / 2, fy = from.y + NH;
    const tx = to.x + NW / 2, ty = to.y;

    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    const cy1 = fy + (ty - fy) * 0.4;
    const cy2 = fy + (ty - fy) * 0.6;
    ctx.bezierCurveTo(fx, cy1, tx, cy2, tx, ty);
    ctx.stroke();

    // Arrow
    const angle = Math.atan2(ty - cy2, tx - tx) || -Math.PI / 2;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(angle);
    ctx.fillStyle = '#58a6ff';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-6, -10);
    ctx.lineTo(6, -10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Draw connecting line
  if (connecting && connecting.mx !== undefined) {
    const from = nodes.find(n => n.id === connecting.fromId);
    if (from) {
      ctx.strokeStyle = '#d29922';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(from.x + NW / 2, from.y + NH);
      ctx.lineTo(connecting.mx - panOffset.x, connecting.my - panOffset.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Draw nodes
  for (const node of nodes) {
    const isSelected = selectedNode && selectedNode.id === node.id;
    const isApproval = node.type === 'approval';

    // Shadow
    ctx.shadowColor = isSelected ? 'rgba(88,166,255,0.3)' : 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = isSelected ? 12 : 6;
    ctx.shadowOffsetY = 2;

    // Body
    ctx.fillStyle = isApproval ? '#2d1f00' : '#161b22';
    ctx.strokeStyle = isSelected ? '#58a6ff' : (isApproval ? '#d29922' : '#30363d');
    ctx.lineWidth = isSelected ? 2 : 1;
    roundRect(ctx, node.x, node.y, NW, NH, 8);
    ctx.fill();
    ctx.stroke();
    ctx.shadowColor = 'transparent';

    // Type badge
    const badge = isApproval ? 'APPROVAL' : 'STEP';
    const badgeColor = isApproval ? '#d29922' : '#3fb950';
    ctx.fillStyle = badgeColor;
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText(badge, node.x + 8, node.y + 14);

    // Name
    ctx.fillStyle = '#e6edf3';
    ctx.font = '600 12px sans-serif';
    const name = node.name.length > 22 ? node.name.slice(0, 20) + '...' : node.name;
    ctx.fillText(name, node.x + 8, node.y + 32);

    // Command preview
    ctx.fillStyle = '#8b949e';
    ctx.font = '11px monospace';
    const cmd = (node.command || '').length > 24 ? node.command.slice(0, 22) + '...' : (node.command || '');
    ctx.fillText(cmd, node.x + 8, node.y + 50);

    // ID
    ctx.fillStyle = '#484f58';
    ctx.font = '10px monospace';
    ctx.fillText(node.id, node.x + 8, node.y + 68);

    // Output port (bottom center)
    ctx.fillStyle = '#30363d';
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(node.x + NW / 2, node.y + NH, PORT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Input port (top center)
    ctx.beginPath();
    ctx.arc(node.x + NW / 2, node.y, PORT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ============================================================================
// Hit Testing
// ============================================================================
function nodeAt(mx, my) {
  const x = mx - panOffset.x, y = my - panOffset.y;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (x >= n.x && x <= n.x + NW && y >= n.y && y <= n.y + NH) return n;
  }
  return null;
}

function outputPortAt(mx, my) {
  const x = mx - panOffset.x, y = my - panOffset.y;
  for (const n of nodes) {
    const px = n.x + NW / 2, py = n.y + NH;
    if (Math.hypot(x - px, y - py) < PORT_R + 4) return n;
  }
  return null;
}

function inputPortAt(mx, my) {
  const x = mx - panOffset.x, y = my - panOffset.y;
  for (const n of nodes) {
    const px = n.x + NW / 2, py = n.y;
    if (Math.hypot(x - px, y - py) < PORT_R + 4) return n;
  }
  return null;
}

// ============================================================================
// Mouse Events
// ============================================================================
canvas.addEventListener('mousedown', e => {
  const mx = e.offsetX, my = e.offsetY;

  // Check output port (start connection)
  const outPort = outputPortAt(mx, my);
  if (outPort) {
    connecting = { fromId: outPort.id, mx, my };
    return;
  }

  // Check node click
  const node = nodeAt(mx, my);
  if (node) {
    if (e.detail === 2) {
      // Double click → open editor
      selectNode(node);
      openPanel(node);
    } else {
      selectNode(node);
      dragging = { node, offsetX: mx - panOffset.x - node.x, offsetY: my - panOffset.y - node.y };
    }
    return;
  }

  // Pan
  isPanning = true;
  panStart = { x: mx - panOffset.x, y: my - panOffset.y };
  selectedNode = null;
  closePanel();
  draw();
});

canvas.addEventListener('mousemove', e => {
  const mx = e.offsetX, my = e.offsetY;

  if (dragging) {
    dragging.node.x = mx - panOffset.x - dragging.offsetX;
    dragging.node.y = my - panOffset.y - dragging.offsetY;
    syncEdges();
    draw();
    return;
  }

  if (connecting) {
    connecting.mx = mx;
    connecting.my = my;
    draw();
    return;
  }

  if (isPanning) {
    panOffset.x = mx - panStart.x;
    panOffset.y = my - panStart.y;
    draw();
    return;
  }

  // Hover cursor
  const port = outputPortAt(mx, my) || inputPortAt(mx, my);
  const node = nodeAt(mx, my);
  canvas.style.cursor = port ? 'crosshair' : node ? 'grab' : 'default';
});

canvas.addEventListener('mouseup', e => {
  const mx = e.offsetX, my = e.offsetY;

  if (connecting) {
    const target = inputPortAt(mx, my);
    if (target && target.id !== connecting.fromId) {
      // Add edge (fromId → target creates dependency: target dependsOn fromId)
      const exists = edges.some(e => e.from === connecting.fromId && e.to === target.id);
      if (!exists) {
        edges.push({ from: connecting.fromId, to: target.id });
        // Update dependsOn
        if (!target.dependsOn) target.dependsOn = [];
        if (!target.dependsOn.includes(connecting.fromId)) {
          target.dependsOn.push(connecting.fromId);
        }
      }
    }
    connecting = null;
    draw();
    updateStatus();
    return;
  }

  dragging = null;
  isPanning = false;
});

// Prevent context menu on canvas
canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const node = nodeAt(e.offsetX, e.offsetY);
  if (node) {
    // Right-click → delete edge or node
    selectNode(node);
    openPanel(node);
  }
});

// Keyboard
document.addEventListener('keydown', e => {
  if (e.key === 'Delete' && selectedNode && document.activeElement === document.body) {
    deleteSelectedNode();
  }
  if (e.key === 'Escape') {
    connecting = null;
    closePanel();
    draw();
  }
});

// ============================================================================
// Node Operations
// ============================================================================
function addNode(type, preset) {
  const id = preset?.id || 'step_' + (++nodeIdCounter);
  const node = {
    id,
    name: preset?.name || (type === 'approval' ? 'Approval Gate' : 'New Step'),
    command: preset?.command || (type === 'approval' ? 'approve' : 'echo "hello"'),
    type: type || 'command',
    x: preset?.x ?? (canvas.width / 2 - panOffset.x - NW / 2 + (Math.random() - 0.5) * 100),
    y: preset?.y ?? (canvas.height / 2 - panOffset.y - NH / 2 + (Math.random() - 0.5) * 100),
    dependsOn: preset?.dependsOn || [],
    condition: preset?.condition || '',
    timeout: preset?.timeout || 0,
    approval: type === 'approval' ? 'required' : undefined,
  };
  nodes.push(node);
  selectNode(node);
  updateStatus();
  draw();
  return node;
}

function selectNode(node) {
  selectedNode = node;
  draw();
}

function deleteSelectedNode() {
  if (!selectedNode) return;
  const id = selectedNode.id;
  const idx = nodes.indexOf(selectedNode);
  if (idx >= 0) nodes.splice(idx, 1);
  edges = edges.filter(e => e.from !== id && e.to !== id);
  // Clean dependsOn references
  for (const n of nodes) {
    if (n.dependsOn) n.dependsOn = n.dependsOn.filter(d => d !== id);
  }
  selectedNode = null;
  closePanel();
  updateStatus();
  draw();
}

function syncEdges() {
  // Rebuild edges from dependsOn
  edges = [];
  for (const node of nodes) {
    for (const dep of node.dependsOn || []) {
      edges.push({ from: dep, to: node.id });
    }
  }
}

// ============================================================================
// Panel
// ============================================================================
function openPanel(node) {
  const p = document.getElementById('nodePanel');
  p.classList.add('open');
  document.getElementById('np-id').value = node.id;
  document.getElementById('np-name').value = node.name;
  document.getElementById('np-command').value = node.command;
  document.getElementById('np-type').value = node.type;
  document.getElementById('np-deps').value = (node.dependsOn || []).join(', ');
  document.getElementById('np-condition').value = node.condition || '';
  document.getElementById('np-timeout').value = node.timeout || '';
}

function closePanel() {
  document.getElementById('nodePanel').classList.remove('open');
}

function applyNodeEdit() {
  if (!selectedNode) return;
  selectedNode.name = document.getElementById('np-name').value;
  selectedNode.command = document.getElementById('np-command').value;
  selectedNode.type = document.getElementById('np-type').value;
  selectedNode.condition = document.getElementById('np-condition').value;
  selectedNode.timeout = parseInt(document.getElementById('np-timeout').value) || 0;
  selectedNode.approval = selectedNode.type === 'approval' ? 'required' : undefined;

  const depsStr = document.getElementById('np-deps').value;
  selectedNode.dependsOn = depsStr ? depsStr.split(',').map(s => s.trim()).filter(Boolean) : [];
  syncEdges();
  updateStatus();
  draw();
}

// ============================================================================
// Workflow operations
// ============================================================================
function buildWorkflow() {
  return {
    name: document.getElementById('wf-name').value || 'unnamed',
    version: document.getElementById('wf-version').value || '1.0.0',
    steps: nodes.map(n => ({
      id: n.id,
      name: n.name,
      command: n.command,
      dependsOn: n.dependsOn?.length ? n.dependsOn : undefined,
      condition: n.condition || undefined,
      timeout: n.timeout || undefined,
      approval: n.approval || undefined,
    })),
  };
}

function buildPositions() {
  const pos = {};
  for (const n of nodes) pos[n.id] = { x: n.x, y: n.y };
  return pos;
}

function validateWf() {
  const wf = buildWorkflow();
  const errors = [];
  if (!wf.name) errors.push('Missing name');
  if (!wf.steps.length) errors.push('No steps');

  const ids = new Set(wf.steps.map(s => s.id));
  if (ids.size !== wf.steps.length) errors.push('Duplicate IDs');

  for (const s of wf.steps) {
    for (const d of s.dependsOn || []) {
      if (!ids.has(d)) errors.push('Step ' + s.id + ' depends on unknown ' + d);
    }
  }

  // Cycle check
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const colors = {};
  wf.steps.forEach(s => colors[s.id] = WHITE);
  const sm = {};
  wf.steps.forEach(s => sm[s.id] = s);
  let hasCycle = false;
  function dfs(id) {
    colors[id] = GRAY;
    for (const d of sm[id]?.dependsOn || []) {
      if (colors[d] === GRAY) { hasCycle = true; return; }
      if (colors[d] === WHITE) dfs(d);
      if (hasCycle) return;
    }
    colors[id] = BLACK;
  }
  for (const s of wf.steps) { if (colors[s.id] === WHITE) { dfs(s.id); if (hasCycle) break; } }
  if (hasCycle) errors.push('Dependency cycle detected');

  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  if (errors.length === 0) {
    dot.className = 'dot ok';
    txt.textContent = 'Validation passed — workflow is valid';
  } else {
    dot.className = 'dot err';
    txt.textContent = 'Validation errors: ' + errors.join('; ');
  }
  return errors.length === 0;
}

function showOrder() {
  if (!validateWf()) return;
  const wf = buildWorkflow();

  // Topological sort
  const sm = {};
  wf.steps.forEach(s => sm[s.id] = s);
  const visited = new Set();
  const order = [];
  function visit(id) {
    if (visited.has(id)) return;
    visited.add(id);
    for (const d of sm[id]?.dependsOn || []) visit(d);
    order.push(id);
  }
  wf.steps.forEach(s => visit(s.id));

  // Find parallel groups
  const groups = [];
  const completed = new Set();
  const remaining = [...order];
  while (remaining.length > 0) {
    const group = [];
    for (const id of remaining) {
      const deps = sm[id]?.dependsOn || [];
      if (deps.every(d => completed.has(d))) group.push(id);
    }
    if (group.length === 0) break;
    groups.push(group);
    for (const id of group) { completed.add(id); remaining.splice(remaining.indexOf(id), 1); }
  }

  let text = 'Execution Order:\\n\\n';
  groups.forEach((g, i) => {
    text += 'Stage ' + (i + 1) + (g.length > 1 ? ' (parallel)' : '') + ':\\n';
    g.forEach(id => {
      const s = sm[id];
      text += '  ' + id + ' — ' + (s?.name || '?') + '\\n';
    });
    text += '\\n';
  });

  document.getElementById('orderContent').textContent = text;
  document.getElementById('orderModal').classList.add('open');
}

function exportJSON() {
  const wf = buildWorkflow();
  const json = JSON.stringify(wf, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (wf.name || 'workflow') + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function showImportModal() {
  document.getElementById('importModal').classList.add('open');
  document.getElementById('importText').value = '';
  document.getElementById('importText').focus();
}
function closeImportModal() {
  document.getElementById('importModal').classList.remove('open');
}

function doImport() {
  try {
    const text = document.getElementById('importText').value;
    const wf = JSON.parse(text);
    if (!wf.steps || !Array.isArray(wf.steps)) throw new Error('Missing steps array');
    loadWorkflow(wf);
    closeImportModal();
  } catch (err) {
    alert('Import failed: ' + err.message);
  }
}

function loadWorkflow(wf, positions) {
  nodes.length = 0;
  edges = [];
  selectedNode = null;
  nodeIdCounter = 0;
  closePanel();

  document.getElementById('wf-name').value = wf.name || '';
  document.getElementById('wf-version').value = wf.version || '1.0.0';

  // Auto-layout if no positions
  const stepCount = wf.steps.length;
  const cols = Math.ceil(Math.sqrt(stepCount));

  wf.steps.forEach((step, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const pos = positions?.[step.id];
    addNode(
      step.approval ? 'approval' : 'command',
      {
        id: step.id,
        name: step.name,
        command: step.command,
        dependsOn: step.dependsOn || [],
        condition: step.condition || '',
        timeout: step.timeout || 0,
        x: pos?.x ?? (80 + col * (NW + 60)),
        y: pos?.y ?? (80 + row * (NH + 80)),
      }
    );
    nodeIdCounter = Math.max(nodeIdCounter, parseInt(step.id.replace(/\\D/g, '')) || nodeIdCounter);
  });

  syncEdges();
  updateStatus();
  draw();
}

async function saveWorkflow() {
  const wf = buildWorkflow();
  const positions = buildPositions();
  try {
    const resp = await fetch(location.pathname + 'api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow: wf, positions }),
    });
    const data = await resp.json();
    setStatus('ok', 'Saved: ' + data.id);
  } catch (err) {
    setStatus('err', 'Save failed: ' + err.message);
  }
}

async function loadList() {
  try {
    const resp = await fetch(location.pathname + 'api/list');
    const list = await resp.json();
    if (list.length === 0) {
      setStatus('err', 'No saved workflows');
      return;
    }
    // Load the most recent
    const latest = list[0];
    const resp2 = await fetch(location.pathname + 'api/get?id=' + encodeURIComponent(latest.id));
    const stored = await resp2.json();
    loadWorkflow(stored.workflow, stored.positions);
    setStatus('ok', 'Loaded: ' + stored.workflow.name);
  } catch (err) {
    setStatus('err', 'Load failed: ' + err.message);
  }
}

function clearAll() {
  if (!confirm('Clear all nodes?')) return;
  nodes.length = 0;
  edges = [];
  selectedNode = null;
  nodeIdCounter = 0;
  closePanel();
  updateStatus();
  draw();
}

// ============================================================================
// Status
// ============================================================================
function updateStatus() {
  document.getElementById('stepCount').textContent = nodes.length + ' steps, ' + edges.length + ' edges';
}
function setStatus(type, msg) {
  document.getElementById('statusDot').className = 'dot ' + type;
  document.getElementById('statusText').textContent = msg;
}

// ============================================================================
// Init
// ============================================================================
resize();
updateStatus();
</script>
</body>
</html>`;
}

// ============================================================================
// Exports
// ============================================================================
export { workflowStore, WorkflowStore };
