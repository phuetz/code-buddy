/**
 * Tests for Session Store Export Formats
 */


// Mock the database repository

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { SessionStore, Session, SessionMessage } from '../../src/persistence/session-store.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

jest.mock('../../src/database/repositories/session-repository.js', () => ({
  getSessionRepository: jest.fn(function() { return {
    createSession: jest.fn(),
    addMessage: jest.fn(),
  }; }),
  SessionRepository: class {},
}));

describe('SessionStore Export Formats', () => {
  let store: SessionStore;
  let testSession: Session;

  beforeEach(async () => {
    // Create store without SQLite for testing
    store = new SessionStore({ useSQLite: false });

    // Create a test session
    testSession = await store.createSession('Test Session', 'grok-4-latest');

    // Add some test messages
    const messages: SessionMessage[] = [
      {
        type: 'user',
        content: 'Hello, can you help me?',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'assistant',
        content: 'Of course! How can I assist you today?',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'user',
        content: 'Please read the file src/index.ts',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'tool_call',
        content: 'Reading file...',
        timestamp: new Date().toISOString(),
        toolCallName: 'read_file',
      },
      {
        type: 'tool_result',
        content: 'File content: export default {}',
        timestamp: new Date().toISOString(),
        toolCallName: 'read_file',
        toolCallSuccess: true,
      },
      {
        type: 'assistant',
        content: 'Here is the content of src/index.ts:\n```typescript\nexport default {}\n```',
        timestamp: new Date().toISOString(),
      },
    ];

    // Save messages to session
    const session = await store.loadSession(testSession.id);
    if (session) {
      session.messages = messages;
      await store.saveSession(session);
    }
  });

  afterEach(async () => {
    // Clean up: delete the test session
    if (testSession) {
      await store.deleteSession(testSession.id);
    }
  });

  describe('exportToMarkdown', () => {
    it('should export session to markdown format', async () => {
      const markdown = await store.exportToMarkdown(testSession.id);

      expect(markdown).toBeDefined();
      expect(markdown).not.toBeNull();
      expect(markdown).toContain('# Test Session');
      expect(markdown).toContain('**Created:**');
      expect(markdown).toContain('**Working Directory:**');
      expect(markdown).toContain('**Model:** grok-4-latest');
      expect(markdown).toContain('## User');
      expect(markdown).toContain('## Assistant');
      expect(markdown).toContain('### Tool: read_file');
    });

    it('should return null for non-existent session', async () => {
      const markdown = await store.exportToMarkdown('non-existent-id');
      expect(markdown).toBeNull();
    });
  });

  describe('exportToJson', () => {
    it('should export session to valid JSON format', async () => {
      const json = await store.exportToJson(testSession.id);

      expect(json).toBeDefined();
      expect(json).not.toBeNull();

      const parsed = JSON.parse(json!);
      expect(parsed.format).toBe('code-buddy-session');
      expect(parsed.version).toBe('1.0');
      expect(parsed.exportedAt).toBeDefined();
    });

    it('should include session metadata in JSON export', async () => {
      const json = await store.exportToJson(testSession.id);
      const parsed = JSON.parse(json!);

      expect(parsed.session.id).toBe(testSession.id);
      expect(parsed.session.name).toBe('Test Session');
      expect(parsed.session.model).toBe('grok-4-latest');
    });

    it('should include messages in JSON export', async () => {
      const json = await store.exportToJson(testSession.id);
      const parsed = JSON.parse(json!);

      expect(parsed.messages).toBeDefined();
      expect(Array.isArray(parsed.messages)).toBe(true);
      expect(parsed.messages.length).toBe(6);
    });

    it('should include statistics in JSON export', async () => {
      const json = await store.exportToJson(testSession.id);
      const parsed = JSON.parse(json!);

      expect(parsed.statistics).toBeDefined();
      expect(parsed.statistics.totalMessages).toBe(6);
      expect(parsed.statistics.userMessages).toBe(2);
      expect(parsed.statistics.assistantMessages).toBe(2);
      expect(parsed.statistics.successfulToolCalls).toBe(1);
    });

    it('should return null for non-existent session', async () => {
      const json = await store.exportToJson('non-existent-id');
      expect(json).toBeNull();
    });
  });

  describe('exportToHtml', () => {
    it('should export session to valid HTML format', async () => {
      const html = await store.exportToHtml(testSession.id);

      expect(html).toBeDefined();
      expect(html).not.toBeNull();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });

    it('should include session title in HTML', async () => {
      const html = await store.exportToHtml(testSession.id);

      expect(html).toContain('<title>Test Session - Code Buddy Session</title>');
      expect(html).toContain('<h1>Test Session</h1>');
    });

    it('should include styling in HTML', async () => {
      const html = await store.exportToHtml(testSession.id);

      expect(html).toContain('<style>');
      expect(html).toContain('--bg-primary');
      expect(html).toContain('.message');
      expect(html).toContain('.role-badge');
    });

    it('should include messages with proper styling', async () => {
      const html = await store.exportToHtml(testSession.id);

      expect(html).toContain('class="message user"');
      expect(html).toContain('class="message assistant"');
      expect(html).toContain('class="role-badge');
    });

    it('should include statistics section', async () => {
      const html = await store.exportToHtml(testSession.id);

      expect(html).toContain('class="statistics"');
      expect(html).toContain('Session Statistics');
      expect(html).toContain('Total Messages');
    });

    it('should handle code blocks with syntax highlighting markers', async () => {
      const html = await store.exportToHtml(testSession.id);

      expect(html).toContain('class="code-block"');
      expect(html).toContain('data-language="typescript"');
    });

    it('should return null for non-existent session', async () => {
      const html = await store.exportToHtml('non-existent-id');
      expect(html).toBeNull();
    });
  });

  describe('exportSessionToFileWithFormat', () => {
    const testDir = path.join(os.tmpdir(), 'codebuddy-test-exports');

    beforeEach(async () => {
      await fs.mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
      try {
        const files = await fs.readdir(testDir);
        for (const file of files) {
          await fs.unlink(path.join(testDir, file));
        }
        await fs.rmdir(testDir);
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should export to markdown file', async () => {
      const outputPath = path.join(testDir, 'test-export.md');
      const result = await store.exportSessionToFileWithFormat(
        testSession.id,
        'markdown',
        outputPath
      );

      expect(result).toBe(outputPath);
      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('# Test Session');
    });

    it('should export to JSON file', async () => {
      const outputPath = path.join(testDir, 'test-export.json');
      const result = await store.exportSessionToFileWithFormat(
        testSession.id,
        'json',
        outputPath
      );

      expect(result).toBe(outputPath);
      const content = await fs.readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.format).toBe('code-buddy-session');
    });

    it('should export to HTML file', async () => {
      const outputPath = path.join(testDir, 'test-export.html');
      const result = await store.exportSessionToFileWithFormat(
        testSession.id,
        'html',
        outputPath
      );

      expect(result).toBe(outputPath);
      const content = await fs.readFile(outputPath, 'utf-8');
      expect(content).toContain('<!DOCTYPE html>');
    });

    it('should use correct extension when no path provided', async () => {
      // This test verifies the extension logic without actually writing files
      const jsonPath = await store.exportSessionToFileWithFormat(testSession.id, 'json');
      const htmlPath = await store.exportSessionToFileWithFormat(testSession.id, 'html');
      const mdPath = await store.exportSessionToFileWithFormat(testSession.id, 'markdown');

      expect(jsonPath).toContain('.json');
      expect(htmlPath).toContain('.html');
      expect(mdPath).toContain('.md');

      // Clean up generated files
      if (jsonPath) await fs.unlink(jsonPath).catch(() => {});
      if (htmlPath) await fs.unlink(htmlPath).catch(() => {});
      if (mdPath) await fs.unlink(mdPath).catch(() => {});
    });
  });
});
