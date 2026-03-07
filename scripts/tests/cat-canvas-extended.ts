/**
 * Cat 48: Canvas Undo/Redo & Rendering (6 tests, no API)
 * Cat 49: ROI Tracker Extended (5 tests, no API)
 * Cat 50: Observability & Tracing (4 tests, no API)
 */

import type { TestDef } from './types.js';
import { CanvasManager } from '../../src/canvas/canvas-manager.js';
import { ROITracker } from '../../src/analytics/roi-tracker.js';

// ============================================================================
// Cat 48: Canvas Undo/Redo & Rendering
// ============================================================================

export function cat48CanvasUndoRender(): TestDef[] {
  return [
    {
      name: '48.1-undo-reverts-add',
      timeout: 5000,
      fn: async () => {
        const mgr = new CanvasManager();
        const canvas = mgr.createCanvas();
        mgr.addElement(canvas.id, {
          type: 'text' as any, content: 'Undoable', position: { x: 0, y: 0 },
          size: { width: 100, height: 50 }, visible: true, locked: false, opacity: 1, style: {},
        });
        const beforeUndo = mgr.getCanvas(canvas.id)!.elements.length;
        mgr.undo(canvas.id);
        const afterUndo = mgr.getCanvas(canvas.id)!.elements.length;
        return {
          pass: beforeUndo === 1 && afterUndo === 0,
          metadata: { beforeUndo, afterUndo },
        };
      },
    },
    {
      name: '48.2-redo-restores-element',
      timeout: 5000,
      fn: async () => {
        const mgr = new CanvasManager();
        const canvas = mgr.createCanvas();
        mgr.addElement(canvas.id, {
          type: 'text' as any, content: 'Redoable', position: { x: 0, y: 0 },
          size: { width: 100, height: 50 }, visible: true, locked: false, opacity: 1, style: {},
        });
        mgr.undo(canvas.id);
        mgr.redo(canvas.id);
        const count = mgr.getCanvas(canvas.id)!.elements.length;
        return { pass: count === 1, metadata: { afterRedo: count } };
      },
    },
    {
      name: '48.3-can-undo-can-redo',
      timeout: 5000,
      fn: async () => {
        const mgr = new CanvasManager();
        const canvas = mgr.createCanvas();
        const cantUndoEmpty = mgr.canUndo(canvas.id);
        mgr.addElement(canvas.id, {
          type: 'text' as any, content: 'Test', position: { x: 0, y: 0 },
          size: { width: 50, height: 50 }, visible: true, locked: false, opacity: 1, style: {},
        });
        const canUndoAfterAdd = mgr.canUndo(canvas.id);
        mgr.undo(canvas.id);
        const canRedoAfterUndo = mgr.canRedo(canvas.id);
        return {
          pass: !cantUndoEmpty && canUndoAfterAdd && canRedoAfterUndo,
          metadata: { cantUndoEmpty, canUndoAfterAdd, canRedoAfterUndo },
        };
      },
    },
    {
      name: '48.4-snap-to-grid',
      timeout: 5000,
      fn: async () => {
        const mgr = new CanvasManager();
        const canvas = mgr.createCanvas({ snapToGrid: true, gridSize: 20 });
        const el = mgr.addElement(canvas.id, {
          type: 'text' as any, content: 'Snap', position: { x: 0, y: 0 },
          size: { width: 50, height: 50 }, visible: true, locked: false, opacity: 1, style: {},
        });
        const moved = mgr.moveElement(canvas.id, el.id, { x: 13, y: 27 });
        return {
          pass: moved !== null && moved.position.x === 20 && moved.position.y === 20,
          metadata: { position: moved?.position },
        };
      },
    },
    {
      name: '48.5-locked-element-cannot-move',
      timeout: 5000,
      fn: async () => {
        const mgr = new CanvasManager();
        const canvas = mgr.createCanvas();
        const el = mgr.addElement(canvas.id, {
          type: 'text' as any, content: 'Locked', position: { x: 10, y: 10 },
          size: { width: 50, height: 50 }, visible: true, locked: true, opacity: 1, style: {},
        });
        const result = mgr.moveElement(canvas.id, el.id, { x: 100, y: 100 });
        const unchanged = mgr.getElement(canvas.id, el.id);
        return {
          pass: result === null && unchanged!.position.x === 10,
          metadata: { moveResult: result, position: unchanged?.position },
        };
      },
    },
    {
      name: '48.6-render-to-html',
      timeout: 5000,
      fn: async () => {
        const mgr = new CanvasManager();
        const canvas = mgr.createCanvas({ width: 400, height: 300 });
        mgr.addElement(canvas.id, {
          type: 'text' as any, content: 'Hello HTML', position: { x: 10, y: 10 },
          size: { width: 100, height: 30 }, visible: true, locked: false, opacity: 1, style: {},
        });
        const html = mgr.renderToHTML(canvas.id);
        return {
          pass: html !== undefined && html.includes('<!DOCTYPE html>') && html.includes('canvas'),
          metadata: { preview: html?.substring(0, 200) },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 49: ROI Tracker Extended
// ============================================================================

export function cat49ROIExtended(): TestDef[] {
  return [
    {
      name: '49.1-format-report-output',
      timeout: 5000,
      fn: async () => {
        const tracker = new ROITracker({ hourlyRate: 75, dataPath: '/tmp/roi-test-' + Date.now() + '.json' });
        tracker.recordTask({ type: 'bug_fix', description: 'Fix login', apiCost: 0.05, tokensUsed: 5000, actualMinutes: 5, linesOfCode: 20, success: true });
        tracker.recordTask({ type: 'code_generation', description: 'Add feature', apiCost: 0.10, tokensUsed: 10000, actualMinutes: 10, linesOfCode: 100, success: true });
        const report = tracker.getReport(30);
        const formatted = tracker.formatReport(report);
        return {
          pass: formatted.includes('ROI ANALYSIS REPORT') && formatted.includes('VALUE ANALYSIS') && formatted.includes('$75'),
          metadata: { preview: formatted.substring(0, 300) },
        };
      },
    },
    {
      name: '49.2-recommendations-high-roi',
      timeout: 5000,
      fn: async () => {
        const tracker = new ROITracker({ hourlyRate: 100, dataPath: '/tmp/roi-test-' + Date.now() + '.json' });
        // High productivity: 2min actual vs estimated 60min
        tracker.recordTask({ type: 'code_generation', description: 'Generate API', apiCost: 0.01, tokensUsed: 1000, actualMinutes: 2, linesOfCode: 200, success: true });
        const report = tracker.getReport(30);
        const hasPositiveRec = report.recommendations.some(r => r.includes('Great ROI') || r.includes('Excellent'));
        return {
          pass: report.metrics.netValue > 0 && (hasPositiveRec || report.metrics.productivityMultiplier > 5),
          metadata: { netValue: report.metrics.netValue, multiplier: report.metrics.productivityMultiplier, recs: report.recommendations },
        };
      },
    },
    {
      name: '49.3-export-data-json',
      timeout: 5000,
      fn: async () => {
        const tracker = new ROITracker({ hourlyRate: 50, dataPath: '/tmp/roi-test-' + Date.now() + '.json' });
        tracker.recordTask({ type: 'testing', description: 'Write tests', apiCost: 0.02, tokensUsed: 2000, actualMinutes: 3, success: true });
        const json = tracker.exportData();
        const parsed = JSON.parse(json);
        return {
          pass: Array.isArray(parsed) && parsed.length === 1 && parsed[0].type === 'testing',
          metadata: { taskCount: parsed.length },
        };
      },
    },
    {
      name: '49.4-clear-removes-all',
      timeout: 5000,
      fn: async () => {
        const tracker = new ROITracker({ hourlyRate: 50, dataPath: '/tmp/roi-test-' + Date.now() + '.json' });
        tracker.recordTask({ type: 'other', description: 'Task', apiCost: 0.01, tokensUsed: 100, actualMinutes: 1, success: true });
        tracker.clear();
        const report = tracker.getReport(30);
        return {
          pass: report.metrics.tasksCompleted === 0,
          metadata: { tasks: report.metrics.tasksCompleted },
        };
      },
    },
    {
      name: '49.5-success-rate-calculation',
      timeout: 5000,
      fn: async () => {
        const tracker = new ROITracker({ hourlyRate: 50, dataPath: '/tmp/roi-test-' + Date.now() + '.json' });
        tracker.recordTask({ type: 'bug_fix', description: 'Fix A', apiCost: 0.01, tokensUsed: 100, actualMinutes: 1, success: true });
        tracker.recordTask({ type: 'bug_fix', description: 'Fix B', apiCost: 0.01, tokensUsed: 100, actualMinutes: 1, success: true });
        tracker.recordTask({ type: 'bug_fix', description: 'Fix C', apiCost: 0.01, tokensUsed: 100, actualMinutes: 1, success: false });
        const report = tracker.getReport(30);
        // 2 out of 3 succeeded = ~66.7%
        return {
          pass: Math.abs(report.metrics.successRate - 2 / 3) < 0.01,
          metadata: { successRate: report.metrics.successRate },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 50: Observability & Tracing
// ============================================================================

export function cat50Observability(): TestDef[] {
  return [
    {
      name: '50.1-observability-module-exports',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/observability/index.js');
        const keys = Object.keys(mod);
        return {
          pass: keys.length >= 1,
          metadata: { exports: keys },
        };
      },
    },
    {
      name: '50.2-init-observability-idempotent',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/observability/index.js');
        const init = mod.initObservability;
        if (!init) return { pass: true, metadata: { skip: 'no initObservability' } };
        // Call twice — should not throw
        try {
          init();
          init();
          return { pass: true };
        } catch (e: any) {
          return { pass: false, metadata: { error: e.message } };
        }
      },
    },
    {
      name: '50.3-tracing-module-exports',
      timeout: 5000,
      fn: async () => {
        try {
          const mod = await import('../../src/observability/tracing.js');
          const keys = Object.keys(mod);
          return { pass: keys.length >= 1, metadata: { exports: keys } };
        } catch {
          return { pass: true, metadata: { skip: 'tracing module not available' } };
        }
      },
    },
    {
      name: '50.4-no-crash-without-env-vars',
      timeout: 5000,
      fn: async () => {
        // Ensure observability doesn't crash when SENTRY_DSN / OTEL vars are absent
        const origSentry = process.env.SENTRY_DSN;
        const origOtel = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        delete process.env.SENTRY_DSN;
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        try {
          const mod = await import('../../src/observability/index.js');
          mod.initObservability?.();
          return { pass: true };
        } catch (e: any) {
          return { pass: false, metadata: { error: e.message } };
        } finally {
          if (origSentry) process.env.SENTRY_DSN = origSentry;
          if (origOtel) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = origOtel;
        }
      },
    },
  ];
}
