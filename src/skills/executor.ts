/**
 * Skill Executor
 *
 * Executes skills by interpreting their content and invoking tools.
 */

import { EventEmitter } from 'events';
import type {
  Skill,
  SkillExecutionContext,
  SkillExecutionResult,
  SkillStep,
  SkillToolInvocation,
  SkillCodeBlock,
} from './types.js';
import { SkillVariableResolver, type SkillContext } from './skill-enhancements.js';
import { resolveBashInjections } from './bash-injection.js';

// ============================================================================
// Types
// ============================================================================

export interface SkillExecutorConfig {
  /** Maximum execution time in ms */
  timeout: number;
  /** Enable step-by-step execution */
  stepMode: boolean;
  /** Tool executor function */
  toolExecutor?: ToolExecutorFn;
  /** Code executor function */
  codeExecutor?: CodeExecutorFn;
}

export type ToolExecutorFn = (
  tool: string,
  args: Record<string, unknown>
) => Promise<unknown>;

export type CodeExecutorFn = (
  code: string,
  language: string,
  context: Record<string, unknown>
) => Promise<unknown>;

export const DEFAULT_EXECUTOR_CONFIG: SkillExecutorConfig = {
  timeout: 60000,
  stepMode: false,
};

// ============================================================================
// Skill Executor Class
// ============================================================================

export class SkillExecutor extends EventEmitter {
  private config: SkillExecutorConfig;

  constructor(config: Partial<SkillExecutorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
  }

  // ==========================================================================
  // Execution
  // ==========================================================================

