/**
 * Reviewer Agent
 *
 * Specialized agent for code review and quality assurance.
 * Responsible for:
 * - Reviewing code changes for quality
 * - Identifying bugs and potential issues
 * - Suggesting improvements
 * - Ensuring code follows best practices
 * - Security vulnerability detection
 */

import { BaseAgent, createId } from "../base-agent.js";
import {
  AgentConfig,
  AgentTask,
  AgentFeedback,
  CodeLocation,
  SharedContext,
  AgentExecutionResult,
  ToolExecutor,
} from "../types.js";
import { CodeBuddyTool } from "../../../codebuddy/client.js";

const REVIEWER_CONFIG: AgentConfig = {
  role: "reviewer",
  name: "Reviewer",
  description: "Expert code reviewer focused on quality, security, and best practices.",
  systemPrompt: `You are the Reviewer, an expert code reviewer with deep knowledge of software engineering best practices, security vulnerabilities, and code quality.

YOUR RESPONSIBILITIES:
1. **Code Quality Review**: Assess code for readability, maintainability, and efficiency
2. **Bug Detection**: Identify potential bugs, edge cases, and logic errors
3. **Security Review**: Detect security vulnerabilities (OWASP Top 10)
4. **Performance Review**: Identify performance bottlenecks
5. **Best Practices**: Ensure code follows established patterns
6. **Constructive Feedback**: Provide actionable suggestions for improvement

REVIEW CHECKLIST:

**Functionality**
- [ ] Does the code do what it's supposed to do?
- [ ] Are edge cases handled?
- [ ] Is error handling appropriate?

**Code Quality**
- [ ] Is the code readable and self-documenting?
- [ ] Are variable/function names meaningful?
- [ ] Is the code DRY (no duplication)?
- [ ] Is the complexity manageable?

**Security**
- [ ] No hardcoded credentials or secrets
- [ ] Input validation is present
- [ ] No SQL injection vulnerabilities
- [ ] No XSS vulnerabilities
- [ ] No command injection
- [ ] Proper authentication/authorization

**Performance**
- [ ] No obvious performance issues
- [ ] Appropriate data structures used
- [ ] No unnecessary computations
- [ ] Memory management is correct

**Testing**
- [ ] Are there tests for the new code?
- [ ] Do existing tests still pass?
- [ ] Is test coverage adequate?

FEEDBACK FORMAT:
<feedback type="issue" severity="critical">
Line 42: SQL injection vulnerability - user input is concatenated directly into query
Suggestion: Use parameterized queries instead
</feedback>

<feedback type="suggestion" severity="minor">
Line 87: Consider extracting this logic into a separate function for reusability
</feedback>

<feedback type="approval" severity="info">
The implementation looks good overall. The error handling is comprehensive.
</feedback>

SEVERITY LEVELS:
- **critical**: Must be fixed before merge (security issues, bugs that will cause crashes)
- **major**: Should be fixed (significant bugs, performance issues)
- **minor**: Nice to fix (code style, minor improvements)
- **info**: General comments, praise, or suggestions

Always be constructive and respectful. Explain WHY something is an issue, not just WHAT is wrong.`,
  capabilities: [
    "code_review",
    "search",
  ],
  allowedTools: [
    "view_file",
    "search",
    "bash", // For running linters
  ],
  model: "grok-3-latest",
  maxRounds: 25,
  temperature: 0.5,
};

export interface ReviewResult {
  approved: boolean;
  feedbackItems: AgentFeedback[];
  criticalIssues: number;
  majorIssues: number;
  minorIssues: number;
  summary: string;
}

export class ReviewerAgent extends BaseAgent {
  constructor(apiKey: string, baseURL?: string) {
    super(REVIEWER_CONFIG, apiKey, baseURL);
  }

  getSpecializedPrompt(): string {
    return REVIEWER_CONFIG.systemPrompt;
  }

