import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCostCommand,
  readSavedCostSessions,
  type SavedCostSessions,
} from '../../src/commands/cost.js';
import type { CostSessionEntry } from '../../src/analytics/cost-report.js';

describe('buddy cost', () => {
  const now = new Date('2026-08-16T12:00:00.000Z');
  let sessions: CostSessionEntry[];

  beforeEach(() => {
    sessions = [
      {
        id: 'older',
        model: 'gpt-4o-mini',
        provider: 'openai',
        createdAt: '2026-08-10T08:00:00.000Z',
        lastAccessedAt: '2026-08-10T08:05:00.000Z',
        turns: [
          {
            timestamp: '2026-08-10T08:00:00.000Z',
            inputTokens: 1_000,
            outputTokens: 500,
            costUsd: 0.001,
          },
        ],
      },
      {
        id: 'latest',
        model: 'qwen3:8b',
        provider: 'ollama',
        createdAt: '2026-08-15T08:00:00.000Z',
        lastAccessedAt: '2026-08-15T08:05:00.000Z',
        messages: [
          { type: 'user', content: 'Question', timestamp: '2026-08-15T08:00:00.000Z' },
          { type: 'assistant', content: 'Réponse', timestamp: '2026-08-15T08:01:00.000Z' },
        ],
      },
    ];
  });

  it('renders an aligned provider table and signals unknown cost', async () => {
    const output: string[] = [];
    await createCostCommand({
      loadSessions: async (): Promise<SavedCostSessions> => ({ sessions, warnings: [] }),
      now: () => now,
      stdout: (message) => output.push(message),
    })
      .exitOverride()
      .parseAsync(['node', 'cost', '--by', 'provider']);

    expect(output).toHaveLength(1);
    expect(output[0]).toContain('Code Buddy — tableau de bord des dépenses');
    expect(output[0]).toContain('Ventilation par provider');
    expect(output[0]).toContain('openai');
    expect(output[0]).toContain('ollama');
    expect(output[0]).toContain('Coût inconnu : 1 tour dans 1 session');
    expect(output[0]).toMatch(/Provider\s+Coût\s+Tokens in\s+Tokens out\s+Tours/);
  });

  it('selects --last and emits machine-readable JSON', async () => {
    const output: string[] = [];
    await createCostCommand({
      loadSessions: async () => sessions,
      now: () => now,
      stdout: (message) => output.push(message),
    })
      .exitOverride()
      .parseAsync(['node', 'cost', '--last', '--json']);

    const report = JSON.parse(output[0] ?? '{}') as {
      sessions: number;
      turns: number;
      groupBy: string;
      byModel: Record<string, unknown>;
      unknownCostSessions: number;
    };
    expect(report.sessions).toBe(1);
    expect(report.turns).toBe(1);
    expect(report.groupBy).toBe('model');
    expect(Object.keys(report.byModel)).toEqual(['qwen3:8b']);
    expect(report.unknownCostSessions).toBe(1);
  });

  it('returns a clear no-session result without throwing', async () => {
    const human: string[] = [];
    await createCostCommand({
      loadSessions: async () => [],
      now: () => now,
      stdout: (message) => human.push(message),
    })
      .exitOverride()
      .parseAsync(['node', 'cost']);
    expect(human).toEqual(['Aucune session sauvegardée ne correspond aux filtres.']);

    const json: string[] = [];
    await createCostCommand({
      loadSessions: async () => [],
      now: () => now,
      stdout: (message) => json.push(message),
    })
      .exitOverride()
      .parseAsync(['node', 'cost', '--json']);
    expect(JSON.parse(json[0] ?? '{}')).toMatchObject({
      sessions: 0,
      turns: 0,
      message: 'Aucune session sauvegardée ne correspond aux filtres.',
    });
  });

  it('rejects conflicting selectors and unknown session IDs', async () => {
    const command = () =>
      createCostCommand({
        loadSessions: async () => sessions,
        now: () => now,
        stdout: () => undefined,
      }).exitOverride();

    await expect(
      command().parseAsync(['node', 'cost', '--last', '--session', 'latest'])
    ).rejects.toThrow('incompatibles');
    await expect(command().parseAsync(['node', 'cost', '--session', 'missing'])).rejects.toThrow(
      'Session introuvable'
    );
  });
});

describe('readSavedCostSessions', () => {
  let tempDirectory: string;

  beforeEach(async () => {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'buddy-cost-'));
  });

  afterEach(async () => {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  });

  it('reads direct and legacy-container JSON while skipping malformed files', async () => {
    await fs.writeFile(
      path.join(tempDirectory, 'direct.json'),
      JSON.stringify({ id: 'direct', model: 'gpt-4o', messages: [] })
    );
    await fs.writeFile(
      path.join(tempDirectory, 'sessions.json'),
      JSON.stringify({
        sessions: [
          { id: 'legacy', model: 'grok-3', messages: [] },
          { id: 'direct', model: 'stale-container-copy', messages: [] },
        ],
      })
    );
    await fs.writeFile(path.join(tempDirectory, 'broken.json'), '{');

    const result = await readSavedCostSessions(tempDirectory);

    expect(result.sessions.map((entry) => entry.id).sort()).toEqual(['direct', 'legacy']);
    expect(result.sessions.find((entry) => entry.id === 'direct')?.model).toBe('gpt-4o');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('broken.json');
  });

  it('does not create a missing sessions directory', async () => {
    const missing = path.join(tempDirectory, 'does-not-exist');
    await expect(readSavedCostSessions(missing)).resolves.toEqual({ sessions: [], warnings: [] });
    await expect(fs.stat(missing)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
