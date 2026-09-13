/**
 * Cron-Agent Bridge
 *
 * Connects the CronScheduler's task executor to CodeBuddyAgent instances.
 * Creates an agent instance per job execution, delivers results to channels/webhooks.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import type { CronJob } from '../scheduler/cron-scheduler.js';
import { executeHermesLifecycleHook } from '../hooks/hermes-lifecycle-hooks.js';
import { evaluateCronPreCheck } from '../scheduler/pre-check-runner.js';
import { runWatchdog } from '../scheduler/watchdog-handlers.js';
import { collectDeliveryTargets, resolveDeliveryBody } from '../scheduler/scheduled-delivery.js';
import type { RunStore, RunMetadata } from '../observability/run-store.js';
import {
  JobNotepadStore,
  defaultNotepadDir,
  isContinuityEnabled,
} from '../scheduler/job-notepad.js';

// ============================================================================
// Types
// ============================================================================

export interface BridgeConfig {
  /** Default API key for agent instances */
  apiKey: string;
  /** Default base URL */
  baseURL?: string;
  /** Default model */
  model?: string;
  /** Max tool rounds per job */
  maxToolRounds: number;
  /** Job execution timeout (ms) */
  jobTimeoutMs: number;
  /**
   * Optional observability store. When provided, each job execution creates a
   * durable run record (events + an `output.md` artifact), so a schedule
   * produces first-class runs instead of only a chat/session side effect.
   * Left undefined, the bridge behaves exactly as before (no run records).
   */
  runStore?: RunStore;
  /**
   * Directory of per-job notepad files. Defaults to `$CODEBUDDY_CRON_HOME/notepads`
   * (or `~/.codebuddy/cron/notepads`). Isolated from jobs.json.
   */
  notepadDir?: string;
}

export interface JobExecutionResult {
  jobId: string;
  runId: string;
  success: boolean;
  output: string;
  duration: number;
  delivered?: boolean;
  deliveryChannel?: string;
  /** True when a pre-check decided the expensive task should be skipped. */
  skipped?: boolean;
  /** Pre-check evidence explaining a skip. */
  skipReason?: string;
  /** For watchdog jobs: false when any check produced an alert/error. */
  watchdogOk?: boolean;
  /**
   * Structured output data for cross-job data passing. When this job is part
   * of a chain (`then`), its outputData is forwarded as the next job's
   * inputData.
   */
  outputData?: string;
}

const DEFAULT_BRIDGE_CONFIG: Partial<BridgeConfig> = {
  maxToolRounds: 20,
  jobTimeoutMs: 300000, // 5 minutes
};

// ============================================================================
// Cron Agent Bridge
// ============================================================================

export class CronAgentBridge extends EventEmitter {
  private config: BridgeConfig;
  private activeJobs: Map<string, AbortController> = new Map();
  private notepad: JobNotepadStore;

  constructor(config: BridgeConfig) {
    super();
    this.config = { ...DEFAULT_BRIDGE_CONFIG, ...config } as BridgeConfig;
    this.notepad = new JobNotepadStore(config.notepadDir ?? defaultNotepadDir());
  }

  /**
   * Create a task executor function for the CronScheduler
   */
  createTaskExecutor(): (job: CronJob, inputData?: string) => Promise<unknown> {
    return async (job: CronJob, inputData?: string): Promise<unknown> => {
      return this.executeJob(job, inputData);
    };
  }

