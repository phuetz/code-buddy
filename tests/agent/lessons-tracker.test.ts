/**
 * Tests for LessonsTracker — self-improvement loop
 *
 * Uses real fs in a tmpDir to match the production code path.
 * os.homedir() is spied on to prevent contamination from any real
 * ~/.codebuddy/lessons.md on the developer's machine.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import {
  getLessonsTracker,
  LessonsTracker,
  renderLessonConceptGraph,
  renderLessonConceptGraphMarkdown,
  renderLessonConceptGraphMermaid,
  renderLessonConceptGraphSummary,
  renderLessonConceptVaultFiles,
} from '../../src/agent/lessons-tracker.js';

// Mock os.homedir so global ~/.codebuddy/lessons.md never contaminates tests.
// The module-level variable is updated per-test in beforeEach.
let _fakeHome = '/tmp/lessons-test-home-placeholder';
jest.mock('os', () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: jest.fn(() => _fakeHome) };
});

describe('LessonsTracker', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lessons-test-'));
    // Point "global" lessons dir to an empty location inside tmpDir
    _fakeHome = path.join(tmpDir, 'fake-home');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  // --------------------------------------------------------------------------
  // Singleton behaviour
  // --------------------------------------------------------------------------

  describe('getLessonsTracker (singleton)', () => {
    it('should return the same instance for the same directory', () => {
      const t1 = getLessonsTracker(tmpDir);
      const t2 = getLessonsTracker(tmpDir);
      expect(t1).toBe(t2);
    });

    it('should return different instances for different directories', async () => {
      const other = await fs.mkdtemp(path.join(os.tmpdir(), 'lessons-other-'));
      try {
        const t1 = getLessonsTracker(tmpDir);
        const t2 = getLessonsTracker(other);
        expect(t1).not.toBe(t2);
      } finally {
        await fs.remove(other);
      }
    });
  });

  // --------------------------------------------------------------------------
  // add()
  // --------------------------------------------------------------------------

  describe('add()', () => {
    it('should return a LessonItem with id and createdAt', () => {
      const tracker = getLessonsTracker(tmpDir);
      const item = tracker.add('PATTERN', 'use tsc before commit', 'manual');
      expect(item.id).toBeDefined();
      expect(typeof item.id).toBe('string');
      expect(item.createdAt).toBeGreaterThan(0);
      expect(item.category).toBe('PATTERN');
      expect(item.content).toBe('use tsc before commit');
      expect(item.source).toBe('manual');
    });

    it('should store context when provided', () => {
      const tracker = getLessonsTracker(tmpDir);
      const item = tracker.add('CONTEXT', 'repo uses ESM imports', 'manual', 'TypeScript');
      expect(item.context).toBe('TypeScript');
    });

    it('should support all valid categories', () => {
      const tracker = getLessonsTracker(tmpDir);
      const cats = ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'] as const;
      for (const cat of cats) {
        const item = tracker.add(cat, `${cat} content`, 'manual');
        expect(item.category).toBe(cat);
      }
    });
  });

  // --------------------------------------------------------------------------
  // list()
  // --------------------------------------------------------------------------

  describe('list()', () => {
    it('should return all items when no category filter given', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('PATTERN', 'pattern lesson', 'manual');
      tracker.add('RULE', 'rule lesson', 'manual');
      const items = tracker.list();
      const contents = items.map(i => i.content);
      expect(contents).toContain('pattern lesson');
      expect(contents).toContain('rule lesson');
    });

    it('should filter by category', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('PATTERN', 'pattern lesson', 'manual');
      tracker.add('RULE', 'rule lesson', 'manual');
      const rules = tracker.list('RULE');
      expect(rules.every(i => i.category === 'RULE')).toBe(true);
      expect(rules.some(i => i.content === 'rule lesson')).toBe(true);
      expect(rules.some(i => i.content === 'pattern lesson')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // search()
  // --------------------------------------------------------------------------

  describe('search()', () => {
    it('should find items by substring match in content', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('PATTERN', 'always run tsc before committing', 'manual');
      const results = tracker.search('tsc');
      expect(results.some(i => i.content.includes('tsc'))).toBe(true);
    });

    it('should filter results by category when both query and category given', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('PATTERN', 'run tsc: pattern item', 'manual');
      tracker.add('RULE', 'run tsc: rule item', 'manual');
      const results = tracker.search('tsc', 'PATTERN');
      expect(results.every(i => i.category === 'PATTERN')).toBe(true);
    });

    it('should return empty array when no match found', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('INSIGHT', 'something unrelated', 'manual');
      expect(tracker.search('nonexistent_xyz')).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // buildConceptGraph()
  // --------------------------------------------------------------------------

  describe('buildConceptGraph()', () => {
    it('should derive a mini knowledge graph from wiki links, tags, context, and keywords', () => {
      const tracker = getLessonsTracker(tmpDir);
      const first = tracker.add(
        'PATTERN',
        'Use [[contact-discovery]] before broad scraping. tags: lead-scout, public-data',
        'manual',
        'Lead Scout',
      );
      const second = tracker.add(
        'INSIGHT',
        'For architect enrichment, follow website links before guessing phones. related: contact-discovery',
        'manual',
        'Lead Scout',
      );

      const graph = tracker.buildConceptGraph();
      const contactDiscovery = graph.concepts.find(concept => concept.id === 'contact-discovery');
      const leadScout = graph.concepts.find(concept => concept.id === 'lead-scout');

      expect(graph.schemaVersion).toBe(1);
      expect(graph.filters).toEqual({ includeKeywords: true, limit: 50 });
      expect(contactDiscovery).toBeDefined();
      expect(contactDiscovery!.lessonIds).toEqual(expect.arrayContaining([first.id, second.id]));
      expect(graph.backlinks['contact-discovery']).toEqual(expect.arrayContaining([first.id, second.id]));
      expect(leadScout).toBeDefined();
      expect(leadScout!.lessonIds).toEqual(expect.arrayContaining([first.id, second.id]));
      expect(graph.lessonConcepts[first.id].some(concept => concept.slug === 'public-data')).toBe(true);
      expect(graph.relatedLessons.some(edge => edge.from === first.id && edge.to === second.id)).toBe(true);
    });

    it('should filter graph lessons by query and category', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('PATTERN', 'Lead Scout should verify public sources. tags: lead-scout', 'manual');
      tracker.add('RULE', 'Always run tests before done. tags: verification', 'manual');

      const graph = tracker.buildConceptGraph({ query: 'Lead Scout', category: 'PATTERN' });

      expect(graph.lessons).toHaveLength(1);
      expect(graph.filters).toEqual({
        query: 'Lead Scout',
        category: 'PATTERN',
        includeKeywords: true,
        limit: 50,
      });
      expect(graph.lessons[0].category).toBe('PATTERN');
      expect(graph.concepts.some(concept => concept.id === 'lead-scout')).toBe(true);
      expect(graph.concepts.some(concept => concept.id === 'verification')).toBe(false);
    });

    it('should filter graph lessons by concept slug, label, or Markdown target', () => {
      const tracker = getLessonsTracker(tmpDir);
      const linked = tracker.add(
        'PATTERN',
        'Use [[concepts/contact-discovery.md|contact page discovery]] with [sandbox scripts](concepts/sandbox-scripts.md).',
        'manual',
      );
      tracker.add('RULE', 'Always verify generated scripts. tags: verification', 'manual');

      const byLabel = tracker.buildConceptGraph({ concept: 'contact page discovery' });
      const byTarget = tracker.buildConceptGraph({ concept: 'concepts/sandbox-scripts.md' });

      expect(byLabel.lessons.map(lesson => lesson.id)).toEqual([linked.id]);
      expect(byLabel.concepts.some(concept => concept.id === 'contact-discovery')).toBe(true);
      expect(byTarget.lessons.map(lesson => lesson.id)).toEqual([linked.id]);
      expect(byTarget.concepts.some(concept => concept.id === 'verification')).toBe(false);
    });

    it('should clamp invalid graph limits and render Mermaid output', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('PATTERN', 'Use [[contact-discovery]] before broad scraping. tags: lead-scout', 'manual');

      const graph = tracker.buildConceptGraph({ limit: Number.NaN });
      const mermaid = renderLessonConceptGraphMermaid(graph);
      const summary = renderLessonConceptGraphSummary(graph);

      expect(graph.lessons).toHaveLength(1);
      expect(mermaid).toContain('graph TD');
      expect(mermaid).toContain('contact-discovery');
      expect(summary).toContain('## Backlinks');
      expect(summary).toContain('contact-discovery');
    });

    it('should render an Obsidian-friendly Markdown graph index', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add(
        'PATTERN',
        'Use [[contact-discovery]] before broad scraping. tags: lead-scout',
        'manual',
      );

      const graph = tracker.buildConceptGraph();
      const markdown = renderLessonConceptGraphMarkdown(graph);

      expect(renderLessonConceptGraph(graph, 'markdown')).toBe(markdown);
      expect(markdown).toContain('# Lessons Graph');
      expect(markdown).toContain('Filters: query=any; concept=any; category=any; includeKeywords=true; limit=50');
      expect(markdown).toContain('### [[contact-discovery|contact-discovery]]');
      expect(markdown).toContain('## Related Lessons');
    });

    it('should optionally exclude fallback keyword concepts for cleaner indexes', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add(
        'PATTERN',
        'Use [[contact-discovery]] before broad scraping. tags: lead-scout',
        'manual',
      );

      const graph = tracker.buildConceptGraph({ includeKeywords: false });

      expect(graph.filters.includeKeywords).toBe(false);
      expect(graph.concepts.some(concept => concept.id === 'contact-discovery')).toBe(true);
      expect(graph.concepts.some(concept => concept.id === 'lead-scout')).toBe(true);
      expect(graph.concepts.some(concept => concept.id === 'broad')).toBe(false);
      expect(graph.concepts.some(concept => concept.sources.includes('keyword'))).toBe(false);
    });

    it('should render an Obsidian-style vault file set', () => {
      const tracker = getLessonsTracker(tmpDir);
      const item = tracker.add(
        'PATTERN',
        'Use [[contact-discovery]] before broad scraping. tags: lead-scout',
        'manual',
      );

      const graph = tracker.buildConceptGraph({ includeKeywords: false });
      const files = renderLessonConceptVaultFiles(graph);
      const index = files.find(file => file.path === 'index.md');
      const conceptIndex = files.find(file => file.path === '_concepts.md');
      const lessonIndex = files.find(file => file.path === '_lessons.md');
      const concept = files.find(file => file.path === 'concepts/contact-discovery.md');
      const lesson = files.find(file => file.path === `lessons/${item.id}.md`);

      expect(index?.content).toContain('type: "lessons-vault-index"');
      expect(index?.content).toContain('[[_concepts|Concept index]]');
      expect(index?.content).toContain('[[_lessons|Lesson index]]');
      expect(index?.content).toContain('[[concepts/contact-discovery|contact-discovery]]');
      expect(conceptIndex?.content).toContain('type: "lessons-vault-concepts-index"');
      expect(conceptIndex?.content).toContain('[[concepts/contact-discovery|contact-discovery]]');
      expect(lessonIndex?.content).toContain('type: "lessons-vault-lessons-index"');
      expect(lessonIndex?.content).toContain(`[[lessons/${item.id}|PATTERN: Use contact-discovery`);
      expect(concept?.content).toContain('type: "lesson-concept"');
      expect(concept?.content).toContain(`  - "${item.id}"`);
      expect(concept?.content).toContain(`[[lessons/${item.id}|PATTERN: Use contact-discovery`);
      expect(lesson?.content).toContain('type: "lesson"');
      expect(lesson?.content).toContain('concepts:');
      expect(lesson?.content).toContain('  - "contact-discovery"');
      expect(lesson?.content).toContain('[[concepts/contact-discovery|contact-discovery]]');
      expect(files.some(file => file.path === 'graph.json')).toBe(true);
      expect(files.some(file => file.path === 'graph.mmd')).toBe(true);
      const manifest = files.find(file => file.path === 'manifest.json');
      expect(manifest).toBeDefined();
      const parsedManifest = JSON.parse(manifest!.content);
      expect(parsedManifest.vaultSchemaVersion).toBe(1);
      expect(parsedManifest.entrypoints.conceptsIndex).toBe('_concepts.md');
      expect(parsedManifest.counts.files).toBe(files.length);
      expect(parsedManifest.concepts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'contact-discovery',
          path: 'concepts/contact-discovery.md',
          lessonIds: [item.id],
        }),
      ]));
      expect(parsedManifest.lessons).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: item.id,
          path: `lessons/${item.id}.md`,
          conceptIds: expect.arrayContaining(['contact-discovery', 'lead-scout']),
        }),
      ]));
      expect(parsedManifest.files).toContain('manifest.json');
    });

    it('should understand Obsidian aliases and Markdown links as graph concepts', () => {
      const tracker = getLessonsTracker(tmpDir);
      const item = tracker.add(
        'PATTERN',
        'Use [[concepts/contact-discovery.md|contact page discovery]] with [sandbox scripts](concepts/sandbox-scripts.md).',
        'manual',
      );

      const graph = tracker.buildConceptGraph();
      const contactDiscovery = graph.concepts.find(concept => concept.id === 'contact-discovery');
      const sandboxScripts = graph.concepts.find(concept => concept.id === 'sandbox-scripts');

      expect(contactDiscovery?.label).toBe('contact page discovery');
      expect(contactDiscovery?.sources).toContain('wiki_link');
      expect(sandboxScripts?.label).toBe('sandbox scripts');
      expect(sandboxScripts?.sources).toContain('markdown_link');
      expect(graph.backlinks['sandbox-scripts']).toEqual([item.id]);
    });
  });

  // --------------------------------------------------------------------------
  // remove()
  // --------------------------------------------------------------------------

  describe('remove()', () => {
    it('should remove an item by id and return true', () => {
      const tracker = getLessonsTracker(tmpDir);
      const item = tracker.add('INSIGHT', 'removable insight', 'manual');
      expect(tracker.remove(item.id)).toBe(true);
      expect(tracker.search('removable insight')).toHaveLength(0);
    });

    it('should return false for a non-existent id', () => {
      const tracker = getLessonsTracker(tmpDir);
      expect(tracker.remove('nonexistent-id-xyz')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // clearByCategory()
  // --------------------------------------------------------------------------

  describe('clearByCategory()', () => {
    it('should clear only the specified category and return the count removed', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('RULE', 'rule 1', 'manual');
      tracker.add('RULE', 'rule 2', 'manual');
      tracker.add('PATTERN', 'pattern stays', 'manual');
      const count = tracker.clearByCategory('RULE');
      expect(count).toBe(2);
      expect(tracker.list('RULE')).toHaveLength(0);
      expect(tracker.list('PATTERN').some(i => i.content === 'pattern stays')).toBe(true);
    });

    it('should clear all items when called without category', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('RULE', 'rule 1', 'manual');
      tracker.add('PATTERN', 'pattern 1', 'manual');
      const beforeCount = tracker.list().length;
      const count = tracker.clearByCategory();
      expect(count).toBe(beforeCount);
      expect(tracker.list()).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // buildContextBlock()
  // --------------------------------------------------------------------------

  describe('buildContextBlock()', () => {
    it('should return null when there are no lessons', () => {
      const tracker = getLessonsTracker(tmpDir);
      // ensure clean state
      tracker.clearByCategory();
      expect(tracker.buildContextBlock()).toBeNull();
    });

    it('should return a <lessons_context> block when lessons exist', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('RULE', 'run tests before done', 'manual');
      tracker.add('PATTERN', 'wrong → correct approach', 'manual');
      const block = tracker.buildContextBlock();
      expect(block).not.toBeNull();
      expect(block).toContain('<lessons_context>');
      expect(block).toContain('</lessons_context>');
      expect(block).toContain('[RULE]');
      expect(block).toContain('[PATTERN]');
    });

    it('should order categories as RULE before PATTERN before CONTEXT before INSIGHT', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('INSIGHT', 'insight item', 'manual');
      tracker.add('RULE', 'rule item', 'manual');
      tracker.add('CONTEXT', 'context item', 'manual');
      const block = tracker.buildContextBlock()!;
      const ruleIdx = block.indexOf('[RULE]');
      const insightIdx = block.indexOf('[INSIGHT]');
      const contextIdx = block.indexOf('[CONTEXT]');
      expect(ruleIdx).toBeLessThan(contextIdx);
      expect(contextIdx).toBeLessThan(insightIdx);
    });

    it('should include context annotation when item has context', () => {
      const tracker = getLessonsTracker(tmpDir);
      tracker.add('CONTEXT', 'uses ESM imports', 'manual', 'Node.js');
      const block = tracker.buildContextBlock()!;
      expect(block).toContain('Node.js');
    });
  });

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  describe('persistence', () => {
    it('should persist lessons to disk and reload on a new instance', async () => {
      const persistDir = path.join(tmpDir, 'persist-test');
      fs.mkdirSync(persistDir, { recursive: true });

      const tracker1 = new LessonsTracker(persistDir);
      tracker1.add('CONTEXT', 'persist this lesson across sessions', 'manual');
      // save() is now async (F33 serializes writes through an internal
      // queue) — await it so the file has been flushed before the
      // second tracker reads it.
      await tracker1.save();

      // New instance reads from disk
      const tracker2 = new LessonsTracker(persistDir);
      const items = tracker2.list();
      expect(items.some(i => i.content === 'persist this lesson across sessions')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Markdown parsing
  // --------------------------------------------------------------------------

  describe('parseMd()', () => {
    it('should parse items with <!-- date source:context --> comment format', async () => {
      const parseDir = path.join(tmpDir, 'parse-test');
      const cbDir = path.join(parseDir, '.codebuddy');
      await fs.mkdirp(cbDir);

      const md = [
        '# Lessons Learned',
        '',
        '## PATTERN',
        '- [abc123] use tsc <!-- 2024-01-01 manual:TypeScript -->',
        '',
        '## RULE',
        '- [def456] always run tests <!-- 2024-01-02 user_correction -->',
        '',
      ].join('\n');

      await fs.writeFile(path.join(cbDir, 'lessons.md'), md, 'utf-8');

      const tracker = new LessonsTracker(parseDir);
      const items = tracker.list();
      expect(items).toHaveLength(2);

      const pattern = items.find(i => i.id === 'abc123');
      expect(pattern).toBeDefined();
      expect(pattern!.category).toBe('PATTERN');
      expect(pattern!.content).toBe('use tsc');
      expect(pattern!.context).toBe('TypeScript');
      expect(pattern!.source).toBe('manual');

      const rule = items.find(i => i.id === 'def456');
      expect(rule).toBeDefined();
      expect(rule!.category).toBe('RULE');
      expect(rule!.source).toBe('user_correction');
      expect(rule!.context).toBeUndefined();
    });

    it('round-trips add → list → search → remove with a hyphenated context (stable id and date)', async () => {
      const tracker = new LessonsTracker(tmpDir);
      const added = tracker.add(
        'INSIGHT',
        'AUDIT-E1 leçon réelle: toujours exiger un artefact daté pour un PASS.',
        'manual',
        'audit-execution',
      );
      await tracker.save();

      const fresh = new LessonsTracker(tmpDir);
      const listed = fresh.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]!.id).toBe(added.id);
      expect(listed[0]!.content).toBe(added.content);
      expect(listed[0]!.context).toBe('audit-execution');
      expect(listed[0]!.source).toBe('manual');
      expect(listed[0]!.createdAt).toBeGreaterThan(0);
      expect(new Date(listed[0]!.createdAt).toISOString().slice(0, 10)).not.toBe('1970-01-01');

      const found = fresh.search('AUDIT-E1');
      expect(found).toHaveLength(1);
      expect(found[0]!.id).toBe(added.id);

      const removed = await fresh.removeWithReport(added.id);
      expect(removed.removed).toBe(true);
      expect(new LessonsTracker(tmpDir).search('AUDIT-E1')).toHaveLength(0);
    });
  });
});
