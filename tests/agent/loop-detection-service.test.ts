import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoopDetectionService, LoopType } from '../../src/agent/loop-detection-service.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';

describe('LoopDetectionService', () => {
  let service: LoopDetectionService;

  beforeEach(() => {
    service = new LoopDetectionService();
  });

  it('starts in a clean non-looping state', () => {
    expect(service.isLoopDetected()).toBe(false);
    expect(service.getDetectedCount()).toBe(0);
    expect(service.getLastLoopDetail()).toBeUndefined();
  });

  it('detects consecutive identical tool calls (k=1, threshold=5)', () => {
    const toolCall = { name: 'view_file', args: { AbsolutePath: '/foo/bar.ts' } };

    for (let i = 0; i < 4; i++) {
      const result = service.checkToolCallLoop(toolCall);
      expect(result.isLoop).toBe(false);
      expect(service.isLoopDetected()).toBe(false);
    }

    const fifthResult = service.checkToolCallLoop(toolCall);
    expect(fifthResult.isLoop).toBe(true);
    expect(fifthResult.type).toBe(LoopType.CONSECUTIVE_TOOL_CALL);
    expect(fifthResult.detail).toContain('view_file');
    expect(service.isLoopDetected()).toBe(true);
    expect(service.getDetectedCount()).toBe(1);
  });

  it('does not trigger a loop when arguments vary (productive batch operations)', () => {
    for (let i = 0; i < 10; i++) {
      const result = service.checkToolCallLoop({
        name: 'view_file',
        args: { AbsolutePath: `/foo/file_${i}.ts` },
      });
      expect(result.isLoop).toBe(false);
    }
    expect(service.isLoopDetected()).toBe(false);
  });

  it('detects alternating 2-step cycles (k=2, 5 iterations)', () => {
    const actionA = { name: 'replace_file_content', args: { TargetFile: '/src/a.ts', text: 'x' } };
    const actionB = { name: 'run_command', args: { CommandLine: 'npm test' } };

    for (let i = 0; i < 4; i++) {
      expect(service.checkToolCallLoop(actionA).isLoop).toBe(false);
      expect(service.checkToolCallLoop(actionB).isLoop).toBe(false);
    }

    expect(service.checkToolCallLoop(actionA).isLoop).toBe(false);
    const finalResult = service.checkToolCallLoop(actionB);
    expect(finalResult.isLoop).toBe(true);
    expect(finalResult.type).toBe(LoopType.CYCLE_TOOL_CALL);
    expect(service.isLoopDetected()).toBe(true);
  });

  it('detects 3-step repeating cycles (k=3, 5 iterations)', () => {
    const actionA = { name: 'tool_a', args: { id: 1 } };
    const actionB = { name: 'tool_b', args: { id: 2 } };
    const actionC = { name: 'tool_c', args: { id: 3 } };

    for (let i = 0; i < 4; i++) {
      expect(service.checkToolCallLoop(actionA).isLoop).toBe(false);
      expect(service.checkToolCallLoop(actionB).isLoop).toBe(false);
      expect(service.checkToolCallLoop(actionC).isLoop).toBe(false);
    }

    expect(service.checkToolCallLoop(actionA).isLoop).toBe(false);
    expect(service.checkToolCallLoop(actionB).isLoop).toBe(false);
    const finalResult = service.checkToolCallLoop(actionC);
    expect(finalResult.isLoop).toBe(true);
    expect(finalResult.type).toBe(LoopType.CYCLE_TOOL_CALL);
  });

  it('detects content chanting loop in streaming prose', () => {
    const chunk = 'The quick brown fox jumps over the lazy dog repeatedly now.';
    let triggered = false;
    for (let i = 0; i < 15; i++) {
      const res = service.checkContentChunk(chunk);
      if (res.isLoop) {
        triggered = true;
        expect(res.type).toBe(LoopType.CONTENT_CHANTING);
        break;
      }
    }
    expect(triggered).toBe(true);
    expect(service.isLoopDetected()).toBe(true);
  });

  it('does not trigger content loop inside markdown code blocks', () => {
    service.checkContentChunk('```typescript\n');
    const repeatedCode = 'const value = calculateSomethingImportant(1234567890);\n';
    for (let i = 0; i < 20; i++) {
      const res = service.checkContentChunk(repeatedCode);
      expect(res.isLoop).toBe(false);
    }
    service.checkContentChunk('```\n');
    expect(service.isLoopDetected()).toBe(false);
  });

  it('emits agent:loop_detected on the global event bus', () => {
    const bus = getGlobalEventBus();
    const spy = vi.fn();
    bus.on('agent:loop_detected', spy);

    const toolCall = { name: 'fail_tool', args: { reason: 'retry' } };
    for (let i = 0; i < 5; i++) {
      service.checkToolCallLoop(toolCall);
    }

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      loopType: LoopType.CONSECUTIVE_TOOL_CALL,
      detail: expect.stringContaining('fail_tool'),
    }));

    bus.off('agent:loop_detected', spy);
  });

  it('resets cleanly when reset() is invoked', () => {
    const toolCall = { name: 'test_tool', args: { x: 1 } };
    for (let i = 0; i < 5; i++) {
      service.checkToolCallLoop(toolCall);
    }
    expect(service.isLoopDetected()).toBe(true);

    service.reset();
    expect(service.isLoopDetected()).toBe(false);
    expect(service.getDetectedCount()).toBe(0);
    expect(service.getLastLoopDetail()).toBeUndefined();
  });
});
