/**
 * Tester Agent
 *
 * Specialized agent for running tests and verifying code functionality.
 * Responsible for:
 * - Running test suites
 * - Analyzing test results
 * - Identifying test coverage gaps
 * - Suggesting new tests
 * - Verifying bug fixes
 */

import { BaseAgent, createId } from "../base-agent.js";
import {
  AgentConfig,
  AgentTask,
  SharedContext,
  AgentExecutionResult,
  ToolExecutor,
} from "../types.js";
import { CodeBuddyTool } from "../../../codebuddy/client.js";

const TESTER_CONFIG: AgentConfig = {
  role: "tester",
  name: "Tester",
  description: "Expert test runner and analyzer. Ensures code quality through comprehensive testing.",
  systemPrompt: `You are the Tester, an expert in software testing with deep knowledge of testing frameworks, methodologies, and best practices.

YOUR RESPONSIBILITIES:
1. **Run Tests**: Execute test suites and commands
2. **Analyze Results**: Parse and interpret test output
3. **Identify Failures**: Determine root causes of test failures
4. **Coverage Analysis**: Assess test coverage and gaps
5. **Test Quality**: Evaluate test effectiveness
6. **Suggest Tests**: Recommend additional tests needed

TESTING EXPERTISE:
- Unit testing (Jest, Vitest, Mocha, pytest)
- Integration testing
- End-to-end testing (Playwright, Cypress)
- Performance testing
- Snapshot testing
- Test-driven development (TDD)

PROCESS:
1. Identify the test framework used in the project
2. Run the appropriate test command
3. Parse and analyze the results
4. Report findings clearly
5. Suggest fixes for failing tests

OUTPUT FORMAT:
<test-report>
<summary>
Total: X tests
Passed: Y
Failed: Z
Skipped: W
Coverage: XX%
</summary>

<failures>
- test name: error message
  File: path/to/test.ts:42
  Reason: explanation
  Suggestion: how to fix
</failures>

<coverage-gaps>
- Untested function: functionName in file.ts
- Missing edge case: description
</coverage-gaps>

<recommendations>
1. Add test for...
2. Improve coverage of...
</recommendations>
</test-report>

COMMON TEST COMMANDS:
- npm test / npm run test
- bun test
- npx vitest
- npx jest
- python -m pytest

Always check for test configuration files (jest.config.js, vitest.config.ts, etc.) first.`,
  capabilities: [
    "testing",
    "search",
    "file_operations",
  ],
  allowedTools: [
    "view_file",
    "search",
    "bash",
  ],
  model: "grok-code-fast-1",
  maxRounds: 30,
  temperature: 0.3,
};

export interface TestResult {
  success: boolean;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  coverage?: number;
  failures: TestFailure[];
  coverageGaps: string[];
  recommendations: string[];
  duration: number;
  output: string;
}

export interface TestFailure {
  testName: string;
  file: string;
  line?: number;
  error: string;
  suggestion: string;
}

export class TesterAgent extends BaseAgent {
  private testFramework: string | null = null;
  private testCommand: string | null = null;

  constructor(apiKey: string, baseURL?: string) {
    super(TESTER_CONFIG, apiKey, baseURL);
  }

  getSpecializedPrompt(): string {
    return TESTER_CONFIG.systemPrompt;
  }

