import { describe, expect, it, vi } from 'vitest';
import { AutoCaptureManager } from '../../src/memory/auto-capture.js';
import type { EnhancedMemory } from '../../src/memory/enhanced-memory.js';

describe('AutoCaptureManager', () => {
  it('ignores empty tokens when comparing memories', async () => {
    const memory = {
      recall: vi.fn().mockResolvedValue([{ id: 'mem2', content: 'hello ' }]),
    } as unknown as EnhancedMemory;
    const manager = new AutoCaptureManager(memory, { deduplicationThreshold: 0.9 });

    expect(await manager.checkDuplicate('hello')).toEqual({
      isDuplicate: true,
      similarMemoryId: 'mem2',
    });
  });
});
