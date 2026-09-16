/**
 * GK30 — auto widgets: byte-identical off, table → canvas HTML, authored reuse.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canvasStore } from '../../src/server/routes/canvas.js';
import { keepAuthoredWidget } from '../../src/widgets/widget-engine.js';
import { publishAnswerWidget } from '../../src/widgets/canvas-publish.js';

const tableAnswer = `${'Contexte de tableau. '.repeat(10)}\n\n` +
  '| Nom | Score |\n| --- | ---: |\n| Alpha | 98 |\n| Beta | 91 |';

function tmpEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    CODEBUDDY_WIDGETS_DIR: mkdtempSync(join(tmpdir(), 'gk30-auto-')),
    ...extra,
  } as NodeJS.ProcessEnv;
}

describe('GK30 auto widget canvas publish', () => {
  beforeEach(() => {
    canvasStore.clear();
  });

  afterEach(() => {
    canvasStore.clear();
  });

  it('is byte-identical and publishes nothing when widget env vars are unset', async () => {
    const env = tmpEnv();
    const result = await publishAnswerWidget(tableAnswer, [], { env });
    expect(result.answer).toBe(tableAnswer);
    expect(result.widgetHtml).toBeNull();
    expect(result.canvasId).toBeNull();
    expect(canvasStore.list()).toHaveLength(0);
  });

  it('publishes a server-rendered table widget when AUTO is on', async () => {
    const env = tmpEnv({ CODEBUDDY_WIDGETS: 'true', CODEBUDDY_WIDGETS_AUTO: 'true' });
    const result = await publishAnswerWidget(tableAnswer, [], { env });
    expect(result.answer).toBe(tableAnswer);
    expect(result.widgetHtml).toContain('<table');
    expect(result.widgetHtml).toContain('Alpha');
    expect(result.widgetHtml).not.toMatch(/<script/i);
    expect(result.canvasId).toMatch(/^canvas_/);
    expect(result.canvasPath).toBe(`/__codebuddy__/canvas/${result.canvasId}`);
    expect(canvasStore.get(result.canvasId!)?.html).toContain('Alpha');
  });

  it('reuses an already authored widget declared for the data type', async () => {
    const env = tmpEnv({ CODEBUDDY_WIDGETS: 'true', CODEBUDDY_WIDGETS_AUTO: 'true' });
    expect(keepAuthoredWidget({
      kind: 'metrics-card',
      template: '<style>.cbw-metrics{padding:8px}</style><div class="cbw-metrics">{{ label }}: {{ value }}</div>',
      sample: { type: 'metrics', label: 'Latency', value: '42 ms' },
      dataTypes: ['metrics'],
    }, env)).toBe(true);

    const answer = 'Voici les données demandées avec le contexte nécessaire. '.repeat(5);
    const result = await publishAnswerWidget(answer, [{ data: { type: 'metrics', label: 'Latency', value: '42 ms' } }], { env });
    expect(result.widgetHtml).toContain('Latency: 42 ms');
    expect(result.widgetHtml).toContain('cbw-metrics');
    expect(result.canvasId).toBeTruthy();
  });
});
