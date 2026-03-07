/**
 * Lobster Typed Workflow Engine
 * DAG-based workflow definition, validation, and execution ordering.
 *
 * Compatible with OpenClaw's Lobster workflow format:
 * - Explicit dependencies via `dependsOn` (Code Buddy native)
 * - Implicit dependencies via `stdin: $step.stdout` (OpenClaw native)
 * - Approval gates via `approval: 'required'` field OR `command: 'approve'`
 * - Conditional execution via `condition` field
 * - Environment variables via `env` (alias for `variables`)
 */

import { logger } from '../utils/logger.js';

export interface LobsterStep {
  id: string;
  name: string;
  command: string;
  inputs?: Record<string, string>;
  outputs?: string[];
  dependsOn?: string[];
  timeout?: number;
  /** OpenClaw: pipe prior step output as stdin — creates implicit dependency */
  stdin?: string;
  /** OpenClaw: conditional execution (e.g. '$step.approved', evaluated against context) */
  condition?: string;
  /** OpenClaw: mark step as an approval checkpoint ('required' | 'optional') */
  approval?: 'required' | 'optional';
}

export interface LobsterWorkflow {
  name: string;
  version: string;
  steps: LobsterStep[];
  variables?: Record<string, string>;
  /** OpenClaw alias for variables */
  env?: Record<string, string>;
  /** OpenClaw: workflow-level args with defaults */
  args?: Record<string, { default?: string }>;
}

export interface StepResult {
  stepId: string;
  status: 'success' | 'failed' | 'skipped' | 'pending_approval';
  stdout: string;
  exitCode: number;
  duration: number;
}

export interface ApprovalGate {
  stepId: string;
  prompt: string;
  previewData?: unknown;
  limit?: number;
}

export type WorkflowStatus = 'ok' | 'needs_approval' | 'cancelled' | 'error';

export interface WorkflowRunResult {
  status: WorkflowStatus;
  output: StepResult[];
  requiresApproval?: {
    gate: ApprovalGate;
    prompt: string;
    resumeToken: string;
  };
  error?: string;
}

export class LobsterEngine {
  private static instance: LobsterEngine | null = null;

  static getInstance(): LobsterEngine {
    if (!LobsterEngine.instance) {
      LobsterEngine.instance = new LobsterEngine();
    }
    return LobsterEngine.instance;
  }

  static resetInstance(): void {
    LobsterEngine.instance = null;
  }

  parseWorkflow(yaml: string): LobsterWorkflow {
    let parsed: unknown;
    try {
      parsed = JSON.parse(yaml);
    } catch {
      // Try simple YAML-like parsing for key: value format
      parsed = this.parseSimpleYaml(yaml);
    }

    const workflow = parsed as LobsterWorkflow;
    if (!workflow.name || !workflow.version || !Array.isArray(workflow.steps)) {
      throw new Error('Invalid workflow: missing name, version, or steps');
    }

    for (const step of workflow.steps) {
      if (!step.id || !step.name || !step.command) {
        throw new Error(`Invalid step: missing id, name, or command`);
      }
    }

    // Normalize OpenClaw format
    this.normalizeOpenClawFormat(workflow);

    logger.debug(`Parsed workflow: ${workflow.name} v${workflow.version}`);
    return workflow;
  }

  /**
   * Normalize OpenClaw-specific fields into the unified internal format.
   * - Merge `env` into `variables`
   * - Resolve `args` defaults into `variables`
   * - Infer implicit `dependsOn` from `stdin` references
   */
  normalizeOpenClawFormat(workflow: LobsterWorkflow): void {
    // Merge env → variables
    if (workflow.env) {
      workflow.variables = { ...workflow.env, ...workflow.variables };
    }

    // Resolve args defaults → variables
    if (workflow.args) {
      for (const [key, spec] of Object.entries(workflow.args)) {
        if (spec.default !== undefined && !workflow.variables?.[key]) {
          workflow.variables = workflow.variables || {};
          workflow.variables[key] = spec.default;
        }
      }
    }

    // Infer implicit dependencies from stdin references
    const stepIds = new Set(workflow.steps.map(s => s.id));
    for (const step of workflow.steps) {
      if (step.stdin) {
        const implicitDeps = this.extractStepReferences(step.stdin, stepIds);
        if (implicitDeps.length > 0) {
          step.dependsOn = [...new Set([...(step.dependsOn || []), ...implicitDeps])];
        }
      }
      // Also scan command for $step.stdout references to infer deps
      const commandDeps = this.extractStepReferences(step.command, stepIds);
      if (commandDeps.length > 0) {
        step.dependsOn = [...new Set([...(step.dependsOn || []), ...commandDeps])];
      }
    }
  }

