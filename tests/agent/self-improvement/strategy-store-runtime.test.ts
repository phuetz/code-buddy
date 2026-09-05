import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { StrategyStore } from '../../../src/agent/self-improvement/strategy-store.js';
import { resolveStrategyOverlay, renderDirectives } from '../../../src/agent/self-improvement/strategy-runtime.js';
import { BASELINE_STRATEGY, type StrategySpec } from '../../../src/agent/self-improvement/strategy-types.js';

let work: string;
let store: StrategyStore;
const child: StrategySpec = {
  ...BASELINE_STRATEGY,
  id: 'strat-headless-v2-aaaaaa',
  version: 2,
  parentId: 'baseline',
  scope: 'headless',
  limits: { maxToolRounds: 300, maxCostUsd: 15 },
  directives: ['Commit after each completed step, naming the files.'],
  provenance: { source: 'manual', experienceIds: [], createdAt: '2026-09-04T10:00:00.000Z' },
};
beforeEach(() => {
  work = path.join(os.tmpdir(), `strat-store-${randomUUID()}`);
  store = new StrategyStore({ workDir: work });
});
afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

describe('StrategyStore', () => {
  it('resolves the virtual baseline on an empty store and never saves it', () => {
    expect(store.resolveActive('headless')).toBe(BASELINE_STRATEGY);
    expect(() => store.save(BASELINE_STRATEGY)).toThrow(/virtual/);
  });
  it('saves atomically with mode 0600, activates per scope, refuses a scope mismatch', () => {
    store.save(child);
    const file = path.join(work, '.codebuddy', 'strategies', `${child.id}.json`);
    // Windows n'a pas de bits de permission POSIX : NTFS rend systématiquement
    // 666 quel que soit le mode demandé. Le reste du scénario (activation par
    // portée, refus d'une portée qui ne correspond pas) est vérifié partout ;
    // seule cette assertion est bornée aux systèmes qui ont la notion.
    if (process.platform !== 'win32') {
      expect((fs.statSync(file).mode & 0o777).toString(8)).toBe('600');
    }
    expect(fs.existsSync(file)).toBe(true);
    expect(() => store.activate('audit', child.id)).toThrow(/scope/);
    store.activate('headless', child.id);
    expect(store.resolveActive('headless').id).toBe(child.id);
    expect(store.resolveActive('audit').id).toBe('baseline');
  });
  it('skips an invalid or foreign file and degrades to the baseline (never throws)', () => {
    store.save(child);
    store.activate('headless', child.id);
    fs.writeFileSync(path.join(store.dir, `${child.id}.json`), JSON.stringify({ ...child, disableSandbox: true }));
    expect(store.resolveActive('headless').id).toBe('baseline');
    fs.writeFileSync(path.join(store.dir, 'evil-one.json'), JSON.stringify({ ...child, id: 'strat-headless-v2-aaaaaa' }));
    expect(store.list()).toHaveLength(0);
  });
  it('archives instead of deleting and deactivates', () => {
    store.save(child);
    store.activate('headless', child.id);
    expect(store.archive(child.id)).toBe(true);
    expect(store.get(child.id)).toBeNull();
    expect(fs.readdirSync(path.join(store.dir, 'archive'))).toHaveLength(1);
    expect(store.activeId('headless')).toBe('baseline');
  });
});

describe('strategy runtime overlay (opt-in)', () => {
  it('returns an empty overlay without CODEBUDDY_SELF_IMPROVE_STRATEGIES — byte-identical behavior', () => {
    store.save(child);
    store.activate('headless', child.id);
    expect(resolveStrategyOverlay('headless', {}, { env: {}, store })).toEqual({});
    expect(resolveStrategyOverlay('headless', {}, { env: { CODEBUDDY_SELF_IMPROVE_STRATEGIES: 'false' }, store })).toEqual({});
  });
  it('fills only what the user left unset, and renders directives as a tagged block', () => {
    store.save(child);
    store.activate('headless', child.id);
    const env = { CODEBUDDY_SELF_IMPROVE_STRATEGIES: 'true' };
    expect(resolveStrategyOverlay('headless', {}, { env, store })).toEqual({
      strategyId: child.id,
      reasoning: 'medium',
      maxToolRounds: 300,
      maxCostUsd: 15,
      systemPromptAppend: '<execution_strategy>\n- Commit after each completed step, naming the files.\n</execution_strategy>',
    });
    const explicit = resolveStrategyOverlay('headless', { maxToolRounds: 20 }, { env, store });
    expect(explicit.maxToolRounds).toBeUndefined();
    expect(explicit.maxCostUsd).toBe(15);
    expect(renderDirectives(BASELINE_STRATEGY)).toBeUndefined();
  });
  it('with the layer on but only the baseline active, changes nothing but names the baseline', () => {
    expect(resolveStrategyOverlay('headless', {}, { env: { CODEBUDDY_SELF_IMPROVE_STRATEGIES: 'true' }, store })).toEqual({ strategyId: 'baseline' });
  });
});

describe('applyStrategyCostCap', () => {
  it('sets MAX_COST from the overlay only when the user set none, never overrides', async () => {
    const { applyStrategyCostCap } = await import('../../../src/agent/self-improvement/strategy-runtime.js');
    const env: NodeJS.ProcessEnv = {};
    expect(applyStrategyCostCap({ strategyId: 'x', maxCostUsd: 15 }, env)).toEqual({ maxCostUsd: 15 });
    expect(env.MAX_COST).toBe('15');
    const explicit: NodeJS.ProcessEnv = { MAX_COST: '2' };
    expect(applyStrategyCostCap({ strategyId: 'x', maxCostUsd: 15 }, explicit)).toEqual({});
    expect(explicit.MAX_COST).toBe('2');
    const none: NodeJS.ProcessEnv = {};
    expect(applyStrategyCostCap({ strategyId: 'baseline' }, none)).toEqual({});
    expect(none.MAX_COST).toBeUndefined();
  });
});
