/**
 * TDD (Test-Driven Development) Mode
 *
 * Implements test-first code generation workflow.
 * Research shows TDD improves Pass@1 by 45.97% (ICSE 2024).
 *
 * Workflow:
 * 1. User describes feature requirements
 * 2. LLM generates comprehensive tests
 * 3. User reviews/approves tests
 * 4. LLM implements code to pass tests
 * 5. Tests are run automatically
 * 6. LLM iterates until all tests pass
 */

import { EventEmitter } from "events";
import { getAutoTestManager, TestResult } from "./auto-test.js";

/**
 * TDD state
 */
export type TDDState =
  | "idle"
  | "requirements"
  | "generating-tests"
  | "reviewing-tests"
  | "implementing"
  | "running-tests"
  | "iterating"
  | "complete";

/**
 * TDD cycle result
 */
export interface TDDCycleResult {
  success: boolean;
  iterations: number;
  testsGenerated: number;
  testsPassed: number;
  testsFailed: number;
  filesCreated: string[];
  filesModified: string[];
  duration: number;
  errors?: string[];
}

/**
 * TDD configuration
 */
export interface TDDConfig {
  maxIterations: number;
  autoApproveTests: boolean;
  generateEdgeCases: boolean;
  generateMocks: boolean;
  testCoverage: "minimal" | "standard" | "comprehensive";
  language: string;
}

/**
 * Default TDD configuration
 */
export const DEFAULT_TDD_CONFIG: TDDConfig = {
  maxIterations: 5,
  autoApproveTests: false,
  generateEdgeCases: true,
  generateMocks: true,
  testCoverage: "standard",
  language: "typescript",
};

/**
 * Test generation template
 */
export interface TestTemplate {
  language: string;
  framework: string;
  template: string;
  edgeCasesTemplate: string;
  mocksTemplate: string;
}

/**
 * Built-in test templates
 */
export const TEST_TEMPLATES: Record<string, TestTemplate> = {
  typescript: {
    language: "typescript",
    framework: "jest",
    template: `
describe('{feature}', () => {
  describe('{function}', () => {
    it('should {behavior}', () => {
      // Arrange
      {arrange}

      // Act
      {act}

      // Assert
      {assert}
    });
  });
});`,
    edgeCasesTemplate: `
    it('should handle empty input', () => {
      // Test edge case
    });

    it('should handle null/undefined', () => {
      // Test null safety
    });

    it('should handle boundary values', () => {
      // Test boundaries
    });`,
    mocksTemplate: `
vi.mock('{module}', () => ({
  {mockImplementation}
}));`,
  },
  python: {
    language: "python",
    framework: "pytest",
    template: `
import pytest
from {module} import {function}

class Test{Feature}:
    def test_{behavior}(self):
        # Arrange
        {arrange}

        # Act
        {act}

        # Assert
        {assert}`,
    edgeCasesTemplate: `
    def test_empty_input(self):
        # Test edge case
        pass

    def test_none_input(self):
        # Test None handling
        pass

    def test_boundary_values(self):
        # Test boundaries
        pass`,
    mocksTemplate: `
from unittest.mock import Mock, patch

@patch('{module}.{function}')
def test_with_mock(mock_{function}):
    mock_{function}.return_value = {mock_value}`,
  },
  go: {
    language: "go",
    framework: "testing",
    template: `
package {package}

import (
    "testing"
)

func Test{Function}_{Behavior}(t *testing.T) {
    // Arrange
    {arrange}

    // Act
    {act}

    // Assert
    {assert}
}`,
    edgeCasesTemplate: `
func Test{Function}_EmptyInput(t *testing.T) {
    // Test edge case
}

func Test{Function}_NilInput(t *testing.T) {
    // Test nil handling
}`,
    mocksTemplate: `
type mock{Interface} struct {
    {mockFields}
}

func (m *mock{Interface}) {method}() {returnType} {
    return m.{field}
}`,
  },
  rust: {
    language: "rust",
    framework: "cargo test",
    template: `
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_{function}_{behavior}() {
        // Arrange
        {arrange}

        // Act
        {act}

        // Assert
        {assert}
    }
}`,
    edgeCasesTemplate: `
    #[test]
    fn test_{function}_empty() {
        // Test edge case
    }

    #[test]
    #[should_panic]
    fn test_{function}_invalid_input() {
        // Test error handling
    }`,
    mocksTemplate: `
use mockall::predicate::*;
use mockall::mock;

mock! {
    pub {Trait} {}
    impl {Trait} for {Trait} {
        {mock_methods}
    }
}`,
  },
};

