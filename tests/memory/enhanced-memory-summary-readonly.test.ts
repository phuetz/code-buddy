import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const homeHolder = vi.hoisted(() => ({ dir: '' }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => homeHolder.dir,
    default: { ...actual, homedir: () => homeHolder.dir },
  };
});

import { EnhancedMemory } from '../../src/memory/enhanced-memory.js';

const testRoot = path.join(process.cwd(), '.r28-tests');

describe('R28 D7 — recall ne réécrit pas des résumés corrompus', () => {
  let home: string;
  let memory: EnhancedMemory | null;

  beforeEach(() => {
    fs.mkdirSync(testRoot, { recursive: true });
    home = fs.mkdtempSync(path.join(testRoot, 'enhanced-summary-'));
    homeHolder.dir = home;
    memory = null;
  });

  afterEach(async () => {
    memory?.dispose();
    await memory?.flush();
    memory = null;
    fs.rmSync(home, { recursive: true, force: true });
    try {
      fs.rmdirSync(testRoot);
    } catch {
      // Un autre test R28 peut encore utiliser la racine partagée.
    }
  });

  it('rend les souvenirs mais conserve summaries.json octet pour octet', async () => {
    const dataDir = path.join(home, '.codebuddy', 'memory');
    fs.mkdirSync(path.join(dataDir, 'projects'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'memories'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'memory-index.json'), JSON.stringify([{
      id: 'ancien',
      type: 'fact',
      content: 'nous avons choisi SQLite',
      importance: 0.8,
      accessCount: 0,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
      lastAccessedAt: '2026-09-01T10:00:00.000Z',
      tags: [],
      metadata: {},
    }]));
    const summariesPath = path.join(dataDir, 'summaries.json');
    const corrupt = '[{"summary":"décision historique"}';
    fs.writeFileSync(summariesPath, corrupt);

    memory = new EnhancedMemory({ useSQLite: false, embeddingEnabled: false });
    const recalled = await memory.recall({ query: 'SQLite' });

    expect(recalled).toHaveLength(1);
    expect(recalled[0]?.content).toContain('SQLite');
    expect(fs.readFileSync(summariesPath, 'utf8')).toBe(corrupt);
    await expect(memory.storeSummary({
      sessionId: 'nouvelle',
      summary: 'ne doit pas mentir',
      topics: ['mémoire'],
      messageCount: 1,
    })).rejects.toThrow(/summaries\.json.*corrupt|summaries.*unreadable/i);
  });
});
