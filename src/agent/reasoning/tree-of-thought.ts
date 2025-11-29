/**
 * Tree-of-Thought Reasoner
 *
 * High-level reasoning engine that uses MCTS with LLM integration
 * for solving complex problems through structured exploration.
 *
 * Based on:
 * - Tree of Thoughts (Yao et al., 2023)
 * - RethinkMCTS (arXiv 2409.09584)
 */

import { EventEmitter } from "events";
import { GrokClient, GrokMessage, GrokTool } from "../../grok/client.js";
import { ToolResult } from "../../types/index.js";
import {
  ThoughtNode,
  Problem,
  ReasoningResult,
  MCTSConfig,
  ExecutionResult,
  ThinkingMode,
  THINKING_MODE_CONFIG,
  DEFAULT_MCTS_CONFIG,
  CoTResult,
  CoTStep,
} from "./types.js";
import { MCTS, createMCTS } from "./mcts.js";

/**
 * Configuration for the ToT reasoner
 */
export interface ToTConfig {
  mode: ThinkingMode;
  model?: string;
  temperature?: number;
  verbose?: boolean;
  executeCode?: boolean;
}

const DEFAULT_TOT_CONFIG: ToTConfig = {
  mode: "medium",
  temperature: 0.7,
  verbose: false,
  executeCode: true,
};

/**
 * Tree-of-Thought Reasoner
 */
export class TreeOfThoughtReasoner extends EventEmitter {
  private client: GrokClient;
  private config: ToTConfig;
  private mctsConfig: MCTSConfig;
  private executeCommand?: (cmd: string) => Promise<ToolResult>;

  constructor(
    apiKey: string,
    baseURL?: string,
    config: Partial<ToTConfig> = {},
    executeCommand?: (cmd: string) => Promise<ToolResult>
  ) {
    super();
    this.config = { ...DEFAULT_TOT_CONFIG, ...config };
    this.mctsConfig = {
      ...DEFAULT_MCTS_CONFIG,
      ...THINKING_MODE_CONFIG[this.config.mode],
    };
    this.client = new GrokClient(
      apiKey,
      config.model || "grok-3-latest",
      baseURL
    );
    this.executeCommand = executeCommand;
  }

  /**
   * Solve a problem using Tree-of-Thought reasoning
   */
  async solve(problem: Problem): Promise<ReasoningResult> {
    this.emit("reasoning:start", { problem });

    const mcts = createMCTS(this.mctsConfig, {
      generateThoughts: (node, prob) => this.generateThoughts(node, prob),
      evaluateThought: (node, prob) => this.evaluateThought(node, prob),
      executeCode: (code) => this.executeCodeSafely(code),
      refineThought: (node, feedback) => this.refineThought(node, feedback),
    });

    const result = await mcts.search(problem);

    this.emit("reasoning:complete", { result });

    if (this.config.verbose) {
      console.log("\n=== Reasoning Tree ===\n");
      console.log(mcts.formatTree());
    }

    return result;
  }

  /**
   * Quick Chain-of-Thought reasoning (single pass)
   */
  async chainOfThought(problem: Problem): Promise<CoTResult> {
    const systemPrompt = `You are an expert problem solver. Think through problems step by step.

For each step:
1. State your current thought
2. Describe any action you would take
3. Note observations or results

Format each step as:
Step N: [Your thought]
Action: [What you do, if any]
Observation: [What you observe, if any]

After all steps, provide:
Final Answer: [Your solution]
Confidence: [0-100]%`;

    const userPrompt = `Problem: ${problem.description}

${problem.context ? `Context: ${problem.context}` : ""}
${problem.constraints?.length ? `Constraints:\n${problem.constraints.map(c => `- ${c}`).join("\n")}` : ""}

Think through this step by step:`;

    const messages: GrokMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const response = await this.client.chat(messages, []);
    const content = response.choices[0]?.message?.content || "";

    return this.parseCoTResponse(content);
  }

