/**
 * Planning Flow — OpenManus-compatible
 * Multi-agent orchestrated execution with step-by-step plan decomposition.
 *
 * Dual execution mode:
 * - Direct Mode: single agent ReAct loop (existing CodeBuddyAgent.processUserMessage)
 * - Flow Mode: PlanningFlow decomposes task into steps, delegates to specialist agents
 */

import { EventEmitter } from 'events';
import { AgentStateMachine, AgentStatus } from '../state-machine.js';

/* ── Types ── */

export enum PlanStepStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  BLOCKED = 'blocked',
  SKIPPED = 'skipped',
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  status: PlanStepStatus;
  /** Agent key to delegate to (e.g., 'swe', 'browser', 'data') */
  agentKey?: string;
  /** IDs of steps that must complete first */
  dependencies: string[];
  /** Result from execution */
  result?: string;
  /** Error if failed */
  error?: string;
  /** Execution time in ms */
  duration?: number;
}

export interface ExecutionPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  createdAt: number;
  completedAt?: number;
}

/** Minimal agent interface for flow execution */
export interface FlowAgent {
  name: string;
  run(request: string): Promise<string>;
}

export interface PlanningFlowConfig {
  /** Function to call LLM for plan generation */
  planWithLLM: (prompt: string) => Promise<string>;
  /** Registered agents by key */
  agents: Map<string, FlowAgent>;
  /** Default agent key when step doesn't specify one */
  defaultAgentKey: string;
  /** Max retries for failed steps */
  maxRetries: number;
}

/* ── Planning Flow ── */

export class PlanningFlow extends EventEmitter {
  private config: PlanningFlowConfig;
  private stateMachine: AgentStateMachine;
  private activePlan: ExecutionPlan | null = null;

  constructor(config: PlanningFlowConfig) {
    super();
    this.config = config;
    this.stateMachine = new AgentStateMachine(100); // Max 100 flow steps

    this.stateMachine.on('transition', (e) => this.emit('flow:transition', e));
  }

  /** Current plan */
  get plan(): ExecutionPlan | null {
    return this.activePlan;
  }

  /** Current status */
  get status(): AgentStatus {
    return this.stateMachine.status;
  }

  /**
   * Execute a task using the planning flow.
   * 1. Create plan from goal
   * 2. Execute each step with the appropriate agent
   * 3. Synthesize final result
   */
  async execute(goal: string): Promise<string> {
    this.stateMachine.start(`Flow: ${goal.substring(0, 80)}`);
    this.emit('flow:start', { goal });

    try {
      // Phase 1: Create plan
      this.emit('flow:phase', { phase: 'planning', goal });
      this.activePlan = await this.createPlan(goal);
      this.emit('flow:plan_created', { plan: this.activePlan });

      // Phase 2: Execute steps
      this.emit('flow:phase', { phase: 'execution' });
      await this.executeSteps();

      // Phase 3: Synthesize results
      this.emit('flow:phase', { phase: 'synthesis' });
      const summary = await this.synthesize();

      this.activePlan.completedAt = Date.now();
      this.stateMachine.finish('Flow completed');
      this.emit('flow:complete', { summary, plan: this.activePlan });

      return summary;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.stateMachine.fail(error);
      this.emit('flow:error', { error });
      return `Flow failed: ${error.message}`;
    }
  }