/**
 * TDD Mode Manager
 *
 * Manages the TDD workflow for test-first development.
 */
export class TDDModeManager extends EventEmitter {
  private config: TDDConfig;
  private state: TDDState = "idle";
  private workingDirectory: string;
  private currentCycle: {
    requirements: string;
    testsGenerated: string[];
    testFiles: string[];
    sourceFiles: string[];
    iterations: number;
    startTime: number;
    errors: string[];
  } | null = null;

  constructor(workingDirectory: string, config: Partial<TDDConfig> = {}) {
    super();
    this.workingDirectory = workingDirectory;
    this.config = { ...DEFAULT_TDD_CONFIG, ...config };
  }

  /**
   * Get current state
   */
  getState(): TDDState {
    return this.state;
  }

  /**
   * Set state
   */
  private setState(state: TDDState): void {
    const previousState = this.state;
    this.state = state;
    this.emit("state:changed", { from: previousState, to: state });
  }

  /**
   * Start TDD cycle with requirements
   */
  startCycle(requirements: string): void {
    if (this.state !== "idle") {
      throw new Error(`Cannot start TDD cycle in state: ${this.state}`);
    }

    this.currentCycle = {
      requirements,
      testsGenerated: [],
      testFiles: [],
      sourceFiles: [],
      iterations: 0,
      startTime: Date.now(),
      errors: [],
    };

    this.setState("requirements");
    this.emit("cycle:started", { requirements });
  }

  /**
   * Generate test prompt for LLM
   */
  generateTestPrompt(): string {
    if (!this.currentCycle) {
      throw new Error("No active TDD cycle");
    }

    const template = TEST_TEMPLATES[this.config.language] || TEST_TEMPLATES.typescript;
    const coverageLevel = this.config.testCoverage;

    let prompt = `You are in TDD mode. Generate comprehensive tests FIRST, before any implementation.

## Requirements
${this.currentCycle.requirements}

## Test Generation Guidelines
1. Generate tests that fully describe the expected behavior
2. Use the ${template.framework} testing framework
3. Follow the Arrange-Act-Assert pattern
4. Include descriptive test names that explain what is being tested

## Coverage Level: ${coverageLevel}
`;

    if (coverageLevel === "comprehensive" || this.config.generateEdgeCases) {
      prompt += `
## Edge Cases to Cover
- Empty/null inputs
- Boundary values
- Error conditions
- Concurrent access (if applicable)
- Performance edge cases
`;
    }

    if (this.config.generateMocks) {
      prompt += `
## Mocking
- Mock external dependencies
- Mock I/O operations
- Use dependency injection patterns
`;
    }

    prompt += `
## Output Format
Generate ONLY the test file content. Do not implement the actual code yet.
The tests should fail initially (red phase).

Test file template:
${template.template}
`;

    return prompt;
  }

  /**
   * Record generated tests
   */
  recordGeneratedTests(tests: string[], testFiles: string[]): void {
    if (!this.currentCycle) {
      throw new Error("No active TDD cycle");
    }

    this.currentCycle.testsGenerated = tests;
    this.currentCycle.testFiles = testFiles;
    this.setState("reviewing-tests");
    this.emit("tests:generated", { tests, files: testFiles });
  }

  /**
   * Approve tests and move to implementation
   */
  approveTests(): void {
    if (this.state !== "reviewing-tests") {
      throw new Error(`Cannot approve tests in state: ${this.state}`);
    }

    this.setState("implementing");
    this.emit("tests:approved");
  }

  /**
   * Generate implementation prompt for LLM
   */
  generateImplementationPrompt(failedTests?: TestResult): string {
    if (!this.currentCycle) {
      throw new Error("No active TDD cycle");
    }

    let prompt = `You are in TDD mode (implementation phase).

## Requirements
${this.currentCycle.requirements}

## Tests to Pass
The following tests have been written and must pass:

${this.currentCycle.testsGenerated.join("\n\n")}

## Guidelines
1. Implement the MINIMUM code necessary to make the tests pass
2. Follow the principle: "Make it work, make it right, make it fast"
3. Do not add functionality not covered by tests
4. Keep the implementation simple and focused
`;

    if (failedTests && failedTests.failed > 0) {
      prompt += `
## Current Test Failures (Iteration ${this.currentCycle.iterations + 1}/${this.config.maxIterations})
The following tests are failing:

`;
      for (const test of failedTests.tests.filter(t => t.status === "failed")) {
        prompt += `❌ ${test.name}\n`;
        if (test.error) {
          prompt += `   Error: ${test.error.split("\n")[0]}\n`;
        }
      }

      prompt += `
Please fix the implementation to make these tests pass.
`;
    }

    return prompt;
  }

