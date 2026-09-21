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
  currentSessionMetricsEnv,
} from './session-metrics-tracker.js';

describe('session-metrics-tracker', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-metrics-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('starts empty', () => {
    const m = beginSession('s1', root);
    expect(m.toolCalls).toBe(0);
    expect(m.errorsRecovered).toBe(0);
    expect(m.filesTouched).toEqual([]);
  });

  it('counts tool calls and recovered errors', () => {
    beginSession('s1', root);
    recordToolCall(root);
    recordToolCall(root);
    recordRecoveredError(root);
    const m = loadSessionMetrics(root);
    expect(m.toolCalls).toBe(2);
    expect(m.errorsRecovered).toBe(1);
  });

  it('dedupes touched files', () => {
    beginSession('s1', root);
    recordFileTouched('src/a.ts', root);
    recordFileTouched('src/a.ts', root);
    recordFileTouched('src/b.ts', root);
    expect(loadSessionMetrics(root).filesTouched).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('exposes env-ready JSON', () => {
    beginSession('s1', root);
    recordToolCall(root);
    recordFileTouched('x.ts', root);
    setSessionSummary('Fixed the flaky suite.', root);
    const env = JSON.parse(currentSessionMetricsEnv(root));
    expect(env.toolCalls).toBe(1);
    expect(env.filesTouched).toEqual(['x.ts']);
    expect(env.summary).toBe('Fixed the flaky suite.');
  });

  it('endSession returns the snapshot', () => {
    beginSession('s1', root);
    recordToolCall(root);
    recordRecoveredError(root);
    const snap = endSession(root);
    expect(snap.toolCalls).toBe(1);
    expect(snap.errorsRecovered).toBe(1);
  });
});
