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
import type { AuthoredToolSpec } from '../../../src/agent/self-improvement/authored-tool-runtime.js';
import type { ToolBenchmarkScenario } from '../../../src/agent/self-improvement/tool-types.js';
import type { SkillBenchmarkScenario, SkillSpec } from '../../../src/agent/self-improvement/skill-types.js';
import type { ToolProposer } from '../../../src/agent/self-improvement/tool-proposer.js';
import type { SkillProposer } from '../../../src/agent/self-improvement/skill-proposer.js';

const REVERSE: ToolBenchmarkScenario = {
  id: 'reverse-string',
  capability: 'Reverse the input string s',
  description: 'authored__reverse should reverse s',
  visibleCases: [
    { input: { s: 'abc' }, expectIncludes: ['cba'] },
    { input: { s: 'hello' }, expectIncludes: ['olleh'] },
  ],
  heldOutCases: [
    { input: { s: 'world' }, expectIncludes: ['dlrow'] },
    { input: { s: 'xyz' }, expectIncludes: ['zyx'] },
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

    const pendingPath = path.join(dir, '.codebuddy', 'self-improvement', 'proposals', 'tool-reverse-string.json');
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
    expect(
      fs.existsSync(path.join(dir, '.codebuddy', 'self-improvement', 'proposals', 'tool-reverse-string.json')),
    ).toBe(false);
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

    const pendingPath = path.join(dir, '.codebuddy', 'self-improvement', 'proposals', 'skill-git-bisect.json');
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
    expect(
      fs.existsSync(path.join(dir, '.codebuddy', 'self-improvement', 'proposals', 'skill-git-bisect.json')),
    ).toBe(false);
  });
});
