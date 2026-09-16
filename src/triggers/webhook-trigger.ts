/**
 * Webhook Trigger Manager
 *
 * Event-driven trigger system for Code Buddy. Receives webhooks from
 * external services (GitHub, GitLab, Slack, Linear, PagerDuty, generic)
 * and dispatches prompt-based actions to the agent.
 *
 * Closes the gap with Cursor (Slack/Linear/GitHub/PagerDuty triggers).
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as path from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import { readJsonAtomic, writeJsonAtomic } from '../utils/atomic-write.js';

// ============================================================================
// Types
// ============================================================================

export type WebhookSource = 'github' | 'gitlab' | 'slack' | 'linear' | 'pagerduty' | 'generic';

export interface WebhookTriggerConfig {
  /** Unique trigger ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Webhook source type */
  source: WebhookSource;
  /** Events to listen for (e.g. ['pull_request.opened', 'issues.created']) */
  events: string[];
  /** Prompt template with {{event}} variables */
  action: string;
  /** Webhook secret for signature verification */
  secret?: string;
  /** Whether the trigger is enabled */
  enabled: boolean;
  /** Optional filters (e.g. { "label": "bug", "repo": "my-repo" }) */
  filters?: Record<string, string>;
  /** Creation timestamp */
  createdAt: string;
  /** Last fired timestamp */
  lastFiredAt?: string;
  /** Fire count */
  fireCount: number;
}

export interface TriggerResult {
  /** Whether the trigger was matched and fired */
  fired: boolean;
  /** Trigger ID that fired (if any) */
  triggerId?: string;
  /** Resolved prompt to send to the agent */
  prompt?: string;
  /** Error message if trigger handling failed */
  error?: string;
  /** Event type that was received */
  eventType?: string;
}

export interface WebhookEvent {
  /** Source of the webhook */
  source: WebhookSource;
  /** Event type (e.g. 'pull_request.opened') */
  type: string;
  /** Extracted event data */
  data: Record<string, string>;
  /** Raw request body */
  rawBody: unknown;
  /** Request headers */
  headers: Record<string, string>;
}

export interface WebhookTriggerEvents {
  'trigger:fired': (result: TriggerResult, trigger: WebhookTriggerConfig) => void;
  'trigger:added': (trigger: WebhookTriggerConfig) => void;
  'trigger:removed': (id: string) => void;
  'trigger:error': (error: Error, trigger?: WebhookTriggerConfig) => void;
  'webhook:received': (event: WebhookEvent) => void;
}

// ============================================================================
// Template Resolution
// ============================================================================

/**
 * Resolve template variables in a string.
 * Supports dot-notation: {{event.title}}, {{body.data.status}}
 */
export function resolveTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    const trimmedKey = key.trim();
    const value = getNestedValue(variables, trimmedKey);
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

/**
 * Get a nested value from an object using dot notation.
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ============================================================================
// Filter Matching
// ============================================================================

/**
 * Check if an event matches the trigger's filters.
 * All filter keys must match (AND logic).
 */