  /**
   * Record implementation
   */
  recordImplementation(sourceFiles: string[]): void {
    if (!this.currentCycle) {
      throw new Error("No active TDD cycle");
    }

    this.currentCycle.sourceFiles = sourceFiles;
    this.setState("running-tests");
    this.emit("implementation:recorded", { files: sourceFiles });
  }

  /**
   * Process test results
   */
  async processTestResults(results: TestResult): Promise<{ continue: boolean; complete: boolean }> {
    if (!this.currentCycle) {
      throw new Error("No active TDD cycle");
    }

    this.currentCycle.iterations++;

    if (results.success && results.failed === 0) {
      // All tests pass - cycle complete
      this.setState("complete");
      this.emit("cycle:complete", this.getCycleResult());
      return { continue: false, complete: true };
    }

    if (this.currentCycle.iterations >= this.config.maxIterations) {
      // Max iterations reached
      this.currentCycle.errors.push(`Max iterations (${this.config.maxIterations}) reached`);
      this.setState("complete");
      this.emit("cycle:complete", this.getCycleResult());
      return { continue: false, complete: true };
    }

    // Continue iterating
    this.setState("iterating");
    this.emit("iteration:failed", {
      iteration: this.currentCycle.iterations,
      failed: results.failed,
      passed: results.passed,
    });
    return { continue: true, complete: false };
  }

  /**
   * Get cycle result
   */
  getCycleResult(): TDDCycleResult | null {
    if (!this.currentCycle) {
      return null;
    }

    const testManager = getAutoTestManager(this.workingDirectory);
    const lastResults = testManager.getLastResults();

    return {
      success: lastResults?.failed === 0 && lastResults?.passed > 0,
      iterations: this.currentCycle.iterations,
      testsGenerated: this.currentCycle.testsGenerated.length,
      testsPassed: lastResults?.passed || 0,
      testsFailed: lastResults?.failed || 0,
      filesCreated: [...this.currentCycle.testFiles, ...this.currentCycle.sourceFiles],
      filesModified: [],
      duration: Date.now() - this.currentCycle.startTime,
      errors: this.currentCycle.errors.length > 0 ? this.currentCycle.errors : undefined,
    };
  }

  /**
   * Cancel current cycle
   */
  cancelCycle(): void {
    if (this.state === "idle") {
      return;
    }

    this.emit("cycle:cancelled", this.getCycleResult());
    this.currentCycle = null;
    this.setState("idle");
  }

  /**
   * Reset to idle
   */
  reset(): void {
    this.currentCycle = null;
    this.setState("idle");
  }

  /**
   * Format status for display
   */
  formatStatus(): string {
    const lines: string[] = ["🔄 TDD Mode"];

    if (this.state === "idle") {
      lines.push("  Status: Idle (not active)");
      lines.push("  Use /tdd <requirements> to start");
      return lines.join("\n");
    }

    const stateEmoji: Record<TDDState, string> = {
      idle: "⚪",
      requirements: "📝",
      "generating-tests": "🧪",
      "reviewing-tests": "👀",
      implementing: "💻",
      "running-tests": "▶️",
      iterating: "🔁",
      complete: "✅",
    };

    lines.push(`  Status: ${stateEmoji[this.state]} ${this.state}`);

    if (this.currentCycle) {
      lines.push(`  Iterations: ${this.currentCycle.iterations}/${this.config.maxIterations}`);
      lines.push(`  Tests: ${this.currentCycle.testsGenerated.length} generated`);
      lines.push(`  Duration: ${((Date.now() - this.currentCycle.startTime) / 1000).toFixed(1)}s`);
    }

    return lines.join("\n");
  }

  /**
   * Get configuration
   */
  getConfig(): TDDConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TDDConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if TDD mode is active
   */
  isActive(): boolean {
    return this.state !== "idle" && this.state !== "complete";
  }
}

// Singleton instance
let tddManager: TDDModeManager | null = null;

/**
 * Get or create TDD manager instance
 */
export function getTDDManager(
  workingDirectory?: string,
  config?: Partial<TDDConfig>
): TDDModeManager {
  if (!tddManager || workingDirectory) {
    tddManager = new TDDModeManager(
      workingDirectory || process.cwd(),
      config
    );
  }
  return tddManager;
}

/**
 * Initialize TDD manager
 */
export function initializeTDD(
  workingDirectory: string,
  config?: Partial<TDDConfig>
): TDDModeManager {
  tddManager = new TDDModeManager(workingDirectory, config);
  return tddManager;
}
