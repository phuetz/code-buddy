import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  resolveBanditModel,
  recordBanditOutcome,
  runEvolutionCycle,
  type BanditChoice,
} from '../../../../src/agent/self-improvement/evolution/evolution-engine.js';
import { CodeVariantStore } from '../../../../src/agent/self-improvement/evolution/code-variant-store.js';
import { ModelScoreboard } from '../../../../src/fleet/model-scoreboard.js';
import type { LlmCandidate } from '../../../../src/fleet/model-selector.js';

function cand(model: string, cost = 0): LlmCandidate {
  return { provider: 'testprov', model, isLocal: cost === 0, costInputUsdPerMtok: cost, strengths: [] };
}

const EMPTY_ENV = {} as NodeJS.ProcessEnv;

describe('resolveBanditModel — opt-in decision', () => {
  let dir: string;
  let sb: ModelScoreboard;
  const cands = [cand('m-cheap', 1), cand('m-rich', 20)];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bandit-wire-'));
    sb = new ModelScoreboard(join(dir, 'ledger.jsonl'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('OFF → null and never consults the selector (the byte-identical static path)', async () => {
    let selectorCalls = 0;
    const choice = await resolveBanditModel(
      { useModelBandit: false, modelSelector: () => (selectorCalls++, 'x'), banditCandidates: cands, scoreboard: sb },
      EMPTY_ENV,
    );
    expect(choice).toBeNull();
    expect(selectorCalls).toBe(0);
  });

  it("ON → returns the selector's pick, its provider, and the scoreboard", async () => {
    const choice = await resolveBanditModel(
      { useModelBandit: true, modelSelector: () => 'm-rich', banditCandidates: cands, scoreboard: sb },
      EMPTY_ENV,
    );
    expect(choice).toEqual({ model: 'm-rich', provider: 'testprov', scoreboard: sb });
  });

  it('ON with the default UCB selector explores an unseen (cheaper) candidate', async () => {
    const choice = await resolveBanditModel({ useModelBandit: true, banditCandidates: cands, scoreboard: sb }, EMPTY_ENV);
    // Both unseen → UCB explores; among unseen the cheaper one has the higher reward.
    expect(choice?.model).toBe('m-cheap');
  });

  it('ON but nothing chosen → null', async () => {
    const choice = await resolveBanditModel(
      { useModelBandit: true, modelSelector: () => undefined, banditCandidates: cands, scoreboard: sb },
      EMPTY_ENV,
    );
    expect(choice).toBeNull();
  });

  it('ON with an empty catalog → null (never-throws)', async () => {
    const choice = await resolveBanditModel({ useModelBandit: true, banditCandidates: [], scoreboard: sb }, EMPTY_ENV);
    expect(choice).toBeNull();
  });
});

describe('recordBanditOutcome — closing the bandit loop', () => {
  let dir: string;
  let sb: ModelScoreboard;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bandit-rec-'));
    sb = new ModelScoreboard(join(dir, 'ledger.jsonl'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("records under taskType 'evolve' so the next selection learns from it", () => {
    const choice: BanditChoice = { model: 'm-rich', provider: 'testprov', scoreboard: sb };
    expect(sb.runCount('evolve', 'm-rich')).toBe(0);
    recordBanditOutcome(choice, { won: true, quality: 0.8, latencyMs: 1234, at: '2026-01-01T00:00:00.000Z' });
    expect(sb.runCount('evolve', 'm-rich')).toBe(1);
    const row = sb.ranking('evolve').find((r) => r.model === 'm-rich');
    expect(row?.wins).toBe(1);
    expect(row?.avgQuality).toBeCloseTo(0.8);
  });
});

// --- End-to-end (real git repo, no mocks): prove the mutate call + outcome recording wiring. ------

function gitInitRepo(dir: string): void {
  const run = (args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run(['init', '-q']);
  run(['config', 'user.email', 'test@codebuddy']);
  run(['config', 'user.name', 'Test']);
  run(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'feature.txt'), 'v0\n');
  run(['add', '-A']);
  run(['commit', '-q', '-m', 'init']);
}

describe('runEvolutionCycle — bandit wiring (real git repo)', () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'evo-cycle-'));
    gitInitRepo(dir);
    // `WorktreeSessionManager.cleanupWorktree` runs `git worktree remove` without a cwd (it relies on
    // process.cwd() being the repo, which holds in prod where basePath === process.cwd()). Chdir into
    // the temp repo so cleanup targets it, then the scoring worktree can be created without collision.
    originalCwd = process.cwd();
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('WITH the bandit → the mutator receives the chosen model and the outcome is recorded (evolve)', async () => {
    const sb = new ModelScoreboard(join(dir, 'ledger.jsonl'));
    const store = new CodeVariantStore(join(dir, 'variants.json'));
    let receivedModel: string | undefined = 'UNSET';

    await runEvolutionCycle({
      baselineRef: 'HEAD',
      basePath: dir,
      weakness: { id: 'w', goal: 'improve', kind: 'manual' },
      variantId: 'v-bandit',
      components: [], // trivial scoring → fast, deterministic
      planner: async () => null,
      store,
      mutate: async (args) => {
        receivedModel = args.model;
        writeFileSync(join(args.worktreeDir, 'feature.txt'), 'v1\n');
        return { changed: true };
      },
      useModelBandit: true,
      modelSelector: () => 'chosen-model',
      banditCandidates: [cand('chosen-model')],
      scoreboard: sb,
      now: () => 1000,
    });

    expect(receivedModel).toBe('chosen-model');
    expect(sb.runCount('evolve', 'chosen-model')).toBe(1);
    const row = sb.ranking('evolve').find((r) => r.model === 'chosen-model');
    expect(row?.provider).toBe('testprov');
  });

  it('WITHOUT the bandit → no model forced, selector + recordOutcome never touched (byte-identical)', async () => {
    const sb = new ModelScoreboard(join(dir, 'ledger.jsonl'));
    const store = new CodeVariantStore(join(dir, 'variants.json'));
    let receivedModel: string | undefined = 'UNSET';
    let selectorCalls = 0;

    await runEvolutionCycle({
      baselineRef: 'HEAD',
      basePath: dir,
      weakness: { id: 'w', goal: 'improve', kind: 'manual' },
      variantId: 'v-static',
      components: [],
      planner: async () => null,
      store,
      mutate: async (args) => {
        receivedModel = args.model;
        writeFileSync(join(args.worktreeDir, 'feature.txt'), 'v1\n');
        return { changed: true };
      },
      // Bandit deps injected but useModelBandit UNSET → they must stay untouched.
      modelSelector: () => (selectorCalls++, 'x'),
      banditCandidates: [cand('chosen-model')],
      scoreboard: sb,
    });

    expect(receivedModel).toBeUndefined(); // no `model` key on MutateArgs
    expect(selectorCalls).toBe(0); // the selector (pickModelUCB) is never consulted
    expect(sb.ranking('evolve').length).toBe(0); // no bandit recordOutcome fired
  });
});
