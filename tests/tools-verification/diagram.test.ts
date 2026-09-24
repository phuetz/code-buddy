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

  async function asciiEdge(edge: string) {
    const tool = new DiagramTool();
    const result = await tool.generateFromMermaid(
      `flowchart TD\n    A[Start]\n    B[End]\n    ${edge}`,
      { outputFormat: 'ascii' },
    );
    console.log(`ARETE ${JSON.stringify(edge)}:`, JSON.stringify(result.output));
    expect(result.success).toBe(true);
    expect(result.output).toContain('Start');
    expect(result.output).toContain('End');
    expect(result.output).toContain('▼');
    return result;
  }

  it('garde la flèche ASCII sur une arête mermaid sans espace', async () => {
    await asciiEdge('A-->B');
  });

  it('garde la flèche ASCII sur une arête mermaid avec espaces', async () => {
    await asciiEdge('A --> B');
  });

  it('garde la flèche ASCII sur une arête mermaid étiquetée', async () => {
    const result = await asciiEdge('A -- Go --> B');
    expect(result.data).toMatchObject({ mermaidCode: expect.stringContaining('A -- Go --> B') });
  });
});
