import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunEventWriter } from '../../src/observability/run-event-writer.js';
import { RunStore } from '../../src/observability/run-store.js';

async function fixture(action: (file: string) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-journal-'));
  try { await action(path.join(dir, 'events.jsonl')); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

describe('run journal acknowledgement', () => {
  it('distinguishes received events from written events, then flushes readable bytes', async () => fixture(async file => {
    const stream = fs.createWriteStream(file);
    const writer = new RunEventWriter(stream, vi.fn());
    writer.write('{"id":1}\n');
    expect(writer.status()).toMatchObject({ state: 'pending', received: 1, written: 0 });
    expect(await writer.flush()).toEqual({ state: 'flushed', received: 1, written: 1 });
    expect(fs.readFileSync(file, 'utf8')).toBe('{"id":1}\n');
    await new Promise<void>(resolve => stream.end(resolve));
    expect((await writer.flush()).state).toBe('flushed');
  }));
  it('keeps asynchronous write failures visible and rejects later flushes', async () => fixture(async file => {
    const stream = fs.createWriteStream(file);
    const warning = vi.fn();
    const writer = new RunEventWriter(stream, warning);
    writer.write('pending\n');
    const closed = new Promise(resolve => stream.once('close', resolve));
    stream.destroy(new Error('simulated disk failure'));
    await closed;
    writer.write('later\n');
    expect(writer.status()).toMatchObject({ state: 'failed', received: 2, error: 'simulated disk failure' });
    await expect(writer.flush()).rejects.toThrow('simulated disk failure');
    expect(warning).toHaveBeenCalledTimes(1);
  }));
  it('fails explicitly on queue overflow instead of accumulating unlimited pending bytes', async () => fixture(async file => {
    const stream = fs.createWriteStream(file);
    const writer = new RunEventWriter(stream, vi.fn());
    writer.write('x'.repeat(1024 * 1024 + 1));
    expect(writer.status()).toMatchObject({ state: 'failed', written: 0 });
    await expect(writer.flush()).rejects.toThrow('queue exceeded');
    await new Promise<void>(resolve => stream.end(resolve));
  }));
  it('exposes the acknowledgement on the actual RunStore', async () => fixture(async file => {
    const store = new RunStore(path.dirname(file));
    try {
      const id = store.startRun('journal test');
      store.emit(id, { type: 'tool_call', data: { tool: 'read' } });
      expect((await store.flushRun(id)).state).toBe('flushed');
      expect(store.getPersistenceStatus(id)).toMatchObject({ received: 2, written: 2 });
    } finally { store.dispose(); await new Promise(resolve => setTimeout(resolve, 30)); }
  }));
});
