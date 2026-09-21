import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  beginSession,
  recordToolCall,
  recordRecoveredError,
  recordFileTouched,
  setSessionSummary,
  endSession,
  loadSessionMetrics,
  loadSessionMetricsFromDisk,
  currentSessionMetricsEnv,
  resetSessionMetricsForTests,
} from './session-metrics-tracker.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-metrics-'));
  beginSession('s1', tmp);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  resetSessionMetricsForTests();
});

describe('session-metrics-tracker', () => {
  it('starts at zero', () => {
    const m = loadSessionMetrics(tmp);
    expect(m.toolCalls).toBe(0);
    expect(m.errorsRecovered).toBe(0);
    expect(m.filesTouched).toEqual([]);
  });

  it('increments tool calls and recovered errors', () => {
    recordToolCall(tmp);
    recordToolCall(tmp);
    recordRecoveredError(tmp);
    const m = loadSessionMetrics(tmp);
    expect(m.toolCalls).toBe(2);
    expect(m.errorsRecovered).toBe(1);
  });

  it('dedupes touched files', () => {
    recordFileTouched('a.ts', tmp);
    recordFileTouched('a.ts', tmp);
    recordFileTouched('b.ts', tmp);
    expect(loadSessionMetrics(tmp).filesTouched).toEqual(['a.ts', 'b.ts']);
  });

  it('persists summary and exposes env', () => {
    setSessionSummary('did the thing', tmp);
    recordToolCall(tmp);
    const env = JSON.parse(currentSessionMetricsEnv(tmp));
    expect(env.toolCalls).toBe(1);
    expect(env.summary).toBe('did the thing');
  });

  it('loadSessionMetricsFromDisk reads the same file the cron sees', () => {
    recordToolCall(tmp);
    recordFileTouched('x.ts', tmp);
    const fromDisk = loadSessionMetricsFromDisk(tmp);
    expect(fromDisk.toolCalls).toBe(1);
    expect(fromDisk.filesTouched).toEqual(['x.ts']);
  });

  it('endSession returns the snapshot without wiping the file', () => {
    recordToolCall(tmp);
    const snap = endSession(tmp);
    expect(snap.toolCalls).toBe(1);
    expect(loadSessionMetrics(tmp).toolCalls).toBe(1);
  });
});