  /**
   * Execute a skill
   */
  async execute(skill: Skill, context: SkillExecutionContext): Promise<SkillExecutionResult> {
    const startTime = Date.now();
    const toolCalls: SkillExecutionResult['toolCalls'] = [];
    this.emit('skill:start', skill, context);

    try {
      // Check requirements
      const reqCheck = this.checkRequirements(skill, context);
      if (!reqCheck.met) {
        const result: SkillExecutionResult = {
          success: false,
          error: `Requirements not met: ${reqCheck.missing.join(', ')}`,
          duration: Date.now() - startTime,
        };
        this.emit('skill:executed', skill, result);
        return result;
      }

      // CC11: Resolve $ARGUMENTS and other skill variables in raw markdown
      const resolver = new SkillVariableResolver();
      const skillCtx: SkillContext = {
        arguments: context.request ? context.request.split(/\s+/) : [],
        workingDir: context.cwd,
      };
      if (skill.content.rawMarkdown) {
        skill.content.rawMarkdown = resolver.resolve(skill.content.rawMarkdown, skillCtx);
      }
      if (skill.content.description) {
        skill.content.description = resolver.resolve(skill.content.description, skillCtx);
      }

      // CC11: Resolve !`command` bash injections
      if (skill.content.rawMarkdown) {
        skill.content.rawMarkdown = resolveBashInjections(skill.content.rawMarkdown, context.cwd);
      }
      if (skill.content.description) {
        skill.content.description = resolveBashInjections(skill.content.description, context.cwd);
      }

      // Execute based on skill content
      let output: string | undefined;

      // If skill has explicit steps, execute them
      if (skill.content.steps && skill.content.steps.length > 0) {
        output = await this.executeSteps(skill.content.steps, context, toolCalls);
      }
      // If skill has tool invocations, execute them
      else if (skill.content.tools && skill.content.tools.length > 0) {
        output = await this.executeTools(skill.content.tools, context, toolCalls);
      }
      // If skill has code blocks, execute them
      else if (skill.content.codeBlocks && skill.content.codeBlocks.length > 0) {
        output = await this.executeCodeBlocks(skill.content.codeBlocks, context);
      }
      // Otherwise, return the skill description as guidance
      else {
        output = this.formatSkillGuidance(skill, context);
      }

      const result: SkillExecutionResult = {
        success: true,
        output,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        duration: Date.now() - startTime,
      };
      this.emit('skill:executed', skill, result);
      return result;
    } catch (error) {
      const result: SkillExecutionResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        duration: Date.now() - startTime,
      };
      this.emit('skill:error', skill.metadata.name, error);
      this.emit('skill:executed', skill, result);
      return result;
    }
  }

  /**
   * Check if skill requirements are met
   */
  private checkRequirements(
    skill: Skill,
    context: SkillExecutionContext
  ): { met: boolean; missing: string[] } {
    const missing: string[] = [];

    if (!skill.metadata.requires) {
      return { met: true, missing: [] };
    }

    // Check required tools
    if (skill.metadata.requires.tools) {
      for (const tool of skill.metadata.requires.tools) {
        if (!context.tools?.includes(tool)) {
          missing.push(`tool:${tool}`);
        }
      }
    }

    // Check required environment variables
    if (skill.metadata.requires.env) {
      for (const envVar of skill.metadata.requires.env) {
        if (!context.env?.[envVar] && !process.env[envVar]) {
          missing.push(`env:${envVar}`);
        }
      }
    }

    return { met: missing.length === 0, missing };
  }

  // ==========================================================================
  // Step Execution
  // ==========================================================================

  /**
   * Execute skill steps
   */
  private async executeSteps(
    steps: SkillStep[],
    context: SkillExecutionContext,
    toolCalls: NonNullable<SkillExecutionResult['toolCalls']>
  ): Promise<string> {
    const outputs: string[] = [];
    const stepContext: Record<string, unknown> = {
      request: context.request,
      ...context.config,
    };

    for (const step of steps) {
      // Check condition
      if (step.condition && !this.evaluateCondition(step.condition, stepContext)) {
        continue;
      }

      this.emit('step:start', step.index, step.description);

      // Execute tool if specified
      if (step.tool && this.config.toolExecutor) {
        const args = this.interpolateArgs({}, stepContext);
        const result = await this.config.toolExecutor(step.tool, args);
        toolCalls.push({ tool: step.tool, args, result });
        stepContext[`step${step.index}`] = result;
        outputs.push(`Step ${step.index + 1}: ${step.description}\nResult: ${JSON.stringify(result)}`);
      }
      // Execute code if specified
      else if (step.code && this.config.codeExecutor) {
        const result = await this.config.codeExecutor(step.code, 'javascript', stepContext);
        stepContext[`step${step.index}`] = result;
        outputs.push(`Step ${step.index + 1}: ${step.description}\nResult: ${JSON.stringify(result)}`);
      }
      // Otherwise just note the step
      else {
        outputs.push(`Step ${step.index + 1}: ${step.description}`);
      }

      this.emit('step:complete', step.index, stepContext[`step${step.index}`]);
    }

    return outputs.join('\n\n');
  }

  // ==========================================================================
  // Tool Execution
  // ==========================================================================

  /**
   * Execute tool invocations
   */
  private async executeTools(
    tools: SkillToolInvocation[],
    context: SkillExecutionContext,
    toolCalls: NonNullable<SkillExecutionResult['toolCalls']>
  ): Promise<string> {
    if (!this.config.toolExecutor) {
      return 'Tool executor not configured';
    }

    const outputs: string[] = [];
    const toolContext: Record<string, unknown> = {
      request: context.request,
      ...context.config,
    };

    for (const tool of tools) {
      this.emit('tool:start', tool.name);

      const args = this.interpolateArgs(tool.args || {}, toolContext);
      const result = await this.config.toolExecutor(tool.name, args);

      toolCalls.push({ tool: tool.name, args, result });
      toolContext[tool.name] = result;

      const desc = tool.description ? ` (${tool.description})` : '';
      outputs.push(`${tool.name}${desc}: ${JSON.stringify(result)}`);

      this.emit('tool:complete', tool.name, result);
    }

    return outputs.join('\n');
  }

  // ==========================================================================
  // Code Execution
  // ==========================================================================

  /**
   * Execute code blocks
   */
  private async executeCodeBlocks(
    blocks: SkillCodeBlock[],
    context: SkillExecutionContext
  ): Promise<string> {
    if (!this.config.codeExecutor) {
      return 'Code executor not configured';
    }

    const outputs: string[] = [];
    const codeContext: Record<string, unknown> = {
      request: context.request,
      ...context.config,
    };

    for (const block of blocks) {
      this.emit('code:start', block.label || block.language);

      const result = await this.config.codeExecutor(block.code, block.language, codeContext);
      codeContext[block.label || `block_${blocks.indexOf(block)}`] = result;

      const label = block.label ? `[${block.label}]` : `[${block.language}]`;
      outputs.push(`${label}:\n${JSON.stringify(result)}`);

      this.emit('code:complete', block.label || block.language, result);
    }

    return outputs.join('\n\n');
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Format skill as guidance text
   */
  private formatSkillGuidance(skill: Skill, context: SkillExecutionContext): string {
    const lines: string[] = [
      `# ${skill.metadata.name}`,
      '',
      skill.metadata.description,
      '',
    ];

    if (skill.content.usage) {
      lines.push('## When to Use', '', skill.content.usage, '');
    }

    if (skill.content.description) {
      lines.push('## Instructions', '', skill.content.description, '');
    }

    if (skill.content.examples && skill.content.examples.length > 0) {
      lines.push('## Examples', '');
      for (const example of skill.content.examples) {
        lines.push(`- "${example.request}"`);
        if (example.response) {
          lines.push(`  → ${example.response}`);
        }
      }
      lines.push('');
    }

    lines.push(`User request: "${context.request}"`);

    return lines.join('\n');
  }

  /**
   * Interpolate template variables in arguments
   */
  private interpolateArgs(
    args: Record<string, unknown>,
    context: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
        const varName = value.slice(2, -2).trim();
        result[key] = this.resolveVariable(varName, context);
      } else if (typeof value === 'string') {
        result[key] = value.replace(/\{\{([^}]+)\}\}/g, (_, varName) => {
          const resolved = this.resolveVariable(varName.trim(), context);
          return String(resolved);
        });
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Resolve a variable from context
   */
  private resolveVariable(name: string, context: Record<string, unknown>): unknown {
    const parts = name.split('.');
    let value: unknown = context;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Evaluate a condition string
   */
  private evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
    try {
      // Simple variable presence check
      if (condition.startsWith('has:')) {
        const varName = condition.slice(4);
        return this.resolveVariable(varName, context) !== undefined;
      }

      // Simple comparison: "varName == value"
      const compMatch = condition.match(/^(\w+)\s*(==|!=|>|<|>=|<=)\s*(.+)$/);
      if (compMatch) {
        const [, varName, op, valueStr] = compMatch;
        const varValue = this.resolveVariable(varName, context);
        const compareValue = this.parseConditionValue(valueStr);

        switch (op) {
          case '==': return varValue === compareValue;
          case '!=': return varValue !== compareValue;
          case '>': return Number(varValue) > Number(compareValue);
          case '<': return Number(varValue) < Number(compareValue);
          case '>=': return Number(varValue) >= Number(compareValue);
          case '<=': return Number(varValue) <= Number(compareValue);
        }
      }

      // Default: truthy check
      return !!this.resolveVariable(condition, context);
    } catch {
      return false;
    }
  }

  /**
   * Parse a condition value
   */
  private parseConditionValue(value: string): unknown {
    const trimmed = value.trim();

    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;

    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }

    const num = Number(trimmed);
    if (!isNaN(num)) return num;

    return trimmed;
  }

  /**
   * Configure tool executor
   */
  setToolExecutor(executor: ToolExecutorFn): void {
    this.config.toolExecutor = executor;
  }

  /**
   * Configure code executor
   */
  setCodeExecutor(executor: CodeExecutorFn): void {
    this.config.codeExecutor = executor;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let executorInstance: SkillExecutor | null = null;

export function getSkillExecutor(config?: Partial<SkillExecutorConfig>): SkillExecutor {
  if (!executorInstance) {
    executorInstance = new SkillExecutor(config);
  }
  return executorInstance;
}

export function resetSkillExecutor(): void {
  executorInstance = null;
}

export default SkillExecutor;
