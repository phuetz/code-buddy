/**
 * AFlow Optimizer Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AFlowOptimizer, getAFlowOptimizer } from '../../src/workflows/aflow-optimizer.js';
import type { LobsterWorkflow, StepResult } from '../../src/workflows/lobster-engine.js';

const createTestWorkflow = (): LobsterWorkflow => ({
  name: 'test-workflow',
  version: '1.0',
  steps: [
    { id: 'lint', name: 'Lint', command: 'npm run lint' },
    { id: 'typecheck', name: 'Typecheck', command: 'npm run typecheck' },
    { id: 'test', name: 'Test', command: 'npm test', dependsOn: ['lint', 'typecheck'] },
    { id: 'build', name: 'Build', command: 'npm run build', dependsOn: ['test'] },
    { id: 'deploy', name: 'Deploy', command: 'npm run deploy', dependsOn: ['build'] },
  ],
});

describe('AFlowOptimizer', () => {
  beforeEach(() => {
    AFlowOptimizer.resetInstance();
  });

  describe('singleton', () => {
    it('returns same instance', () => {
      expect(getAFlowOptimizer()).toBe(getAFlowOptimizer());
    });

    it('resetInstance creates new instance', () => {
      const a = getAFlowOptimizer();
      AFlowOptimizer.resetInstance();
      expect(getAFlowOptimizer()).not.toBe(a);
    });
  });

  describe('optimize', () => {
    it('returns optimization result with valid workflow', async () => {
      const optimizer = new AFlowOptimizer({ iterations: 10 });
      const workflow = createTestWorkflow();

      const result = await optimizer.optimize(workflow);

      expect(result.bestConfig).toBeDefined();
      expect(result.bestConfig.steps).toHaveLength(5);
      expect(result.score).toBeGreaterThan(0);
      expect(result.iterations).toBe(10);
    });

    it('uses historical results for better estimates', async () => {
      const optimizer = new AFlowOptimizer({ iterations: 10 });
      const workflow = createTestWorkflow();
      const historical: StepResult[] = [
        { stepId: 'lint', status: 'success', stdout: '', exitCode: 0, duration: 5000 },
        { stepId: 'typecheck', status: 'success', stdout: '', exitCode: 0, duration: 8000 },
        { stepId: 'test', status: 'success', stdout: '', exitCode: 0, duration: 30000 },
        { stepId: 'build', status: 'success', stdout: '', exitCode: 0, duration: 15000 },
        { stepId: 'deploy', status: 'success', stdout: '', exitCode: 0, duration: 20000 },
      ];

      const result = await optimizer.optimize(workflow, historical);
      expect(result.bestConfig).toBeDefined();
      expect(result.score).toBeGreaterThan(0);
    });

    it('tracks improvements over iterations', async () => {
      const optimizer = new AFlowOptimizer({ iterations: 20 });
      const workflow = createTestWorkflow();

      const result = await optimizer.optimize(workflow);
      expect(result.improvements.length).toBeGreaterThanOrEqual(1);
    });

    it('returns top configs', async () => {
      const optimizer = new AFlowOptimizer({ iterations: 20 });
      const workflow = createTestWorkflow();

      const result = await optimizer.optimize(workflow);
      expect(result.allConfigs.length).toBeGreaterThanOrEqual(1);
      // Should be sorted by score descending
      for (let i = 1; i < result.allConfigs.length; i++) {
        expect(result.allConfigs[i - 1].score).toBeGreaterThanOrEqual(result.allConfigs[i].score);
      }
    });
  });

  describe('analyzeParallelism', () => {
    it('identifies independent steps', () => {
      const optimizer = getAFlowOptimizer();
      const workflow = createTestWorkflow();

      const groups = optimizer.analyzeParallelism(workflow);
      // lint and typecheck have no dependencies on each other
      const lintTypecheck = groups.find(
        g => g.group.includes('lint') && g.group.includes('typecheck')
      );
      expect(lintTypecheck).toBeDefined();
    });

    it('does not suggest parallel for dependent steps', () => {
      const optimizer = getAFlowOptimizer();
      const workflow = createTestWorkflow();

      const groups = optimizer.analyzeParallelism(workflow);
      // test depends on lint, so they should NOT be in a parallel group
      const testBuild = groups.find(
        g => g.group.includes('test') && g.group.includes('build')
      );
      expect(testBuild).toBeUndefined();
    });

    it('returns empty for fully sequential workflow', () => {
      const optimizer = getAFlowOptimizer();
      const workflow: LobsterWorkflow = {
        name: 'sequential',
        version: '1.0',
        steps: [
          { id: 'a', name: 'A', command: 'cmd1' },
          { id: 'b', name: 'B', command: 'cmd2', dependsOn: ['a'] },
          { id: 'c', name: 'C', command: 'cmd3', dependsOn: ['b'] },
        ],
      };

      const groups = optimizer.analyzeParallelism(workflow);
      expect(groups).toHaveLength(0);
    });
  });

  describe('suggestTimeouts', () => {
    it('suggests timeouts based on historical data', () => {
      const optimizer = getAFlowOptimizer();
      const workflow = createTestWorkflow();
      const historical: StepResult[] = [
        { stepId: 'lint', status: 'success', stdout: '', exitCode: 0, duration: 3000 },
        { stepId: 'lint', status: 'success', stdout: '', exitCode: 0, duration: 4000 },
        { stepId: 'lint', status: 'success', stdout: '', exitCode: 0, duration: 5000 },
        { stepId: 'lint', status: 'success', stdout: '', exitCode: 0, duration: 3500 },
      ];

      const suggestions = optimizer.suggestTimeouts(workflow, historical);
      const lintTimeout = suggestions.get('lint');
      expect(lintTimeout).toBeDefined();
      expect(lintTimeout!).toBeGreaterThanOrEqual(5000); // min 5000ms
      expect(lintTimeout!).toBeLessThanOrEqual(15000); // reasonable upper bound
    });

    it('uses default for steps without history', () => {
      const optimizer = getAFlowOptimizer();
      const workflow = createTestWorkflow();

      const suggestions = optimizer.suggestTimeouts(workflow, []);
      // Should have defaults for all steps
      for (const step of workflow.steps) {
        expect(suggestions.has(step.id)).toBe(true);
      }
    });
  });

  describe('custom evaluator', () => {
    it('uses custom evaluation function', async () => {
      const optimizer = new AFlowOptimizer({
        iterations: 5,
        evaluator: (result) => result.successRate * 10, // Custom scoring
      });
      const workflow = createTestWorkflow();

      const result = await optimizer.optimize(workflow);
      expect(result.score).toBeGreaterThan(0);
    });
  });
});
