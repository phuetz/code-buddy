import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import { EvolutionaryArchive } from '../../../src/agent/self-improvement/evolutionary-archive.js';
import { SkillApplyJournal } from '../../../src/agent/self-improvement/skill-apply-journal.js';
import { SkillImprovementEngine } from '../../../src/agent/self-improvement/skill-engine.js';
import { ensureFrontmatter, LiveSkillMutator, type SkillMutatorPort } from '../../../src/agent/self-improvement/skill-mutator.js';
import { StaticSkillProposer } from '../../../src/agent/self-improvement/skill-proposer.js';
import type { SkillBenchmarkScenario, SkillProposal, SkillSpec } from '../../../src/agent/self-improvement/skill-types.js';
import { resetSkillRegistry } from '../../../src/skills/registry.js';
import { removeTestDir } from '../../helpers/tmp.js';

const QA_HOME = path.join(process.cwd(), '_qa', 'home');
const PASS_BEHAVIOR = {
  accepted: true,
  wins: 1,
  losses: 0,
  tested: 1,
  cases: [{ id: 'unit-fixture', before: false, after: true }],
};

function occupyAsDirectory(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
}

function releaseOccupied(target: string): void {
  removeTestDir(target);
}

function wrappingMutator(inner: LiveSkillMutator, create: SkillMutatorPort['create']): SkillMutatorPort {
  return {
    create,
    remove: (name) => inner.remove(name),
    has: (name) => inner.has(name),
    readInstalled: (name) => inner.readInstalled(name),
  };
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function proposalFor(scenario: SkillBenchmarkScenario, spec: SkillSpec): SkillProposal {
  return { id: `skill-proposal:${scenario.id}`, targetScenarioId: scenario.id, spec };
}

function collectRelFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else out.push(path.relative(root, full));
    }
  };
  walk(root);
  return out.sort();
}

