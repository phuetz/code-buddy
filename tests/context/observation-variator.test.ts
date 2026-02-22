/**
 * Tests for ObservationVariator — Manus AI anti-repetition pattern
 *
 * Pure logic tests — no filesystem or network mocking needed.
 */

import {
  ObservationVariator,
  getObservationVariator,
  resetObservationVariator,
} from '../../src/context/observation-variator';

describe('ObservationVariator', () => {
  let variator: ObservationVariator;

  beforeEach(() => {
    resetObservationVariator();
    variator = new ObservationVariator();
  });

  // --------------------------------------------------------------------------
  // wrapToolResult()
  // --------------------------------------------------------------------------

  describe('wrapToolResult()', () => {
    it('should use template 0 at turn 0: "Result from <name>:"', () => {
      const result = variator.wrapToolResult('bash', 'output');
      expect(result).toBe('Result from bash:\noutput');
    });

    it('should use template 1 at turn 1: "Output of <name>:" with --- delimiters', () => {
      variator.nextTurn();
      const result = variator.wrapToolResult('grep', 'matches');
      expect(result).toBe('Output of grep:\n---\nmatches\n---');
    });

    it('should use template 2 at turn 2: "[<name>] returned:"', () => {
      variator.nextTurn();
      variator.nextTurn();
      const result = variator.wrapToolResult('read', 'file content');
      expect(result).toBe('[read] returned:\nfile content');
    });

    it('should cycle back to template 0 at turn 3', () => {
      variator.nextTurn();
      variator.nextTurn();
      variator.nextTurn();
      const result = variator.wrapToolResult('write', 'done');
      expect(result).toBe('Result from write:\ndone');
    });
  });

  // --------------------------------------------------------------------------
  // wrapMemoryBlock()
  // --------------------------------------------------------------------------

  describe('wrapMemoryBlock()', () => {
    it('should use phrasing 0 at turn 0: "Relevant memory context:"', () => {
      expect(variator.wrapMemoryBlock('facts')).toBe('Relevant memory context:\nfacts');
    });

    it('should use phrasing 1 at turn 1: "From memory:"', () => {
      variator.nextTurn();
      expect(variator.wrapMemoryBlock('data')).toBe('From memory:\ndata');
    });

    it('should use phrasing 2 at turn 2: "Recalled context:"', () => {
      variator.nextTurn();
      variator.nextTurn();
      expect(variator.wrapMemoryBlock('info')).toBe('Recalled context:\ninfo');
    });

    it('should cycle back to phrasing 0 at turn 3', () => {
      variator.nextTurn();
      variator.nextTurn();
      variator.nextTurn();
      expect(variator.wrapMemoryBlock('again')).toBe('Relevant memory context:\nagain');
    });
  });

  // --------------------------------------------------------------------------
  // nextTurn()
  // --------------------------------------------------------------------------

  describe('nextTurn()', () => {
    it('should change template selection after call', () => {
      const before = variator.wrapToolResult('test', 'x');
      variator.nextTurn();
      const after = variator.wrapToolResult('test', 'x');
      expect(before).not.toBe(after);
    });
  });

  // --------------------------------------------------------------------------
  // reset()
  // --------------------------------------------------------------------------

  describe('reset()', () => {
    it('should reset to turn 0', () => {
      variator.nextTurn();
      variator.nextTurn();
      variator.reset();
      const result = variator.wrapToolResult('bash', 'out');
      expect(result).toBe('Result from bash:\nout');
    });

    it('should produce same output as initial state after reset', () => {
      const initial = variator.wrapMemoryBlock('content');
      variator.nextTurn();
      variator.nextTurn();
      variator.reset();
      expect(variator.wrapMemoryBlock('content')).toBe(initial);
    });
  });

  // --------------------------------------------------------------------------
  // Template diversity
  // --------------------------------------------------------------------------

  describe('template diversity', () => {
    it('should produce 3 distinct templates over 3 consecutive turns', () => {
      const results = new Set<string>();
      for (let i = 0; i < 3; i++) {
        results.add(variator.wrapToolResult('tool', 'content'));
        variator.nextTurn();
      }
      expect(results.size).toBe(3);
    });

    it('should produce 3 distinct memory phrasings over 3 consecutive turns', () => {
      const results = new Set<string>();
      for (let i = 0; i < 3; i++) {
        results.add(variator.wrapMemoryBlock('content'));
        variator.nextTurn();
      }
      expect(results.size).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // Singleton
  // --------------------------------------------------------------------------

  describe('singleton', () => {
    it('should return same instance from getObservationVariator()', () => {
      const a = getObservationVariator();
      const b = getObservationVariator();
      expect(a).toBe(b);
    });

    it('should create fresh instance after resetObservationVariator()', () => {
      const a = getObservationVariator();
      a.nextTurn();
      a.nextTurn();
      resetObservationVariator();
      const b = getObservationVariator();
      expect(b).not.toBe(a);
      // Fresh instance should be at turn 0
      expect(b.wrapToolResult('test', 'x')).toBe('Result from test:\nx');
    });
  });
});
