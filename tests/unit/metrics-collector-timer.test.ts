/**
 * Audit 2026-09-02 — famille « ressources non bornées » :
 * le setInterval anonyme de collectSystemMetrics (10 s) n'était ni stocké,
 * ni unref(), ni nettoyé par shutdown() — timer orphelin qui maintient
 * l'event loop et fuit à chaque cycle init/shutdown.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MetricsCollector } from '../../src/metrics/metrics-collector.js';

describe('MetricsCollector — cycle de vie du timer système', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shutdown() arrête la collecte système périodique', async () => {
    vi.useFakeTimers();
    const collector = new MetricsCollector({ fileExport: false });
    await collector.init();
    const spy = vi.spyOn(collector as any, 'collectSystemMetrics');

    await vi.advanceTimersByTimeAsync(10_000);
    const callsWhileLive = spy.mock.calls.length;
    expect(callsWhileLive).toBeGreaterThan(0);

    await collector.shutdown();
    spy.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spy.mock.calls.length).toBe(0);
  });
});