  /**
   * Review code changes
   */
  async reviewCode(
    files: string[],
    context: SharedContext,
    tools: CodeBuddyTool[],
    executeTool: ToolExecutor
  ): Promise<ReviewResult> {
    const task: AgentTask = {
      id: createId("task"),
      title: "Review Code",
      description: `Review the following files for quality, security, and best practices:

FILES TO REVIEW:
${files.map(f => `- ${f}`).join("\n")}

REVIEW FOCUS:
1. Read each file carefully
2. Check for bugs and logic errors
3. Look for security vulnerabilities
4. Assess code quality and readability
5. Check for performance issues
6. Provide specific, actionable feedback

Use the feedback format specified in your instructions.`,
      status: "in_progress",
      priority: "high",
      assignedTo: "reviewer",
      dependencies: [],
      subtasks: [],
      artifacts: [],
      metadata: { files },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await this.execute(task, context, tools, executeTool);
    return this.parseReviewResult(result, task.id);
  }

  /**
   * Review a diff/patch
   */
  async reviewDiff(
    diff: string,
    context: SharedContext,
    tools: CodeBuddyTool[],
    executeTool: ToolExecutor
  ): Promise<ReviewResult> {
    const task: AgentTask = {
      id: createId("task"),
      title: "Review Diff",
      description: `Review the following code changes:

\`\`\`diff
${diff}
\`\`\`

REVIEW FOCUS:
1. Understand the intent of the changes
2. Check if changes introduce bugs
3. Look for security issues in new code
4. Verify the changes are complete
5. Check for unintended side effects`,
      status: "in_progress",
      priority: "high",
      assignedTo: "reviewer",
      dependencies: [],
      subtasks: [],
      artifacts: [],
      metadata: { type: "diff_review" },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await this.execute(task, context, tools, executeTool);
    return this.parseReviewResult(result, task.id);
  }

  /**
   * Security-focused review
   */
  async securityReview(
    files: string[],
    context: SharedContext,
    tools: CodeBuddyTool[],
    executeTool: ToolExecutor
  ): Promise<ReviewResult> {
    const task: AgentTask = {
      id: createId("task"),
      title: "Security Review",
      description: `Perform a security-focused review of the following files:

FILES TO REVIEW:
${files.map(f => `- ${f}`).join("\n")}

SECURITY CHECKLIST (OWASP Top 10):
1. **Injection** - SQL, NoSQL, OS, LDAP injection
2. **Broken Authentication** - Session management, credential storage
3. **Sensitive Data Exposure** - Encryption, data protection
4. **XML External Entities (XXE)** - XML parsing vulnerabilities
5. **Broken Access Control** - Authorization checks
6. **Security Misconfiguration** - Secure defaults, error handling
7. **XSS** - Cross-site scripting
8. **Insecure Deserialization** - Untrusted data deserialization
9. **Known Vulnerabilities** - Outdated dependencies
10. **Insufficient Logging** - Audit trail, monitoring

Also check for:
- Hardcoded secrets/credentials
- Command injection
- Path traversal
- Race conditions
- Information disclosure`,
      status: "in_progress",
      priority: "critical",
      assignedTo: "reviewer",
      dependencies: [],
      subtasks: [],
      artifacts: [],
      metadata: { type: "security_review" },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await this.execute(task, context, tools, executeTool);
    return this.parseReviewResult(result, task.id);
  }

  /**
   * Parse review result from agent output
   */
  private parseReviewResult(
    result: AgentExecutionResult,
    taskId: string
  ): ReviewResult {
    const feedbackItems: AgentFeedback[] = [];
    let criticalIssues = 0;
    let majorIssues = 0;
    let minorIssues = 0;

    // Parse feedback blocks
    const feedbackRegex = /<feedback\s+type="([^"]+)"\s+severity="([^"]+)">([\s\S]*?)<\/feedback>/g;
    let match;

    while ((match = feedbackRegex.exec(result.output)) !== null) {
      const [, type, severity, message] = match;

      const feedback: AgentFeedback = {
        id: createId("feedback"),
        from: "reviewer",
        to: "coder",
        taskId,
        type: type as AgentFeedback["type"],
        severity: severity as AgentFeedback["severity"],
        message: message.trim(),
        suggestions: [],
        codeLocations: this.extractCodeLocations(message),
      };

      feedbackItems.push(feedback);

      // Count issues
      if (severity === "critical") criticalIssues++;
      else if (severity === "major") majorIssues++;
      else if (severity === "minor") minorIssues++;
    }

    // Determine if approved (no critical issues)
    const approved = criticalIssues === 0 && majorIssues === 0;

    // Generate summary
    let summary = "";
    if (approved) {
      summary = `✅ Code approved with ${minorIssues} minor suggestions.`;
    } else {
      summary = `❌ Code needs revision: ${criticalIssues} critical, ${majorIssues} major, ${minorIssues} minor issues.`;
    }

    return {
      approved,
      feedbackItems,
      criticalIssues,
      majorIssues,
      minorIssues,
      summary,
    };
  }

  /**
   * Extract code locations from feedback message
   */
  private extractCodeLocations(message: string): CodeLocation[] {
    const locations: CodeLocation[] = [];

    // Pattern: "Line 42" or "Lines 42-45" or "file.ts:42"
    const linePattern = /(?:Line\s*|:)(\d+)(?:\s*-\s*(\d+))?/gi;
    const filePattern = /([^\s]+\.[a-z]+):(\d+)/gi;

    let match;

    // Extract "file:line" patterns
    while ((match = filePattern.exec(message)) !== null) {
      const [, file, line] = match;
      locations.push({
        file,
        startLine: parseInt(line, 10),
        endLine: parseInt(line, 10),
      });
    }

    // Extract "Line N" patterns (without file, will need context)
    while ((match = linePattern.exec(message)) !== null) {
      const [, startLine, endLine] = match;
      locations.push({
        file: "", // Will be filled in by context
        startLine: parseInt(startLine, 10),
        endLine: endLine ? parseInt(endLine, 10) : parseInt(startLine, 10),
      });
    }

    return locations;
  }

  /**
   * Format review result for display
   */
  formatReview(review: ReviewResult): string {
    let output = `\n${"═".repeat(60)}\n`;
    output += `📝 CODE REVIEW RESULT\n`;
    output += `${"═".repeat(60)}\n\n`;

    output += `${review.summary}\n\n`;

    if (review.feedbackItems.length > 0) {
      output += `📋 FEEDBACK ITEMS:\n`;
      output += `${"─".repeat(40)}\n\n`;

      // Group by severity
      const critical = review.feedbackItems.filter(f => f.severity === "critical");
      const major = review.feedbackItems.filter(f => f.severity === "major");
      const minor = review.feedbackItems.filter(f => f.severity === "minor");
      const info = review.feedbackItems.filter(f => f.severity === "info");

      if (critical.length > 0) {
        output += `🔴 CRITICAL (${critical.length}):\n`;
        critical.forEach(f => {
          output += `   • ${f.message}\n`;
        });
        output += "\n";
      }

      if (major.length > 0) {
        output += `🟠 MAJOR (${major.length}):\n`;
        major.forEach(f => {
          output += `   • ${f.message}\n`;
        });
        output += "\n";
      }

      if (minor.length > 0) {
        output += `🟡 MINOR (${minor.length}):\n`;
        minor.forEach(f => {
          output += `   • ${f.message}\n`;
        });
        output += "\n";
      }

      if (info.length > 0) {
        output += `🔵 INFO (${info.length}):\n`;
        info.forEach(f => {
          output += `   • ${f.message}\n`;
        });
        output += "\n";
      }
    }

    output += `${"═".repeat(60)}\n`;
    return output;
  }
}

export function createReviewerAgent(
  apiKey: string,
  baseURL?: string
): ReviewerAgent {
  return new ReviewerAgent(apiKey, baseURL);
}