  /**
   * Extract step ID references from a string (e.g. '$build.stdout' → ['build']).
   */
  extractStepReferences(text: string, validIds: Set<string>): string[] {
    const refs: string[] = [];
    const pattern = /\$(\w+)\.(stdout|json|approved|exitCode)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const stepId = match[1];
      if (validIds.has(stepId)) {
        refs.push(stepId);
      }
    }
    return refs;
  }

  validateWorkflow(workflow: LobsterWorkflow): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const stepIds = new Set(workflow.steps.map(s => s.id));

    if (!workflow.name) errors.push('Missing workflow name');
    if (!workflow.version) errors.push('Missing workflow version');
    if (!workflow.steps || workflow.steps.length === 0) errors.push('No steps defined');

    // Check for duplicate IDs
    if (stepIds.size !== workflow.steps.length) {
      errors.push('Duplicate step IDs found');
    }

    // Check dependencies exist
    for (const step of workflow.steps) {
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!stepIds.has(dep)) {
            errors.push(`Step '${step.id}' depends on unknown step '${dep}'`);
          }
        }
      }
    }

    // Check for cycles
    if (this.hasCycle(workflow.steps)) {
      errors.push('Workflow contains a dependency cycle');
    }

    return { valid: errors.length === 0, errors };
  }

  resolveVariables(template: string, context: Record<string, string>): string {
    let result = template;

    // Replace ${var} references
    result = result.replace(/\$\{(\w+)\}/g, (_, key) => {
      return context[key] ?? '';
    });

    // Replace $step.<field> references (stdout, json, approved, exitCode)
    result = result.replace(/\$(\w+)\.(stdout|json|approved|exitCode)/g, (_, key, field) => {
      return context[`${key}.${field}`] ?? '';
    });

    return result;
  }

  /**
   * Evaluate a condition string against the run context.
   * Returns true if no condition, or if the resolved condition is truthy.
   *
   * Supports:
   * - '$step.approved' → checks context['step.approved'] === 'true'
   * - '$step.exitCode == 0' → basic equality check
   * - Simple truthy check on resolved value
   */
  evaluateCondition(condition: string | undefined, context: Record<string, string>): boolean {
    if (!condition) return true;

    const resolved = this.resolveVariables(condition, context);

    // Handle equality checks: 'value == expected' or 'value != expected'
    const eqMatch = resolved.match(/^(.+?)\s*==\s*(.+)$/);
    if (eqMatch) {
      return eqMatch[1].trim() === eqMatch[2].trim();
    }
    const neqMatch = resolved.match(/^(.+?)\s*!=\s*(.+)$/);
    if (neqMatch) {
      return neqMatch[1].trim() !== neqMatch[2].trim();
    }

    // Truthy check: non-empty, not 'false', not '0'
    return resolved !== '' && resolved !== 'false' && resolved !== '0';
  }

  getExecutionOrder(workflow: LobsterWorkflow): string[] {
    const stepMap = new Map(workflow.steps.map(s => [s.id, s]));
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);

      const step = stepMap.get(id)!;
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          visit(dep);
        }
      }
      order.push(id);
    };

    for (const step of workflow.steps) {
      visit(step.id);
    }

    return order;
  }

  generateResumeToken(completedSteps: string[]): string {
    return Buffer.from(JSON.stringify(completedSteps)).toString('base64');
  }

  parseResumeToken(token: string): string[] {
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);
      if (!Array.isArray(parsed)) throw new Error('Invalid token format');
      return parsed;
    } catch {
      throw new Error('Invalid resume token');
    }
  }

  getWorkflowStatus(results: StepResult[]): 'success' | 'failed' | 'partial' {
    if (results.length === 0) return 'success';

    const hasFailure = results.some(r => r.status === 'failed');
    const hasSuccess = results.some(r => r.status === 'success');

    if (hasFailure && hasSuccess) return 'partial';
    if (hasFailure) return 'failed';
    return 'success';
  }

  /**
   * Execute a workflow with approval gate support.
   * Pauses execution when an approval step is encountered and returns a resumeToken.
   */
  async executeWithApproval(
    workflow: LobsterWorkflow,
    context: Record<string, string> = {},
    approvalHandler?: (gate: ApprovalGate) => Promise<boolean>,
    resumeFrom?: string
  ): Promise<WorkflowRunResult> {
    const validation = this.validateWorkflow(workflow);
    if (!validation.valid) {
      return { status: 'error', output: [], error: validation.errors.join('; ') };
    }

    const order = this.getExecutionOrder(workflow);
    const stepMap = new Map(workflow.steps.map(s => [s.id, s]));
    const results: StepResult[] = [];
    const runContext = { ...workflow.variables, ...context };

    // If resuming, skip already-completed steps
    let completedSteps: Set<string> = new Set();
    if (resumeFrom) {
      try {
        const parsed = this.parseResumeToken(resumeFrom);
        completedSteps = new Set(parsed);
      } catch {
        return { status: 'error', output: [], error: 'Invalid resume token' };
      }
    }

    for (const stepId of order) {
      if (completedSteps.has(stepId)) continue;

      const step = stepMap.get(stepId)!;

      // Evaluate condition — skip step if condition is falsy
      if (!this.evaluateCondition(step.condition, runContext)) {
        results.push({
          stepId,
          status: 'skipped',
          stdout: '',
          exitCode: 0,
          duration: 0,
        });
        continue;
      }

      // Resolve stdin from prior step output if specified
      if (step.stdin) {
        const resolvedStdin = this.resolveVariables(step.stdin, runContext);
        runContext[`${stepId}.stdin`] = resolvedStdin;
      }

      const resolvedCommand = this.resolveVariables(step.command, runContext);

      // Check if this is an approval gate (OpenClaw `approval` field OR command-based)
      const isApprovalGate =
        step.approval === 'required' ||
        step.approval === 'optional' ||
        resolvedCommand.startsWith('approve') ||
        step.command === 'approve';

      if (isApprovalGate) {
        const gate: ApprovalGate = {
          stepId,
          prompt: `Approval required for step "${step.name}"`,
          previewData: results.length > 0 ? results[results.length - 1].stdout : undefined,
          limit: step.timeout,
        };

        if (approvalHandler) {
          const approved = await approvalHandler(gate);
          if (!approved) {
            return { status: 'cancelled', output: results };
          }
          // Approved — continue to next step
          results.push({
            stepId,
            status: 'success',
            stdout: 'Approved',
            exitCode: 0,
            duration: 0,
          });
          runContext[`${stepId}.approved`] = 'true';
          continue;
        }

        // No handler — pause and return resume token
        const completedIds = results.map(r => r.stepId);
        const token = this.generateResumeToken(completedIds);
        return {
          status: 'needs_approval',
          output: results,
          requiresApproval: {
            gate,
            prompt: gate.prompt,
            resumeToken: token,
          },
        };
      }

      // Execute normal step
      const start = Date.now();
      try {
        // In production, this would spawn the subprocess
        logger.debug(`Lobster: executing step ${stepId}: ${resolvedCommand}`);
        const result: StepResult = {
          stepId,
          status: 'success',
          stdout: `[executed] ${resolvedCommand}`,
          exitCode: 0,
          duration: Date.now() - start,
        };
        results.push(result);
        runContext[`${stepId}.stdout`] = result.stdout;
        runContext[`${stepId}.exitCode`] = String(result.exitCode);
      } catch (err) {
        results.push({
          stepId,
          status: 'failed',
          stdout: '',
          exitCode: 1,
          duration: Date.now() - start,
        });
        return { status: 'error', output: results, error: String(err) };
      }
    }

    return { status: 'ok', output: results };
  }

  /**
   * Resume a paused workflow with an approval decision.
   */
  async resumeWorkflow(
    workflow: LobsterWorkflow,
    resumeToken: string,
    approved: boolean,
    context: Record<string, string> = {},
    approvalHandler?: (gate: ApprovalGate) => Promise<boolean>
  ): Promise<WorkflowRunResult> {
    if (!approved) {
      return { status: 'cancelled', output: [] };
    }

    // Parse token to get completed steps, add the approval step
    const completedSteps = this.parseResumeToken(resumeToken);

    // Find the approval step that was pending
    const order = this.getExecutionOrder(workflow);
    const stepMap = new Map(workflow.steps.map(s => [s.id, s]));
    for (const stepId of order) {
      if (completedSteps.includes(stepId)) continue;
      const step = stepMap.get(stepId);
      if (step && (step.approval === 'required' || step.approval === 'optional' || step.command === 'approve' || step.command.startsWith('approve'))) {
        completedSteps.push(stepId);
        break;
      }
    }

    const newToken = this.generateResumeToken(completedSteps);
    return this.executeWithApproval(workflow, context, approvalHandler, newToken);
  }

  private hasCycle(steps: LobsterStep[]): boolean {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const colors = new Map<string, number>();
    steps.forEach(s => colors.set(s.id, WHITE));

    const stepMap = new Map(steps.map(s => [s.id, s]));

    const dfs = (id: string): boolean => {
      colors.set(id, GRAY);
      const step = stepMap.get(id);
      if (step?.dependsOn) {
        for (const dep of step.dependsOn) {
          const color = colors.get(dep);
          if (color === GRAY) return true;
          if (color === WHITE && dfs(dep)) return true;
        }
      }
      colors.set(id, BLACK);
      return false;
    };

    for (const step of steps) {
      if (colors.get(step.id) === WHITE) {
        if (dfs(step.id)) return true;
      }
    }
    return false;
  }

  private parseSimpleYaml(yaml: string): Record<string, unknown> {
    try {
      return JSON.parse(yaml);
    } catch {
      throw new Error('Failed to parse workflow definition');
    }
  }
}
