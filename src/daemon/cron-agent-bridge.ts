/**
 * Cron-Agent Bridge
 *
 * Connects the CronScheduler's task executor to CodeBuddyAgent instances.
 * Creates an agent instance per job execution, delivers results to channels/webhooks.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { detectProviderFromEnv } from '../utils/provider-detector.js';
import type { CronJob } from '../scheduler/cron-scheduler.js';

// ============================================================================
// Types
// ============================================================================

export interface BridgeConfig {
  /** Default API key for agent instances */
  apiKey?: string;
  /** Default base URL */
  baseURL?: string;
  /** Default model */
  model?: string;
  /** Max tool rounds per job */
  maxToolRounds: number;
  /** Job execution timeout (ms) */
  jobTimeoutMs: number;
}

export interface JobExecutionResult {
  jobId: string;
  runId: string;
  success: boolean;
  output: string;
  duration: number;
  delivered?: boolean;
  deliveryChannel?: string;
}

const DEFAULT_BRIDGE_CONFIG: Partial<BridgeConfig> = {
  maxToolRounds: 20,
  jobTimeoutMs: 300000, // 5 minutes
};

interface ResolvedAgentConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
}

// ============================================================================
// Cron Agent Bridge
// ============================================================================

export class CronAgentBridge extends EventEmitter {
  private config: BridgeConfig;
  private activeJobs: Map<string, AbortController> = new Map();

  constructor(config: BridgeConfig) {
    super();
    this.config = { ...DEFAULT_BRIDGE_CONFIG, ...config } as BridgeConfig;
  }

  private resolveAgentConfig(modelOverride?: string): ResolvedAgentConfig {
    if (this.config.apiKey) {
      return {
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL,
        model: modelOverride || this.config.model,
      };
    }

    const provider = detectProviderFromEnv();
    if (!provider) {
      throw new Error('No AI provider configured for cron job execution. Run `buddy login chatgpt` or set a provider API key.');
    }

    return {
      apiKey: provider.apiKey,
      baseURL: this.config.baseURL || provider.baseURL,
      model: modelOverride || this.config.model || provider.defaultModel,
    };
  }

  /**
   * Create a task executor function for the CronScheduler
   */
  createTaskExecutor(): (job: CronJob) => Promise<unknown> {
    return async (job: CronJob): Promise<unknown> => {
      return this.executeJob(job);
    };
  }

  /**
   * Execute a cron job by creating an agent instance
   */
  async executeJob(job: CronJob): Promise<JobExecutionResult> {
    const startTime = Date.now();
    const abortController = new AbortController();
    this.activeJobs.set(job.id, abortController);

    this.emit('job:start', { jobId: job.id, jobName: job.name });

    try {
      let output: string;

      switch (job.task.type) {
        case 'message': {
          output = await this.executeMessageTask(job);
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
        default:
          throw new Error(`Unknown task type: ${job.task.type}`);
      }

      const duration = Date.now() - startTime;

      // Deliver results
      let delivered = false;
      let deliveryChannel: string | undefined;

      if (job.delivery) {
        try {
          const deliveryResult = await this.deliverResult(job, output);
          delivered = deliveryResult.delivered;
          deliveryChannel = deliveryResult.channel;
        } catch (error) {
          logger.warn(`Failed to deliver job result for ${job.id}`, { error: String(error) });
        }
      }

      const result: JobExecutionResult = {
        jobId: job.id,
        runId: `run-${Date.now()}`,
        success: true,
        output,
        duration,
        delivered,
        deliveryChannel,
      };

      this.emit('job:complete', result);
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      const result: JobExecutionResult = {
        jobId: job.id,
        runId: `run-${Date.now()}`,
        success: false,
        output: error instanceof Error ? error.message : String(error),
        duration,
      };

      this.emit('job:error', result);
      throw error;

    } finally {
      this.activeJobs.delete(job.id);
    }
  }

  /**
   * Execute a message-type task
   */
  private async executeMessageTask(job: CronJob): Promise<string> {
    if (!job.task.message) {
      throw new Error('Message task requires a message');
    }

    // Lazy load agent to avoid circular deps
    const agentConfig = this.resolveAgentConfig(job.task.model);
    const { CodeBuddyAgent } = await import('../agent/codebuddy-agent.js');
    const agent = new CodeBuddyAgent(
      agentConfig.apiKey,
      agentConfig.baseURL,
      agentConfig.model,
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

    const entries = await agent.processUserMessage(job.task.message);
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
   * Deliver job result to configured channels
   */
  async deliverResult(
    job: CronJob,
    output: string
  ): Promise<{ delivered: boolean; channel?: string }> {
    if (!job.delivery) {
      return { delivered: false };
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

    // Channel delivery
    if (job.delivery.channel) {
      try {
        const { getChannelManager } = await import('../channels/index.js');
        const channelManager = getChannelManager();
        // Parse channel spec as "type:id" (e.g., "telegram:chat-123") or just type
        const [channelType, channelId] = job.delivery.channel.includes(':')
          ? job.delivery.channel.split(':', 2)
          : [job.delivery.channel, 'default'];
        await channelManager.send(channelType as import('../channels/index.js').ChannelType, {
          channelId,
          content: `**Cron Job: ${job.name}**\n\n${output}`,
        });
        return { delivered: true, channel: job.delivery.channel };
      } catch (error) {
        logger.warn(`Channel delivery failed for job ${job.id}`, { error: String(error) });
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
