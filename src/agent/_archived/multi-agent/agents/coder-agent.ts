/**
 * Coder Agent
 *
 * Specialized agent for code generation and modification.
 * Responsible for:
 * - Writing new code based on specifications
 * - Modifying existing code
 * - Implementing features
 * - Fixing bugs (in collaboration with Debugger)
 * - Refactoring code
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

const CODER_CONFIG: AgentConfig = {
  role: "coder",
  name: "Coder",
  description: "Expert code generator and modifier. Writes high-quality, maintainable code following best practices.",
  systemPrompt: `You are the Coder, an expert software developer specializing in writing clean, efficient, and maintainable code.

YOUR RESPONSIBILITIES:
1. **Code Generation**: Write new code based on specifications
2. **Code Modification**: Edit existing code safely and correctly
3. **Best Practices**: Follow language-specific conventions and patterns
4. **Documentation**: Add appropriate comments and docstrings
5. **Error Handling**: Implement proper error handling
6. **Testing Consideration**: Write code that is testable

CODING PRINCIPLES:
1. **SOLID Principles**: Single responsibility, open/closed, Liskov substitution, interface segregation, dependency inversion
2. **DRY**: Don't repeat yourself
3. **KISS**: Keep it simple, stupid
4. **YAGNI**: You aren't gonna need it
5. **Clean Code**: Meaningful names, small functions, clear intent

BEFORE WRITING CODE:
1. Read existing code to understand the style and patterns
2. Understand the requirements fully
3. Consider edge cases
4. Plan the implementation

WHEN MODIFYING CODE:
1. Always view the file first before editing
2. Make minimal, targeted changes
3. Preserve existing functionality
4. Maintain consistent style

CODE QUALITY CHECKLIST:
- [ ] Code compiles/runs without errors
- [ ] Follows existing code style
- [ ] Has appropriate error handling
- [ ] Is properly typed (for TypeScript/typed languages)
- [ ] Has meaningful variable/function names
- [ ] Is documented where necessary
- [ ] Doesn't introduce security vulnerabilities

OUTPUT FORMAT:
For new files:
<artifact type="code" name="path/to/file.ts" language="typescript">
// Your code here
</artifact>

For modifications, use the str_replace_editor tool directly.`,
  capabilities: [
    "code_generation",
    "code_editing",
    "file_operations",
  ],
  allowedTools: [
    "view_file",
    "create_file",
    "str_replace_editor",
    "search",
    "bash",
    "multi_edit",
  ],
  model: "grok-3-latest",
  maxRounds: 40,
  temperature: 0.3, // Lower temperature for more consistent code
};

export class CoderAgent extends BaseAgent {
  private codeStyle: Map<string, string> = new Map();

  constructor(apiKey: string, baseURL?: string) {
    super(CODER_CONFIG, apiKey, baseURL);
  }

  getSpecializedPrompt(): string {
    return CODER_CONFIG.systemPrompt;
  }

  /**
   * Generate code for a specific task
   */
  async generateCode(
    task: AgentTask,
    context: SharedContext,
    tools: CodeBuddyTool[],
    executeTool: ToolExecutor
  ): Promise<AgentExecutionResult> {
    // Enhance task description with coding-specific instructions
    const enhancedTask: AgentTask = {
      ...task,
      description: `${task.description}

ADDITIONAL CODING INSTRUCTIONS:
1. Examine existing code patterns in the project
2. Follow the established coding style
3. Implement proper error handling
4. Add TypeScript types if applicable
5. Consider edge cases
6. Make the code testable`,
    };

    return this.execute(enhancedTask, context, tools, executeTool);
  }

  /**
   * Implement a feature based on specification
   */
  async implementFeature(
    specification: string,
    context: SharedContext,
    tools: CodeBuddyTool[],
    executeTool: ToolExecutor
  ): Promise<AgentExecutionResult> {
    const task: AgentTask = {
      id: createId("task"),
      title: "Implement Feature",
      description: `Implement the following feature:

${specification}

STEPS:
1. Understand the feature requirements
2. Identify files that need to be created or modified
3. Design the implementation approach
4. Write the code
5. Verify the implementation compiles/runs`,
      status: "in_progress",
      priority: "high",
      assignedTo: "coder",
      dependencies: [],
      subtasks: [],
      artifacts: [],
      metadata: { type: "feature_implementation" },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return this.execute(task, context, tools, executeTool);
  }

  /**
   * Fix a bug based on the debugger's analysis
   */
  async fixBug(
    bugAnalysis: string,
    suggestedFix: string,
    context: SharedContext,
    tools: CodeBuddyTool[],
    executeTool: ToolExecutor
  ): Promise<AgentExecutionResult> {
    const task: AgentTask = {
      id: createId("task"),
      title: "Fix Bug",
      description: `Fix the following bug:

BUG ANALYSIS:
${bugAnalysis}

SUGGESTED FIX:
${suggestedFix}

STEPS:
1. View the affected file(s)
2. Understand the root cause
3. Implement the fix
4. Ensure no regression is introduced
5. Verify the fix works`,
      status: "in_progress",
      priority: "high",
      assignedTo: "coder",
      dependencies: [],
      subtasks: [],
      artifacts: [],
      metadata: { type: "bug_fix" },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return this.execute(task, context, tools, executeTool);
  }

  /**
   * Refactor code based on reviewer feedback
   */
  async refactorCode(
    feedback: string,
    targetFiles: string[],
    context: SharedContext,
    tools: CodeBuddyTool[],
    executeTool: ToolExecutor
  ): Promise<AgentExecutionResult> {
    const task: AgentTask = {
      id: createId("task"),
      title: "Refactor Code",
      description: `Refactor the following code based on feedback:

FEEDBACK:
${feedback}

TARGET FILES:
${targetFiles.map(f => `- ${f}`).join("\n")}

REFACTORING PRINCIPLES:
1. Preserve existing functionality
2. Improve code quality
3. Follow DRY, SOLID, and KISS principles
4. Improve naming and clarity
5. Reduce complexity where possible`,
      status: "in_progress",
      priority: "medium",
      assignedTo: "coder",
      dependencies: [],
      subtasks: [],
      artifacts: [],
      metadata: { type: "refactoring" },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return this.execute(task, context, tools, executeTool);
  }

  /**
   * Add tests for existing code
   */
  async writeTests(
    targetCode: string,
    testFramework: string,
    context: SharedContext,
    tools: CodeBuddyTool[],
    executeTool: ToolExecutor
  ): Promise<AgentExecutionResult> {
    const task: AgentTask = {
      id: createId("task"),
      title: "Write Tests",
      description: `Write tests for the following code:

TARGET CODE:
${targetCode}

TEST FRAMEWORK: ${testFramework}

TEST REQUIREMENTS:
1. Cover all public functions/methods
2. Include positive and negative test cases
3. Test edge cases
4. Use descriptive test names
5. Follow testing best practices`,
      status: "in_progress",
      priority: "medium",
      assignedTo: "coder",
      dependencies: [],
      subtasks: [],
      artifacts: [],
      metadata: { type: "test_writing" },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return this.execute(task, context, tools, executeTool);
  }

  /**
   * Learn the coding style from existing code
   */
  async learnCodeStyle(
    filePath: string,
    _tools: CodeBuddyTool[],
    _executeTool: ToolExecutor
  ): Promise<void> {
    // This would analyze the file and extract style patterns
    // For now, just store the file path
    this.codeStyle.set(filePath, "learned");
  }

  /**
   * Get the learned code style
   */
  getCodeStyle(): Map<string, string> {
    return new Map(this.codeStyle);
  }
}

export function createCoderAgent(
  apiKey: string,
  baseURL?: string
): CoderAgent {
  return new CoderAgent(apiKey, baseURL);
}