  /** Phase 1: Generate a structured plan from the goal */
  private async createPlan(goal: string): Promise<ExecutionPlan> {
    const prompt = `You are a task planner. Decompose this goal into concrete, actionable steps.

Goal: ${goal}

Respond with a JSON object:
{
  "steps": [
    {
      "id": "step_1",
      "title": "Short title",
      "description": "Detailed description of what to do",
      "agentKey": "swe|browser|data|default",
      "dependencies": []
    }
  ]
}

Rules:
- Each step should be independently executable by an agent
- Use "swe" for code editing/debugging, "browser" for web tasks, "data" for analysis
- Use "default" if unsure which agent to use
- Add dependencies only when a step truly requires another step's output
- Keep steps focused and atomic (one action per step)
- 3-10 steps for most tasks

Respond ONLY with the JSON object, no markdown fences.`;

    const response = await this.config.planWithLLM(prompt);

    // Parse LLM response
    let parsed: { steps: Array<{ id: string; title: string; description: string; agentKey?: string; dependencies?: string[] }> };
    try {
      // Strip markdown fences if present
      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback: single step with the full goal
      parsed = {
        steps: [
          {
            id: 'step_1',
            title: 'Execute task',
            description: goal,
            agentKey: this.config.defaultAgentKey,
            dependencies: [],
          },
        ],
      };
    }

    const plan: ExecutionPlan = {
      id: `plan_${Date.now()}`,
      goal,
      steps: parsed.steps.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        status: PlanStepStatus.NOT_STARTED,
        agentKey: s.agentKey || this.config.defaultAgentKey,
        dependencies: s.dependencies || [],
      })),
      createdAt: Date.now(),
    };

    return plan;
  }

  /** Phase 2: Execute plan steps in dependency order */
  private async executeSteps(): Promise<void> {
    const plan = this.activePlan!;
    let retries = 0;

    while (true) {
      // Find next ready steps (no unfinished dependencies)
      const ready = this.getReadySteps(plan);

      if (ready.length === 0) {
        // Check if all steps are terminal
        const allTerminal = plan.steps.every(
          (s) =>
            s.status === PlanStepStatus.COMPLETED ||
            s.status === PlanStepStatus.FAILED ||
            s.status === PlanStepStatus.SKIPPED
        );
        if (allTerminal) break;

        // No ready steps but not all terminal → blocked
        const blocked = plan.steps.filter((s) => s.status === PlanStepStatus.NOT_STARTED);
        for (const step of blocked) {
          step.status = PlanStepStatus.BLOCKED;
          step.error = 'Dependencies cannot be satisfied';
        }
        break;
      }

      // Execute ready steps (could be parallelized but sequential for safety)
      for (const step of ready) {
        await this.executeStep(step);

        if (step.status === PlanStepStatus.FAILED && retries < this.config.maxRetries) {
          // Retry failed step once
          step.status = PlanStepStatus.NOT_STARTED;
          step.error = undefined;
          retries++;
          this.emit('flow:retry', { stepId: step.id, retries });
        }
      }

      this.stateMachine.incrementStep();
    }
  }

  /** Get steps whose dependencies are all completed */
  private getReadySteps(plan: ExecutionPlan): PlanStep[] {
    return plan.steps.filter((step) => {
      if (step.status !== PlanStepStatus.NOT_STARTED) return false;

      return step.dependencies.every((depId) => {
        const dep = plan.steps.find((s) => s.id === depId);
        return dep && dep.status === PlanStepStatus.COMPLETED;
      });
    });
  }

  /** Execute a single plan step with the appropriate agent */
  private async executeStep(step: PlanStep): Promise<void> {
    const agentKey = step.agentKey || this.config.defaultAgentKey;
    const agent = this.config.agents.get(agentKey) || this.config.agents.get(this.config.defaultAgentKey);

    if (!agent) {
      step.status = PlanStepStatus.FAILED;
      step.error = `No agent found for key: ${agentKey}`;
      this.emit('flow:step_failed', { stepId: step.id, error: step.error });
      return;
    }

    step.status = PlanStepStatus.IN_PROGRESS;
    this.emit('flow:step_start', { stepId: step.id, title: step.title, agent: agent.name });

    const startTime = Date.now();

    try {
      // Build context: include results from completed dependencies
      const context = this.buildStepContext(step);
      const result = await agent.run(context);

      step.status = PlanStepStatus.COMPLETED;
      step.result = result;
      step.duration = Date.now() - startTime;

      this.emit('flow:step_complete', {
        stepId: step.id,
        title: step.title,
        duration: step.duration,
        resultPreview: result.substring(0, 200),
      });
    } catch (err) {
      step.status = PlanStepStatus.FAILED;
      step.error = err instanceof Error ? err.message : String(err);
      step.duration = Date.now() - startTime;

      this.emit('flow:step_failed', { stepId: step.id, error: step.error });

      // Skip dependent steps
      this.skipDependents(step.id);
    }
  }

  /** Build execution context for a step, including dependency results */
  private buildStepContext(step: PlanStep): string {
    const parts: string[] = [];

    parts.push(`## Task\n${step.description}`);

    // Include results from dependencies
    if (step.dependencies.length > 0) {
      const depResults = step.dependencies
        .map((depId) => {
          const dep = this.activePlan!.steps.find((s) => s.id === depId);
          return dep?.result ? `### ${dep.title}\n${dep.result}` : null;
        })
        .filter(Boolean);

      if (depResults.length > 0) {
        parts.push(`## Previous Results\n${depResults.join('\n\n')}`);
      }
    }

    // Include overall goal for context
    parts.push(`## Overall Goal\n${this.activePlan!.goal}`);

    return parts.join('\n\n');
  }

  /** Skip steps that depend on a failed step */
  private skipDependents(failedStepId: string): void {
    const plan = this.activePlan!;

    for (const step of plan.steps) {
      if (step.dependencies.includes(failedStepId) && step.status === PlanStepStatus.NOT_STARTED) {
        step.status = PlanStepStatus.SKIPPED;
        step.error = `Skipped: dependency ${failedStepId} failed`;
        this.emit('flow:step_skipped', { stepId: step.id, reason: step.error });

        // Cascade
        this.skipDependents(step.id);
      }
    }
  }

  /** Phase 3: Synthesize final results from all completed steps */
  private async synthesize(): Promise<string> {
    const plan = this.activePlan!;
    const completed = plan.steps.filter((s) => s.status === PlanStepStatus.COMPLETED);
    const failed = plan.steps.filter((s) => s.status === PlanStepStatus.FAILED);
    const skipped = plan.steps.filter((s) => s.status === PlanStepStatus.SKIPPED);

    const summaryParts: string[] = [];
    summaryParts.push(`# Execution Summary\n**Goal:** ${plan.goal}`);
    summaryParts.push(`**Steps:** ${completed.length} completed, ${failed.length} failed, ${skipped.length} skipped`);

    if (completed.length > 0) {
      summaryParts.push('\n## Completed');
      for (const step of completed) {
        summaryParts.push(`- **${step.title}** (${step.duration}ms): ${step.result?.substring(0, 150) || 'OK'}`);
      }
    }

    if (failed.length > 0) {
      summaryParts.push('\n## Failed');
      for (const step of failed) {
        summaryParts.push(`- **${step.title}**: ${step.error}`);
      }
    }

    return summaryParts.join('\n');
  }

  /** Get plan progress as percentage */
  getProgress(): number {
    if (!this.activePlan) return 0;
    const total = this.activePlan.steps.length;
    if (total === 0) return 100;
    const done = this.activePlan.steps.filter(
      (s) => s.status === PlanStepStatus.COMPLETED || s.status === PlanStepStatus.SKIPPED || s.status === PlanStepStatus.FAILED
    ).length;
    return Math.round((done / total) * 100);
  }
}

/* ── Flow Factory ── */

export enum FlowType {
  PLANNING = 'planning',
}

export function createFlow(type: FlowType, config: PlanningFlowConfig): PlanningFlow {
  switch (type) {
    case FlowType.PLANNING:
      return new PlanningFlow(config);
    default:
      throw new Error(`Unknown flow type: ${type}`);
  }
}
