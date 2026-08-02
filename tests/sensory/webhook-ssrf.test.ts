import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeSensoryAction } from '../../src/sensory/sensory-action-executor.js';
import {
  saveSensoryRules,
  validateRule,
  wireSensoryRules,
  type SensoryRule,
} from '../../src/sensory/sensory-rules-engine.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import { getSSRFGuard, resetSSRFGuard } from '../../src/security/ssrf-guard.js';

const dnsMocks = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dnsMocks.lookup }));

function webhookRule(url: string): SensoryRule {
  return {
    id: 'webhook-rule',
    match: { kind: 'person_entered' },
    action: { type: 'webhook', url },
  };
}

describe('sensory webhook SSRF protection', () => {
  const originalFetch = global.fetch;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `cb-webhook-ssrf-${process.pid}-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    process.env.CODEBUDDY_SENSORY_RULES_FILE = path.join(tempDir, 'sensory-rules.json');
    process.env.CODEBUDDY_RULE_RUNS_FILE = path.join(tempDir, 'rule-runs.jsonl');
    resetSSRFGuard();
    dnsMocks.lookup.mockReset();
    getSSRFGuard({ allowedHosts: ['hooks.example'], resolveDns: false });
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    resetSSRFGuard();
    delete process.env.CODEBUDDY_SENSORY_RULES_FILE;
    delete process.env.CODEBUDDY_RULE_RUNS_FILE;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects a private webhook during validation and persistence', async () => {
    const rule = webhookRule('http://192.168.1.10/collect');

    const validation = validateRule(rule);

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(' ')).toContain('SSRF guard');
    await expect(saveSensoryRules([rule])).rejects.toThrow('SSRF guard');
  });

  it('refuses an already-existing private webhook at execution time', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    const result = await executeSensoryAction(
      { type: 'webhook', url: 'http://10.0.0.8/collect' },
      { kind: 'person_entered', description: 'private context' },
    );

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('SSRF guard');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops an unsafe rule loaded directly from disk before dispatch', async () => {
    await writeFile(
      process.env.CODEBUDDY_SENSORY_RULES_FILE!,
      JSON.stringify([webhookRule('http://172.16.0.5/collect')]),
      'utf8',
    );
    const execute = vi.fn(async () => ({ ok: true }));
    const unwire = wireSensoryRules({ reloadThrottleMs: 0, execute, now: () => Date.now() });

    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      getGlobalEventBus().emit('sensory:perception', {
        source: 'test',
        metadata: { modality: 'vision', kind: 'person_entered', payload: {} },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(execute).not.toHaveBeenCalled();
    } finally {
      unwire();
    }
  });

  it('accepts and executes a legitimate external webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    global.fetch = fetchMock;
    const rule = webhookRule('https://hooks.example/events');

    expect(validateRule(rule).ok).toBe(true);
    await expect(saveSensoryRules([rule])).resolves.toBeUndefined();
    const result = await executeSensoryAction(rule.action, { kind: 'person_entered' });

    expect(result).toEqual({ ok: true, detail: 'HTTP 204' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('persists a non-allowlisted hostname only after public DNS validation', async () => {
    resetSSRFGuard();
    getSSRFGuard();
    dnsMocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const rule = webhookRule('https://public.example/events');

    expect(validateRule(rule).ok).toBe(true);
    await expect(saveSensoryRules([rule])).resolves.toBeUndefined();
    expect(dnsMocks.lookup).toHaveBeenCalledWith('public.example', { all: true });
  });

  it('refuses a hostname that resolves to a private address', async () => {
    resetSSRFGuard();
    getSSRFGuard();
    dnsMocks.lookup.mockResolvedValue([{ address: '10.0.0.8', family: 4 }]);
    const rule = webhookRule('https://private.example/events');

    expect(validateRule(rule).ok).toBe(true);
    await expect(saveSensoryRules([rule])).rejects.toThrow('SSRF guard');
  });
});
