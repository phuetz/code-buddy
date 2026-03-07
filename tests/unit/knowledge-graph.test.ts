/**
 * Knowledge Graph Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeGraph, getKnowledgeGraph } from '../../src/knowledge/knowledge-graph.js';

describe('KnowledgeGraph', () => {
  beforeEach(() => {
    KnowledgeGraph.resetInstance();
  });

  describe('singleton', () => {
    it('returns same instance', () => {
      expect(getKnowledgeGraph()).toBe(getKnowledgeGraph());
    });

    it('resetInstance creates new instance', () => {
      const a = getKnowledgeGraph();
      KnowledgeGraph.resetInstance();
      const b = getKnowledgeGraph();
      expect(a).not.toBe(b);
    });
  });

  describe('add / has', () => {
    it('adds and checks triples', () => {
      const kg = getKnowledgeGraph();
      kg.add('moduleA', 'imports', 'moduleB');
      expect(kg.has('moduleA', 'imports', 'moduleB')).toBe(true);
      expect(kg.has('moduleA', 'imports', 'moduleC')).toBe(false);
    });

    it('deduplicates triples', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'calls', 'B');
      kg.add('A', 'calls', 'B');
      expect(kg.getStats().tripleCount).toBe(1);
    });

    it('stores metadata', () => {
      const kg = getKnowledgeGraph();
      kg.add('func', 'definedIn', 'file.ts', { line: '42' });
      const results = kg.query({ subject: 'func' });
      expect(results[0].metadata).toEqual({ line: '42' });
    });
  });

  describe('addBatch', () => {
    it('adds multiple triples', () => {
      const kg = getKnowledgeGraph();
      const added = kg.addBatch([
        { subject: 'A', predicate: 'imports', object: 'B' },
        { subject: 'B', predicate: 'imports', object: 'C' },
        { subject: 'A', predicate: 'imports', object: 'B' }, // duplicate
      ]);
      expect(added).toBe(2);
      expect(kg.getStats().tripleCount).toBe(2);
    });
  });

  describe('query', () => {
    it('queries by subject', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'imports', 'B');
      kg.add('A', 'calls', 'C');
      kg.add('B', 'imports', 'D');

      const results = kg.query({ subject: 'A' });
      expect(results).toHaveLength(2);
    });

    it('queries by predicate', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'imports', 'B');
      kg.add('A', 'calls', 'C');
      kg.add('B', 'imports', 'D');

      const results = kg.query({ predicate: 'imports' });
      expect(results).toHaveLength(2);
    });

    it('queries by object', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'imports', 'B');
      kg.add('C', 'calls', 'B');

      const results = kg.query({ object: 'B' });
      expect(results).toHaveLength(2);
    });

    it('queries by combined pattern', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'imports', 'B');
      kg.add('A', 'calls', 'B');
      kg.add('C', 'imports', 'B');

      const results = kg.query({ subject: 'A', predicate: 'imports' });
      expect(results).toHaveLength(1);
      expect(results[0].object).toBe('B');
    });

    it('queries with regex subject', () => {
      const kg = getKnowledgeGraph();
      kg.add('src/utils/helper.ts', 'exports', 'formatDate');
      kg.add('src/utils/logger.ts', 'exports', 'logger');
      kg.add('src/agent/core.ts', 'exports', 'Agent');

      const results = kg.query({ subject: /utils/ });
      expect(results).toHaveLength(2);
    });

    it('queries with regex object', () => {
      const kg = getKnowledgeGraph();
      kg.add('ClassA', 'extends', 'BaseClass');
      kg.add('ClassB', 'extends', 'AbstractBase');
      kg.add('ClassC', 'extends', 'BaseClass');

      const results = kg.query({ object: /Base/ });
      expect(results).toHaveLength(3);
    });

    it('returns empty for no match', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'imports', 'B');
      expect(kg.query({ subject: 'Z' })).toHaveLength(0);
    });
  });

  describe('neighbors', () => {
    it('returns all connected triples', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'imports', 'B');
      kg.add('C', 'calls', 'A');
      kg.add('B', 'exports', 'D');

      const results = kg.neighbors('A');
      expect(results).toHaveLength(2); // A imports B, C calls A
    });
  });

  describe('subgraph', () => {
    it('returns connected subgraph at depth 1', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'imports', 'B');
      kg.add('B', 'imports', 'C');
      kg.add('C', 'imports', 'D');

      const sg = kg.subgraph('A', 1);
      expect(sg.entities.has('A')).toBe(true);
      expect(sg.entities.has('B')).toBe(true);
      expect(sg.entities.has('C')).toBe(false);
    });

    it('returns connected subgraph at depth 2', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'imports', 'B');
      kg.add('B', 'imports', 'C');
      kg.add('C', 'imports', 'D');

      const sg = kg.subgraph('A', 2);
      expect(sg.entities.has('C')).toBe(true);
      expect(sg.entities.has('D')).toBe(false);
    });
  });

  describe('findPath', () => {
    it('finds direct path', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'imports', 'B');

      const paths = kg.findPath('A', 'B');
      expect(paths).toHaveLength(1);
      expect(paths[0]).toHaveLength(1);
    });

    it('finds indirect path', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'imports', 'B');
      kg.add('B', 'imports', 'C');

      const paths = kg.findPath('A', 'C');
      expect(paths.length).toBeGreaterThanOrEqual(1);
      expect(paths[0]).toHaveLength(2);
    });

    it('returns empty for no path', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'imports', 'B');
      kg.add('C', 'imports', 'D');

      const paths = kg.findPath('A', 'D');
      expect(paths).toHaveLength(0);
    });

    it('returns empty path for same entity', () => {
      const kg = getKnowledgeGraph();
      const paths = kg.findPath('A', 'A');
      expect(paths).toHaveLength(1);
      expect(paths[0]).toHaveLength(0);
    });
  });

  describe('remove', () => {
    it('removes matching triples', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'imports', 'B');
      kg.add('A', 'calls', 'C');
      kg.add('B', 'imports', 'D');

      const removed = kg.remove({ subject: 'A', predicate: 'imports' });
      expect(removed).toBe(1);
      expect(kg.getStats().tripleCount).toBe(2);
      expect(kg.has('A', 'imports', 'B')).toBe(false);
      expect(kg.has('A', 'calls', 'C')).toBe(true);
    });

    it('returns 0 for no match', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'imports', 'B');
      expect(kg.remove({ subject: 'Z' })).toBe(0);
    });
  });

  describe('serialization', () => {
    it('toJSON / loadJSON round-trips', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'imports', 'B', { file: 'test.ts' });
      kg.add('B', 'extends', 'C');

      const json = kg.toJSON();
      expect(json).toHaveLength(2);

      KnowledgeGraph.resetInstance();
      const kg2 = getKnowledgeGraph();
      kg2.loadJSON(json);
      expect(kg2.getStats().tripleCount).toBe(2);
      expect(kg2.has('A', 'imports', 'B')).toBe(true);
    });
  });

  describe('formatForContext', () => {
    it('returns empty for unknown entity', () => {
      expect(getKnowledgeGraph().formatForContext('unknown')).toBe('');
    });

    it('returns formatted context block', () => {
      const kg = getKnowledgeGraph();
      kg.add('MyClass', 'extends', 'BaseClass');
      kg.add('MyClass', 'definedIn', 'src/my-class.ts');

      const ctx = kg.formatForContext('MyClass');
      expect(ctx).toContain('<context type="knowledge">');
      expect(ctx).toContain('MyClass --extends--> BaseClass');
      expect(ctx).toContain('MyClass --definedIn--> src/my-class.ts');
      expect(ctx).toContain('</context>');
    });
  });

  describe('clear', () => {
    it('removes all triples', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'imports', 'B');
      kg.add('B', 'imports', 'C');
      kg.clear();
      expect(kg.getStats().tripleCount).toBe(0);
    });
  });

  describe('getStats', () => {
    it('returns accurate statistics', () => {
      const kg = getKnowledgeGraph();
      kg.add('A', 'imports', 'B');
      kg.add('A', 'calls', 'C');
      kg.add('B', 'imports', 'D');

      const stats = kg.getStats();
      expect(stats.tripleCount).toBe(3);
      expect(stats.subjectCount).toBe(2); // A, B
      expect(stats.predicateCount).toBe(2); // imports, calls
      expect(stats.objectCount).toBe(3); // B, C, D
    });
  });
});
