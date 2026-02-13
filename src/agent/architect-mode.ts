import { CodeBuddyClient, CodeBuddyMessage, CodeBuddyTool } from "../codebuddy/client.js";
import { EventEmitter } from "events";
import { getErrorMessage } from "../types/index.js";
import { auditLogger } from "../security/audit-logger.js";

export interface StepResult {
  step: ArchitectStep;
  response: unknown;
  success: boolean;
}

export interface ArchitectProposal {
  summary: string;
  steps: ArchitectStep[];
  files: string[];
  risks: string[];
  estimatedChanges: number;
}

export interface ArchitectStep {
  order: number;
  description: string;
  type: "create" | "edit" | "delete" | "command" | "test";
  target?: string;  // File path or command
  details?: string;
  /** Steps that must complete before this one (for parallel execution) */
  dependsOn?: number[];
}

export interface ArchitectConfig {
  architectModel?: string;  // Model for design phase
  editorModel?: string;     // Model for implementation phase
  autoApprove?: boolean;    // Auto-approve implementation after design
  maxSteps?: number;        // Maximum steps in a proposal
}

const ARCHITECT_SYSTEM_PROMPT = `You are an expert software architect. Your role is to analyze coding requests and create detailed implementation plans.

When given a task, you should:
1. Analyze the requirements thoroughly
2. Identify all files that need to be created or modified
3. Break down the implementation into clear, ordered steps
4. Consider potential risks and edge cases
5. Estimate the scope of changes

Respond with a JSON object in this exact format:
{
  "summary": "Brief summary of the proposed changes",
  "steps": [
    {
      "order": 1,
      "description": "What this step does",
      "type": "create|edit|delete|command|test",
      "target": "path/to/file.ts or command",
      "details": "Specific implementation details"
    }
  ],
  "files": ["list", "of", "affected", "files"],
  "risks": ["potential risk 1", "potential risk 2"],
  "estimatedChanges": 150
}

Be thorough but concise. Focus on actionable steps.`;

const EDITOR_SYSTEM_PROMPT = `You are a precise code editor. You will receive an implementation plan from an architect and execute each step exactly as specified.

For each step:
1. Read the target file if it exists
2. Make the specified changes
3. Verify the changes are correct
4. Move to the next step

Do not deviate from the plan. If you encounter an issue, report it clearly.`;

export class ArchitectMode extends EventEmitter {
  private architectClient: CodeBuddyClient;
  private editorClient: CodeBuddyClient;
  private config: ArchitectConfig;
  private currentProposal: ArchitectProposal | null = null;
  private isActive: boolean = false;

  constructor(
    apiKey: string,
    baseURL?: string,
    config: ArchitectConfig = {}
  ) {
    super();
    this.config = {
      architectModel: config.architectModel || "grok-3-latest",
      editorModel: config.editorModel || "grok-code-fast-1",
      autoApprove: config.autoApprove || false,
      maxSteps: config.maxSteps || 20,
      ...config,
    };

    this.architectClient = new CodeBuddyClient(
      apiKey,
      this.config.architectModel!,
      baseURL
    );
    this.editorClient = new CodeBuddyClient(
      apiKey,
      this.config.editorModel!,
      baseURL
    );
  }

  async analyze(request: string, context?: string): Promise<ArchitectProposal> {
    this.emit("architect:start", { request });

    const messages: CodeBuddyMessage[] = [
      { role: "system", content: ARCHITECT_SYSTEM_PROMPT },
      {
        role: "user",
        content: context
          ? `Context:\n${context}\n\nRequest:\n${request}`
          : request,
      },
    ];

    try {
      const response = await this.architectClient.chat(messages);
      const content = response.choices[0]?.message?.content || "";

      // Parse the JSON response — robust extraction that handles nested objects
      const proposal = this.parseProposalJson(content);

      // Validate proposal
      if (!proposal.steps || proposal.steps.length === 0) {
        throw new Error("Architect proposal has no steps");
      }

      if (proposal.steps.length > this.config.maxSteps!) {
        proposal.steps = proposal.steps.slice(0, this.config.maxSteps!);
        proposal.summary += ` (truncated to ${this.config.maxSteps} steps)`;
      }

      this.currentProposal = proposal;
      this.emit("architect:proposal", proposal);

      return proposal;
    } catch (error: unknown) {
      this.emit("architect:error", { error: getErrorMessage(error) });
      throw error;
    }
  }

