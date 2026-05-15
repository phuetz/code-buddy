/**
 * Pipeline Integration Tests
 *
 * Tests covering:
 * - Pipeline execution with transforms
 * - Pipeline parsing from pipe syntax
 * - Step chaining and output passing
 * - Error handling and fallbacks
 * - File loading and validation via PipelineCompositor methods
 * - Tool executor integration
 */

import {
  PipelineCompositor,
  formatPipelineFailureOutput,
  formatPipelineStepFailureOutput,
  resetPipelineCompositor,
} from '../../src/workflows/pipeline';
import type {
  PipelineStep,
  PipelineResult,
  ToolExecutor,
} from '../../src/workflows/pipeline';

describe('Pipeline Integration', () => {
  let compositor: PipelineCompositor;

  beforeEach(() => {
    resetPipelineCompositor();
    compositor = new PipelineCompositor();
  });

  afterEach(() => {
    compositor.dispose();
  });

  // ========================================================================
  // Transform Execution
  // ========================================================================

  describe('Transform Steps', () => {
    it('should execute a single transform step', async () => {
      const steps: PipelineStep[] = [
        { type: 'transform', name: 'uppercase', args: { _input: 'hello world' } },
      ];

      // Need to provide initial input through a tool executor for the first step
      // For transforms, the input comes from the args or previous step
      const result = await compositor.run('uppercase');

      // uppercase with empty input gives empty output
      expect(result.success).toBe(true);
      expect(result.output).toBe('');
    });

    it('should chain multiple transforms', async () => {
      const result = await compositor.run('uppercase | trim');
      expect(result.success).toBe(true);
      expect(result.steps.length).toBe(2);
    });

    it('should apply the trim transform', async () => {
      const steps: PipelineStep[] = [
        { type: 'transform', name: 'trim', args: {}, rawArgs: '' },
      ];

      const result = await compositor.execute(steps);
      expect(result.success).toBe(true);
    });

    it('should count lines with count transform', async () => {
      // We need a tool executor to provide initial data
      const mockExecutor: ToolExecutor = async (_name, _args, _input) => ({
        success: true,
        output: 'line1\nline2\nline3\n',
      });

      compositor.setToolExecutor(mockExecutor);

      // First step is a tool to get data, then count
      const result = await compositor.run('fetch-data | count');
      expect(result.success).toBe(true);
      expect(result.output).toBe('3');
    });

    it('should apply head transform with n argument', async () => {
      const mockExecutor: ToolExecutor = async () => ({
        success: true,
        output: 'a\nb\nc\nd\ne',
      });

      compositor.setToolExecutor(mockExecutor);

      const result = await compositor.run('get-data | head n=2');
      expect(result.success).toBe(true);
      expect(result.output).toBe('a\nb');
    });

    it('should apply tail transform with n argument', async () => {
      const mockExecutor: ToolExecutor = async () => ({
        success: true,
        output: 'a\nb\nc\nd\ne',
      });

      compositor.setToolExecutor(mockExecutor);

      const result = await compositor.run('get-data | tail n=2');
      expect(result.success).toBe(true);
      expect(result.output).toBe('d\ne');
    });

    it('should apply lowercase transform', async () => {
      const mockExecutor: ToolExecutor = async () => ({
        success: true,
        output: 'HELLO WORLD',
      });

      compositor.setToolExecutor(mockExecutor);

      const result = await compositor.run('get-text | lowercase');
      expect(result.success).toBe(true);
      expect(result.output).toBe('hello world');
    });
  });

  // ========================================================================
  // Pipe Parsing
  // ========================================================================

  describe('Pipeline Parsing', () => {
    it('should parse a simple pipe expression', () => {
      const tokens = compositor.parse('search "query" | summarize');
      expect(tokens.length).toBe(3); // step, operator, step
      expect(tokens[0].type).toBe('step');
      expect(tokens[0].step?.name).toBe('search');
      expect(tokens[1].type).toBe('operator');
      expect(tokens[1].operator).toBe('|');
      expect(tokens[2].type).toBe('step');
      expect(tokens[2].step?.name).toBe('summarize');
    });

    it('should parse fallback operator (||)', () => {
      const tokens = compositor.parse('fetch || fallback');
      expect(tokens.length).toBe(3);
      expect(tokens[1].operator).toBe('||');
    });

    it('should parse sequential operator (&&)', () => {
      const tokens = compositor.parse('step1 && step2');
      expect(tokens.length).toBe(3);
      expect(tokens[1].operator).toBe('&&');
    });

    it('should parse key=value arguments', () => {
      const tokens = compositor.parse('search query="hello world"');
      expect(tokens.length).toBe(1);
      expect(tokens[0].step?.args?.query).toBe('hello world');
    });

    it('should parse positional arguments', () => {
      const tokens = compositor.parse('search "hello"');
      expect(tokens.length).toBe(1);
      expect(tokens[0].step?.args?._input).toBeDefined();
    });

    it('should identify transform steps correctly', () => {
      const tokens = compositor.parse('uppercase | lowercase | trim');
      expect(tokens.length).toBe(5);
      expect(tokens[0].step?.type).toBe('transform');
      expect(tokens[2].step?.type).toBe('transform');
      expect(tokens[4].step?.type).toBe('transform');
    });

    it('should identify tool steps correctly', () => {
      const tokens = compositor.parse('web_search "query"');
      expect(tokens.length).toBe(1);
      expect(tokens[0].step?.type).toBe('tool');
    });

    it('should handle empty pipeline string', () => {
      const tokens = compositor.parse('');
      expect(tokens.length).toBe(0);
    });

    it('should handle complex multi-step pipeline', () => {
      const tokens = compositor.parse('search "test" | grep pattern="error" | count | head n=5');
      expect(tokens.length).toBe(7); // 4 steps + 3 operators
    });
  });

  // ========================================================================
  // Tool Executor Integration
  // ========================================================================

  describe('Tool Executor', () => {
    it('should execute tools via the configured executor', async () => {
      const mockExecutor: ToolExecutor = jest.fn(async (toolName, args, input) => ({
        success: true,
        output: `Result from ${toolName}`,
      }));

      compositor.setToolExecutor(mockExecutor);

      const result = await compositor.run('web_search "hello"');
      expect(result.success).toBe(true);
      expect(result.output).toBe('Result from web_search');
      expect(mockExecutor).toHaveBeenCalledTimes(1);
    });

    it('should pass output from one step to the next', async () => {
      const calls: Array<{ name: string; input: string | undefined }> = [];
      const mockExecutor: ToolExecutor = jest.fn(async (toolName, _args, input) => {
        calls.push({ name: toolName, input });
        return {
          success: true,
          output: `output-of-${toolName}`,
        };
      });

      compositor.setToolExecutor(mockExecutor);

      const result = await compositor.run('step1 | step2 | step3');
      expect(result.success).toBe(true);
      expect(calls).toHaveLength(3);
      expect(calls[0].name).toBe('step1');
      expect(calls[1].input).toBe('output-of-step1');
      expect(calls[2].input).toBe('output-of-step2');
      expect(result.output).toBe('output-of-step3');
    });

    it('should fail gracefully when no executor is configured', async () => {
      const result = await compositor.run('some_tool');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No tool executor configured');
    });

    it('should handle tool execution failure', async () => {
      const mockExecutor: ToolExecutor = jest.fn(async () => ({
        success: false,
        output: '',
        error: 'Tool failed',
      }));

      compositor.setToolExecutor(mockExecutor);

      const result = await compositor.run('failing_tool');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool failed');
      expect(result.output).toBe('Pipeline failed: Tool failed');
      expect(result.steps[0].output).toBe("Step 'failing_tool' failed: Tool failed");
    });

    it('should surface failed tool output when error details are missing', async () => {
      const mockExecutor: ToolExecutor = jest.fn(async () => ({
        success: false,
        output: 'stderr-only failure',
      }));

      compositor.setToolExecutor(mockExecutor);

      const result = await compositor.run('failing_tool');
      expect(result.success).toBe(false);
      expect(result.error).toBe('stderr-only failure');
      expect(result.output).toBe('Pipeline failed: stderr-only failure');
      expect(result.steps[0].output).toBe("Step 'failing_tool' failed: stderr-only failure");
    });

    it('should stop pipeline on step failure', async () => {
      let callCount = 0;
      const mockExecutor: ToolExecutor = jest.fn(async (toolName) => {
        callCount++;
        if (toolName === 'step2') {
          return { success: false, output: '', error: 'Step 2 broke' };
        }
        return { success: true, output: `ok-${toolName}` };
      });

      compositor.setToolExecutor(mockExecutor);

      const result = await compositor.run('step1 | step2 | step3');
      expect(result.success).toBe(false);
      expect(callCount).toBe(2); // step3 should not be called
      expect(result.steps).toHaveLength(2);
      expect(result.output).toBe('Pipeline failed: Step 2 broke');
      expect(result.steps[1].output).toBe("Step 'step2' failed: Step 2 broke");
    });
  });

  // ========================================================================
  // Pipeline Execution
  // ========================================================================

  describe('Pipeline Execution', () => {
    it('should execute an array of steps programmatically', async () => {
      const mockExecutor: ToolExecutor = jest.fn(async (toolName) => ({
        success: true,
        output: `done-${toolName}`,
      }));

      compositor.setToolExecutor(mockExecutor);

      const steps: PipelineStep[] = [
        { type: 'tool', name: 'analyze', args: {} },
        { type: 'tool', name: 'summarize', args: {} },
      ];

      const result = await compositor.execute(steps);
      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(2);
      expect(result.output).toBe('done-summarize');
    });

    it('should track duration for each step', async () => {
      const mockExecutor: ToolExecutor = jest.fn(async () => {
        await new Promise(r => setTimeout(r, 10));
        return { success: true, output: 'ok' };
      });

      compositor.setToolExecutor(mockExecutor);

      const result = await compositor.run('step1 | step2');
      expect(result.totalDurationMs).toBeGreaterThan(0);
      expect(result.steps[0].durationMs).toBeGreaterThan(0);
    });

    it('should emit step events', async () => {
      const events: string[] = [];
      compositor.on('step:start', () => events.push('start'));
      compositor.on('step:complete', () => events.push('complete'));
      compositor.on('pipeline:complete', () => events.push('pipeline-done'));

      const result = await compositor.run('uppercase');
      expect(result.success).toBe(true);
      expect(events).toContain('start');
      expect(events).toContain('complete');
      expect(events).toContain('pipeline-done');
    });

    it('should enforce maxSteps limit', async () => {
      const limitedCompositor = new PipelineCompositor({ maxSteps: 2 });
      const mockExecutor: ToolExecutor = jest.fn(async () => ({
        success: true,
        output: 'ok',
      }));

      limitedCompositor.setToolExecutor(mockExecutor);

      const result = await limitedCompositor.run('s1 | s2 | s3');
      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds maximum');
      expect(result.output).toBe('Pipeline failed: Pipeline exceeds maximum of 2 steps');

      limitedCompositor.dispose();
    });
  });

  describe('Failure Formatting', () => {
    it('should format pipeline failures without blank output', () => {
      expect(formatPipelineFailureOutput('boom')).toBe('Pipeline failed: boom');
      expect(formatPipelineFailureOutput('')).toBe('Pipeline failed without error details.');
    });

    it('should format step failures without blank output', () => {
      const step: PipelineStep = { type: 'tool', name: 'compile', args: {} };

      expect(formatPipelineStepFailureOutput(step, 'boom')).toBe("Step 'compile' failed: boom");
      expect(formatPipelineStepFailureOutput(step, '')).toBe(
        "Step 'compile' failed without error details."
      );
    });
  });

  // ========================================================================
  // Validation
  // ========================================================================

  describe('validateDefinition', () => {
    it('should validate a correct set of steps', () => {
      const steps: PipelineStep[] = [
        { type: 'tool', name: 'search', args: {} },
        { type: 'transform', name: 'uppercase', args: {} },
      ];

      const result = compositor.validateDefinition(steps);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty steps array', () => {
      const result = compositor.validateDefinition([]);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Pipeline must have at least one step');
    });

    it('should reject steps with missing names', () => {
      const steps: PipelineStep[] = [
        { type: 'tool', name: '', args: {} },
      ];

      const result = compositor.validateDefinition(steps);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('missing name'))).toBe(true);
    });

    it('should warn about unknown transforms', () => {
      const steps: PipelineStep[] = [
        { type: 'transform', name: 'nonexistent_transform', args: {} },
      ];

      const result = compositor.validateDefinition(steps);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('unknown transform'))).toBe(true);
    });

    it('should reject invalid step types', () => {
      const steps: PipelineStep[] = [
        { type: 'invalid' as 'tool', name: 'bad', args: {} },
      ];

      const result = compositor.validateDefinition(steps);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('invalid type'))).toBe(true);
    });

    it('should warn about duplicate names', () => {
      const steps: PipelineStep[] = [
        { type: 'tool', name: 'search', args: {} },
        { type: 'tool', name: 'search', args: {} },
      ];

      const result = compositor.validateDefinition(steps);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('duplicate name'))).toBe(true);
    });
  });

  // ========================================================================
  // Custom Transforms
  // ========================================================================

  describe('Custom Transforms', () => {
    it('should register and use a custom transform', async () => {
      compositor.registerTransform('reverse', (input) => input.split('').reverse().join(''));

      const mockExecutor: ToolExecutor = jest.fn(async () => ({
        success: true,
        output: 'hello',
      }));

      compositor.setToolExecutor(mockExecutor);

      const result = await compositor.run('get-text | reverse');
      expect(result.success).toBe(true);
      expect(result.output).toBe('olleh');
    });

    it('should list all available transforms including custom ones', () => {
      const initialCount = compositor.listTransforms().length;
      compositor.registerTransform('custom1', (input) => input);
      expect(compositor.listTransforms().length).toBe(initialCount + 1);
      expect(compositor.listTransforms()).toContain('custom1');
    });
  });

  // ========================================================================
  // Mixed Tool + Transform Pipelines
  // ========================================================================

  describe('Mixed Pipelines', () => {
    it('should chain tools and transforms together', async () => {
      const mockExecutor: ToolExecutor = jest.fn(async (toolName, _args, input) => ({
        success: true,
        output: `  Result from ${toolName}  `,
      }));

      compositor.setToolExecutor(mockExecutor);

      const result = await compositor.run('web_search "query" | trim | uppercase');
      expect(result.success).toBe(true);
      expect(result.output).toBe('RESULT FROM WEB_SEARCH');
      expect(result.steps).toHaveLength(3);
    });

    it('should handle wrap transform with prefix/suffix args', async () => {
      const mockExecutor: ToolExecutor = jest.fn(async () => ({
        success: true,
        output: 'content',
      }));

      compositor.setToolExecutor(mockExecutor);

      const result = await compositor.run('get-data | wrap prefix="[" suffix="]"');
      expect(result.success).toBe(true);
      expect(result.output).toBe('[content]');
    });
  });
});
