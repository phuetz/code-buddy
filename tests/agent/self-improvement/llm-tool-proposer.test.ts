import { describe, it, expect, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  LlmToolProposer,
  parseToolDraft,
  buildToolDraftPrompt,
} from '../../../src/agent/self-improvement/llm-tool-proposer.js';
import { toProposerView } from '../../../src/agent/self-improvement/tool-proposer.js';
import { ToolImprovementEngine } from '../../../src/agent/self-improvement/tool-engine.js';
import { EvolutionaryArchive } from '../../../src/agent/self-improvement/evolutionary-archive.js';
import { SEED_TOOL_SCENARIOS } from '../../../src/agent/self-improvement/tool-benchmark.js';
import { FormalToolRegistry } from '../../../src/tools/registry/tool-registry.js';
import { getToolRegistry } from '../../../src/tools/registry.js';
import { LiveToolMutator } from '../../../src/agent/self-improvement/tool-skill-mutator.js';

const SLUGIFY = SEED_TOOL_SCENARIOS.find((s) => s.id === 'slugify')!;

// A model that generalizes (real implementation).
const REAL_DRAFT = JSON.stringify({
  name: 'slugify',
  description: 'slugify text',
  params: { type: 'object', properties: { text: { type: 'string' } } },
  language: 'javascript',
  code: "const i=JSON.parse(process.env.CODEBUDDY_TOOL_INPUT||'{}'); console.log((i.text||'').toLowerCase().replace(/\\s+/g,'-'));",
});

// A model that hardcodes ONLY the visible answers (gaming attempt).
const GAMED_DRAFT = JSON.stringify({
  name: 'slugify',
  description: 'slugify text',
  params: { type: 'object', properties: { text: { type: 'string' } } },
  language: 'javascript',
  code: "const i=JSON.parse(process.env.CODEBUDDY_TOOL_INPUT||'{}'); const m={'Hello World':'hello-world','Foo Bar Baz':'foo-bar-baz'}; console.log(m[i.text]||'');",
});

function mockClient(content: string) {
  return { chat: async () => ({ choices: [{ message: { content } }] }) };
}

function engineWith(content: string) {
  return new ToolImprovementEngine({
    scenarios: [SLUGIFY],
    proposer: new LlmToolProposer({ client: mockClient(content) }),
    mutator: new LiveToolMutator({ persist: false }),
    archive: new EvolutionaryArchive({ workDir: path.join(os.tmpdir(), `cb-arch-${randomUUID()}`) }),
    autonomy: 'auto-apply',
  });
}

beforeEach(() => {
  FormalToolRegistry.reset();
  getToolRegistry().removeTool('authored__slugify');
});

describe('parseToolDraft', () => {
  it('parses a clean JSON object', () => {
    const spec = parseToolDraft(REAL_DRAFT);
    expect(spec?.name).toBe('authored__slugify');
    expect(spec?.language).toBe('javascript');
  });

  it('tolerates surrounding prose / code fences', () => {
    const spec = parseToolDraft('Sure! Here is the tool:\n```json\n' + REAL_DRAFT + '\n```\nHope it helps.');
    expect(spec?.name).toBe('authored__slugify');
  });

  it('returns null on garbage', () => {
    expect(parseToolDraft('no json here')).toBeNull();
    expect(parseToolDraft('{ not valid')).toBeNull();
  });

  it('declines when no provider/client is configured', async () => {
    const proposer = new LlmToolProposer({ client: null });
    expect(await proposer.propose({ id: 'x', capability: 'c', description: 'd', visibleCases: [] })).toBeNull();
  });
});

describe('LlmToolProposer — held-out cases never reach the model', () => {
  it('toProposerView omits heldOutCases and the draft prompt never contains them', async () => {
    const view = toProposerView(SLUGIFY);
    expect(view).not.toHaveProperty('heldOutCases');
    expect(Object.keys(view).sort()).toEqual(['capability', 'description', 'id', 'visibleCases']);

    const prompt = buildToolDraftPrompt(view);
    const visibleBlob = JSON.stringify(view.visibleCases);
    // Needles that exist in BOTH visible and held-out (e.g. "hello-world" after
    // the run-of-spaces held-out was added) cannot prove redaction. Use the
    // held-out-only strings (fresh inputs / fresh expected slugs).
    const uniqueHeldOutNeedles = SLUGIFY.heldOutCases
      .flatMap((c) => [String(c.input.text), c.expectedOutput])
      .filter((needle) => needle.length > 0 && !visibleBlob.includes(needle));
    expect(uniqueHeldOutNeedles.length).toBeGreaterThan(0);
    expect(uniqueHeldOutNeedles).toEqual(expect.arrayContaining(['The Quick Brown', 'the-quick-brown', 'Hello  World']));
    for (const needle of uniqueHeldOutNeedles) {
      expect(prompt).not.toContain(needle);
    }

    let seen = '';
    const proposer = new LlmToolProposer({
      client: {
        chat: async (messages) => {
          seen = messages.map((m) => m.content).join('\n');
          return { choices: [{ message: { content: REAL_DRAFT } }] };
        },
      },
    });
    await proposer.propose(view);
    for (const needle of uniqueHeldOutNeedles) {
      expect(seen).not.toContain(needle);
    }
  });
});

describe('LlmToolProposer — generative self-improvement loop (gated)', () => {
  it('auto-applies a generalizing LLM-authored tool (passes held-out)', async () => {
    const result = await engineWith(REAL_DRAFT).runCycle();
    expect(result.applied).toBe(true);
    expect(result.gate?.accepted).toBe(true);
    // the authored tool is now callable and actually generalizes
    const out = await FormalToolRegistry.getInstance().execute('authored__slugify', { text: 'Brand New Input' });
    expect(out.output).toContain('brand-new-input');
  });

  it('REJECTS an LLM-authored tool that hardcodes the visible answers (held-out fails)', async () => {
    const result = await engineWith(GAMED_DRAFT).runCycle();
    expect(result.applied).toBe(false);
    expect(result.gate?.rejectionReason).toBe('heldout-fail');
    expect(FormalToolRegistry.getInstance().has('authored__slugify')).toBe(false);
  });
});
