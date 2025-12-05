/**
 * Iterative Repair Engine
 *
 * Implements conversation-driven repair with test feedback loop.
 * Based on research from:
 * - ChatRepair (ISSTA 2024): Conversational program repair
 * - RepairAgent: Autonomous LLM-based repair
 * - RePair: Reinforcement learning for debugging
 *
 * Key features:
 * 1. Iterative fix attempts with instant feedback
 * 2. Learning from both successes and failures
 * 3. Progressive error understanding
 * 4. Multi-strategy repair attempts
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface RepairContext {
  file: string;
  errorMessage: string;
  errorType: 'compile' | 'runtime' | 'test' | 'lint' | 'type';
  errorLine?: number;
  errorColumn?: number;
  codeSnippet?: string;
  testCommand?: string;
  previousAttempts: RepairAttempt[];
}

export interface RepairAttempt {
  id: string;
  strategy: RepairStrategy;
  patch: string;
  originalCode: string;
  newCode: string;
  success: boolean;
  feedback: RepairFeedback;
  timestamp: number;
}

export interface RepairFeedback {
  compiled: boolean;
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  newErrors: string[];
  fixedErrors: string[];
  regressions: string[];
  executionTime: number;
}

export type RepairStrategy =
  | 'null_check'
  | 'type_coercion'
  | 'boundary_check'
  | 'exception_handling'
  | 'import_fix'
  | 'syntax_fix'
  | 'logic_fix'
  | 'api_update'
  | 'refactor';

export interface RepairConfig {
  maxAttempts: number;
  testTimeout: number;
  enableRollback: boolean;
  strategies: RepairStrategy[];
  learnFromHistory: boolean;
}

export interface RepairResult {
  success: boolean;
  finalPatch?: string;
  attempts: RepairAttempt[];
  totalTime: number;
  strategyUsed?: RepairStrategy;
  lessonsLearned: string[];
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: RepairConfig = {
  maxAttempts: 5,
  testTimeout: 30000,
  enableRollback: true,
  strategies: [
    'null_check',
    'type_coercion',
    'boundary_check',
    'exception_handling',
    'import_fix',
    'syntax_fix',
    'logic_fix',
  ],
  learnFromHistory: true,
};

// ============================================================================
// Strategy Templates
// ============================================================================

const STRATEGY_TEMPLATES: Record<RepairStrategy, {
  patterns: RegExp[];
  fixes: ((match: RegExpMatchArray, context: RepairContext) => string)[];
  description: string;
}> = {
  null_check: {
    patterns: [
      /Cannot read propert(?:y|ies) ['"]?(\w+)['"]? of (undefined|null)/i,
      /(\w+) is (undefined|null)/i,
      /TypeError:.*(?:undefined|null)/i,
    ],
    fixes: [
      (match, _ctx) => {
        const varName = match[1] || 'value';
        return `if (${varName} != null) {\n  // original code\n}`;
      },
      (match, _ctx) => {
        const varName = match[1] || 'value';
        return `${varName}?.`;
      },
    ],
    description: 'Add null/undefined checks',
  },

  type_coercion: {
    patterns: [
      /Type '(\w+)' is not assignable to type '(\w+)'/i,
      /Argument of type '(.+)' is not assignable/i,
      /cannot convert (\w+) to (\w+)/i,
    ],
    fixes: [
      (match) => `as ${match[2]}`,
      (match) => `String(${match[1]})`,
      (match) => `Number(${match[1]})`,
    ],
    description: 'Fix type conversion issues',
  },

  boundary_check: {
    patterns: [
      /Index out of (bounds|range)/i,
      /Array index .* out of bounds/i,
      /RangeError/i,
    ],
    fixes: [
      () => 'Math.min(index, array.length - 1)',
      () => 'if (index >= 0 && index < array.length)',
    ],
    description: 'Add boundary checks for arrays',
  },

  exception_handling: {
    patterns: [
      /Unhandled (?:promise )?rejection/i,
      /Error:.*not caught/i,
      /uncaught exception/i,
    ],
    fixes: [
      () => 'try {\n  // original code\n} catch (error) {\n  console.error(error);\n}',
      () => '.catch((error) => { console.error(error); })',
    ],
    description: 'Add error handling',
  },

  import_fix: {
    patterns: [
      /Cannot find module ['"](.+)['"]/i,
      /Module not found/i,
      /is not exported from/i,
      /has no exported member/i,
    ],
    fixes: [
      (match) => `import { ${match[1]} } from './${match[1]}';`,
      () => '// Check import path and module exports',
    ],
    description: 'Fix import/export issues',
  },

  syntax_fix: {
    patterns: [
      /SyntaxError/i,
      /Unexpected token/i,
      /Missing (?:semicolon|bracket|parenthesis)/i,
      /Unterminated string/i,
    ],
    fixes: [
      () => ';',
      () => '}',
      () => ')',
    ],
    description: 'Fix syntax errors',
  },

  logic_fix: {
    patterns: [
      /Expected .* but got/i,
      /assertion failed/i,
      /test failed/i,
    ],
    fixes: [
      () => '// Review logic and fix comparison',
      () => '=== instead of ==',
    ],
    description: 'Fix logic errors',
  },

  api_update: {
    patterns: [
      /deprecated/i,
      /is not a function/i,
      /method .* does not exist/i,
    ],
    fixes: [
      () => '// Check API documentation for updated method',
    ],
    description: 'Update deprecated API calls',
  },

  refactor: {
    patterns: [/.*/], // Catch-all
    fixes: [
      () => '// Consider refactoring this section',
    ],
    description: 'General refactoring',
  },
};

