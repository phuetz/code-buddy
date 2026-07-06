import { BaseTool, ParameterDefinition } from './base-tool.js';
import { ToolResult } from '../types/index.js';
import { setAgentMode, AgentMode } from '../agent/plan-mode.js';
import { getOperatingModeManager } from '../agent/operating-modes.js';
import fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger.js';

export class SubmitPlanTool extends BaseTool {
  readonly name = 'submit_plan';
  readonly description = 'Submit your completed research and execution plan to the user for approval. Once approved, you will automatically exit Plan Mode and be granted write permissions to execute the plan.';

  constructor() {
    super();
  }

  protected getParameters(): Record<string, ParameterDefinition> {
    return {
      plan_content: {
        type: 'string',
        description: 'The detailed markdown content of your plan, explaining exactly what changes will be made, files to be modified, and commands to run.',
        required: true,
      },
    };
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const planContent = input.plan_content as string;

    // This emits a special signal for the CLI UI to intercept and prompt the user
    // We will throw a special error or return a specific status string that the AgentExecutor catches.
    // For now, we return a special result string.
    
    // Write plan to .codebuddy/plans/current.md for persistence
    try {
      const planDir = path.join(process.cwd(), '.codebuddy', 'plans');
      await fs.ensureDir(planDir);
      await fs.writeFile(path.join(planDir, 'current.md'), planContent);
    } catch (_e) {
      logger.warn('Failed to write plan file to disk');
    }

    return this.success(
      `__PLAN_APPROVAL_REQUEST__\n${planContent}`
    );
  }
}
