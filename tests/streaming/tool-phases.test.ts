/**
 * Tool Phases Tests
 */

import {
  ToolPhaseEmitter,
  ToolPhaseManager,
  resetToolPhaseManager,
} from '../../src/streaming/tool-phases.js';
import type { ToolPhaseEvent } from '../../src/streaming/tool-phases.js';

describe('Tool Phases', () => {
  describe('ToolPhaseEmitter', () => {
    let emitter: ToolPhaseEmitter;

    beforeEach(() => {
      emitter = new ToolPhaseEmitter('tc-1', 'read_file');
    });

    afterEach(() => {
      emitter.removeAllListeners();
    });

    describe('start', () => {
      it('should emit start phase', () => {
        const events: ToolPhaseEvent[] = [];
        emitter.on('phase', (e) => events.push(e));

        emitter.start('Starting read_file...');

        expect(events.length).toBe(1);
        expect(events[0].phase).toBe('start');
        expect(events[0].toolCallId).toBe('tc-1');
        expect(events[0].toolName).toBe('read_file');
        expect(events[0].progress).toBe(0);
      });

      it('should also emit phase:start event', () => {
        const startEvents: ToolPhaseEvent[] = [];
        emitter.on('phase:start', (e) => startEvents.push(e));

        emitter.start();

        expect(startEvents.length).toBe(1);
      });
    });

    describe('update', () => {
      it('should emit update phase with progress', () => {
        const events: ToolPhaseEvent[] = [];
        emitter.on('phase', (e) => events.push(e));

        emitter.start();
        emitter.update(50, 'Half done...');

        expect(events.length).toBe(2);
        expect(events[1].phase).toBe('update');
        expect(events[1].progress).toBe(50);
        expect(events[1].message).toBe('Half done...');
      });

      it('should clamp progress to 0-100', () => {
        const events: ToolPhaseEvent[] = [];
        emitter.on('phase', (e) => events.push(e));

        emitter.update(-10);
        expect(events[0].progress).toBe(0);

        emitter.update(150);
        expect(events[1].progress).toBe(100);
      });
    });

    describe('result', () => {
      it('should emit result phase on success', () => {
        const events: ToolPhaseEvent[] = [];
        emitter.on('phase', (e) => events.push(e));

        emitter.start();
        emitter.result({ success: true, output: 'File contents' });

        const resultEvent = events.find(e => e.phase === 'result');
        expect(resultEvent).toBeDefined();
        expect(resultEvent?.result?.success).toBe(true);
        expect(resultEvent?.result?.output).toBe('File contents');
        expect(resultEvent?.result?.duration).toBeGreaterThanOrEqual(0);
      });

      it('should emit result phase on failure', () => {
        const events: ToolPhaseEvent[] = [];
        emitter.on('phase', (e) => events.push(e));

        emitter.start();
        emitter.result({ success: false, error: 'File not found' });

        const resultEvent = events.find(e => e.phase === 'result');
        expect(resultEvent?.result?.success).toBe(false);
        expect(resultEvent?.result?.error).toBe('File not found');
      });
    });

    describe('error', () => {
      it('should emit error and result with failure', () => {
        const errors: Error[] = [];
        const events: ToolPhaseEvent[] = [];

        emitter.on('error', (e) => errors.push(e));
        emitter.on('phase', (e) => events.push(e));

        emitter.start();
        emitter.error(new Error('Something went wrong'));

        expect(errors.length).toBe(1);
        expect(errors[0].message).toBe('Something went wrong');

        const resultEvent = events.find(e => e.phase === 'result');
        expect(resultEvent?.result?.success).toBe(false);
      });
    });

    describe('getters', () => {
      it('should return current phase', () => {
        emitter.start();
        expect(emitter.getPhase()).toBe('start');

        emitter.update(50);
        expect(emitter.getPhase()).toBe('update');

        emitter.result({ success: true });
        expect(emitter.getPhase()).toBe('result');
      });

      it('should return current progress', () => {
        emitter.start();
        expect(emitter.getProgress()).toBe(0);

        emitter.update(75);
        expect(emitter.getProgress()).toBe(75);
      });

      it('should return elapsed time', () => {
        expect(emitter.getElapsedTime()).toBe(0);

        emitter.start();

        // Small delay
        const elapsed = emitter.getElapsedTime();
        expect(elapsed).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('ToolPhaseManager', () => {
    let manager: ToolPhaseManager;

    beforeEach(() => {
      resetToolPhaseManager();
      manager = new ToolPhaseManager();
    });

    afterEach(() => {
      manager.dispose();
    });

    describe('createEmitter', () => {
      it('should create and store emitter', () => {
        const emitter = manager.createEmitter('tc-1', 'bash');

        expect(emitter).toBeInstanceOf(ToolPhaseEmitter);
        expect(manager.getEmitter('tc-1')).toBe(emitter);
      });

      it('should forward events to manager', () => {
        const events: ToolPhaseEvent[] = [];
        manager.on('phase', (e) => events.push(e));

        const emitter = manager.createEmitter('tc-1', 'bash');
        emitter.start();
        emitter.update(50);
        emitter.result({ success: true });

        expect(events.length).toBe(3);
      });
    });

    describe('removeEmitter', () => {
      it('should remove emitter', () => {
        manager.createEmitter('tc-1', 'bash');
        expect(manager.getEmitter('tc-1')).toBeDefined();

        const removed = manager.removeEmitter('tc-1');
        expect(removed).toBe(true);
        expect(manager.getEmitter('tc-1')).toBeUndefined();
      });

      it('should return false for non-existent emitter', () => {
        expect(manager.removeEmitter('non-existent')).toBe(false);
      });
    });

    describe('phase listeners', () => {
      it('should notify added listeners', () => {
        const events: ToolPhaseEvent[] = [];
        const listener = (e: ToolPhaseEvent) => events.push(e);

        manager.addPhaseListener(listener);
        const emitter = manager.createEmitter('tc-1', 'bash');
        emitter.start();

        expect(events.length).toBe(1);
      });

      it('should stop notifying removed listeners', () => {
        const events: ToolPhaseEvent[] = [];
        const listener = (e: ToolPhaseEvent) => events.push(e);

        manager.addPhaseListener(listener);
        manager.removePhaseListener(listener);

        const emitter = manager.createEmitter('tc-1', 'bash');
        emitter.start();

        expect(events.length).toBe(0);
      });
    });

    describe('getActiveToolCalls', () => {
      it('should return active tool calls', () => {
        const emitter1 = manager.createEmitter('tc-1', 'bash');
        const emitter2 = manager.createEmitter('tc-2', 'read_file');

        emitter1.start();
        emitter2.start();
        emitter2.result({ success: true });

        const active = manager.getActiveToolCalls();
        expect(active.length).toBe(1);
        expect(active[0].toolCallId).toBe('tc-1');
      });
    });

    describe('clear', () => {
      it('should clear all emitters', () => {
        manager.createEmitter('tc-1', 'bash');
        manager.createEmitter('tc-2', 'read_file');

        manager.clear();

        expect(manager.getEmitter('tc-1')).toBeUndefined();
        expect(manager.getEmitter('tc-2')).toBeUndefined();
      });
    });
  });
});
