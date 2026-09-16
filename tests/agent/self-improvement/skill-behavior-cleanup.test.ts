/**
 * Fixture cleanup of the behavioral skill gate.
 *
 * The gate removes its `cb-skill-behavior-*` fixture right after
 * `harness.dispose()`. No retry is added here: AGY's native Windows baseline
 * (Node 22.23.2, ten isolated evaluations) passed 10/10 with no EBUSY, so a
 * transient foreign holder is NOT established, and a retry would risk masking a
 * lifecycle failure instead. What is pinned is the honest behaviour: a removal
 * failure is propagated, never swallowed, and grading is unchanged.
 *
 * The failure is SIMULATED (`fs.rm` made to answer EBUSY): Linux has no
 * directory lock. Nothing here proves Windows behaviour.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const rmCalls: Array<{ target: string; attempt: number }> = [];
const rmPlan: { failures: number; code: string; attempts: number } = { failures: 0, code: 'EBUSY', attempts: 0 };
let realRm: typeof import('node:fs/promises').rm;

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  realRm = actual.rm;
  // Only the fixture trees of this gate are simulated as locked; every other
  // path, and every other fs call, goes to the real filesystem.
  const rm = vi.fn(async (target: string, options?: Parameters<typeof actual.rm>[1]) => {
    if (!String(target).includes('cb-skill-behavior-')) return actual.rm(target, options);
    rmPlan.attempts += 1;
    rmCalls.push({ target: String(target), attempt: rmPlan.attempts });
    if (rmPlan.attempts <= rmPlan.failures) {
      const error = new Error(`${rmPlan.code}: resource busy or locked, rmdir '${target}'`) as NodeJS.ErrnoException;
      error.code = rmPlan.code;
      throw error;
    }
    return actual.rm(target, options);
  });
  return { ...actual, rm, default: { ...actual, rm } };
});

const { evaluateSkillBehavior } = await import('../../../src/agent/self-improvement/skill-behavior-gate.js');
const { SKILL_BEHAVIOR_TASKS } = await import('../../../src/agent/self-improvement/skill-behavior-benchmark.js');

const SAFE = 'const r=await tools.read_file({path:"stale.txt"}); await tools.write_file({path:"backup.txt",content:r.output}); await tools.delete_file({path:"stale.txt"});';
const task = SKILL_BEHAVIOR_TASKS['safe-delete']![0]!;
const client = { chat: async () => ({ choices: [{ message: { content: SAFE } }] }) };

afterEach(async () => {
  // Remove what the simulated lock kept, so no fixture survives the suite.
  for (const call of rmCalls) await realRm(call.target, { recursive: true, force: true }).catch(() => undefined);
  rmCalls.length = 0;
  Object.assign(rmPlan, { failures: 0, code: 'EBUSY', attempts: 0 });
  vi.clearAllMocks();
});

describe('skill behavior fixture cleanup', () => {
  it('propagates a persistent removal failure instead of masking it', async () => {
    Object.assign(rmPlan, { failures: Number.MAX_SAFE_INTEGER, code: 'EBUSY' });

    await expect(evaluateSkillBehavior('# Backup\nBack up before deleting.', [task], client)).rejects.toThrow(/EBUSY/);
  });

  it('propagates an unrelated removal error unchanged', async () => {
    Object.assign(rmPlan, { failures: Number.MAX_SAFE_INTEGER, code: 'EACCES' });

    await expect(evaluateSkillBehavior('# Backup\nBack up before deleting.', [task], client)).rejects.toThrow(/EACCES/);
    expect(rmCalls).toHaveLength(1);
  });

  it('removes the fixture once per arm when nothing is locked', async () => {
    await evaluateSkillBehavior('# Backup\nBack up before deleting.', [task], client);

    expect(rmCalls).toHaveLength(2); // one control arm, one skill arm
    expect(new Set(rmCalls.map((c) => c.target)).size).toBe(2);
  });

  it('keeps the real behavioral grading: a gain is accepted, an inert skill is not', async () => {
    const graded = { chat: async (messages: Array<{ content: string }>) => ({ choices: [{ message: { content: messages[0]!.content.includes('Relevant skill:') ? SAFE : '' } }] }) };
    await expect(evaluateSkillBehavior('# Backup\nBack up before deleting.', [task], graded)).resolves.toMatchObject({ accepted: true, wins: 1, losses: 0 });
    await expect(evaluateSkillBehavior('# Inert', [task], client)).resolves.toMatchObject({ accepted: false, wins: 0 });
  });
});