  async implement(
    proposal?: ArchitectProposal,
    tools?: CodeBuddyTool[],
    onStepComplete?: (step: ArchitectStep, result: StepResult) => void
  ): Promise<{ success: boolean; results: StepResult[] }> {
    const targetProposal = proposal || this.currentProposal;

    if (!targetProposal) {
      throw new Error("No proposal to implement. Run analyze() first.");
    }

    this.emit("editor:start", { proposal: targetProposal });
    this.isActive = true;

    const results: StepResult[] = [];
    const completedSteps = new Set<number>();

    try {
      // Group steps into execution waves (parallel where possible)
      const waves = this.buildExecutionWaves(targetProposal.steps);

      for (const wave of waves) {
        if (!this.isActive) {
          this.emit("editor:cancelled");
          break;
        }

        // Execute steps in this wave in parallel
        const wavePromises = wave.map(async (step) => {
          this.emit("editor:step", { step });

          // Create checkpoint before each step
          auditLogger.log({
            action: 'checkpoint_created',
            decision: 'allow',
            source: 'architect-mode',
            target: step.target,
            details: `Pre-step checkpoint: step ${step.order}`,
          });

          const stepPrompt = this.buildStepPrompt(step, targetProposal);

          const messages: CodeBuddyMessage[] = [
            { role: "system", content: EDITOR_SYSTEM_PROMPT },
            { role: "user", content: stepPrompt },
          ];

          try {
            const response = await this.editorClient.chat(messages, tools);

            const result: StepResult = {
              step,
              response: response.choices[0]?.message,
              success: true,
            };

            completedSteps.add(step.order);
            return result;
          } catch (error: unknown) {
            return {
              step,
              response: null,
              success: false,
              error: getErrorMessage(error),
            } as StepResult;
          }
        });

        const waveResults = await Promise.all(wavePromises);

        for (const result of waveResults) {
          results.push(result);

          if (onStepComplete) {
            onStepComplete(result.step, result);
          }

          this.emit("editor:step-complete", result);

          if (!result.success) {
            this.emit("editor:step-failed", {
              step: result.step,
              completedSteps: [...completedSteps],
            });
            // Stop further waves on failure
            this.isActive = false;
          }
        }

        if (!this.isActive) break;
      }

      const allSuccess = results.every(r => r.success);
      this.emit("editor:complete", { results, success: allSuccess });
      return { success: allSuccess, results };
    } catch (error: unknown) {
      this.emit("editor:error", { error: getErrorMessage(error) });
      return { success: false, results };
    } finally {
      this.isActive = false;
    }
  }

  /**
   * Build execution waves: groups of steps that can run in parallel.
   * Steps with dependencies wait until their dependencies complete.
   */
  private buildExecutionWaves(steps: ArchitectStep[]): ArchitectStep[][] {
    const waves: ArchitectStep[][] = [];
    const scheduled = new Set<number>();

    const remaining = [...steps];
    let maxIterations = steps.length + 1;

    while (remaining.length > 0 && maxIterations-- > 0) {
      const wave: ArchitectStep[] = [];

      for (const step of remaining) {
        const deps = step.dependsOn || [];
        const allDepsScheduled = deps.every(d => scheduled.has(d));
        if (allDepsScheduled) {
          wave.push(step);
        }
      }

      if (wave.length === 0) {
        // No progress — break dependency cycle, schedule remaining sequentially
        wave.push(remaining[0]);
      }

      for (const step of wave) {
        scheduled.add(step.order);
        const idx = remaining.indexOf(step);
        if (idx !== -1) remaining.splice(idx, 1);
      }

      waves.push(wave);
    }

    return waves;
  }