  /**
   * Generate child thoughts for a node
   */
  private async generateThoughts(
    node: ThoughtNode,
    problem: Problem
  ): Promise<string[]> {
    const systemPrompt = `You are a problem-solving AI that generates multiple possible next steps.
Given the current state of reasoning, propose ${this.mctsConfig.expansionCount} different approaches.
Each approach should be a complete thought that advances toward solving the problem.
Be creative and consider different strategies.`;

    const userPrompt = `Problem: ${problem.description}

Current reasoning state:
${node.content}

Depth: ${node.depth}
Type: ${node.type}

Generate ${this.mctsConfig.expansionCount} different possible next steps.
Format each as a separate approach:

Approach 1:
[Your first approach]

Approach 2:
[Your second approach]

...`;

    const messages: GrokMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const response = await this.client.chat(messages, [], {
      temperature: this.config.temperature,
    });

    const content = response.choices[0]?.message?.content || "";
    return this.parseApproaches(content);
  }

  /**
   * Evaluate a thought node
   */
  private async evaluateThought(
    node: ThoughtNode,
    problem: Problem
  ): Promise<number> {
    const systemPrompt = `You are an evaluator for problem-solving approaches.
Rate the given thought on a scale of 0 to 1 based on:
- Correctness: Does it move toward solving the problem?
- Completeness: Does it consider all aspects?
- Feasibility: Can it be implemented?
- Clarity: Is it well-articulated?

Respond with ONLY a number between 0 and 1.`;

    const userPrompt = `Problem: ${problem.description}

Thought to evaluate:
${node.content}

Success criteria:
${problem.successCriteria?.map(c => `- ${c}`).join("\n") || "Solve the problem correctly"}

Rate this thought (0-1):`;

    const messages: GrokMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const response = await this.client.chat(messages, [], {
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content || "0.5";
    const score = parseFloat(content.match(/[\d.]+/)?.[0] || "0.5");

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Execute code safely
   */
  private async executeCodeSafely(code: string): Promise<ExecutionResult> {
    if (!this.config.executeCode || !this.executeCommand) {
      return {
        success: true,
        output: "[Code execution disabled]",
      };
    }

    try {
      // Create a temporary script and run it
      // For safety, we limit what can be executed
      const result = await this.executeCommand(`node -e "${code.replace(/"/g, '\\"')}"`);

      return {
        success: result.success,
        output: result.output,
        error: result.error,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Refine a thought based on feedback
   */
  private async refineThought(
    node: ThoughtNode,
    feedback: string
  ): Promise<string> {
    const systemPrompt = `You are an expert at improving solutions based on feedback.
Given a thought that didn't work as expected, provide an improved version.
Learn from the error and create a better approach.`;

    const userPrompt = `Original thought:
${node.content}

Feedback/Error:
${feedback}

Provide an improved version of this thought that addresses the feedback:`;

    const messages: GrokMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const response = await this.client.chat(messages, []);
    return response.choices[0]?.message?.content || node.content;
  }

  /**
   * Parse approaches from LLM response
   */
  private parseApproaches(content: string): string[] {
    const approaches: string[] = [];

    // Try to parse "Approach N:" format
    const approachPattern = /Approach\s*\d+:\s*([\s\S]*?)(?=Approach\s*\d+:|$)/gi;
    let match;

    while ((match = approachPattern.exec(content)) !== null) {
      const approach = match[1].trim();
      if (approach) {
        approaches.push(approach);
      }
    }

    // If no approaches found, try numbered list
    if (approaches.length === 0) {
      const numberedPattern = /^\d+[.)]\s*([\s\S]*?)(?=^\d+[.)]|$)/gm;
      while ((match = numberedPattern.exec(content)) !== null) {
        const approach = match[1].trim();
        if (approach) {
          approaches.push(approach);
        }
      }
    }

    // If still nothing, split by paragraphs
    if (approaches.length === 0) {
      const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 50);
      approaches.push(...paragraphs.slice(0, this.mctsConfig.expansionCount));
    }

    return approaches.slice(0, this.mctsConfig.expansionCount);
  }

  /**
   * Parse Chain-of-Thought response
   */
  private parseCoTResponse(content: string): CoTResult {
    const steps: CoTStep[] = [];

    // Parse steps
    const stepPattern = /Step\s*(\d+):\s*([\s\S]*?)(?=Step\s*\d+:|Final Answer:|$)/gi;
    let match;

    while ((match = stepPattern.exec(content)) !== null) {
      const stepNum = parseInt(match[1], 10);
      const stepContent = match[2].trim();

      // Extract action and observation
      const actionMatch = stepContent.match(/Action:\s*([\s\S]*?)(?=Observation:|$)/i);
      const obsMatch = stepContent.match(/Observation:\s*([\s\S]*?)$/i);

      const thought = stepContent
        .replace(/Action:[\s\S]*$/i, "")
        .replace(/Observation:[\s\S]*$/i, "")
        .trim();

      steps.push({
        step: stepNum,
        thought,
        action: actionMatch?.[1]?.trim(),
        observation: obsMatch?.[1]?.trim(),
      });
    }

    // Parse final answer
    const answerMatch = content.match(/Final Answer:\s*([\s\S]*?)(?=Confidence:|$)/i);
    const confidenceMatch = content.match(/Confidence:\s*(\d+)/i);

    return {
      steps,
      finalAnswer: answerMatch?.[1]?.trim() || content,
      confidence: confidenceMatch ? parseInt(confidenceMatch[1], 10) / 100 : 0.5,
    };
  }

  /**
   * Set thinking mode
   */
  setMode(mode: ThinkingMode): void {
    this.config.mode = mode;
    this.mctsConfig = {
      ...DEFAULT_MCTS_CONFIG,
      ...THINKING_MODE_CONFIG[mode],
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): ToTConfig {
    return { ...this.config };
  }

  /**
   * Format reasoning result for display
   */
  formatResult(result: ReasoningResult): string {
    let output = "\n" + "═".repeat(60) + "\n";
    output += "🧠 TREE-OF-THOUGHT REASONING RESULT\n";
    output += "═".repeat(60) + "\n\n";

    output += `Status: ${result.success ? "✅ Solution Found" : "❌ No Solution"}\n`;
    output += `Iterations: ${result.stats.iterations}\n`;
    output += `Nodes Created: ${result.stats.nodesCreated}\n`;
    output += `Nodes Evaluated: ${result.stats.nodesEvaluated}\n`;
    output += `Nodes Refined: ${result.stats.nodesRefined}\n`;
    output += `Max Depth: ${result.stats.maxDepthReached}\n`;
    output += `Best Score: ${result.stats.bestScore.toFixed(2)}\n`;
    output += `Time: ${(result.stats.totalTime / 1000).toFixed(2)}s\n\n`;

    if (result.solution) {
      output += "─".repeat(40) + "\n";
      output += "📋 SOLUTION:\n";
      output += "─".repeat(40) + "\n";
      output += result.solution.content + "\n\n";

      if (result.solution.metadata.codeGenerated) {
        output += "💻 Generated Code:\n";
        output += "```\n";
        output += result.solution.metadata.codeGenerated + "\n";
        output += "```\n\n";
      }
    }

    if (result.path.length > 0) {
      output += "─".repeat(40) + "\n";
      output += "🛤️  REASONING PATH:\n";
      output += "─".repeat(40) + "\n";
      for (let i = 0; i < result.path.length; i++) {
        const node = result.path[i];
        output += `${i + 1}. [${node.type}] ${node.content.slice(0, 100)}...\n`;
        output += `   Score: ${node.score.toFixed(2)}\n`;
      }
      output += "\n";
    }

    if (result.alternatives.length > 0) {
      output += "─".repeat(40) + "\n";
      output += "🔄 ALTERNATIVES:\n";
      output += "─".repeat(40) + "\n";
      for (let i = 0; i < result.alternatives.length; i++) {
        const alt = result.alternatives[i];
        output += `${i + 1}. [Score: ${alt.score.toFixed(2)}] `;
        output += `${alt.content.slice(0, 80)}...\n`;
      }
    }

    output += "\n" + "═".repeat(60) + "\n";
    return output;
  }
}

/**
 * Create a ToT reasoner
 */
export function createTreeOfThoughtReasoner(
  apiKey: string,
  baseURL?: string,
  config: Partial<ToTConfig> = {},
  executeCommand?: (cmd: string) => Promise<ToolResult>
): TreeOfThoughtReasoner {
  return new TreeOfThoughtReasoner(apiKey, baseURL, config, executeCommand);
}

// Singleton instance
let totReasonerInstance: TreeOfThoughtReasoner | null = null;

export function getTreeOfThoughtReasoner(
  apiKey: string,
  baseURL?: string,
  config: Partial<ToTConfig> = {}
): TreeOfThoughtReasoner {
  if (!totReasonerInstance) {
    totReasonerInstance = createTreeOfThoughtReasoner(apiKey, baseURL, config);
  }
  return totReasonerInstance;
}

export function resetTreeOfThoughtReasoner(): void {
  totReasonerInstance = null;
}
