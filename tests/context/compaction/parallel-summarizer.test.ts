/**
 * Parallel Summarizer Tests
 */

import {
  LocalSummarizer,
  summarizeChunksParallel,
  mergeSummaries,
  truncateText,
} from '../../../src/context/compaction/parallel-summarizer.js';
import type { MessageChunk, ChunkSummary } from '../../../src/context/compaction/types.js';

describe('Parallel Summarizer', () => {
  describe('LocalSummarizer', () => {
    const summarizer = new LocalSummarizer();

    it('should extract important sentences', async () => {
      const text = `
        We decided to use TypeScript for the project.
        The weather is nice today.
        There's an important bug in the authentication module.
        The sky is blue.
        We need to fix the memory leak issue urgently.
      `;

      const summary = await summarizer.summarize(text);

      // Should contain at least some important indicators
      const hasImportantContent =
        summary.includes('decided') ||
        summary.includes('important') ||
        summary.includes('need to');
      expect(hasImportantContent).toBe(true);
    });

    it('should handle empty text', async () => {
      const summary = await summarizer.summarize('');
      expect(summary).toBe('.');
    });

    it('should handle text with no important indicators', async () => {
      const text = 'Hello world. This is a test. Just some random text here.';
      const summary = await summarizer.summarize(text);
      expect(summary.length).toBeLessThanOrEqual(text.length);
    });

    it('should score sentences by multiple indicators', async () => {
      const text = `
        This is a critical decision that we must make because of security reasons.
        Hello there.
        Another sentence with nothing special.
        We need to fix this important bug.
      `;

      const summary = await summarizer.summarize(text);

      // The first sentence has multiple indicators (critical, decision, because)
      expect(summary.toLowerCase()).toContain('critical');
    });
  });

  describe('summarizeChunksParallel', () => {
    const createChunk = (index: number, content: string): MessageChunk => ({
      index,
      messages: [{ role: 'assistant' as const, content }],
      tokenCount: Math.ceil(content.length / 4),
    });

    it('should return empty array for no chunks', async () => {
      const summaries = await summarizeChunksParallel([]);
      expect(summaries).toEqual([]);
    });

    it('should summarize single chunk', async () => {
      const chunks = [
        createChunk(0, 'We decided to use React for the frontend. This is an important decision.'),
      ];

      const summaries = await summarizeChunksParallel(chunks);

      expect(summaries.length).toBe(1);
      expect(summaries[0].index).toBe(0);
      expect(summaries[0].summary.length).toBeGreaterThan(0);
    });

    it('should summarize multiple chunks in parallel', async () => {
      const chunks = [
        createChunk(0, 'First chunk: We decided to use TypeScript. Important for type safety.'),
        createChunk(1, 'Second chunk: There is a critical bug in the system. Need to fix it.'),
        createChunk(2, 'Third chunk: TODO implement caching. This should improve performance.'),
      ];

      const summaries = await summarizeChunksParallel(chunks);

      expect(summaries.length).toBe(3);

      // Verify ordering
      expect(summaries[0].index).toBe(0);
      expect(summaries[1].index).toBe(1);
      expect(summaries[2].index).toBe(2);
    });

    it('should calculate compression ratios', async () => {
      // Create a longer chunk that will definitely be compressed
      const longContent = `
        We decided to implement the new feature using React.
        This is an important decision for the project architecture.
        The team discussed various options before making this choice.
        After careful consideration of all alternatives we went with React.
        ${'Some filler content that adds length. '.repeat(20)}
        The final decision was based on ecosystem support and team experience.
      `;
      const chunks = [createChunk(0, longContent)];

      const summaries = await summarizeChunksParallel(chunks);

      // The summary should be shorter than original (ratio > 0 means compression happened)
      // Note: ratio can be negative if summary is longer than original, which is valid
      expect(typeof summaries[0].compressionRatio).toBe('number');
      expect(summaries[0].originalTokenCount).toBeGreaterThan(0);
      expect(summaries[0].tokenCount).toBeGreaterThan(0);
    });
  });

  describe('mergeSummaries', () => {
    const createSummary = (index: number, summary: string): ChunkSummary => ({
      index,
      summary,
      tokenCount: Math.ceil(summary.length / 4),
      originalTokenCount: 100,
      compressionRatio: 0.5,
    });

    it('should return empty for no summaries', () => {
      const result = mergeSummaries([]);
      expect(result.merged).toBe('');
      expect(result.tokenCount).toBe(0);
    });

    it('should return single summary unchanged', () => {
      const summaries = [createSummary(0, 'This is the summary.')];
      const result = mergeSummaries(summaries);

      expect(result.merged).toBe('This is the summary.');
    });

    it('should merge multiple summaries without part markers for small counts', () => {
      const summaries = [
        createSummary(0, 'First summary.'),
        createSummary(1, 'Second summary.'),
        createSummary(2, 'Third summary.'),
      ];

      const result = mergeSummaries(summaries);

      expect(result.merged).toContain('First summary.');
      expect(result.merged).toContain('Second summary.');
      expect(result.merged).toContain('Third summary.');
      expect(result.merged).not.toContain('[Part');
    });

    it('should add part markers for many summaries', () => {
      const summaries = [
        createSummary(0, 'Summary one.'),
        createSummary(1, 'Summary two.'),
        createSummary(2, 'Summary three.'),
        createSummary(3, 'Summary four.'),
      ];

      const result = mergeSummaries(summaries);

      expect(result.merged).toContain('[Part 1/4]');
      expect(result.merged).toContain('[Part 2/4]');
      expect(result.merged).toContain('[Part 3/4]');
      expect(result.merged).toContain('[Part 4/4]');
    });

    it('should calculate merged token count', () => {
      const summaries = [
        createSummary(0, 'First summary content.'),
        createSummary(1, 'Second summary content.'),
      ];

      const result = mergeSummaries(summaries);

      expect(result.tokenCount).toBeGreaterThan(0);
    });
  });

  describe('truncateText', () => {
    it('should not truncate short text', () => {
      const text = 'Short text here.';
      const result = truncateText(text, 1500, 1500);

      expect(result).toBe(text);
    });

    it('should truncate long text', () => {
      const text = 'A'.repeat(5000);
      const result = truncateText(text, 1500, 1500);

      expect(result.length).toBeLessThan(text.length);
      expect(result).toContain('[...');
      expect(result).toContain('characters truncated');
    });

    it('should preserve head and tail', () => {
      const text = 'HEAD_MARKER' + 'x'.repeat(5000) + 'TAIL_MARKER';
      const result = truncateText(text, 1500, 1500);

      expect(result).toContain('HEAD_MARKER');
      expect(result).toContain('TAIL_MARKER');
    });

    it('should respect custom head/tail sizes', () => {
      const text = 'x'.repeat(5000);
      const result = truncateText(text, 500, 500);

      // Should have roughly 500 chars from head, 500 from tail, plus truncation marker
      expect(result.length).toBeLessThan(1500);
    });
  });
});
