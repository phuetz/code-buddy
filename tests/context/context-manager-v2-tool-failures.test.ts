/**
 * Manus AI error preservation in the EXTRACTIVE summary path of
 * ContextManagerV2.
 *
 * The legacy/snapshot extractive summary (`createSummary`, reached at runtime
 * via `takeSnapshot()` and the legacy compaction fallback) used to only look at
 * `role:'user'`/`'assistant'` string content, silently dropping every
 * `role:'tool'` message. That lost FAILED tool attempts on compaction, so the
 * agent could blindly retry a call it already knows is broken.
 *
 * These deterministic tests (no LLM) exercise `createSummary` through the real
 * public `takeSnapshot()` entry point and assert failed tool attempts survive,
 * successes stay out, and the section is bounded.
 */

import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ContextManagerV2 } from '../../src/context/context-manager-v2.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';

function user(content: string): CodeBuddyMessage {
  return { role: 'user', content } as CodeBuddyMessage;
}
function assistant(content: string): CodeBuddyMessage {
  return { role: 'assistant', content } as CodeBuddyMessage;
}
/** Assistant message that requested a tool call (OpenAI shape). */
function assistantToolCall(id: string, name: string): CodeBuddyMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [{ id, type: 'function', function: { name, arguments: '{}' } }],
  } as CodeBuddyMessage;
}
function toolResult(toolCallId: string, content: string): CodeBuddyMessage {
  return { role: 'tool', tool_call_id: toolCallId, content } as CodeBuddyMessage;
}

describe('ContextManagerV2 extractive summary — failed tool preservation', () => {
  let workDir: string;
  let manager: ContextManagerV2;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'toolfail-'));
    manager = new ContextManagerV2({ model: 'gpt-4' });
  });

  afterEach(() => {
    manager.stopPeriodicSnapshot();
    rmSync(workDir, { recursive: true, force: true });
  });

  function summaryOf(messages: CodeBuddyMessage[]): string {
    const snapshot = manager.takeSnapshot(messages, workDir);
    expect(snapshot).not.toBeNull();
    // Also assert it round-trips to disk unchanged.
    const onDisk = JSON.parse(
      readFileSync(join(workDir, '.codebuddy', 'context-snapshot.json'), 'utf8'),
    );
    expect(onDisk.summary).toBe(snapshot!.summary);
    return snapshot!.summary;
  }

  it('preserves the error text AND the tool name of a failed tool_result', () => {
    const messages: CodeBuddyMessage[] = [
      user('Run the build'),
      assistantToolCall('call_1', 'run_shell'),
      toolResult('call_1', 'Error: command "npm run buildz" exited with code 127 — DISTINCT_FAILURE_XYZ'),
      assistant('The build script name is wrong.'),
    ];

    const summary = summaryOf(messages);

    expect(summary).toContain('Failed tool attempts (do not retry):');
    // Distinctive error text survives…
    expect(summary).toContain('DISTINCT_FAILURE_XYZ');
    // …and it's attributed to the tool that produced it.
    expect(summary).toContain('run_shell');
  });

  it('does not list a SUCCESSFUL tool_result as a failure (no noise)', () => {
    const messages: CodeBuddyMessage[] = [
      user('Read the config'),
      assistantToolCall('call_ok', 'read_file'),
      toolResult('call_ok', '{"success": true, "output": "SUCCESS_NOISE_MARKER read 3 lines OK"}'),
      assistant('Config read successfully.'),
    ];

    const summary = summaryOf(messages);

    // A conversation with zero failures gets no failures section at all.
    expect(summary).not.toContain('Failed tool attempts');
    // The success payload is dropped entirely (role:'tool' successes are noise).
    expect(summary).not.toContain('SUCCESS_NOISE_MARKER');
  });

  it('keeps failures but ignores successes when both are present', () => {
    const messages: CodeBuddyMessage[] = [
      user('Do the work'),
      assistantToolCall('ok1', 'list_directory'),
      toolResult('ok1', '{"success": true, "output": "SUCCESS_NOISE_MARKER 4 entries"}'),
      assistantToolCall('bad1', 'apply_patch'),
      toolResult('bad1', 'Error: hunk #2 FAILED to apply — DISTINCT_PATCH_FAILURE'),
      assistant('Patch did not apply.'),
    ];

    const summary = summaryOf(messages);

    expect(summary).toContain('Failed tool attempts (do not retry):');
    expect(summary).toContain('DISTINCT_PATCH_FAILURE');
    expect(summary).toContain('apply_patch');
    // The success stays out even though a failure is present.
    expect(summary).not.toContain('SUCCESS_NOISE_MARKER');
  });

  it('bounds the section to the last N failures and truncates long errors', () => {
    const messages: CodeBuddyMessage[] = [user('Try many things')];
    // 7 distinct failures; only the last 5 must survive (N = 5).
    for (let i = 1; i <= 7; i++) {
      messages.push(assistantToolCall(`c${i}`, `tool_${i}`));
      messages.push(toolResult(`c${i}`, `Error: attempt ${i} failed — FAILMARK_${i}`));
    }
    // A very long failure to prove the per-entry char bound (~200) truncates.
    messages.push(assistantToolCall('big', 'huge_tool'));
    messages.push(
      toolResult('big', 'Error: ' + 'A'.repeat(300) + ' TAILMARKER_DROPPED'),
    );
    messages.push(assistant('done trying'));

    const summary = summaryOf(messages);

    expect(summary).toContain('Failed tool attempts (do not retry):');

    // Only the last 5 failures kept: earliest two dropped, latest present.
    expect(summary).not.toContain('FAILMARK_1');
    expect(summary).not.toContain('FAILMARK_2');
    expect(summary).toContain('FAILMARK_7');
    // Exactly 5 bullet lines under the header.
    const bulletLines = summary
      .split('\n')
      .filter(line => line.startsWith('- '));
    expect(bulletLines.length).toBe(5);

    // The long error's tail marker (beyond ~200 chars) is truncated away,
    // while its head ("huge_tool") survives.
    expect(summary).toContain('huge_tool');
    expect(summary).not.toContain('TAILMARKER_DROPPED');
  });

  it('adds no empty/parasitic section when there are no tool failures', () => {
    const messages: CodeBuddyMessage[] = [
      user('Just chatting'),
      assistant('Sure, hello!'),
      user('How are you?'),
      assistant('Doing well, thanks.'),
    ];

    const summary = summaryOf(messages);
    expect(summary).not.toContain('Failed tool attempts');
  });
});
