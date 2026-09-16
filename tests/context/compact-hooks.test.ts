import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ContextManagerV2 } from '../../src/context/context-manager-v2.js';
import { DefaultContextEngine } from '../../src/context/default-context-engine.js';
import { getGlobalEventBus, resetEventBus } from '../../src/events/event-bus.js';
import { logger } from '../../src/utils/logger.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';

function makeMessages(): CodeBuddyMessage[] {
  const messages: CodeBuddyMessage[] = [{ role: 'system', content: 'Base system prompt.' }];
  for (let index = 0; index < 24; index += 1) {
    messages.push({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `turn ${index}: ${'x'.repeat(180)}`,
    });
  }
  messages.push({ role: 'user', content: 'LATEST_REQUEST keep this exact request' });
  return messages;
}

function managerFor(workDir?: string): ContextManagerV2 {
  return new ContextManagerV2({
    maxContextTokens: 800,
    responseReserveTokens: 50,
    recentMessagesCount: 3,
    enableSummarization: true,
    enableEnhancedCompression: false,
    compressionRatio: 4,
    model: 'gpt-4',
    autoCompactThreshold: 100,
    ...(workDir ? { workingDirectory: workDir } : {}),
  });
}

describe('COMPACT1 — global compaction events and preservation hooks', () => {
  beforeEach(() => resetEventBus());
  afterEach(() => resetEventBus());

  it('emits pre_compact and post_compact with the before/after counters', () => {
    const manager = managerFor();
    const messages = makeMessages();
    const before = manager.getStats(messages);
    const pre = vi.fn();
    const post = vi.fn();
    getGlobalEventBus().on('context:pre_compact', pre);
    getGlobalEventBus().on('context:post_compact', post);

    const compacted = manager.prepareMessages(messages);

    expect(pre).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'auto',
      tokensBefore: before.totalTokens,
      messagesBefore: messages.length,
    }));
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'auto',
      tokensBefore: before.totalTokens,
      tokensAfter: manager.countTokens(compacted),
      messagesBefore: messages.length,
      messagesAfter: compacted.length,
    }));
    manager.dispose();
  });

  it('labels a requested slash compaction as manual', () => {
    const manager = managerFor();
    const pre = vi.fn();
    getGlobalEventBus().on('context:pre_compact', pre);

    manager.requestManualCompaction();
    manager.prepareMessages(makeMessages());

    expect(pre).toHaveBeenCalledWith(expect.objectContaining({ reason: 'manual' }));
    manager.dispose();
  });

  it('labels the built-in ContextEngine compact path as plugin', () => {
    const manager = managerFor();
    const engine = new DefaultContextEngine();
    const pre = vi.fn();
    getGlobalEventBus().on('context:pre_compact', pre);
    engine.setManager(manager);

    engine.compact(makeMessages(), 100);

    expect(pre).toHaveBeenCalledWith(expect.objectContaining({ reason: 'plugin' }));
    manager.dispose();
  });

  it('injects a command hook preserve response into the compaction summary', () => {
    const workDir = fs.mkdtempSync(path.join(process.cwd(), '.compact1-test-'));
    try {
      const script = path.join(workDir, 'preserve-hook.cjs');
      fs.writeFileSync(script, [
        "const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));",
        "if (input.reason !== 'auto') process.exit(3);",
        "process.stdout.write('plan invariant: keep the parser contract');",
      ].join('\n'));
      fs.mkdirSync(path.join(workDir, '.codebuddy'), { recursive: true });
      fs.writeFileSync(path.join(workDir, '.codebuddy', 'hooks.json'), JSON.stringify({
        hooks: {
          pre_compact: [{ type: 'command', command: `node ${script}` }],
        },
      }));

      const manager = managerFor(workDir);
      const compacted = manager.prepareMessages(makeMessages());
      const summary = compacted.find(message =>
        typeof message.content === 'string' && message.content.includes('[Conversation Summary]'));

      expect(summary?.content).toContain('<preserved_context>');
      expect(summary?.content).toContain('plan invariant: keep the parser contract');
      expect(summary?.content).toContain('</preserved_context>');
      manager.dispose();
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('ignores a failing or timed-out hook and still compacts', () => {
    const workDir = fs.mkdtempSync(path.join(process.cwd(), '.compact1-test-'));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const script = path.join(workDir, 'timeout-hook.cjs');
      fs.writeFileSync(script, 'setTimeout(() => {}, 10_000);');
      fs.mkdirSync(path.join(workDir, '.codebuddy'), { recursive: true });
      fs.writeFileSync(path.join(workDir, '.codebuddy', 'hooks.json'), JSON.stringify({
        hooks: {
          pre_compact: [
            { type: 'command', command: 'exit 1' },
            { type: 'command', command: `node ${script}`, timeout: 1 },
          ],
        },
      }));

      const manager = managerFor(workDir);
      const compacted = manager.prepareMessages(makeMessages());

      expect(compacted.length).toBeLessThan(makeMessages().length);
      expect(warn).toHaveBeenCalled();
      manager.dispose();
    } finally {
      warn.mockRestore();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('keeps the exact existing result when no compaction hook is configured', () => {
    const input = makeMessages();
    const first = managerFor();
    const second = managerFor();

    expect(JSON.stringify(first.prepareMessages(input))).toBe(JSON.stringify(second.prepareMessages(input)));

    first.dispose();
    second.dispose();
  });
});
