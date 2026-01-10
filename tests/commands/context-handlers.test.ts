/**
 * Tests for Context Command Handlers
 */

import {
  handleAddContext,
  handleContext,
  handleWorkspace,
  CommandHandlerResult,
} from '../../src/commands/handlers/context-handlers.js';

describe('Context Handlers', () => {
  describe('handleAddContext', () => {
    it('should show usage when no pattern provided', async () => {
      const result = await handleAddContext([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Add Files to Context');
      expect(result.entry?.content).toContain('Usage:');
      expect(result.entry?.content).toContain('/add');
    });

    it('should show examples in usage', async () => {
      const result = await handleAddContext([]);

      expect(result.entry?.content).toContain('src/utils.ts');
      expect(result.entry?.content).toContain('src/**/*.ts');
    });

    it('should handle single file pattern', async () => {
      const result = await handleAddContext(['package.json']);

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
      // Will either add file or report error/no match
    });

    it('should handle glob patterns', async () => {
      const result = await handleAddContext(['src/**/*.ts']);

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
    });

    it('should handle multi-word patterns', async () => {
      const result = await handleAddContext(['src/', '*.ts']);

      expect(result.handled).toBe(true);
      // Joins args with space
    });

    it('should report no files found for non-matching pattern', async () => {
      const result = await handleAddContext(['non-existent-directory/**/*.xyz']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('No files matched');
    });

    it('should include file list in success response', async () => {
      // Use a pattern that should match files in the project
      const result = await handleAddContext(['package.json']);

      expect(result.handled).toBe(true);
      if (result.entry?.content?.includes('✅')) {
        expect(result.entry.content).toContain('file');
      }
    });
  });

  describe('handleContext', () => {
    it('should show summary by default', async () => {
      const result = await handleContext([]);

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
    });

    it('should show summary with explicit command', async () => {
      const result = await handleContext(['summary']);

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
    });

    it('should clear context', async () => {
      const result = await handleContext(['clear']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('cleared');
    });

    it('should list files', async () => {
      const result = await handleContext(['list']);

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
      // Will show file list or "no files" message
    });

    it('should show usage hint when no files', async () => {
      const result = await handleContext(['list']);

      // If no files, should suggest /add command
      if (result.entry?.content?.includes('No files')) {
        expect(result.entry.content).toContain('/add');
      }
    });
  });

  describe('handleWorkspace', () => {
    it('should detect workspace', async () => {
      const result = await handleWorkspace();

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry?.content).toBeDefined();
    });

    it('should return formatted detection results', async () => {
      const result = await handleWorkspace();

      // Should return some workspace info
      expect(result.entry?.content?.length).toBeGreaterThan(0);
    });
  });
});

describe('CommandHandlerResult Interface', () => {
  it('should support async handlers', async () => {
    const result: CommandHandlerResult = await handleContext([]);

    expect(result.handled).toBe(true);
    expect(result.entry?.type).toBe('assistant');
  });
});
