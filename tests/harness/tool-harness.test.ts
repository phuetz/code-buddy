import { describe, it, expect, vi } from 'vitest';
import { ToolHarness, createAgentToolHarness } from '../../src/harness/tool-harness.js';
import type { CodeBuddyTool } from '../../src/codebuddy/tool-definitions/types.js';

const tools: CodeBuddyTool[] = ['read_file', 'write_file', 'a.b', 'a-b'].map(name => ({ type: 'function', function: {
  name, description: `Description of ${name}`, parameters: { type: 'object', properties: {} },
} }));

describe('Codex-style tool harness', () => {
  it('discovers schemas then orchestrates real isolated JavaScript through the host dispatcher', async () => {
    const dispatch = vi.fn(async (name: string) => ({ success: true, output: name }));
    const harness = new ToolHarness({ cwd: process.cwd(), tools, dispatch });
    try {
      const result = await harness.exec(`
        const found = await tools.tool_search({query: 'read file'});
        text(found.data.tools[0].parameters.type);
        text(ALL_TOOLS.find(t => t.name === 'read_file').description);
        text((await tools.read_file({})).output);
        text((await tools.call('a.b', {})).output);
        text((await tools.call('a-b', {})).output);
      `);
      expect(result.success, result.error ?? result.output).toBe(true);
      expect(result.output).toContain('object');
      expect(result.output).toContain('Description of read_file');
      expect(dispatch.mock.calls.map(call => call[0])).toEqual(['read_file', 'a.b', 'a-b']);
    } finally { await harness.dispose(); }
  });
  it.each([511, 512, 513])('discovers and calls tools with a %i-entry catalogue', async count => {
    const catalog: CodeBuddyTool[] = Array.from({ length: count }, (_, index) => ({
      type: 'function', function: { name: `entry_${index}`, description: `Entry ${index}`, parameters: { type: 'object', properties: {} } },
    }));
    const dispatch = vi.fn(async (name: string) => ({ success: true, output: name }));
    const harness = new ToolHarness({ cwd: process.cwd(), tools: catalog, dispatch });
    try {
      const result = await harness.exec(`
        const found = await tools.tool_search({query: 'entry_${count - 1}', max_results: 1});
        text((await tools.call(found.data.names[0])).output);
        text(ALL_TOOLS.length);
      `);
      expect(result.success, result.error).toBe(true);
      expect(result.output).toContain(`entry_${count - 1}`);
      expect(result.output).toContain('512');
      expect(dispatch).toHaveBeenCalledTimes(1);
      for (const denied of ['absent', 'code_exec', 'exec']) {
        expect((await harness.exec(`await tools.call('${denied}');`)).success).toBe(false);
      }
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally { await harness.dispose(); }
  });

  it.each([['a', 'b'], ['a', undefined], [undefined, 'a']])('rejects a bot transition %s → %s in the same workspace', async (initial, next) => {
    let botId = initial;
    const executeToolByName = vi.fn(async () => ({ success: true }));
    const harness = await createAgentToolHarness({ getMemoryScope: () => ({ cwd: process.cwd(), botId }), executeToolByName }, tools);
    try {
      expect((await harness.call('read_file')).success).toBe(true);
      botId = next;
      expect((await harness.call('read_file')).error).toContain('bot changed');
      const result = await harness.exec(`text(await tools.read_file());`);
      expect(result.output).toContain('bot changed');
      expect(executeToolByName).toHaveBeenCalledTimes(1);
    } finally { await harness.dispose(); }
  });

  it('runs safe reads concurrently with write barriers and preserves same-session state', async () => {
    let active = 0;
    let peak = 0;
    const events: string[] = [];
    const harness = new ToolHarness({ cwd: process.cwd(), tools, parallelTools: ['read_file'], dispatch: async name => {
      active++; peak = Math.max(peak, active); events.push(name + ':start');
      if (name === 'write_file') expect(active).toBe(1);
      await new Promise(resolve => setTimeout(resolve, 20));
      events.push(name + ':end'); active--;
      return { success: true };
    } });
    try {
      const result = await harness.exec(`await Promise.all([tools.read_file({}), tools.read_file({}), tools.write_file({}), tools.read_file({})]); store('count', 0);`);
      expect(result.success, result.error ?? result.output).toBe(true);
      expect(peak).toBe(2);
      expect(events.indexOf('write_file:start')).toBeGreaterThan(events.indexOf('read_file:end'));
      const results = await Promise.all([harness.exec(`store('count', load('count') + 1);`), harness.exec(`store('count', load('count') + 1); text(load('count'));`)]);
      expect(results[1]?.output).toContain('2');
    } finally { await harness.dispose(); }
  });
  it('yields early output, cancels nested effects, and never starts queued writes afterwards', async () => {
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    let nestedSignal: AbortSignal | undefined;
    const dispatch = vi.fn(async (_name: string, _args: unknown, signal: AbortSignal) => {
      nestedSignal = signal; entered();
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      return { success: false, error: 'cancelled' };
    });
    const harness = new ToolHarness({ cwd: process.cwd(), tools, dispatch });
    try {
      const id = harness.start(`text('READY'); await yield_control(); await Promise.all([tools.read_file({}), tools.write_file({})]);`);
      await ready;
      const first = await harness.wait(id, 0);
      expect(first.status).toBe('running'); expect(first.output).toBe('READY');
      expect((await harness.wait(id, 0)).output).toBe('');
      harness.cancel(id);
      const final = await harness.wait(id, 1000);
      expect(final.result?.success).toBe(false);
      expect(nestedSignal?.aborted).toBe(true);
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally { await harness.dispose(); }
  });
  it('keeps catalog/state private and enforces the agent project and dispatch boundary', async () => {
    let cwd = process.cwd();
    const executeToolByName = vi.fn(async () => ({ success: false, error: 'Permission denied' }));
    const agent = { getMemoryScope: () => ({ cwd }), executeToolByName };
    const harness = await createAgentToolHarness(agent, tools);
    try {
      expect((await harness.call('write_file')).error).toBe('Permission denied');
      expect((await harness.call('not_exposed')).success).toBe(false);
      cwd += '/other';
      expect((await harness.call('read_file')).error).toContain('workspace changed');
      expect(executeToolByName).toHaveBeenCalledTimes(1);
    } finally { await harness.dispose(); }
  });
  it('cancels queued cells promptly and keeps failed-cell state transactional', async () => {
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const harness = new ToolHarness({ cwd: process.cwd(), tools, dispatch: async (_name, _args, signal) => {
      entered();
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      return { success: false, error: 'cancelled' };
    } });
    try {
      const active = harness.start('await tools.read_file({});');
      await ready;
      const queued = harness.start('store("value", "should not run");');
      harness.cancel(queued);
      expect((await harness.wait(queued, 1000)).result?.success).toBe(false);
      harness.cancel(active);
      await harness.wait(active, 1000);
      expect((await harness.exec('store("value", "rollback"); throw new Error("stop");')).success).toBe(false);
      expect((await harness.exec('text(load("value"));')).output).toContain('undefined');
    } finally { await harness.dispose(); }
  });

  it('preserves structured errors, data and repeated object references across the IPC boundary', async () => {
    const shared = { value: 42 };
    const harness = new ToolHarness({ cwd: process.cwd(), tools, dispatch: async () => ({
      success: false, output: 'partial result', error: 'expected failure', data: { first: shared, second: shared },
    }) });
    try {
      const result = await harness.exec(`const r = await tools.read_file({}); text([r.success, r.error, r.output, r.data.first.value, r.data.second.value]);`);
      expect(result.success).toBe(true);
      expect(result.output).toContain('[false,"expected failure","partial result",42,42]');
    } finally { await harness.dispose(); }
  });

});
