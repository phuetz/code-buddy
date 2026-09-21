import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { handlePostTool } from './post-tool-handlers.js';
import {
  beginSession,
  loadSessionMetrics,
  resetSessionMetricsForTests,
} from '../../memory/session-metrics-tracker.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-post-tool-'));
  beginSession('test-session', tmp);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  resetSessionMetricsForTests();
});

describe('handlePostTool', () => {
  it('records a tool call', () => {
    handlePostTool({
      workDir: tmp,
      toolName: 'bash', success: true, durationMs: 10 });
    const m = loadSessionMetrics(tmp);
    expect(m.toolCalls).toBe(1);
    expect(m.errorsRecovered).toBe(0);
  });

  it('records a recovered error on failure', () => {
    handlePostTool({
      workDir: tmp,
      toolName: 'bash', success: false, durationMs: 5 });
    const m = loadSessionMetrics(tmp);
    expect(m.toolCalls).toBe(1);
    expect(m.errorsRecovered).toBe(1);
  });

  it('records touched files for file-mutating tools', () => {
    handlePostTool({
      workDir: tmp,
      toolName: 'str_replace_editor',
      success: true,
      durationMs: 3,
      args: { path: 'src/foo.ts' },
    });
    handlePostTool({
      workDir: tmp,
      toolName: 'write_file',
      success: true,
      durationMs: 3,
      args: { file: 'src/bar.ts' },
    });
    const m = loadSessionMetrics(tmp);
    expect(m.filesTouched).toContain('src/foo.ts');
    expect(m.filesTouched).toContain('src/bar.ts');
    expect(m.filesTouched).toHaveLength(2);
  });

  it('dedupes repeated file touches', () => {
    handlePostTool({
      workDir: tmp,
      toolName: 'str_replace_editor',
      success: true,
      durationMs: 3,
      args: { path: 'src/foo.ts' },
    });
    handlePostTool({
      workDir: tmp,
      toolName: 'str_replace_editor',
      success: true,
      durationMs: 3,
      args: { path: 'src/foo.ts' },
    });
    const m = loadSessionMetrics(tmp);
    expect(m.filesTouched).toHaveLength(1);
  });
});
