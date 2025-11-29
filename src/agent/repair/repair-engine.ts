/**
 * Automated Program Repair Engine
 *
 * Main repair orchestration that combines multiple repair strategies:
 * - Template-based repair
 * - Search-based repair
 * - LLM-guided repair
 *
 * Based on research:
 * - RepairAgent (ICSE 2024) - LLM-guided repair
 * - AgentCoder (Huang et al., 2023) - Test-driven repair
 * - ITER (arXiv 2403.00418) - Iterative template repair
 */

import { EventEmitter } from "events";
import { GrokClient, GrokMessage } from "../../grok/client.js";
import {
  Fault,
  FaultType,
  RepairConfig,
  RepairResult,
  RepairPatch,
  PatchChange,
  RepairStrategy,
  TestValidationResult,
  RepairSession,
  RepairStats,
  RepairLearningData,
  DEFAULT_REPAIR_CONFIG,
  TestExecutor,
  CommandExecutor,
  FileReader,
  FileWriter,
} from "./types.js";
import { FaultLocalizer, createFaultLocalizer } from "./fault-localization.js";
import { TemplateRepairEngine, createTemplateRepairEngine } from "./repair-templates.js";

/**
 * LLM prompts for repair
 */
const REPAIR_SYSTEM_PROMPT = `You are an expert software engineer specialized in debugging and fixing code.
Your task is to analyze bugs and generate precise fixes.

When generating a fix:
1. Analyze the error message and stack trace carefully
2. Understand the code context around the bug
3. Generate the minimal change needed to fix the issue
4. Explain why your fix works
5. Consider edge cases and potential side effects

Output format:
<fix>
<file>path/to/file</file>
<line_start>10</line_start>
<line_end>15</line_end>
<original>
original code here
</original>
<fixed>
fixed code here
</fixed>
<explanation>Why this fix works</explanation>
</fix>`;

const REPAIR_USER_PROMPT = `Fix the following bug:

**Error:**
{error_message}

**Location:**
File: {file}
Lines: {start_line}-{end_line}

**Code Context:**
\`\`\`{language}
{code_context}
\`\`\`

**Stack Trace (if available):**
{stack_trace}

Please analyze the bug and provide a fix.`;

/**
 * Automated Program Repair Engine
 */
export class RepairEngine extends EventEmitter {
  private config: RepairConfig;
  private client: GrokClient | null = null;
  private faultLocalizer: FaultLocalizer;
  private templateEngine: TemplateRepairEngine;
  private sessions: RepairSession[] = [];
  private learningData: RepairLearningData[] = [];

  // External executors
  private testExecutor?: TestExecutor;
  private commandExecutor?: CommandExecutor;
  private fileReader?: FileReader;
  private fileWriter?: FileWriter;

  constructor(
    config: Partial<RepairConfig> = {},
    apiKey?: string,
    baseURL?: string
  ) {
    super();
    this.config = { ...DEFAULT_REPAIR_CONFIG, ...config };

    if (apiKey) {
      this.client = new GrokClient(apiKey, "grok-3-latest", baseURL);
    }

    this.faultLocalizer = createFaultLocalizer(
      this.config.faultLocalization,
      this.fileReader
    );
    this.templateEngine = createTemplateRepairEngine();
  }

  /**
   * Set external executors
   */
  setExecutors(executors: {
    testExecutor?: TestExecutor;
    commandExecutor?: CommandExecutor;
    fileReader?: FileReader;
    fileWriter?: FileWriter;
  }): void {
    this.testExecutor = executors.testExecutor;
    this.commandExecutor = executors.commandExecutor;
    this.fileReader = executors.fileReader;
    this.fileWriter = executors.fileWriter;

    // Update fault localizer with file reader
    if (this.fileReader) {
      this.faultLocalizer = createFaultLocalizer(
        this.config.faultLocalization,
        this.fileReader
      );
    }
  }

