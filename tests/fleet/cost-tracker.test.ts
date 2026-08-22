/**
 * Fleet P8 — cost tracker tests. Each test uses a tmp ledger file
 * so they're hermetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { CostTracker } from '../../src/fleet/cost-tracker';

let tmpFile: string;

function newTracker(): CostTracker {
  return new CostTracker({ file: tmpFile });
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-tracker-'));
  tmpFile = path.join(dir, 'ledger.json');
});

afterEach(() => {
  try {
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    /* ignore */
  }
});

describe('CostTracker — basic charge + load', () => {
  it('records a charge to disk', async () => {
    const t = newTracker();
    await t.charge({
      at: new Date().toISOString(),
      peerId: 'p1',
      provider: 'anthropic',
      model: 'claude-opus-4',
      usd: 0.42,
    });
    const ledger = await t.load();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].usd).toBe(0.42);
  });

  it('returns [] when ledger file does not exist', async () => {
    const t = newTracker();
    expect(await t.load()).toEqual([]);
  });

  it('appends multiple charges in order', async () => {
    const t = newTracker();
    await t.charge({
      at: new Date().toISOString(),
      peerId: 'p1',
      provider: 'anthropic',
      model: 'claude-opus-4',
      usd: 1,
    });
    await t.charge({
      at: new Date().toISOString(),
      peerId: 'p2',
      provider: 'openai',
      model: 'gpt-5',
      usd: 0.5,
    });
    const ledger = await t.load();
    expect(ledger).toHaveLength(2);
  });
});

describe('CostTracker — summary aggregation', () => {
  it('sums today + groups by provider/peer', async () => {
    const t = newTracker();
    const now = new Date().toISOString();
    await t.charge({
      at: now,
      peerId: 'ministar',
      provider: 'anthropic',
      model: 'claude-opus-4',
      usd: 1.5,
    });
    await t.charge({
      at: now,
      peerId: 'cloud',
      provider: 'openai',
      model: 'gpt-5',
      usd: 0.5,
    });
    await t.charge({
      at: now,
      peerId: 'ministar',
      provider: 'anthropic',
      model: 'claude-haiku-4',
      usd: 0.1,
    });
    const summary = await t.summary();
    expect(summary.todayUsd).toBeCloseTo(2.1);
    expect(summary.todayByProvider.anthropic).toBeCloseTo(1.6);
    expect(summary.todayByProvider.openai).toBe(0.5);
    expect(summary.todayByPeer.ministar).toBeCloseTo(1.6);
    expect(summary.todayByPeer.cloud).toBe(0.5);
  });

  it('excludes pre-today entries from todayUsd', async () => {
    const t = newTracker();
    const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    await t.charge({
      at: yesterday,
      peerId: 'p',
      provider: 'anthropic',
      model: 'm',
      usd: 10,
    });
    await t.charge({
      at: new Date().toISOString(),
      peerId: 'p',
      provider: 'anthropic',
      model: 'm',
      usd: 1,
    });
    const summary = await t.summary();
    expect(summary.todayUsd).toBe(1);
    expect(summary.weekUsd).toBe(11);
  });
});

describe('CostTracker — budget caps', () => {
  it('canSpend returns ok when both caps have headroom', async () => {
    const t = newTracker();
    const check = await t.canSpend(0.5, 'saga-1');
    expect(check.ok).toBe(true);
    expect(check.remainingUsd).toBeGreaterThan(0);
  });

  it('blocks when daily cap would be exceeded', async () => {
    const t = newTracker();
    const now = new Date().toISOString();
    await t.charge({
      at: now,
      peerId: 'p',
      provider: 'a',
      model: 'm',
      usd: 4.6, // close to default 5 USD cap
    });
    const check = await t.canSpend(0.6, 'saga-1');
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('Daily cap');
  });

  it('blocks when per-saga cap would be exceeded', async () => {
    const t = newTracker();
    const now = new Date().toISOString();
    await t.charge({
      at: now,
      peerId: 'p',
      provider: 'a',
      model: 'm',
      usd: 0.95,
      sagaId: 'saga-99',
    });
    const check = await t.canSpend(0.2, 'saga-99'); // default cap = 1 USD
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('saga');
  });

  it('respects custom caps', async () => {
    const t = newTracker();
    await t.charge({
      at: new Date().toISOString(),
      peerId: 'p',
      provider: 'a',
      model: 'm',
      usd: 9,
    });
    const check = await t.canSpend(2, undefined, {
      maxDailyUsd: 10,
      maxSagaUsd: 1,
    });
    expect(check.ok).toBe(false);
  });

  it('exposes an allow/deny decision for inbound fleet calls', async () => {
    const t = newTracker();
    const decision = await t.isWithinBudget(
      0.2,
      { maxDailyUsd: 5, maxSagaUsd: 0.1 },
      'incoming-trace',
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('saga');
  });

  it('fails closed when the ledger is malformed', async () => {
    fs.writeFileSync(tmpFile, '{not valid json');
    const t = newTracker();

    await expect(t.isWithinBudget(0.01)).rejects.toThrow('FLEET_COST_LEDGER_UNAVAILABLE');
  });
});

describe('CostTracker — vacuum', () => {
  it('drops entries older than the retention window', async () => {
    const t = newTracker();
    await t.charge({
      at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      peerId: 'p',
      provider: 'a',
      model: 'm',
      usd: 1,
    });
    await t.charge({
      at: new Date().toISOString(),
      peerId: 'p',
      provider: 'a',
      model: 'm',
      usd: 1,
    });
    const dropped = await t.vacuum(30);
    expect(dropped).toBe(1);
    expect((await t.load()).length).toBe(1);
  });

  it('returns 0 when nothing to drop', async () => {
    const t = newTracker();
    await t.charge({
      at: new Date().toISOString(),
      peerId: 'p',
      provider: 'a',
      model: 'm',
      usd: 1,
    });
    expect(await t.vacuum(30)).toBe(0);
  });
});
