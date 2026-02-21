/**
 * CI Watcher
 *
 * Monitors CI pipelines (GitHub Actions, GitLab CI, Jenkins, custom webhooks)
 * and emits structured events. Channel-agnostic - formatting is handled
 * by the ChannelProFormatter.
 */

import { EventEmitter } from 'events';
import type { ScopedAuthManager } from './scoped-auth.js';
import type {
  CIAlertType,
  CIProviderType,
  CIWatchConfig,
  CIEvent,
} from './types.js';

/** Default config */
const DEFAULT_CONFIG: CIWatchConfig = {
  enabled: false,
  chatId: '',
  providers: [],
  alertOn: ['build-failure', 'deploy-failure', 'vulnerable-deps'],
  mutedPatterns: [],
};

/** Max events to retain */
const MAX_EVENTS = 200;

/**
 * Watches CI pipelines and emits alert events.
 */
export class CIWatcher extends EventEmitter {
  private config: CIWatchConfig;
  private events: Map<string, CIEvent> = new Map();
  private deduplication: Set<string> = new Set();
  private running = false;
  private authManager?: ScopedAuthManager;

  /** Callback to send alerts (chatId, event, optional analysis) */
  onAlert?: (chatId: string, event: CIEvent, analysis?: string) => Promise<void>;

  /** Callback to request LLM cause analysis */
  onAnalysisRequest?: (event: CIEvent) => Promise<string>;

