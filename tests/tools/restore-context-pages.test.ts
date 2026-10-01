import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RestoreContextTool } from '../../src/tools/registry/attention-tools.js';
import {
  getRestorableCompressor,
  resetRestorableCompressor,
} from '../../src/context/restorable-compression.js';

describe('exact recovery pages within the compact budget', () => {
  let root: string;
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRestorableCompressor();
    if (root) rmSync(root, { recursive: true, force: true });
  });
  it('recovers every stored character across bounded pages, retaining workspace/session isolation', async () => {
    root = mkdtempSync(path.join(tmpdir(), 'restore-pages-'));
    vi.stubEnv('CODEBUDDY_HEADLESS', 'true');
    vi.stubEnv('CODEBUDDY_PROMPT_COMPACT', 'true');
    const store = getRestorableCompressor();
    store.writeToolResult(
      'call-page',
      'Private observation\n' + 'expected: 12 / actual: 7\n'.repeat(100),
      root,
      'session-one'
    );
    const expected = store.restore('call-page', root, 'session-one').content;
    const tool = new RestoreContextTool();
    let actual = '';
    for (let start = 0; start < expected.length; start += 320) {
      const result = await tool.execute(
        { identifier: 'call-page', start_char: start, max_chars: 65536 },
        { cwd: root, sessionId: 'session-one' }
      );
      expect(result.success).toBe(true);
      const payload = result.output!.slice(result.output!.indexOf('\n') + 1);
      expect(payload.length).toBeLessThanOrEqual(320);
      expect(payload).toBe(expected.slice(start, start + 320));
      actual += payload;
    }
    expect(actual).toBe(expected);
    expect(
      (await tool.execute({ identifier: 'call-page' }, { cwd: root, sessionId: 'other' })).success
    ).toBe(false);
  });
  it('rejects invalid offsets and sizes instead of pretending to have restored data', async () => {
    const tool = new RestoreContextTool();
    for (const args of [
      { start_char: -1 },
      { start_char: 0.5 },
      { start_char: null },
      { max_chars: 0 },
      { max_chars: 1.5 },
      { max_chars: '320' },
    ]) {
      expect((await tool.execute({ identifier: 'call-page', ...args })).success).toBe(false);
    }
  });
});
