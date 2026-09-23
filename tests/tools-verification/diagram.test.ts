import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { DiagramTool } from '../../src/tools/diagram-tool.js';

describe('DiagramTool', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diagram-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('renders labeled nodes and keeps the arrow without creating .codebuddy', async () => {
    const tool = new DiagramTool();
    const result = await tool.generateFlowchart(
      [{ id: 'A', label: 'Start' }, { id: 'B', label: 'End' }],
      [{ from: 'A', to: 'B', label: 'Go' }],
      { title: 'Test Flowchart', outputFormat: 'ascii' }
    );

    console.log('DIAGRAM_OUTPUT:', JSON.stringify(result, null, 2));

    expect(result.success).toBe(true);
    expect(result.output).toContain('Start');
    expect(result.output).toContain('End');
    expect(result.output).toContain('▼');
    expect(result.output).not.toContain('undefined');
    expect(result.data).toMatchObject({ mermaidCode: expect.stringContaining('A -- Go --> B') });
    const entries = await fs.readdir(tmpDir);
    expect(entries).not.toContain('.codebuddy');
  });
});
