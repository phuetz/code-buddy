/**
 * Grok-CLI Bindings Tests
 *
 * Tests for the FCS code-buddy integration bindings
 */

import { executeFCS } from '../../src/scripting/index.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Grok-CLI Bindings', () => {
  const testDir = path.join(process.cwd(), 'test-fcs-bindings-temp');

  beforeAll(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('grok namespace', () => {
    test('grok.ask fails without a Code Buddy client', async () => {
      const result = await executeFCS(`
        let response = grok.ask("What is 2+2?")
        print(response)
      `);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Code Buddy client unavailable');
    });

    test('grok.ask uses the configured Code Buddy client', async () => {
      const result = await executeFCS(`
        let response = grok.ask("What is 2+2?")
        print(response)
      `, {
        codebuddyClient: {
          complete: async () => '4',
          chat: async () => 'chat response',
        },
      } as any);
      expect(result.success).toBe(true);
      expect(result.output).toContain('4');
    });

    test('grok.chat maintains conversation history', async () => {
      const result = await executeFCS(`
        grok.chat("Hello")
        grok.chat("How are you?")
        let history = grok.history()
        print(len(history))
      `, {
        codebuddyClient: {
          complete: async () => 'complete response',
          chat: async (messages: Array<{ role: string; content: string }>) =>
            `reply ${messages.length}`,
        },
      } as any);
      expect(result.success).toBe(true);
      expect(result.output).toContain('4'); // 2 user + 2 assistant messages
    });

    test('grok.clearHistory clears conversation', async () => {
      const result = await executeFCS(`
        grok.clearHistory()
        let history = grok.history()
        print(len(history))
      `, {
        conversationHistory: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
      } as any);
      expect(result.success).toBe(true);
      expect(result.output.some(o => o.includes('0'))).toBe(true);
    });
  });

  describe('tool namespace', () => {
    test('tool.read reads file contents', async () => {
      const testFile = path.join(testDir, 'test-read.txt');
      fs.writeFileSync(testFile, 'Hello World');

      const result = await executeFCS(`
        let content = tool.read("test-read.txt")
        print(content)
      `, { workdir: testDir });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello World');
    });

    test('tool.write creates file', async () => {
      const result = await executeFCS(`
        tool.write("test-write.txt", "Written by FCS")
        print("done")
      `, { workdir: testDir });

      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'test-write.txt'))).toBe(true);
      expect(fs.readFileSync(path.join(testDir, 'test-write.txt'), 'utf-8')).toBe('Written by FCS');
    });

    test('tool.edit modifies file', async () => {
      const testFile = path.join(testDir, 'test-edit.txt');
      fs.writeFileSync(testFile, 'Hello World');

      const result = await executeFCS(`
        tool.edit("test-edit.txt", "World", "FCS")
        let content = tool.read("test-edit.txt")
        print(content)
      `, { workdir: testDir });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello FCS');
    });

    test('tool.ls lists directory', async () => {
      fs.writeFileSync(path.join(testDir, 'file1.txt'), '');
      fs.writeFileSync(path.join(testDir, 'file2.txt'), '');

      const result = await executeFCS(`
        let files = tool.ls(".")
        print(len(files))
      `, { workdir: testDir });

      expect(result.success).toBe(true);
      // Should have multiple files
    });

    test('tool.stat gets file info', async () => {
      const testFile = path.join(testDir, 'test-stat.txt');
      fs.writeFileSync(testFile, 'Test content');

      const result = await executeFCS(`
        let info = tool.stat("test-stat.txt")
        print(info.size)
        print(info.isDir)
      `, { workdir: testDir });

      expect(result.success).toBe(true);
      expect(result.output).toContain('12'); // "Test content" length
      expect(result.output).toContain('false');
    });
  });

  describe('context namespace', () => {
    test('context.add and context.list work', async () => {
      fs.writeFileSync(path.join(testDir, 'ctx1.txt'), '');
      fs.writeFileSync(path.join(testDir, 'ctx2.txt'), '');

      const result = await executeFCS(`
        context.add("*.txt")
        let files = context.list()
        print(context.size())
      `, { workdir: testDir });

      expect(result.success).toBe(true);
    });

    test('context.clear removes all files', async () => {
      const result = await executeFCS(`
        context.add("*.txt")
        context.clear()
        print(context.size())
      `, { workdir: testDir });

      expect(result.success).toBe(true);
      expect(result.output.some(o => o.includes('0'))).toBe(true);
    });
  });

  describe('git namespace', () => {
    test('git.status returns status', async () => {
      const result = await executeFCS(`
        let status = git.status()
        print("status checked")
      `);
      expect(result.success).toBe(true);
      expect(result.output).toContain('status checked');
    });

    test('git.branch returns branch name', async () => {
      const result = await executeFCS(`
        let branch = git.branch()
        print("branch: " + branch)
      `);
      expect(result.success).toBe(true);
    });

    test('git.log returns commits', async () => {
      const result = await executeFCS(`
        let log = git.log(3)
        print("log checked")
      `);
      expect(result.success).toBe(true);
    });
  });

  describe('agent namespace', () => {
    test('agent.run executes task', async () => {
      const result = await executeFCS(`
        let response = agent.run("List all files")
        print("agent ran")
      `, {
        codebuddyClient: {
          complete: async () => 'agent complete',
          chat: async () => 'agent chat',
        },
      } as any);
      expect(result.success).toBe(true);
      expect(result.output.some(o => o.includes('agent') || o.includes('Agent'))).toBe(true);
    });
  });

  describe('mcp namespace', () => {
    test('mcp.servers returns empty without manager', async () => {
      const result = await executeFCS(`
        let servers = mcp.servers()
        print(len(servers))
      `);
      expect(result.success).toBe(true);
      expect(result.output).toContain('0');
    });

    test('mcp.call fails without manager', async () => {
      const result = await executeFCS(`
        let response = mcp.call("weather", "get_forecast", { city: "Paris" })
        print("mcp called")
      `);
      expect(result.success).toBe(false);
      expect(result.error).toContain('MCP manager unavailable');
    });
  });

  describe('session namespace', () => {
    test('session.list returns sessions', async () => {
      const result = await executeFCS(`
        let sessions = session.list()
        print("sessions listed")
      `);
      expect(result.success).toBe(true);
    });
  });

  describe('dry-run mode', () => {
    test('tool.write respects dry-run', async () => {
      const result = await executeFCS(`
        tool.write("should-not-exist.txt", "content")
        print("done")
      `, { workdir: testDir, dryRun: true });

      expect(result.success).toBe(true);
      expect(result.output.some(o => o.includes('DRY RUN'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'should-not-exist.txt'))).toBe(false);
    });

    test('git.commit respects dry-run', async () => {
      const result = await executeFCS(`
        git.commit("Test commit")
        print("done")
      `, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.output.some(o => o.includes('DRY RUN'))).toBe(true);
    });
  });
});
