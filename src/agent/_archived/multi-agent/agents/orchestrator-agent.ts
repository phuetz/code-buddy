/**
 * Orchestrator Agent
 *
 * The central coordinator that plans, delegates, and manages the multi-agent workflow.
 * Responsible for:
 * - Breaking down complex tasks into subtasks
 * - Assigning tasks to appropriate specialist agents
 * - Monitoring progress and handling failures
 * - Synthesizing results from multiple agents
 */

import { CodeBuddyTool } from "../../../codebuddy/client.js";
import { BaseAgent, createId } from "../base-agent.js";
import {
  AgentConfig,
  AgentTask,
  AgentRole,
  ExecutionPlan,
  PlanPhase,
  TaskPriority,
  SharedContext,
  AgentExecutionResult,
  ToolExecutor,
  TaskArtifact,
} from "../types.js";

const ORCHESTRATOR_CONFIG: AgentConfig = {
  role: "orchestrator",
  name: "Orchestrator",
  description: "Central coordinator for multi-agent workflows. Plans complex tasks, delegates to specialists, and synthesizes results.",
  systemPrompt: `You are the Orchestrator, the strategic leader of a multi-agent development team.

YOUR RESPONSIBILITIES:
1. **Task Analysis**: Analyze user requests to understand requirements fully
2. **Planning**: Create detailed execution plans with clear phases and dependencies
3. **Delegation**: Assign tasks to the most appropriate specialist agents
4. **Coordination**: Ensure smooth collaboration between agents
5. **Quality Control**: Review outputs and ensure they meet requirements
6. **Synthesis**: Combine results from multiple agents into cohesive solutions

SPECIALIST AGENTS AVAILABLE:
- **Coder**: Writes and modifies code
- **Reviewer**: Reviews code for quality, bugs, and best practices
- **Tester**: Runs tests and verifies functionality
- **Researcher**: Explores codebase and gathers information
- **Debugger**: Diagnoses and fixes bugs
- **Architect**: Designs system architecture
- **Documenter**: Writes documentation

PLANNING FORMAT:
When creating a plan, use this structure:
<plan complexity="simple|moderate|complex|very_complex">
<goal>Clear statement of the objective</goal>
<summary>Brief overview of the approach</summary>
<phase order="1" parallelizable="true|false">
  <name>Phase Name</name>
  <description>What this phase accomplishes</description>
  <task priority="critical|high|medium|low" agent="role">
    <title>Task Title</title>
    <description>Detailed task description</description>
  </task>
</phase>
</plan>

DECISION MAKING:
- Prefer incremental, verifiable changes over large rewrites
- Consider dependencies between tasks
- Identify tasks that can run in parallel
- Plan for failure recovery
- Include validation steps`,
  capabilities: [
    "planning",
    "search",
    "file_operations",
  ],
  allowedTools: [
    "view_file",
    "search",
    "bash",
    "codebase_map",
  ],
  maxRounds: 20,
};

export class OrchestratorAgent extends BaseAgent {
  private executionPlan: ExecutionPlan | null = null;

  constructor(apiKey: string, baseURL?: string) {
    super(ORCHESTRATOR_CONFIG, apiKey, baseURL);
  }

  getSpecializedPrompt(): string {
    return ORCHESTRATOR_CONFIG.systemPrompt;
  }