  /**
   * Execute a cron job by creating an agent instance
   */
  async executeJob(job: CronJob, inputData?: string): Promise<JobExecutionResult> {
    const startTime = Date.now();
    const abortController = new AbortController();
    this.activeJobs.set(job.id, abortController);

    this.emit('job:start', { jobId: job.id, jobName: job.name });
    const recordedRunId = this.startRecordedRun(job);

    try {
      // Pre-check gate: skip expensive LLM work when nothing changed.
      // Watchdog jobs are non-LLM monitors, so they bypass the pre-check.
      // Fingerprint is applied only after a skip or a successful task — a
      // failed run must leave lastFingerprint alone so an unchanged source retries.
      let pendingFingerprint: string | undefined;
      if (job.preCheck && job.task.type !== 'watchdog') {
        const preCheckResult = await evaluateCronPreCheck(job.preCheck);
        if (typeof preCheckResult.fingerprint === 'string') {
          pendingFingerprint = preCheckResult.fingerprint;
        }
        this.emit('job:precheck', {
          jobId: job.id,
          shouldRun: preCheckResult.shouldRun,
          reason: preCheckResult.reason,
          evidence: preCheckResult.evidence,
        });
        if (!preCheckResult.shouldRun) {
          if (pendingFingerprint !== undefined) {
            job.preCheck.lastFingerprint = pendingFingerprint;
          }
          const duration = Date.now() - startTime;
          const skipOutput = `Skipped by pre-check: ${preCheckResult.reason}`;
          this.recordRunEvent(recordedRunId, 'decision', {
            kind: 'precheck_skip',
            reason: preCheckResult.reason,
          });
          this.finishRecordedRun(recordedRunId, 'completed', skipOutput);
          const result: JobExecutionResult = {
            jobId: job.id,
            runId: recordedRunId ?? `run-${Date.now()}`,
            success: true,
            output: skipOutput,
            duration,
            skipped: true,
            skipReason: preCheckResult.reason,
          };
          this.emit('job:skipped', result);
          this.emit('job:complete', result);
          return result;
        }
      }

      let output: string;
      let watchdogOk: boolean | undefined;
      let scriptStdout: string | undefined;

      switch (job.task.type) {
        case 'message': {
          output = await this.executeMessageTask(job, inputData);
          break;
        }
        case 'tool': {
          output = await this.executeToolTask(job);
          break;
        }
        case 'agent': {
          output = await this.executeAgentTask(job);
          break;
        }
        case 'watchdog': {
          const watchdogResult = await this.executeWatchdogTask(job);
          output = watchdogResult.output;
          watchdogOk = watchdogResult.ok;
          break;
        }
        case 'script': {
          const scriptResult = await this.executeScriptTaskFull(job);
          output = scriptResult.output;
          scriptStdout = scriptResult.stdout;
          break;
        }
        case 'skill': {
          output = await this.executeSkillTask(job);
          break;
        }
        default:
          throw new Error(`Unknown task type: ${job.task.type}`);
      }

      const duration = Date.now() - startTime;

      // Deliver results
      let delivered = false;
      let deliveryChannel: string | undefined;

      if (job.delivery) {
        try {
          const deliveryStatus = watchdogOk === undefined ? 'completed' : watchdogOk ? 'ok' : 'alert';
          const deliveryResult = await this.deliverResult(job, output, deliveryStatus);
          delivered = deliveryResult.delivered;
          deliveryChannel = deliveryResult.channel;
        } catch (error) {
          logger.warn(`Failed to deliver job result for ${job.id}`, { error: String(error) });
        }
      }

      // The task ran, so the run is 'completed' even if a watchdog alerted;
      // the alert is captured in the output artifact and `watchdogOk` flag.
      this.finishRecordedRun(recordedRunId, 'completed', output, {
        delivered,
        deliveryChannel,
        ...(watchdogOk !== undefined ? { watchdogOk } : {}),
      });

      // For script jobs, outputData is the captured stdout only (structured
      // data channel, capped at 64KB in the script runner). For all other
      // task types, the full output serves as outputData.
      const outputData = job.task.type === 'script' ? scriptStdout : output;

      if (pendingFingerprint !== undefined && job.preCheck) {
        job.preCheck.lastFingerprint = pendingFingerprint;
      }

      if (isContinuityEnabled(job.continuity)) {
        try {
          await this.notepad.saveLastSuccessfulOutput(job.id, outputData ?? output);
        } catch (err) {
          logger.warn('Cron task succeeded but its continuity output could not be saved', { jobId: job.id, error: String(err) });
        }
      }

      const result: JobExecutionResult = {
        jobId: job.id,
        runId: recordedRunId ?? `run-${Date.now()}`,
        success: true,
        output,
        duration,
        delivered,
        deliveryChannel,
        outputData,
        ...(watchdogOk !== undefined ? { watchdogOk } : {}),
      };

      this.emit('job:complete', result);
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorOutput = error instanceof Error ? error.message : String(error);
      this.recordRunEvent(recordedRunId, 'error', { message: errorOutput });
      this.finishRecordedRun(recordedRunId, 'failed', errorOutput);
      const result: JobExecutionResult = {
        jobId: job.id,
        runId: recordedRunId ?? `run-${Date.now()}`,
        success: false,
        output: errorOutput,
        duration,
      };

      this.emit('job:error', result);
      throw error;

    } finally {
      this.activeJobs.delete(job.id);
    }
  }

