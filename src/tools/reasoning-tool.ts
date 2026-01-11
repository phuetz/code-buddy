/**
 * Reasoning Tool
 *
 * Exposes the Tree-of-Thought (ToT) reasoning engine as a tool
 * that can be used by the agent to solve complex problems.
 */

import { ToolResult } from "../types/index.js";
import { getTreeOfThoughtReasoner, TreeOfThoughtReasoner, ThinkingMode } from "../agent/reasoning/index.js";
import { Tool } from "./tool-manager.js";

export class ReasoningTool implements Tool {
  name = "reason";
  description = "Solve complex problems using Tree-of-Thought reasoning (MCTS). Use this when you need to plan, analyze, or solve difficult algorithmic or architectural problems step-by-step.";
  
  parameters = {
    type: "object",
    properties: {
      problem: {
        type: "string",
        description: "The problem statement or question to solve",
      },
      context: {
        type: "string",
        description: "Additional context or background information",
      },
      mode: {
        type: "string",
        enum: ["shallow", "medium", "deep", "exhaustive"],
        description: "Depth of reasoning (default: medium)",
      },
      constraints: {
        type: "array",
        items: { type: "string" },
        description: "List of constraints that must be satisfied",
      },
    },
    required: ["problem"],
  };

  private reasoner: TreeOfThoughtReasoner | null = null;

  private getReasoner(): TreeOfThoughtReasoner {
    if (!this.reasoner) {
      const apiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY || "";
      const baseURL = process.env.GROK_BASE_URL;
      this.reasoner = getTreeOfThoughtReasoner(apiKey, baseURL);
    }
    return this.reasoner;
  }

  async execute(args: {
    problem: string;
    context?: string;
    mode?: ThinkingMode;
    constraints?: string[];
  }): Promise<ToolResult> {
    try {
      const reasoner = this.getReasoner();
      
      if (args.mode) {
        reasoner.setMode(args.mode);
      }

      const result = await reasoner.solve({
        description: args.problem,
        context: args.context,
        constraints: args.constraints,
      });

      const output = reasoner.formatResult(result);

      return {
        success: result.success,
        output,
        data: result, // Return structured data as well
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Reasoning failed: ${errorMessage}`,
      };
    }
  }
}