// ============================================================================
// Iterative Repair Engine
// ============================================================================

export class IterativeRepairEngine extends EventEmitter {
  private config: RepairConfig;
  private history: Map<string, RepairAttempt[]> = new Map();
  private successfulPatterns: Map<string, RepairStrategy> = new Map();

  constructor(config: Partial<RepairConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Attempt iterative repair with feedback loop
   */
  async repair(context: RepairContext): Promise<RepairResult> {
    const startTime = Date.now();
    const attempts: RepairAttempt[] = [];
    const lessonsLearned: string[] = [];

    this.emit('repair:start', { file: context.file, error: context.errorMessage });

    // Analyze error to determine best strategies
    const strategies = this.analyzeAndPrioritizeStrategies(context);

    for (let i = 0; i < this.config.maxAttempts && i < strategies.length; i++) {
      const strategy = strategies[i];

      this.emit('attempt:start', { attempt: i + 1, strategy });

      // Generate patch using strategy
      const patch = this.generatePatch(context, strategy, attempts);

      if (!patch) {
        continue;
      }

      // Apply patch and test
      const attempt = await this.applyAndTest(context, patch, strategy);
      attempts.push(attempt);

      this.emit('attempt:complete', { attempt: i + 1, success: attempt.success, feedback: attempt.feedback });

      if (attempt.success) {
        // Learn from success
        if (this.config.learnFromHistory) {
          this.learnFromSuccess(context, attempt);
        }

        lessonsLearned.push(`Strategy '${strategy}' fixed: ${context.errorMessage.substring(0, 100)}`);

        return {
          success: true,
          finalPatch: attempt.patch,
          attempts,
          totalTime: Date.now() - startTime,
          strategyUsed: strategy,
          lessonsLearned,
        };
      } else {
        // Learn from failure
        lessonsLearned.push(this.learnFromFailure(context, attempt));

        // Update context with new errors for next attempt
        if (attempt.feedback.newErrors.length > 0) {
          context.errorMessage = attempt.feedback.newErrors[0];
          context.previousAttempts = attempts;
        }
      }
    }

    // Rollback if enabled and all attempts failed
    if (this.config.enableRollback && attempts.length > 0) {
      await this.rollback(context, attempts[0].originalCode);
    }

    this.emit('repair:complete', { success: false, attempts: attempts.length });

    return {
      success: false,
      attempts,
      totalTime: Date.now() - startTime,
      lessonsLearned,
    };
  }

  /**
   * Analyze error and prioritize repair strategies
   */
  private analyzeAndPrioritizeStrategies(context: RepairContext): RepairStrategy[] {
    const scores: Map<RepairStrategy, number> = new Map();

    // Check for known successful patterns
    const errorHash = this.hashError(context.errorMessage);
    const knownFix = this.successfulPatterns.get(errorHash);
    if (knownFix) {
      return [knownFix, ...this.config.strategies.filter(s => s !== knownFix)];
    }

    // Score each strategy based on pattern matching
    for (const strategy of this.config.strategies) {
      const template = STRATEGY_TEMPLATES[strategy];
      let score = 0;

      for (const pattern of template.patterns) {
        if (pattern.test(context.errorMessage)) {
          score += 10;
        }
        if (context.codeSnippet && pattern.test(context.codeSnippet)) {
          score += 5;
        }
      }

      // Boost based on error type
      if (context.errorType === 'type' && strategy === 'type_coercion') score += 5;
      if (context.errorType === 'runtime' && strategy === 'null_check') score += 5;
      if (context.errorType === 'compile' && strategy === 'syntax_fix') score += 5;

      scores.set(strategy, score);
    }

    // Sort by score descending
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .filter(([_, score]) => score > 0)
      .map(([strategy]) => strategy);
  }

  /**
   * Generate a patch based on strategy
   */
  private generatePatch(
    context: RepairContext,
    strategy: RepairStrategy,
    previousAttempts: RepairAttempt[]
  ): string | null {
    const template = STRATEGY_TEMPLATES[strategy];

    // Find matching pattern
    for (const pattern of template.patterns) {
      const match = context.errorMessage.match(pattern);
      if (match) {
        // Try each fix until one works
        for (const fixFn of template.fixes) {
          const fix = fixFn(match, context);

          // Check if this fix was already tried
          const alreadyTried = previousAttempts.some(a =>
            a.patch === fix || a.newCode.includes(fix)
          );

          if (!alreadyTried) {
            return fix;
          }
        }
      }
    }

    return null;
  }

  /**
   * Apply patch and run tests to get feedback
   */
  private async applyAndTest(
    context: RepairContext,
    patch: string,
    strategy: RepairStrategy
  ): Promise<RepairAttempt> {
    const id = `repair-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    // Read original code
    let originalCode = '';
    try {
      originalCode = fs.readFileSync(context.file, 'utf-8');
    } catch {
      originalCode = context.codeSnippet || '';
    }

    // Apply patch (simplified - in real implementation, would use AST)
    const newCode = this.applyPatchToCode(originalCode, patch, context);

    // Write patched code
    try {
      fs.writeFileSync(context.file, newCode, 'utf-8');
    } catch (error) {
      return {
        id,
        strategy,
        patch,
        originalCode,
        newCode,
        success: false,
        feedback: {
          compiled: false,
          testsRun: 0,
          testsPassed: 0,
          testsFailed: 0,
          newErrors: [`Failed to write file: ${error}`],
          fixedErrors: [],
          regressions: [],
          executionTime: Date.now() - startTime,
        },
        timestamp: Date.now(),
      };
    }

    // Run tests
    const feedback = await this.runTests(context);

    // Restore original if tests failed
    if (!feedback.compiled || feedback.testsFailed > 0) {
      fs.writeFileSync(context.file, originalCode, 'utf-8');
    }

    const success = feedback.compiled &&
      feedback.testsFailed === 0 &&
      feedback.newErrors.length === 0;

    return {
      id,
      strategy,
      patch,
      originalCode,
      newCode,
      success,
      feedback: {
        ...feedback,
        executionTime: Date.now() - startTime,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Apply patch to code (simplified implementation)
   */
  private applyPatchToCode(code: string, patch: string, context: RepairContext): string {
    // If we have a specific error line, try to patch around it
    if (context.errorLine) {
      const lines = code.split('\n');
      const targetLine = context.errorLine - 1;

      if (targetLine >= 0 && targetLine < lines.length) {
        // Simple insertion/modification
        if (patch.includes('// original code')) {
          // Wrap in try-catch or if-check
          const indent = lines[targetLine].match(/^\s*/)?.[0] || '';
          lines[targetLine] = patch.replace('// original code', lines[targetLine].trim())
            .split('\n')
            .map(l => indent + l)
            .join('\n');
        } else if (patch.includes('?.')) {
          // Optional chaining
          lines[targetLine] = lines[targetLine].replace(/\.(\w+)/g, '?.$1');
        } else {
          // Append fix
          lines[targetLine] = lines[targetLine] + ' ' + patch;
        }

        return lines.join('\n');
      }
    }

    // Fallback: append patch as comment
    return code + '\n// Suggested fix: ' + patch;
  }

  /**
   * Run tests and collect feedback
   */
  private async runTests(context: RepairContext): Promise<Omit<RepairFeedback, 'executionTime'>> {
    const testCommand = context.testCommand || 'npm test';

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          compiled: false,
          testsRun: 0,
          testsPassed: 0,
          testsFailed: 0,
          newErrors: ['Test timeout'],
          fixedErrors: [],
          regressions: [],
        });
      }, this.config.testTimeout);

      const [cmd, ...args] = testCommand.split(' ');
      const proc = spawn(cmd, args, {
        cwd: path.dirname(context.file),
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timeout);

        // Parse test output
        const testsRun = (stdout.match(/(\d+)\s*tests?/i) || [])[1] || 0;
        const testsPassed = (stdout.match(/(\d+)\s*pass/i) || [])[1] || 0;
        const testsFailed = (stdout.match(/(\d+)\s*fail/i) || [])[1] || 0;

        // Extract errors
        const newErrors = this.extractErrors(stderr + stdout);
        const compiled = code === 0 || !newErrors.some(e => /compile|syntax/i.test(e));

        // Check if original error is fixed
        const fixedErrors = !newErrors.some(e =>
          e.toLowerCase().includes(context.errorMessage.toLowerCase().substring(0, 50))
        ) ? [context.errorMessage] : [];

        resolve({
          compiled,
          testsRun: Number(testsRun),
          testsPassed: Number(testsPassed),
          testsFailed: Number(testsFailed),
          newErrors,
          fixedErrors,
          regressions: [],
        });
      });
    });
  }

  /**
   * Extract error messages from output
   */
  private extractErrors(output: string): string[] {
    const errors: string[] = [];
    const patterns = [
      /Error:\s*(.+)/gi,
      /TypeError:\s*(.+)/gi,
      /SyntaxError:\s*(.+)/gi,
      /ReferenceError:\s*(.+)/gi,
      /failed:\s*(.+)/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        errors.push(match[1].trim());
      }
    }

    return [...new Set(errors)].slice(0, 10);
  }

  /**
   * Rollback to original code
   */
  private async rollback(context: RepairContext, originalCode: string): Promise<void> {
    try {
      fs.writeFileSync(context.file, originalCode, 'utf-8');
      this.emit('rollback', { file: context.file });
    } catch (error) {
      this.emit('rollback:error', { file: context.file, error });
    }
  }

  /**
   * Learn from successful repair
   */
  private learnFromSuccess(context: RepairContext, attempt: RepairAttempt): void {
    const errorHash = this.hashError(context.errorMessage);
    this.successfulPatterns.set(errorHash, attempt.strategy);

    // Store in history
    const key = `${context.file}:${context.errorType}`;
    if (!this.history.has(key)) {
      this.history.set(key, []);
    }
    this.history.get(key)!.push(attempt);
  }

  /**
   * Learn from failed repair attempt
   */
  private learnFromFailure(context: RepairContext, attempt: RepairAttempt): string {
    const lesson = `Strategy '${attempt.strategy}' failed: ${
      attempt.feedback.newErrors.length > 0
        ? 'introduced new errors'
        : 'did not fix original error'
    }`;

    return lesson;
  }

  /**
   * Hash error message for pattern matching
   */
  private hashError(errorMessage: string): string {
    // Normalize error message (remove line numbers, file paths)
    const normalized = errorMessage
      .replace(/:\d+:\d+/g, '')
      .replace(/['"][\w/\\.-]+['"]/g, '')
      .toLowerCase()
      .trim();

    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
    }
    return hash.toString(16);
  }

  /**
   * Get repair history
   */
  getHistory(): Map<string, RepairAttempt[]> {
    return new Map(this.history);
  }

  /**
   * Get learned patterns
   */
  getLearnedPatterns(): Map<string, RepairStrategy> {
    return new Map(this.successfulPatterns);
  }

  /**
   * Clear learned patterns
   */
  clearLearning(): void {
    this.successfulPatterns.clear();
    this.history.clear();
  }

  /**
   * ChatRepair-style conversational repair with full context
   *
   * Implements the key insight from ChatRepair (ISSTA 2024):
   * - Include failing test code in context
   * - Include full error message and stack trace
   * - Maintain conversation history for multi-turn repair
   * - Validate plausibility of patches before testing
   *
   * @param context Repair context with error information
   * @param generatePatch Function to generate patch using LLM
   * @returns RepairResult with conversation history
   */
  async chatRepair(
    context: RepairContext & {
      testCode?: string;
      stackTrace?: string;
      buggyMethod?: string;
    },
    generatePatch: (prompt: string, history: ConversationTurn[]) => Promise<string>
  ): Promise<RepairResult & { conversation: ConversationTurn[] }> {
    const startTime = Date.now();
    const attempts: RepairAttempt[] = [];
    const conversation: ConversationTurn[] = [];
    const lessonsLearned: string[] = [];

    this.emit('chatRepair:start', { file: context.file });

    // Build initial prompt with full context (ChatRepair key insight)
    const initialPrompt = this.buildChatRepairPrompt(context);
    conversation.push({ role: 'system', content: initialPrompt });

    for (let i = 0; i < this.config.maxAttempts; i++) {
      // Generate user message for this turn
      const userMessage = i === 0
        ? 'Please fix this bug.'
        : this.buildFollowUpPrompt(attempts[attempts.length - 1]);

      conversation.push({ role: 'user', content: userMessage });

      // Get LLM-generated patch
      const patchResponse = await generatePatch(userMessage, conversation);
      conversation.push({ role: 'assistant', content: patchResponse });

      // Extract patch from response
      const patch = this.extractPatchFromResponse(patchResponse);

      if (!patch) {
        lessonsLearned.push('Could not extract valid patch from response');
        continue;
      }

      // Validate plausibility (ChatRepair validation step)
      const validationResult = this.validatePatchPlausibility(patch, context);
      if (!validationResult.valid) {
        lessonsLearned.push(`Patch rejected: ${validationResult.reason}`);

        // Add validation feedback to conversation
        conversation.push({
          role: 'user',
          content: `The patch was rejected: ${validationResult.reason}. Please try again.`,
        });
        continue;
      }

      // Apply and test the patch
      const attempt = await this.applyAndTest(context, patch, 'logic_fix');
      attempts.push(attempt);

      this.emit('chatRepair:attempt', {
        attempt: i + 1,
        success: attempt.success,
        feedback: attempt.feedback,
      });

      if (attempt.success) {
        lessonsLearned.push('ChatRepair successfully fixed the bug');

        return {
          success: true,
          finalPatch: patch,
          attempts,
          totalTime: Date.now() - startTime,
          strategyUsed: 'logic_fix',
          lessonsLearned,
          conversation,
        };
      }

      // Add test feedback to conversation (key ChatRepair insight)
      conversation.push({
        role: 'user',
        content: this.buildTestFeedbackMessage(attempt),
      });
    }

    // Rollback if all attempts failed
    if (this.config.enableRollback && attempts.length > 0) {
      await this.rollback(context, attempts[0].originalCode);
    }

    return {
      success: false,
      attempts,
      totalTime: Date.now() - startTime,
      lessonsLearned,
      conversation,
    };
  }

  /**
   * Build ChatRepair-style prompt with full context
   */
  private buildChatRepairPrompt(context: RepairContext & {
    testCode?: string;
    stackTrace?: string;
    buggyMethod?: string;
  }): string {
    let prompt = `You are a debugging assistant. Fix the following bug.

## Bug Location
File: ${context.file}
${context.errorLine ? `Line: ${context.errorLine}` : ''}

## Error Message
${context.errorMessage}
`;

    if (context.stackTrace) {
      prompt += `
## Stack Trace
${context.stackTrace}
`;
    }

    if (context.buggyMethod || context.codeSnippet) {
      prompt += `
## Buggy Code
\`\`\`
${context.buggyMethod || context.codeSnippet}
\`\`\`
`;
    }

    if (context.testCode) {
      prompt += `
## Failing Test
\`\`\`
${context.testCode}
\`\`\`
`;
    }

    prompt += `
## Instructions
1. Analyze the error and identify the root cause
2. Generate a minimal fix that addresses the bug
3. Return ONLY the corrected code block, no explanations
4. Preserve the original code structure as much as possible
`;

    return prompt;
  }

