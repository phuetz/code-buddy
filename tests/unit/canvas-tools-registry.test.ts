import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CanvasExecuteTool, resetCanvasInstances } from '../../src/tools/registry/canvas-tools.js';

describe('CanvasExecuteTool import action', () => {
  beforeEach(() => {
    resetCanvasInstances();
  });

  afterEach(() => {
    resetCanvasInstances();
  });

  it('imports exported canvas JSON into a new canvas', async () => {
    const tool = new CanvasExecuteTool();

    const createResult = await tool.execute({
      action: 'create',
      config: { name: 'source' },
    });
    expect(createResult.success).toBe(true);
    const sourceCanvasId = (createResult.output ?? '').match(/[0-9a-f-]{36}/i)?.[0];
    expect(sourceCanvasId).toBeDefined();

    const addResult = await tool.execute({
      action: 'add_element',
      canvasId: sourceCanvasId,
      element: {
        type: 'text',
        content: { text: 'Hello' },
        position: { x: 0, y: 0 },
        size: { width: 160, height: 60 },
      },
    });
    expect(addResult.success).toBe(true);

    const exportResult = await tool.execute({
      action: 'export',
      canvasId: sourceCanvasId,
    });
    expect(exportResult.success).toBe(true);
    const exportedJson = exportResult.output ?? '';
    expect(exportedJson).toContain('"elements"');

    const importResult = await tool.execute({
      action: 'import',
      json: exportedJson,
    });
    expect(importResult.success).toBe(true);
    const importedCanvasId = (importResult.output ?? '').match(/[0-9a-f-]{36}/i)?.[0];
    expect(importedCanvasId).toBeDefined();
    expect(importedCanvasId).not.toBe(sourceCanvasId);

    const listResult = await tool.execute({ action: 'list' });
    expect(listResult.success).toBe(true);
    expect(listResult.output).toContain(sourceCanvasId);
    expect(listResult.output).toContain(importedCanvasId);
  });

  it('requires json payload for import action', async () => {
    const tool = new CanvasExecuteTool();

    const result = await tool.execute({ action: 'import' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('json (or data) is required');
  });

  it('exposes json/data fields in schema for import action', () => {
    const tool = new CanvasExecuteTool();
    const schema = tool.getSchema();

    expect(schema.parameters.properties.json).toBeDefined();
    expect(schema.parameters.properties.data).toBeDefined();
  });
});