describe('skill apply journal + idempotent archive', () => {
  let previousHome: string | undefined;
  let workDir: string;

  beforeEach(() => {
    fs.mkdirSync(QA_HOME, { recursive: true });
    previousHome = process.env.HOME;
    workDir = fs.mkdtempSync(path.join(QA_HOME, 'skill-apply-'));
    process.env.HOME = workDir;
    resetSkillRegistry();
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    resetSkillRegistry();
    fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  function fixture(label: string) {
    const id = `${label}-${randomUUID().slice(0, 8)}`;
    const scenario: SkillBenchmarkScenario = {
      id,
      query: 'find which commit introduced a regression',
      expectIncludes: ['git bisect', 'good', 'bad'],
      description: 'guidance for bisecting a regression',
    };
    const spec: SkillSpec = {
      name: `authored-${id}`,
      description: 'bisect guidance',
      content:
        '# Git Bisect\nWhen to use: find which commit introduced a regression.\n' +
        'Steps: run `git bisect start`, mark a known good commit and a known bad commit, then test each step.',
    };
    const skillsRoot = path.join(workDir, '.codebuddy', 'skills');
    const inner = new LiveSkillMutator(skillsRoot);
    const create = vi.fn((skillSpec: SkillSpec) => inner.create(skillSpec));
    const mutator = wrappingMutator(inner, create);
    const archive = new EvolutionaryArchive({ workDir });
    const journal = new SkillApplyJournal({ workDir });
    const engineOptions = {
      evaluateBehavior: async () => PASS_BEHAVIOR,
      scenarios: [scenario],
      proposer: new StaticSkillProposer(new Map([[scenario.id, spec]])),
      mutator,
      archive,
      applyJournal: journal,
      autonomy: 'auto-apply' as const,
      workDir,
    };
    return { id, scenario, spec, inner, create, mutator, archive, journal, engineOptions, skillsRoot };
  }

  it('auto-applies, archives once, and does not re-author on the next cycle', async () => {
    const fx = fixture('happy');
    const engine = new SkillImprovementEngine(fx.engineOptions);
    const first = await engine.runCycle();
    expect(first.applied).toBe(true);
    expect(first.proofPending).toBeUndefined();
    expect(first.applyPhase).toBe('archived');
    expect(fx.archive.summary().count).toBe(1);
    expect(fx.inner.has(fx.spec.name)).toBe(true);
    expect(fx.journal.listPending()).toHaveLength(0);
    expect(first.behavior).toEqual(PASS_BEHAVIOR);

    const second = await engine.runCycle();
    expect(second.selectedScenarioId).toBeNull();
    expect(fx.archive.summary().count).toBe(1);
    expect(fx.create).toHaveBeenCalledTimes(1);
  });

  it('does not install when the apply journal cannot be written, then retries', async () => {
    const fx = fixture('journal');
    occupyAsDirectory(fx.journal.path);
    const engine = new SkillImprovementEngine(fx.engineOptions);
    const failed = await engine.runCycle();
    expect(failed.applied).toBe(false);
    expect(failed.notes[0]).toBe('apply journal unreadable; refusing to install');
    expect(fx.inner.has(fx.spec.name)).toBe(false);
    expect(fx.archive.list()).toHaveLength(0);
    expect(fx.create).not.toHaveBeenCalled();

    releaseOccupied(fx.journal.path);
    const retried = await engine.runCycle();
    expect(retried.applied).toBe(true);
    expect(retried.applyPhase).toBe('archived');
    expect(fx.inner.has(fx.spec.name)).toBe(true);
    expect(fx.archive.summary().count).toBe(1);
  });

  it('keeps intent when installation fails, then installs on retry of the same engine', async () => {
    const fx = fixture('install');
    fx.create.mockImplementationOnce(() => {
      throw new Error('injected install failure');
    });
    const engine = new SkillImprovementEngine(fx.engineOptions);
    const failed = await engine.runCycle();
    expect(failed.applied).toBe(false);
    expect(failed.applyPhase).toBe('intent');
    expect(failed.notes[0]).toBe('installation pending');
    expect(fx.inner.has(fx.spec.name)).toBe(false);
    expect(fx.journal.get(fx.scenario.id)?.phase).toBe('intent');
    expect(fx.archive.list()).toHaveLength(0);

    const retried = await engine.runCycle();
    expect(retried.applied).toBe(true);
    expect(retried.behavior).toEqual(PASS_BEHAVIOR);
    expect(fx.inner.has(fx.spec.name)).toBe(true);
    expect(fx.archive.summary().count).toBe(1);
    expect(fx.journal.listPending()).toHaveLength(0);
    expect(fx.create).toHaveBeenCalledTimes(2);
  });

  it('installs with proof pending when archive fails, then archives without reinstall on retry', async () => {
    const fx = fixture('archive');
    occupyAsDirectory(fx.archive.path);
    const engine = new SkillImprovementEngine(fx.engineOptions);
    const failed = await engine.runCycle();
    expect(failed.applied).toBe(false);
    expect(failed.proofPending).toBe(true);
    expect(failed.applyPhase).toBe('installed');
    expect(failed.notes[0]).toBe('installed, proof pending');
    expect(failed.selectedScenarioId).toBe(fx.scenario.id);
    expect(fx.inner.has(fx.spec.name)).toBe(true);
    expect(fx.journal.get(fx.scenario.id)?.phase).toBe('installed');
    expect(fx.create).toHaveBeenCalledTimes(1);

    releaseOccupied(fx.archive.path);
    const retried = await engine.runCycle();
    expect(retried.applied).toBe(true);
    expect(retried.proofPending).toBeUndefined();
    expect(retried.applyPhase).toBe('archived');
    expect(fx.archive.summary().count).toBe(1);
    expect(fx.create).toHaveBeenCalledTimes(1);
    expect(fx.journal.listPending()).toHaveLength(0);
    expect(retried.behavior).toEqual(PASS_BEHAVIOR);
  });

  it('reconciles a pending proof on a new engine without re-authoring', async () => {
    const fx = fixture('new-engine');
    occupyAsDirectory(fx.archive.path);
    const firstEngine = new SkillImprovementEngine(fx.engineOptions);
    const failed = await firstEngine.runCycle();
    expect(failed.proofPending).toBe(true);
    expect(fx.inner.has(fx.spec.name)).toBe(true);
    releaseOccupied(fx.archive.path);

    const secondEngine = new SkillImprovementEngine({
      ...fx.engineOptions,
      proposer: { propose: async () => { throw new Error('must not re-author a pending apply'); } },
    });
    const retried = await secondEngine.runCycle();
    expect(retried.applied).toBe(true);
    expect(retried.selectedScenarioId).toBe(fx.scenario.id);
    expect(fx.archive.summary().count).toBe(1);
    expect(fx.create).toHaveBeenCalledTimes(1);
    expect(retried.behavior).toEqual(PASS_BEHAVIOR);
    expect(fx.archive.list()[0]?.evidence?.wins).toBe(1);
  });

  it('refuses to archive an altered artifact and does not overwrite it', async () => {
    const fx = fixture('conflict');
    occupyAsDirectory(fx.archive.path);
    const engine = new SkillImprovementEngine(fx.engineOptions);
    const failed = await engine.runCycle();
    expect(failed.proofPending).toBe(true);
    const skillFile = path.join(fx.skillsRoot, fx.spec.name, 'SKILL.md');
    const original = fs.readFileSync(skillFile, 'utf8');
    const altered = `${original}\nAltered after install.\n`;
    fs.writeFileSync(skillFile, altered);
    releaseOccupied(fx.archive.path);

    const retried = await engine.runCycle();
    expect(retried.applied).toBe(false);
    expect(retried.applyPhase).toBe('conflict');
    expect(retried.notes[0]).toBe('installed artifact differs from intended; not archived');
    expect(fs.readFileSync(skillFile, 'utf8')).toBe(altered);
    expect(fx.archive.list()).toHaveLength(0);
    expect(fx.create).toHaveBeenCalledTimes(1);
    expect(fx.journal.get(fx.scenario.id)?.phase).toBe('conflict');
  });

  it.each(['{broken', '{"schemaVersion":999,"entries":[]}'])('preserves an invalid archive during recovery: %s', async (bytes) => {
    const fx = fixture('corrupt-archive');
    fs.mkdirSync(path.dirname(fx.archive.path), { recursive: true });
    fs.writeFileSync(fx.archive.path, bytes);
    const engine = new SkillImprovementEngine(fx.engineOptions);
    const failed = await engine.runCycle();
    expect(failed.proofPending).toBe(true);
    expect(fs.readFileSync(fx.archive.path, 'utf8')).toBe(bytes);
    fs.unlinkSync(fx.archive.path);
    expect((await engine.runCycle()).applied).toBe(true);
    expect(fx.archive.list()).toHaveLength(1);
    expect(fx.create).toHaveBeenCalledTimes(1);
  });

  it('makes archive.append idempotent for the same stepping stone', () => {
    const dir = fs.mkdtempSync(path.join(QA_HOME, 'archive-idemp-'));
    try {
      const archive = new EvolutionaryArchive({ workDir: dir });
      const payload = {
        proposalId: 'p-1',
        kind: 'skill' as const,
        targetScenarioId: 's-1',
        delta: 1,
        scoreAfter: 1,
        appliedRef: 'authored-s-1',
      };
      const first = archive.append(payload);
      const second = archive.append({ ...payload, delta: 99 });
      expect(archive.list()).toHaveLength(1);
      expect(second).toEqual(first);
      expect(first.delta).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when the idempotent archive key maps to a distinct artifact', () => {
    const dir = fs.mkdtempSync(path.join(QA_HOME, 'archive-fp-'));
    try {
      const archive = new EvolutionaryArchive({ workDir: dir });
      const payload = {
        proposalId: 'p-1',
        kind: 'skill' as const,
        targetScenarioId: 's-1',
        delta: 1,
        scoreAfter: 1,
        appliedRef: 'authored-s-1',
        evidence: {
          artifactSha256: 'a'.repeat(64),
          benchmarkSha256: 'c'.repeat(64),
          wins: 1,
          losses: 0,
          cases: [] as { id: string; before: boolean; after: boolean }[],
        },
      };
      archive.append(payload);
      expect(() =>
        archive.append({
          ...payload,
          evidence: { ...payload.evidence, artifactSha256: 'b'.repeat(64) },
        }),
      ).toThrow(/fingerprint conflict/);
      expect(archive.list()).toHaveLength(1);
      expect(archive.list()[0]?.evidence?.artifactSha256).toBe('a'.repeat(64));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not install a pending intent when a new engine is propose-only', async () => {
    const fx = fixture('propose-only-resume');
    const proposal = proposalFor(fx.scenario, fx.spec);
    fx.journal.upsert({
      scenarioId: fx.scenario.id,
      proposalId: proposal.id,
      proposal,
      intendedSha256: sha256Hex(ensureFrontmatter(fx.spec.name, fx.spec.description, fx.spec.content)),
      phase: 'intent',
      behavior: PASS_BEHAVIOR,
    });
    const beforeJournal = fs.readFileSync(fx.journal.path);
    const beforeFiles = collectRelFiles(workDir);
    const engine = new SkillImprovementEngine({
      ...fx.engineOptions,
      autonomy: 'propose-only',
      proposer: { propose: async () => { throw new Error('must not re-author during propose-only skip'); } },
    });
    const result = await engine.runCycle();
    expect(result.applied).toBe(false);
    expect(result.notes[0]).toBe('pending skill apply requires auto-apply; not installed');
    expect(fx.create).not.toHaveBeenCalled();
    expect(fx.inner.has(fx.spec.name)).toBe(false);
    expect(fx.archive.list()).toHaveLength(0);
    expect(Buffer.from(fs.readFileSync(fx.journal.path)).equals(beforeJournal)).toBe(true);
    expect(collectRelFiles(workDir)).toEqual(beforeFiles);
  });

  it('refuses a pending apply whose scenario is missing', async () => {
    const fx = fixture('missing-scenario');
    const ghostSpec = fx.spec;
    const proposal: SkillProposal = { id: 'skill-proposal:ghost', targetScenarioId: 'ghost', spec: ghostSpec };
    fx.journal.upsert({
      scenarioId: 'ghost',
      proposalId: proposal.id,
      proposal,
      intendedSha256: sha256Hex(ensureFrontmatter(ghostSpec.name, ghostSpec.description, ghostSpec.content)),
      phase: 'intent',
      behavior: PASS_BEHAVIOR,
    });
    const engine = new SkillImprovementEngine(fx.engineOptions);
    const result = await engine.runCycle();
    expect(result.applied).toBe(false);
    expect(result.notes[0]).toBe('pending apply scenario is missing; not installed');
    expect(fx.create).not.toHaveBeenCalled();
    expect(fx.inner.has(fx.spec.name)).toBe(false);
    expect(fx.archive.list()).toHaveLength(0);
  });

  it('refuses a pending receipt whose saved SHA does not match the proposal artifact', async () => {
    const fx = fixture('sha-mismatch');
    const proposal = proposalFor(fx.scenario, fx.spec);
    const realSha = sha256Hex(ensureFrontmatter(fx.spec.name, fx.spec.description, fx.spec.content));
    const otherSha = 'b'.repeat(64);
    expect(otherSha).not.toBe(realSha);
    fx.journal.upsert({
      scenarioId: fx.scenario.id,
      proposalId: proposal.id,
      proposal,
      intendedSha256: otherSha,
      phase: 'intent',
      behavior: PASS_BEHAVIOR,
    });
    const engine = new SkillImprovementEngine(fx.engineOptions);
    const result = await engine.runCycle();
    expect(result.applied).toBe(false);
    expect(result.applyPhase).toBe('conflict');
    expect(result.notes[0]).toBe('pending apply intendedSha256 does not match proposal artifact');
    expect(fx.create).not.toHaveBeenCalled();
    expect(fx.archive.list()).toHaveLength(0);
  });

  it('does not accept a matching installed file when coverage is rejected', async () => {
    const fx = fixture('coverage-fastpath');
    occupyAsDirectory(fx.archive.path);
    const first = new SkillImprovementEngine(fx.engineOptions);
    const pending = await first.runCycle();
    expect(pending.proofPending).toBe(true);
    expect(fx.inner.has(fx.spec.name)).toBe(true);
    releaseOccupied(fx.archive.path);

    const stricter: SkillBenchmarkScenario = {
      ...fx.scenario,
      expectIncludes: [...fx.scenario.expectIncludes, 'TERM_ABSENT_FROM_SKILL'],
    };
    const engine = new SkillImprovementEngine({
      ...fx.engineOptions,
      scenarios: [stricter],
      proposer: { propose: async () => { throw new Error('must not re-author'); } },
    });
    const result = await engine.runCycle();
    expect(result.applied).toBe(false);
    expect(result.gate?.accepted).toBe(false);
    expect(fx.archive.list()).toHaveLength(0);
    expect(fx.create).toHaveBeenCalledTimes(1);
  });

  it('validates behavioral receipt even when the installed file matches', async () => {
    const fx = fixture('behavior-receipt');
    occupyAsDirectory(fx.archive.path);
    const first = new SkillImprovementEngine(fx.engineOptions);
    await first.runCycle();
    releaseOccupied(fx.archive.path);

    const current = fx.journal.get(fx.scenario.id)!;
    fx.journal.upsert({
      scenarioId: current.scenarioId,
      proposalId: current.proposalId,
      proposal: current.proposal,
      intendedSha256: current.intendedSha256,
      phase: 'installed',
      appliedRef: current.appliedRef,
    });
    const engine = new SkillImprovementEngine({
      ...fx.engineOptions,
      proposer: { propose: async () => { throw new Error('must not re-author'); } },
    });
    const result = await engine.runCycle();
    expect(result.applied).toBe(false);
    expect(result.notes[0]).toBe('pending apply is missing a behavioral receipt');
    expect(fx.archive.list()).toHaveLength(0);
    expect(fx.create).toHaveBeenCalledTimes(1);
  });

  it('does not accept a matching installed file when behavioral receipt is rejected', async () => {
    const fx = fixture('rejected-behavior');
    occupyAsDirectory(fx.archive.path);
    const first = new SkillImprovementEngine(fx.engineOptions);
    await first.runCycle();
    releaseOccupied(fx.archive.path);

    const current = fx.journal.get(fx.scenario.id)!;
    fx.journal.upsert({
      scenarioId: current.scenarioId,
      proposalId: current.proposalId,
      proposal: current.proposal,
      intendedSha256: current.intendedSha256,
      phase: 'installed',
      appliedRef: current.appliedRef,
      behavior: {
        accepted: false,
        wins: 0,
        losses: 1,
        tested: 1,
        cases: [{ id: 'unit-fixture', before: false, after: false }],
      },
    });
    const engine = new SkillImprovementEngine({
      ...fx.engineOptions,
      proposer: { propose: async () => { throw new Error('must not re-author'); } },
    });
    const result = await engine.runCycle();
    expect(result.applied).toBe(false);
    expect(result.gate?.accepted).toBe(false);
    expect(fx.archive.list()).toHaveLength(0);
    expect(fx.create).toHaveBeenCalledTimes(1);
  });

  it('reads the mutator-installed skill, not a guessed workspace path', async () => {
    const fx = fixture('mutator-root');
    const customRoot = path.join(workDir, 'mutator-skills');
    const inner = new LiveSkillMutator(customRoot);
    const create = vi.fn((spec: SkillSpec) => inner.create(spec));
    const mutator = wrappingMutator(inner, create);
    occupyAsDirectory(fx.archive.path);
    const engine = new SkillImprovementEngine({ ...fx.engineOptions, mutator });
    const failed = await engine.runCycle();
    expect(failed.proofPending).toBe(true);
    expect(inner.has(fx.spec.name)).toBe(true);

    const decoyDir = path.join(workDir, '.codebuddy', 'skills', fx.spec.name);
    fs.mkdirSync(decoyDir, { recursive: true });
    fs.writeFileSync(path.join(decoyDir, 'SKILL.md'), `${fx.spec.content}\nDECOY\n`);
    releaseOccupied(fx.archive.path);

    const retried = await engine.runCycle();
    expect(retried.applied).toBe(true);
    expect(fx.archive.summary().count).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('uses injected readInstalledSkill when the mutator has no read API', async () => {
    const fx = fixture('injected-read');
    occupyAsDirectory(fx.archive.path);
    const first = new SkillImprovementEngine(fx.engineOptions);
    await first.runCycle();
    releaseOccupied(fx.archive.path);

    const create = vi.fn((spec: SkillSpec) => fx.inner.create(spec));
    const mutator: SkillMutatorPort = {
      create,
      remove: (name) => fx.inner.remove(name),
      has: (name) => fx.inner.has(name),
    };
    const second = new SkillImprovementEngine({
      ...fx.engineOptions,
      mutator,
      readInstalledSkill: (name) => fx.inner.readInstalled(name),
      proposer: { propose: async () => { throw new Error('must not re-author'); } },
    });
    const retried = await second.runCycle();
    expect(retried.applied).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it('does not install when the apply journal is corrupt and preserves the bytes', async () => {
    const fx = fixture('corrupt-journal');
    fs.mkdirSync(path.dirname(fx.journal.path), { recursive: true });
    const corrupt = '{not-json';
    fs.writeFileSync(fx.journal.path, corrupt);
    const engine = new SkillImprovementEngine(fx.engineOptions);
    const failed = await engine.runCycle();
    expect(failed.applied).toBe(false);
    expect(failed.notes[0]).toBe('apply journal unreadable; refusing to install');
    expect(fs.readFileSync(fx.journal.path, 'utf8')).toBe(corrupt);
    expect(fx.create).not.toHaveBeenCalled();
    expect(fx.inner.has(fx.spec.name)).toBe(false);
  });
});

describe('SkillApplyJournal occupancy', () => {
  it('fails closed on an unreadable journal path and preserves the occupying bytes', () => {
    fs.mkdirSync(QA_HOME, { recursive: true });
    const dir = fs.mkdtempSync(path.join(QA_HOME, 'journal-occ-'));
    try {
      const journal = new SkillApplyJournal({ workDir: dir });
      occupyAsDirectory(journal.path);
      expect(() => journal.list()).toThrow(/unreadable/);
      expect(fs.statSync(journal.path).isDirectory()).toBe(true);
      expect(() =>
        journal.upsert({
          scenarioId: 's',
          proposalId: 'p',
          proposal: { id: 'p', targetScenarioId: 's', spec: { name: 'authored-s', description: 'd', content: '# H\nbody for journal occupancy.' } },
          intendedSha256: 'a'.repeat(64),
          phase: 'intent',
        }),
      ).toThrow();
      expect(fs.statSync(journal.path).isDirectory()).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats a missing journal file as empty', () => {
    fs.mkdirSync(QA_HOME, { recursive: true });
    const dir = fs.mkdtempSync(path.join(QA_HOME, 'journal-miss-'));
    try {
      const journal = new SkillApplyJournal({ workDir: dir });
      expect(fs.existsSync(journal.path)).toBe(false);
      expect(journal.list()).toEqual([]);
      expect(journal.listPending()).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed on corrupt JSON and preserves bytes', () => {
    fs.mkdirSync(QA_HOME, { recursive: true });
    const dir = fs.mkdtempSync(path.join(QA_HOME, 'journal-corrupt-'));
    try {
      const journal = new SkillApplyJournal({ workDir: dir });
      fs.mkdirSync(path.dirname(journal.path), { recursive: true });
      const corrupt = '{not-json';
      fs.writeFileSync(journal.path, corrupt);
      expect(() => journal.list()).toThrow(/corrupt/);
      expect(fs.readFileSync(journal.path, 'utf8')).toBe(corrupt);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed on invalid schema version and preserves bytes', () => {
    fs.mkdirSync(QA_HOME, { recursive: true });
    const dir = fs.mkdtempSync(path.join(QA_HOME, 'journal-ver-'));
    try {
      const journal = new SkillApplyJournal({ workDir: dir });
      fs.mkdirSync(path.dirname(journal.path), { recursive: true });
      const payload = JSON.stringify({ schemaVersion: 99, records: [] });
      fs.writeFileSync(journal.path, payload);
      expect(() => journal.list()).toThrow(/invalid/);
      expect(fs.readFileSync(journal.path, 'utf8')).toBe(payload);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
