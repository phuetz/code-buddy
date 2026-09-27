import { describe, it, expect } from 'vitest';
import { NotebookTool } from '../../src/tools/notebook-tool.js';

describe('NotebookTool', () => {
  it('should return success: false when kernel is already running', async () => {
    const tool = new NotebookTool();
    // Force the internal state to look like kernel is running
    (tool as any).kernelProcess = { killed: false };
    (tool as any).checkJupyterAvailable = async () => true;

    const result = await tool.execute({ action: 'kernel_start' }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain('already running');
  });
});
