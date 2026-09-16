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
import {
  ThreadTaskRunner,
  type ThreadTaskOutcome,
} from '../delegation/thread-task-runner.js';
import type {
  ThreadDelegationEvent,
  ThreadParentBudget,
} from '../delegation/thread-delegation.js';
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
  /** Maximum simultaneously active quality delegates (hard-capped at 2). */
  delegateConcurrency: number;
  /** Parent allowance from which each quality delegate gets a reduced budget. */
  delegateParentBudget: ThreadParentBudget;
}

export interface QualityGateRuntime {
  /** Optional observer for the tagged multiplexed delegate stream. */
  onDelegateEvent?: (event: ThreadDelegationEvent<GateResult>) => void;
}

const MAX_QUALITY_GATE_CONCURRENCY = 2;
const DEFAULT_QUALITY_GATE_PARENT_BUDGET: ThreadParentBudget = {
  maxTurns: 4,
  maxCostUsd: 1,
  maxContextTokens: 32_000,
};

export const DEFAULT_QUALITY_GATE_CONFIG: QualityGateConfig = {
  enabled: true,
  gates: [
    {
      id: 'code-guardian',
      agentId: 'code-guardian',
      action: 'find-issues',
      required: false,
    },
    {
      id: 'security-review',
      agentId: 'security-review',
      action: 'quick-scan',
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
  delegateConcurrency: MAX_QUALITY_GATE_CONCURRENCY,
  delegateParentBudget: DEFAULT_QUALITY_GATE_PARENT_BUDGET,
};

// ── Gate Result ────────────────────────────────────────────────────

export type QualityFindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** One normalised finding — the agents' STRUCTURED output, not re-parsed prose. */
export interface QualityFinding {
  severity: QualityFindingSeverity;
  message: string;
  file?: string;
  line?: number;
  recommendation?: string;
}

export interface GateResult {
  gateId: string;
  passed: boolean;
  findings: QualityFinding[];
  /** True when the findings came from the agent's structured data (vs text re-parse). */
  structured: boolean;
  /** Set when the delegate could not complete a trustworthy review. */
  incomplete?: boolean;
}

interface DelegatedGateTask {
  gate: QualityGate;
  changedFiles: string[];
}

const SEVERITY_ORDER: Record<QualityFindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/** Map heterogeneous agent severities (CodeIssue 'error'/'warning', SecurityFinding levels) onto one scale. */
function normalizeSeverity(raw: unknown): QualityFindingSeverity {
  const v = String(raw ?? '').toLowerCase();
  if (v === 'critical') return 'critical';
  if (v === 'high' || v === 'error') return 'high';
  if (v === 'medium' || v === 'warning' || v === 'major') return 'medium';
  if (v === 'low' || v === 'minor') return 'low';
  return 'info';
}

/**
 * Extract STRUCTURED findings from an agent result's `data` — CodeGuardian
 * returns `issues: CodeIssue[]` (severity/file/line/message/suggestion),
 * SecurityReview returns `findings: SecurityFinding[]` (severity/title/
 * description/file/line/recommendation). Returns null when no structured
 * shape is recognisable, so the caller can fall back to text parsing —
 * the structure used to be discarded entirely and re-parsed from prose
 * with regexes.
 */
export function extractStructuredFindings(data: unknown): QualityFinding[] | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const list = (Array.isArray(d.findings) && d.findings) || (Array.isArray(d.issues) && d.issues) || (Array.isArray(data) && data) || null;
  if (!list) return null;

  const findings: QualityFinding[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Record<string, unknown>;
    const message =
      [f.title, f.description].filter((x) => typeof x === 'string' && x).join(' — ') ||
      (typeof f.message === 'string' ? f.message : '');
    if (!message) continue;
    findings.push({
      severity: normalizeSeverity(f.severity),
      message,
      ...(typeof f.file === 'string' && f.file ? { file: f.file } : {}),
      ...(Number.isFinite(f.line) ? { line: Math.floor(f.line as number) } : {}),
      ...(typeof f.recommendation === 'string' && f.recommendation
        ? { recommendation: f.recommendation }
        : typeof f.suggestion === 'string' && f.suggestion
          ? { recommendation: f.suggestion }
          : {}),
    });
  }
  return findings.length > 0 ? findings : null;
}

// ── Middleware ──────────────────────────────────────────────────────

export class QualityGateMiddleware implements ConversationMiddleware {
  readonly name = 'quality-gate';
  readonly priority = 200;

  private config: QualityGateConfig;
  private readonly runtime: QualityGateRuntime;
  private gateRunCount = 0;
  private lastGateRound = -1;

  constructor(
    config: Partial<QualityGateConfig> = {},
    runtime: QualityGateRuntime = {},
  ) {
    this.config = {
      ...DEFAULT_QUALITY_GATE_CONFIG,
      ...config,
      delegateParentBudget: {
        ...DEFAULT_QUALITY_GATE_PARENT_BUDGET,
        ...config.delegateParentBudget,
      },
    };
    this.runtime = runtime;
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
    const incomplete = results.filter(r => r.incomplete);

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

    if (incomplete.length > 0) {
      logger.warn(`Quality gates: ${incomplete.length} incomplete review(s)`);
      return {
        action: 'warn',
        message: `[Quality Gate — INCOMPLETE REVIEW]\n${message}`,
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
      if (entry === undefined) continue;
      if (entry.type === 'assistant') {
        const content = typeof entry.content === 'string' ? entry.content : '';
        // Implementation is "complete" when the latest assistant turn made NO
        // tool calls (it's wrapping up with prose). Detect calls from the
        // STRUCTURED entry.toolCalls field — not by scanning the content text
        // for the literal "tool_call" (tool calls live in a separate field, so
        // the text scan almost never matched and the gate could fire
        // prematurely, mid-implementation, right after a tool round). The text
        // fallback is kept for entries that serialize calls into content.
        const madeToolCalls =
          (entry.toolCalls?.length ?? 0) > 0 ||
          content.includes('tool_call') ||
          content.includes('function_call');
        return !madeToolCalls && content.length > 50;
      }
    }

    return false;
  }

  // ── File extraction ─────────────────────────────────────────────

  private extractChangedFiles(context: MiddlewareContext): string[] {
    // Prefer the authoritative edit set derived from editor tool CALLS
    // (populated by buildMiddlewareContext). Editors emit unified DIFFS in their
    // results, so the legacy verb/`file:` scrape below never matched them and the
    // gate reviewed an empty set — the whole point of V3.
    if (context.changedFiles && context.changedFiles.length > 0) {
      return context.changedFiles;
    }

    const files = new Set<string>();

    // Legacy fallback: scan history for file write/edit tool RESULT text.
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
          const captured = match[1];
          if (captured !== undefined) {
            files.add(captured);
          }
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
    const configuredConcurrency = Number.isFinite(this.config.delegateConcurrency)
      ? Math.max(1, Math.floor(this.config.delegateConcurrency))
      : MAX_QUALITY_GATE_CONCURRENCY;
    const runner = new ThreadTaskRunner<DelegatedGateTask, GateResult>({
      parentBudget: this.config.delegateParentBudget,
      concurrency: Math.min(
        MAX_QUALITY_GATE_CONCURRENCY,
        configuredConcurrency,
        gates.length,
      ),
      createAgent: () => ({
        execute: ({ gate, changedFiles: files }) => this.runSingleGate(gate, files),
        abortCurrentOperation() {},
        dispose() {},
      }),
    });
    const eventPump = (async () => {
      for await (const event of runner.events()) {
        try {
          this.runtime.onDelegateEvent?.(event);
        } catch {
          // Observability is best effort; always drain the shared stream.
        }
      }
    })();

    try {
      const outcomes = await Promise.all(
        gates.map((gate) => runner.submit(gate.agentId, { gate, changedFiles })),
      );
      return outcomes.map((outcome, index) => {
        const gate = gates[index];
        if (!gate) return this.incompleteGate('unknown', 'delegate result had no matching gate');
        return this.gateResultFromOutcome(gate, outcome);
      });
    } finally {
      await runner.close();
      await eventPump;
    }
  }

  private gateResultFromOutcome(
    gate: QualityGate,
    outcome: ThreadTaskOutcome<GateResult>,
  ): GateResult {
    if (outcome.success && outcome.output) return outcome.output;
    const detail = outcome.message ?? outcome.reason ?? 'delegate returned no result';
    logger.warn(`Quality gate ${gate.id} review incomplete`, { error: detail });
    return this.incompleteGate(gate.id, detail);
  }

  private incompleteGate(gateId: string, detail: string): GateResult {
    return {
      gateId,
      passed: false,
      findings: [{ severity: 'high', message: `Incomplete review: ${detail}` }],
      structured: false,
      incomplete: true,
    };
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
        return this.incompleteGate(
          gate.id,
          agentResult.error ?? 'specialized agent returned an unsuccessful result',
        );
      }

      // Structured findings FIRST — the agents return typed issues/findings
      // that this middleware used to throw away and re-parse from prose.
      const structured = extractStructuredFindings(agentResult.data);
      if (structured) {
        // A gate fails on actionable severities only: an 'info' note must
        // not fail a required gate.
        const blocking = structured.some(
          (f) => f.severity === 'critical' || f.severity === 'high',
        );
        return { gateId: gate.id, passed: !blocking, findings: structured, structured: true };
      }

      // Text fallback (legacy agents without structured data).
      const findings = this.parseFindings(agentResult.output || '').map((message) => ({
        severity: 'info' as const,
        message,
      }));
      return {
        gateId: gate.id,
        passed: findings.length === 0,
        findings,
        structured: false,
      };
    } catch (error) {
      return this.incompleteGate(
        gate.id,
        error instanceof Error ? error.message : String(error),
      );
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

      // Severity-ranked, deduped, file:line-anchored — actionable for the
      // agent instead of raw re-parsed prose lines.
      const seen = new Set<string>();
      const ordered = result.findings
        .slice()
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
        .filter((f) => {
          const key = `${f.file ?? ''}:${f.line ?? ''}:${f.message}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

      for (const finding of ordered.slice(0, 10)) {
        const anchor = finding.file ? ` ${finding.file}${finding.line ? ':' + finding.line : ''}` : '';
        const fix = finding.recommendation ? ` (fix: ${finding.recommendation})` : '';
        lines.push(`  [${finding.severity}]${anchor} — ${finding.message}${fix}`);
      }

      if (ordered.length > 10) {
        lines.push(`  ... and ${ordered.length - 10} more`);
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

  /** ConversationMiddleware per-task reset hook. */
  reset(): void {
    this.resetGateCount();
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