  /**
   * Build follow-up prompt after failed attempt
   */
  private buildFollowUpPrompt(lastAttempt: RepairAttempt): string {
    const { feedback } = lastAttempt;

    let prompt = 'The previous fix did not work.';

    if (feedback.newErrors.length > 0) {
      prompt += `\n\nNew errors:\n${feedback.newErrors.join('\n')}`;
    }

    if (feedback.testsFailed > 0) {
      prompt += `\n\nTests: ${feedback.testsPassed}/${feedback.testsRun} passed, ${feedback.testsFailed} failed`;
    }

    prompt += '\n\nPlease try a different approach.';

    return prompt;
  }

  /**
   * Build test feedback message for conversation
   */
  private buildTestFeedbackMessage(attempt: RepairAttempt): string {
    const { feedback } = attempt;

    let message = '## Test Results\n';

    if (!feedback.compiled) {
      message += 'Compilation failed.\n';
    } else {
      message += `Compiled successfully.\n`;
      message += `Tests: ${feedback.testsPassed}/${feedback.testsRun} passed\n`;
    }

    if (feedback.newErrors.length > 0) {
      message += `\nErrors:\n${feedback.newErrors.map(e => `- ${e}`).join('\n')}\n`;
    }

    if (feedback.regressions.length > 0) {
      message += `\nRegressions:\n${feedback.regressions.map(r => `- ${r}`).join('\n')}\n`;
    }

    message += '\nPlease analyze these results and try a different fix.';

    return message;
  }

