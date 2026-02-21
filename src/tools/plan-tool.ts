
import { BaseTool, ParameterDefinition } from './base-tool.js';
import { ToolResult } from '../types/index.js';
import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * PlanTool
 * 
 * Manages a persistent PLAN.md file to track complex task execution.
 * This aligns with the "Open Manus" / "CodeAct" philosophy of maintaining
 * a visible, persistent state of the agent's plan.
 */
export class PlanTool extends BaseTool {
  readonly name = 'plan';
  readonly description = 'Manage a persistent execution plan (PLAN.md). Use this to track progress on complex tasks.';
  
  private planPath: string;

  constructor(cwd: string = process.cwd()) {
    super();
    this.planPath = path.join(cwd, 'PLAN.md');
  }

  protected getParameters(): Record<string, ParameterDefinition> {
    return {
      action: {
        type: 'string',
        description: 'Action to perform: "init" (create new), "read" (view), "update" (mark step), "append" (add step).',
        enum: ['init', 'read', 'update', 'append'],
        required: true,
      },
      goal: {
        type: 'string',
        description: 'The main goal for "init" action.',
      },
      step: {
        type: 'string',
        description: 'The step description for "append" or the text to match for "update".',
      },
      status: {
        type: 'string',
        description: 'Status for "update" action: "pending" ([ ]), "in_progress" ([/]), "completed" ([x]), "failed" ([-]).',
        enum: ['pending', 'in_progress', 'completed', 'failed'],
      }
    };
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;
    
    try {
      if (action === 'init') {
        return this.initPlan(input.goal as string);
      } else if (action === 'read') {
        return this.readPlan();
      } else if (action === 'append') {
        return this.appendStep(input.step as string);
      } else if (action === 'update') {
        return this.updateStep(input.step as string, input.status as string);
      } else {
        return this.error(`Unknown action: ${action}`);
      }
    } catch (err) {
      return this.error(`Plan operation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async initPlan(goal: string): Promise<ToolResult> {
    if (!goal) return this.error('Goal is required for init');
    
    const content = `# Execution Plan

**Goal:** ${goal}

## Steps
`;
    await fs.writeFile(this.planPath, content);
    
    return this.success(`Created new plan at ${this.planPath}`, { content });
  }

  private async readPlan(): Promise<ToolResult> {
    if (!await fs.pathExists(this.planPath)) {
      return this.error('No PLAN.md found. Initialize one first.');
    }
    const content = await fs.readFile(this.planPath, 'utf-8');
    return this.success(content);
  }

  private async appendStep(step: string): Promise<ToolResult> {
    if (!step) return this.error('Step description is required for append');
    if (!await fs.pathExists(this.planPath)) return this.error('No PLAN.md found.');

    const line = `- [ ] ${step}
`;
    await fs.appendFile(this.planPath, line);
    
    return this.readPlan();
  }

  private async updateStep(stepMatch: string, status: string): Promise<ToolResult> {
    if (!stepMatch) return this.error('Step match text is required for update');
    if (!await fs.pathExists(this.planPath)) return this.error('No PLAN.md found.');

    const content = await fs.readFile(this.planPath, 'utf-8');
    const lines = content.split('\n');
    let updated = false;

    const marker = this.getStatusMarker(status);

    const newLines = lines.map(line => {
      // Simple fuzzy match: if the line contains the text and looks like a task
      if (line.includes(stepMatch) && line.trim().startsWith('- [')) {
        updated = true;
        // Replace the marker [ ] or [x] with new marker
        return line.replace(/- \[[^\]]*\]/, `- [${marker}]`);
      }
      return line;
    });

    if (!updated) {
      return this.error(`Could not find a task matching "${stepMatch}"`);
    }

    const newContent = newLines.join('\n');
    await fs.writeFile(this.planPath, newContent);
    return this.success(`Updated task status to ${status}\n\n${newContent}`);
  }

  private getStatusMarker(status: string): string {
    switch (status) {
      case 'completed': return 'x';
      case 'in_progress': return '/';
      case 'failed': return '-';
      default: return ' ';
    }
  }
}