  constructor(config?: Partial<CIWatchConfig>, authManager?: ScopedAuthManager) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.authManager = authManager;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.emit('started');
  }

  stop(): void {
    this.running = false;
    this.emit('stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Process a webhook payload from any CI provider
   */
  async processWebhookEvent(
    payload: Record<string, unknown>,
    provider: CIProviderType
  ): Promise<CIEvent | null> {
    if (!this.running) return null;

    let event: CIEvent | null = null;

    switch (provider) {
      case 'github-actions':
        event = this.parseGitHubActionsEvent(payload);
        break;
      case 'gitlab-ci':
        event = this.parseGitLabCIEvent(payload);
        break;
      case 'jenkins':
        event = this.parseJenkinsEvent(payload);
        break;
      case 'custom-webhook':
        event = this.parseCustomWebhookEvent(payload);
        break;
    }

    if (!event) return null;

    if (!this.config.alertOn.includes(event.type)) return null;

    const dedupKey = `${event.commit || ''}_${event.workflow || ''}_${event.type}`;
    if (this.deduplication.has(dedupKey)) return null;
    this.deduplication.add(dedupKey);

    if (this.isMuted(event)) return null;

    this.events.set(event.id, event);
    this.pruneEvents();

    // Get analysis if available
    let analysis: string | undefined;
    if (this.onAnalysisRequest) {
      try {
        analysis = await this.onAnalysisRequest(event);
      } catch {
        // Skip analysis on error
      }
    }

    // Send alert via callback
    if (this.onAlert && this.config.chatId) {
      await this.onAlert(this.config.chatId, event, analysis);
    }

    this.emit('event', event);
    return event;
  }

  /**
   * Parse GitHub Actions webhook event
   */
  parseGitHubActionsEvent(payload: Record<string, unknown>): CIEvent | null {
    const workflowRun = payload.workflow_run as Record<string, unknown> | undefined;
    const checkRun = payload.check_run as Record<string, unknown> | undefined;
    const action = payload.action as string;

    if (workflowRun && action === 'completed') {
      const conclusion = workflowRun.conclusion as string;
      if (conclusion === 'success') return null;

      const repo = (payload.repository as Record<string, unknown>)?.full_name as string || 'unknown';
      const branch = (workflowRun.head_branch as string) || 'unknown';
      const commit = (workflowRun.head_sha as string)?.slice(0, 7) || '';

      return {
        id: `gh_${Date.now().toString(36)}`,
        type: conclusion === 'failure' ? 'build-failure' : 'flaky-test',
        provider: 'github-actions',
        repo,
        branch,
        title: `${workflowRun.name || 'Workflow'} ${conclusion}`,
        details: `Workflow "${workflowRun.name}" concluded with ${conclusion} on ${branch}`,
        logUrl: workflowRun.html_url as string,
        severity: conclusion === 'failure' ? 'error' : 'warning',
        commit,
        workflow: workflowRun.name as string,
        timestamp: Date.now(),
      };
    }

    if (checkRun && action === 'completed') {
      const conclusion = checkRun.conclusion as string;
      if (conclusion === 'success') return null;

      const repo = (payload.repository as Record<string, unknown>)?.full_name as string || 'unknown';
      const branch = ((checkRun.check_suite as Record<string, unknown>)?.head_branch as string) || 'unknown';

      return {
        id: `gh_${Date.now().toString(36)}`,
        type: 'build-failure',
        provider: 'github-actions',
        repo,
        branch,
        title: `Check "${checkRun.name}" ${conclusion}`,
        details: (checkRun.output as Record<string, unknown>)?.summary as string || `Check run ${conclusion}`,
        logUrl: checkRun.html_url as string,
        severity: 'error',
        commit: ((checkRun.check_suite as Record<string, unknown>)?.head_sha as string)?.slice(0, 7),
        workflow: checkRun.name as string,
        timestamp: Date.now(),
      };
    }

    if (payload.deployment_status) {
      const depStatus = payload.deployment_status as Record<string, unknown>;
      const state = depStatus.state as string;
      if (state === 'failure' || state === 'error') {
        const repo = (payload.repository as Record<string, unknown>)?.full_name as string || 'unknown';
        const env = (depStatus.environment as string) || 'unknown';
        return {
          id: `gh_dep_${Date.now().toString(36)}`,
          type: 'deploy-failure',
          provider: 'github-actions',
          repo,
          branch: env,
          title: `Deployment to ${env} failed`,
          details: (depStatus.description as string) || `Deployment ${state}`,
          logUrl: depStatus.log_url as string,
          severity: 'critical',
          timestamp: Date.now(),
        };
      }
    }

    return null;
  }

  /**
   * Parse GitLab CI webhook event
   */
  parseGitLabCIEvent(payload: Record<string, unknown>): CIEvent | null {
    const objectKind = payload.object_kind as string;
    if (objectKind !== 'pipeline' && objectKind !== 'build') return null;

    const status = (payload.object_attributes as Record<string, unknown>)?.status as string;
    if (status !== 'failed') return null;

    const project = payload.project as Record<string, unknown>;
    const repo = (project?.path_with_namespace as string) || 'unknown';
    const branch = (payload.object_attributes as Record<string, unknown>)?.ref as string || 'unknown';

    return {
      id: `gl_${Date.now().toString(36)}`,
      type: 'build-failure',
      provider: 'gitlab-ci',
      repo,
      branch,
      title: `${objectKind} failed on ${branch}`,
      details: `${objectKind} #${(payload.object_attributes as Record<string, unknown>)?.id} failed`,
      logUrl: (payload.object_attributes as Record<string, unknown>)?.url as string,
      severity: 'error',
      commit: ((payload.object_attributes as Record<string, unknown>)?.sha as string)?.slice(0, 7),
      timestamp: Date.now(),
    };
  }

  /**
   * Parse Jenkins webhook event
   */
  parseJenkinsEvent(payload: Record<string, unknown>): CIEvent | null {
    const build = payload.build as Record<string, unknown>;
    if (!build) return null;

    const status = (build.status as string) || (build.phase as string);
    if (!status || status.toLowerCase() === 'success') return null;

    return {
      id: `jk_${Date.now().toString(36)}`,
      type: 'build-failure',
      provider: 'jenkins',
      repo: (payload.name as string) || 'unknown',
      branch: (build.scm as Record<string, unknown>)?.branch as string || 'unknown',
      title: `Build #${build.number} ${status}`,
      details: (build.log as string) || `Jenkins build ${status}`,
      logUrl: build.full_url as string || build.url as string,
      severity: 'error',
      timestamp: Date.now(),
    };
  }

  /**
   * Parse custom webhook event (generic format)
   */
  parseCustomWebhookEvent(payload: Record<string, unknown>): CIEvent | null {
    const type = payload.type as CIAlertType;
    if (!type) return null;

    return {
      id: `cw_${Date.now().toString(36)}`,
      type,
      provider: 'custom-webhook',
      repo: (payload.repo as string) || 'unknown',
      branch: (payload.branch as string) || 'unknown',
      title: (payload.title as string) || 'CI Event',
      details: (payload.details as string) || '',
      logUrl: payload.logUrl as string,
      severity: (payload.severity as CIEvent['severity']) || 'warning',
      commit: payload.commit as string,
      workflow: payload.workflow as string,
      timestamp: Date.now(),
    };
  }

  /**
   * Handle "Fix it" action
   */
  async handleFixIt(
    eventId: string,
    userId: string,
    _chatId: string
  ): Promise<{ text: string; objective?: string }> {
    const event = this.events.get(eventId);
    if (!event) {
      return { text: 'Event not found.' };
    }

    if (this.authManager) {
      const decision = this.authManager.checkScope(userId, 'write-patch', {
        repo: event.repo,
      });
      if (!decision.allowed) {
        return { text: `Permission denied: ${decision.reason}` };
      }
    }

    const objective = `Fix CI failure: ${event.title}. Repo: ${event.repo}, Branch: ${event.branch}. Details: ${event.details.slice(0, 200)}`;

    return {
      text: `Launching fix agent for: ${event.title}`,
      objective,
    };
  }

  /**
   * Handle "Mute" action
   */
  handleMute(eventId: string): { text: string } {
    const event = this.events.get(eventId);
    if (!event) {
      return { text: 'Event not found.' };
    }

    const pattern = `${event.workflow || event.type}_${event.repo}`;
    if (!this.config.mutedPatterns.includes(pattern)) {
      this.config.mutedPatterns.push(pattern);
    }

    return { text: `Muted: ${pattern}. Similar events will be suppressed.` };
  }

  /**
   * Unmute a pattern
   */
  handleUnmute(pattern: string): { text: string } {
    const idx = this.config.mutedPatterns.indexOf(pattern);
    if (idx >= 0) {
      this.config.mutedPatterns.splice(idx, 1);
      return { text: `Unmuted: ${pattern}` };
    }
    return { text: `Pattern not found: ${pattern}` };
  }

  /**
   * Get event by ID
   */
  getEvent(id: string): CIEvent | undefined {
    return this.events.get(id);
  }

  /**
   * List recent events
   */
  listEvents(limit: number = 20): CIEvent[] {
    return Array.from(this.events.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get current config
   */
  getConfig(): CIWatchConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  updateConfig(updates: Partial<CIWatchConfig>): void {
    Object.assign(this.config, updates);
  }

  static getSeverityIcon(severity: CIEvent['severity']): string {
    switch (severity) {
      case 'info': return '[INFO]';
      case 'warning': return '[WARN]';
      case 'error': return '[ERROR]';
      case 'critical': return '[CRIT]';
    }
  }

  private isMuted(event: CIEvent): boolean {
    const pattern = `${event.workflow || event.type}_${event.repo}`;
    return this.config.mutedPatterns.includes(pattern);
  }

  private pruneEvents(): void {
    if (this.events.size <= MAX_EVENTS) return;

    const sorted = Array.from(this.events.entries())
      .sort((a, b) => b[1].timestamp - a[1].timestamp);

    const toRemove = sorted.slice(MAX_EVENTS);
    for (const [id] of toRemove) {
      this.events.delete(id);
    }

    if (this.deduplication.size > MAX_EVENTS * 2) {
      this.deduplication.clear();
    }
  }
}
