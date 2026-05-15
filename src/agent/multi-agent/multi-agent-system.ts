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
import { CodeBuddyTool, CodeBuddyToolCall } from "../../codebuddy/client.js";
import { ToolResult, getErrorMessage } from "../../types/index.js";
import { getAllCodeBuddyTools } from "../../codebuddy/tools.js";
import {
  AgentConfig,
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
import { detectProviderFromEnv } from "../../utils/provider-detector.js";
import type { MultiAgentProviderOverrides } from "./provider-overrides.js";

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

interface ResolvedSystemProvider {
  apiKey: string;
  baseURL?: string;
  model?: string;
}

function resolveSystemProvider(apiKey: string, baseURL?: string): ResolvedSystemProvider {
  const detected = detectProviderFromEnv();
  if (
    detected &&
    (!apiKey || (apiKey === detected.apiKey && (!baseURL || baseURL === detected.baseURL)))
  ) {
    return {
      apiKey: detected.apiKey,
      baseURL: baseURL || detected.baseURL,
      model: detected.defaultModel,
    };
  }

  return { apiKey, baseURL };
}

function mergeProviderDefault(
  provider: ResolvedSystemProvider,
  overrides?: Partial<AgentConfig>,
): Partial<AgentConfig> | undefined {
  if (!provider.model) return overrides;

  return {
    model: provider.model,
    ...(overrides ?? {}),
    providerOverride: {
      apiKey: provider.apiKey,
      baseURL: provider.baseURL,
      model: provider.model,
      ...(overrides?.providerOverride ?? {}),
    },
  };
}

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
  private tools: CodeBuddyTool[] = [];
  private toolExecutor: ToolExecutor;
  private defaultRegistryInitialized = false;

  /**
   * Handler references captured when forwarding agent events, so dispose
   * can call `.off()` and avoid leaking listeners (F26). Keyed by role,
   * then by event name. Each entry points to the exact function passed
   * to `.on()` so the removal is idempotent.
   */
  private agentListeners: Map<AgentRole, Map<string, (...args: unknown[]) => void>> = new Map();

  /** Phase L (V0.4) — per-workflow cost accumulator. Lazy-init at first runWorkflow. */
  private costManager: import('./workflow-cost-manager.js').WorkflowCostManager | null = null;

  constructor(
    apiKey: string,
    baseURL?: string,
    toolExecutor?: ToolExecutor,
    /**
     * Fleet P1 — per-agent provider override. Lets the caller route
     * each role to a different provider (e.g., orchestrator on Claude
     * for reasoning, coder on Codex, reviewer on Gemini, tester on
     * a local Ollama). Each entry is a partial AgentConfig overlay
     * that propagates to the matching `create*Agent()` factory.
     *
     * When omitted (today's default), every agent inherits
     * `(apiKey, baseURL)` and uses its built-in `XXX_CONFIG`.
     */
    perAgentOverrides?: {
      orchestrator?: Partial<AgentConfig>;
      coder?: Partial<AgentConfig>;
      reviewer?: Partial<AgentConfig>;
      tester?: Partial<AgentConfig>;
    },
  ) {
    super();
    const provider = resolveSystemProvider(apiKey, baseURL);
    this.apiKey = provider.apiKey;
    this.baseURL = provider.baseURL;

    // Initialize agents
    this.agents = new Map();
    this.orchestrator = createOrchestratorAgent(
      provider.apiKey,
      provider.baseURL,
      mergeProviderDefault(provider, perAgentOverrides?.orchestrator),
    );
    this.agents.set("orchestrator", this.orchestrator);
    this.agents.set(
      "coder",
      createCoderAgent(
        provider.apiKey,
        provider.baseURL,
        mergeProviderDefault(provider, perAgentOverrides?.coder),
      ),
    );
    this.agents.set(
      "reviewer",
      createReviewerAgent(
        provider.apiKey,
        provider.baseURL,
        mergeProviderDefault(provider, perAgentOverrides?.reviewer),
      ),
    );
    this.agents.set(
      "tester",
      createTesterAgent(
        provider.apiKey,
        provider.baseURL,
        mergeProviderDefault(provider, perAgentOverrides?.tester),
      ),
    );

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
   * Set up event forwarding from all agents.
   *
   * Each handler is captured in `this.agentListeners` so `dispose()` can
   * remove them one-by-one. Previously these six listeners per agent
   * were added with `.on()` but never removed — for workloads that
   * create and discard many MultiAgentSystem instances (multi-turn YOLO
   * with fresh sub-agents) this accumulated listeners on the underlying
   * BaseAgent EventEmitter, leaking closures and eventually tripping
   * Node's `MaxListenersExceededWarning`.
   */
  private setupAgentEventForwarding(): void {
    for (const [role, agent] of this.agents) {
      const handlers: Map<string, (...args: unknown[]) => void> = new Map();
      const startH = (data: unknown) => this.emit("agent:start", { ...(data as object), role });
      const completeH = (data: unknown) => this.emit("agent:complete", { ...(data as object), role });
      const errorH = (data: unknown) => this.emit("agent:error", { ...(data as object), role });
      const messageH = (message: unknown) => this.handleAgentMessage(message as AgentMessage);
      const toolH = (data: unknown) => this.emit("agent:tool", { ...(data as object), role });
      const roundH = (data: unknown) => this.emit("agent:round", { ...(data as object), role });

      agent.on("agent:start", startH);
      agent.on("agent:complete", completeH);
      agent.on("agent:error", errorH);
      agent.on("agent:message", messageH);
      agent.on("agent:tool", toolH);
      agent.on("agent:round", roundH);

      handlers.set("agent:start", startH as (...args: unknown[]) => void);
      handlers.set("agent:complete", completeH as (...args: unknown[]) => void);
      handlers.set("agent:error", errorH as (...args: unknown[]) => void);
      handlers.set("agent:message", messageH as (...args: unknown[]) => void);
      handlers.set("agent:tool", toolH as (...args: unknown[]) => void);
      handlers.set("agent:round", roundH as (...args: unknown[]) => void);
      this.agentListeners.set(role, handlers);
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
   * Default tool executor backed by the formal tool registry.
   * This keeps the multi-agent system usable even when no external executor is injected.
   */
  private async defaultToolExecutor(toolCall: CodeBuddyToolCall): Promise<ToolResult> {
    let args: Record<string, unknown>;

    try {
      args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    } catch (error) {
      return {
        success: false,
        error: `Invalid tool arguments for "${toolCall.function.name}": ${getErrorMessage(error)}`,
      };
    }

    const registry = await this.getOrInitializeDefaultRegistry();
    const result = await registry.execute(
      toolCall.function.name,
      args,
      {
        cwd: process.cwd(),
        extra: {
          source: "multi-agent-system",
          toolCallId: toolCall.id,
        },
      }
    );

    return {
      success: result.success,
      output: result.output,
      error: result.error,
      data: result.data,
    };
  }

  private async getOrInitializeDefaultRegistry(): Promise<import("../../tools/registry/index.js").FormalToolRegistry> {
    const { getFormalToolRegistry, createAllToolsAsync } = await import("../../tools/registry/index.js");
    const registry = getFormalToolRegistry();

    if (!this.defaultRegistryInitialized) {
      const tools = await createAllToolsAsync();
      for (const tool of tools) {
        if (!registry.has(tool.name)) {
          registry.register(tool);
        }
      }
      this.defaultRegistryInitialized = true;
    }

    return registry;
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
    this.tools = await getAllCodeBuddyTools();
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

    // Phase L (V0.4) — initialize cost manager from TOML. Reused across
    // tasks of this workflow run; reset() clears between runs. If cost
    // tracking disabled (max_workflow_cost_usd = 0), still tracks total
    // for /agents metrics — just no warnings or hard cap.
    try {
      const { WorkflowCostManager } = await import('./workflow-cost-manager.js');
      const { getConfigManager } = await import('../../config/toml-config.js');
      const masCfg = getConfigManager().getConfig().multi_agent_system;
      this.costManager = new WorkflowCostManager({
        maxWorkflowCostUsd: masCfg?.max_workflow_cost_usd ?? 0,
        warningThresholdPercent: masCfg?.cost_warning_threshold_percent ?? 0.8,
        gracefulOverflow: masCfg?.graceful_cost_overflow ?? true,
      });
    } catch {
      this.costManager = null;
    }

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

      // Phase J — checkpoint resume. If caller passed `resumeFrom`,
      // pre-populate the in-memory results Map and mark the matching
      // plan tasks as `completed` so the 5 strategy executors skip them
      // (orchestrator.getNextTasks reads task.status, hence we must
      // mutate plan.phases[*].tasks[*], not just maintain a side-set).
      if (opts.resumeFrom) {
        const completed = new Set(opts.resumeFrom.completedTaskIds);
        for (const [id, result] of opts.resumeFrom.results) {
          results.set(id, result);
          for (const artifact of result.artifacts ?? []) {
            this.sharedContext.artifacts.set(artifact.id, artifact);
          }
        }
        let skipped = 0;
        for (const phase of plan.phases) {
          for (const task of phase.tasks) {
            if (completed.has(task.id)) {
              task.status = "completed";
              skipped++;
            }
          }
        }
        this.addTimelineEvent(
          "phase_started",
          `Resume: skipping ${skipped} completed task(s)`,
          { resumed: true, skipped, total: plan.phases.flatMap(p => p.tasks).length }
        );
      }

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

      // Phase L (V0.4) — attach cost summary if costManager populated.
      const costMetrics = this.costManager?.getMetrics();

      const workflowResult: WorkflowResult = {
        success: errors.length === 0,
        plan,
        results,
        artifacts: allArtifacts,
        timeline: this.timeline,
        totalDuration: Date.now() - startTime,
        summary,
        errors,
        costUsdTotal: costMetrics?.totalUsd,
        costBreakdown: costMetrics ? Array.from(costMetrics.perRole.entries()) : undefined,
        costExceeded: costMetrics?.exceededCap,
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

      // Phase M (V0.4.1) — detect+resolve PRE-batch (was POST in V0.3/V0.4,
      // making `code_overlap` detection effectively a no-op since tasks were
      // `completed` by then). Auto-resolve mutates losing tasks to `blocked`,
      // which the loop below skips naturally.
      await this.detectAndEmitConflicts(phase.tasks);

      for (const task of phase.tasks) {
        if (task.status === "completed") continue; // Phase J — skip resumed
        if (task.status === "blocked") continue; // Phase M — skip auto-blocked
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

      // Phase M (V0.4.1) — detect+resolve PRE-batch. See executeSequential.
      await this.detectAndEmitConflicts(phase.tasks);

      // Phase J — filter completed tasks before scheduling.
      // Phase M — also filter `blocked` tasks (auto-resolve outcome).
      const pending = phase.tasks.filter((t) => t.status !== "completed" && t.status !== "blocked");
      if (phase.parallelizable) {
        // Execute all tasks in parallel
        const promises = pending.map(task =>
          this.executeTask(task, results, errors, options)
        );
        await Promise.all(promises);
      } else {
        // Execute sequentially
        for (const task of pending) {
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

      // Phase M (V0.4.1) — detect+resolve PRE-batch (was POST in V0.3/V0.4).
      // Auto-resolve mutates losing tasks to `blocked`; we filter them out
      // before scheduling so they don't run.
      await this.detectAndEmitConflicts(nextTasks);
      const runnable = nextTasks.filter((t) => t.status !== "blocked");

      if (runnable.length === 0) continue;

      // Execute tasks (potentially in parallel)
      const parallelLimit = options.parallelAgents || 3;
      const batches = this.chunk(runnable, parallelLimit);

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
      // Phase M (V0.4.1) — detect+resolve PRE-batch. See executeSequential.
      await this.detectAndEmitConflicts(phase.tasks);

      for (const task of phase.tasks) {
        if (task.status === "completed") continue; // Phase J — skip resumed
        if (task.status === "blocked") continue; // Phase M — skip auto-blocked
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

      // Phase M (V0.4.1) — detect+resolve PRE-iteration so blocked tasks are
      // skipped throughout this iteration's executeSequential pass. Detection
      // runs against all plan tasks since iterative re-runs the whole plan.
      const allTasks = plan.phases.flatMap(p => p.tasks);
      await this.detectAndEmitConflicts(allTasks);

      // Execute all tasks (executeSequential also runs detect+resolve per
      // phase, but the per-iteration pass above catches plan-wide conflicts
      // that span phases).
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

      // Reset task status for retry. Phase M — also reset `blocked` tasks
      // (they may have been auto-blocked by a prior iteration; the next
      // iteration will re-detect and re-resolve from scratch).
      if (iteration < maxIterations - 1) {
        for (const phase of plan.phases) {
          for (const task of phase.tasks) {
            if (task.status === "completed" || task.status === "blocked") {
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
    // Phase H — adaptive allocation. The helper is no-op if the
    // coordinator is disabled in TOML, otherwise it consults it.
    // Mutates task.assignedTo to the resolved role so downstream code
    // (orchestrator.updateTaskStatus, persistence) sees the chosen agent.
    const resolvedRole = await this.getAssignedAgent(task);
    if (resolvedRole !== task.assignedTo) {
      this.addTimelineEvent("task_started", `Reallocated: ${task.title} → ${resolvedRole}`, { task, originalRole: task.assignedTo, resolvedRole });
      task.assignedTo = resolvedRole;
    }

    const agent = this.agents.get(task.assignedTo);
    if (!agent) {
      errors.push(`No agent found for role: ${task.assignedTo}`);
      return;
    }

    // Update task status
    task.status = "in_progress";
    this.orchestrator.updateTaskStatus(this.currentPlan!, task.id, "in_progress");
    this.addTimelineEvent("task_started", `Started: ${task.title}`, { task });

    // Phase L (V0.4) — pre-task cost check (warning-only, advisor recommendation).
    // Hard cap (skip remaining tasks) only fires on EXACT cumulative cost (post-task).
    if (this.costManager) {
      const model = (agent as unknown as { model?: string }).model ?? 'default';
      const estRounds = 3; // Conservative; refined with avgRounds metric in V0.5
      const estimate = this.costManager.estimateTaskCost(task.assignedTo, estRounds, model);
      const warning = this.costManager.checkWarning(estimate);
      if (warning) {
        this.addTimelineEvent("phase_started", warning, { warning: true, costEstimate: estimate });
      }
      if (this.costManager.isCapExceeded()) {
        // Hard cap reached on prior task's exact cost — gracefully skip
        this.addTimelineEvent("task_failed", `Skipped (cost cap exceeded): ${task.title}`, { task, costSkip: true });
        task.status = "blocked";
        return;
      }
    }

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

      // Phase L (V0.4) — record cost (exact if token counts in result,
      // else estimation). Mutates result.costUsd so EnhancedCoordinator
      // can pick it up via recordTaskCompletion.
      if (this.costManager) {
        const model = (agent as unknown as { model?: string }).model ?? 'default';
        const cost = await this.costManager.recordExact(result, model, result.rounds);
        result.costUsd = cost;
      }

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
   * Dispose and cleanup.
   *
   * Removes the per-agent forwarding listeners captured in
   * setupAgentEventForwarding (F26) before clearing the local emitter,
   * so BaseAgent instances don't retain dangling references to this
   * MultiAgentSystem through their own listener arrays.
   */
  dispose(): void {
    this.reset();
    for (const [role, handlers] of this.agentListeners) {
      const agent = this.agents.get(role);
      if (!agent) continue;
      for (const [event, handler] of handlers) {
        agent.off(event, handler);
      }
    }
    this.agentListeners.clear();
    this.removeAllListeners();
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

  // ────────────────────────────────────────────────────────────
  // Phase H — EnhancedCoordinator integration (lazy-loaded)
  // ────────────────────────────────────────────────────────────

  private coordinationConfigCache: {
    enableAdaptiveAllocation: boolean;
    minAssignmentConfidence: number;
    enableConflictResolution: boolean;
    autoResolveEnabled: boolean;
    autoResolveStrategy: 'prefer-reviewer' | 'none';
  } | null = null;

  /** Lazy-load coordinator config from TOML. Cached after first call.
   *  All defaults sensible if TOML missing/incomplete. */
  private async getCoordinationConfig(): Promise<{
    enableAdaptiveAllocation: boolean;
    minAssignmentConfidence: number;
    enableConflictResolution: boolean;
    autoResolveEnabled: boolean;
    autoResolveStrategy: 'prefer-reviewer' | 'none';
  }> {
    if (this.coordinationConfigCache) return this.coordinationConfigCache;
    try {
      const { getConfigManager } = await import('../../config/toml-config.js');
      const cfg = getConfigManager().getConfig().multi_agent_system?.coordination;
      this.coordinationConfigCache = {
        enableAdaptiveAllocation: cfg?.enable_adaptive_allocation ?? false,
        minAssignmentConfidence: cfg?.min_assignment_confidence ?? 0.6,
        enableConflictResolution: cfg?.enable_conflict_resolution ?? false,
        autoResolveEnabled: cfg?.auto_resolve_enabled ?? false,
        autoResolveStrategy: cfg?.auto_resolve_strategy ?? 'none',
      };
    } catch {
      this.coordinationConfigCache = {
        enableAdaptiveAllocation: false,
        minAssignmentConfidence: 0.6,
        enableConflictResolution: false,
        autoResolveEnabled: false,
        autoResolveStrategy: 'none',
      };
    }
    return this.coordinationConfigCache;
  }

  /** Resolve which agent should run a task. If TOML
   *  enable_adaptive_allocation = false (default), returns task.assignedTo
   *  unchanged. If enabled and the coordinator returns an allocation with
   *  confidence ≥ threshold, returns the coordinator's choice. */
  private async getAssignedAgent(task: AgentTask): Promise<AgentRole> {
    const cfg = await this.getCoordinationConfig();
    if (!cfg.enableAdaptiveAllocation) return task.assignedTo;
    try {
      const { getEnhancedCoordinator } = await import('./enhanced-coordination.js');
      const coordinator = getEnhancedCoordinator();
      const available = Array.from(this.agents.keys()) as AgentRole[];
      const alloc = coordinator.allocateTask(task, available);
      if (alloc.confidence >= cfg.minAssignmentConfidence) {
        return alloc.agent;
      }
      return task.assignedTo;
    } catch {
      return task.assignedTo;
    }
  }

  /** Phase H — detect agent conflicts in a set of tasks (file overlap,
   *  resource contention) and emit `workflow:event` of type
   *  `conflict_detected` for each.
   *
   *  Phase M (V0.4.1) — call moved from POST-batch (where tasks are already
   *  `completed`/`failed`) to PRE-batch in all 5 strategies, so detection
   *  catches `pending` tasks before they execute. When TOML
   *  `auto_resolve_enabled` is true and strategy is `prefer-reviewer`, also
   *  invokes coordinator.autoResolveConflicts(tasks) which mutates losing
   *  agents' tasks to `status='blocked'`. The strategy executors then skip
   *  these blocked tasks naturally (orchestrator.getNextTasks filters by
   *  status='pending', and explicit `task.status === 'completed'` skips
   *  cover the rest).
   *
   *  No-op if TOML enable_conflict_resolution = false. */
  private async detectAndEmitConflicts(tasks: AgentTask[]): Promise<void> {
    const cfg = await this.getCoordinationConfig();
    if (!cfg.enableConflictResolution) return;
    try {
      const { getEnhancedCoordinator } = await import('./enhanced-coordination.js');
      const coordinator = getEnhancedCoordinator();
      const conflicts = coordinator.detectConflicts(tasks, this.sharedContext);
      for (const conflict of conflicts) {
        this.addTimelineEvent('conflict_detected', conflict.description, { conflict });
      }

      // Phase M — auto-resolve side-effects (block losing agents on
      // code_overlap). Skipped when strategy='none' or
      // auto_resolve_enabled=false (V0.3/V0.4 backward-compat = annotation
      // only).
      if (
        cfg.autoResolveEnabled &&
        cfg.autoResolveStrategy === 'prefer-reviewer' &&
        conflicts.length > 0
      ) {
        const mutatedTaskIds = coordinator.autoResolveConflicts(tasks);
        if (mutatedTaskIds.length > 0) {
          this.addTimelineEvent(
            'conflict_detected',
            `Auto-resolved: ${mutatedTaskIds.length} task(s) blocked`,
            { autoResolved: true, blockedTaskIds: mutatedTaskIds }
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addTimelineEvent(
        'agent_message',
        `Conflict detection unavailable: ${message}`,
        { warning: true, source: 'enhanced-coordination', error: message }
      );
    }
  }
}

/**
 * Create a new MultiAgentSystem instance
 */
export function createMultiAgentSystem(
  apiKey: string,
  baseURL?: string,
  toolExecutor?: ToolExecutor,
  perAgentOverrides?: MultiAgentProviderOverrides,
): MultiAgentSystem {
  return new MultiAgentSystem(apiKey, baseURL, toolExecutor, perAgentOverrides);
}

// Singleton instance
let multiAgentSystemInstance: MultiAgentSystem | null = null;

export function getMultiAgentSystem(
  apiKey: string,
  baseURL?: string,
  toolExecutor?: ToolExecutor,
  perAgentOverrides?: MultiAgentProviderOverrides,
): MultiAgentSystem {
  if (!multiAgentSystemInstance) {
    multiAgentSystemInstance = createMultiAgentSystem(apiKey, baseURL, toolExecutor, perAgentOverrides);
  }
  return multiAgentSystemInstance;
}

export function resetMultiAgentSystem(): void {
  if (multiAgentSystemInstance) {
    multiAgentSystemInstance.dispose();
  }
  multiAgentSystemInstance = null;
}
