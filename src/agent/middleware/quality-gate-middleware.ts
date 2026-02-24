/**
 * Quality Gate Middleware
 *
 * Auto-delegates to specialized agents (CodeGuardian, Security) after
 * the implementation phase completes. Injects findings into the
 * conversation context for the next iteration.
 *
 * Priority 200 — runs after auto-repair, at the end of the pipeline.
 */

import type {
  ConversationMiddleware,
  MiddlewareContext,
  MiddlewareResult,
} from './types.js';
import { logger } from '../../utils/logger.js';

// ── Configuration ──────────────────────────────────────────────────

export interface QualityGate {
  /** Unique gate identifier */
  id: string;
  /** Agent ID in the AgentRegistry */
  agentId: string;
  /** Action to pass to the agent */
  action: string;
  /** Whether failure blocks the loop (default: false) */
  required: boolean;
  /** File patterns that trigger this gate (empty = always) */
  filePatterns?: RegExp[];
}

export interface QualityGateConfig {
  /** Enable/disable quality gates (default: true) */
  enabled: boolean;
  /** Gates to run after implementation */
  gates: QualityGate[];
  /** Minimum tool rounds before gates activate (default: 3) */
  minRoundsBeforeGate: number;
  /** Maximum gate runs per session (default: 2) */
  maxGateRuns: number;
}

export const DEFAULT_QUALITY_GATE_CONFIG: QualityGateConfig = {
  enabled: true,
  gates: [
    {
      id: 'code-guardian',
      agentId: 'code-guardian',
      action: 'review',
      required: false,
    },
    {
      id: 'security-review',
      agentId: 'security-review',
      action: 'scan',
      required: false,
      filePatterns: [
        /auth/i,
        /security/i,
        /password/i,
        /token/i,
        /secret/i,
        /\.env/,
        /credential/i,
      ],
    },
  ],
  minRoundsBeforeGate: 3,
  maxGateRuns: 2,
};

// ── Gate Result ────────────────────────────────────────────────────

interface GateResult {
  gateId: string;
  passed: boolean;
  findings: string[];
}

// ── Middleware ──────────────────────────────────────────────────────

export class QualityGateMiddleware implements ConversationMiddleware {
  readonly name = 'quality-gate';
  readonly priority = 200;

  private config: QualityGateConfig;
  private gateRunCount = 0;
  private lastGateRound = -1;

  constructor(config: Partial<QualityGateConfig> = {}) {
    this.config = { ...DEFAULT_QUALITY_GATE_CONFIG, ...config };
  }

  async afterTurn(context: MiddlewareContext): Promise<MiddlewareResult> {
    if (!this.config.enabled) {
      return { action: 'continue' };
    }

    // Don't activate too early
    if (context.toolRound < this.config.minRoundsBeforeGate) {
      return { action: 'continue' };
    }

    // Don't run gates more than maxGateRuns times
    if (this.gateRunCount >= this.config.maxGateRuns) {
      return { action: 'continue' };
    }

    // Avoid running on consecutive rounds
    if (context.toolRound <= this.lastGateRound + 1) {
      return { action: 'continue' };
    }

    // Detect implementation completion (last assistant message has no tool calls)
    if (!this.detectImplementationComplete(context)) {
      return { action: 'continue' };
    }

    // Determine which gates to run based on changed files
    const changedFiles = this.extractChangedFiles(context);
    const applicableGates = this.filterApplicableGates(changedFiles);

    if (applicableGates.length === 0) {
      return { action: 'continue' };
    }

    // Run gates
    this.gateRunCount++;
    this.lastGateRound = context.toolRound;

    const results = await this.runGates(applicableGates, changedFiles);
    const failedRequired = results.filter(r => !r.passed && this.isRequired(r.gateId));
    const allFindings = results.flatMap(r => r.findings);

    if (allFindings.length === 0) {
      logger.info('Quality gates passed — no findings');
      return { action: 'continue' };
    }

    const message = this.formatFindings(results);

    if (failedRequired.length > 0) {
      logger.warn(`Quality gates: ${failedRequired.length} required gate(s) failed`);
      return {
        action: 'warn',
        message: `[Quality Gate — REQUIRED FIXES]\n${message}\n\n` +
          `Please address the required findings above before continuing.`,
      };
    }

    logger.info(`Quality gates: ${allFindings.length} finding(s), none required`);
    return {
      action: 'warn',
      message: `[Quality Gate — Suggestions]\n${message}`,
    };
  }

  // ── Implementation detection ────────────────────────────────────

  private detectImplementationComplete(context: MiddlewareContext): boolean {
    // Look at last few history entries: if the last assistant message
    // doesn't contain tool calls, implementation is likely complete
    const recent = context.history.slice(-4);

    for (let i = recent.length - 1; i >= 0; i--) {
      const entry = recent[i];
      if (entry.type === 'assistant') {
        const content = typeof entry.content === 'string' ? entry.content : '';
        // If the assistant response contains code blocks or file changes,
        // it was likely doing implementation. No tool calls = wrapping up.
        const hasToolCalls = content.includes('tool_call') || content.includes('function_call');
        return !hasToolCalls && content.length > 50;
      }
    }

    return false;
  }

