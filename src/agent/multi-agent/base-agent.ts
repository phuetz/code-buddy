/**
 * Base Agent Class
 *
 * Abstract base class for all specialized agents in the multi-agent system.
 * Provides common functionality for LLM interaction, tool execution, and messaging.
 */

import { EventEmitter } from "events";
import { CodeBuddyClient, CodeBuddyMessage, CodeBuddyTool } from "../../codebuddy/client.js";
import { getErrorMessage } from "../../types/index.js";
import {
  AgentRole,
  AgentConfig,
  AgentTask,
  AgentExecutionResult,
  AgentMessage,
  AgentFeedback,
  TaskArtifact,
  SharedContext,
  ToolExecutor,
  AgentCapability,
} from "./types.js";

/**
 * Abstract base class for all agents
 */
export abstract class BaseAgent extends EventEmitter {
  protected config: AgentConfig;
  protected client: CodeBuddyClient;
  protected messages: CodeBuddyMessage[] = [];
  protected isRunning: boolean = false;
  protected currentTask: AgentTask | null = null;
  protected artifacts: TaskArtifact[] = [];
  protected toolsUsed: string[] = [];
  protected rounds: number = 0;
  protected startTime: number = 0;

  constructor(
    config: AgentConfig,
    apiKey: string,
    baseURL?: string
  ) {
    super();
    this.config = {
      maxRounds: 30,
      timeout: 300000, // 5 minutes
      temperature: 0.7,
      ...config,
    };
    this.client = new CodeBuddyClient(
      apiKey,
      config.model || "grok-3-latest",
      baseURL
    );
    this.initializeSystemPrompt();
  }

  /**
   * Initialize the system prompt with agent-specific instructions
   */
  protected initializeSystemPrompt(): void {
    this.messages = [
      {
        role: "system",
        content: this.buildSystemPrompt(),
      },
    ];
  }

  /**
   * Build the complete system prompt for this agent
   */
  protected buildSystemPrompt(): string {
    const basePrompt = `You are ${this.config.name}, a specialized AI agent with the role of ${this.config.role}.

${this.config.description}

${this.config.systemPrompt}

COLLABORATION GUIDELINES:
1. You are part of a multi-agent system working together to solve complex tasks
2. Communicate clearly with other agents through structured messages
3. When you produce artifacts (code, documents, etc.), clearly mark them
4. If you need input from another agent, explicitly request it
5. Provide constructive feedback on other agents' work
6. Follow the execution plan and complete your assigned tasks

ARTIFACT FORMAT:
When producing code or documents, wrap them in artifact blocks:
<artifact type="code" name="filename.ts" language="typescript">
// code here
</artifact>

FEEDBACK FORMAT:
When reviewing work, use this structure:
<feedback type="suggestion|issue|approval" severity="critical|major|minor|info">
message here
</feedback>

Current working directory: ${process.cwd()}`;

    return basePrompt;
  }

  /**
   * Execute a task assigned to this agent
   */
  async execute(
    task: AgentTask,
    context: SharedContext,
    tools: CodeBuddyTool[],
    executeTool: ToolExecutor
  ): Promise<AgentExecutionResult> {
    this.isRunning = true;
    this.currentTask = task;
    this.artifacts = [];
    this.toolsUsed = [];
    this.rounds = 0;
    this.startTime = Date.now();

    this.emit("agent:start", { role: this.config.role, task });

    try {
      // Add task context to messages
      this.messages.push({
        role: "user",
        content: this.buildTaskPrompt(task, context),
      });

      // Filter tools based on agent capabilities
      const allowedTools = this.filterTools(tools);

      // Run the agent loop
      const output = await this.runAgentLoop(allowedTools, executeTool);

      // Parse artifacts from output
      this.parseArtifacts(output);

      const result: AgentExecutionResult = {
        success: true,
        role: this.config.role,
        taskId: task.id,
        output,
        artifacts: this.artifacts,
        toolsUsed: [...new Set(this.toolsUsed)],
        rounds: this.rounds,
        duration: Date.now() - this.startTime,
      };

      this.emit("agent:complete", { role: this.config.role, result });
      return result;

    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const result: AgentExecutionResult = {
        success: false,
        role: this.config.role,
        taskId: task.id,
        output: "",
        artifacts: [],
        toolsUsed: [...new Set(this.toolsUsed)],
        rounds: this.rounds,
        duration: Date.now() - this.startTime,
        error: errorMessage,
      };

      this.emit("agent:error", { role: this.config.role, error: errorMessage });
      return result;

    } finally {
      this.isRunning = false;
      this.currentTask = null;
    }
  }

  /**
   * Build the task-specific prompt
   */
  protected buildTaskPrompt(task: AgentTask, context: SharedContext): string {
    let prompt = `## TASK: ${task.title}

**Description:** ${task.description}

**Priority:** ${task.priority}

**Goal:** ${context.goal}

`;

    if (context.relevantFiles.length > 0) {
      prompt += `**Relevant Files:**
${context.relevantFiles.map(f => `- ${f}`).join("\n")}

`;
    }

    if (context.constraints.length > 0) {
      prompt += `**Constraints:**
${context.constraints.map(c => `- ${c}`).join("\n")}

`;
    }

    if (context.decisions.length > 0) {
      prompt += `**Previous Decisions:**
${context.decisions.slice(-5).map(d => `- ${d.description} (by ${d.madeBy})`).join("\n")}

`;
    }

    prompt += `Please complete this task thoroughly. Use the available tools to explore the codebase and make necessary changes.`;

    return prompt;
  }