export function matchFilters(
  filters: Record<string, string> | undefined,
  eventData: Record<string, string>,
): boolean {
  if (!filters || Object.keys(filters).length === 0) return true;

  for (const [key, value] of Object.entries(filters)) {
    const eventValue = eventData[key];
    if (eventValue === undefined) return false;
    // Support glob-style wildcard matching
    if (value.includes('*')) {
      const regex = new RegExp('^' + value.replace(/\*/g, '.*') + '$', 'i');
      if (!regex.test(eventValue)) return false;
    } else if (eventValue.toLowerCase() !== value.toLowerCase()) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// Persist Path
// ============================================================================

const DEFAULT_PERSIST_PATH = path.join(homedir(), '.codebuddy', 'triggers', 'webhooks.json');

// ============================================================================
// Webhook Trigger Manager
// ============================================================================

export class WebhookTriggerManager extends EventEmitter {
  private triggers: Map<string, WebhookTriggerConfig> = new Map();
  private persistPath: string;

  constructor(persistPath?: string) {
    super();
    this.persistPath = persistPath ?? DEFAULT_PERSIST_PATH;
  }

  /**
   * Load triggers from disk.
   */
  async load(): Promise<void> {
    const configs = await readJsonAtomic<WebhookTriggerConfig[]>(this.persistPath, [], {
      mode: 0o600,
      isValid: (value): value is WebhookTriggerConfig[] => Array.isArray(value),
    });
    this.triggers.clear();
    for (const config of configs) {
      if (config && typeof config.id === 'string') this.triggers.set(config.id, config);
    }
    logger.debug(`Loaded ${configs.length} webhook triggers from ${this.persistPath}`);
  }

  /**
   * Persist triggers to disk.
   */
  async save(): Promise<void> {
    try {
      await writeJsonAtomic(this.persistPath, Array.from(this.triggers.values()), { mode: 0o600 });
    } catch (err) {
      logger.error(`Failed to persist webhook triggers: ${(err as Error).message}`);
    }
  }

  /**
   * Add a webhook trigger.
   */
  addTrigger(config: WebhookTriggerConfig): void {
    if (!config.id) {
      config.id = crypto.randomUUID();
    }
    if (!config.createdAt) {
      config.createdAt = new Date().toISOString();
    }
    if (config.fireCount === undefined) {
      config.fireCount = 0;
    }
    this.triggers.set(config.id, config);
    this.emit('trigger:added', config);
    logger.debug(`Webhook trigger added: ${config.name} (${config.source}: ${config.events.join(', ')})`);
  }

  /**
   * Remove a webhook trigger by ID.
   */
  removeTrigger(id: string): boolean {
    const existed = this.triggers.delete(id);
    if (existed) {
      this.emit('trigger:removed', id);
      logger.debug(`Webhook trigger removed: ${id}`);
    }
    return existed;
  }

  /**
   * Get a trigger by ID.
   */
  getTrigger(id: string): WebhookTriggerConfig | undefined {
    return this.triggers.get(id);
  }

  /**
   * List all configured triggers.
   */
  listTriggers(): WebhookTriggerConfig[] {
    return Array.from(this.triggers.values());
  }

  /**
   * Handle an incoming webhook.
   * Parses the event, matches triggers, resolves templates, and fires.
   */
  async handleWebhook(
    source: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<TriggerResult> {
    const webhookSource = normalizeSource(source);

    // Parse the event using the appropriate parser
    let event: WebhookEvent;
    try {
      event = await parseWebhookEvent(webhookSource, headers, body);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to parse webhook from ${source}: ${error}`);
      return { fired: false, error };
    }

    this.emit('webhook:received', event);

    // Find matching triggers
    const matchingTriggers = this.findMatchingTriggers(event);
    if (matchingTriggers.length === 0) {
      return { fired: false, eventType: event.type };
    }

    // Fire the first matching trigger
    const trigger = matchingTriggers[0];
    if (!trigger) {
      // Unreachable in practice: matchingTriggers.length === 0 returned above.
      return { fired: false, eventType: event.type };
    }

    // Verify signature if trigger has a secret
    if (trigger.secret) {
      const valid = verifyWebhookSignature(webhookSource, headers, body, trigger.secret);
      if (!valid) {
        logger.warn(`Webhook signature verification failed for trigger ${trigger.id}`);
        return { fired: false, error: 'Signature verification failed', triggerId: trigger.id };
      }
    }

    // Resolve the action template
    const templateVars = {
      event: event.data,
      body: body as Record<string, unknown>,
    };
    const prompt = resolveTemplate(trigger.action, templateVars);

    // Update trigger stats
    trigger.lastFiredAt = new Date().toISOString();
    trigger.fireCount++;

    const result: TriggerResult = {
      fired: true,
      triggerId: trigger.id,
      prompt,
      eventType: event.type,
    };

    this.emit('trigger:fired', result, trigger);
    logger.info(`Webhook trigger fired: ${trigger.name} (${event.type})`);

    return result;
  }

  /**
   * Find triggers that match a webhook event.
   */
  private findMatchingTriggers(event: WebhookEvent): WebhookTriggerConfig[] {
    const matches: WebhookTriggerConfig[] = [];

    for (const trigger of this.triggers.values()) {
      if (!trigger.enabled) continue;
      if (trigger.source !== event.source && trigger.source !== 'generic') continue;

      // Check event type match
      const eventMatches = trigger.events.some(pattern => {
        if (pattern === '*') return true;
        // Support wildcard patterns: 'pull_request.*'
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
          return regex.test(event.type);
        }
        return pattern === event.type;
      });

      if (!eventMatches) continue;

      // Check filters
      if (!matchFilters(trigger.filters, event.data)) continue;

      matches.push(trigger);
    }

    return matches;
  }
}

// ============================================================================
// Webhook Signature Verification
// ============================================================================

/**
 * Verify webhook signature based on source type.
 */
export function verifyWebhookSignature(
  source: WebhookSource,
  headers: Record<string, string>,
  body: unknown,
  secret: string,
): boolean {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);

  switch (source) {
    case 'github': {
      const signature = headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'];
      if (!signature) return false;
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(bodyStr);
      const expected = 'sha256=' + hmac.digest('hex');
      try {
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      } catch {
        return false;
      }
    }

    case 'gitlab': {
      const token = headers['x-gitlab-token'] || headers['X-Gitlab-Token'];
      return token === secret;
    }

    case 'slack': {
      const timestamp = headers['x-slack-request-timestamp'] || headers['X-Slack-Request-Timestamp'];
      const slackSig = headers['x-slack-signature'] || headers['X-Slack-Signature'];
      if (!timestamp || !slackSig) return false;

      // Check for replay attacks (5 minute window)
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

      const sigBasestring = `v0:${timestamp}:${bodyStr}`;
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(sigBasestring);
      const expected = 'v0=' + hmac.digest('hex');
      try {
        return crypto.timingSafeEqual(Buffer.from(slackSig), Buffer.from(expected));
      } catch {
        return false;
      }
    }

    case 'linear': {
      const linearSig = headers['linear-signature'] || headers['Linear-Signature'];
      if (!linearSig) return false;
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(bodyStr);
      const expected = hmac.digest('hex');
      try {
        return crypto.timingSafeEqual(Buffer.from(linearSig), Buffer.from(expected));
      } catch {
        return false;
      }
    }

    case 'pagerduty': {
      // PagerDuty uses v1 webhook signatures
      const pdSigs = (headers['x-pagerduty-signature'] || headers['X-PagerDuty-Signature'] || '').split(',');
      for (const sig of pdSigs) {
        const trimmed = sig.trim();
        if (!trimmed.startsWith('v1=')) continue;
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(bodyStr);
        const expected = 'v1=' + hmac.digest('hex');
        try {
          if (crypto.timingSafeEqual(Buffer.from(trimmed), Buffer.from(expected))) return true;
        } catch {
          continue;
        }
      }
      return false;
    }

    case 'generic': {
      // Generic: check Authorization header or custom X-Webhook-Secret
      const authHeader = headers['authorization'] || headers['Authorization'];
      if (authHeader) {
        return authHeader === `Bearer ${secret}` || authHeader === secret;
      }
      const webhookSecret = headers['x-webhook-secret'] || headers['X-Webhook-Secret'];
      return webhookSecret === secret;
    }

    default:
      return false;
  }
}

// ============================================================================
// Event Parsing
// ============================================================================

/**
 * Normalize source string to a known WebhookSource type.
 */
function normalizeSource(source: string): WebhookSource {
  const normalized = source.toLowerCase().trim();
  const known: WebhookSource[] = ['github', 'gitlab', 'slack', 'linear', 'pagerduty', 'generic'];
  if (known.includes(normalized as WebhookSource)) {
    return normalized as WebhookSource;
  }
  return 'generic';
}

/**
 * Parse a webhook event into a standardized format.
 * Delegates to source-specific parsers.
 */
async function parseWebhookEvent(
  source: WebhookSource,
  headers: Record<string, string>,
  body: unknown,
): Promise<WebhookEvent> {
  switch (source) {
    case 'github':
      return parseGitHubEvent(headers, body);
    case 'gitlab':
      return parseGitLabEvent(headers, body);
    case 'slack':
      return parseSlackEvent(headers, body);
    case 'linear':
      return parseLinearEvent(headers, body);
    case 'pagerduty':
      return parsePagerDutyEvent(headers, body);
    case 'generic':
    default:
      return parseGenericEvent(headers, body);
  }
}

// ============================================================================
// Source-Specific Parsers
// ============================================================================

function parseGitHubEvent(headers: Record<string, string>, body: unknown): WebhookEvent {
  const eventHeader = headers['x-github-event'] || headers['X-GitHub-Event'] || '';
  const payload = body as Record<string, unknown>;
  const action = payload.action as string || '';
  const eventType = action ? `${eventHeader}.${action}` : eventHeader;

  const data: Record<string, string> = {
    type: eventType,
  };

  // Extract common fields
  const repo = payload.repository as Record<string, unknown> | undefined;
  if (repo) {
    data.repo = repo.full_name as string || '';
    data.repoUrl = repo.html_url as string || '';
  }

  const sender = payload.sender as Record<string, unknown> | undefined;
  if (sender) {
    data.author = sender.login as string || '';
  }

  // PR-specific
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  if (pr) {
    data.title = pr.title as string || '';
    data.body = pr.body as string || '';
    data.url = pr.html_url as string || '';
    data.diff = pr.diff_url as string || '';
    data.number = String(pr.number || '');
    data.branch = (pr.head as Record<string, unknown>)?.ref as string || '';
    data.baseBranch = (pr.base as Record<string, unknown>)?.ref as string || '';
  }

  // Issue-specific
  const issue = payload.issue as Record<string, unknown> | undefined;
  if (issue) {
    data.title = issue.title as string || '';
    data.body = issue.body as string || '';
    data.url = issue.html_url as string || '';
    data.number = String(issue.number || '');
    const labels = issue.labels as Array<Record<string, unknown>> | undefined;
    if (labels) {
      data.labels = labels.map(l => l.name as string).join(', ');
    }
  }

  // Push-specific
  if (eventHeader === 'push') {
    const commits = payload.commits as Array<Record<string, unknown>> | undefined;
    if (commits) {
      data.commitCount = String(commits.length);
      data.commits = commits.map(c => `${(c.id as string || '').slice(0, 7)}: ${c.message as string || ''}`).join('\n');
    }
    data.ref = payload.ref as string || '';
    data.branch = (payload.ref as string || '').replace('refs/heads/', '');
  }

  // Workflow run
  const workflowRun = payload.workflow_run as Record<string, unknown> | undefined;
  if (workflowRun) {
    data.title = workflowRun.name as string || '';
    data.conclusion = workflowRun.conclusion as string || '';
    data.url = workflowRun.html_url as string || '';
    data.branch = (workflowRun.head_branch as string) || '';
  }

  return { source: 'github', type: eventType, data, rawBody: body, headers };
}

function parseGitLabEvent(headers: Record<string, string>, body: unknown): WebhookEvent {
  const eventHeader = headers['x-gitlab-event'] || headers['X-Gitlab-Event'] || '';
  const payload = body as Record<string, unknown>;
  const objectKind = payload.object_kind as string || '';
  const action = (payload.object_attributes as Record<string, unknown>)?.action as string || '';
  const eventType = action ? `${objectKind}.${action}` : objectKind || eventHeader;

  const data: Record<string, string> = {
    type: eventType,
  };

  const project = payload.project as Record<string, unknown> | undefined;
  if (project) {
    data.repo = project.path_with_namespace as string || '';
    data.repoUrl = project.web_url as string || '';
  }

  const user = payload.user as Record<string, unknown> | undefined;
  if (user) {
    data.author = user.username as string || '';
  }

  const attrs = payload.object_attributes as Record<string, unknown> | undefined;
  if (attrs) {
    data.title = attrs.title as string || '';
    data.body = attrs.description as string || '';
    data.url = attrs.url as string || '';
  }

  return { source: 'gitlab', type: eventType, data, rawBody: body, headers };
}

function parseSlackEvent(headers: Record<string, string>, body: unknown): WebhookEvent {
  const payload = body as Record<string, unknown>;
  const event = payload.event as Record<string, unknown> || {};
  const eventType = event.type as string || payload.type as string || 'unknown';

  const data: Record<string, string> = {
    type: eventType,
    text: event.text as string || '',
    channel: event.channel as string || '',
    user: event.user as string || '',
    ts: event.ts as string || '',
  };

  return { source: 'slack', type: eventType, data, rawBody: body, headers };
}

function parseLinearEvent(headers: Record<string, string>, body: unknown): WebhookEvent {
  const payload = body as Record<string, unknown>;
  const action = payload.action as string || '';
  const type = payload.type as string || '';
  const eventType = `${type}.${action}`;

  const data: Record<string, string> = {
    type: eventType,
  };

  const linearData = payload.data as Record<string, unknown> | undefined;
  if (linearData) {
    data.title = linearData.title as string || '';
    data.body = linearData.description as string || '';
    data.url = linearData.url as string || '';
    data.status = (linearData.state as Record<string, unknown>)?.name as string || '';
    data.assignee = (linearData.assignee as Record<string, unknown>)?.name as string || '';
    data.priority = String(linearData.priority || '');
    const labels = linearData.labels as Array<Record<string, unknown>> | undefined;
    if (labels) {
      data.labels = labels.map(l => l.name as string).join(', ');
    }
  }

  return { source: 'linear', type: eventType, data, rawBody: body, headers };
}

function parsePagerDutyEvent(headers: Record<string, string>, body: unknown): WebhookEvent {
  const payload = body as Record<string, unknown>;
  const messages = payload.messages as Array<Record<string, unknown>> || [];
  const first = messages[0] || {};
  const eventType = first.event as string || 'incident.trigger';

  const data: Record<string, string> = {
    type: eventType,
  };

  const incident = first.incident as Record<string, unknown> | undefined;
  if (incident) {
    data.title = incident.title as string || '';
    data.body = incident.description as string || '';
    data.url = incident.html_url as string || '';
    data.status = incident.status as string || '';
    data.urgency = incident.urgency as string || '';
    const service = incident.service as Record<string, unknown> | undefined;
    if (service) {
      data.service = service.summary as string || '';
    }
  }

  return { source: 'pagerduty', type: eventType, data, rawBody: body, headers };
}

function parseGenericEvent(headers: Record<string, string>, body: unknown): WebhookEvent {
  const payload = body as Record<string, unknown>;
  const eventType = (
    payload.event as string ||
    payload.type as string ||
    payload.action as string ||
    headers['x-event-type'] ||
    headers['X-Event-Type'] ||
    'generic'
  );

  // Flatten top-level string fields into data
  const data: Record<string, string> = { type: eventType };
  if (typeof payload === 'object' && payload !== null) {
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        data[key] = String(value);
      }
    }
  }

  return { source: 'generic', type: eventType, data, rawBody: body, headers };
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: WebhookTriggerManager | null = null;

export function getWebhookTriggerManager(): WebhookTriggerManager {
  if (!_instance) {
    _instance = new WebhookTriggerManager();
  }
  return _instance;
}

export function resetWebhookTriggerManager(): void {
  _instance = null;
}