  /**
   * Extract patch from LLM response
   */
  private extractPatchFromResponse(response: string): string | null {
    // Try to extract code block
    const codeBlockMatch = response.match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Try to find code patterns
    const codePatterns = [
      /(?:function|class|const|let|var|import|export|if|for|while|return)\s+[\s\S]+/,
    ];

    for (const pattern of codePatterns) {
      const match = response.match(pattern);
      if (match) {
        return match[0].trim();
      }
    }

    return null;
  }

  /**
   * Validate patch plausibility before testing
   * (ChatRepair validation to reduce wasted test runs)
   */
  private validatePatchPlausibility(
    patch: string,
    context: RepairContext
  ): { valid: boolean; reason?: string } {
    // Check for empty patch
    if (!patch || patch.trim().length === 0) {
      return { valid: false, reason: 'Empty patch' };
    }

    // Check for syntax errors (basic check)
    const syntaxPatterns = [
      { pattern: /\{\s*$/, message: 'Unclosed brace' },
      { pattern: /\(\s*$/, message: 'Unclosed parenthesis' },
      { pattern: /\[\s*$/, message: 'Unclosed bracket' },
    ];

    for (const { pattern, message } of syntaxPatterns) {
      if (pattern.test(patch)) {
        return { valid: false, reason: message };
      }
    }

    // Check for identical to original (no change)
    if (context.codeSnippet && patch.trim() === context.codeSnippet.trim()) {
      return { valid: false, reason: 'Patch identical to original code' };
    }

    // Check for nonsensical patches
    if (patch.includes('TODO') || patch.includes('FIXME') || patch.includes('...')) {
      return { valid: false, reason: 'Patch contains placeholders' };
    }

    return { valid: true };
  }
}

/**
 * Conversation turn for ChatRepair
 */
export interface ConversationTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ============================================================================
// Singleton
// ============================================================================

let repairEngineInstance: IterativeRepairEngine | null = null;

export function getIterativeRepairEngine(config?: Partial<RepairConfig>): IterativeRepairEngine {
  if (!repairEngineInstance) {
    repairEngineInstance = new IterativeRepairEngine(config);
  }
  return repairEngineInstance;
}

export function resetIterativeRepairEngine(): void {
  repairEngineInstance = null;
}