  /**
   * Filter tools based on agent's allowed tools
   */
  protected filterTools(tools: CodeBuddyTool[]): CodeBuddyTool[] {
    if (!this.config.allowedTools || this.config.allowedTools.length === 0) {
      return tools;
    }

    return tools.filter(t =>
      this.config.allowedTools!.includes(t.function.name)
    );
  }

  /**
   * Run the main agent loop
   */
  protected async runAgentLoop(
    tools: CodeBuddyTool[],
    executeTool: ToolExecutor
  ): Promise<string> {
    const maxRounds = this.config.maxRounds || 30;
    let accumulatedOutput = "";

    while (this.isRunning && this.rounds < maxRounds) {
      // Check timeout
      if (Date.now() - this.startTime > (this.config.timeout || 300000)) {
        throw new Error("Agent execution timed out");
      }

      this.rounds++;
      this.emit("agent:round", { role: this.config.role, round: this.rounds });

      // Get response from LLM
      const response = await this.client.chat(this.messages, tools);
      const assistantMessage = response.choices[0]?.message;

      if (!assistantMessage) {
        throw new Error("No response from agent");
      }

      // Add assistant message to history
      this.messages.push({
        role: "assistant",
        content: assistantMessage.content || "",
        tool_calls: assistantMessage.tool_calls,
      } as CodeBuddyMessage);

      // Accumulate output
      if (assistantMessage.content) {
        accumulatedOutput += assistantMessage.content + "\n";
      }

      // Handle tool calls
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          this.toolsUsed.push(toolCall.function.name);
          this.emit("agent:tool", {
            role: this.config.role,
            tool: toolCall.function.name,
          });

          const result = await executeTool(toolCall);

          this.messages.push({
            role: "tool",
            content: result.success
              ? result.output || "Success"
              : result.error || "Error",
            tool_call_id: toolCall.id,
          });
        }
      } else {
        // No tool calls, agent is done
        break;
      }
    }

    return accumulatedOutput;
  }

  /**
   * Parse artifacts from the output
   */
  protected parseArtifacts(output: string): void {
    const artifactRegex = /<artifact\s+type="([^"]+)"\s+name="([^"]+)"(?:\s+language="([^"]+)")?>([\s\S]*?)<\/artifact>/g;

    let match;
    while ((match = artifactRegex.exec(output)) !== null) {
      const [, type, name, language, content] = match;
      this.artifacts.push({
        id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: type as TaskArtifact["type"],
        name,
        content: content.trim(),
        language,
        metadata: {},
      });
    }
  }

  /**
   * Parse feedback from the output
   */
  protected parseFeedback(output: string, taskId: string): AgentFeedback[] {
    const feedbackRegex = /<feedback\s+type="([^"]+)"\s+severity="([^"]+)">([\s\S]*?)<\/feedback>/g;
    const feedback: AgentFeedback[] = [];

    let match;
    while ((match = feedbackRegex.exec(output)) !== null) {
      const [, type, severity, message] = match;
      feedback.push({
        id: `feedback-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        from: this.config.role,
        to: "coder", // Default, should be overridden
        taskId,
        type: type as AgentFeedback["type"],
        severity: severity as AgentFeedback["severity"],
        message: message.trim(),
        suggestions: [],
      });
    }

    return feedback;
  }

  /**
   * Send a message to another agent
   */
  sendMessage(
    to: AgentRole | "all",
    type: AgentMessage["type"],
    content: string,
    data?: unknown
  ): AgentMessage {
    const message: AgentMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      from: this.config.role,
      to,
      type,
      content,
      data,
      timestamp: new Date(),
    };

    this.emit("agent:message", message);
    return message;
  }

  /**
   * Receive a message from another agent
   */
  receiveMessage(message: AgentMessage): void {
    this.messages.push({
      role: "user",
      content: `[Message from ${message.from}]\n${message.content}`,
    });
  }

  /**
   * Stop the agent
   */
  stop(): void {
    this.isRunning = false;
    this.emit("agent:stop", { role: this.config.role });
  }

  /**
   * Get agent configuration
   */
  getConfig(): AgentConfig {
    return { ...this.config };
  }

  /**
   * Get agent role
   */
  getRole(): AgentRole {
    return this.config.role;
  }

  /**
   * Check if agent has a specific capability
   */
  hasCapability(capability: string): boolean {
    return this.config.capabilities.includes(capability as AgentCapability);
  }

  /**
   * Reset agent state for new task
   */
  reset(): void {
    this.initializeSystemPrompt();
    this.artifacts = [];
    this.toolsUsed = [];
    this.rounds = 0;
    this.currentTask = null;
  }

  /**
   * Abstract method: Each agent must implement its specific behavior
   */
  abstract getSpecializedPrompt(): string;
}

/**
 * Create a unique ID
 */
export function createId(prefix: string = "id"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
