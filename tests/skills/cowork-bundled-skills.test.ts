import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { SkillRegistry } from '../../src/skills/registry.js';
import { skillMdToUnified } from '../../src/skills/adapters/legacy-skill-adapter.js';
import { initializeSkills, findSkill } from '../../src/skills/index.js';
import { getSkillRegistry, resetSkillRegistry } from '../../src/skills/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests/skills -> repo root -> cowork/.claude/skills (the bundled document skills
// shipped with the Cowork desktop app).
const COWORK_SKILLS_DIR = path.resolve(__dirname, '..', '..', 'cowork', '.claude', 'skills');

describe('Cowork bundled skills load into the core SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeAll(async () => {
    // Use a fresh registry (not the global singleton) pointed at Cowork's
    // bundled skills directory — the same wiring the embedded engine uses.
    // Pin the workspace/managed tiers to empty so the registry loads ONLY the
    // bundled skills: otherwise a dev's local ~/.codebuddy/skills (e.g. a
    // `pdfcommander` skill) shadows the bundled `pdf` and makes routing
    // assertions non-deterministic across machines.
    registry = new SkillRegistry({
      bundledPath: COWORK_SKILLS_DIR,
      workspacePath: '',
      managedPath: '',
      cacheEnabled: false,
      watchEnabled: false,
    });
    await registry.load();
  });

  afterAll(() => {
    registry.shutdown();
  });

  it('parses the document, data & automation skills as bundled-tier skills', () => {
    expect(fs.existsSync(COWORK_SKILLS_DIR)).toBe(true);
    const names = registry
      .list()
      .map((s) => s.metadata.name)
      .sort();
    for (const expected of [
      // create skills
      'pptx', 'docx', 'xlsx', 'pdf', 'skill-creator',
      // Python clean-room skills (read / chart / automate / research)
      'doc-ingest', 'data-charts', 'web-automate', 'web-research',
    ]) {
      expect(names, `registry missing skill: ${expected}`).toContain(expected);
    }
  });

  // codebuddy-agent.ts only injects a skill when findSkill() confidence >= 0.3,
  // so the assertions below pin the demo-video requests above that threshold —
  // not merely that *a* match exists.
  const ACTIVATION_THRESHOLD = 0.3;

  it('matches a natural-language PPTX request above the activation threshold', () => {
    const match = registry.findBestMatch('Read the CSV and create a PowerPoint presentation');
    expect(match).not.toBeNull();
    expect(match?.skill.metadata.name).toBe('pptx');
    expect(match!.confidence).toBeGreaterThanOrEqual(ACTIVATION_THRESHOLD);
  });

  it('matches a natural-language spreadsheet request above the activation threshold', () => {
    const match = registry.findBestMatch('Generate an Excel spreadsheet with formulas');
    expect(match).not.toBeNull();
    expect(match?.skill.metadata.name).toBe('xlsx');
    expect(match!.confidence).toBeGreaterThanOrEqual(ACTIVATION_THRESHOLD);
  });

  it('matches a natural-language PDF-form request above the activation threshold', () => {
    const match = registry.findBestMatch('Fill out this PDF form for me');
    expect(match).not.toBeNull();
    expect(match?.skill.metadata.name).toBe('pdf');
    expect(match!.confidence).toBeGreaterThanOrEqual(ACTIVATION_THRESHOLD);
  });

  // The Python clean-room skills (doc-ingest / data-charts / web-automate /
  // web-research) must route to themselves for their intent — and NOT steal the
  // create skills' requests. These pin the routing the manual scorer audit
  // verified, so a future trigger/description edit can't silently regress it.
  const routes: Array<[string, string]> = [
    ['Extract the text from this document and convert it to markdown', 'doc-ingest'],
    ['Plot a bar chart of the monthly revenue', 'data-charts'],
    ['Scrape the headlines from this website with a headless browser', 'web-automate'],
    ['Research this topic across sources and write a cited brief', 'web-research'],
  ];
  for (const [request, expected] of routes) {
    it(`routes "${request.slice(0, 32)}…" to ${expected} above threshold`, () => {
      const match = registry.findBestMatch(request);
      expect(match, `no match for: ${request}`).not.toBeNull();
      expect(match?.skill.metadata.name).toBe(expected);
      expect(match!.confidence).toBeGreaterThanOrEqual(ACTIVATION_THRESHOLD);
    });
  }

  it('injects the full SKILL.md workflow body (script commands), not just the overview', () => {
    const pptx = registry.get('pptx');
    expect(pptx).toBeDefined();
    // This is exactly what codebuddy-agent.ts:958 injects on activation.
    const injected = skillMdToUnified(pptx!).systemPrompt || '';
    // Body-only tokens — present in the clean-room SKILL.md workflow/example
    // but NOT in the one-line frontmatter/overview description. Their presence
    // proves the model receives the actual instructions (drive python-pptx
    // directly), not just the overview.
    expect(injected).toContain('python-pptx');
    expect(injected).toContain('Presentation(');
    expect(injected.length).toBeGreaterThan(1000);
  });
});

describe('Embedded engine wiring: CODEBUDDY_BUNDLED_SKILLS_DIR → findSkill (production path)', () => {
  const prevEnv = process.env.CODEBUDDY_BUNDLED_SKILLS_DIR;

  afterEach(() => {
    resetSkillRegistry();
    if (prevEnv === undefined) {
      delete process.env.CODEBUDDY_BUNDLED_SKILLS_DIR;
    } else {
      process.env.CODEBUDDY_BUNDLED_SKILLS_DIR = prevEnv;
    }
  });

  it('surfaces the bundled skills through the real getBundledSkillsPath + singleton + findSkill chain', async () => {
    // Exercise the exact production path the embedded engine uses: the host
    // sets the env var, the core resolves it in getBundledSkillsPath(), the
    // singleton loads it, and findSkill() matches user requests.
    process.env.CODEBUDDY_BUNDLED_SKILLS_DIR = COWORK_SKILLS_DIR;
    resetSkillRegistry();
    await initializeSkills();

    // Sanity: the singleton actually loaded from our env-provided directory.
    expect(getSkillRegistry().get('pptx')).toBeDefined();

    const match = findSkill('Read the CSV and create a PowerPoint presentation');
    expect(match).not.toBeNull();
    expect(match?.skill.metadata.name).toBe('pptx');
    expect(match!.confidence).toBeGreaterThanOrEqual(0.3);
  });
});