  /**
   * Main repair entry point
   */
  async repair(
    errorOutput: string,
    contextHint?: string
  ): Promise<RepairResult[]> {
    const sessionId = `session-${Date.now()}`;
    const session: RepairSession = {
      id: sessionId,
      startTime: new Date(),
      faults: [],
      results: [],
      config: this.config,
      stats: this.initializeStats(),
    };

    this.emit("repair:session:start", { sessionId });

    try {
      // Step 1: Fault Localization
      this.emit("repair:progress", { message: "Localizing faults...", progress: 0.1 });
      const localizationResult = await this.faultLocalizer.localize(errorOutput);
      session.faults = localizationResult.faults;

      this.emit("repair:localization", { result: localizationResult });

      if (session.faults.length === 0) {
        // Try to create a fault from the raw error
        const genericFault = this.createGenericFault(errorOutput);
        if (genericFault) {
          session.faults.push(genericFault);
        } else {
          return [];
        }
      }

      // Step 2: Repair each fault
      const results: RepairResult[] = [];
      for (let i = 0; i < session.faults.length; i++) {
        const fault = session.faults[i];
        const progress = 0.1 + (0.8 * (i + 1)) / session.faults.length;
        this.emit("repair:progress", {
          message: `Repairing fault ${i + 1}/${session.faults.length}...`,
          progress,
        });

        const result = await this.repairFault(fault, contextHint);
        results.push(result);
        session.results.push(result);

        // Update stats
        this.updateStats(session.stats, result);
      }

      // Step 3: Finalize session
      session.endTime = new Date();
      this.sessions.push(session);

      this.emit("repair:session:end", { session, results });
      return results;
    } catch (error: any) {
      this.emit("repair:error", { error: error.message });
      throw error;
    }
  }

