/**
 * Isolement du catalogue HTTP : les sorties métriques héritées ne doivent
 * pas écrire hors du répertoire temporaire, et deux isolements empilés
 * ne se restaurent pas d'un seul coup.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { MetricsCollector } from '../../src/metrics/metrics-collector.js';
import {
  isolateCatalogueEnv,
  restoreCatalogueEnv,
  startCatalogueServer,
} from './catalogue-routes-http-harness.js';

const leftovers: string[] = [];

afterEach(() => {
  for (let i = 0; i < 8; i += 1) {
    const before = process.env.HOME;
    restoreCatalogueEnv();
    if (process.env.HOME === before) break;
  }
  delete process.env.METRICS_FILE;
  delete process.env.METRICS_PATH;
  delete process.env.METRICS_INTERVAL;
  delete process.env.METRICS_CONSOLE;
  for (const dir of leftovers.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('isolement du catalogue HTTP', () => {
  it('neutralise METRICS_* avant toute écriture hors du répertoire temporaire', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cb-catalogue-metrics-'));
    leftovers.push(root);
    const outside = path.join(root, 'outside');
    const isolated = path.join(root, 'isolated');
    process.env.METRICS_FILE = 'true';
    process.env.METRICS_PATH = outside;
    process.env.METRICS_INTERVAL = '100';
    process.env.METRICS_CONSOLE = 'true';

    isolateCatalogueEnv(isolated);

    expect(process.env.METRICS_FILE, 'METRICS_FILE survit à l\'isolement').toBeUndefined();
    expect(process.env.METRICS_PATH, 'METRICS_PATH survit à l\'isolement').toBeUndefined();
    expect(process.env.METRICS_INTERVAL, 'METRICS_INTERVAL survit à l\'isolement').toBeUndefined();
    expect(process.env.METRICS_CONSOLE, 'METRICS_CONSOLE survit à l\'isolement').toBeUndefined();

    const collector = new MetricsCollector({
      fileExport: process.env.METRICS_FILE === 'true',
      filePath: process.env.METRICS_PATH,
      exportInterval: Number.parseInt(process.env.METRICS_INTERVAL || '60000', 10),
    });
    try {
      await collector.init();
      await collector.shutdown();
    } finally {
      await collector.shutdown();
    }

    let leaked: string[] = [];
    try {
      leaked = readdirSync(outside);
    } catch {
      leaked = [];
    }
    expect(leaked, 'écriture métrique hors isolement').toEqual([]);
  });

  it('restaure un seul niveau quand deux isolements sont actifs', () => {
    const originalHome = process.env.HOME;
    const rootA = mkdtempSync(path.join(tmpdir(), 'cb-catalogue-iso-a-'));
    const rootB = mkdtempSync(path.join(tmpdir(), 'cb-catalogue-iso-b-'));
    leftovers.push(rootA, rootB);

    isolateCatalogueEnv(rootA);
    isolateCatalogueEnv(rootB);
    expect(process.env.HOME).toBe(rootB);

    restoreCatalogueEnv();
    expect(process.env.HOME, 'restauration prématurée du HOME').toBe(rootA);

    restoreCatalogueEnv();
    expect(process.env.HOME).toBe(originalHome);
  });

  it('restaure le cwd et le HOME si le démarrage échoue', async () => {
    const cwd = process.cwd();
    const home = process.env.HOME;
    await expect(startCatalogueServer({
      start: async () => {
        throw new Error('démarrage impossible');
      },
    })).rejects.toThrow('démarrage impossible');
    expect(process.cwd(), 'cwd non restauré').toBe(cwd);
    expect(process.env.HOME, 'HOME non restauré').toBe(home);
  });
});