  /**
   * Start a durable run record for a job execution, when an observability store
   * is configured. Returns the run id, or undefined when recording is disabled
   * or fails (recording must never break job execution).
   */
  private startRecordedRun(job: CronJob): string | undefined {
    const store = this.config.runStore;
    if (!store) return undefined;
    try {
      const metadata: RunMetadata = {
        channel: 'scheduled',
        tags: ['cron', job.task.type],
        ...(job.resolvedSessionId ? { sessionId: job.resolvedSessionId } : {}),
      };
      const runId = store.startRun(`Cron: ${job.name}`, metadata);
      store.emit(runId, {
        type: 'decision',
        data: { kind: 'cron_job_start', jobId: job.id, taskType: job.task.type },
      });
      return runId;
    } catch (err) {
      logger.debug('CronAgentBridge: failed to start recorded run', { error: String(err) });
      return undefined;
    }
  }

  private recordRunEvent(
    runId: string | undefined,
    type: 'decision' | 'error',
    data: Record<string, unknown>,
  ): void {
    const store = this.config.runStore;
    if (!runId || !store) return;
    try {
      store.emit(runId, { type, data });
    } catch {
      // Observability must never break job execution.
    }
  }

  /**
   * Persist the job output as a run artifact and close the run record.
   */
  private finishRecordedRun(
    runId: string | undefined,
    status: 'completed' | 'failed',
    output: string,
    artifactMeta?: Record<string, unknown>,
  ): void {
    const store = this.config.runStore;
    if (!runId || !store) return;
    try {
      store.saveArtifact(runId, 'output.md', String(output).slice(0, 100_000));
      if (artifactMeta && Object.keys(artifactMeta).length > 0) {
        store.saveArtifact(runId, 'delivery.json', JSON.stringify(artifactMeta, null, 2));
      }
      store.endRun(runId, status);
    } catch (err) {
      logger.debug('CronAgentBridge: failed to finish recorded run', { error: String(err) });
    }
  }

