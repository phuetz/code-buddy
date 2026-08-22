import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { rm } from 'node:fs/promises';
import {
  wireSensoryRules,
  saveSensoryRules,
  toggleSensoryRule,
  type SensoryRule,
} from '../../src/sensory/sensory-rules-engine.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';

let dir: string;
let n = 0;

beforeEach(() => {
  dir = path.join(os.tmpdir(), `cb-reload-${process.pid}-${n++}`);
  process.env.CODEBUDDY_SENSORY_RULES_FILE = path.join(dir, 'sensory-rules.json');
  process.env.CODEBUDDY_RULE_RUNS_FILE = path.join(dir, 'rule-runs.jsonl');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  delete process.env.CODEBUDDY_SENSORY_RULES_FILE;
  delete process.env.CODEBUDDY_RULE_RUNS_FILE;
});

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
function fire(kind: string): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'test',
    metadata: { modality: 'x', kind, payload: {} },
  });
}

const rule: SensoryRule = {
  id: 'r1',
  enabled: true,
  match: { kind: 'test_kind' },
  action: { type: 'shell', command: 'echo hi' },
};

describe('sensory-rules — hot-reload (admin change takes effect with no restart)', () => {
  it('a rule disabled via the admin stops firing on the RUNNING engine', async () => {
    await saveSensoryRules([rule]);
    const execute = vi.fn(async () => ({ ok: true }));
    const unwire = wireSensoryRules({ reloadThrottleMs: 0, execute, now: () => 1_000_000 });
    try {
      // Enabled rule fires on a matching event. Retry-fire until it does, so the assertion never
      // races the engine's async initial load / the async action — robust vs a fixed-sleep settle.
      for (let i = 0; i < 200 && execute.mock.calls.length === 0; i++) {
        fire('test_kind');
        await tick(10);
      }
      expect(execute).toHaveBeenCalled(); // the enabled rule fired

      await tick(10); // ensure a distinct mtime for the admin write
      expect(await toggleSensoryRule('r1', false)).toBe(true);

      // The disable propagates to the RUNNING engine (hot-reload). Poll until a fresh event no longer
      // executes — robust vs the async reload not having landed within a fixed sleep. No restart.
      let disabledEffective = false;
      for (let i = 0; i < 200 && !disabledEffective; i++) {
        execute.mockClear();
        fire('test_kind');
        await tick(10);
        disabledEffective = execute.mock.calls.length === 0;
      }
      expect(disabledEffective).toBe(true); // the running engine picked up the disabled rule
    } finally {
      unwire();
    }
  });
});
