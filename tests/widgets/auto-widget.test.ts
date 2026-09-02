import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoWidget } from '../../src/widgets/auto-widget.js';
import { keepAuthoredWidget } from '../../src/widgets/widget-engine.js';
import { listAuthoredWidgetRegistry } from '../../src/widgets/widget-registry.js';
import { logger } from '../../src/utils/logger.js';

const answer = 'Voici les données demandées avec le contexte nécessaire. '.repeat(5);
const payload = { data: { type: 'metrics', label: 'Latency', value: '42 ms' } };
const template = '<style>.cbw-metrics{padding:8px}</style><div class="cbw-metrics">{{ label }}: {{ value }}</div>';

function tmpEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    CODEBUDDY_WIDGETS_DIR: mkdtempSync(join(tmpdir(), 'auto-widget-')),
    ...extra,
  } as NodeJS.ProcessEnv;
}

function enabledEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return tmpEnv({ CODEBUDDY_WIDGETS: 'true', CODEBUDDY_WIDGETS_AUTO: 'true', ...extra });
}

function keepMetrics(env: NodeJS.ProcessEnv): void {
  expect(keepAuthoredWidget({
    kind: 'metrics-card',
    template,
    sample: payload.data,
    dataTypes: ['metrics'],
  }, env)).toBe(true);
}

describe('autoWidget', () => {
  it('is a strict byte-identical passthrough when the auto env gate is off', async () => {
    const generate = jest.fn();
    const result = await autoWidget(answer, [payload], { env: tmpEnv(), generate });
    expect(result.answer).toBe(answer);
    expect(result.widgetHtml).toBeNull();
    expect(result.candidate).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('never throws on a render error and logs at debug level', async () => {
    const env = enabledEnv();
    keepMetrics(env);
    const debug = jest.spyOn(logger, 'debug').mockImplementation(() => undefined);
    await expect(autoWidget(answer, [payload], {
      env,
      renderAuthored: () => {
        throw new Error('simulated render failure');
      },
    })).resolves.toMatchObject({ answer, widgetHtml: null });
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('preserving text response'),
      expect.objectContaining({ error: 'simulated render failure' })
    );
    debug.mockRestore();
  });

  it('renders at most one automatic widget per answer', async () => {
    const env = enabledEnv();
    keepMetrics(env);
    const renderAuthored = jest.fn(() => '<!doctype html><html><body>one</body></html>');
    const result = await autoWidget(answer, [payload, { data: { type: 'metrics', value: 99 } }], {
      env,
      renderAuthored,
    });
    expect(result.widgetHtml).toContain('one');
    expect(renderAuthored).toHaveBeenCalledTimes(1);
  });

  it('renders a structured payload even when the answer is shorter than 200 characters', async () => {
    const env = enabledEnv();
    const data = {
      type: 'stock',
      symbol: 'AAPL',
      price: 324.85,
      currency: 'USD',
    };
    const renderCurated = jest.fn(() => '<!doctype html><html><body>AAPL</body></html>');
    const shortAnswer = 'Apple (AAPL) : 324,85 USD';

    const result = await autoWidget(shortAnswer, [{ data }], { env, renderCurated });

    expect(result.answer).toBe(shortAnswer);
    expect(result.candidate).toMatchObject({ kind: 'payload', dataType: 'stock', data });
    expect(result.widgetHtml).toContain('AAPL');
    expect(renderCurated).toHaveBeenCalledWith(data, env, undefined);
  });

  it('increments authored usage stats after each successful auto render', async () => {
    const env = enabledEnv();
    keepMetrics(env);
    const before = listAuthoredWidgetRegistry(env)[0];
    expect(before?.usedCount).toBe(0);

    const result = await autoWidget(answer, [payload], { env, now: () => 123456 });
    expect(result.widgetHtml).toContain('Latency: 42 ms');
    const after = listAuthoredWidgetRegistry(env)[0];
    expect(after?.usedCount).toBe(1);
    expect(after?.lastUsedAt).toBe(123456);
  });

  it('does not invoke generation when AUTOGEN is off by default', async () => {
    const env = enabledEnv();
    const generate = jest.fn(async () => '<!doctype html><html><body>generated</body></html>');
    const result = await autoWidget(answer, [{ data: { type: 'novel', value: 1 } }], { env, generate });
    expect(result.answer).toBe(answer);
    expect(result.widgetHtml).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('never returns HTML containing a script', async () => {
    const env = enabledEnv();
    keepMetrics(env);
    const result = await autoWidget(answer, [payload], { env });
    expect(result.widgetHtml).not.toBeNull();
    expect(result.widgetHtml).not.toMatch(/<script/i);
    expect(result.widgetHtml).toContain("default-src 'none'");
  });
});
