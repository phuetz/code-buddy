/**
 * Multi-Agent System
 *
 * The main orchestration layer that coordinates multiple specialized agents
 * to solve complex software engineering tasks collaboratively.
 *
 * Based on research from:
 * - ComplexAgents (EMNLP 2024)
 * - Paper2Code (arXiv 2504.17192)
 * - AgentCoder (Huang et al., 2023)
 */

import { EventEmitter } from "events";
import { GrokTool, GrokToolCall } from "../../grok/client.js";
import { ToolResult, getErrorMessage } from "../../types/index.js";
import { getAllGrokTools } from "../../grok/tools.js";
import {
  AgentRole,
  AgentTask,
  ExecutionPlan,
  SharedContext,
  AgentExecutionResult,
  WorkflowResult,
  WorkflowEvent,
  WorkflowOptions,
  AgentMessage,
  TaskArtifact,
  CodebaseInfo,
  Decision,
  ToolExecutor,
} from "./types.js";
import { BaseAgent, createId } from "./base-agent.js";
import { OrchestratorAgent, createOrchestratorAgent } from "./agents/orchestrator-agent.js";
import { CoderAgent, createCoderAgent } from "./agents/coder-agent.js";
import { ReviewerAgent, createReviewerAgent } from "./agents/reviewer-agent.js";
import { TesterAgent, createTesterAgent } from "./agents/tester-agent.js";

/**
 * Default workflow options
 */
const DEFAULT_WORKFLOW_OPTIONS: WorkflowOptions = {
  strategy: "hierarchical",
  maxIterations: 5,
  requireConsensus: false,
  parallelAgents: 3,
  timeout: 600000, // 10 minutes
  verbose: false,
  dryRun: false,
  autoApprove: false,
};

/**
 * Main Multi-Agent System class
 */
export class MultiAgentSystem extends EventEmitter {
  private apiKey: string;
  private baseURL?: string;
  private agents: Map<AgentRole, BaseAgent>;
  private orchestrator: OrchestratorAgent;
  private isRunning: boolean = false;
  private currentPlan: ExecutionPlan | null = null;
  private sharedContext: SharedContext;
  private timeline: WorkflowEvent[] = [];
  private tools: GrokTool[] = [];
  private toolExecutor: ToolExecutor;

  constructor(
    apiKey: string,
    baseURL?: string,
    toolExecutor?: ToolExecutor
  ) {
    super();
    this.apiKey = apiKey;
    this.baseURL = baseURL;

    // Initialize agents
    this.agents = new Map();
    this.orchestrator = createOrchestratorAgent(apiKey, baseURL);
    this.agents.set("orchestrator", this.orchestrator);
    this.agents.set("coder", createCoderAgent(apiKey, baseURL));
    this.agents.set("reviewer", createReviewerAgent(apiKey, baseURL));
    this.agents.set("tester", createTesterAgent(apiKey, baseURL));

    // Initialize shared context
    this.sharedContext = {
      goal: "",
      relevantFiles: [],
      conversationHistory: [],
      artifacts: new Map(),
      decisions: [],
      constraints: [],
    };

    // Set up tool executor
    this.toolExecutor = toolExecutor || this.defaultToolExecutor.bind(this);

    // Set up event forwarding from agents
    this.setupAgentEventForwarding();
  }

  /**
   * Set up event forwarding from all agents
   */
  private setupAgentEventForwarding(): void {
    for (const [role, agent] of this.agents) {
      agent.on("agent:start", (data) => this.emit("agent:start", { ...data, role }));
      agent.on("agent:complete", (data) => this.emit("agent:complete", { ...data, role }));
      agent.on("agent:error", (data) => this.emit("agent:error", { ...data, role }));
      agent.on("agent:message", (message) => this.handleAgentMessage(message));
      agent.on("agent:tool", (data) => this.emit("agent:tool", { ...data, role }));
      agent.on("agent:round", (data) => this.emit("agent:round", { ...data, role }));
    }
  }

  /**
   * Handle messages between agents
   */
  private handleAgentMessage(message: AgentMessage): void {
    this.sharedContext.conversationHistory.push(message);
    this.emit("agent:message", message);

    // Route message to target agent(s)
    if (message.to === "all") {
      for (const agent of this.agents.values()) {
        if (agent.getRole() !== message.from) {
          agent.receiveMessage(message);
        }
      }
    } else {
      const targetAgent = this.agents.get(message.to);
      if (targetAgent) {
        targetAgent.receiveMessage(message);
      }
    }
  }

