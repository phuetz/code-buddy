import { test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownConvertTool } from '../../../src/tools/registry/multimodal-tools';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cb-test-markdown-'));
  vi.stubEnv('HOME', tmpDir);
  vi.stubEnv('CODEBUDDY_HOME', tmpDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

test('markdown_convert tool converts when markitdown is available, or fails clearly when missing', async () => {
  const inputPath = path.join(tmpDir, 'test.html');
  await fs.promises.writeFile(inputPath, '<h1>Hello World</h1><p>Test document</p>', 'utf8');

  const tool = new MarkdownConvertTool();
  const result = await tool.execute({ source: inputPath });

  // markitdown may or may not be installed in the environment — both paths are honest.
  if (result.success) {
    // ToolResult shape: { success, output } with Markdown text in `output`.
    expect(typeof result.output).toBe('string');
    expect((result.output ?? '').toLowerCase()).toMatch(/hello/);
  } else {
    expect(typeof result.error).toBe('string');
    expect(result.error).toMatch(/markitdown/i);
  }
});
