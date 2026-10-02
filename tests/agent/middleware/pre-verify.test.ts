import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreVerifyMiddleware } from '../../../src/agent/middleware/pre-verify.js';
import { MiddlewarePipeline } from '../../../src/agent/middleware/pipeline.js';
import { resetUserHooksManager } from '../../../src/hooks/user-hooks.js';
import type { MiddlewareContext } from '../../../src/agent/middleware/types.js';

let cwd: string;
beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'preverify-qa-')); });
afterEach(() => { vi.unstubAllEnvs(); resetUserHooksManager(); fs.rmSync(cwd, { recursive: true, force: true }); });
function hooks(handler: object) { fs.mkdirSync(path.join(cwd, '.codebuddy')); fs.writeFileSync(path.join(cwd, '.codebuddy', 'hooks.json'), JSON.stringify({ hooks: { pre_verify: [handler] } })); }
const ctx = { toolRound: 0, maxToolRounds: 4, sessionCost: 0, sessionCostLimit: 1,
  inputTokens: 0, outputTokens: 0, history: [], messages: [], isStreaming: false } satisfies MiddlewareContext;

describe('pre_verify completion phase', () => {
  it('does nothing by default even when a blocking command is configured', async () => {
    hooks({ type: 'command', command: 'exit 2' });
    expect(await new PreVerifyMiddleware(cwd).beforeComplete(ctx)).toEqual({ action: 'continue' });
  });
  it('runs at priority 154 in the dedicated phase and a stop skips later completion hooks', async () => {
    vi.stubEnv('CODEBUDDY_PRE_VERIFY', 'true'); hooks({ type: 'command', command: 'exit 2' });
    const after = vi.fn(() => ({ action: 'continue' as const }));
    const pipeline = new MiddlewarePipeline().use({ name: 'review', priority: 200, beforeComplete: after }).use(new PreVerifyMiddleware(cwd));
    expect(pipeline.getMiddlewareNames()).toEqual(['pre_verify', 'review']);
    expect((await pipeline.runBeforeTurn(ctx)).action).toBe('continue');
    expect((await pipeline.runAfterTurn(ctx)).action).toBe('continue');
    expect((await pipeline.runBeforeComplete(ctx)).action).toBe('stop');
    expect(after).not.toHaveBeenCalled();
  });
  it('a throwing completion extension fails closed', async () => {
    const pipeline = new MiddlewarePipeline().use({ name: 'broken', beforeComplete: () => { throw new Error('broken'); } });
    expect((await pipeline.runBeforeComplete(ctx)).action).toBe('stop');
  });
  for (const handler of [{ type: 'http', url: 'https://example.com' }, { type: 'command', command: 'exit 0', if: 'bash' }, { type: 'command', command: 'exit 0', timeout: 100000 }]) {
    it(`rejects configuration that could skip or outlive the verification: ${JSON.stringify(handler)}`, async () => {
      vi.stubEnv('CODEBUDDY_PRE_VERIFY', 'true'); hooks(handler);
      expect((await new PreVerifyMiddleware(cwd).beforeComplete(ctx)).action).toBe('stop');
    });
  }
  it('blocks a timed-out command instead of accepting a final draft', async () => {
    vi.stubEnv('CODEBUDDY_PRE_VERIFY', 'true');
    hooks({ type: 'command', command: 'node -e "setTimeout(()=>{},5000)"', timeout: 100 });
    expect(await new PreVerifyMiddleware(cwd).beforeComplete(ctx)).toMatchObject({ action: 'stop', message: expect.stringContaining('timed out') });
  });
  it('blocks malformed configuration', async () => {
    vi.stubEnv('CODEBUDDY_PRE_VERIFY', 'true'); fs.mkdirSync(path.join(cwd, '.codebuddy')); fs.writeFileSync(path.join(cwd, '.codebuddy', 'hooks.json'), '{');
    expect((await new PreVerifyMiddleware(cwd).beforeComplete(ctx)).action).toBe('stop');
  });
});
