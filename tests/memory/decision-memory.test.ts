import {
  DecisionMemory,
  getDecisionMemory,
  resetDecisionMemory,
} from '../../src/memory/decision-memory';

// Mock EnhancedMemory
const mockStore = jest.fn().mockResolvedValue({ id: 'mock-id' });
const mockRecall = jest.fn().mockResolvedValue([]);

jest.mock('../../src/memory/enhanced-memory', () => ({
  getEnhancedMemory: () => ({
    store: mockStore,
    recall: mockRecall,
  }),
}));

describe('DecisionMemory', () => {
  let dm: DecisionMemory;

  beforeEach(() => {
    resetDecisionMemory();
    dm = new DecisionMemory();
    mockStore.mockClear();
    mockRecall.mockClear();
  });

  // ==========================================================================
  // extractDecisions
  // ==========================================================================

  describe('extractDecisions', () => {
    it('extracts a well-formed decision block', () => {
      const input = `
Some preamble text.

<decision>
  <choice>Use PostgreSQL</choice>
  <alternatives>MySQL, SQLite</alternatives>
  <rationale>Better JSON support</rationale>
  <context>Database selection</context>
  <confidence>0.85</confidence>
  <tags>database, backend</tags>
</decision>

Some epilogue.`;

      const result = dm.extractDecisions(input);
      expect(result.decisions).toHaveLength(1);
      expect(result.rawText).toBe(input);

      const d = result.decisions[0];
      expect(d.choice).toBe('Use PostgreSQL');
      expect(d.alternatives).toEqual(['MySQL', 'SQLite']);
      expect(d.rationale).toBe('Better JSON support');
      expect(d.context).toBe('Database selection');
      expect(d.confidence).toBe(0.85);
      expect(d.tags).toEqual(['database', 'backend']);
      expect(d.id).toBeTruthy();
      expect(d.timestamp).toBeInstanceOf(Date);
    });

    it('extracts multiple decision blocks', () => {
      const input = `
<decision>
  <choice>React</choice>
  <alternatives>Vue, Svelte</alternatives>
  <rationale>Team familiarity</rationale>
  <context>Frontend framework</context>
  <confidence>0.9</confidence>
  <tags>frontend</tags>
</decision>

<decision>
  <choice>TypeScript</choice>
  <alternatives>JavaScript, Flow</alternatives>
  <rationale>Type safety</rationale>
  <context>Language choice</context>
  <confidence>0.95</confidence>
  <tags>language</tags>
</decision>`;

      const result = dm.extractDecisions(input);
      expect(result.decisions).toHaveLength(2);
      expect(result.decisions[0].choice).toBe('React');
      expect(result.decisions[1].choice).toBe('TypeScript');
    });

    it('skips blocks with missing choice tag', () => {
      const input = `
<decision>
  <alternatives>A, B</alternatives>
  <rationale>Because</rationale>
</decision>`;

      const result = dm.extractDecisions(input);
      expect(result.decisions).toHaveLength(0);
    });

    it('handles missing optional tags gracefully', () => {
      const input = `
<decision>
  <choice>Go with option A</choice>
</decision>`;

      const result = dm.extractDecisions(input);
      expect(result.decisions).toHaveLength(1);

      const d = result.decisions[0];
      expect(d.choice).toBe('Go with option A');
      expect(d.alternatives).toEqual([]);
      expect(d.rationale).toBe('');
      expect(d.context).toBe('');
      expect(d.confidence).toBe(0.5);
      expect(d.tags).toEqual([]);
    });

    it('clamps confidence to 0-1 range', () => {
      const overInput = `
<decision>
  <choice>X</choice>
  <confidence>5.0</confidence>
</decision>`;
      expect(dm.extractDecisions(overInput).decisions[0].confidence).toBe(1);

      const underInput = `
<decision>
  <choice>Y</choice>
  <confidence>-2</confidence>
</decision>`;
      expect(dm.extractDecisions(underInput).decisions[0].confidence).toBe(0);
    });

    it('returns empty decisions for empty input', () => {
      const result = dm.extractDecisions('');
      expect(result.decisions).toEqual([]);
      expect(result.rawText).toBe('');
    });

    it('returns empty decisions when no decision blocks exist', () => {
      const result = dm.extractDecisions('Just some regular text without any XML blocks.');
      expect(result.decisions).toEqual([]);
    });

    it('handles malformed XML (unclosed tags)', () => {
      const input = `
<decision>
  <choice>Broken
</decision>`;

      // The choice tag is never closed, so extractTag returns ''
      const result = dm.extractDecisions(input);
      expect(result.decisions).toHaveLength(0);
    });
  });

  // ==========================================================================
  // persistDecisions
  // ==========================================================================

  describe('persistDecisions', () => {
    it('stores each decision via EnhancedMemory', async () => {
      const decisions = dm.extractDecisions(`
<decision>
  <choice>Redis</choice>
  <alternatives>Memcached</alternatives>
  <rationale>Richer data structures</rationale>
  <context>Caching layer</context>
  <confidence>0.8</confidence>
  <tags>cache, infra</tags>
</decision>`).decisions;

      await dm.persistDecisions(decisions);

      expect(mockStore).toHaveBeenCalledTimes(1);
      const call = mockStore.mock.calls[0][0];
      expect(call.type).toBe('decision');
      expect(call.tags).toContain('decision');
      expect(call.tags).toContain('cache');
      expect(call.tags).toContain('infra');
      expect(call.content).toContain('Redis');
      expect(call.metadata.source).toBe('decision-memory');
    });

    it('does nothing for empty decisions array', async () => {
      await dm.persistDecisions([]);
      expect(mockStore).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // findRelevantDecisions
  // ==========================================================================

  describe('findRelevantDecisions', () => {
    it('returns mapped decisions from EnhancedMemory recall', async () => {
      mockRecall.mockResolvedValueOnce([
        {
          id: 'mem-1',
          type: 'decision',
          content: 'Decision: Use PostgreSQL\nRationale: JSON support\nContext: DB layer',
          tags: ['decision', 'database'],
          metadata: {
            decisionId: 'dec-1',
            choice: 'Use PostgreSQL',
            alternatives: ['MySQL'],
            confidence: 0.9,
          },
          createdAt: new Date('2025-01-01'),
          importance: 0.9,
          accessCount: 1,
          updatedAt: new Date(),
          lastAccessedAt: new Date(),
        },
      ]);

      const results = await dm.findRelevantDecisions('database');
      expect(results).toHaveLength(1);
      expect(results[0].choice).toBe('Use PostgreSQL');
      expect(results[0].alternatives).toEqual(['MySQL']);
      expect(results[0].confidence).toBe(0.9);
      expect(mockRecall).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'database',
          types: ['decision'],
          tags: ['decision'],
          limit: 5,
        })
      );
    });

    it('returns empty array when no decisions found', async () => {
      mockRecall.mockResolvedValueOnce([]);
      const results = await dm.findRelevantDecisions('nonexistent');
      expect(results).toEqual([]);
    });
  });

  // ==========================================================================
  // buildDecisionContext
  // ==========================================================================

  describe('buildDecisionContext', () => {
    it('returns null when no decisions are found', async () => {
      mockRecall.mockResolvedValueOnce([]);
      const result = await dm.buildDecisionContext('anything');
      expect(result).toBeNull();
    });

    it('returns formatted XML block when decisions exist', async () => {
      mockRecall.mockResolvedValueOnce([
        {
          id: 'mem-1',
          type: 'decision',
          content: 'Decision: Use REST\nRationale: Simplicity\nContext: API design',
          tags: ['decision', 'api'],
          metadata: {
            decisionId: 'dec-1',
            choice: 'Use REST',
            alternatives: ['GraphQL', 'gRPC'],
            confidence: 0.8,
          },
          createdAt: new Date(),
          importance: 0.9,
          accessCount: 1,
          updatedAt: new Date(),
          lastAccessedAt: new Date(),
        },
      ]);

      const result = await dm.buildDecisionContext('api design');
      expect(result).not.toBeNull();
      expect(result).toContain('<decisions_context>');
      expect(result).toContain('</decisions_context>');
      expect(result).toContain('Use REST');
      expect(result).toContain('Simplicity');
      expect(result).toContain('GraphQL, gRPC');
    });
  });

  // ==========================================================================
  // getDecisionPromptEnhancement
  // ==========================================================================

  describe('getDecisionPromptEnhancement', () => {
    it('returns a non-empty instruction string', () => {
      const enhancement = dm.getDecisionPromptEnhancement();
      expect(typeof enhancement).toBe('string');
      expect(enhancement.length).toBeGreaterThan(50);
    });

    it('includes XML structure guidance', () => {
      const enhancement = dm.getDecisionPromptEnhancement();
      expect(enhancement).toContain('<decision>');
      expect(enhancement).toContain('<choice>');
      expect(enhancement).toContain('<alternatives>');
      expect(enhancement).toContain('<rationale>');
      expect(enhancement).toContain('<confidence>');
      expect(enhancement).toContain('<tags>');
    });
  });

  // ==========================================================================
  // Singleton
  // ==========================================================================

  describe('singleton management', () => {
    it('getDecisionMemory returns same instance', () => {
      const a = getDecisionMemory();
      const b = getDecisionMemory();
      expect(a).toBe(b);
    });

    it('resetDecisionMemory clears the instance', () => {
      const a = getDecisionMemory();
      resetDecisionMemory();
      const b = getDecisionMemory();
      expect(a).not.toBe(b);
    });
  });
});