  /**
   * Create an execution plan for a given goal
   */
  async createPlan(
    goal: string,
    context: SharedContext,
    tools: CodeBuddyTool[],
    executeTool: ToolExecutor
  ): Promise<ExecutionPlan> {
    const planningTask: AgentTask = {
      id: createId("task"),
      title: "Create Execution Plan",
      description: `Analyze the following goal and create a detailed execution plan:

GOAL: ${goal}

Explore the codebase to understand the current state, then create a comprehensive plan that:
1. Breaks down the goal into manageable phases
2. Identifies specific tasks within each phase
3. Assigns each task to the most appropriate agent
4. Considers dependencies and parallelization opportunities
5. Includes validation and review steps`,
      status: "in_progress",
      priority: "critical",
      assignedTo: "orchestrator",
      dependencies: [],
      subtasks: [],
      artifacts: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await this.execute(planningTask, context, tools, executeTool);

    // Parse the plan from the output
    const plan = this.parsePlan(result.output, goal);
    this.executionPlan = plan;

    return plan;
  }

  /**
   * Parse execution plan from agent output
   */
  private parsePlan(output: string, goal: string): ExecutionPlan {
    const planRegex = /<plan\s+complexity="([^"]+)">([\s\S]*?)<\/plan>/;
    const goalRegex = /<goal>([\s\S]*?)<\/goal>/;
    const summaryRegex = /<summary>([\s\S]*?)<\/summary>/;
    const phaseRegex = /<phase\s+order="(\d+)"\s+parallelizable="([^"]+)">([\s\S]*?)<\/phase>/g;
    const taskRegex = /<task\s+priority="([^"]+)"\s+agent="([^"]+)">([\s\S]*?)<\/task>/g;
    const titleRegex = /<title>([\s\S]*?)<\/title>/;
    const descRegex = /<description>([\s\S]*?)<\/description>/;
    const nameRegex = /<name>([\s\S]*?)<\/name>/;

    const planMatch = output.match(planRegex);
    const complexity = planMatch ? planMatch[1] : "moderate";
    const planContent = planMatch ? planMatch[2] : output;

    const goalMatch = planContent.match(goalRegex);
    const summaryMatch = planContent.match(summaryRegex);

    const phases: PlanPhase[] = [];
    let phaseMatch;
    const phaseContent = planContent;

    // Reset regex lastIndex
    phaseRegex.lastIndex = 0;

    while ((phaseMatch = phaseRegex.exec(phaseContent)) !== null) {
      const [, order, parallelizable, content] = phaseMatch;

      const nameMatch = content.match(nameRegex);
      const phaseDescMatch = content.match(descRegex);

      const tasks: AgentTask[] = [];
      let taskMatch;
      taskRegex.lastIndex = 0;

      while ((taskMatch = taskRegex.exec(content)) !== null) {
        const [, priority, agent, taskContent] = taskMatch;
        const taskTitleMatch = taskContent.match(titleRegex);
        const taskDescMatch = taskContent.match(descRegex);

        tasks.push({
          id: createId("task"),
          title: taskTitleMatch ? taskTitleMatch[1].trim() : "Untitled Task",
          description: taskDescMatch ? taskDescMatch[1].trim() : "",
          status: "pending",
          priority: priority as TaskPriority,
          assignedTo: agent as AgentRole,
          dependencies: [],
          subtasks: [],
          artifacts: [],
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      phases.push({
        id: createId("phase"),
        name: nameMatch ? nameMatch[1].trim() : `Phase ${order}`,
        description: phaseDescMatch ? phaseDescMatch[1].trim() : "",
        tasks,
        parallelizable: parallelizable === "true",
        order: parseInt(order, 10),
      });
    }

    // If no phases were parsed, create a default plan
    if (phases.length === 0) {
      phases.push({
        id: createId("phase"),
        name: "Implementation",
        description: goal,
        tasks: [{
          id: createId("task"),
          title: goal,
          description: output,
          status: "pending",
          priority: "high",
          assignedTo: "coder",
          dependencies: [],
          subtasks: [],
          artifacts: [],
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
        parallelizable: false,
        order: 1,
      });
    }

    // Determine required agents
    const requiredAgents = new Set<AgentRole>();
    for (const phase of phases) {
      for (const task of phase.tasks) {
        requiredAgents.add(task.assignedTo);
      }
    }

    return {
      id: createId("plan"),
      goal: goalMatch ? goalMatch[1].trim() : goal,
      summary: summaryMatch ? summaryMatch[1].trim() : "Execution plan for: " + goal,
      phases: phases.sort((a, b) => a.order - b.order),
      estimatedComplexity: complexity as ExecutionPlan["estimatedComplexity"],
      requiredAgents: Array.from(requiredAgents),
      createdAt: new Date(),
      status: "draft",
    };
  }

  /**
   * Get the next tasks to execute based on dependencies
   */
  getNextTasks(plan: ExecutionPlan): AgentTask[] {
    const completedTaskIds = new Set<string>();
    const pendingTasks: AgentTask[] = [];

    // Collect completed and pending tasks
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        if (task.status === "completed") {
          completedTaskIds.add(task.id);
        } else if (task.status === "pending") {
          pendingTasks.push(task);
        }
      }
    }

    // Filter tasks whose dependencies are met
    return pendingTasks.filter(task => {
      return task.dependencies.every(depId => completedTaskIds.has(depId));
    });
  }

  /**
   * Update task status in the plan
   */
  updateTaskStatus(
    plan: ExecutionPlan,
    taskId: string,
    status: AgentTask["status"],
    result?: AgentExecutionResult
  ): void {
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        if (task.id === taskId) {
          task.status = status;
          task.updatedAt = new Date();
          if (status === "completed") {
            task.completedAt = new Date();
            if (result) {
              task.artifacts = result.artifacts;
            }
          }
          if (result?.error) {
            task.error = result.error;
          }
          return;
        }
      }
    }
  }

  /**
   * Check if all tasks in a phase are complete
   */
  isPhaseComplete(phase: PlanPhase): boolean {
    return phase.tasks.every(t => t.status === "completed");
  }

  /**
   * Check if the entire plan is complete
   */
  isPlanComplete(plan: ExecutionPlan): boolean {
    return plan.phases.every(p => this.isPhaseComplete(p));
  }

  /**
   * Synthesize results from all agents into a final summary
   */
  async synthesizeResults(
    plan: ExecutionPlan,
    results: Map<string, AgentExecutionResult>,
    context: SharedContext,
    tools: CodeBuddyTool[],
    executeTool: ToolExecutor
  ): Promise<string> {
    // Collect all artifacts
    const allArtifacts: TaskArtifact[] = [];
    for (const result of results.values()) {
      allArtifacts.push(...result.artifacts);
    }

    const synthesisTask: AgentTask = {
      id: createId("task"),
      title: "Synthesize Results",
      description: `Review and synthesize the results from all agents.

ORIGINAL GOAL: ${plan.goal}

COMPLETED PHASES:
${plan.phases.map(p => `- ${p.name}: ${p.tasks.length} tasks completed`).join("\n")}

ARTIFACTS PRODUCED:
${allArtifacts.map(a => `- ${a.name} (${a.type})`).join("\n")}

RESULTS SUMMARY:
${Array.from(results.entries()).map(([taskId, r]) =>
  `- Task ${taskId}: ${r.success ? "SUCCESS" : "FAILED"} - Used tools: ${r.toolsUsed.join(", ")}`
).join("\n")}

Please provide:
1. A summary of what was accomplished
2. Any remaining issues or recommendations
3. Next steps if applicable`,
      status: "in_progress",
      priority: "high",
      assignedTo: "orchestrator",
      dependencies: [],
      subtasks: [],
      artifacts: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await this.execute(synthesisTask, context, tools, executeTool);
    return result.output;
  }

  /**
   * Handle task failure and determine recovery strategy
   */
  determineRecoveryStrategy(
    task: AgentTask,
    error: string
  ): "retry" | "delegate" | "skip" | "abort" {
    // Simple heuristics for now
    if (error.includes("timeout")) {
      return "retry";
    }
    if (error.includes("permission") || error.includes("access denied")) {
      return "abort";
    }
    if (task.priority === "critical") {
      return "abort";
    }
    if (task.priority === "low") {
      return "skip";
    }
    return "delegate";
  }

  /**
   * Get current execution plan
   */
  getExecutionPlan(): ExecutionPlan | null {
    return this.executionPlan;
  }
}

export function createOrchestratorAgent(
  apiKey: string,
  baseURL?: string
): OrchestratorAgent {
  return new OrchestratorAgent(apiKey, baseURL);
}
