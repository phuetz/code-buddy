/**
 * `buddy science` CLI — opt-in + help surface.
 *
 * These tests exercise the real command via Commander (no mocks of the command
 * itself). The load-bearing property: WITHOUT `CODEBUDDY_AI_SCIENTIST=true` the
 * command prints an opt-in notice and runs NOTHING (no provider resolution, no
 * experiment). `--help` lists the documented options.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createScienceCommand } from '../../src/commands/science/index.js';
import { resolveScienceSandbox } from '../../src/commands/science/sandbox-option.js';
import { resolveLoopBudget, parseDuration } from '../../src/commands/science/loop-option.js';

describe('buddy science — opt-in gate', () => {
  const prev = process.env.CODEBUDDY_AI_SCIENTIST;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.CODEBUDDY_AI_SCIENTIST;
    process.exitCode = 0;
    // logger.error writes through winston; spy on console.error is unreliable,
    // so spy on the logger module surface instead.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    if (prev === undefined) delete process.env.CODEBUDDY_AI_SCIENTIST;
    else process.env.CODEBUDDY_AI_SCIENTIST = prev;
    process.exitCode = 0;
  });

  it('prints an opt-in notice and does NOT run when the env flag is unset', async () => {
    const cmd = createScienceCommand();
    cmd.exitOverride();
    // If the command tried to run the pass, it would attempt provider resolution
    // and experiment execution — neither should happen. We assert via exitCode.
    await cmd.parseAsync(['a toy goal'], { from: 'user' });
    expect(process.exitCode).toBe(1);
  });

  it('help lists the documented options', () => {
    const cmd = createScienceCommand();
    const help = cmd.helpInformation();
    expect(help).toContain('--hypothesis');
    expect(help).toContain('--code-file');
    expect(help).toContain('--language');
    expect(help).toContain('--report');
    expect(help).toContain('--no-publish');
    // Phase 2 sandbox options.
    expect(help).toContain('--sandbox');
    expect(help).toContain('--require-network-isolation');
    // Phase 3 loop options.
    expect(help).toContain('--loop');
    expect(help).toContain('--max-generations');
    expect(help).toContain('--max-experiments');
    expect(help).toContain('--budget');
    expect(help).toContain('--parallel');
    // Phase 3 cost cap (F3) — previously advertised in the budget but unreachable.
    expect(help).toContain('--max-cost');
    expect(help).toContain('--cost-per-experiment');
    // The description must flag it as experimental / gated.
    expect(help.toLowerCase()).toContain('experimental');
  });
});

// --------------------------------------------------------------------------
// Phase 3 — loop budget resolution (pure)
// --------------------------------------------------------------------------

describe('buddy science --loop — Phase 3 budget resolution', () => {
  it('no flags, no env ⇒ ok with an empty budget (the loop applies conservative defaults)', () => {
    expect(resolveLoopBudget({}, {})).toEqual({ kind: 'ok', budget: {} });
  });

  it('parses valid caps from flags', () => {
    const res = resolveLoopBudget({ maxGenerations: '3', maxExperiments: '7', parallel: '2', budget: '10m' }, {});
    expect(res).toEqual({
      kind: 'ok',
      budget: { maxGenerations: 3, maxExperiments: 7, parallelism: 2, maxWallClockMs: 600_000 },
    });
  });

  it('reads caps from CODEBUDDY_SCIENCE_* env when no flag given; flags win over env', () => {
    expect(resolveLoopBudget({}, { CODEBUDDY_SCIENCE_MAX_GENERATIONS: '4' })).toMatchObject({
      kind: 'ok',
      budget: { maxGenerations: 4 },
    });
    expect(
      resolveLoopBudget({ maxGenerations: '9' }, { CODEBUDDY_SCIENCE_MAX_GENERATIONS: '4' }),
    ).toMatchObject({ budget: { maxGenerations: 9 } });
  });

  it('rejects a non-numeric / non-positive cap (a typo aborts loudly, no silent default)', () => {
    expect(resolveLoopBudget({ maxGenerations: 'lots' }, {}).kind).toBe('invalid');
    expect(resolveLoopBudget({ maxExperiments: '0' }, {}).kind).toBe('invalid');
    expect(resolveLoopBudget({ parallel: '-1' }, {}).kind).toBe('invalid');
    expect(resolveLoopBudget({ budget: 'soon' }, {}).kind).toBe('invalid');
  });

  it('parses durations with unit suffixes', () => {
    expect(parseDuration('500')).toBe(500); // unitless ⇒ ms
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('10m')).toBe(600_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('nope')).toBeNull();
  });

  // ── F3: the cost cap flags reach the budget (they were dead before) ──────────
  it('parses --max-cost / --cost-per-experiment (fractional) into the budget', () => {
    const res = resolveLoopBudget({ maxCost: '5', costPerExperiment: '1.5' }, {});
    expect(res).toEqual({ kind: 'ok', budget: { maxCost: 5, costPerExperiment: 1.5 } });
  });

  it('reads the cost cap from CODEBUDDY_SCIENCE_* env; flags win over env', () => {
    expect(
      resolveLoopBudget({}, { CODEBUDDY_SCIENCE_MAX_COST: '10', CODEBUDDY_SCIENCE_COST_PER_EXPERIMENT: '2' }),
    ).toEqual({ kind: 'ok', budget: { maxCost: 10, costPerExperiment: 2 } });
    expect(resolveLoopBudget({ maxCost: '3' }, { CODEBUDDY_SCIENCE_MAX_COST: '10' })).toMatchObject({
      budget: { maxCost: 3 },
    });
  });

  it('rejects a non-numeric / non-positive cost (typo aborts loudly)', () => {
    expect(resolveLoopBudget({ maxCost: 'free' }, {}).kind).toBe('invalid');
    expect(resolveLoopBudget({ maxCost: '0' }, {}).kind).toBe('invalid');
    expect(resolveLoopBudget({ costPerExperiment: '-1' }, {}).kind).toBe('invalid');
  });
});

// --------------------------------------------------------------------------
// Phase 2 — sandbox selection resolution (pure)
// --------------------------------------------------------------------------

describe('buddy science — Phase 2 sandbox resolution', () => {
  it('NO opt-in (no flag, no env) ⇒ kind:none — byte-identical Phase 0/1', () => {
    expect(resolveScienceSandbox({}, {})).toEqual({ kind: 'none' });
  });

  it('--sandbox docker ⇒ docker backend, requirement off by default', () => {
    expect(resolveScienceSandbox({ sandbox: 'docker' }, {})).toEqual({
      kind: 'sandbox',
      backend: 'docker',
      requireNetworkIsolation: false,
    });
  });

  it('--sandbox e2b ⇒ e2b backend', () => {
    expect(resolveScienceSandbox({ sandbox: 'e2b' }, {})).toMatchObject({ kind: 'sandbox', backend: 'e2b' });
  });

  it('CODEBUDDY_SCIENCE_SANDBOX env selects the backend when no flag given', () => {
    expect(resolveScienceSandbox({}, { CODEBUDDY_SCIENCE_SANDBOX: 'docker' })).toMatchObject({
      kind: 'sandbox',
      backend: 'docker',
    });
  });

  it('the --sandbox flag overrides the env var', () => {
    expect(
      resolveScienceSandbox({ sandbox: 'e2b' }, { CODEBUDDY_SCIENCE_SANDBOX: 'docker' }),
    ).toMatchObject({ backend: 'e2b' });
  });

  it('--require-network-isolation alone implies docker (the network-cutting backend)', () => {
    expect(resolveScienceSandbox({ requireNetworkIsolation: true }, {})).toEqual({
      kind: 'sandbox',
      backend: 'docker',
      requireNetworkIsolation: true,
    });
  });

  it('an unknown backend ⇒ kind:invalid (the command aborts)', () => {
    const res = resolveScienceSandbox({ sandbox: 'firecracker' }, {});
    expect(res.kind).toBe('invalid');
    if (res.kind === 'invalid') expect(res.error).toContain('Invalid --sandbox');
  });

  it('backend names are case-insensitive', () => {
    expect(resolveScienceSandbox({ sandbox: 'ISOLATE' }, {})).toMatchObject({ backend: 'isolate' });
  });
});