  /**
   * Run all tests in the project
   */
  async runTests(
    context: SharedContext,
    tools: CodeBuddyTool[],
    executeTool: ToolExecutor
  ): Promise<TestResult> {
    const task: AgentTask = {
      id: createId("task"),
      title: "Run Tests",
      description: `Run the test suite for this project.

STEPS:
1. Find the test configuration (package.json, jest.config.js, vitest.config.ts, etc.)
2. Determine the correct test command
3. Run the tests
4. Parse and analyze the results
5. Report findings in the specified format

Provide a comprehensive test report including:
- Summary of results
- Details of any failures
- Coverage information if available
- Recommendations for improvement`,
      status: "in_progress",
      priority: "high",
      assignedTo: "tester",
      dependencies: [],
      subtasks: [],
      artifacts: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await this.execute(task, context, tools, executeTool);
    return this.parseTestResult(result);
  }

  /**
   * Run specific test file(s)
   */
  async runSpecificTests(
    testFiles: string[],
    context: SharedContext,
    tools: CodeBuddyTool[],
    executeTool: ToolExecutor
  ): Promise<TestResult> {
    const task: AgentTask = {
      id: createId("task"),
      title: "Run Specific Tests",
      description: `Run the following test files:

${testFiles.map(f => `- ${f}`).join("\n")}

STEPS:
1. Determine the test framework
2. Run only the specified tests
3. Analyze results
4. Report findings`,
      status: "in_progress",
      priority: "high",
      assignedTo: "tester",
      dependencies: [],
      subtasks: [],
      artifacts: [],
      metadata: { testFiles },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await this.execute(task, context, tools, executeTool);
    return this.parseTestResult(result);
  }

  /**
   * Verify a bug fix by running related tests
   */
  async verifyBugFix(
    bugDescription: string,
    fixedFiles: string[],
    context: SharedContext,
    tools: CodeBuddyTool[],
    executeTool: ToolExecutor
  ): Promise<TestResult> {
    const task: AgentTask = {
      id: createId("task"),
      title: "Verify Bug Fix",
      description: `Verify that the bug fix works correctly.

BUG DESCRIPTION:
${bugDescription}

FIXED FILES:
${fixedFiles.map(f => `- ${f}`).join("\n")}

STEPS:
1. Find tests related to the fixed files
2. Run those tests
3. If no tests exist, suggest what tests should be added
4. Verify the fix doesn't break other functionality
5. Report findings`,
      status: "in_progress",
      priority: "high",
      assignedTo: "tester",
      dependencies: [],
      subtasks: [],
      artifacts: [],
      metadata: { bugDescription, fixedFiles },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await this.execute(task, context, tools, executeTool);
    return this.parseTestResult(result);
  }

  /**
   * Analyze test coverage
   */
  async analyzeCoverage(
    context: SharedContext,
    tools: CodeBuddyTool[],
    executeTool: ToolExecutor
  ): Promise<AgentExecutionResult> {
    const task: AgentTask = {
      id: createId("task"),
      title: "Analyze Test Coverage",
      description: `Analyze test coverage for this project.

STEPS:
1. Run tests with coverage enabled (--coverage flag)
2. Parse coverage report
3. Identify files/functions with low coverage
4. Suggest what additional tests are needed
5. Prioritize coverage gaps by importance`,
      status: "in_progress",
      priority: "medium",
      assignedTo: "tester",
      dependencies: [],
      subtasks: [],
      artifacts: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return this.execute(task, context, tools, executeTool);
  }

  /**
   * Parse test results from agent output
   */
  private parseTestResult(result: AgentExecutionResult): TestResult {
    const output = result.output;

    // Default values
    let total = 0, passed = 0, failed = 0, skipped = 0;
    let coverage: number | undefined;
    const failures: TestFailure[] = [];
    const coverageGaps: string[] = [];
    const recommendations: string[] = [];

    // Parse summary
    const summaryMatch = output.match(/<summary>([\s\S]*?)<\/summary>/);
    if (summaryMatch) {
      const summary = summaryMatch[1];
      const totalMatch = summary.match(/Total:\s*(\d+)/i);
      const passedMatch = summary.match(/Passed:\s*(\d+)/i);
      const failedMatch = summary.match(/Failed:\s*(\d+)/i);
      const skippedMatch = summary.match(/Skipped:\s*(\d+)/i);
      const coverageMatch = summary.match(/Coverage:\s*(\d+(?:\.\d+)?)/i);

      if (totalMatch) total = parseInt(totalMatch[1], 10);
      if (passedMatch) passed = parseInt(passedMatch[1], 10);
      if (failedMatch) failed = parseInt(failedMatch[1], 10);
      if (skippedMatch) skipped = parseInt(skippedMatch[1], 10);
      if (coverageMatch) coverage = parseFloat(coverageMatch[1]);
    }

    // Also try to parse from common test output formats
    const jestMatch = output.match(/Tests:\s*(\d+)\s*failed.*?(\d+)\s*passed.*?(\d+)\s*total/i);
    if (jestMatch) {
      failed = parseInt(jestMatch[1], 10);
      passed = parseInt(jestMatch[2], 10);
      total = parseInt(jestMatch[3], 10);
    }

    const vitestMatch = output.match(/(\d+)\s*passed.*?(\d+)\s*failed/i);
    if (vitestMatch) {
      passed = parseInt(vitestMatch[1], 10);
      failed = parseInt(vitestMatch[2], 10);
      total = passed + failed;
    }

    // Parse failures
    const failuresMatch = output.match(/<failures>([\s\S]*?)<\/failures>/);
    if (failuresMatch) {
      const failureLines = failuresMatch[1].split(/\n\s*-\s*/).filter(l => l.trim());
      for (const line of failureLines) {
        const parts = line.split(/\n\s+/);
        if (parts.length > 0) {
          failures.push({
            testName: parts[0].split(":")[0]?.trim() || "Unknown test",
            file: parts.find(p => p.startsWith("File:"))?.replace("File:", "").trim() || "",
            error: parts.find(p => p.startsWith("Reason:"))?.replace("Reason:", "").trim() || parts[0].split(":")[1]?.trim() || "",
            suggestion: parts.find(p => p.startsWith("Suggestion:"))?.replace("Suggestion:", "").trim() || "",
          });
        }
      }
    }

    // Parse coverage gaps
    const gapsMatch = output.match(/<coverage-gaps>([\s\S]*?)<\/coverage-gaps>/);
    if (gapsMatch) {
      const lines = gapsMatch[1].split(/\n\s*-\s*/).filter(l => l.trim());
      coverageGaps.push(...lines);
    }

    // Parse recommendations
    const recsMatch = output.match(/<recommendations>([\s\S]*?)<\/recommendations>/);
    if (recsMatch) {
      const lines = recsMatch[1].split(/\n\s*\d+\.\s*/).filter(l => l.trim());
      recommendations.push(...lines);
    }

    return {
      success: failed === 0 && result.success,
      total,
      passed,
      failed,
      skipped,
      coverage,
      failures,
      coverageGaps,
      recommendations,
      duration: result.duration,
      output: result.output,
    };
  }

  /**
   * Format test result for display
   */
  formatTestResult(result: TestResult): string {
    let output = `\n${"═".repeat(60)}\n`;
    output += `🧪 TEST RESULTS\n`;
    output += `${"═".repeat(60)}\n\n`;

    // Summary
    const statusEmoji = result.success ? "✅" : "❌";
    output += `${statusEmoji} Status: ${result.success ? "PASSED" : "FAILED"}\n\n`;

    output += `📊 Summary:\n`;
    output += `   Total:   ${result.total}\n`;
    output += `   Passed:  ${result.passed} ✅\n`;
    output += `   Failed:  ${result.failed} ${result.failed > 0 ? "❌" : ""}\n`;
    output += `   Skipped: ${result.skipped}\n`;
    if (result.coverage !== undefined) {
      output += `   Coverage: ${result.coverage.toFixed(1)}%\n`;
    }
    output += `   Duration: ${(result.duration / 1000).toFixed(2)}s\n\n`;

    // Failures
    if (result.failures.length > 0) {
      output += `❌ Failures:\n`;
      output += `${"─".repeat(40)}\n`;
      for (const failure of result.failures) {
        output += `\n   • ${failure.testName}\n`;
        if (failure.file) output += `     File: ${failure.file}\n`;
        output += `     Error: ${failure.error}\n`;
        if (failure.suggestion) output += `     Suggestion: ${failure.suggestion}\n`;
      }
      output += "\n";
    }

    // Coverage gaps
    if (result.coverageGaps.length > 0) {
      output += `📉 Coverage Gaps:\n`;
      output += `${"─".repeat(40)}\n`;
      for (const gap of result.coverageGaps) {
        output += `   • ${gap}\n`;
      }
      output += "\n";
    }

    // Recommendations
    if (result.recommendations.length > 0) {
      output += `💡 Recommendations:\n`;
      output += `${"─".repeat(40)}\n`;
      for (let i = 0; i < result.recommendations.length; i++) {
        output += `   ${i + 1}. ${result.recommendations[i]}\n`;
      }
      output += "\n";
    }

    output += `${"═".repeat(60)}\n`;
    return output;
  }

  /**
   * Detect test framework from project
   */
  async detectTestFramework(
    _tools: CodeBuddyTool[],
    _executeTool: ToolExecutor
  ): Promise<string | null> {
    // This would analyze package.json and config files
    // For now, return null to let the agent detect it
    return this.testFramework;
  }

  /**
   * Set the test command to use
   */
  setTestCommand(command: string): void {
    this.testCommand = command;
  }

  /**
   * Get the test command
   */
  getTestCommand(): string | null {
    return this.testCommand;
  }
}

export function createTesterAgent(
  apiKey: string,
  baseURL?: string
): TesterAgent {
  return new TesterAgent(apiKey, baseURL);
}