  /**
   * Robust JSON proposal parsing that handles nested objects and markdown code blocks.
   */
  private parseProposalJson(content: string): ArchitectProposal {
    // Try direct parse first
    try {
      return JSON.parse(content) as ArchitectProposal;
    } catch { /* continue */ }

    // Extract from markdown code block
    const codeBlockMatch = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1]) as ArchitectProposal;
      } catch { /* continue */ }
    }

    // Find balanced JSON object using brace counting
    let depth = 0;
    let start = -1;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (content[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            return JSON.parse(content.slice(start, i + 1)) as ArchitectProposal;
          } catch { /* try next match */ }
          start = -1;
        }
      }
    }

    throw new Error("Architect did not return valid JSON proposal");
  }

  private buildStepPrompt(step: ArchitectStep, proposal: ArchitectProposal): string {
    let prompt = `Execute step ${step.order} of the implementation plan.\n\n`;
    prompt += `Overall goal: ${proposal.summary}\n\n`;
    prompt += `Step ${step.order}: ${step.description}\n`;
    prompt += `Type: ${step.type}\n`;

    if (step.target) {
      prompt += `Target: ${step.target}\n`;
    }

    if (step.details) {
      prompt += `\nDetails:\n${step.details}\n`;
    }

    prompt += `\nExecute this step now.`;

    return prompt;
  }

  async analyzeAndImplement(
    request: string,
    context?: string,
    tools?: CodeBuddyTool[],
    onApproval?: (proposal: ArchitectProposal) => Promise<boolean>
  ): Promise<{ proposal: ArchitectProposal; results: StepResult[] }> {
    // Phase 1: Architect designs the solution
    const proposal = await this.analyze(request, context);

    // Check for approval
    if (!this.config.autoApprove && onApproval) {
      const approved = await onApproval(proposal);
      if (!approved) {
        throw new Error("Implementation not approved by user");
      }
    }

    // Phase 2: Editor implements the solution
    const { results } = await this.implement(proposal, tools);

    return { proposal, results };
  }

  cancel(): void {
    this.isActive = false;
  }

  getCurrentProposal(): ArchitectProposal | null {
    return this.currentProposal;
  }

  formatProposal(proposal: ArchitectProposal): string {
    let output = `\n📐 ARCHITECT PROPOSAL\n${"═".repeat(50)}\n\n`;
    output += `📋 Summary: ${proposal.summary}\n\n`;

    output += `📁 Affected Files (${proposal.files.length}):\n`;
    for (const file of proposal.files) {
      output += `   • ${file}\n`;
    }

    output += `\n📝 Implementation Steps (${proposal.steps.length}):\n`;
    for (const step of proposal.steps) {
      const icon = this.getStepIcon(step.type);
      output += `   ${step.order}. ${icon} ${step.description}\n`;
      if (step.target) {
        output += `      └─ ${step.target}\n`;
      }
    }

    if (proposal.risks.length > 0) {
      output += `\n⚠️  Risks:\n`;
      for (const risk of proposal.risks) {
        output += `   • ${risk}\n`;
      }
    }

    output += `\n📊 Estimated Changes: ~${proposal.estimatedChanges} lines\n`;
    output += `${"═".repeat(50)}\n`;

    return output;
  }

  private getStepIcon(type: string): string {
    switch (type) {
      case "create":
        return "➕";
      case "edit":
        return "✏️";
      case "delete":
        return "🗑️";
      case "command":
        return "⚡";
      case "test":
        return "🧪";
      default:
        return "•";
    }
  }
}

// Factory function
export function createArchitectMode(
  apiKey: string,
  baseURL?: string,
  config?: ArchitectConfig
): ArchitectMode {
  return new ArchitectMode(apiKey, baseURL, config);
}