  /**
   * Repair a single fault
   */
  private async repairFault(
    fault: Fault,
    contextHint?: string
  ): Promise<RepairResult> {
    const startTime = Date.now();
    const result: RepairResult = {
      success: false,
      fault,
      candidatesGenerated: 0,
      candidatesTested: 0,
      allPatches: [],
      iterations: 0,
      duration: 0,
    };

    this.emit("repair:start", { fault, config: this.config });

    try {
      // Get code context
      const codeContext = await this.getCodeContext(fault);

      // Generate candidates from multiple sources
      const candidates: RepairPatch[] = [];

      // 1. Template-based repair
      if (this.config.useTemplates) {
        const templatePatches = this.templateEngine.generatePatches(
          fault,
          codeContext,
          Math.floor(this.config.maxCandidates / 2)
        );
        candidates.push(...templatePatches);
      }

      // 2. LLM-guided repair
      if (this.config.useLLM && this.client) {
        const llmPatches = await this.generateLLMPatches(
          fault,
          codeContext,
          contextHint,
          this.config.maxCandidates - candidates.length
        );
        candidates.push(...llmPatches);
      }

      result.candidatesGenerated = candidates.length;
      result.allPatches = candidates;

      if (candidates.length === 0) {
        result.reason = "No repair candidates generated";
        return result;
      }

      // Validate candidates
      for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
        result.iterations++;

        for (const patch of candidates) {
          if (patch.validated) continue;

          result.candidatesTested++;
          this.emit("repair:candidate", { patch });

          // Validate the patch
          const validationResult = await this.validatePatch(patch, fault);
          patch.validated = true;
          patch.testResults = validationResult;

          this.emit("repair:validation", { patch, result: validationResult });

          if (validationResult.success && validationResult.newFailures.length === 0) {
            // Patch is valid!
            result.success = true;
            result.appliedPatch = patch;

            // Apply the patch
            if (this.fileWriter) {
              await this.applyPatch(patch);
            }

            // Record success for learning
            this.recordLearning(fault, patch, candidates.filter(c => c !== patch));

            // Update template success rates
            if (patch.generatedBy === "template") {
              this.templateEngine.recordResult(patch.id, true);
            }

            this.emit("repair:success", { result });
            result.duration = Date.now() - startTime;
            return result;
          } else {
            // Record failure for template
            if (patch.generatedBy === "template") {
              this.templateEngine.recordResult(patch.id, false);
            }
          }
        }

        // If no patch worked, try to generate more with refinement
        if (this.config.useLLM && this.client && iteration < this.config.maxIterations - 1) {
          const refinedPatches = await this.refinePatchesWithLLM(
            fault,
            codeContext,
            candidates.filter(c => !c.testResults?.success)
          );
          candidates.push(...refinedPatches);
        }
      }

      result.reason = "No valid patch found after all iterations";
      this.emit("repair:failure", { result });
      result.duration = Date.now() - startTime;
      return result;
    } catch (error: any) {
      result.reason = error.message;
      result.duration = Date.now() - startTime;
      return result;
    }
  }

  /**
   * Generate patches using LLM
   */
  private async generateLLMPatches(
    fault: Fault,
    codeContext: string,
    contextHint?: string,
    maxPatches: number = 3
  ): Promise<RepairPatch[]> {
    if (!this.client) return [];

    const patches: RepairPatch[] = [];

    try {
      const userPrompt = REPAIR_USER_PROMPT
        .replace("{error_message}", fault.message)
        .replace("{file}", fault.location.file)
        .replace("{start_line}", String(fault.location.startLine))
        .replace("{end_line}", String(fault.location.endLine))
        .replace("{language}", this.detectLanguage(fault.location.file))
        .replace("{code_context}", codeContext)
        .replace("{stack_trace}", fault.stackTrace || "N/A");

      const messages: GrokMessage[] = [
        { role: "system", content: REPAIR_SYSTEM_PROMPT },
        { role: "user", content: userPrompt + (contextHint ? `\n\nAdditional context: ${contextHint}` : "") },
      ];

      // Generate multiple candidates with higher temperature
      for (let i = 0; i < maxPatches; i++) {
        const response = await this.client.chat(messages, [], {
          temperature: 0.3 + i * 0.2, // Increase diversity
        });

        const content = response.choices[0]?.message?.content || "";
        const patch = this.parseLLMPatch(content, fault);

        if (patch) {
          patches.push(patch);
        }
      }
    } catch (error) {
      // LLM generation failed, return empty
    }

    return patches;
  }

  /**
   * Parse LLM response to extract patch
   */
  private parseLLMPatch(content: string, fault: Fault): RepairPatch | null {
    const fixMatch = content.match(
      /<fix>([\s\S]*?)<\/fix>/
    );

    if (!fixMatch) {
      // Try to extract code blocks as fallback
      const codeMatch = content.match(/```[\w]*\n([\s\S]*?)```/);
      if (codeMatch) {
        return {
          id: `patch-llm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          fault,
          changes: [{
            file: fault.location.file,
            type: "replace",
            startLine: fault.location.startLine,
            endLine: fault.location.endLine,
            originalCode: fault.location.snippet || "",
            newCode: codeMatch[1].trim(),
          }],
          strategy: "llm_generated",
          confidence: 0.5,
          explanation: "LLM-generated fix",
          generatedBy: "llm",
          validated: false,
        };
      }
      return null;
    }

    const fixContent = fixMatch[1];

    // Parse fix components
    const fileMatch = fixContent.match(/<file>([^<]+)<\/file>/);
    const startMatch = fixContent.match(/<line_start>(\d+)<\/line_start>/);
    const endMatch = fixContent.match(/<line_end>(\d+)<\/line_end>/);
    const originalMatch = fixContent.match(/<original>([\s\S]*?)<\/original>/);
    const fixedMatch = fixContent.match(/<fixed>([\s\S]*?)<\/fixed>/);
    const explanationMatch = fixContent.match(/<explanation>([\s\S]*?)<\/explanation>/);

    if (!fixedMatch) return null;

    const change: PatchChange = {
      file: fileMatch?.[1] || fault.location.file,
      type: "replace",
      startLine: startMatch ? parseInt(startMatch[1], 10) : fault.location.startLine,
      endLine: endMatch ? parseInt(endMatch[1], 10) : fault.location.endLine,
      originalCode: originalMatch?.[1]?.trim() || "",
      newCode: fixedMatch[1].trim(),
    };

    return {
      id: `patch-llm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      fault,
      changes: [change],
      strategy: "llm_generated",
      confidence: 0.7,
      explanation: explanationMatch?.[1]?.trim() || "LLM-generated fix",
      generatedBy: "llm",
      validated: false,
    };
  }

  /**
   * Refine patches based on failed attempts
   */
  private async refinePatchesWithLLM(
    fault: Fault,
    codeContext: string,
    failedPatches: RepairPatch[]
  ): Promise<RepairPatch[]> {
    if (!this.client || failedPatches.length === 0) return [];

    const failedInfo = failedPatches
      .map((p, i) => `Attempt ${i + 1}:\n${p.changes[0]?.newCode}\nResult: ${p.testResults?.failingTests.join(", ") || "Unknown"}`)
      .join("\n\n");

    const messages: GrokMessage[] = [
      { role: "system", content: REPAIR_SYSTEM_PROMPT },
      {
        role: "user",
        content: `The following fix attempts failed. Please analyze why and suggest a better fix.

**Original Error:** ${fault.message}

**Code Context:**
\`\`\`
${codeContext}
\`\`\`

**Failed Attempts:**
${failedInfo}

Please provide an improved fix that addresses the issues with the previous attempts.`,
      },
    ];

    try {
      const response = await this.client.chat(messages, [], { temperature: 0.5 });
      const content = response.choices[0]?.message?.content || "";
      const patch = this.parseLLMPatch(content, fault);
      return patch ? [patch] : [];
    } catch {
      return [];
    }
  }

  /**
   * Validate a patch by running tests
   */
  private async validatePatch(
    patch: RepairPatch,
    fault: Fault
  ): Promise<TestValidationResult> {
    const defaultResult: TestValidationResult = {
      success: true,
      testsRun: 0,
      testsPassed: 0,
      testsFailed: 0,
      failingTests: [],
      newFailures: [],
      regressions: [],
      duration: 0,
    };

    if (!this.config.validateWithTests || !this.testExecutor) {
      // No test validation, assume success
      return defaultResult;
    }

    // Backup original file
    let originalContent: string | null = null;
    if (this.fileReader && this.fileWriter) {
      try {
        originalContent = await this.fileReader(patch.changes[0].file);

        // Apply patch temporarily
        await this.applyPatch(patch);

        // Run tests
        const result = await this.testExecutor();

        // Restore original
        await this.fileWriter(patch.changes[0].file, originalContent);

        return result;
      } catch (error: any) {
        // Restore on error
        if (originalContent && this.fileWriter) {
          await this.fileWriter(patch.changes[0].file, originalContent);
        }
        return {
          ...defaultResult,
          success: false,
          failingTests: [error.message],
        };
      }
    }

    return defaultResult;
  }

  /**
   * Apply a patch to the file system
   */
  private async applyPatch(patch: RepairPatch): Promise<void> {
    if (!this.fileReader || !this.fileWriter) return;

    for (const change of patch.changes) {
      const content = await this.fileReader(change.file);
      const lines = content.split("\n");

      // Replace lines
      const newLines = [
        ...lines.slice(0, change.startLine - 1),
        change.newCode,
        ...lines.slice(change.endLine),
      ];

      await this.fileWriter(change.file, newLines.join("\n"));
    }
  }

  /**
   * Get code context around a fault location
   */
  private async getCodeContext(fault: Fault): Promise<string> {
    if (fault.location.snippet) {
      return fault.location.snippet;
    }

    if (!this.fileReader) {
      return "";
    }

    try {
      const content = await this.fileReader(fault.location.file);
      const lines = content.split("\n");

      // Get 10 lines before and after
      const startLine = Math.max(0, fault.location.startLine - 11);
      const endLine = Math.min(lines.length, fault.location.endLine + 10);

      return lines.slice(startLine, endLine).join("\n");
    } catch {
      return "";
    }
  }

  /**
   * Create a generic fault from error output
   */
  private createGenericFault(errorOutput: string): Fault | null {
    // Try to extract any file reference
    const fileMatch = errorOutput.match(/(?:at|in|file)\s+([^\s:]+\.(?:ts|js|tsx|jsx|py|rb|go|rs|java|c|cpp)):?(\d+)?/i);

    if (fileMatch) {
      return {
        id: `fault-generic-${Date.now()}`,
        type: "unknown",
        severity: "medium",
        message: errorOutput.slice(0, 500),
        location: {
          file: fileMatch[1],
          startLine: fileMatch[2] ? parseInt(fileMatch[2], 10) : 1,
          endLine: fileMatch[2] ? parseInt(fileMatch[2], 10) : 1,
        },
        suspiciousness: 0.5,
        metadata: { generic: true },
      };
    }

    return null;
  }

  /**
   * Detect programming language from file extension
   */
  private detectLanguage(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      py: "python",
      rb: "ruby",
      go: "go",
      rs: "rust",
      java: "java",
      c: "c",
      cpp: "cpp",
      cs: "csharp",
    };
    return langMap[ext || ""] || "text";
  }

  /**
   * Initialize stats object
   */
  private initializeStats(): RepairStats {
    return {
      totalFaults: 0,
      repairedFaults: 0,
      failedFaults: 0,
      averageIterations: 0,
      averageCandidates: 0,
      averageDuration: 0,
      strategySuccessRates: new Map(),
      templateSuccessRates: new Map(),
    };
  }

  /**
   * Update stats with a repair result
   */
  private updateStats(stats: RepairStats, result: RepairResult): void {
    stats.totalFaults++;
    if (result.success) {
      stats.repairedFaults++;
    } else {
      stats.failedFaults++;
    }

    // Update averages
    const n = stats.totalFaults;
    stats.averageIterations =
      ((n - 1) * stats.averageIterations + result.iterations) / n;
    stats.averageCandidates =
      ((n - 1) * stats.averageCandidates + result.candidatesGenerated) / n;
    stats.averageDuration =
      ((n - 1) * stats.averageDuration + result.duration) / n;

    // Update strategy success rates
    if (result.appliedPatch) {
      const strategy = result.appliedPatch.strategy;
      const current = stats.strategySuccessRates.get(strategy) || 0;
      stats.strategySuccessRates.set(strategy, current + 1);
    }
  }

  /**
   * Record learning data from successful repair
   */
  private recordLearning(
    fault: Fault,
    successfulPatch: RepairPatch,
    failedPatches: RepairPatch[]
  ): void {
    if (!this.config.learningEnabled) return;

    this.learningData.push({
      fault,
      successfulPatch,
      failedPatches,
      codeContext: fault.location.snippet || "",
      fileType: fault.location.file.split(".").pop() || "unknown",
    });

    // Keep only recent learning data
    if (this.learningData.length > 1000) {
      this.learningData = this.learningData.slice(-500);
    }
  }

  /**
   * Get repair statistics
   */
  getStatistics(): RepairStats {
    const stats = this.initializeStats();

    for (const session of this.sessions) {
      for (const result of session.results) {
        this.updateStats(stats, result);
      }
    }

    return stats;
  }

  /**
   * Get repair history
   */
  getHistory(): RepairSession[] {
    return [...this.sessions];
  }

  /**
   * Clear repair history
   */
  clearHistory(): void {
    this.sessions = [];
    this.learningData = [];
  }

  /**
   * Format repair result for display
   */
  formatResult(result: RepairResult): string {
    const lines: string[] = [];

    lines.push("═".repeat(60));
    lines.push(`🔧 AUTOMATED PROGRAM REPAIR RESULT`);
    lines.push("═".repeat(60));
    lines.push("");

    lines.push(`Status: ${result.success ? "✅ Fixed" : "❌ Not Fixed"}`);
    lines.push(`Fault: ${result.fault.message.slice(0, 80)}...`);
    lines.push(`Location: ${result.fault.location.file}:${result.fault.location.startLine}`);
    lines.push(`Candidates: ${result.candidatesGenerated} generated, ${result.candidatesTested} tested`);
    lines.push(`Iterations: ${result.iterations}`);
    lines.push(`Duration: ${(result.duration / 1000).toFixed(2)}s`);

    if (result.appliedPatch) {
      lines.push("");
      lines.push("─".repeat(40));
      lines.push("Applied Fix:");
      lines.push("─".repeat(40));
      lines.push(`Strategy: ${result.appliedPatch.strategy}`);
      lines.push(`Explanation: ${result.appliedPatch.explanation}`);
      lines.push("");
      lines.push("Changes:");
      for (const change of result.appliedPatch.changes) {
        lines.push(`  ${change.file}:${change.startLine}-${change.endLine}`);
        lines.push("  - " + change.originalCode.split("\n").join("\n  - "));
        lines.push("  + " + change.newCode.split("\n").join("\n  + "));
      }
    } else if (result.reason) {
      lines.push("");
      lines.push(`Reason: ${result.reason}`);
    }

    lines.push("");
    lines.push("═".repeat(60));

    return lines.join("\n");
  }

  /**
   * Get configuration
   */
  getConfig(): RepairConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RepairConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Create a repair engine instance
 */
export function createRepairEngine(
  config?: Partial<RepairConfig>,
  apiKey?: string,
  baseURL?: string
): RepairEngine {
  return new RepairEngine(config, apiKey, baseURL);
}

// Singleton instance
let repairEngineInstance: RepairEngine | null = null;

export function getRepairEngine(
  apiKey?: string,
  baseURL?: string
): RepairEngine {
  if (!repairEngineInstance) {
    repairEngineInstance = createRepairEngine({}, apiKey, baseURL);
  }
  return repairEngineInstance;
}

export function resetRepairEngine(): void {
  repairEngineInstance = null;
}
