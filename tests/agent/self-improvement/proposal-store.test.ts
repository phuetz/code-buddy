import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

import { FormalToolRegistry } from '../../../src/tools/registry/tool-registry.js';
import { getToolRegistry } from '../../../src/tools/registry.js';
import { EvolutionaryArchive } from '../../../src/agent/self-improvement/evolutionary-archive.js';
import { AuthoredToolStore } from '../../../src/agent/self-improvement/authored-tool-store.js';
import { LiveToolMutator } from '../../../src/agent/self-improvement/tool-skill-mutator.js';
import { LiveSkillMutator } from '../../../src/agent/self-improvement/skill-mutator.js';
import { ToolImprovementEngine } from '../../../src/agent/self-improvement/tool-engine.js';
import { SkillImprovementEngine } from '../../../src/agent/self-improvement/skill-engine.js';
import { StaticToolProposer } from '../../../src/agent/self-improvement/tool-proposer.js';
import { StaticSkillProposer } from '../../../src/agent/self-improvement/skill-proposer.js';
import { PendingProposalStore, PENDING_PROPOSAL_SCHEMA_VERSION } from '../../../src/agent/self-improvement/proposal-store.js';
import type { AuthoredToolSpec } from '../../../src/agent/self-improvement/authored-tool-runtime.js';
import type { ToolBenchmarkScenario, ToolProposal } from '../../../src/agent/self-improvement/tool-types.js';
import type { SkillBenchmarkScenario, SkillSpec } from '../../../src/agent/self-improvement/skill-types.js';
import type { ToolProposer } from '../../../src/agent/self-improvement/tool-proposer.js';
import type { SkillProposer } from '../../../src/agent/self-improvement/skill-proposer.js';

const REVERSE: ToolBenchmarkScenario = {
  id: 'reverse-string',
  capability: 'Reverse the input string s',
  description: 'authored__reverse should reverse s',
  visibleCases: [
    { input: { s: 'abc' }, expectedOutput: 'cba' },
    { input: { s: 'hello' }, expectedOutput: 'olleh' },
  ],
  heldOutCases: [
    { input: { s: 'world' }, expectedOutput: 'dlrow' },
    { input: { s: 'xyz' }, expectedOutput: 'zyx' },
  ],
};

const LEGIT_TOOL: AuthoredToolSpec = {
  name: 'authored__reverse',
  description: 'reverse s',
  parameters: { type: 'object', properties: { s: { type: 'string' } } },
  language: 'javascript',
  code: "const i=JSON.parse(process.env.CODEBUDDY_TOOL_INPUT||'{}'); console.log((i.s||'').split('').reverse().join(''));",
};

const BISECT: SkillBenchmarkScenario = {
  id: 'git-bisect',
  query: 'find which commit introduced a regression',
  expectIncludes: ['git bisect', 'good', 'bad'],
  description: 'guidance for bisecting a regression',
};

const LEGIT_SKILL: SkillSpec = {
  name: 'authored-git-bisect',
  description: 'bisect guidance',
  content:
    '# Git Bisect\nWhen to use: find which commit introduced a regression.\n' +
    'Steps: run `git bisect start`, mark a known good commit and a known bad commit, then test each step.',
};

function throwingToolProposer(message: string): ToolProposer {
  return {
    propose: async () => {
      throw new Error(message);
    },
  };
}

function throwingSkillProposer(message: string): SkillProposer {
  return {
    propose: async () => {
      throw new Error(message);
    },
  };
}

