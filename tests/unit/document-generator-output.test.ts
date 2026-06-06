import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GenerateDocumentExecuteTool } from '../../src/tools/registry/document-generator-tools.js';

describe('generate_document output', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-buddy-docgen-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('creates XLSX spreadsheets from table-like content', async () => {
    const outputPath = path.join(tempDir, 'sales.xlsx');
    const tool = new GenerateDocumentExecuteTool();

    const result = await tool.execute({
      type: 'xlsx',
      title: 'Sales',
      content: 'Product,Revenue\nAlpha,1200\nBeta,900',
      outputPath,
    });

    const stat = await fs.stat(outputPath);
    expect(result.success).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('creates PPTX presentations from markdown sections', async () => {
    const outputPath = path.join(tempDir, 'briefing.pptx');
    const tool = new GenerateDocumentExecuteTool();

    const result = await tool.execute({
      type: 'pptx',
      title: 'Briefing',
      content: '## Roadmap\n- Capture\n- Analyze\n- Deliver',
      outputPath,
      theme: 'professional',
    });

    const stat = await fs.stat(outputPath);
    expect(result.success).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });
});
