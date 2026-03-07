import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineCompositor } from '../../src/workflows/pipeline.js';

describe('Pipeline Workflow Integration', () => {
  let compositor: PipelineCompositor;
  const mockExecutor = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    compositor = new PipelineCompositor();
    compositor.setToolExecutor(mockExecutor);
    mockExecutor.mockResolvedValue({ success: true, output: 'Step result' });
  });

  it('should execute a sequence of agent tools', async () => {
    const steps = [
      { type: 'tool', name: 'spawn_subagent', args: { type: 'explorer', task: 'explore' } },
      { type: 'tool', name: 'spawn_subagent', args: { type: 'refactorer', task: 'implement' } }
    ] as any;

    const result = await compositor.execute(steps);

    expect(result.success).toBe(true);
    expect(mockExecutor).toHaveBeenCalledTimes(2);
    expect(mockExecutor).toHaveBeenNthCalledWith(1, 'spawn_subagent', expect.objectContaining({ type: 'explorer' }), '');
    expect(mockExecutor).toHaveBeenNthCalledWith(2, 'spawn_subagent', expect.objectContaining({ type: 'refactorer', _input: 'Step result' }), 'Step result');
  });

  it('should handle failures and stop execution', async () => {
    mockExecutor.mockResolvedValueOnce({ success: false, error: 'Fail' });
    
    const steps = [
      { type: 'tool', name: 'spawn_subagent', args: { type: 'explorer', task: 'explore' } },
      { type: 'tool', name: 'spawn_subagent', args: { type: 'refactorer', task: 'implement' } }
    ] as any;

    const result = await compositor.execute(steps);

    expect(result.success).toBe(false);
    expect(mockExecutor).toHaveBeenCalledTimes(1);
  });
});
