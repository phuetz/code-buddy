import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import {
  formatProviderHealthLines,
  isProviderUnavailable,
  readProviderHealthSnapshot,
  recordProviderFailure,
  recordProviderSuccess,
  resetProviderHealthStoreForTests,
  setProviderHealthPathForTests,
} from '../../src/providers/provider-health.js';

describe('provider health store', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir('provider-health-');
    setProviderHealthPathForTests(path.join(tmp, 'provider-health.json'));
    resetProviderHealthStoreForTests();
  });

  afterEach(() => {
    resetProviderHealthStoreForTests();
    setProviderHealthPathForTests(undefined);
    removeTmpDir(tmp);
  });

  it('benches quota_exhausted until resetsAt and persists the JSON', () => {
    const now = Date.now();
    recordProviderFailure('chatgpt', 'quota_exhausted', {
      message: 'usage_limit_reached',
      resetsInSeconds: 68400,
      nowMs: now,
    });
    expect(isProviderUnavailable('chatgpt', now + 1000)).toBe(true);
    expect(isProviderUnavailable('chatgpt', now + 68400 * 1000 + 1)).toBe(false);
    const filePath = path.join(tmp, 'provider-health.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      providers: { chatgpt: { kind: string } };
    };
    expect(raw.providers.chatgpt.kind).toBe('quota_exhausted');
  });

  it('uses 60 s backoff for overloaded, then doubles', () => {
    const now = 1_700_000_000_000;
    const first = recordProviderFailure('grok', 'overloaded', { nowMs: now });
    expect(first.resetsAt).toBe(now + 60_000);
    const second = recordProviderFailure('grok', 'overloaded', { nowMs: now + 10 });
    expect(second.resetsAt).toBe(now + 10 + 120_000);
  });

  it('benches unreachable for 5 minutes', () => {
    const now = 1_700_000_000_000;
    const entry = recordProviderFailure('ollama', 'unreachable', { nowMs: now });
    expect(entry.resetsAt).toBe(now + 5 * 60_000);
  });

  it('clears a provider on success and formats doctor/whoami lines', () => {
    recordProviderFailure('chatgpt', 'quota_exhausted', {
      nowMs: Date.now(),
      resetsInSeconds: 3600,
    });
    const lines = formatProviderHealthLines(readProviderHealthSnapshot());
    expect(lines[0]).toBe('Provider health:');
    expect(lines.join('\n')).toMatch(/chatgpt: quota_exhausted/);
    recordProviderSuccess('chatgpt');
    expect(isProviderUnavailable('chatgpt')).toBe(false);
    expect(formatProviderHealthLines()).toEqual([]);
  });

  it('writes provider-health.json with owner-only 0o600', () => {
    recordProviderFailure('chatgpt', 'quota_exhausted', { resetsInSeconds: 60 });
    const filePath = path.join(tmp, 'provider-health.json');
    const mode = fs.statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('strips Bearer / sk- / api_key from the persisted message', () => {
    recordProviderFailure('openai', 'quota_exhausted', {
      message: '401 Bearer sk-ant-secretvalue99 api_key=sk-live-abcdefghi authorization: tok-xyz',
    });
    const raw = fs.readFileSync(path.join(tmp, 'provider-health.json'), 'utf8');
    expect(raw).not.toContain('sk-ant-secretvalue99');
    expect(raw).not.toContain('sk-live-abcdefghi');
    expect(raw).not.toContain('tok-xyz');
    expect(raw).toMatch(/\[redacted/);
    const parsed = JSON.parse(raw) as { providers: Record<string, Record<string, unknown>> };
    expect(parsed.providers.openai).not.toHaveProperty('apiKey');
    expect(parsed.providers.openai).not.toHaveProperty('token');
  });

  it('re-reads disk so a sibling process entry survives this process writing', () => {
    const now = Date.now();
    recordProviderFailure('chatgpt-oauth', 'quota_exhausted', {
      nowMs: now,
      resetsInSeconds: 3600,
    });
    const filePath = path.join(tmp, 'provider-health.json');
    const disk = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      version: number;
      providers: Record<string, { kind: string; message: string; failedAt: number; resetsAt: number }>;
    };
    disk.providers.gemini = {
      kind: 'overloaded',
      message: 'p2',
      failedAt: now,
      resetsAt: now + 60_000,
    };
    fs.writeFileSync(filePath, `${JSON.stringify(disk, null, 2)}\n`, { mode: 0o600 });

    expect(isProviderUnavailable('gemini', now + 1_000)).toBe(true);

    recordProviderSuccess('chatgpt-oauth');
    const after = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      providers: Record<string, { kind: string }>;
    };
    expect(after.providers.gemini?.kind).toBe('overloaded');
    expect(after.providers['chatgpt-oauth']).toBeUndefined();
  });
});
