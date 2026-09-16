/**
 * `buddy improve strategies` end to end (commander → engine → replay gate → store),
 * in a throwaway cwd: propose-only never installs; --apply under the opt-in installs
 * and activates; `strategies-list` shows it. No LLM, no network.
 */
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerImproveCommands } from '../../src/commands/cli/improve-command.js';

let work: string;
let prevCwd: string;
let prevEnv: string | undefined;
let logSpy: ReturnType<typeof vi.spyOn>;

function jsonlOfCutLanes(): string {
  const file = path.join(work, 'experiences.jsonl');
  const lines = [1, 2, 3, 4, 5].map((i) =>
    JSON.stringify({ id: `lane-${i}`, source: 'manual', kind: 'delegation', detail: 'lane cut by the ceiling', context: 'engine=x rounds=50 limit=50 cost=0.4 outcome=failure failure=max-rounds' }),
  );
  lines.push('not json at all', JSON.stringify({ id: 'ok', context: 'rounds=10 cost=0.1 outcome=success' }));
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

async function run(args: string[]): Promise<Record<string, unknown>> {
  const program = new Command();
  program.exitOverride();
  registerImproveCommands(program);
  logSpy.mockClear();
  await program.parseAsync(['node', 'buddy', 'improve', ...args]);
  const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
  return JSON.parse(out) as Record<string, unknown>;
}

beforeEach(() => {
  work = path.join(os.tmpdir(), `improve-strat-${randomUUID()}`);
  fs.mkdirSync(path.join(work, '.codebuddy'), { recursive: true });
  prevCwd = process.cwd();
  process.chdir(work);
  prevEnv = process.env.CODEBUDDY_SELF_IMPROVE;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  process.chdir(prevCwd);
  if (prevEnv === undefined) delete process.env.CODEBUDDY_SELF_IMPROVE;
  else process.env.CODEBUDDY_SELF_IMPROVE = prevEnv;
  logSpy.mockRestore();
  fs.rmSync(work, { recursive: true, force: true });
});

describe('buddy improve strategies', () => {
  it('propose-only: accepts the raise-rounds candidate on replay evidence, installs nothing', async () => {
    delete process.env.CODEBUDDY_SELF_IMPROVE;
    const out = await run(['strategies', '--json', '--experiences', jsonlOfCutLanes()]);
    const cycle = out.cycle as { applied: boolean; gate: { accepted: boolean; paired: { wins: number; evidence: string } }; candidate: { limits: { maxToolRounds: number } } };
    expect(cycle.gate.accepted).toBe(true);
    expect(cycle.gate.paired).toMatchObject({ wins: 5, evidence: 'replay' });
    expect(cycle.candidate.limits.maxToolRounds).toBe(75);
    expect(cycle.applied).toBe(false);
    expect(fs.existsSync(path.join(work, '.codebuddy', 'strategies'))).toBe(false);
  });

  it('--apply is refused without the kill-switch, and installs + activates with it', async () => {
    delete process.env.CODEBUDDY_SELF_IMPROVE;
    const file = jsonlOfCutLanes();
    const program = new Command();
    program.exitOverride();
    registerImproveCommands(program);
    await program.parseAsync(['node', 'buddy', 'improve', 'strategies', '--json', '--apply', '--experiences', file]);
    expect(fs.existsSync(path.join(work, '.codebuddy', 'strategies'))).toBe(false);

    process.env.CODEBUDDY_SELF_IMPROVE = 'true';
    const out = await run(['strategies', '--json', '--apply', '--experiences', file]);
    const cycle = out.cycle as { applied: boolean; gate: { appliedRef?: string } };
    expect(cycle.applied).toBe(true);
    expect(cycle.gate.appliedRef).toMatch(/^strat-headless-v2-/);
    const list = await run(['strategies-list', '--json']);
    expect((list.strategies as unknown[]).length).toBe(1);
    expect((list.active as Record<string, string>).headless).toBe(cycle.gate.appliedRef);
  });
});