  /**
   * Execute a message-type task
   */
  private async executeMessageTask(job: CronJob, inputData?: string): Promise<string> {
    if (!job.task.message) {
      throw new Error('Message task requires a message');
    }

    // Lazy load agent to avoid circular deps
    const { CodeBuddyAgent } = await import('../agent/codebuddy-agent.js');
    const agent = new CodeBuddyAgent(
      this.config.apiKey,
      this.config.baseURL,
      job.task.model || this.config.model,
      this.config.maxToolRounds,
      false // no RAG for cron jobs
    );

    // Session binding: load existing session if resolvedSessionId is set
    if (job.resolvedSessionId && job.sessionTarget !== 'new') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const agentAny = agent as any;
        if (typeof agentAny.loadSession === 'function') {
          await agentAny.loadSession(job.resolvedSessionId);
          logger.debug(`Cron job ${job.id}: resumed session ${job.resolvedSessionId}`);
        }
      } catch {
        logger.debug(`Cron job ${job.id}: could not load session ${job.resolvedSessionId}, starting fresh`);
      }
    }

    let message = job.task.message;
    const prefixes: string[] = [];
    if (isContinuityEnabled(job.continuity)) {
      const section = await this.notepad.renderSection(job.id);
      if (section) prefixes.push(section.trimEnd());
    }
    if (inputData) {
      prefixes.push(`[Chained job context — output from parent job]:\n${inputData}`);
    }
    if (prefixes.length > 0) {
      message = `${prefixes.join('\n\n')}\n\n[Task]:\n${message}`;
    }

    const entries = await agent.processUserMessage(message);
    const assistantEntries = entries.filter(e => e.type === 'assistant');
    return assistantEntries.map(e => e.content).join('\n') || 'No response';
  }

  /**
   * Execute a tool-type task (via agent message)
   */
  private async executeToolTask(job: CronJob): Promise<string> {
    if (!job.task.tool) {
      throw new Error('Tool task requires tool configuration');
    }

    // Execute tool via a message that instructs the agent to use the tool
    const toolMessage = `Execute the ${job.task.tool.name} tool with arguments: ${JSON.stringify(job.task.tool.arguments)}`;
    return this.executeMessageTask({
      ...job,
      task: { ...job.task, type: 'message', message: toolMessage },
    });
  }

  /**
   * Execute an agent-type task
   */
  private async executeAgentTask(job: CronJob): Promise<string> {
    const message = job.task.message || `Execute agent task: ${job.name}`;
    return this.executeMessageTask({ ...job, task: { ...job.task, message } });
  }

  /**
   * Execute a watchdog-type task — disk/http/repo/build monitors that run
   * WITHOUT instantiating a CodeBuddyAgent or calling any model provider.
   */
  private async executeWatchdogTask(job: CronJob): Promise<{ output: string; ok: boolean }> {
    if (!job.task.watchdog) {
      throw new Error('Watchdog task requires watchdog configuration');
    }
    const result = await runWatchdog(job.task.watchdog);
    this.emit('job:watchdog', {
      jobId: job.id,
      ok: result.ok,
      alerts: result.alerts,
      errors: result.errors,
    });
    return { output: result.summary, ok: result.ok };
  }

  /**
   * Execute a script-type task — a bounded, allowlisted shell command run
   * WITHOUT instantiating a CodeBuddyAgent or calling any model provider.
   * A non-zero exit (or timeout) throws so the run is recorded as failed and
   * any chained `then` job does not fire.
   *
   * Returns both the combined output (for logging/delivery) and the separate
   * stdout (for cross-job data passing, capped at 64KB by the script runner).
   */
  private async executeScriptTaskFull(job: CronJob): Promise<{ output: string; stdout: string }> {
    const command = job.task.command;
    if (!command || typeof command.executable !== 'string' || command.executable.length === 0) {
      throw new Error('Script task requires a command with an executable');
    }
    const { runScriptCommand } = await import('../scheduler/script-runner.js');
    const result = await runScriptCommand(command);
    this.emit('job:script', {
      jobId: job.id,
      executable: command.executable,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    });
    if (result.timedOut) {
      throw new Error(`script timed out: ${command.executable}`);
    }
    if (result.exitCode !== 0) {
      throw new Error(
        `script failed: ${command.executable} (exit ${result.exitCode})\n${result.output}`.trim(),
      );
    }
    return { output: result.output, stdout: result.stdout };
  }

  /**
   * Execute a skill-type task — resolves a named skill from the SkillRegistry
   * and runs it via the SkillExecutor. Without a configured tool executor the
   * skill resolves to its guidance text (a legitimate no-agent result); this
   * never spins up the full agentic loop.
   */
  private async executeSkillTask(job: CronJob): Promise<string> {
    const skillName = job.task.skill;
    if (!skillName || typeof skillName !== 'string' || skillName.trim().length === 0) {
      throw new Error('Skill task requires a skill name');
    }

    const { getSkillRegistry } = await import('../skills/registry.js');
    const registry = getSkillRegistry();
    try {
      await registry.load();
    } catch (err) {
      logger.debug('CronAgentBridge: skill registry load failed', { error: String(err) });
    }

    const skill = registry.get(skillName);
    if (!skill) {
      throw new Error(`Skill not found: ${skillName}`);
    }

    const { getSkillExecutor } = await import('../skills/executor.js');
    const executor = getSkillExecutor();
    const result = await executor.execute(skill, {
      request: job.task.skillRequest ?? job.task.message ?? job.name,
      cwd: process.cwd(),
    });

    this.emit('job:skill', {
      jobId: job.id,
      skill: skillName,
      success: result.success,
    });

    if (!result.success) {
      throw new Error(`Skill '${skillName}' failed: ${result.error ?? 'unknown error'}`);
    }
    return result.output ?? `Skill '${skillName}' produced no output`;
  }

  /**
   * Deliver job result to configured channels.
   *
   * Supports a single `delivery.channel` and/or multiple `delivery.targets`
   * (`type:id` specs) fanned out in one pass, plus an optional mobile-safe
   * `summary` body format that redacts secrets and truncates the output.
   */
  async deliverResult(
    job: CronJob,
    output: string,
    status: string = 'completed',
  ): Promise<{ delivered: boolean; channel?: string; channels?: string[] }> {
    if (!job.delivery) {
      return { delivered: false };
    }

    const hookResult = await executeHermesLifecycleHook(process.cwd(), 'before_scheduled_delivery', {
      jobId: job.id,
      jobName: job.name,
      delivery: job.delivery as Record<string, unknown>,
      deliveryOutput: output,
    });
    if (!hookResult.allowed) {
      logger.warn(`Scheduled delivery blocked by BeforeScheduledDelivery hook for job ${job.id}`, {
        feedback: hookResult.feedback,
      });
      return { delivered: false, channel: 'blocked-by-hook' };
    }

    // Webhook delivery
    if (job.delivery.webhookUrl) {
      try {
        await fetch(job.delivery.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobId: job.id,
            jobName: job.name,
            output,
            timestamp: new Date().toISOString(),
          }),
        });
        return { delivered: true, channel: 'webhook' };
      } catch (error) {
        logger.warn(`Webhook delivery failed for job ${job.id}`, { error: String(error) });
      }
    }

    // Channel delivery — single `channel` and/or multiple `targets`, fanned out.
    const targets = collectDeliveryTargets(job.delivery);
    if (targets.length > 0) {
      const { content } = resolveDeliveryBody({
        jobName: job.name,
        output,
        status,
        format: job.delivery.format,
      });
      const { getChannelManager } = await import('../channels/index.js');
      const channelManager = getChannelManager();
      const delivered: string[] = [];
      for (const target of targets) {
        try {
          await channelManager.send(target.channelType as import('../channels/index.js').ChannelType, {
            channelId: target.channelId,
            content,
          });
          delivered.push(target.spec);
        } catch (error) {
          logger.warn(`Channel delivery failed for job ${job.id} target ${target.spec}`, {
            error: String(error),
          });
        }
      }
      if (delivered.length > 0) {
        return { delivered: true, channel: delivered[0], channels: delivered };
      }
    }

    return { delivered: false };
  }

  /**
   * Cancel a running job
   */
  cancelJob(jobId: string): boolean {
    const controller = this.activeJobs.get(jobId);
    if (controller) {
      controller.abort();
      this.activeJobs.delete(jobId);
      return true;
    }
    return false;
  }

  /**
   * Get active job count
   */
  getActiveJobCount(): number {
    return this.activeJobs.size;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let bridgeInstance: CronAgentBridge | null = null;

export function getCronAgentBridge(config?: BridgeConfig): CronAgentBridge {
  if (!bridgeInstance && config) {
    bridgeInstance = new CronAgentBridge(config);
  }
  if (!bridgeInstance) {
    throw new Error('CronAgentBridge not initialized. Call with config first.');
  }
  return bridgeInstance;
}

export function resetCronAgentBridge(): void {
  bridgeInstance = null;
}
