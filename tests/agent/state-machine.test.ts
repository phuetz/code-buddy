/**
 * Tests for Agent State Machine (OpenManus-compatible)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentStateMachine, AgentStatus } from '../../src/agent/state-machine.js';

describe('AgentStateMachine', () => {
  let sm: AgentStateMachine;

  beforeEach(() => {
    sm = new AgentStateMachine(30);
  });

  describe('initial state', () => {
    it('starts in IDLE', () => {
      expect(sm.status).toBe(AgentStatus.IDLE);
      expect(sm.currentStep).toBe(0);
      expect(sm.isTerminal).toBe(false);
      expect(sm.canContinue).toBe(true);
    });
  });

  describe('valid transitions', () => {
    it('IDLE → RUNNING → THINKING → ACTING → FINISHED', () => {
      sm.start();
      expect(sm.status).toBe(AgentStatus.RUNNING);

      sm.think();
      expect(sm.status).toBe(AgentStatus.THINKING);

      sm.act();
      expect(sm.status).toBe(AgentStatus.ACTING);

      sm.finish('done');
      expect(sm.status).toBe(AgentStatus.FINISHED);
      expect(sm.isTerminal).toBe(true);
      expect(sm.canContinue).toBe(false);
    });

    it('FINISHED → IDLE (reset)', () => {
      sm.start();
      sm.finish();
      expect(sm.isTerminal).toBe(true);

      sm.reset();
      expect(sm.status).toBe(AgentStatus.IDLE);
      expect(sm.currentStep).toBe(0);
    });

    it('RUNNING → ERROR → IDLE', () => {
      sm.start();
      sm.fail(new Error('test error'));
      expect(sm.status).toBe(AgentStatus.ERROR);
      expect(sm.error?.message).toBe('test error');

      sm.reset();
      expect(sm.status).toBe(AgentStatus.IDLE);
      expect(sm.error).toBeNull();
    });
  });

  describe('invalid transitions', () => {
    it('throws on IDLE → FINISHED', () => {
      expect(() => sm.finish()).toThrow('Invalid state transition');
    });

    it('throws on IDLE → THINKING', () => {
      expect(() => sm.think()).toThrow('Invalid state transition');
    });
  });

  describe('step counting', () => {
    it('increments steps', () => {
      sm.start();
      expect(sm.incrementStep()).toBe(true);
      expect(sm.currentStep).toBe(1);
    });

    it('returns false at max steps', () => {
      sm = new AgentStateMachine(2);
      sm.start();
      expect(sm.incrementStep()).toBe(true); // step 1
      expect(sm.incrementStep()).toBe(false); // step 2 = max
      expect(sm.canContinue).toBe(false);
    });
  });

  describe('stuck detection', () => {
    it('detects duplicate consecutive responses', () => {
      sm.start();
      expect(sm.recordResponse('hello')).toBe(false);
      expect(sm.recordResponse('hello')).toBe(false);
      expect(sm.recordResponse('hello')).toBe(true); // 3rd duplicate
    });

    it('does not trigger for varied responses', () => {
      sm.start();
      sm.recordResponse('hello');
      sm.recordResponse('world');
      sm.recordResponse('hello');
      expect(sm.isStuck()).toBe(false);
    });

    it('handles stuck recovery', () => {
      sm.start();
      sm.recordResponse('repeat');
      sm.recordResponse('repeat');
      sm.recordResponse('repeat');
      expect(sm.isStuck()).toBe(true);

      const prompt = sm.handleStuckState();
      expect(prompt).toContain('different approach');
      expect(sm.isStuck()).toBe(false);
    });

    it('emits stuck event', () => {
      const handler = vi.fn();
      sm.on('stuck', handler);
      sm.start();
      sm.recordResponse('x');
      sm.recordResponse('x');
      sm.recordResponse('x');
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('events', () => {
    it('emits transition events', () => {
      const handler = vi.fn();
      sm.on('transition', handler);
      sm.start();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ from: AgentStatus.IDLE, to: AgentStatus.RUNNING })
      );
    });

    it('emits start event', () => {
      const handler = vi.fn();
      sm.on('start', handler);
      sm.start();
      expect(handler).toHaveBeenCalled();
    });

    it('emits finish event with stats', () => {
      const handler = vi.fn();
      sm.on('finish', handler);
      sm.start();
      sm.incrementStep();
      sm.finish();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ steps: 1 })
      );
    });
  });

  describe('toJSON', () => {
    it('serializes state', () => {
      sm.start();
      sm.incrementStep();
      const json = sm.toJSON();
      expect(json.status).toBe(AgentStatus.RUNNING);
      expect(json.currentStep).toBe(1);
      expect(json.maxSteps).toBe(30);
      expect(json.isStuck).toBe(false);
    });
  });
});
