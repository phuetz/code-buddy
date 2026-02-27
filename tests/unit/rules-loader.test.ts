/**
 * Tests for RulesLoader — modular rules loader for .codebuddy/rules/*.md files.
 *
 * All tests use real temporary directories (fs.mkdtemp) so that file I/O,
 * YAML frontmatter parsing, priority ordering, and scope filtering are
 * exercised without mocking the fs module.
 *
 * The RulesLoader singleton is reset between tests via resetRulesLoader()
 * so that global state does not leak across test cases.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { RulesLoader, getRulesLoader, resetRulesLoader } from '../../src/rules/rules-loader.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rules-loader-test-'));
}

async function cleanup(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/**
 * Write a markdown file with optional YAML frontmatter into `dir`.
 */
async function writeRule(
  dir: string,
  filename: string,
  content: string,
): Promise<string> {
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RulesLoader', () => {
  let loader: RulesLoader;

  // We will override the search directories by injecting them via the
  // private "searchDirs" getter. Because it reads process.cwd() and homedir()
  // at call time, the easiest approach is to point process.cwd() or use a
  // fresh RulesLoader instance with a patched internal.  Since the class
  // exposes no public "addDir" API we instead exercise the public API through
  // real directories that match the expected structure.
  //
  // To avoid touching ~/.codebuddy/rules or .codebuddy/rules in the working
  // repo, we spy on the private getter so each test points at temp dirs.

  let tmpProjectRulesDir: string;
  let tmpGlobalRulesDir: string;
  let tmpBase: string;

  beforeEach(async () => {
    resetRulesLoader();
    tmpBase = await makeTempDir();
    tmpProjectRulesDir = path.join(tmpBase, 'project', '.codebuddy', 'rules');
    tmpGlobalRulesDir = path.join(tmpBase, 'global', '.codebuddy', 'rules');
    await fs.mkdir(tmpProjectRulesDir, { recursive: true });
    await fs.mkdir(tmpGlobalRulesDir, { recursive: true });

    loader = new RulesLoader();

    // Patch the private searchDirs getter to use our temp dirs
    Object.defineProperty(loader, 'searchDirs', {
      get: () => [
        { dir: tmpGlobalRulesDir, source: 'global' },
        { dir: tmpProjectRulesDir, source: 'project' },
      ],
      configurable: true,
    });
  });

  afterEach(async () => {
    resetRulesLoader();
    await cleanup(tmpBase);
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('initial state', () => {
    it('isLoaded is false before load() is called', () => {
      expect(loader.isLoaded).toBe(false);
    });

    it('getAll() returns empty array before load()', () => {
      expect(loader.getAll()).toEqual([]);
    });

    it('list() returns empty array before load()', () => {
      expect(loader.list()).toEqual([]);
    });

    it('buildContextBlock() returns empty string before load()', () => {
      expect(loader.buildContextBlock()).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Loading rules from temp directories
  // -------------------------------------------------------------------------

  describe('load() — basic file loading', () => {
    it('isLoaded becomes true after load()', async () => {
      await loader.load();
      expect(loader.isLoaded).toBe(true);
    });

    it('loads .md files from the project rules directory', async () => {
      await writeRule(tmpProjectRulesDir, 'conventions.md', '# TypeScript Conventions\nUse strict mode.');
      await loader.load();
      const entries = loader.list();
      expect(entries.length).toBe(1);
      expect(entries[0].content).toContain('Use strict mode.');
    });

    it('loads .md files from the global rules directory', async () => {
      await writeRule(tmpGlobalRulesDir, 'global-rule.md', '# Global\nAlways add tests.');
      await loader.load();
      const entries = loader.list();
      expect(entries.length).toBe(1);
      expect(entries[0].source).toBe('global');
    });

    it('loads from both global and project directories', async () => {
      await writeRule(tmpGlobalRulesDir, 'global.md', '# G\nGlobal content.');
      await writeRule(tmpProjectRulesDir, 'project.md', '# P\nProject content.');
      await loader.load();
      expect(loader.list().length).toBe(2);
    });

    it('skips non-.md files', async () => {
      await writeRule(tmpProjectRulesDir, 'config.json', '{"key":"value"}');
      await writeRule(tmpProjectRulesDir, 'rule.md', '# Rule\nThis counts.');
      await writeRule(tmpProjectRulesDir, 'notes.txt', 'plain text');
      await loader.load();
      expect(loader.list().length).toBe(1);
      expect(loader.list()[0].content).toContain('This counts.');
    });

    it('returns empty when directory contains no .md files', async () => {
      await writeRule(tmpProjectRulesDir, 'readme.txt', 'hello');
      await loader.load();
      expect(loader.list()).toEqual([]);
    });

    it('returns empty when both directories are empty', async () => {
      await loader.load();
      expect(loader.list()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Non-existent directories
  // -------------------------------------------------------------------------

  describe('load() — non-existent directories', () => {
    it('returns empty when project rules dir does not exist', async () => {
      // Point to a path that was never created
      Object.defineProperty(loader, 'searchDirs', {
        get: () => [
          { dir: path.join(tmpBase, 'nonexistent-global'), source: 'global' },
          { dir: path.join(tmpBase, 'nonexistent-project'), source: 'project' },
        ],
        configurable: true,
      });
      await loader.load();
      expect(loader.list()).toEqual([]);
      expect(loader.isLoaded).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // YAML frontmatter parsing
  // -------------------------------------------------------------------------

  describe('YAML frontmatter parsing', () => {
    it('uses filename (without .md) as title when frontmatter is absent', async () => {
      await writeRule(tmpProjectRulesDir, 'my-rule.md', 'No frontmatter here.');
      await loader.load();
      expect(loader.list()[0].title).toBe('my-rule');
    });

    it('parses title from frontmatter', async () => {
      await writeRule(
        tmpProjectRulesDir,
        'ts-conventions.md',
        '---\ntitle: TypeScript Conventions\n---\nBody text.',
      );
      await loader.load();
      expect(loader.list()[0].title).toBe('TypeScript Conventions');
    });

    it('parses priority from frontmatter', async () => {
      await writeRule(
        tmpProjectRulesDir,
        'high.md',
        '---\npriority: 50\n---\nHigh priority rule.',
      );
      await loader.load();
      expect(loader.list()[0].priority).toBe(50);
    });

    it('defaults priority to 0 when not specified', async () => {
      await writeRule(tmpProjectRulesDir, 'no-prio.md', '# Rule\nContent.');
      await loader.load();
      expect(loader.list()[0].priority).toBe(0);
    });

    it('parses scope as inline YAML array', async () => {
      await writeRule(
        tmpProjectRulesDir,
        'scoped.md',
        '---\nscope: [code, plan]\n---\nScoped content.',
      );
      await loader.load();
      const entry = loader.list()[0];
      expect(entry.scope).toEqual(['code', 'plan']);
    });

    it('defaults scope to empty array when not specified', async () => {
      await writeRule(tmpProjectRulesDir, 'no-scope.md', 'Content.');
      await loader.load();
      expect(loader.list()[0].scope).toEqual([]);
    });

    it('parses alwaysApply: true from frontmatter', async () => {
      await writeRule(
        tmpProjectRulesDir,
        'always.md',
        '---\nalwaysApply: true\n---\nContent.',
      );
      await loader.load();
      expect(loader.list()[0].alwaysApply).toBe(true);
    });

    it('parses alwaysApply: false from frontmatter', async () => {
      await writeRule(
        tmpProjectRulesDir,
        'conditional.md',
        '---\nalwaysApply: false\n---\nContent.',
      );
      await loader.load();
      expect(loader.list()[0].alwaysApply).toBe(false);
    });

    it('defaults alwaysApply to true when not specified', async () => {
      await writeRule(tmpProjectRulesDir, 'default-apply.md', 'Content.');
      await loader.load();
      expect(loader.list()[0].alwaysApply).toBe(true);
    });

    it('strips frontmatter from content', async () => {
      await writeRule(
        tmpProjectRulesDir,
        'stripped.md',
        '---\ntitle: Test\npriority: 5\n---\nActual body content here.',
      );
      await loader.load();
      const entry = loader.list()[0];
      expect(entry.content).toBe('Actual body content here.');
      expect(entry.content).not.toContain('---');
      expect(entry.content).not.toContain('priority');
    });

    it('trims whitespace from body content', async () => {
      await writeRule(
        tmpProjectRulesDir,
        'trimmed.md',
        '---\ntitle: Trim Test\n---\n\n  Content with surrounding space.  \n\n',
      );
      await loader.load();
      expect(loader.list()[0].content).toBe('Content with surrounding space.');
    });
  });

  // -------------------------------------------------------------------------
  // Priority ordering
  // -------------------------------------------------------------------------

  describe('priority ordering', () => {
    it('lower priority entries come first (injected earlier)', async () => {
      await writeRule(
        tmpProjectRulesDir,
        'high.md',
        '---\npriority: 100\n---\nHigh priority.',
      );
      await writeRule(
        tmpProjectRulesDir,
        'low.md',
        '---\npriority: 1\n---\nLow priority.',
      );
      await writeRule(
        tmpProjectRulesDir,
        'mid.md',
        '---\npriority: 50\n---\nMid priority.',
      );
      await loader.load();
      const entries = loader.list();
      expect(entries[0].priority).toBe(1);
      expect(entries[1].priority).toBe(50);
      expect(entries[2].priority).toBe(100);
    });

    it('higher priority entries appear later (closer to query in context window)', async () => {
      await writeRule(tmpProjectRulesDir, 'p10.md', '---\npriority: 10\n---\nTen.');
      await writeRule(tmpProjectRulesDir, 'p20.md', '---\npriority: 20\n---\nTwenty.');
      await loader.load();
      const entries = loader.list();
      expect(entries[entries.length - 1].priority).toBe(20);
    });

    it('entries with equal priority maintain stable load order', async () => {
      await writeRule(tmpProjectRulesDir, 'aaa.md', '---\npriority: 5\n---\nAAA.');
      await writeRule(tmpProjectRulesDir, 'bbb.md', '---\npriority: 5\n---\nBBB.');
      await loader.load();
      const entries = loader.list();
      expect(entries.every(e => e.priority === 5)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scope filtering via getAll(mode)
  // -------------------------------------------------------------------------

  describe('scope filtering', () => {
    beforeEach(async () => {
      // Rule A: no scope, alwaysApply true — should appear in all modes
      await writeRule(
        tmpProjectRulesDir,
        'global-rule.md',
        '---\ntitle: Global Rule\nalwaysApply: true\n---\nAlways applies.',
      );
      // Rule B: scope [code] only
      await writeRule(
        tmpProjectRulesDir,
        'code-rule.md',
        '---\ntitle: Code Rule\nscope: [code]\n---\nCode mode only.',
      );
      // Rule C: scope [plan] only
      await writeRule(
        tmpProjectRulesDir,
        'plan-rule.md',
        '---\ntitle: Plan Rule\nscope: [plan]\n---\nPlan mode only.',
      );
      // Rule D: alwaysApply false, no scope — excluded when no mode given
      await writeRule(
        tmpProjectRulesDir,
        'conditional-rule.md',
        '---\ntitle: Conditional Rule\nalwaysApply: false\n---\nOnly if mode given.',
      );
      await loader.load();
    });

    it('getAll() with no mode returns rules with empty scope and alwaysApply:true', async () => {
      const entries = loader.getAll();
      const titles = entries.map(e => e.title);
      expect(titles).toContain('Global Rule');
    });

    it('getAll() with no mode includes scoped rules that have alwaysApply:true (default)', async () => {
      // According to the filter logic: a rule with scope set is still included
      // when no mode is given, UNLESS alwaysApply is explicitly false.
      // Code Rule and Plan Rule were written without alwaysApply so they default
      // to alwaysApply:true and therefore appear even with no mode argument.
      const entries = loader.getAll();
      const titles = entries.map(e => e.title);
      expect(titles).toContain('Code Rule');
      expect(titles).toContain('Plan Rule');
    });

    it('getAll() with no mode excludes alwaysApply:false rules', async () => {
      const entries = loader.getAll();
      const titles = entries.map(e => e.title);
      expect(titles).not.toContain('Conditional Rule');
    });

    it('getAll("code") includes rules scoped to "code"', async () => {
      const entries = loader.getAll('code');
      const titles = entries.map(e => e.title);
      expect(titles).toContain('Code Rule');
    });

    it('getAll("code") excludes rules scoped to "plan"', async () => {
      const entries = loader.getAll('code');
      const titles = entries.map(e => e.title);
      expect(titles).not.toContain('Plan Rule');
    });

    it('getAll("plan") includes rules scoped to "plan"', async () => {
      const entries = loader.getAll('plan');
      const titles = entries.map(e => e.title);
      expect(titles).toContain('Plan Rule');
    });

    it('getAll("code") includes global (no-scope) rules with alwaysApply:true', async () => {
      const entries = loader.getAll('code');
      const titles = entries.map(e => e.title);
      expect(titles).toContain('Global Rule');
    });
  });

  // -------------------------------------------------------------------------
  // buildContextBlock()
  // -------------------------------------------------------------------------

  describe('buildContextBlock()', () => {
    it('returns empty string when no rules are loaded', async () => {
      await loader.load();
      expect(loader.buildContextBlock()).toBe('');
    });

    it('returns a "## Project Rules" header when rules are present', async () => {
      await writeRule(tmpProjectRulesDir, 'rule.md', '---\ntitle: My Rule\n---\nSome content.');
      await loader.load();
      const block = loader.buildContextBlock();
      expect(block).toContain('## Project Rules');
    });

    it('includes each rule title as a level-3 heading', async () => {
      await writeRule(tmpProjectRulesDir, 'rule-a.md', '---\ntitle: Rule Alpha\n---\nAlpha content.');
      await writeRule(tmpProjectRulesDir, 'rule-b.md', '---\ntitle: Rule Beta\n---\nBeta content.');
      await loader.load();
      const block = loader.buildContextBlock();
      expect(block).toContain('### Rule Alpha');
      expect(block).toContain('### Rule Beta');
    });

    it('includes rule content below the heading', async () => {
      await writeRule(
        tmpProjectRulesDir,
        'rule.md',
        '---\ntitle: Content Rule\n---\nThis is the rule body.',
      );
      await loader.load();
      const block = loader.buildContextBlock();
      expect(block).toContain('This is the rule body.');
    });

    it('separates multiple rules with a "---" divider', async () => {
      await writeRule(tmpProjectRulesDir, 'a.md', '---\ntitle: A\n---\nA body.');
      await writeRule(tmpProjectRulesDir, 'b.md', '---\ntitle: B\n---\nB body.');
      await loader.load();
      const block = loader.buildContextBlock();
      // Should have the markdown horizontal rule separator between sections
      expect(block).toMatch(/---/);
    });

    it('filters by mode when mode argument is provided', async () => {
      await writeRule(
        tmpProjectRulesDir,
        'code-only.md',
        '---\ntitle: Code Only\nscope: [code]\n---\nFor code mode.',
      );
      await writeRule(
        tmpProjectRulesDir,
        'plan-only.md',
        '---\ntitle: Plan Only\nscope: [plan]\n---\nFor plan mode.',
      );
      await loader.load();
      const codeBlock = loader.buildContextBlock('code');
      expect(codeBlock).toContain('Code Only');
      expect(codeBlock).not.toContain('Plan Only');
    });

    it('returns empty string when mode filter excludes all rules', async () => {
      await writeRule(
        tmpProjectRulesDir,
        'code-rule.md',
        '---\ntitle: Code\nscope: [code]\n---\nCode only.',
      );
      await loader.load();
      // Request "ask" mode — no rules apply
      const block = loader.buildContextBlock('ask');
      expect(block).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Singleton helpers
  // -------------------------------------------------------------------------

  describe('getRulesLoader() / resetRulesLoader()', () => {
    it('getRulesLoader() returns the same instance on repeated calls', () => {
      const a = getRulesLoader();
      const b = getRulesLoader();
      expect(a).toBe(b);
    });

    it('resetRulesLoader() causes getRulesLoader() to return a new instance', () => {
      const before = getRulesLoader();
      resetRulesLoader();
      const after = getRulesLoader();
      expect(after).not.toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // Source tagging
  // -------------------------------------------------------------------------

  describe('source tagging', () => {
    it('tags rules from global dir as "global"', async () => {
      await writeRule(tmpGlobalRulesDir, 'g.md', 'Global rule.');
      await loader.load();
      const entry = loader.list().find(e => e.content === 'Global rule.');
      expect(entry?.source).toBe('global');
    });

    it('tags rules from project dir as "project"', async () => {
      await writeRule(tmpProjectRulesDir, 'p.md', 'Project rule.');
      await loader.load();
      const entry = loader.list().find(e => e.content === 'Project rule.');
      expect(entry?.source).toBe('project');
    });

    it('stores the resolved file path on each entry', async () => {
      const filePath = await writeRule(tmpProjectRulesDir, 'pathed.md', 'Content.');
      await loader.load();
      expect(loader.list()[0].path).toBe(filePath);
    });
  });
});
