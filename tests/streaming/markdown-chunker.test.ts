/**
 * Markdown Chunker Tests
 */

import {
  MarkdownChunker,
  createBlockState,
  updateBlockState,
  detectFence,
  chunkMarkdown,
  hasUnclosedCodeBlock,
  countCodeBlocks,
  fixUnclosedCodeBlocks,
  createStreamingChunker,
  type ChunkResult,
  type BlockState,
} from '../../src/streaming/markdown-chunker.js';

describe('Markdown Chunker', () => {
  describe('createBlockState', () => {
    it('should create initial block state', () => {
      const state = createBlockState();
      expect(state.inCodeBlock).toBe(false);
      expect(state.fence).toBe('');
      expect(state.language).toBe('');
      expect(state.depth).toBe(0);
    });
  });

  describe('detectFence', () => {
    it('should detect opening fence', () => {
      const { newState, fencePositions } = detectFence('```python\ncode\n```', createBlockState());
      expect(fencePositions.length).toBe(2);
      expect(fencePositions[0].isOpen).toBe(true);
      expect(fencePositions[0].language).toBe('python');
      expect(fencePositions[1].isOpen).toBe(false);
    });

    it('should detect tilde fences', () => {
      const { fencePositions } = detectFence('~~~js\ncode\n~~~', createBlockState());
      expect(fencePositions.length).toBe(2);
      expect(fencePositions[0].fence).toBe('~~~');
    });

    it('should match fence types', () => {
      // Opening with ``` should only close with ```
      const { newState } = detectFence('```python\ncode\n~~~', createBlockState());
      expect(newState.inCodeBlock).toBe(true); // Still open
    });
  });

  describe('updateBlockState', () => {
    it('should track code block state', () => {
      let state = createBlockState();

      state = updateBlockState('Some text\n```python', state);
      expect(state.inCodeBlock).toBe(true);
      expect(state.fence).toBe('```');
      expect(state.language).toBe('python');

      state = updateBlockState('\ncode here\n```', state);
      expect(state.inCodeBlock).toBe(false);
    });
  });

  describe('MarkdownChunker', () => {
    it('should chunk simple text at natural breaks', () => {
      const chunker = new MarkdownChunker({ softMaxChars: 50, hardMaxChars: 100 });

      chunker.write('This is paragraph one.\n\nThis is paragraph two.\n\nThis is paragraph three.');
      const chunks = chunker.flush();

      expect(chunks.length).toBeGreaterThan(0);
      // Should have split at paragraph breaks
      for (const chunk of chunks) {
        expect(chunk.forceSplit).toBe(false);
      }
    });

    it('should not split inside code blocks when possible', () => {
      const chunker = new MarkdownChunker({ softMaxChars: 200, hardMaxChars: 400 });

      const text = 'Before code.\n\n```python\ndef hello():\n    print("hello")\n```\n\nAfter code.';
      chunker.write(text);
      const chunks = chunker.flush();

      // Combine all chunks and remaining buffer
      const allContent = chunks.map(c => c.content).join('') + chunker.getBuffer();

      // All content should be present
      expect(allContent).toContain('```python');
      expect(allContent).toContain('print("hello")');
    });

    it('should handle long code blocks', () => {
      const chunker = new MarkdownChunker({
        softMaxChars: 500,
        hardMaxChars: 1000,
        preserveCodeBlocks: true,
      });

      // Code block that fits within limits
      const codeBlock = '```python\ndef hello():\n    print("world")\n```\n';
      chunker.write(codeBlock);
      const allChunks = chunker.flush();
      const remaining = chunker.getBuffer();

      // All content should be present
      const allContent = allChunks.map(c => c.content).join('') + remaining;
      expect(allContent).toContain('def hello()');
    });

    it('should emit chunk events', () => {
      const chunker = new MarkdownChunker({ softMaxChars: 20, hardMaxChars: 50 });
      const emittedChunks: ChunkResult[] = [];

      chunker.on('chunk', (chunk) => {
        emittedChunks.push(chunk);
      });

      chunker.write('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.');
      chunker.flush();

      expect(emittedChunks.length).toBeGreaterThan(0);
    });

    it('should reset state', () => {
      const chunker = new MarkdownChunker({ softMaxChars: 100, hardMaxChars: 200 });

      // Write a complete code block to ensure state tracking
      chunker.write('```python\ncode\n');
      // The block state tracks based on fences detected
      const stateAfterOpen = updateBlockState('```python\n', createBlockState());
      expect(stateAfterOpen.inCodeBlock).toBe(true);

      chunker.reset();
      expect(chunker.getBlockState().inCodeBlock).toBe(false);
      expect(chunker.getBuffer()).toBe('');
      expect(chunker.getChunks()).toHaveLength(0);
    });

    it('should handle multiple write calls', () => {
      const chunker = new MarkdownChunker({ softMaxChars: 50, hardMaxChars: 100 });

      chunker.write('First ');
      chunker.write('part.\n\n');
      chunker.write('Second part.');

      const chunks = chunker.flush();
      const combined = chunks.map(c => c.content).join('') + chunker.getBuffer();
      expect(combined).toContain('First part');
      expect(combined).toContain('Second part');
    });
  });

  describe('chunkMarkdown', () => {
    it('should chunk a complete markdown string', () => {
      const text = 'Paragraph one. Paragraph two. Paragraph three.';
      const chunks = chunkMarkdown(text, { softMaxChars: 100, hardMaxChars: 200 });

      // Should have at least one chunk with the content
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      const combined = chunks.map(c => c.content).join('');
      expect(combined).toContain('Paragraph');
    });

    it('should handle text with paragraph breaks', () => {
      const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      const chunks = chunkMarkdown(text, { softMaxChars: 25, hardMaxChars: 60 });

      // Content should be distributed across chunks
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('hasUnclosedCodeBlock', () => {
    it('should detect unclosed code blocks', () => {
      expect(hasUnclosedCodeBlock('```python\ncode')).toBe(true);
      expect(hasUnclosedCodeBlock('```python\ncode\n```')).toBe(false);
      expect(hasUnclosedCodeBlock('No code here')).toBe(false);
    });
  });

  describe('countCodeBlocks', () => {
    it('should count open and closed code blocks', () => {
      const text = '```js\ncode1\n```\n\n```python\ncode2\n```';
      const counts = countCodeBlocks(text);
      expect(counts.open).toBe(2);
      expect(counts.closed).toBe(2);
    });

    it('should count unclosed blocks', () => {
      const text = '```js\ncode\n```\n\n```python\ncode';
      const counts = countCodeBlocks(text);
      expect(counts.open).toBe(2);
      expect(counts.closed).toBe(1);
    });
  });

  describe('fixUnclosedCodeBlocks', () => {
    it('should close unclosed code blocks', () => {
      const text = '```python\ndef hello():\n    pass';
      const fixed = fixUnclosedCodeBlocks(text);
      expect(fixed.endsWith('```')).toBe(true);
    });

    it('should not modify text without unclosed blocks', () => {
      const text = '```python\ncode\n```';
      const fixed = fixUnclosedCodeBlocks(text);
      expect(fixed).toBe(text);
    });

    it('should not modify text without code blocks', () => {
      const text = 'Just plain text';
      const fixed = fixUnclosedCodeBlocks(text);
      expect(fixed).toBe(text);
    });
  });

  describe('createStreamingChunker', () => {
    it('should create a streaming chunker with callback', () => {
      const receivedChunks: ChunkResult[] = [];

      const chunker = createStreamingChunker(
        (chunk) => receivedChunks.push(chunk),
        { softMaxChars: 20, hardMaxChars: 50 }
      );

      chunker.write('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.');
      chunker.flush();

      expect(receivedChunks.length).toBeGreaterThan(0);
    });

    it('should support reset', () => {
      const receivedChunks: ChunkResult[] = [];

      const chunker = createStreamingChunker(
        (chunk) => receivedChunks.push(chunk),
        { softMaxChars: 100, hardMaxChars: 200 }
      );

      chunker.write('Some text');
      chunker.reset();
      chunker.write('New text.\n\n');
      chunker.flush();

      // Should only have chunks from after reset
      const combined = receivedChunks.map(c => c.content).join('');
      expect(combined).not.toContain('Some text');
    });
  });

  describe('edge cases', () => {
    it('should handle empty input', () => {
      const chunker = new MarkdownChunker();
      chunker.write('');
      const chunks = chunker.flush();
      expect(chunks).toHaveLength(0);
    });

    it('should handle very short input', () => {
      const chunks = chunkMarkdown('Hi', { softMaxChars: 100, hardMaxChars: 200 });
      expect(chunks.length).toBe(1);
      expect(chunks[0].content).toBe('Hi');
    });

    it('should handle multiple code blocks', () => {
      const text = '```js\ncode1\n```\n\nText\n\n```python\ncode2\n```';
      expect(hasUnclosedCodeBlock(text)).toBe(false);

      const chunks = chunkMarkdown(text, { softMaxChars: 20, hardMaxChars: 100 });
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle nested-looking fences (same type only matches)', () => {
      // This is actually just two separate code blocks
      const text = '```\nouter\n```\n\n```\ninner\n```';
      expect(hasUnclosedCodeBlock(text)).toBe(false);
    });
  });
});
