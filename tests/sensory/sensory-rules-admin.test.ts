import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { rm, appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import {
  validateRule,
  upsertSensoryRule,
  listSensoryRules,
  toggleSensoryRule,
  removeSensoryRule,
  readRuleRuns,
  appendRuleRun,
  type SensoryRule,
} from '../../src/sensory/sensory-rules-engine.js';

let dir: string;
let n = 0;

beforeEach(() => {
  dir = path.join(os.tmpdir(), `cb-rules-${process.pid}-${n++}`);
  process.env.CODEBUDDY_SENSORY_RULES_FILE = path.join(dir, 'sensory-rules.json');
  process.env.CODEBUDDY_RULE_RUNS_FILE = path.join(dir, 'rule-runs.jsonl');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.CODEBUDDY_SENSORY_RULES_FILE;
  delete process.env.CODEBUDDY_RULE_RUNS_FILE;
});

const alertRule: SensoryRule = {
  id: 'r-alert',
  match: { kind: 'person_entered' },
  action: { type: 'alert', message: 'someone is here' },
};

describe('sensory-rules admin — CRUD-lite', () => {
  it('upsert → list → toggle → remove round-trip', async () => {
    expect((await upsertSensoryRule(alertRule)).ok).toBe(true);
    expect((await listSensoryRules()).map((r) => r.id)).toEqual(['r-alert']);

    expect(await toggleSensoryRule('r-alert', false)).toBe(true);
    expect((await listSensoryRules())[0]?.enabled).toBe(false);
    expect(await toggleSensoryRule('missing', false)).toBe(false);

    expect(await removeSensoryRule('r-alert')).toBe(true);
    expect(await listSensoryRules()).toHaveLength(0);
    expect(await removeSensoryRule('r-alert')).toBe(false);
  });
});

describe('sensory-rules admin — validateRule (write-time safety gate)', () => {
  it('accepts safe actions', () => {
    expect(validateRule(alertRule).ok).toBe(true);
    expect(validateRule({ id: 'e', match: { kind: 'k' }, action: { type: 'shell', command: 'echo hi' } }).ok).toBe(true);
    expect(validateRule({ id: 'w', match: { kind: 'k' }, action: { type: 'webhook', url: 'https://x.io/h' } }).ok).toBe(true);
  });

  it('REJECTS a destructive shell action (same gate as fire-time)', () => {
    const v = validateRule({ id: 'bad', match: { kind: 'k' }, action: { type: 'shell', command: 'rm -rf /' } });
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/destructive/i);
  });

  it('rejects non-http webhook, missing kind, bad time window', () => {
    expect(validateRule({ id: 'w', match: { kind: 'k' }, action: { type: 'webhook', url: 'file:///etc/passwd' } }).ok).toBe(false);
    expect(validateRule({ id: 'n', match: { kind: '' }, action: { type: 'alert' } }).ok).toBe(false);
    expect(
      validateRule({ id: 't', match: { kind: 'k', between: ['9am', '5pm'] as never }, action: { type: 'alert' } }).ok,
    ).toBe(false);
  });

  it('upsert REFUSES to persist an invalid rule', async () => {
    const res = await upsertSensoryRule({ id: 'bad', match: { kind: 'k' }, action: { type: 'shell', command: 'mkfs.ext4 /dev/sda' } });
    expect(res.ok).toBe(false);
    expect(await listSensoryRules()).toHaveLength(0); // nothing written
  });
});

describe('sensory-rules admin — readRuleRuns (observe)', () => {
  it('returns recent fires newest-first', async () => {
    await mkdir(dir, { recursive: true });
    const f = process.env.CODEBUDDY_RULE_RUNS_FILE!;
    await appendFile(f, JSON.stringify({ ts: 1, rule: 'a', action: 'alert', ok: true }) + '\n');
    await appendFile(f, JSON.stringify({ ts: 2, rule: 'b', action: 'shell', ok: false, detail: 'blocked' }) + '\n');
    const runs = await readRuleRuns(10);
    expect(runs.map((r) => r.rule)).toEqual(['b', 'a']);
    expect(runs[0]?.ok).toBe(false);
    // tolerate junk lines
    await appendFile(f, 'not json\n');
    expect((await readRuleRuns(10)).length).toBe(2);
  });

  it('rotates a large rule-runs sidecar before appending', async () => {
    await mkdir(dir, { recursive: true });
    const file = process.env.CODEBUDDY_RULE_RUNS_FILE!;
    await appendFile(file, 'x'.repeat(512 * 1024 + 1));

    await appendRuleRun({ ts: 3, rule: 'rotated', action: 'alert', ok: true });

    expect((await stat(`${file}.1`)).size).toBeGreaterThan(512 * 1024);
    expect(JSON.parse((await readFile(file, 'utf8')).trim())).toMatchObject({ rule: 'rotated', ok: true });
  });
});