  // ── File extraction ─────────────────────────────────────────────

  private extractChangedFiles(context: MiddlewareContext): string[] {
    const files = new Set<string>();

    // Scan history for file write/edit tool results
    for (const entry of context.history) {
      if (entry.type !== 'tool_result') continue;
      const content = typeof entry.content === 'string' ? entry.content : '';

      // Match common file path patterns in tool outputs
      const filePatterns = [
        /(?:wrote|created|modified|edited|updated)\s+[`"]?([^\s`"]+\.\w+)/gi,
        /file:\s*[`"]?([^\s`"]+\.\w+)/gi,
      ];

      for (const pattern of filePatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          files.add(match[1]);
        }
      }
    }

    return Array.from(files);
  }

  // ── Gate filtering ──────────────────────────────────────────────

  private filterApplicableGates(changedFiles: string[]): QualityGate[] {
    return this.config.gates.filter(gate => {
      // No file patterns means always applicable
      if (!gate.filePatterns || gate.filePatterns.length === 0) {
        return true;
      }

      // Check if any changed file matches the gate's patterns
      return changedFiles.some(file =>
        gate.filePatterns!.some(pattern => pattern.test(file))
      );
    });
  }

  // ── Gate execution ──────────────────────────────────────────────

  private async runGates(
    gates: QualityGate[],
    changedFiles: string[],
  ): Promise<GateResult[]> {
    const results: GateResult[] = [];

    for (const gate of gates) {
      try {
        const result = await this.runSingleGate(gate, changedFiles);
        results.push(result);
      } catch (error) {
        logger.warn(`Quality gate ${gate.id} failed to execute`, {
          error: error instanceof Error ? error.message : String(error),
        });
        // Non-execution = pass (don't block on infrastructure errors)
        results.push({
          gateId: gate.id,
          passed: true,
          findings: [],
        });
      }
    }

    return results;
  }

  private async runSingleGate(
    gate: QualityGate,
    changedFiles: string[],
  ): Promise<GateResult> {
    try {
      const { AgentRegistry } = await import('../specialized/agent-registry.js');

      const registry = new AgentRegistry();
      await registry.registerBuiltInAgents();

      const agentResult = await registry.executeOn(gate.agentId, {
        action: gate.action,
        inputFiles: changedFiles,
        params: { scope: 'changed-files' },
      });

      if (!agentResult.success) {
        return {
          gateId: gate.id,
          passed: !gate.required,
          findings: agentResult.error ? [agentResult.error] : [],
        };
      }

      // Parse findings from agent output
      const findings = this.parseFindings(agentResult.output || '');

      return {
        gateId: gate.id,
        passed: findings.length === 0,
        findings,
      };
    } catch {
      // Module not available — pass silently
      return { gateId: gate.id, passed: true, findings: [] };
    }
  }

  // ── Parsing & formatting ────────────────────────────────────────

  private parseFindings(output: string): string[] {
    if (!output || output.trim().length === 0) {
      return [];
    }

    // Split on common finding delimiters
    const lines = output.split('\n').filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 0 &&
        (trimmed.startsWith('-') ||
         trimmed.startsWith('•') ||
         trimmed.startsWith('*') ||
         /^\d+\./.test(trimmed) ||
         /(?:warning|error|issue|finding|vulnerability)/i.test(trimmed));
    });

    return lines.length > 0 ? lines : [output.slice(0, 500)];
  }

  private formatFindings(results: GateResult[]): string {
    const lines: string[] = [];

    for (const result of results) {
      if (result.findings.length === 0) continue;

      const status = result.passed ? 'PASSED (with suggestions)' : 'FAILED';
      lines.push(`**${result.gateId}** — ${status}`);

      for (const finding of result.findings.slice(0, 10)) {
        lines.push(`  ${finding}`);
      }

      if (result.findings.length > 10) {
        lines.push(`  ... and ${result.findings.length - 10} more`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  private isRequired(gateId: string): boolean {
    return this.config.gates.find(g => g.id === gateId)?.required ?? false;
  }

  // ── Public API ─────────────────────────────────────────────────

  /** Reset gate run counter (e.g., on new task) */
  resetGateCount(): void {
    this.gateRunCount = 0;
    this.lastGateRound = -1;
  }

  /** Get current gate run count */
  getGateRunCount(): number {
    return this.gateRunCount;
  }

  /** Get configuration */
  getConfig(): QualityGateConfig {
    return { ...this.config };
  }
}

/**
 * Factory function for creating the quality gate middleware.
 */
export function createQualityGateMiddleware(
  config?: Partial<QualityGateConfig>,
): QualityGateMiddleware {
  return new QualityGateMiddleware(config);
}