describe('pending proposals — propose-only persists, --apply reuses', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), `cb-pending-${randomUUID()}-`));
    FormalToolRegistry.reset();
    getToolRegistry().removeTool('authored__reverse');
  });

  afterEach(() => {
    FormalToolRegistry.reset();
    getToolRegistry().removeTool('authored__reverse');
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('propose-only writes an accepted tool candidate + gate evidence under proposals/', async () => {
    const mutator = new LiveToolMutator({
      persist: true,
      store: new AuthoredToolStore({ workDir: dir }),
    });
    const engine = new ToolImprovementEngine({
      scenarios: [REVERSE],
      proposer: new StaticToolProposer(new Map([[REVERSE.id, LEGIT_TOOL]])),
      mutator,
      archive: new EvolutionaryArchive({ workDir: dir }),
      autonomy: 'propose-only',
      workDir: dir,
    });

    const result = await engine.runCycle();
    expect(result.gate?.accepted).toBe(true);
    expect(result.applied).toBe(false);
    expect(mutator.has('authored__reverse')).toBe(false);

    const store = new PendingProposalStore({ workDir: dir });
    const pendingPath = store.pathFor('tool', REVERSE.id);
    expect(fs.existsSync(pendingPath)).toBe(true);
    const stored = JSON.parse(fs.readFileSync(pendingPath, 'utf-8')) as {
      kind: string;
      scenarioId: string;
      proposal: { spec: { name: string } };
      gate: { accepted: boolean };
    };
    expect(stored.kind).toBe('tool');
    expect(stored.scenarioId).toBe('reverse-string');
    expect(stored.proposal.spec.name).toBe('authored__reverse');
    expect(stored.gate.accepted).toBe(true);
  });

  it('auto-apply reuses the pending tool instead of re-authoring', async () => {
    const mutator = new LiveToolMutator({
      persist: true,
      store: new AuthoredToolStore({ workDir: dir }),
    });
    const propose = new ToolImprovementEngine({
      scenarios: [REVERSE],
      proposer: new StaticToolProposer(new Map([[REVERSE.id, LEGIT_TOOL]])),
      mutator,
      archive: new EvolutionaryArchive({ workDir: dir }),
      autonomy: 'propose-only',
      workDir: dir,
    });
    await propose.runCycle();
    expect(mutator.has('authored__reverse')).toBe(false);

    const store = new PendingProposalStore({ workDir: dir });
    const pendingPath = store.pathFor('tool', REVERSE.id);
    expect(fs.existsSync(pendingPath)).toBe(true);

    const apply = new ToolImprovementEngine({
      scenarios: [REVERSE],
      proposer: throwingToolProposer('must not re-author a pending tool'),
      mutator,
      archive: new EvolutionaryArchive({ workDir: dir }),
      autonomy: 'auto-apply',
      workDir: dir,
    });
    const result = await apply.runCycle();
    expect(result.applied).toBe(true);
    expect(result.gate?.appliedRef).toBe('authored__reverse');
    expect(mutator.has('authored__reverse')).toBe(true);
    expect(fs.existsSync(pendingPath)).toBe(false);
  });

  it('propose-only writes an accepted skill candidate + gate evidence under proposals/', async () => {
    const mutator = new LiveSkillMutator(dir);
    const engine = new SkillImprovementEngine({
      scenarios: [BISECT],
      proposer: new StaticSkillProposer(new Map([[BISECT.id, LEGIT_SKILL]])),
      mutator,
      archive: new EvolutionaryArchive({ workDir: dir }),
      autonomy: 'propose-only',
      workDir: dir,
    });

    const result = await engine.runCycle();
    expect(result.gate?.accepted).toBe(true);
    expect(result.applied).toBe(false);
    expect(mutator.has('authored-git-bisect')).toBe(false);

    const store = new PendingProposalStore({ workDir: dir });
    const pendingPath = store.pathFor('skill', BISECT.id);
    expect(fs.existsSync(pendingPath)).toBe(true);
    const stored = JSON.parse(fs.readFileSync(pendingPath, 'utf-8')) as {
      kind: string;
      scenarioId: string;
      proposal: { spec: { name: string } };
      gate: { accepted: boolean };
    };
    expect(stored.kind).toBe('skill');
    expect(stored.scenarioId).toBe('git-bisect');
    expect(stored.proposal.spec.name).toBe('authored-git-bisect');
    expect(stored.gate.accepted).toBe(true);
  });

  it('auto-apply reuses the pending skill instead of re-authoring', async () => {
    const mutator = new LiveSkillMutator(dir);
    const propose = new SkillImprovementEngine({
      scenarios: [BISECT],
      proposer: new StaticSkillProposer(new Map([[BISECT.id, LEGIT_SKILL]])),
      mutator,
      archive: new EvolutionaryArchive({ workDir: dir }),
      autonomy: 'propose-only',
      workDir: dir,
    });
    await propose.runCycle();
    expect(mutator.has('authored-git-bisect')).toBe(false);

    const store = new PendingProposalStore({ workDir: dir });
    const pendingPath = store.pathFor('skill', BISECT.id);
    expect(fs.existsSync(pendingPath)).toBe(true);

    const apply = new SkillImprovementEngine({
      scenarios: [BISECT],
      proposer: throwingSkillProposer('must not re-author a pending skill'),
      mutator,
      archive: new EvolutionaryArchive({ workDir: dir }),
      autonomy: 'auto-apply',
      workDir: dir,
    });
    const result = await apply.runCycle();
    expect(result.applied).toBe(true);
    expect(result.gate?.appliedRef).toBe('authored-git-bisect');
    expect(mutator.has('authored-git-bisect')).toBe(true);
    expect(fs.existsSync(pendingPath)).toBe(false);
  });

  it('avoids collision between scenarios like audit/a and audit:a', () => {
    const store = new PendingProposalStore({ workDir: dir });
    const dummyProposalA: ToolProposal = {
      id: 'prop-a',
      rationale: 'for audit/a',
      spec: LEGIT_TOOL,
    };
    const dummyProposalB: ToolProposal = {
      id: 'prop-b',
      rationale: 'for audit:a',
      spec: { ...LEGIT_TOOL, name: 'authored__reverse_b' },
    };

    const recordA = store.saveTool({
      scenarioId: 'audit/a',
      acceptedAt: new Date().toISOString(),
      proposal: dummyProposalA,
      gate: { accepted: true, appliedRef: 'authored__reverse' },
    });

    const recordB = store.saveTool({
      scenarioId: 'audit:a',
      acceptedAt: new Date().toISOString(),
      proposal: dummyProposalB,
      gate: { accepted: true, appliedRef: 'authored__reverse_b' },
    });

    expect(store.pathFor('tool', 'audit/a')).not.toBe(store.pathFor('tool', 'audit:a'));

    const loadedA = store.loadTool('audit/a');
    const loadedB = store.loadTool('audit:a');
    expect(loadedA?.proposal.id).toBe('prop-a');
    expect(loadedB?.proposal.id).toBe('prop-b');

    // Removing audit/a does not remove audit:a
    expect(store.remove('tool', 'audit/a')).toBe(true);
    expect(store.loadTool('audit/a')).toBeNull();
    expect(store.loadTool('audit:a')?.proposal.id).toBe('prop-b');
  });

  it('reads legacy unhashed proposals only if exact scenarioId matches and does not delete on collision', () => {
    const store = new PendingProposalStore({ workDir: dir });
    fs.mkdirSync(store.dir, { recursive: true });

    const legacyPath = store.legacyPathFor('tool', 'audit/a'); // tool-audit-a.json
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        schemaVersion: PENDING_PROPOSAL_SCHEMA_VERSION,
        kind: 'tool',
        scenarioId: 'audit:a', // scenarioId is audit:a inside the legacy file
        acceptedAt: new Date().toISOString(),
        proposal: { id: 'legacy-b', rationale: 'legacy', spec: LEGIT_TOOL },
        gate: { accepted: true },
      }),
    );

    // Querying audit/a should NOT load the legacy file of audit:a
    expect(store.loadTool('audit/a')).toBeNull();

    // Querying audit:a SHOULD load it via legacy path
    expect(store.loadTool('audit:a')?.proposal.id).toBe('legacy-b');

    // Removing audit/a must NOT delete the legacy file of audit:a
    expect(store.remove('tool', 'audit/a')).toBe(false);
    expect(fs.existsSync(legacyPath)).toBe(true);

    // Removing audit:a SHOULD delete the legacy file
    expect(store.remove('tool', 'audit:a')).toBe(true);
    expect(fs.existsSync(legacyPath)).toBe(false);
  });

  it('validates structure and ignores corrupted or malformed files', () => {
    const store = new PendingProposalStore({ workDir: dir });
    fs.mkdirSync(store.dir, { recursive: true });

    const pathCorrupt = store.pathFor('tool', 'corrupt-test');
    fs.writeFileSync(pathCorrupt, '{ broken json');
    expect(store.loadTool('corrupt-test')).toBeNull();

    const pathBadSchema = store.pathFor('tool', 'bad-schema');
    fs.writeFileSync(
      pathBadSchema,
      JSON.stringify({
        schemaVersion: 999,
        kind: 'tool',
        scenarioId: 'bad-schema',
        proposal: {},
        gate: {},
      }),
    );
    expect(store.loadTool('bad-schema')).toBeNull();

    const pathBadKind = store.pathFor('tool', 'bad-kind');
    fs.writeFileSync(
      pathBadKind,
      JSON.stringify({
        schemaVersion: PENDING_PROPOSAL_SCHEMA_VERSION,
        kind: 'skill',
        scenarioId: 'bad-kind',
        proposal: {},
        gate: {},
      }),
    );
    expect(store.loadTool('bad-kind')).toBeNull();
  });
});
