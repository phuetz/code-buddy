import { randomUUID } from 'crypto';

import { runAgentCompletion } from './agent-adapter.js';
import { buildHttpAgentSessionKey, withHttpSessionAgent } from './http-agent-sessions.js';
import { logger } from '../utils/logger.js';

const MAX_PENDING_WEBHOOK_RUNS = 100;

export interface WebhookAgentRunInput {
  prompt: string;
  source: string;
  triggerId?: string;
  eventType?: string;
}

export interface AcceptedWebhookAgentRun {
  runId: string;
  acceptedAt: string;
}

interface PendingWebhookAgentRun extends WebhookAgentRunInput, AcceptedWebhookAgentRun {}

const pendingRuns: PendingWebhookAgentRun[] = [];
let processing = false;

async function executeRun(run: PendingWebhookAgentRun): Promise<void> {
  const sessionKey = buildHttpAgentSessionKey('webhook', run.runId);
  await withHttpSessionAgent(sessionKey, (agent) =>
    runAgentCompletion(agent, run.prompt, { surface: 'webhook' })
  );
}

async function processQueue(): Promise<void> {
  try {
    let run = pendingRuns.shift();
    while (run) {
      try {
        await executeRun(run);
      } catch (error) {
        logger.error('Webhook agent run failed', error instanceof Error ? error : new Error(String(error)), {
          runId: run.runId,
          source: run.source,
          triggerId: run.triggerId,
        });
      }
      run = pendingRuns.shift();
    }
  } finally {
    processing = false;
    if (pendingRuns.length > 0) scheduleProcessing();
  }
}

function scheduleProcessing(): void {
  if (processing) return;
  processing = true;
  queueMicrotask(() => void processQueue());
}

/** Enqueue one real agent turn and return only after the queue accepted it. */
export function enqueueWebhookAgentRun(input: WebhookAgentRunInput): AcceptedWebhookAgentRun {
  if (!input.prompt.trim()) {
    throw new Error('Webhook trigger produced an empty agent prompt');
  }
  if (pendingRuns.length >= MAX_PENDING_WEBHOOK_RUNS) {
    throw new Error('Webhook agent queue is full');
  }

  const accepted: PendingWebhookAgentRun = {
    ...input,
    runId: `webhook_${randomUUID()}`,
    acceptedAt: new Date().toISOString(),
  };
  pendingRuns.push(accepted);
  scheduleProcessing();
  return { runId: accepted.runId, acceptedAt: accepted.acceptedAt };
}
