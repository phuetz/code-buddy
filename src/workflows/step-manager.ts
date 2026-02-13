/**
 * Step Manager - Manages individual step execution
 */

import { EventEmitter } from 'events';
import type { WorkflowStep, WorkflowContext, StepResult } from './types.js';
import { logger } from '../utils/logger.js';

export class StepManager extends EventEmitter {
  private actionHandlers: Map<string, (context: WorkflowContext) => Promise<StepResult>> = new Map();

  constructor() {
    super();
    this.registerBuiltInActions();
  }

  /**
   * Register built-in action handlers
   */
  private registerBuiltInActions(): void {
    // Log action
    this.registerAction('log', async (context) => {
      const message = context.variables.message || 'No message';
      logger.info(`[Workflow ${context.instanceId}] ${message}`);
      return { success: true, output: message };
    });

    // Delay action
    this.registerAction('delay', async (context) => {
      const ms = (context.variables.delay as number) || 1000;
      await new Promise(resolve => setTimeout(resolve, ms));
      return { success: true, output: `Delayed ${ms}ms` };
    });

    // Set variable action
    this.registerAction('setVariable', async (context) => {
      const name = context.variables.varName as string;
      const value = context.variables.varValue;
      if (name) {
        context.variables[name] = value;
      }
      return { success: true, output: { [name]: value } };
    });

    // Conditional action (always succeeds, used for branching)
    this.registerAction('conditional', async (context) => {
      return { success: true, output: context.variables };
    });

    // Noop action
    this.registerAction('noop', async () => {
      return { success: true, output: 'No operation performed' };
    });
  }

  /**
   * Register a custom action handler
   */
  registerAction(name: string, handler: (context: WorkflowContext) => Promise<StepResult>): void {
    this.actionHandlers.set(name, handler);
  }

  /**
   * Check if an action is registered
   */
  hasAction(name: string): boolean {
    return this.actionHandlers.has(name);
  }

  /**
   * Get all registered action names
   */
  getRegisteredActions(): string[] {
    return Array.from(this.actionHandlers.keys());
  }

  /**
   * Execute a step
   */
  async executeStep(
    step: WorkflowStep,
    context: WorkflowContext,
    options: { timeout?: number } = {}
  ): Promise<StepResult> {
    const startTime = Date.now();

    this.emit('step:start', { stepId: step.id, stepName: step.name });

    try {
      // Check condition
      if (step.condition) {
        const shouldRun = this.evaluateCondition(step.condition, context);
        if (!shouldRun) {
          this.emit('step:skipped', { stepId: step.id, reason: 'Condition not met' });
          return { success: true, output: 'Step skipped', metadata: { skipped: true } };
        }
      }

      // Execute action
      let result: StepResult;

      if (typeof step.action === 'function') {
        result = await this.executeWithTimeout(
          step.action(context),
          options.timeout || step.timeout || 30000
        );
      } else if (typeof step.action === 'string') {
        const handler = this.actionHandlers.get(step.action);
        if (!handler) {
          throw new Error(`Unknown action: ${step.action}`);
        }
        result = await this.executeWithTimeout(
          handler(context),
          options.timeout || step.timeout || 30000
        );
      } else {
        throw new Error('Invalid action type');
      }

      result.duration = Date.now() - startTime;

      this.emit('step:complete', {
        stepId: step.id,
        stepName: step.name,
        success: result.success,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.emit('step:error', {
        stepId: step.id,
        stepName: step.name,
        error: errorMessage,
        duration,
      });

      return {
        success: false,
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Step execution timed out after ${timeout}ms`));
      }, timeout);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Evaluate a condition
   */
  evaluateCondition(
    condition: string | ((context: WorkflowContext) => boolean),
    context: WorkflowContext
  ): boolean {
    if (typeof condition === 'function') {
      return condition(context);
    }

    // Simple condition evaluation for string conditions
    // Supports: "variable === value", "variable > value", etc.
    try {
      // Check for variable existence conditions
      if (condition.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
        return !!context.variables[condition];
      }

      // Check for comparison conditions
      const comparisonMatch = condition.match(/^(\w+)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/);
      if (comparisonMatch) {
        const [, variable, operator, valueStr] = comparisonMatch;
        const actualValue = context.variables[variable];
        let expectedValue: unknown = valueStr;

        // Parse value
        if (valueStr === 'true') expectedValue = true;
        else if (valueStr === 'false') expectedValue = false;
        else if (valueStr === 'null') expectedValue = null;
        else if (valueStr === 'undefined') expectedValue = undefined;
        else if (!isNaN(Number(valueStr))) expectedValue = Number(valueStr);
        else if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
          expectedValue = valueStr.slice(1, -1);
        }

        switch (operator) {
          case '===':
          case '==':
            return actualValue === expectedValue;
          case '!==':
          case '!=':
            return actualValue !== expectedValue;
          case '>':
            return (actualValue as number) > (expectedValue as number);
          case '<':
            return (actualValue as number) < (expectedValue as number);
          case '>=':
            return (actualValue as number) >= (expectedValue as number);
          case '<=':
            return (actualValue as number) <= (expectedValue as number);
        }
      }

      // Default to true for unrecognized conditions
      return true;
    } catch {
      return true;
    }
  }
}
