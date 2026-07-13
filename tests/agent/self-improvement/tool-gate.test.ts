import { describe, it, expect, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { validateToolProposal } from '../../../src/agent/self-improvement/tool-gate.js';
import { LiveToolMutator } from '../../../src/agent/self-improvement/tool-skill-mutator.js';
import { ToolImprovementEngine } from '../../../src/agent/self-improvement/tool-engine.js';
import { StaticToolProposer } from '../../../src/agent/self-improvement/tool-proposer.js';
import { EvolutionaryArchive } from '../../../src/agent/self-improvement/evolutionary-archive.js';
import type { AuthoredToolSpec } from '../../../src/agent/self-improvement/authored-tool-runtime.js';
import type { ToolBenchmarkScenario, ToolProposal } from '../../../src/agent/self-improvement/tool-types.js';
import { FormalToolRegistry } from '../../../src/tools/registry/tool-registry.js';
import { getToolRegistry } from '../../../src/tools/registry.js';

// Capability: reverse the input string `s`.
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

const UPPERCASE: ToolBenchmarkScenario = {
  id: 'uppercase-string',
  capability: 'Uppercase the input string s',
  description: 'authored tool should uppercase s',
  visibleCases: [{ input: { s: 'hello' }, expectIncludes: ['HELLO'] }],
  heldOutCases: [{ input: { s: 'world' }, expectIncludes: ['WORLD'] }],
};

const LEGIT: AuthoredToolSpec = {
  name: 'authored__reverse',
  description: 'reverse s',
  parameters: { type: 'object', properties: { s: { type: 'string' } } },
  language: 'javascript',
  code: "const i=JSON.parse(process.env.CODEBUDDY_TOOL_INPUT||'{}'); console.log((i.s||'').split('').reverse().join(''));",
};

const UPPERCASE_WITH_COLLIDING_NAME: AuthoredToolSpec = {
  ...LEGIT,
  code: "const i=JSON.parse(process.env.CODEBUDDY_TOOL_INPUT||'{}'); console.log((i.s||'').toUpperCase());",
};

// Gamed: hardcodes ONLY the visible outputs — passes visible, fails held-out.
const GAMED: AuthoredToolSpec = {
  ...LEGIT,
  code: "const i=JSON.parse(process.env.CODEBUDDY_TOOL_INPUT||'{}'); const m={abc:'cba',hello:'olleh'}; console.log(m[i.s]||'');",
};

const DANGEROUS: AuthoredToolSpec = {
  ...LEGIT,
  code: "require('child_process').execSync('rm -rf /tmp/x'); console.log('cba');",
};

function proposal(spec: AuthoredToolSpec): ToolProposal {
  return { id: `p:${spec.name}`, targetScenarioId: REVERSE.id, spec };
}

beforeEach(() => {
  FormalToolRegistry.reset();
  getToolRegistry().removeTool('authored__reverse');
  getToolRegistry().removeTool('authored__reverse_uppercase_string');
});

describe('tool-gate — behavioural held-out gate (anti reward-hacking)', () => {
  it('ACCEPTS a legitimate tool that passes visible AND held-out', async () => {
    const out = await validateToolProposal(proposal(LEGIT), REVERSE, new LiveToolMutator(), {
      keepOnAccept: false,
    });
    expect(out.accepted).toBe(true);
    expect(out.visiblePassed).toBe(2);
    expect(out.heldOutPassed).toBe(2);
  });

  it('REJECTS a tool that hardcodes the visible outputs (passes visible, fails held-out)', async () => {
    const out = await validateToolProposal(proposal(GAMED), REVERSE, new LiveToolMutator(), {
      keepOnAccept: true,
    });
    expect(out.accepted).toBe(false);
    expect(out.rejectionReason).toBe('heldout-fail');
    expect(out.visiblePassed).toBe(2); // it DID pass the visible cases
    expect(out.heldOutPassed).toBeLessThan(out.heldOutTotal); // but not the fresh ones
    // and nothing was registered
    expect(new LiveToolMutator().has('authored__reverse')).toBe(false);
  });

  it('REJECTS statically dangerous code before running it', async () => {
    const out = await validateToolProposal(proposal(DANGEROUS), REVERSE, new LiveToolMutator(), {
      keepOnAccept: true,
    });
    expect(out.accepted).toBe(false);
    expect(out.rejectionReason).toBe('static-scan');
  });

  it('REJECTS (fail-closed) a scenario with no held-out cases', async () => {
    const noHeldOut: ToolBenchmarkScenario = { ...REVERSE, heldOutCases: [] };
    const out = await validateToolProposal(proposal(LEGIT), noHeldOut, new LiveToolMutator(), {
      keepOnAccept: true,
    });
    expect(out.accepted).toBe(false);
    expect(out.rejectionReason).toBe('heldout-fail');
  });

  it('propose-only accepts but does NOT register; auto-apply registers + is callable', async () => {
    const proposeOnly = await validateToolProposal(proposal(LEGIT), REVERSE, new LiveToolMutator(), {
      keepOnAccept: false,
    });
    expect(proposeOnly.accepted).toBe(true);
    expect(new LiveToolMutator().has('authored__reverse')).toBe(false);

    const autoApply = await validateToolProposal(proposal(LEGIT), REVERSE, new LiveToolMutator(), {
      keepOnAccept: true,
    });
    expect(autoApply.accepted).toBe(true);
    expect(autoApply.appliedRef).toBe('authored__reverse');
    expect(FormalToolRegistry.getInstance().has('authored__reverse')).toBe(true);
    const out = await FormalToolRegistry.getInstance().execute('authored__reverse', { s: 'racecar!' });
    expect(out.output).toContain('!racecar');
  });

  it('mutator register→unregister leaves both registries clean (proven inverse)', () => {
    const m = new LiveToolMutator();
    m.register(LEGIT);
    expect(m.has('authored__reverse')).toBe(true);
    m.unregister('authored__reverse');
    expect(FormalToolRegistry.getInstance().has('authored__reverse')).toBe(false);
    expect(getToolRegistry().getTool('authored__reverse')).toBeUndefined();
  });

  it('register REFUSES a non-authored name (never shadows a built-in like bash)', () => {
    const m = new LiveToolMutator({ persist: false });
    const shadow: AuthoredToolSpec = { ...LEGIT, name: 'bash' };
    expect(() => m.register(shadow)).toThrow(/never shadow a built-in/i);
    // The built-in registry was not touched by the refused registration.
    expect(FormalToolRegistry.getInstance().has('bash') && !getToolRegistry().getTool('bash')).toBeFalsy();
  });

  it('the gate rejects a mis-named proposal as name-invalid BEFORE any scoring', async () => {
    const shadowProposal: ToolProposal = {
      id: 'shadow-1',
      spec: { ...LEGIT, name: 'read_file' },
    };
    const outcome = await validateToolProposal(shadowProposal, REVERSE, new LiveToolMutator({ persist: false }), {
      keepOnAccept: true,
    });
    expect(outcome.accepted).toBe(false);
    expect(outcome.rejectionReason).toBe('name-invalid');
    expect(outcome.visiblePassed).toBe(0); // never scored
    expect(getToolRegistry().getTool('read_file')).toBeUndefined();
  });
});

describe('ToolImprovementEngine — cycle', () => {
  it('auto-applies a legit tool and archives it; rejects a gamed one', async () => {
    const archive = new EvolutionaryArchive({ workDir: path.join(os.tmpdir(), `cb-arch-${randomUUID()}`) });
    const legitEngine = new ToolImprovementEngine({
      scenarios: [REVERSE],
      proposer: new StaticToolProposer(new Map([[REVERSE.id, LEGIT]])),
      archive,
      autonomy: 'auto-apply',
    });
    const r = await legitEngine.runCycle();
    expect(r.applied).toBe(true);
    expect(r.gate?.accepted).toBe(true);
    expect(archive.summary().count).toBe(1);

    FormalToolRegistry.reset();
    getToolRegistry().removeTool('authored__reverse');
    const gamedEngine = new ToolImprovementEngine({
      scenarios: [REVERSE],
      proposer: new StaticToolProposer(new Map([[REVERSE.id, GAMED]])),
      autonomy: 'auto-apply',
    });
    const r2 = await gamedEngine.runCycle();
    expect(r2.applied).toBe(false);
    expect(r2.gate?.rejectionReason).toBe('heldout-fail');
  });

  it('does not mark a homonymous proposal covered unless the existing tool passes its cases', async () => {
    const mutator = new LiveToolMutator({ persist: false });
    const engine = new ToolImprovementEngine({
      scenarios: [REVERSE, UPPERCASE],
      proposer: new StaticToolProposer(new Map([
        [REVERSE.id, LEGIT],
        [UPPERCASE.id, UPPERCASE_WITH_COLLIDING_NAME],
      ])),
      mutator,
      archive: new EvolutionaryArchive({ workDir: path.join(os.tmpdir(), `cb-arch-${randomUUID()}`) }),
      autonomy: 'auto-apply',
    });

    const results = await engine.runLoop();
    expect(results.slice(0, 2).map((result) => result.applied)).toEqual([true, true]);
    expect(results[1]!.gate?.appliedRef).toBe('authored__reverse_uppercase_string');
    expect(mutator.has('authored__reverse')).toBe(true);
    expect(mutator.has('authored__reverse_uppercase_string')).toBe(true);
    const output = await FormalToolRegistry.getInstance()
      .execute('authored__reverse_uppercase_string', { s: 'collision fixed' });
    expect(output.output).toContain('COLLISION FIXED');
  });
});
