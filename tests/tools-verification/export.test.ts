import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ExportTool, Message } from '../../src/tools/export-tool.js';
import { ExportExecuteTool, resetMultimodalInstances } from '../../src/tools/registry/multimodal-tools.js';

describe('ExportTool', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    resetMultimodalInstances();
  });

  afterEach(async () => {
    resetMultimodalInstances();
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function expectByteSize(result: { success: boolean; output?: string; data?: unknown }): Promise<void> {
    expect(result.success).toBe(true);
    expect(result.output).toContain('Exported conversation to');
    expect(result.output).toContain('.md');
    const data = result.data as { path: string; size: number };
    const bytes = await fs.readFile(data.path);
    const text = bytes.toString('utf8');
    expect(text).toContain('Hello');
    expect(text).toContain('Hi there!');
    expect(text).toContain('😀');
    expect(data.size).toBe(bytes.length);
    expect(data.size).toBe(Buffer.byteLength(text, 'utf8'));
    expect(text.length).toBeLessThan(bytes.length);
  }

  it('counts exported markdown in bytes, including through the conversation adapter', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello 😀' },
      { role: 'assistant', content: 'Hi there!' }
    ];

    const direct = await new ExportTool().exportConversation(messages, { format: 'markdown' });
    console.log('EXPORT_OUTPUT:', JSON.stringify(direct, null, 2));
    await expectByteSize(direct);

    const adapted = await new ExportExecuteTool().execute({
      operation: 'conversation',
      format: 'markdown',
      messages,
    });
    console.log('EXPORT_ADAPTER:', JSON.stringify(adapted, null, 2));
    await expectByteSize(adapted);
  });
});