  /**
   * Default tool executor (placeholder - should be replaced with actual implementation)
   */
  private async defaultToolExecutor(_toolCall: GrokToolCall): Promise<ToolResult> {
    // This should be overridden by the actual tool executor
    return {
      success: false,
      error: "Tool executor not configured. Please provide a tool executor function.",
    };
  }

  /**
   * Set the tool executor function
   */
  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor;
  }

  /**
   * Initialize tools
   */
  async initializeTools(): Promise<void> {
    this.tools = await getAllGrokTools();
  }

  /**
   * Run a complete workflow for a given goal
   */
  async runWorkflow(
    goal: string,
    options: Partial<WorkflowOptions> = {}
  ): Promise<WorkflowResult> {
    const opts = { ...DEFAULT_WORKFLOW_OPTIONS, ...options };
    this.isRunning = true;
    this.timeline = [];
    this.currentPlan = null;

    // Ensure tools are loaded
    if (this.tools.length === 0) {
      await this.initializeTools();
    }

    const startTime = Date.now();
    const results = new Map<string, AgentExecutionResult>();
    const errors: string[] = [];

    try {
      // Update shared context
      this.sharedContext.goal = goal;

      // Phase 1: Planning
      this.addTimelineEvent("phase_started", "Planning phase started", { phase: "planning" });

      const plan = await this.orchestrator.createPlan(
        goal,
        this.sharedContext,
        this.tools,
        this.toolExecutor
      );
      this.currentPlan = plan;
      plan.status = "executing";

      this.emit("workflow:start", { plan });
      this.addTimelineEvent("phase_completed", "Planning phase completed", { plan });

      // Phase 2: Execution
      this.addTimelineEvent("phase_started", "Execution phase started", { phase: "execution" });

      // Execute based on strategy
      switch (opts.strategy) {
        case "sequential":
          await this.executeSequential(plan, results, errors, opts);
          break;
        case "parallel":
          await this.executeParallel(plan, results, errors, opts);
          break;
        case "hierarchical":
          await this.executeHierarchical(plan, results, errors, opts);
          break;
        case "peer_review":
          await this.executePeerReview(plan, results, errors, opts);
          break;
        case "iterative":
          await this.executeIterative(plan, results, errors, opts);
          break;
        default:
          await this.executeHierarchical(plan, results, errors, opts);
      }

      this.addTimelineEvent("phase_completed", "Execution phase completed");

      // Phase 3: Review (if not in peer_review mode)
      if (opts.strategy !== "peer_review" && opts.requireConsensus) {
        await this.performFinalReview(plan, results, errors, opts);
      }

      // Phase 4: Synthesis
      const summary = await this.orchestrator.synthesizeResults(
        plan,
        results,
        this.sharedContext,
        this.tools,
        this.toolExecutor
      );

      // Collect all artifacts
      const allArtifacts: TaskArtifact[] = [];
      for (const result of results.values()) {
        allArtifacts.push(...result.artifacts);
      }

      plan.status = errors.length === 0 ? "completed" : "failed";

      const workflowResult: WorkflowResult = {
        success: errors.length === 0,
        plan,
        results,
        artifacts: allArtifacts,
        timeline: this.timeline,
        totalDuration: Date.now() - startTime,
        summary,
        errors,
      };

      this.emit("workflow:complete", { result: workflowResult });
      return workflowResult;

    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const workflowResult: WorkflowResult = {
        success: false,
        plan: this.currentPlan || this.createEmptyPlan(goal),
        results,
        artifacts: [],
        timeline: this.timeline,
        totalDuration: Date.now() - startTime,
        summary: `Workflow failed: ${errorMessage}`,
        errors: [...errors, errorMessage],
      };

      this.emit("workflow:error", { error, plan: this.currentPlan });
      return workflowResult;

    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Execute tasks sequentially
   */
  private async executeSequential(
    plan: ExecutionPlan,
    results: Map<string, AgentExecutionResult>,
    errors: string[],
    options: WorkflowOptions
  ): Promise<void> {
    for (const phase of plan.phases) {
      this.addTimelineEvent("phase_started", `Phase: ${phase.name}`, { phase });

      for (const task of phase.tasks) {
        await this.executeTask(task, results, errors, options);
      }

      this.addTimelineEvent("phase_completed", `Phase completed: ${phase.name}`);
    }
  }

  /**
   * Execute tasks in parallel where possible
   */
  private async executeParallel(
    plan: ExecutionPlan,
    results: Map<string, AgentExecutionResult>,
    errors: string[],
    options: WorkflowOptions
  ): Promise<void> {
    for (const phase of plan.phases) {
      this.addTimelineEvent("phase_started", `Phase: ${phase.name}`, { phase });

      if (phase.parallelizable) {
        // Execute all tasks in parallel
        const promises = phase.tasks.map(task =>
          this.executeTask(task, results, errors, options)
        );
        await Promise.all(promises);
      } else {
        // Execute sequentially
        for (const task of phase.tasks) {
          await this.executeTask(task, results, errors, options);
        }
      }

      this.addTimelineEvent("phase_completed", `Phase completed: ${phase.name}`);
    }
  }

  /**
   * Execute with hierarchical delegation (orchestrator controls)
   */
  private async executeHierarchical(
    plan: ExecutionPlan,
    results: Map<string, AgentExecutionResult>,
    errors: string[],
    options: WorkflowOptions
  ): Promise<void> {
    let iterations = 0;
    const maxIterations = options.maxIterations || 5;

    while (!this.orchestrator.isPlanComplete(plan) && iterations < maxIterations) {
      iterations++;

      // Get next available tasks
      const nextTasks = this.orchestrator.getNextTasks(plan);

      if (nextTasks.length === 0) {
        // No tasks ready - might be blocked
        break;
      }

      // Execute tasks (potentially in parallel)
      const parallelLimit = options.parallelAgents || 3;
      const batches = this.chunk(nextTasks, parallelLimit);

      for (const batch of batches) {
        const promises = batch.map(task =>
          this.executeTask(task, results, errors, options)
        );
        await Promise.all(promises);
      }
    }
  }

  /**
   * Execute with peer review (coder + reviewer collaboration)
   */
  private async executePeerReview(
    plan: ExecutionPlan,
    results: Map<string, AgentExecutionResult>,
    errors: string[],
    options: WorkflowOptions
  ): Promise<void> {
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        if (task.assignedTo === "coder") {
          // Step 1: Coder implements
          await this.executeTask(task, results, errors, options);

          if (!results.get(task.id)?.success) continue;

          // Step 2: Reviewer reviews
          const reviewerAgent = this.agents.get("reviewer") as ReviewerAgent;
          const artifacts = results.get(task.id)?.artifacts || [];
          const files = artifacts
            .filter(a => a.type === "code" && a.filePath)
            .map(a => a.filePath!);

          if (files.length > 0) {
            const review = await reviewerAgent.reviewCode(
              files,
              this.sharedContext,
              this.tools,
              this.toolExecutor
            );

            // Step 3: If not approved, send back to coder
            if (!review.approved && options.maxIterations && options.maxIterations > 1) {
              const coderAgent = this.agents.get("coder") as CoderAgent;
              const feedback = review.feedbackItems
                .map(f => `[${f.severity}] ${f.message}`)
                .join("\n");

              await coderAgent.refactorCode(
                feedback,
                files,
                this.sharedContext,
                this.tools,
                this.toolExecutor
              );
            }
          }
        } else {
          await this.executeTask(task, results, errors, options);
        }
      }
    }
  }

  /**
   * Execute with iterative refinement
   */
  private async executeIterative(
    plan: ExecutionPlan,
    results: Map<string, AgentExecutionResult>,
    errors: string[],
    options: WorkflowOptions
  ): Promise<void> {
    const maxIterations = options.maxIterations || 3;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      this.addTimelineEvent(
        "phase_started",
        `Iteration ${iteration + 1}/${maxIterations}`
      );

      // Execute all tasks
      await this.executeSequential(plan, results, errors, options);

      // Run tests
      const testerAgent = this.agents.get("tester") as TesterAgent;
      const testResult = await testerAgent.runTests(
        this.sharedContext,
        this.tools,
        this.toolExecutor
      );

      if (testResult.success) {
        // All tests pass, we're done
        break;
      }

      // Reset task status for retry
      if (iteration < maxIterations - 1) {
        for (const phase of plan.phases) {
          for (const task of phase.tasks) {
            if (task.status === "completed") {
              task.status = "pending";
            }
          }
        }
      }
    }
  }

  /**
   * Execute a single task
   */
  private async executeTask(
    task: AgentTask,
    results: Map<string, AgentExecutionResult>,
    errors: string[],
    options: WorkflowOptions
  ): Promise<void> {
    const agent = this.agents.get(task.assignedTo);
    if (!agent) {
      errors.push(`No agent found for role: ${task.assignedTo}`);
      return;
    }

    // Update task status
    task.status = "in_progress";
    this.orchestrator.updateTaskStatus(this.currentPlan!, task.id, "in_progress");
    this.addTimelineEvent("task_started", `Started: ${task.title}`, { task });

    try {
      // Check dry run
      if (options.dryRun) {
        const dryRunResult: AgentExecutionResult = {
          success: true,
          role: task.assignedTo,
          taskId: task.id,
          output: `[DRY RUN] Would execute: ${task.title}`,
          artifacts: [],
          toolsUsed: [],
          rounds: 0,
          duration: 0,
        };
        results.set(task.id, dryRunResult);
        task.status = "completed";
        this.orchestrator.updateTaskStatus(this.currentPlan!, task.id, "completed", dryRunResult);
        return;
      }

      // Execute the task
      const result = await agent.execute(
        task,
        this.sharedContext,
        this.tools,
        this.toolExecutor
      );

      results.set(task.id, result);

      // Store artifacts in shared context
      for (const artifact of result.artifacts) {
        this.sharedContext.artifacts.set(artifact.id, artifact);
      }

      // Update task status
      if (result.success) {
        task.status = "completed";
        this.orchestrator.updateTaskStatus(this.currentPlan!, task.id, "completed", result);
        this.addTimelineEvent("task_completed", `Completed: ${task.title}`, { task, result });
      } else {
        task.status = "failed";
        task.error = result.error;
        this.orchestrator.updateTaskStatus(this.currentPlan!, task.id, "failed", result);
        errors.push(`Task "${task.title}" failed: ${result.error}`);
        this.addTimelineEvent("task_failed", `Failed: ${task.title}`, { task, error: result.error });
      }

    } catch (error) {
      const errorMessage = getErrorMessage(error);
      task.status = "failed";
      task.error = errorMessage;
      errors.push(`Task "${task.title}" threw error: ${errorMessage}`);
      this.addTimelineEvent("task_failed", `Error: ${task.title}`, { task, error: errorMessage });
    }
  }

  /**
   * Perform final review of all changes
   */
  private async performFinalReview(
    plan: ExecutionPlan,
    results: Map<string, AgentExecutionResult>,
    errors: string[],
    _options: WorkflowOptions
  ): Promise<void> {
    const reviewerAgent = this.agents.get("reviewer") as ReviewerAgent;

    // Collect all code artifacts
    const codeFiles: string[] = [];
    for (const result of results.values()) {
      for (const artifact of result.artifacts) {
        if (artifact.type === "code" && artifact.filePath) {
          codeFiles.push(artifact.filePath);
        }
      }
    }

    if (codeFiles.length > 0) {
      const review = await reviewerAgent.reviewCode(
        codeFiles,
        this.sharedContext,
        this.tools,
        this.toolExecutor
      );

      if (!review.approved) {
        errors.push(`Final review: ${review.criticalIssues} critical, ${review.majorIssues} major issues found`);
      }
    }
  }

  /**
   * Add an event to the timeline
   */
  private addTimelineEvent(
    type: WorkflowEvent["type"],
    message: string,
    data?: unknown
  ): void {
    const event: WorkflowEvent = {
      timestamp: new Date(),
      type,
      message,
      data,
    };
    this.timeline.push(event);
    if (this.listenerCount("workflow:event") > 0) {
      this.emit("workflow:event", event);
    }
  }

  /**
   * Create an empty plan (for error cases)
   */
  private createEmptyPlan(goal: string): ExecutionPlan {
    return {
      id: createId("plan"),
      goal,
      summary: "Failed to create plan",
      phases: [],
      estimatedComplexity: "simple",
      requiredAgents: [],
      createdAt: new Date(),
      status: "failed",
    };
  }

  /**
   * Chunk array into smaller arrays
   */
  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Stop the current workflow
   */
  stop(): void {
    this.isRunning = false;
    for (const agent of this.agents.values()) {
      agent.stop();
    }
    this.emit("workflow:stopped");
  }

  /**
   * Get the current plan
   */
  getCurrentPlan(): ExecutionPlan | null {
    return this.currentPlan;
  }

  /**
   * Get the shared context
   */
  getSharedContext(): SharedContext {
    return this.sharedContext;
  }

  /**
   * Get an agent by role
   */
  getAgent(role: AgentRole): BaseAgent | undefined {
    return this.agents.get(role);
  }

  /**
   * Add a decision to the shared context
   */
  addDecision(
    description: string,
    madeBy: AgentRole,
    rationale: string,
    alternatives: string[] = []
  ): void {
    const decision: Decision = {
      id: createId("decision"),
      description,
      madeBy,
      rationale,
      alternatives,
      timestamp: new Date(),
    };
    this.sharedContext.decisions.push(decision);
  }

  /**
   * Update codebase info in shared context
   */
  setCodebaseInfo(info: CodebaseInfo): void {
    this.sharedContext.codebaseInfo = info;
  }

  /**
   * Add relevant files to context
   */
  addRelevantFiles(files: string[]): void {
    this.sharedContext.relevantFiles = [
      ...new Set([...this.sharedContext.relevantFiles, ...files])
    ];
  }

  /**
   * Add constraints to the workflow
   */
  addConstraints(constraints: string[]): void {
    this.sharedContext.constraints = [
      ...new Set([...this.sharedContext.constraints, ...constraints])
    ];
  }

  /**
   * Reset the system for a new workflow
   */
  reset(): void {
    this.currentPlan = null;
    this.timeline = [];
    this.sharedContext = {
      goal: "",
      relevantFiles: [],
      conversationHistory: [],
      artifacts: new Map(),
      decisions: [],
      constraints: [],
    };
    for (const agent of this.agents.values()) {
      agent.reset();
    }
  }

  /**
   * Format workflow result for display
   */
  formatResult(result: WorkflowResult): string {
    let output = `\n${"═".repeat(70)}\n`;
    output += `🤖 MULTI-AGENT WORKFLOW RESULT\n`;
    output += `${"═".repeat(70)}\n\n`;

    // Status
    const statusEmoji = result.success ? "✅" : "❌";
    output += `${statusEmoji} Status: ${result.success ? "SUCCESS" : "FAILED"}\n`;
    output += `⏱️  Duration: ${(result.totalDuration / 1000).toFixed(2)}s\n\n`;

    // Plan Summary
    output += `📋 Plan: ${result.plan.goal}\n`;
    output += `   Complexity: ${result.plan.estimatedComplexity}\n`;
    output += `   Phases: ${result.plan.phases.length}\n`;
    output += `   Agents: ${result.plan.requiredAgents.join(", ")}\n\n`;

    // Phase Results
    output += `📊 Phase Results:\n`;
    output += `${"─".repeat(50)}\n`;
    for (const phase of result.plan.phases) {
      const phaseComplete = phase.tasks.every(t => t.status === "completed");
      const phaseEmoji = phaseComplete ? "✅" : "❌";
      output += `${phaseEmoji} ${phase.name}\n`;
      for (const task of phase.tasks) {
        const taskEmoji = task.status === "completed" ? "  ✓" : "  ✗";
        output += `   ${taskEmoji} ${task.title} (${task.assignedTo})\n`;
      }
    }
    output += "\n";

    // Artifacts
    if (result.artifacts.length > 0) {
      output += `📦 Artifacts Produced:\n`;
      output += `${"─".repeat(50)}\n`;
      for (const artifact of result.artifacts) {
        output += `   • ${artifact.name} (${artifact.type})\n`;
      }
      output += "\n";
    }

    // Errors
    if (result.errors.length > 0) {
      output += `⚠️  Errors:\n`;
      output += `${"─".repeat(50)}\n`;
      for (const error of result.errors) {
        output += `   • ${error}\n`;
      }
      output += "\n";
    }

    // Summary
    output += `📝 Summary:\n`;
    output += `${"─".repeat(50)}\n`;
    output += result.summary + "\n";

    output += `\n${"═".repeat(70)}\n`;
    return output;
  }
}

/**
 * Create a new MultiAgentSystem instance
 */
export function createMultiAgentSystem(
  apiKey: string,
  baseURL?: string,
  toolExecutor?: ToolExecutor
): MultiAgentSystem {
  return new MultiAgentSystem(apiKey, baseURL, toolExecutor);
}

// Singleton instance
let multiAgentSystemInstance: MultiAgentSystem | null = null;

export function getMultiAgentSystem(
  apiKey: string,
  baseURL?: string,
  toolExecutor?: ToolExecutor
): MultiAgentSystem {
  if (!multiAgentSystemInstance) {
    multiAgentSystemInstance = createMultiAgentSystem(apiKey, baseURL, toolExecutor);
  }
  return multiAgentSystemInstance;
}

export function resetMultiAgentSystem(): void {
  if (multiAgentSystemInstance) {
    multiAgentSystemInstance.reset();
  }
  multiAgentSystemInstance = null;
}
