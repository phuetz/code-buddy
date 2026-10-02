import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatEntry } from '../../src/agent/types.js';
import { SESSION_COST_LIMIT_STOP_REASON } from '../../src/agent/execution/stop-reasons.js';
import { summarizeHeadlessTurn, validateHeadlessOutputText } from '../../src/cli/headless-options.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function schemaPath(schema: object): string {
  const directory = mkdtempSync(join(tmpdir(), 'codebuddy-headless-cost-'));
  directories.push(directory);
  const target = join(directory, 'schema.json');
  writeFileSync(target, JSON.stringify(schema));
  return target;
}

function entry(type: ChatEntry['type'], content: string, toolResult?: ChatEntry['toolResult']): ChatEntry {
  return { type, content, timestamp: new Date(), ...(toolResult ? { toolResult } : {}) };
}

describe('headless cost stop', () => {
  it('detects a pre-execution cost stop from structured tool metadata', () => {
    const entries = [
      entry('tool_result', 'Tool skipped', {
        success: false,
        error: 'Tool skipped',
        metadata: { stopReason: SESSION_COST_LIMIT_STOP_REASON },
      }),
    ];
    expect(summarizeHeadlessTurn(entries, false)).toEqual({
      resultText: 'Session cost limit reached.',
      costLimitReached: true,
    });
  });

  it('detects a post-turn cost stop without changing a valid assistant answer', () => {
    expect(summarizeHeadlessTurn([entry('assistant', '{"answer":true}')], true)).toEqual({
      resultText: '{"answer":true}',
      costLimitReached: true,
    });
  });

  it('preserves an ordinary assistant answer when no limit was reached', () => {
    expect(summarizeHeadlessTurn([entry('assistant', '{"answer":true}')], false)).toEqual({
      resultText: '{"answer":true}',
      costLimitReached: false,
    });
  });

  it('does not infer a cost stop from unstructured tool error prose', () => {
    expect(summarizeHeadlessTurn([
      entry('tool_result', 'Session cost limit reached.', {
        success: false,
        error: 'Skipped because the session cost limit was reached before tool execution.',
      }),
    ], false).costLimitReached).toBe(false);
  });

  it('validates the final JSON on a cost stop and keeps exit code 3', () => {
    const schema = schemaPath({ type: 'object', required: ['answer'] });
    const invalid = validateHeadlessOutputText('Session cost limit reached.', schema, true);
    expect(invalid.valid).toBe(false);
    expect(invalid.errors[0]).toContain('not valid JSON');
    expect(invalid.exitCodeOnFailure).toBe(3);
    expect(validateHeadlessOutputText('not JSON', schema, false).exitCodeOnFailure).toBe(1);
    const valid = validateHeadlessOutputText('{"answer":true}', schema, true);
    expect(valid.valid).toBe(true);
  });
});
