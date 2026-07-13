import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import type { BrowserOperatorSessionDraft, BrowserOperatorActionLogEntry } from './browser-operator-session.js';
import { buildBrowserOperatorHarnessBundle } from './browser-operator-harness.js';
import { logger } from '../utils/logger.js';
import { ConfirmationService } from '../utils/confirmation-service.js';
import { getDataRedactionEngine } from '../security/data-redaction.js';

const INIT_TIMEOUT_MS = 30_000;
const NAVIGATION_TIMEOUT_MS = 60_000;
const ACTION_TIMEOUT_MS = 45_000;
const EXTRACT_TIMEOUT_MS = 60_000;
const WATCHDOG_INTERVAL_MS = 3_000;
export const BROWSER_OPERATOR_PROFILE_MARKER = '.codebuddy-browser-operator-profile.json';
export const BROWSER_OPERATOR_PROFILE_LOCK = '.codebuddy-browser-operator.lock';
const PROFILE_OWNER = 'code-buddy-browser-operator';
const PROFILE_MARKER_SCHEMA_VERSION = 1;
const PROFILE_LOCK_SCHEMA_VERSION = 1;
const PROFILE_LOCK_STALE_MS = 120_000;
const PROFILE_LOCK_UPDATE_MS = 15_000;
const MAX_PROFILE_CONTROL_FILE_BYTES = 4_096;

type StagehandPage = Record<string, any>;
type StagehandContext = Record<string, any>;
type StagehandInstance = {
  page?: StagehandPage;
  context?: StagehandContext;
  init: () => Promise<void>;
  close: () => Promise<void>;
  connectURL?: () => string;
  extract?: (...args: unknown[]) => Promise<unknown>;
  observe?: (...args: unknown[]) => Promise<unknown>;
};

interface NavigationRequestLike {
  url?: () => string;
  isNavigationRequest?: () => boolean;
  resourceType?: () => string;
}

interface NavigationRouteLike {
  abort?: (errorCode?: string) => Promise<unknown> | unknown;
  continue?: () => Promise<unknown> | unknown;
  request?: () => NavigationRequestLike;
}

type NavigationRouteHandler = (
  route: NavigationRouteLike,
  request?: NavigationRequestLike,
) => Promise<void>;

interface NavigationRouteTarget {
  route: (url: string, handler: NavigationRouteHandler) => Promise<unknown> | unknown;
  unroute?: (url: string, handler: NavigationRouteHandler) => Promise<unknown> | unknown;
}

interface NavigationGuardBrowser {
  contexts: () => Array<NavigationRouteTarget & { pages?: () => StagehandPage[] }>;
}

interface BrowserOperatorProfileMarker {
  schemaVersion: number;
  owner: string;
  profileId: string;
  createdAt: string;
}

interface BrowserOperatorProfileLockMetadata {
  schemaVersion: number;
  owner: string;
  token: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
}

export type BrowserOperatorSemanticRisk = 'read' | 'low' | 'sensitive';

interface BrowserOperatorTargetContext {
  text: string;
  ariaLabel: string;
  labels: string;
  neighborhood: string;
  formAction: string;
  formText: string;
  role: string;
  inputType: string;
  name: string;
  href: string;
}

interface BrowserOperatorTargetInspection {
  inspected: true;
  targetFound: boolean;
  url: string;
  documentTitle: string;
  contexts: BrowserOperatorTargetContext[];
  resolvedSelectors: string[];
  error?: string;
}

interface BrowserOperatorSemanticPreflight {
  risk: BrowserOperatorSemanticRisk;
  targetInspected: boolean;
  reasons: string[];
  resolvedSelectors: string[];
}

export interface BrowserOperatorProfileLock {
  profilePath: string;
  lockPath: string;
  token: string;
  release: () => void;
}

export interface BrowserOperatorProfileLockOptions {
  staleMs?: number;
  updateMs?: number;
  pid?: number;
  hostname?: string;
  now?: () => number;
  isProcessAlive?: (pid: number) => boolean;
}

interface BrowserActionResult {
  evidence: string;
  artifactPath?: string;
}

interface ResolvedBrowserElement {
  selector: string;
  description: string;
  method?: string;
  arguments?: string[];
  source: 'stagehand-observe' | 'dom-heuristic';
}

type GuardedResult<T> =
  | { kind: 'value'; value: T }
  | { kind: 'error'; error: unknown }
  | { kind: 'checkpoint' }
  | { kind: 'stopped' }
  | { kind: 'timeout' };

export interface BrowserOperatorExecutorEvent {
  type: 'started' | 'action' | 'stopping' | 'completed';
  sessionId: string;
  stopped?: boolean;
  success?: boolean;
  action?: BrowserOperatorActionLogEntry;
}

export interface BrowserOperatorExecutorOptions {
  /** Injectable for deterministic tests; production defaults to the fail-closed SSRF guard. */
  urlGuard?: (url: string) => Promise<{ safe: boolean; reason?: string }>;
  onEvent?: (event: BrowserOperatorExecutorEvent) => void;
}

export interface BrowserOperatorExecutorResult {
  success: boolean;
  stopped: boolean;
  actionLog: BrowserOperatorActionLogEntry[];
  proofPath: string;
}

const MUTATING_ACTIONS = new Set([
  'act',
  'click',
  'double_click',
  'right_click',
  'type',
  'fill',
  'select',
  'press',
  'hover',
  'drag',
  'upload_files',
  'download',
  'set_cookie',
  'clear_cookies',
  'set_local_storage',
  'set_session_storage',
  'set_headers',
  'set_offline',
  'set_geolocation',
]);

const TARGET_INSPECTION_ACTIONS = new Set([
  'act',
  'click',
  'double_click',
  'right_click',
  'type',
  'fill',
  'select',
  'press',
  'hover',
  'upload_files',
  'download',
]);

const SENSITIVE_SEMANTIC_SIGNALS: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: 'payment, purchase, or money movement',
    pattern: /(?:\bcheckout\b|\bpay(?:ment| now)?\b|\bpurchase\b|\bplace order\b|\bcomplete order\b|\border total\b|\bcart total\b|\bamount due\b|\btotal (?:due|to pay)\b|\bbilling\b|\bcredit card\b|\bcard number\b|\bcvv\b|\btransfer (?:funds|money)\b|\bdonat(?:e|ion)\b|paiement|payer|achat|commander|total de la commande|montant à payer|carte bancaire|facturation|virement|faire un don)/i,
  },
  {
    reason: 'external message, publication, or submission',
    pattern: /(?:\bsend\b|\bsubmit\b|\bpublish\b|\bpost (?:comment|message|reply)\b|\bshare\b|\bupload\b|\bsend email\b|\bmessage preview\b|\brecipient(?:s)?\b|envoyer|soumettre|publier|partager|téléverser|televerser|aperçu du message|apercu du message|destinataire|envoyer.*courriel)/i,
  },
  {
    reason: 'destructive or account-changing effect',
    pattern: /(?:\bdelete\b|\bremove\b|\btrash\b|\bdestroy\b|\berase\b|\bpermanent(?:ly)?\b|\bcannot be undone\b|\bclose account\b|\bcancel (?:account|subscription|booking)\b|\bunsubscribe\b|\brevoke\b|\breset password\b|\bchange password\b|\bgrant permission\b|\binvite user\b|supprimer|effacer|détruire|detruire|irréversible|irreversible|fermer le compte|annuler l'abonnement|résilier|resilier|révoquer|revoquer|mot de passe|accorder.*autorisation|inviter)/i,
  },
  {
    reason: 'booking or binding reservation',
    pattern: /(?:\bbook now\b|\bconfirm booking\b|\bconfirm reservation\b|\bschedule appointment\b|\bcheck[- ]?in\b|confirmer la réservation|confirmer la reservation|prendre rendez-vous|réserver maintenant|reserver maintenant)/i,
  },
  {
    reason: 'credential or highly sensitive form field',
    pattern: /(?:\bpassword\b|\bpasscode\b|\bone[- ]time code\b|\botp\b|\bsocial security\b|\biban\b|\bprivate key\b|mot de passe|code de sécurité|code de securite)/i,
  },
];

const BROWSER_ACTIONS = new Set([
  'navigate',
  'go_back',
  'go_forward',
  'reload',
  'observe',
  'extract',
  'identify_element',
  'resolve_element',
  'assert_text',
  'act',
  'click',
  'double_click',
  'right_click',
  'type',
  'fill',
  'select',
  'press',
  'hover',
  'scroll',
  'evaluate',
  'get_content',
  'get_text',
  'get_url',
  'get_title',
  'screenshot',
  'wait',
  'wait_for_selector',
  'wait_for_navigation',
  'get_cookies',
  'set_cookie',
  'clear_cookies',
  'get_local_storage',
  'set_local_storage',
  'get_session_storage',
  'set_session_storage',
  'upload_files',
  'download',
  'tabs',
  'new_tab',
  'focus_tab',
  'close_tab',
]);

export class SecurityCheckpointDetected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityCheckpointDetected';
  }
}

export class BrowserOperatorStopped extends Error {
  constructor() {
    super('Browser Operator stopped by the local operator.');
    this.name = 'BrowserOperatorStopped';
  }
}

export class BrowserOperatorExecutor {
  private session: BrowserOperatorSessionDraft;
  private readonly options: BrowserOperatorExecutorOptions;
  private stagehand: StagehandInstance | null = null;
  private page: StagehandPage | null = null;
  private isStopped = false;
  private readonly stopListeners = new Set<() => void>();
  private readonly navigationRoutePattern = '**/*';
  private readonly navigationRouteTargets: NavigationRouteTarget[] = [];
  private readonly pendingNavigationChecks = new Set<Promise<void>>();
  private navigationRouteHandler: NavigationRouteHandler | null = null;
  private navigationGuardBrowser: NavigationGuardBrowser | null = null;
  private navigationViolation: Error | null = null;
  private profileLock: BrowserOperatorProfileLock | null = null;
  private readonly semanticTargetSelectors = new Map<string, string[]>();

  constructor(session: BrowserOperatorSessionDraft, options: BrowserOperatorExecutorOptions = {}) {
    this.session = session;
    this.options = options;
  }

  /**
   * Grant consent for the session.
   */
  grantConsent(reviewer: string = 'human-operator'): void {
    this.session.consent.granted = true;
    this.session.consent.grantedBy = reviewer;
    this.session.consent.grantedAt = new Date().toISOString();
    logger.info(`BrowserOperatorExecutor: Consent granted for session ${this.session.sessionId} by ${reviewer}`);
  }

  /**
   * Stop the session execution.
   */
  stop(): void {
    if (this.isStopped) return;
    this.isStopped = true;
    for (const listener of this.stopListeners) listener();
    this.stopListeners.clear();
    // Closing the owned Stagehand instance interrupts Playwright operations
    // that would otherwise remain alive until their individual timeout.
    void this.stagehand?.close().catch(() => undefined);
    this.emit({ type: 'stopping', sessionId: this.session.sessionId, stopped: true });
    logger.info(`BrowserOperatorExecutor: Stop signal received for session ${this.session.sessionId}`);
  }

  /**
   * Run the planned browser actions sequentially.
   */
  async execute(cwd: string = process.cwd()): Promise<BrowserOperatorExecutorResult> {
    if (!this.session.consent.granted) {
      logger.error('BrowserOperatorExecutor: Execution blocked. Consent required.');
      throw new Error('BrowserOperatorConsentRequired: Execution blocked. Local browser operator requires human consent.');
    }

    assertSafeSessionId(this.session.sessionId);
    const workspaceRoot = requireWorkspaceRoot(cwd);

    logger.info(`BrowserOperatorExecutor: Starting execution for session ${this.session.sessionId} (mode: ${this.session.mode})`);
    this.emit({ type: 'started', sessionId: this.session.sessionId });

    const checkpointListeners = new Set<() => void>();
    let watchdogInterval: NodeJS.Timeout | null = null;
    let checkpointDetected = false;
    let checkpointReason = '';

    const raiseCheckpoint = (reason: string) => {
      logger.error(`[BrowserWatchdog] ${reason}`);
      this.isStopped = true;
      checkpointDetected = true;
      checkpointReason = reason;
      if (watchdogInterval) {
        clearInterval(watchdogInterval);
        watchdogInterval = null;
      }
      for (const listener of checkpointListeners) {
        listener();
      }
      checkpointListeners.clear();
    };

    const runGuarded = async <T>(
      label: string,
      timeoutMs: number,
      operation: () => Promise<T>,
    ): Promise<T> => {
      if (checkpointDetected) {
        throw new SecurityCheckpointDetected(checkpointReason);
      }
      if (this.isStopped) {
        throw new BrowserOperatorStopped();
      }

      let checkpointListener: (() => void) | null = null;
      let stopListener: (() => void) | null = null;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const operationPromise: Promise<GuardedResult<T>> = Promise.resolve()
        .then(operation)
        .then((value) => ({ kind: 'value' as const, value }))
        .catch((error) => ({ kind: 'error' as const, error }));

      const checkpointPromise = new Promise<GuardedResult<T>>((resolve) => {
        checkpointListener = () => resolve({ kind: 'checkpoint' });
        checkpointListeners.add(checkpointListener);
      });

      const stopPromise = new Promise<GuardedResult<T>>((resolve) => {
        stopListener = () => resolve({ kind: 'stopped' });
        this.stopListeners.add(stopListener);
        if (this.isStopped) stopListener();
      });

      const timeoutPromise = new Promise<GuardedResult<T>>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
        timeoutHandle.unref?.();
      });

      try {
        const result = await Promise.race([
          operationPromise,
          checkpointPromise,
          stopPromise,
          timeoutPromise,
        ]);
        if (result.kind === 'checkpoint') {
          throw new SecurityCheckpointDetected(checkpointReason);
        }
        if (result.kind === 'stopped') {
          throw new BrowserOperatorStopped();
        }
        if (result.kind === 'timeout') {
          throw new Error(`${label} timed out after ${timeoutMs}ms`);
        }
        if (result.kind === 'error') {
          throw result.error;
        }
        return result.value;
      } finally {
        if (checkpointListener) {
          checkpointListeners.delete(checkpointListener);
        }
        if (stopListener) {
          this.stopListeners.delete(stopListener);
        }
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    };

    const startWatchdog = () => {
      watchdogInterval = setInterval(async () => {
        try {
          if (this.isStopped || !this.page) return;
          const content = await this.getPageContent();
          const lower = String(content).toLowerCase();
          const antiBotIndicators = [
            'cf-challenge',
            'cloudflare',
            'recaptcha',
            'hcaptcha',
            'captcha',
            'verify you are human',
            'verify you are a human',
            'robot check',
            '429 too many requests',
            'access denied',
            'security checkpoint',
          ];

          const sensitivePlatforms = [
            'yandex.com',
            'yandex.ru',
            'login.microsoftonline.com',
            'zoom.us',
          ];

          for (const indicator of antiBotIndicators) {
            if (lower.includes(indicator)) {
              raiseCheckpoint(`Security checkpoint detected: "${indicator}"`);
              break;
            }
          }

          if (!checkpointDetected) {
            const currentUrl = String(this.page.url?.() ?? '').toLowerCase();
            for (const platform of sensitivePlatforms) {
              if (currentUrl.includes(platform)) {
                raiseCheckpoint(`OSINT Policy Violation: Target-specific exploit scripts are strictly declined for "${platform}"`);
                break;
              }
            }
          }
        } catch {
          // Ignore polling errors while pages are navigating or closing.
        }
      }, WATCHDOG_INTERVAL_MS);
      watchdogInterval.unref?.();
    };

    try {
      await runGuarded('stagehand.init', INIT_TIMEOUT_MS, async () => {
        const isHeadless = this.session.mode === 'isolated';
        const persistentProfile = this.session.mode === 'local'
          ? resolvePersistentBrowserOperatorProfile()
          : undefined;
        if (persistentProfile) {
          this.profileLock = acquirePersistentBrowserOperatorProfileLock(persistentProfile);
        }
        const stagehandEnvironment = this.session.mode === 'local'
          ? 'LOCAL'
          : process.env.BROWSERBASE_API_KEY ? 'BROWSERBASE' : 'LOCAL';
        const { Stagehand } = await import('@browserbasehq/stagehand');
        this.stagehand = new Stagehand({
          env: stagehandEnvironment,
          apiKey: process.env.BROWSERBASE_API_KEY,
          projectId: process.env.BROWSERBASE_PROJECT_ID,
          verbose: 1,
          localBrowserLaunchOptions: {
            headless: isHeadless,
            ...(persistentProfile
              ? {
                  userDataDir: persistentProfile,
                  preserveUserDataDir: true,
                }
              : {}),
          },
        }) as unknown as StagehandInstance;
        await this.stagehand.init();
        this.page = this.resolveActivePage();
      });

      if (!this.page) {
        throw new Error('Stagehand did not expose a browser page instance.');
      }

      await runGuarded('navigation guard init', INIT_TIMEOUT_MS, () => this.installNavigationGuard());
      if (!this.isStopped) {
        await this.assertNavigationBoundary();
      }

      startWatchdog();

      for (const entry of this.session.actionLog) {
        if (checkpointDetected) {
          throw new SecurityCheckpointDetected(checkpointReason);
        }

        if (this.isStopped) {
          entry.status = 'stopped';
          entry.evidence = 'Session stopped by operator request.';
          this.emitAction(entry);
          continue;
        }

        const action = normalizeAction(entry);
        if (!BROWSER_ACTIONS.has(action)) {
          entry.status = 'completed';
          entry.evidence = `Skipped non-browser step (${entry.tool}${entry.action ? `.${entry.action}` : ''}); execute it with its dedicated tool.`;
          this.emitAction(entry);
          continue;
        }

        if (action.includes('/')) {
          entry.status = 'blocked';
          entry.evidence = `Composite placeholder "${action}" needs a concrete observed ref, selector, or instruction.`;
          this.isStopped = true;
          this.emitAction(entry);
          continue;
        }

        let semanticPreflight: BrowserOperatorSemanticPreflight;
        try {
          semanticPreflight = await runGuarded(
            'browser semantic preflight',
            ACTION_TIMEOUT_MS,
            () => this.semanticPreflight(entry, action),
          );
        } catch (error) {
          if (error instanceof SecurityCheckpointDetected || error instanceof BrowserOperatorStopped) {
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          entry.status = 'blocked';
          entry.evidence = `Failed: ${message}`;
          this.isStopped = true;
          this.emitAction(entry);
          continue;
        }
        this.semanticTargetSelectors.set(entry.id, semanticPreflight.resolvedSelectors);

        if (requiresStepConfirmation(entry, action)) {
          const confirmationService = ConfirmationService.getInstance();
          const result = await confirmationService.requestConfirmation({
            operation: 'browser_write',
            filename: action,
            content: buildConfirmationMessage(entry, action),
            // Browser interactions can have effects outside the workspace.
            // Cowork auto-approves ordinary embedded file/bash work, so this
            // one-shot gate must explicitly bypass every permissive shortcut.
            forcePrompt: true,
          });

          if (!result.confirmed) {
            this.isStopped = true;
            entry.status = 'stopped';
            entry.evidence = 'Consent denied by operator.';
            this.emitAction(entry);
            throw new Error('BrowserOperatorConsentDenied: Execution stopped by user.');
          }
        }

        if (MUTATING_ACTIONS.has(action)) {
          try {
            semanticPreflight = await runGuarded(
              'fresh browser semantic preflight',
              ACTION_TIMEOUT_MS,
              () => this.semanticPreflight(entry, action),
            );
            this.semanticTargetSelectors.set(entry.id, semanticPreflight.resolvedSelectors);
          } catch (error) {
            if (error instanceof SecurityCheckpointDetected || error instanceof BrowserOperatorStopped) {
              throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            entry.status = 'blocked';
            entry.evidence = `Failed: ${message}`;
            this.isStopped = true;
            this.emitAction(entry);
            continue;
          }
        }

        entry.status = 'running';
        this.emitAction(entry);
        logger.info(`BrowserOperatorExecutor: Running action ${entry.sequence}: ${entry.title}`);

        try {
          await this.assertNavigationBoundary();
          const result = await this.executeBrowserAction(entry, action, workspaceRoot, runGuarded);
          await this.assertNavigationBoundary();
          entry.status = 'completed';
          entry.evidence = `${result.evidence}\n[Semantic preflight: ${semanticPreflight.risk}${semanticPreflight.targetInspected ? ', target inspected locally' : ''}]`;
        } catch (err) {
          let actionError = err;
          try {
            await this.assertNavigationBoundary();
          } catch (navigationError) {
            actionError = navigationError;
          }

          if (actionError instanceof SecurityCheckpointDetected) {
            entry.status = 'blocked';
            entry.evidence = actionError.message;
            this.emitAction(entry);
            throw actionError;
          }

          if (actionError instanceof BrowserOperatorStopped) {
            entry.status = 'stopped';
            entry.evidence = actionError.message;
            this.isStopped = true;
            this.emitAction(entry);
            continue;
          }

          const message = actionError instanceof Error ? actionError.message : String(actionError);
          entry.status = 'blocked';
          entry.evidence = `Failed: ${message}`;
          logger.error('BrowserOperatorExecutor: Action failed', actionError as Error);
          this.isStopped = true;
        }

        if (entry.evidence) {
          for (const condition of this.session.stopControl.stopConditions) {
            if (entry.evidence.toLowerCase().includes(condition.toLowerCase())) {
              logger.warn(`BrowserOperatorExecutor: Stop condition met: "${condition}"`);
              this.isStopped = true;
              entry.status = 'stopped';
              entry.evidence += `\n[Stopped: Stop condition "${condition}" matched]`;
              break;
            }
          }
        }
        this.emitAction(entry);
      }

      if (!this.isStopped) {
        await this.assertNavigationBoundary();
      }
    } catch (error) {
      if (!(error instanceof BrowserOperatorStopped)) throw error;
      this.isStopped = true;
      for (const entry of this.session.actionLog) {
        if (entry.status === 'planned' || entry.status === 'running') {
          entry.status = 'stopped';
          entry.evidence = error.message;
          this.emitAction(entry);
        }
      }
    } finally {
      if (watchdogInterval) {
        clearInterval(watchdogInterval);
      }
      try {
        await this.stagehand?.close();
      } catch {
        // Ignore close failures.
      } finally {
        // Keep request interception active until the owned browser has stopped;
        // otherwise a delayed meta-refresh could slip through the teardown gap.
        await this.uninstallNavigationGuard();
        try {
          this.profileLock?.release();
        } catch (error) {
          logger.error('BrowserOperatorExecutor: failed to release the persistent browser profile lock', error as Error);
        } finally {
          this.profileLock = null;
        }
      }
    }

    const proofFileName = `${this.session.sessionId}.browser-operator.json`;
    const success = !this.isStopped && this.session.actionLog.every((entry) => entry.status === 'completed');
    const stopped = this.isStopped;
    const generatedAt = new Date().toISOString();
    const redactedSession = redactSessionForProof(this.session);
    const harness = buildBrowserOperatorHarnessBundle({
      session: redactedSession,
      artifactRef: proofFileName,
      success,
      stopped,
      createdAt: Date.parse(generatedAt),
    });

    const proofArtifact = {
      sessionId: redactedSession.sessionId,
      generatedAt,
      goal: redactedSession.goal,
      mode: redactedSession.mode,
      engine: 'stagehand-browser-pilot',
      capabilities: [
        'navigation',
        'semantic-actions',
        'llm-element-identification',
        'deterministic-selectors',
        'keyboard-mouse',
        'forms',
        'screenshots',
        'dom-extraction',
        'assertions',
        'storage',
        'cookies',
        'tabs',
        'downloads',
        'uploads',
        'watchdog',
      ],
      consent: redactedSession.consent,
      actionLog: redactedSession.actionLog,
      success,
      stopped,
      harness,
    };

    const artifactDirectory = ensureSafeArtifactDirectory(workspaceRoot, this.session.sessionId);
    const proofPath = nextAvailableArtifactPath(path.join(artifactDirectory, proofFileName));
    writePrivateArtifact(proofPath, JSON.stringify(proofArtifact, null, 2));

    logger.info(`BrowserOperatorExecutor: Execution complete. Proof written to ${proofFileName}`);
    this.emit({
      type: 'completed',
      sessionId: this.session.sessionId,
      success: proofArtifact.success,
      stopped: proofArtifact.stopped,
    });

    return {
      success: proofArtifact.success,
      stopped: proofArtifact.stopped,
      actionLog: this.session.actionLog,
      proofPath,
    };
  }

  private async executeBrowserAction(
    entry: BrowserOperatorActionLogEntry,
    action: string,
    cwd: string,
    runGuarded: <T>(label: string, timeoutMs: number, operation: () => Promise<T>) => Promise<T>,
  ): Promise<BrowserActionResult> {
    const page = this.requirePage();
    const inputs = entry.inputs ?? {};
    const timeoutMs = getTimeout(inputs, timeoutForAction(action));

    switch (action) {
      case 'navigate': {
        const requestedUrl = getString(inputs.url) || this.session.query;
        if (!requestedUrl) throw new Error('navigate requires inputs.url or session.query');
        const url = await this.guardNavigationUrl(requestedUrl);
        await runGuarded('page.goto', NAVIGATION_TIMEOUT_MS, () => page.goto(url, {
          waitUntil: getString(inputs.waitUntil) || 'domcontentloaded',
          timeout: getTimeout(inputs, NAVIGATION_TIMEOUT_MS),
          timeoutMs: getTimeout(inputs, NAVIGATION_TIMEOUT_MS),
        }));
        return { evidence: `Successfully navigated to ${url}` };
      }

      case 'go_back':
        await runGuarded('page.goBack', timeoutMs, () => page.goBack?.() ?? Promise.resolve());
        return { evidence: 'Navigated back' };

      case 'go_forward':
        await runGuarded('page.goForward', timeoutMs, () => page.goForward?.() ?? Promise.resolve());
        return { evidence: 'Navigated forward' };

      case 'reload':
        await runGuarded('page.reload', timeoutMs, () => page.reload?.({ timeout: timeoutMs }) ?? Promise.resolve());
        return { evidence: 'Page reloaded' };

      case 'observe': {
        const observed = await runGuarded('browser.observe', timeoutMs, () => this.observePage(inputs));
        return { evidence: `Observation snapshot\n${formatStructured(observed)}` };
      }

      case 'extract': {
        const extracted = await runGuarded('browser.extract', EXTRACT_TIMEOUT_MS, () => this.extractPage(inputs));
        return { evidence: `Extracted page state\n${formatStructured(extracted)}` };
      }

      case 'identify_element':
      case 'resolve_element': {
        const target = getElementIntent(entry, action);
        if (!target) throw new Error(`${action} requires target, instruction, text, label, or title`);
        const element = await runGuarded('browser.identify_element', EXTRACT_TIMEOUT_MS, () => this.identifyElement(target, inputs));
        return { evidence: `Identified element: ${element.selector}\n${formatStructured(element)}` };
      }

      case 'assert_text': {
        const expected = getString(inputs.expectedText) || getString(inputs.text) || getString(inputs.query);
        if (!expected) throw new Error('assert_text requires expectedText, text, or query');
        const text = await runGuarded('browser.assert_text', timeoutMs, () => this.getVisibleText());
        if (!text.toLowerCase().includes(expected.toLowerCase())) {
          throw new Error(`Expected text not found: ${expected}`);
        }
        return { evidence: `Assertion passed: page contains "${expected}"` };
      }

      case 'act':
        return {
          evidence: await runGuarded('page.act', timeoutMs, () => this.executeBoundSemanticAct(entry)),
        };

      case 'click':
      case 'double_click':
      case 'right_click':
        return {
          evidence: await runGuarded(`browser.${action}`, timeoutMs, () => this.clickLike(action, entry)),
        };

      case 'type':
        return {
          evidence: await runGuarded('browser.type', timeoutMs, () => this.typeText(entry)),
        };

      case 'fill':
        return {
          evidence: await runGuarded('browser.fill', timeoutMs, () => this.fillFields(entry)),
        };

      case 'select':
        return {
          evidence: await runGuarded('browser.select', timeoutMs, () => this.selectOption(entry)),
        };

      case 'press': {
        const key = getString(inputs.key);
        if (!key) throw new Error('press requires inputs.key');
        await runGuarded('page.keyboard.press', timeoutMs, () => {
          const inspectedSelector = this.semanticSelector(entry);
          const locator = inspectedSelector ? page.locator?.(inspectedSelector) : undefined;
          if (locator?.press) return locator.press(key);
          if (page.keyboard?.press) return page.keyboard.press(key);
          if (page.keyPress) return page.keyPress(key);
          throw new Error('No deterministic key press API is available for the locally inspected target.');
        });
        return { evidence: `Pressed ${key}` };
      }

      case 'hover':
        return {
          evidence: await runGuarded('browser.hover', timeoutMs, () => this.hover(entry)),
        };

      case 'scroll':
        return {
          evidence: await runGuarded('browser.scroll', timeoutMs, () => this.scroll(inputs)),
        };

      case 'evaluate': {
        const expression = getString(inputs.expression) || getString(inputs.script);
        if (!expression) throw new Error('evaluate requires inputs.expression');
        const result = await runGuarded('page.evaluate', timeoutMs, () => page.evaluate(expression, inputs.args));
        return { evidence: `Evaluation result: ${formatStructured(result)}` };
      }

      case 'get_content': {
        const content = await runGuarded('page.content', timeoutMs, () => this.getPageContent());
        return { evidence: truncate(String(content), 8_000) };
      }

      case 'get_text': {
        const text = await runGuarded('page.text', timeoutMs, () => this.getVisibleText());
        return { evidence: truncate(text, 8_000) };
      }

      case 'get_url':
        return { evidence: String(page.url?.() ?? '') };

      case 'get_title': {
        const title = await runGuarded('page.title', timeoutMs, () => page.title?.() ?? Promise.resolve(''));
        return { evidence: String(title) };
      }

      case 'screenshot': {
        const artifactPath = await runGuarded('page.screenshot', timeoutMs, () => this.takeScreenshot(entry, cwd));
        return { evidence: `Screenshot saved: ${artifactPath}`, artifactPath };
      }

      case 'wait':
        await runGuarded('page.waitForTimeout', timeoutMs, () => page.waitForTimeout?.(getNumber(inputs.ms) ?? getNumber(inputs.timeout) ?? 1_000) ?? Promise.resolve());
        return { evidence: 'Wait completed' };

      case 'wait_for_selector': {
        const selector = getString(inputs.selector);
        if (!selector) throw new Error('wait_for_selector requires inputs.selector');
        await runGuarded('page.waitForSelector', timeoutMs, () => page.waitForSelector(selector, { timeout: timeoutMs }));
        return { evidence: `Selector appeared: ${selector}` };
      }

      case 'wait_for_navigation':
        await runGuarded('page.waitForURL', timeoutMs, () => {
          if (page.waitForURL) return page.waitForURL('**', { timeout: timeoutMs });
          if (page.waitForLoadState) return page.waitForLoadState('domcontentloaded', timeoutMs);
          return Promise.resolve();
        });
        return { evidence: 'Navigation completed' };

      case 'get_cookies': {
        const cookies = await runGuarded('context.cookies', timeoutMs, () => this.context().cookies?.() ?? Promise.resolve([]));
        return { evidence: `Cookies: ${formatStructured(cookies)}` };
      }

      case 'set_cookie':
        await runGuarded('context.addCookies', timeoutMs, () => this.context().addCookies?.([buildCookie(inputs)]) ?? Promise.resolve());
        return { evidence: `Cookie set: ${getString(inputs.cookieName) || getString(inputs.name)}` };

      case 'clear_cookies':
        await runGuarded('context.clearCookies', timeoutMs, () => this.context().clearCookies?.() ?? Promise.resolve());
        return { evidence: 'Cookies cleared' };

      case 'get_local_storage':
        return { evidence: `localStorage: ${formatStructured(await runGuarded('localStorage', timeoutMs, () => this.getStorage('localStorage')))}` };

      case 'set_local_storage':
        await runGuarded('set localStorage', timeoutMs, () => this.setStorage('localStorage', getRecord(inputs.storageData)));
        return { evidence: `Set ${Object.keys(getRecord(inputs.storageData)).length} localStorage entries` };

      case 'get_session_storage':
        return { evidence: `sessionStorage: ${formatStructured(await runGuarded('sessionStorage', timeoutMs, () => this.getStorage('sessionStorage')))}` };

      case 'set_session_storage':
        await runGuarded('set sessionStorage', timeoutMs, () => this.setStorage('sessionStorage', getRecord(inputs.storageData)));
        return { evidence: `Set ${Object.keys(getRecord(inputs.storageData)).length} sessionStorage entries` };

      case 'upload_files':
        return {
          evidence: await runGuarded('upload files', timeoutMs, () => this.uploadFiles(entry, cwd)),
        };

      case 'download':
        return {
          evidence: await runGuarded('download', timeoutMs, () => this.download(entry, cwd)),
        };

      case 'tabs':
        return { evidence: `Tabs: ${formatStructured(await this.listTabs())}` };

      case 'new_tab': {
        const requestedUrl = getString(inputs.url);
        const url = requestedUrl ? await this.guardNavigationUrl(requestedUrl) : undefined;
        const tab = await runGuarded('new tab', timeoutMs, () => this.newTab(url));
        return { evidence: `New tab opened: ${formatStructured(tab)}` };
      }

      case 'focus_tab':
        await runGuarded('focus tab', timeoutMs, () => this.focusTab(inputs));
        return { evidence: 'Focused tab' };

      case 'close_tab':
        await runGuarded('close tab', timeoutMs, () => this.closeTab(inputs));
        return { evidence: 'Closed tab' };

      default:
        throw new Error(`Unsupported browser action: ${action}`);
    }
  }

  private requirePage(): StagehandPage {
    this.page ??= this.resolveActivePage();
    if (!this.page) {
      throw new Error('Browser page is not initialized.');
    }
    return this.page;
  }

  private semanticSelector(entry: BrowserOperatorActionLogEntry, index = 0): string {
    return this.semanticTargetSelectors.get(entry.id)?.[index] ?? '';
  }

  private async executeBoundSemanticAct(entry: BrowserOperatorActionLogEntry): Promise<string> {
    const page = this.requirePage();
    const inputs = entry.inputs ?? {};
    const instruction = getString(inputs.instruction) || getString(inputs.text) || entry.title;
    const selector = this.semanticSelector(entry);
    if (!selector) {
      throw new Error('BrowserOperatorTargetInspectionRequired: semantic act has no locally bound target selector.');
    }
    const locator = page.locator?.(selector);
    if (/(?:\bclick\b|\bopen\b|\bchoose\b|\bcontinue\b|cliquer|ouvrir|choisir|continuer)/i.test(instruction)) {
      if (locator?.click) {
        await locator.click({ button: 'left', clickCount: 1 });
      } else if (page.click) {
        await page.click(selector, { button: 'left', clickCount: 1 });
      } else {
        throw new Error('No deterministic click API is available for the locally inspected semantic target.');
      }
      return `Performed locally bound semantic click on ${selector}`;
    }
    const value = getString(inputs.value) || (inputs.instruction ? getString(inputs.text) : '');
    if (value && /(?:\btype\b|\bfill\b|\benter\b|saisir|remplir)/i.test(instruction)) {
      if (locator?.fill) {
        await locator.fill(value);
      } else if (page.fill) {
        await page.fill(selector, value);
      } else {
        throw new Error('No deterministic fill API is available for the locally inspected semantic target.');
      }
      return `Performed locally bound semantic fill on ${selector}`;
    }
    throw new Error('BrowserOperatorSemanticActBlocked: semantic instruction cannot be bound to a deterministic local interaction. Use click, fill, type, select, or press explicitly.');
  }

  private async semanticPreflight(
    entry: BrowserOperatorActionLogEntry,
    action: string,
  ): Promise<BrowserOperatorSemanticPreflight> {
    if (!MUTATING_ACTIONS.has(action)) {
      return { risk: 'read', targetInspected: false, reasons: [], resolvedSelectors: [] };
    }

    const page = this.requirePage();
    const targetInspectionRequired = TARGET_INSPECTION_ACTIONS.has(action);
    let inspection: BrowserOperatorTargetInspection | null = null;
    if (targetInspectionRequired) {
      if (typeof page.evaluate !== 'function') {
        throw new Error('BrowserOperatorTargetInspectionRequired: mutating action blocked because local DOM inspection is unavailable.');
      }
      const request = buildSemanticInspectionRequest(entry, action);
      let rawInspection: unknown;
      try {
        rawInspection = await page.evaluate((input: {
          selectorGroups: string[][];
          intent: string;
          useActiveElement: boolean;
          allowIntentFallback: boolean;
        }) => {
          const bound = (value: unknown, max = 600) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
          const isInspectableTarget = (element: Element | null): element is Element => Boolean(
            element && !['HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE'].includes(element.tagName),
          );
          const targetText = (element: Element) => {
            const html = element as HTMLElement;
            return bound(html.innerText || element.textContent || '', 300);
          };
          const selectorFor = (element: Element): string => {
            const escape = (value: string) => {
              const css = (globalThis as typeof globalThis & { CSS?: { escape?: (input: string) => string } }).CSS;
              return css?.escape ? css.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
            };
            const id = element.getAttribute('id');
            if (id) return `#${escape(id)}`;
            for (const attribute of ['data-testid', 'data-test-id', 'data-test']) {
              const value = element.getAttribute(attribute);
              if (value) return `[${attribute}="${value.replace(/"/g, '\\"')}"]`;
            }
            const name = element.getAttribute('name');
            if (name) return `${element.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;
            const aria = element.getAttribute('aria-label');
            if (aria) return `${element.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, '\\"')}"]`;
            const parent = element.parentElement;
            if (!parent) return element.tagName.toLowerCase();
            const peers = Array.from(parent.children).filter((candidate) => candidate.tagName === element.tagName);
            return `${selectorFor(parent)} > ${element.tagName.toLowerCase()}:nth-of-type(${Math.max(1, peers.indexOf(element) + 1)})`;
          };
          const labelsFor = (element: Element): string => {
            const labels: string[] = [];
            const control = element as HTMLInputElement;
            if (control.labels) {
              labels.push(...Array.from(control.labels).map((label) => targetText(label)));
            }
            const wrappingLabel = element.closest('label');
            if (wrappingLabel) labels.push(targetText(wrappingLabel));
            const labelledBy = element.getAttribute('aria-labelledby') || '';
            for (const id of labelledBy.split(/\s+/).filter(Boolean)) {
              const label = document.getElementById(id);
              if (label) labels.push(targetText(label));
            }
            return bound([...new Set(labels.filter(Boolean))].join(' | '), 500);
          };
          const describe = (element: Element): BrowserOperatorTargetContext => {
            const html = element as HTMLElement;
            const form = element.closest('form') as HTMLFormElement | null;
            const neighborhoodRoot = element.closest('[role="dialog"],dialog,form,fieldset,section,article,li')
              || element.parentElement;
            return {
              text: targetText(element),
              ariaLabel: bound(element.getAttribute('aria-label'), 300),
              labels: labelsFor(element),
              neighborhood: bound((neighborhoodRoot as HTMLElement | null)?.innerText || neighborhoodRoot?.textContent, 800),
              formAction: bound(form?.getAttribute('action') || form?.action, 500),
              formText: bound(form?.innerText || form?.textContent, 800),
              role: bound(element.getAttribute('role') || html.tagName, 80),
              inputType: bound(element.getAttribute('type'), 80),
              name: bound(element.getAttribute('name') || element.id, 200),
              href: bound(element.getAttribute('href') || (element as HTMLAnchorElement).href, 500),
            };
          };
          const candidates = () => Array.from(document.querySelectorAll(
            'button,a[href],input,textarea,select,[role="button"],[role="menuitem"],[contenteditable="true"]',
          )).filter(isInspectableTarget);
          const findByIntent = (intent: string): Element | null => {
            const normalized = bound(intent, 500).toLowerCase();
            const tokens = normalized.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2);
            let best: { element: Element; score: number } | null = null;
            for (const element of candidates()) {
              const context = describe(element);
              const haystack = `${context.text} ${context.ariaLabel} ${context.labels} ${context.name} ${context.role}`.toLowerCase();
              const score = (normalized && haystack.includes(normalized) ? 20 : 0)
                + tokens.filter((token) => haystack.includes(token)).length * 3;
              if (score > 0 && (!best || score > best.score)) best = { element, score };
            }
            return best?.element ?? null;
          };

          try {
            const targets: Element[] = [];
            for (const group of input.selectorGroups) {
              const target = group.map((selector) => document.querySelector(selector)).find(isInspectableTarget) ?? null;
              if (target) targets.push(target);
            }
            if (input.useActiveElement && isInspectableTarget(document.activeElement)) {
              targets.push(document.activeElement);
            }
            if (
              targets.length === 0
              && (input.selectorGroups.length === 0 || input.allowIntentFallback && input.selectorGroups.length === 1)
              && input.intent
            ) {
              const intentTarget = findByIntent(input.intent);
              if (intentTarget) targets.push(intentTarget);
            }
            const expectedTargets = input.selectorGroups.length > 0 ? input.selectorGroups.length : 1;
            const uniqueTargets = [...new Set(targets)];
            return {
              inspected: true as const,
              targetFound: uniqueTargets.length >= expectedTargets,
              url: bound(location.href, 1_000),
              documentTitle: bound(document.title, 300),
              contexts: uniqueTargets.slice(0, 12).map(describe),
              resolvedSelectors: uniqueTargets.slice(0, 12).map(selectorFor),
            };
          } catch (error) {
            return {
              inspected: true as const,
              targetFound: false,
              url: bound(location.href, 1_000),
              documentTitle: bound(document.title, 300),
              contexts: [],
              resolvedSelectors: [],
              error: error instanceof Error ? bound(error.message, 300) : 'target inspection failed',
            };
          }
        }, request);
      } catch (error) {
        throw new Error(`BrowserOperatorTargetInspectionRequired: mutating action blocked because local target inspection failed (${error instanceof Error ? error.message : String(error)}).`);
      }
      inspection = normalizeTargetInspection(rawInspection);
      if (
        !inspection
        || !inspection.targetFound
        || inspection.contexts.length === 0
        || inspection.resolvedSelectors.length === 0
      ) {
        const detail = inspection?.error ? ` (${inspection.error})` : '';
        throw new Error(`BrowserOperatorTargetInspectionRequired: mutating action blocked because its exact local target could not be inspected${detail}.`);
      }
    }

    const currentUrl = typeof page.url === 'function' ? String(page.url() ?? '') : '';
    const semanticContext = [
      action,
      entry.title,
      entry.reason,
      semanticInputDescription(entry, action),
      currentUrl,
      inspection?.url,
      inspection?.documentTitle,
      ...(inspection?.contexts.flatMap((context) => [
        context.text,
        context.ariaLabel,
        context.labels,
        context.neighborhood,
        context.formAction,
        context.formText,
        context.role,
        context.inputType,
        context.name,
        context.href,
      ]) ?? []),
    ].filter(Boolean).join('\n');
    const reasons = SENSITIVE_SEMANTIC_SIGNALS
      .filter(({ pattern }) => pattern.test(semanticContext))
      .map(({ reason }) => reason);
    if (reasons.length > 0) {
      throw new Error(
        `BrowserOperatorSensitiveEffectBlocked: semantic preflight detected ${[...new Set(reasons)].join(', ')}. Generic browser confirmation never authorizes this effect; a dedicated effect-specific approval receipt is required and is not available.`,
      );
    }

    return {
      risk: 'low',
      targetInspected: targetInspectionRequired,
      reasons: [],
      resolvedSelectors: inspection?.resolvedSelectors ?? [],
    };
  }

  private async guardNavigationUrl(rawUrl: string): Promise<string> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error('Navigation blocked: invalid URL.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Navigation blocked: only credential-free HTTP(S) URLs are allowed.');
    }

    let check: { safe: boolean; reason?: string };
    if (this.options.urlGuard) {
      try {
        check = await this.options.urlGuard(url.toString());
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Navigation blocked: URL guard failed (${reason}).`);
      }
    } else {
      try {
        const { isDevOriginAllowed } = await import('../security/dev-origins.js');
        if (isDevOriginAllowed(url.toString())) return url.toString();
        const { assertSafeUrl } = await import('../security/ssrf-guard.js');
        check = await assertSafeUrl(url.toString());
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Navigation blocked: URL guard unavailable (${reason}).`);
      }
    }

    if (!check.safe) {
      throw new Error(`Navigation blocked: ${check.reason || 'URL not allowed'}`);
    }
    return url.toString();
  }

  /**
   * Install a browser-context request gate before the first planned action.
   * Context-level routing is important here: it covers redirect hops and pages
   * opened by a click/semantic action, not only explicit page.goto calls.
   */
  private async installNavigationGuard(): Promise<void> {
    if (this.navigationRouteHandler) return;

    this.navigationRouteHandler = async (route, request) => {
      const check = this.handleNavigationRoute(route, request);
      this.pendingNavigationChecks.add(check);
      try {
        await check;
      } finally {
        this.pendingNavigationChecks.delete(check);
      }
    };

    const routeTargets: NavigationRouteTarget[] = [];
    const page = this.requirePage();
    const stagehandContext = this.stagehand?.context;
    if (isNavigationRouteTarget(stagehandContext)) {
      routeTargets.push(stagehandContext);
    }

    let pageContext: unknown;
    try {
      pageContext = typeof page.context === 'function' ? page.context() : undefined;
    } catch {
      pageContext = undefined;
    }
    if (isNavigationRouteTarget(pageContext) && !routeTargets.includes(pageContext)) {
      routeTargets.push(pageContext);
    }

    if (routeTargets.length === 0) {
      const connectUrl = this.stagehand?.connectURL?.();
      if (connectUrl) {
        const { chromium } = await import('playwright-core');
        this.navigationGuardBrowser = await chromium.connectOverCDP(connectUrl, {
          timeout: INIT_TIMEOUT_MS,
        }) as unknown as NavigationGuardBrowser;
        routeTargets.push(...this.navigationGuardBrowser.contexts());
      }
    }

    if (routeTargets.length === 0) {
      // urlGuard is explicitly documented as a deterministic test injection.
      // Legacy test doubles do not expose network routing; production Stagehand
      // exposes connectURL(), so a real runtime without interception fails closed.
      if (this.options.urlGuard) {
        logger.warn('BrowserOperatorExecutor: navigation request interception unavailable on injected test backend; retaining post-action URL verification.');
        return;
      }
      this.navigationRouteHandler = null;
      throw new Error('Navigation blocked: browser request interception is unavailable.');
    }

    for (const target of routeTargets) {
      await target.route(this.navigationRoutePattern, this.navigationRouteHandler);
      this.navigationRouteTargets.push(target);
    }
  }

  private async uninstallNavigationGuard(): Promise<void> {
    const handler = this.navigationRouteHandler;
    this.navigationRouteHandler = null;
    if (!handler) return;

    const targets = this.navigationRouteTargets.splice(0);
    await Promise.allSettled(targets.map(async (target) => {
      await target.unroute?.(this.navigationRoutePattern, handler);
    }));
    this.navigationGuardBrowser = null;
    this.pendingNavigationChecks.clear();
  }

  private async handleNavigationRoute(
    route: NavigationRouteLike,
    requestArgument?: NavigationRequestLike,
  ): Promise<void> {
    const request = requestArgument ?? route.request?.();
    if (!request) {
      this.recordNavigationViolation(new Error('Navigation blocked: intercepted request metadata is unavailable.'));
      await abortNavigationRoute(route);
      return;
    }

    let isNavigationRequest: boolean;
    try {
      isNavigationRequest = typeof request.isNavigationRequest === 'function'
        ? request.isNavigationRequest()
        : request.resourceType?.() === 'document';
    } catch {
      this.recordNavigationViolation(new Error('Navigation blocked: intercepted request type is unavailable.'));
      await abortNavigationRoute(route);
      return;
    }

    if (!isNavigationRequest) {
      await continueNavigationRoute(route);
      return;
    }

    let requestedUrl = '';
    try {
      requestedUrl = request.url?.() ?? '';
      if (!requestedUrl) {
        throw new Error('empty intercepted URL');
      }
      await this.guardNavigationUrl(requestedUrl);
    } catch (error) {
      this.recordNavigationViolation(normalizeNavigationError(error));
      await abortNavigationRoute(route);
      return;
    }

    try {
      await continueNavigationRoute(route);
    } catch (error) {
      if (!this.isStopped) {
        logger.warn(`BrowserOperatorExecutor: failed to continue a guarded navigation request: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Await in-flight route decisions and validate every visible top-level URL.
   * This second boundary catches custom Stagehand actions whose navigation may
   * be abstracted away from the active page object.
   */
  private async assertNavigationBoundary(): Promise<void> {
    while (this.pendingNavigationChecks.size > 0) {
      await Promise.allSettled([...this.pendingNavigationChecks]);
    }
    if (this.navigationViolation) throw this.navigationViolation;

    for (const browserPage of this.navigationPages()) {
      if (typeof browserPage.url !== 'function') continue;
      let currentUrl: string;
      try {
        currentUrl = String(browserPage.url() ?? '').trim();
      } catch (error) {
        this.recordNavigationViolation(new Error(`Navigation blocked: current page URL is unavailable (${error instanceof Error ? error.message : String(error)}).`));
        break;
      }
      if (!currentUrl || currentUrl === 'about:blank' || currentUrl.startsWith('about:blank#')) continue;
      try {
        await this.guardNavigationUrl(currentUrl);
      } catch (error) {
        this.recordNavigationViolation(normalizeNavigationError(error));
        break;
      }
    }

    if (this.navigationViolation) throw this.navigationViolation;
  }

  private navigationPages(): StagehandPage[] {
    const pages: StagehandPage[] = [];
    const append = (candidate: unknown) => {
      if (candidate && typeof candidate === 'object' && !pages.includes(candidate as StagehandPage)) {
        pages.push(candidate as StagehandPage);
      }
    };

    append(this.page);
    try {
      const contextPages = this.stagehand?.context?.pages?.();
      if (Array.isArray(contextPages)) contextPages.forEach(append);
    } catch {
      // The active page still provides a final-URL boundary.
    }
    try {
      for (const context of this.navigationGuardBrowser?.contexts() ?? []) {
        const contextPages = context.pages?.();
        if (Array.isArray(contextPages)) contextPages.forEach(append);
      }
    } catch {
      // The request route remains the primary pre-navigation boundary.
    }
    return pages;
  }

  private recordNavigationViolation(error: Error): void {
    if (!this.navigationViolation) {
      this.navigationViolation = error;
      logger.error(`BrowserOperatorExecutor: ${error.message}`);
    }
    this.isStopped = true;
    for (const listener of this.stopListeners) listener();
    this.stopListeners.clear();
  }

  private emitAction(action: BrowserOperatorActionLogEntry): void {
    this.emit({
      type: 'action',
      sessionId: this.session.sessionId,
      action: redactActionLogEntry(action),
    });
  }

  private emit(event: BrowserOperatorExecutorEvent): void {
    try {
      this.options.onEvent?.(event);
    } catch {
      // Observability callbacks must never alter execution semantics.
    }
  }

  private context(): StagehandContext {
    if (this.stagehand?.context) {
      return this.stagehand.context;
    }
    const page = this.requirePage();
    const context = page.context?.();
    if (!context) {
      throw new Error('Browser context is not available.');
    }
    return context;
  }

  private resolveActivePage(): StagehandPage | null {
    if (this.stagehand?.page) {
      return this.stagehand.page;
    }

    const context = this.stagehand?.context;
    if (!context) {
      return null;
    }

    return context.activePage?.() ?? context.pages?.()[0] ?? null;
  }

  private async clickLike(action: string, entry: BrowserOperatorActionLogEntry): Promise<string> {
    const page = this.requirePage();
    const inputs = entry.inputs ?? {};
    const selector = getString(inputs.selector);
    const text = getString(inputs.text);
    const target = getElementIntent(entry, action);
    const ref = inputs.ref;
    const button = action === 'right_click' ? 'right' : getString(inputs.button) || 'left';
    const clickCount = action === 'double_click' ? 2 : getNumber(inputs.clickCount) ?? 1;
    let resolved: ResolvedBrowserElement | null = null;
    let effectiveSelector = selector || this.semanticSelector(entry);

    if (!effectiveSelector && target && ref === undefined) {
      resolved = await this.tryIdentifyElement(target, inputs);
      effectiveSelector = resolved?.selector ?? '';
    }

    if (effectiveSelector) {
      const locator = page.locator?.(effectiveSelector);
      if (locator?.click) {
        await locator.click({ button, clickCount });
      } else if (page.click) {
        await page.click(effectiveSelector, { button, clickCount });
      } else {
        throw new Error('No selector click API available on page.');
      }
      return `Clicked selector ${effectiveSelector}${resolved ? ` (${resolved.source}: ${resolved.description})` : ''}`;
    }

    throw new Error(`BrowserOperatorTargetInspectionRequired: no deterministic selector remained for ${text || ref || entry.title}.`);
  }

  private async typeText(entry: BrowserOperatorActionLogEntry): Promise<string> {
    const page = this.requirePage();
    const inputs = entry.inputs ?? {};
    const selector = getString(inputs.selector);
    const target = getElementIntent(entry, 'type');
    const text = getString(inputs.text) || getString(inputs.value);
    if (!text) throw new Error('type requires inputs.text or inputs.value');
    let resolved: ResolvedBrowserElement | null = null;
    let effectiveSelector = selector || this.semanticSelector(entry);

    if (!effectiveSelector && target && inputs.ref === undefined) {
      resolved = await this.tryIdentifyElement(target, inputs);
      effectiveSelector = resolved?.selector ?? '';
    }

    if (effectiveSelector) {
      const locator = page.locator?.(effectiveSelector);
      if (locator?.fill && inputs.clear !== false) {
        await locator.fill(text);
      } else if (locator?.type) {
        await locator.type(text);
      } else if (page.fill && inputs.clear !== false) {
        await page.fill(effectiveSelector, text);
      } else if (page.type) {
        await page.type(effectiveSelector, text);
      } else {
        throw new Error('No selector typing API available on page.');
      }
      return `Typed ${text.length} chars into ${effectiveSelector}${resolved ? ` (${resolved.source}: ${resolved.description})` : ''}`;
    }

    throw new Error(`BrowserOperatorTargetInspectionRequired: no deterministic selector remained for ${getString(inputs.ref) || entry.title}.`);
  }

  private async fillFields(entry: BrowserOperatorActionLogEntry): Promise<string> {
    const inputs = entry.inputs ?? {};
    const fields = getRecord(inputs.fields);
    const selector = getString(inputs.selector);
    const value = getString(inputs.value) || getString(inputs.text);

    if (selector && value) {
      await this.typeText({ ...entry, inputs: { ...inputs, selector, text: value } });
      return `Filled ${selector}`;
    }

    if (Object.keys(fields).length === 0) {
      throw new Error('fill requires inputs.fields, or selector + value');
    }

    let fieldIndex = 0;
    for (const [target, fieldValue] of Object.entries(fields)) {
      const inspectedSelector = this.semanticSelector(entry, fieldIndex++);
      await this.typeText({
        ...entry,
        inputs: isNumeric(target)
          ? inspectedSelector
            ? { ...inputs, selector: inspectedSelector, text: String(fieldValue) }
            : { ...inputs, ref: Number(target), text: String(fieldValue) }
          : { ...inputs, selector: target, text: String(fieldValue) },
      });
    }

    if (inputs.submit === true) {
      await this.requirePage().keyboard?.press?.('Enter');
    }

    return `Filled ${Object.keys(fields).length} field(s)`;
  }

  private async selectOption(entry: BrowserOperatorActionLogEntry): Promise<string> {
    const page = this.requirePage();
    const inputs = entry.inputs ?? {};
    const selector = getString(inputs.selector);
    const value = getString(inputs.value) || getString(inputs.label) || getString(inputs.index);
    if (!value) throw new Error('select requires value, label, or index');
    let resolved: ResolvedBrowserElement | null = null;
    let effectiveSelector = selector || this.semanticSelector(entry);

    if (!effectiveSelector) {
      const target = getElementIntent(entry, 'select');
      if (target) {
        resolved = await this.tryIdentifyElement(target, inputs);
        effectiveSelector = resolved?.selector ?? '';
      }
    }

    if (effectiveSelector) {
      if (page.selectOption) {
        await page.selectOption(effectiveSelector, value);
      } else {
        const locator = page.locator?.(effectiveSelector);
        if (!locator?.selectOption) throw new Error('No select API available on page.');
        await locator.selectOption(value);
      }
      return `Selected ${value} in ${effectiveSelector}${resolved ? ` (${resolved.source}: ${resolved.description})` : ''}`;
    }

    throw new Error(`BrowserOperatorTargetInspectionRequired: no deterministic selector remained for ${entry.title}.`);
  }

  private async hover(entry: BrowserOperatorActionLogEntry): Promise<string> {
    const page = this.requirePage();
    const inputs = entry.inputs ?? {};
    const selector = getString(inputs.selector);
    let resolved: ResolvedBrowserElement | null = null;
    let effectiveSelector = selector || this.semanticSelector(entry);
    if (!effectiveSelector) {
      const target = getElementIntent(entry, 'hover');
      if (target) {
        resolved = await this.tryIdentifyElement(target, inputs);
        effectiveSelector = resolved?.selector ?? '';
      }
    }

    if (effectiveSelector) {
      const locator = page.locator?.(effectiveSelector);
      if (locator?.hover) {
        await locator.hover();
      } else if (page.hover) {
        await page.hover(effectiveSelector);
      } else {
        throw new Error('No hover API available on page.');
      }
      return `Hovered ${effectiveSelector}${resolved ? ` (${resolved.source}: ${resolved.description})` : ''}`;
    }
    throw new Error(`BrowserOperatorTargetInspectionRequired: no deterministic selector remained for ${getString(inputs.text) || getString(inputs.ref) || entry.title}.`);
  }

  private async tryIdentifyElement(target: string, inputs: Record<string, any> = {}): Promise<ResolvedBrowserElement | null> {
    try {
      return await this.identifyElement(target, inputs);
    } catch (error) {
      logger.warn(`BrowserOperatorExecutor: LLM element identification fell back for "${target}": ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async identifyElement(target: string, inputs: Record<string, any> = {}): Promise<ResolvedBrowserElement> {
    const instruction = [
      `Identify the single best visible page element for: ${target}`,
      'Return an action whose selector can be used directly by automation.',
      getString(inputs.scope) ? `Scope: ${getString(inputs.scope)}` : '',
      getString(inputs.role) ? `Preferred role: ${getString(inputs.role)}` : '',
    ].filter(Boolean).join('\n');

    const observed = await this.observeActions(instruction, inputs);
    const ranked = observed
      .map((candidate) => normalizeObservedAction(candidate))
      .filter((candidate): candidate is ResolvedBrowserElement => Boolean(candidate?.selector))
      .sort((a, b) => scoreObservedElement(b, target) - scoreObservedElement(a, target));

    if (ranked[0]) {
      return ranked[0];
    }

    const fallback = await this.findElementByDomHeuristic(target);
    if (fallback) {
      return fallback;
    }

    throw new Error(`Could not identify a page element for: ${target}`);
  }

  private async observeActions(instruction: string, inputs: Record<string, any>): Promise<unknown[]> {
    const page = this.requirePage();
    const selector = getString(inputs.observeSelector) || getString(inputs.scopeSelector);
    const options = {
      instruction,
      ...(selector ? { selector } : {}),
      timeout: getTimeout(inputs, EXTRACT_TIMEOUT_MS),
    };

    if (page.observe) {
      const observed = await page.observe(options);
      return Array.isArray(observed) ? observed : [];
    }

    if (this.stagehand?.observe) {
      const observed = await this.stagehand.observe(instruction, { ...options, page });
      return Array.isArray(observed) ? observed : [];
    }

    return [];
  }

  private async findElementByDomHeuristic(target: string): Promise<ResolvedBrowserElement | null> {
    const page = this.requirePage();
    if (!page.evaluate) {
      return null;
    }

    const match = await page.evaluate((needle: string) => {
      const normalizedNeedle = needle.toLowerCase();
      const take = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();
      const cssEscape = (value: string) => {
        const css = (globalThis as typeof globalThis & { CSS?: { escape?: (input: string) => string } }).CSS;
        if (css?.escape) return css.escape(value);
        return value.replace(/["\\#.:,[\]>+~*'=|^$()\s]/g, '\\$&');
      };
      const selectorFor = (el: Element): string => {
        const id = el.getAttribute('id');
        if (id) return `#${cssEscape(id)}`;
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-test');
        if (testId) return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
        const aria = el.getAttribute('aria-label');
        if (aria) return `${el.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, '\\"')}"]`;
        const name = el.getAttribute('name');
        if (name) return `${el.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;
        const role = el.getAttribute('role');
        if (role) return `${el.tagName.toLowerCase()}[role="${role.replace(/"/g, '\\"')}"]`;
        const parent = el.parentElement;
        if (!parent) return el.tagName.toLowerCase();
        const siblings = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
        const index = siblings.indexOf(el) + 1;
        return `${selectorFor(parent)} > ${el.tagName.toLowerCase()}:nth-of-type(${Math.max(index, 1)})`;
      };

      const candidates = Array.from(document.querySelectorAll('button,[role="button"],a[href],input,textarea,select,[contenteditable="true"]'));
      let best: { selector: string; description: string; score: number } | null = null;
      for (const el of candidates) {
        const htmlEl = el as HTMLElement;
        const description = take([
          el.getAttribute('aria-label'),
          el.getAttribute('placeholder'),
          el.getAttribute('name'),
          el.getAttribute('title'),
          htmlEl.innerText,
          el.textContent,
          el.getAttribute('id'),
        ].filter(Boolean).join(' '));
        const haystack = description.toLowerCase();
        const tokens = normalizedNeedle.split(/\W+/).filter((token) => token.length > 2);
        const tokenHits = tokens.filter((token) => haystack.includes(token)).length;
        const score = (haystack.includes(normalizedNeedle) ? 10 : 0) + tokenHits + (htmlEl.offsetParent ? 1 : 0);
        if (score > 0 && (!best || score > best.score)) {
          best = { selector: selectorFor(el), description, score };
        }
      }
      return best;
    }, target);

    if (!match || typeof match !== 'object') {
      return null;
    }

    const selector = getString((match as Record<string, unknown>).selector);
    if (!selector) {
      return null;
    }

    return {
      selector,
      description: getString((match as Record<string, unknown>).description) || target,
      source: 'dom-heuristic',
    };
  }

  private async scroll(inputs: Record<string, any>): Promise<string> {
    const page = this.requirePage();
    const direction = getString(inputs.direction) || 'down';
    const amount = getNumber(inputs.amount) ?? 600;
    const sign = direction === 'up' || direction === 'left' ? -1 : 1;
    const x = direction === 'left' || direction === 'right' ? sign * amount : 0;
    const y = direction === 'up' || direction === 'down' ? sign * amount : 0;

    if (page.mouse?.wheel) {
      await page.mouse.wheel(x, y);
    } else if (page.evaluate) {
      await page.evaluate(({ left, top }: { left: number; top: number }) => window.scrollBy(left, top), { left: x, top: y });
    } else {
      throw new Error('No scroll API available on page.');
    }

    return `Scrolled ${direction} ${amount}px`;
  }

  private async observePage(inputs: Record<string, any>): Promise<unknown> {
    const page = this.requirePage();
    const instruction = getString(inputs.instruction) || getString(inputs.query) || 'Observe visible page state, blockers, forms, and actions.';
    if (page.observe) {
      return await page.observe({ instruction });
    }
    if (this.stagehand?.observe) {
      return await this.stagehand.observe(instruction);
    }
    return await this.extractDomState();
  }

  private async extractPage(inputs: Record<string, any>): Promise<unknown> {
    const page = this.requirePage();
    const instruction = getString(inputs.instruction) || getString(inputs.query);
    if (instruction && page.extract) {
      const { z } = await import('zod');
      return await page.extract({
        instruction,
        schema: z.object({ result: z.string() }),
      });
    }
    if (instruction && this.stagehand?.extract) {
      const { z } = await import('zod');
      return await this.stagehand.extract(instruction, z.object({ result: z.string() }));
    }
    return await this.extractDomState();
  }

  private async extractDomState(): Promise<unknown> {
    const page = this.requirePage();
    if (!page.evaluate) {
      const content = page.content ? await page.content() : '';
      return { text: String(content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() };
    }

    return await page.evaluate(() => {
      const take = (value: unknown, max = 160) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
      const text = (document.body?.innerText || '').replace(/\s+\n/g, '\n').trim();
      return {
        url: location.href,
        title: document.title,
        headings: Array.from(document.querySelectorAll('h1,h2,h3')).map((el) => take(el.textContent)).filter(Boolean).slice(0, 20),
        actions: Array.from(document.querySelectorAll('button,[role="button"],a[href],input,textarea,select'))
          .map((el) => take(el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || el.id))
          .filter(Boolean)
          .slice(0, 40),
        fields: Array.from(document.querySelectorAll('input,textarea,select'))
          .map((el) => take(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id))
          .filter(Boolean)
          .slice(0, 30),
        links: Array.from(document.querySelectorAll('a[href]'))
          .map((el) => ({ text: take(el.textContent || el.getAttribute('aria-label')), href: (el as HTMLAnchorElement).href }))
          .filter((link) => link.text || link.href)
          .slice(0, 40),
        text: text.slice(0, 12_000),
        textLength: text.length,
      };
    });
  }

  private async getVisibleText(): Promise<string> {
    const page = this.requirePage();
    if (page.evaluate) {
      return String(await page.evaluate(() => document.body?.innerText || ''));
    }
    const content = await this.getPageContent();
    return String(content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private async getPageContent(): Promise<string> {
    const page = this.requirePage();
    if (page.content) {
      return String(await page.content());
    }
    if (page.evaluate) {
      return String(await page.evaluate(() => document.documentElement?.outerHTML || document.body?.innerHTML || ''));
    }
    return '';
  }

  private async takeScreenshot(entry: BrowserOperatorActionLogEntry, cwd: string): Promise<string> {
    const page = this.requirePage();
    if (!page.screenshot) {
      throw new Error('Screenshot API is not available.');
    }
    const inputs = entry.inputs ?? {};
    const artifactDirectory = ensureSafeArtifactDirectory(cwd, this.session.sessionId);
    const artifactPath = resolveArtifactOutputPath(
      artifactDirectory,
      getString(inputs.outputPath),
      `evidence_${safeArtifactName(entry.id)}.png`,
    );
    const buffer = await page.screenshot({
      fullPage: inputs.fullPage === true,
    });
    if (Buffer.isBuffer(buffer)) {
      writePrivateArtifact(artifactPath, buffer);
    } else if (typeof buffer === 'string') {
      writePrivateArtifact(artifactPath, Buffer.from(buffer, 'base64'));
    } else {
      throw new Error('Screenshot API did not return image bytes.');
    }
    return artifactPath;
  }

  private async getStorage(kind: 'localStorage' | 'sessionStorage'): Promise<Record<string, string>> {
    const page = this.requirePage();
    if (!page.evaluate) {
      return {};
    }
    return await page.evaluate((storageKind: 'localStorage' | 'sessionStorage') => {
      const storage = window[storageKind];
      const data: Record<string, string> = {};
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key) data[key] = storage.getItem(key) || '';
      }
      return data;
    }, kind);
  }

  private async setStorage(kind: 'localStorage' | 'sessionStorage', data: Record<string, unknown>): Promise<void> {
    const page = this.requirePage();
    if (!page.evaluate) {
      throw new Error('Storage API requires page.evaluate.');
    }
    await page.evaluate(({ storageKind, entries }: { storageKind: 'localStorage' | 'sessionStorage'; entries: Record<string, string> }) => {
      const storage = window[storageKind];
      for (const [key, value] of Object.entries(entries)) {
        storage.setItem(key, value);
      }
    }, {
      storageKind: kind,
      entries: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)])),
    });
  }

  private async uploadFiles(entry: BrowserOperatorActionLogEntry, workspaceRoot: string): Promise<string> {
    const page = this.requirePage();
    const inputs = entry.inputs ?? {};
    const files = Array.isArray(inputs.files)
      ? inputs.files.map((file) => requireWorkspaceFile(String(file), workspaceRoot))
      : [];
    if (files.length === 0) throw new Error('upload_files requires inputs.files');
    const selector = getString(inputs.selector) || 'input[type="file"]';
    const locator = page.locator?.(selector);
    if (!locator?.setInputFiles) {
      throw new Error('File upload requires locator.setInputFiles.');
    }
    await locator.setInputFiles(files);
    return `Uploaded ${files.length} file(s) via ${selector}`;
  }

  private async download(entry: BrowserOperatorActionLogEntry, cwd: string): Promise<string> {
    const page = this.requirePage();
    if (!page.waitForEvent) {
      throw new Error('Download requires page.waitForEvent.');
    }
    const inputs = entry.inputs ?? {};
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: getTimeout(inputs, ACTION_TIMEOUT_MS) }),
      this.clickLike('click', entry),
    ]);
    const suggestedFilename = safeArtifactName(download.suggestedFilename?.() ?? `download-${Date.now()}`);
    const artifactDirectory = ensureSafeArtifactDirectory(cwd, this.session.sessionId);
    const outputPath = resolveArtifactOutputPath(
      artifactDirectory,
      getString(inputs.downloadPath),
      suggestedFilename,
    );
    assertArtifactDoesNotExist(outputPath);
    if (download.saveAs) {
      await download.saveAs(outputPath);
      fs.chmodSync(outputPath, 0o600);
    }
    return `Downloaded ${suggestedFilename} to ${outputPath}`;
  }

  private async listTabs(): Promise<Array<{ index: number; url: string; title: string; active: boolean }>> {
    const page = this.requirePage();
    const pages = this.context().pages?.() ?? [page];
    return await Promise.all(pages.map(async (tab: StagehandPage, index: number) => ({
      index,
      url: String(tab.url?.() ?? ''),
      title: String(await (tab.title?.() ?? Promise.resolve(''))),
      active: tab === page,
    })));
  }

  private async newTab(url?: string): Promise<{ index: number; url: string; title: string }> {
    const context = this.context();
    if (!context.newPage) {
      throw new Error('new_tab requires context.newPage.');
    }
    const newPage = await context.newPage(url);
    this.page = newPage;
    if (url && newPage.url?.() !== url) {
      await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS, timeoutMs: NAVIGATION_TIMEOUT_MS });
    }
    const tabs = context.pages?.() ?? [newPage];
    return {
      index: Math.max(0, tabs.indexOf(newPage)),
      url: String(newPage.url?.() ?? ''),
      title: String(await (newPage.title?.() ?? Promise.resolve(''))),
    };
  }

  private async focusTab(inputs: Record<string, any>): Promise<void> {
    const context = this.context();
    const pages = context.pages?.() ?? [];
    const index = getNumber(inputs.index) ?? getNumber(inputs.tabId) ?? 0;
    const target = pages[index];
    if (!target) throw new Error(`Tab not found: ${index}`);
    if (context.setActivePage) {
      context.setActivePage(target);
    } else {
      await target.bringToFront?.();
    }
    this.page = target;
  }

  private async closeTab(inputs: Record<string, any>): Promise<void> {
    const context = this.context();
    const pages = context.pages?.() ?? [];
    const index = getNumber(inputs.index) ?? getNumber(inputs.tabId) ?? pages.indexOf(this.requirePage());
    const target = pages[index];
    if (!target) throw new Error(`Tab not found: ${index}`);
    await target.close?.();
    const remaining = context.pages?.() ?? [];
    this.page = remaining[0] ?? this.page;
  }
}

/**
 * Local Browser Operator sessions reuse a dedicated Code Buddy profile so an
 * operator can sign in once in the visible window. We never point Stagehand at
 * the user's normal Chrome profile: that would broaden access to unrelated
 * tabs and make profile-lock corruption possible.
 */
export function resolvePersistentBrowserOperatorProfile(
  configured = process.env.CODEBUDDY_BROWSER_OPERATOR_PROFILE_DIR,
): string {
  const requested = configured?.trim()
    ? path.resolve(configured.trim())
    : path.join(os.homedir(), '.codebuddy', 'browser-operator-profile');
  fs.mkdirSync(requested, { recursive: true, mode: 0o700 });
  const info = fs.lstatSync(requested);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('Browser Operator persistent profile must be a real directory.');
  }
  fs.chmodSync(requested, 0o700);
  const profilePath = fs.realpathSync(requested);
  const markerPath = path.join(profilePath, BROWSER_OPERATOR_PROFILE_MARKER);
  if (!fs.existsSync(markerPath)) {
    const entries = fs.readdirSync(profilePath);
    if (entries.length > 0) {
      throw new Error(
        'Browser Operator persistent profile is non-empty and has no Code Buddy ownership marker. Choose a new empty directory; existing Chrome/Edge profiles are never adopted.',
      );
    }
    createBrowserOperatorProfileMarker(markerPath);
  }
  validateBrowserOperatorProfileMarker(markerPath);
  return profilePath;
}

/**
 * Acquire the cross-process lease protecting the dedicated Chrome profile.
 * The lock is refreshed while held, recovered only when its owner is dead or
 * its heartbeat is stale, and released only when the random owner token still
 * matches. Callers must retain it until Stagehand has fully closed.
 */
export function acquirePersistentBrowserOperatorProfileLock(
  profilePath: string,
  options: BrowserOperatorProfileLockOptions = {},
): BrowserOperatorProfileLock {
  const resolvedProfile = resolvePersistentBrowserOperatorProfile(profilePath);
  const lockPath = path.join(resolvedProfile, BROWSER_OPERATOR_PROFILE_LOCK);
  const staleMs = Math.max(2_000, options.staleMs ?? PROFILE_LOCK_STALE_MS);
  const updateMs = Math.max(500, Math.min(options.updateMs ?? PROFILE_LOCK_UPDATE_MS, Math.floor(staleMs / 2)));
  const now = options.now ?? Date.now;
  const pid = options.pid ?? process.pid;
  const host = options.hostname ?? os.hostname();
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const token = randomUUID();
  const metadata: BrowserOperatorProfileLockMetadata = {
    schemaVersion: PROFILE_LOCK_SCHEMA_VERSION,
    owner: PROFILE_OWNER,
    token,
    pid,
    hostname: host,
    acquiredAt: new Date(now()).toISOString(),
  };

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      createPrivateControlFile(lockPath, JSON.stringify(metadata, null, 2));
      return createHeldBrowserOperatorProfileLock({
        profilePath: resolvedProfile,
        lockPath,
        token,
        updateMs,
      });
    } catch (error) {
      if (!isErrnoCode(error, 'EEXIST')) throw error;
      const snapshot = readBrowserOperatorProfileLockSnapshot(lockPath);
      if (!isBrowserOperatorProfileLockStale(snapshot, {
        staleMs,
        now: now(),
        hostname: host,
        isProcessAlive,
      })) {
        throw new Error('Browser Operator persistent profile is already in use by another process.');
      }
      reclaimStaleBrowserOperatorProfileLock(lockPath, snapshot, token);
    }
  }

  throw new Error('Browser Operator could not acquire the persistent profile lock safely.');
}

interface BrowserOperatorProfileLockSnapshot {
  stat: fs.Stats;
  metadata: BrowserOperatorProfileLockMetadata | null;
}

function createBrowserOperatorProfileMarker(markerPath: string): void {
  const marker: BrowserOperatorProfileMarker = {
    schemaVersion: PROFILE_MARKER_SCHEMA_VERSION,
    owner: PROFILE_OWNER,
    profileId: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  try {
    createPrivateControlFile(markerPath, JSON.stringify(marker, null, 2));
  } catch (error) {
    // Two Code Buddy processes may initialize the same empty directory at the
    // same instant. The winner's marker is validated below by both processes.
    if (!isErrnoCode(error, 'EEXIST')) throw error;
  }
}

function validateBrowserOperatorProfileMarker(markerPath: string): void {
  const info = fs.lstatSync(markerPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_PROFILE_CONTROL_FILE_BYTES) {
    throw new Error('Browser Operator profile ownership marker is unsafe or invalid.');
  }
  let marker: BrowserOperatorProfileMarker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as BrowserOperatorProfileMarker;
  } catch {
    throw new Error('Browser Operator profile ownership marker is unreadable.');
  }
  if (
    marker.schemaVersion !== PROFILE_MARKER_SCHEMA_VERSION
    || marker.owner !== PROFILE_OWNER
    || typeof marker.profileId !== 'string'
    || marker.profileId.length < 16
    || typeof marker.createdAt !== 'string'
    || !Number.isFinite(Date.parse(marker.createdAt))
  ) {
    throw new Error('Browser Operator profile ownership marker does not belong to Code Buddy.');
  }
  fs.chmodSync(markerPath, 0o600);
}

function createPrivateControlFile(filePath: string, content: string): void {
  const fd = fs.openSync(filePath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(filePath, 0o600);
}

function createHeldBrowserOperatorProfileLock(input: {
  profilePath: string;
  lockPath: string;
  token: string;
  updateMs: number;
}): BrowserOperatorProfileLock {
  let released = false;
  const update = setInterval(() => {
    try {
      const current = readBrowserOperatorProfileLockSnapshot(input.lockPath);
      if (current.metadata?.token !== input.token) {
        clearInterval(update);
        logger.error('BrowserOperatorExecutor: persistent profile lock ownership was compromised.');
        return;
      }
      const timestamp = new Date();
      fs.utimesSync(input.lockPath, timestamp, timestamp);
    } catch (error) {
      clearInterval(update);
      logger.error('BrowserOperatorExecutor: persistent profile lock heartbeat failed', error as Error);
    }
  }, input.updateMs);
  update.unref?.();

  return {
    profilePath: input.profilePath,
    lockPath: input.lockPath,
    token: input.token,
    release: () => {
      if (released) return;
      released = true;
      clearInterval(update);
      let snapshot: BrowserOperatorProfileLockSnapshot;
      try {
        snapshot = readBrowserOperatorProfileLockSnapshot(input.lockPath);
      } catch (error) {
        if (isErrnoCode(error, 'ENOENT')) return;
        throw error;
      }
      if (snapshot.metadata?.token !== input.token) {
        throw new Error('Browser Operator refused to release a persistent profile lock owned by another process.');
      }
      fs.unlinkSync(input.lockPath);
    },
  };
}

function readBrowserOperatorProfileLockSnapshot(lockPath: string): BrowserOperatorProfileLockSnapshot {
  const stat = fs.lstatSync(lockPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Browser Operator persistent profile lock is not a safe regular file.');
  }
  if (stat.size > MAX_PROFILE_CONTROL_FILE_BYTES) {
    return { stat, metadata: null };
  }
  try {
    const value = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Partial<BrowserOperatorProfileLockMetadata>;
    const valid = value.schemaVersion === PROFILE_LOCK_SCHEMA_VERSION
      && value.owner === PROFILE_OWNER
      && typeof value.token === 'string'
      && value.token.length >= 16
      && Number.isSafeInteger(value.pid)
      && Number(value.pid) > 0
      && typeof value.hostname === 'string'
      && value.hostname.length > 0
      && typeof value.acquiredAt === 'string'
      && Number.isFinite(Date.parse(value.acquiredAt));
    return { stat, metadata: valid ? value as BrowserOperatorProfileLockMetadata : null };
  } catch {
    return { stat, metadata: null };
  }
}

function isBrowserOperatorProfileLockStale(
  snapshot: BrowserOperatorProfileLockSnapshot,
  input: {
    staleMs: number;
    now: number;
    hostname: string;
    isProcessAlive: (pid: number) => boolean;
  },
): boolean {
  const heartbeatExpired = snapshot.stat.mtimeMs < input.now - input.staleMs;
  if (!snapshot.metadata) return heartbeatExpired;
  if (snapshot.metadata.hostname !== input.hostname) return heartbeatExpired;
  return !input.isProcessAlive(snapshot.metadata.pid);
}

function reclaimStaleBrowserOperatorProfileLock(
  lockPath: string,
  expected: BrowserOperatorProfileLockSnapshot,
  contenderToken: string,
): void {
  const quarantinePath = `${lockPath}.stale-${contenderToken}`;
  try {
    fs.renameSync(lockPath, quarantinePath);
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) return;
    throw error;
  }

  let moved: BrowserOperatorProfileLockSnapshot;
  try {
    moved = readBrowserOperatorProfileLockSnapshot(quarantinePath);
  } catch (error) {
    restoreUnexpectedProfileLock(quarantinePath, lockPath);
    throw error;
  }
  const sameFile = moved.stat.dev === expected.stat.dev
    && moved.stat.ino === expected.stat.ino
    && moved.stat.size === expected.stat.size
    && moved.metadata?.token === expected.metadata?.token;
  if (!sameFile) {
    restoreUnexpectedProfileLock(quarantinePath, lockPath);
    throw new Error('Browser Operator profile lock changed during stale recovery; acquisition was aborted.');
  }
  fs.unlinkSync(quarantinePath);
}

function restoreUnexpectedProfileLock(quarantinePath: string, lockPath: string): void {
  try {
    fs.linkSync(quarantinePath, lockPath);
  } catch (error) {
    if (!isErrnoCode(error, 'EEXIST')) {
      logger.error('BrowserOperatorExecutor: could not restore a concurrently replaced profile lock', error as Error);
    }
  } finally {
    try {
      fs.unlinkSync(quarantinePath);
    } catch {
      // Best effort: never overwrite a newer owner's lock during recovery.
    }
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrnoCode(error, 'EPERM');
  }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === code);
}

function buildSemanticInspectionRequest(
  entry: BrowserOperatorActionLogEntry,
  action: string,
): {
  selectorGroups: string[][];
  intent: string;
  useActiveElement: boolean;
  allowIntentFallback: boolean;
} {
  const inputs = entry.inputs ?? {};
  const selectorGroups: string[][] = [];
  let allowIntentFallback = false;
  const selector = getString(inputs.selector);
  if (selector) selectorGroups.push([selector]);

  if (action === 'fill') {
    const fields = getRecord(inputs.fields);
    for (const key of Object.keys(fields)) {
      if (isNumeric(key)) {
        selectorGroups.push(referenceSelectorGroup(key));
        allowIntentFallback = true;
      } else if (key !== selector) {
        selectorGroups.push([key]);
      }
    }
  }

  if (inputs.ref !== undefined && selectorGroups.length === 0) {
    selectorGroups.push(referenceSelectorGroup(String(inputs.ref)));
    allowIntentFallback = true;
  }
  if (action === 'upload_files' && selectorGroups.length === 0) {
    selectorGroups.push(['input[type="file"]']);
  }

  return {
    selectorGroups,
    intent: getElementIntent(entry, action) || entry.title || action,
    useActiveElement: action === 'press',
    allowIntentFallback,
  };
}

function referenceSelectorGroup(ref: string): string[] {
  const escaped = ref.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    `[data-ref="${escaped}"]`,
    `[data-stagehand-ref="${escaped}"]`,
    `[aria-ref="${escaped}"]`,
  ];
}

function semanticInputDescription(entry: BrowserOperatorActionLogEntry, action: string): string {
  const inputs = entry.inputs ?? {};
  const values: unknown[] = [
    inputs.selector,
    inputs.target,
    inputs.llmTarget,
    inputs.element,
    inputs.description,
    inputs.instruction,
    inputs.label,
    inputs.name,
    inputs.placeholder,
    inputs.role,
    inputs.href,
    inputs.formAction,
    inputs.key,
    ...Object.keys(getRecord(inputs.fields)),
  ];
  // Typed values may contain arbitrary prose or secrets and are neither needed
  // for effect classification nor safe to copy into inspection evidence.
  if (action === 'click' || action === 'act' || action === 'double_click' || action === 'right_click') {
    values.push(inputs.text);
  }
  return values.filter((value) => value !== undefined && value !== null).map(String).join(' ');
}

function normalizeTargetInspection(value: unknown): BrowserOperatorTargetInspection | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.inspected !== true || !Array.isArray(record.contexts)) return null;
  const contexts = record.contexts.slice(0, 12).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const context = candidate as Record<string, unknown>;
    return [{
      text: boundedSemanticText(context.text, 300),
      ariaLabel: boundedSemanticText(context.ariaLabel, 300),
      labels: boundedSemanticText(context.labels, 500),
      neighborhood: boundedSemanticText(context.neighborhood, 800),
      formAction: boundedSemanticText(context.formAction, 500),
      formText: boundedSemanticText(context.formText, 800),
      role: boundedSemanticText(context.role, 80),
      inputType: boundedSemanticText(context.inputType, 80),
      name: boundedSemanticText(context.name, 200),
      href: boundedSemanticText(context.href, 500),
    }];
  });
  return {
    inspected: true,
    targetFound: record.targetFound === true,
    url: boundedSemanticText(record.url, 1_000),
    documentTitle: boundedSemanticText(record.documentTitle, 300),
    contexts,
    resolvedSelectors: Array.isArray(record.resolvedSelectors)
      ? record.resolvedSelectors.slice(0, 12).map((selector) => boundedSemanticText(selector, 1_000)).filter(Boolean)
      : [],
    ...(record.error ? { error: boundedSemanticText(record.error, 300) } : {}),
  };
}

function boundedSemanticText(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeAction(entry: BrowserOperatorActionLogEntry): string {
  const rawAction = String(entry.action || entry.tool || '').trim().toLowerCase();
  return rawAction
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
}

function requiresStepConfirmation(entry: BrowserOperatorActionLogEntry, action: string): boolean {
  return MUTATING_ACTIONS.has(action) || entry.requiresConsent === true && action !== 'navigate';
}

function buildConfirmationMessage(entry: BrowserOperatorActionLogEntry, action: string): string {
  const inputs = entry.inputs ?? {};
  const target = inputs.selector !== undefined
    ? `selector ${inputs.selector}`
    : inputs.ref !== undefined
      ? `element ${inputs.ref}`
      : getString(inputs.text) || getString(inputs.instruction) || entry.title || 'active element';
  const text = inputs.text !== undefined ? ` with text: "${inputs.text}"` : '';
  return `Execute browser action: ${action} on ${target}${text}`;
}

function getElementIntent(entry: BrowserOperatorActionLogEntry, action: string): string {
  const inputs = entry.inputs ?? {};
  return getString(inputs.target)
    || getString(inputs.llmTarget)
    || getString(inputs.element)
    || getString(inputs.description)
    || getString(inputs.instruction)
    || getString(inputs.label)
    || (action === 'click' ? getString(inputs.text) : '')
    || (action === 'identify_element' || action === 'resolve_element' ? entry.title : '');
}

function normalizeObservedAction(candidate: unknown): ResolvedBrowserElement | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const selector = getString(record.selector);
  if (!selector) {
    return null;
  }

  return {
    selector,
    description: getString(record.description) || selector,
    method: getString(record.method) || undefined,
    arguments: Array.isArray(record.arguments) ? record.arguments.map(String) : undefined,
    source: 'stagehand-observe',
  };
}

function scoreObservedElement(candidate: ResolvedBrowserElement, target: string): number {
  const text = `${candidate.description} ${candidate.selector} ${candidate.method || ''}`.toLowerCase();
  const normalizedTarget = target.toLowerCase();
  const tokens = normalizedTarget.split(/\W+/).filter((token) => token.length > 2);
  const tokenHits = tokens.filter((token) => text.includes(token)).length;
  return (text.includes(normalizedTarget) ? 20 : 0)
    + tokenHits * 3
    + (candidate.method === 'click' ? 1 : 0)
    + (candidate.selector.startsWith('#') ? 1 : 0);
}

function isNavigationRouteTarget(value: unknown): value is NavigationRouteTarget {
  return Boolean(value && typeof value === 'object' && typeof (value as { route?: unknown }).route === 'function');
}

async function continueNavigationRoute(route: NavigationRouteLike): Promise<void> {
  if (typeof route.continue !== 'function') {
    throw new Error('Navigation blocked: intercepted request cannot be continued safely.');
  }
  await route.continue();
}

async function abortNavigationRoute(route: NavigationRouteLike): Promise<void> {
  if (typeof route.abort !== 'function') return;
  try {
    await route.abort('blockedbyclient');
  } catch {
    // The browser may already be closing after the fail-closed stop signal.
  }
}

function normalizeNavigationError(error: unknown): Error {
  if (error instanceof Error && /^Navigation blocked:/i.test(error.message)) {
    return error;
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(`Navigation blocked: intercepted browser navigation was rejected (${reason}).`);
}

function timeoutForAction(action: string): number {
  if (action === 'navigate') return NAVIGATION_TIMEOUT_MS;
  if (action === 'extract' || action === 'observe') return EXTRACT_TIMEOUT_MS;
  return ACTION_TIMEOUT_MS;
}

function getTimeout(inputs: Record<string, any>, fallback: number): number {
  const timeout = getNumber(inputs.timeout);
  return timeout && timeout > 0 ? timeout : fallback;
}

function getString(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isNumeric(value: string): boolean {
  return /^\d+$/.test(value);
}

function buildCookie(inputs: Record<string, any>): Record<string, unknown> {
  const name = getString(inputs.cookieName) || getString(inputs.name);
  const value = getString(inputs.cookieValue) || getString(inputs.value);
  if (!name || !value) {
    throw new Error('set_cookie requires cookieName/name and cookieValue/value');
  }
  return {
    name,
    value,
    ...(getString(inputs.cookieDomain) ? { domain: getString(inputs.cookieDomain) } : {}),
    ...(getString(inputs.url) ? { url: getString(inputs.url) } : {}),
    path: getString(inputs.path) || '/',
  };
}

function formatStructured(value: unknown): string {
  if (typeof value === 'string') {
    return truncate(value, 8_000);
  }
  try {
    return truncate(JSON.stringify(value, null, 2), 8_000);
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n... (truncated)` : value;
}

const SAFE_SESSION_ID = /^[a-zA-Z0-9._-]{1,128}$/;
const SENSITIVE_FIELD_HINT = /password|passcode|secret|token|credential|api[_ -]?key|private[_ -]?key/i;

function assertSafeSessionId(sessionId: string): void {
  if (!SAFE_SESSION_ID.test(sessionId)) {
    throw new Error('Browser Operator session id is invalid.');
  }
}

function requireWorkspaceRoot(input: string): string {
  try {
    const root = fs.realpathSync(path.resolve(input));
    if (!fs.statSync(root).isDirectory()) throw new Error('not a directory');
    return root;
  } catch {
    throw new Error('Browser Operator workspace root must be an existing directory.');
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function ensureSafeArtifactDirectory(workspaceRoot: string, sessionId: string): string {
  assertSafeSessionId(sessionId);
  const root = requireWorkspaceRoot(workspaceRoot);
  let current = root;
  for (const segment of ['.codebuddy', 'runs', sessionId, 'artifacts']) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      const info = fs.lstatSync(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error(`Unsafe Browser Operator artifact directory: ${current}`);
      }
    } else {
      fs.mkdirSync(current, { mode: 0o700 });
    }
    const real = fs.realpathSync(current);
    if (!isPathInside(root, real)) {
      throw new Error('Browser Operator artifact directory escaped the workspace.');
    }
  }
  return current;
}

function safeArtifactName(input: string): string {
  const safe = path.basename(input)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 160);
  return safe || 'artifact';
}

function resolveArtifactOutputPath(
  artifactDirectory: string,
  requestedPath: string,
  fallbackName: string,
): string {
  const candidate = requestedPath
    ? path.resolve(artifactDirectory, requestedPath)
    : path.join(artifactDirectory, safeArtifactName(fallbackName));
  if (path.dirname(candidate) !== artifactDirectory || !isPathInside(artifactDirectory, candidate)) {
    throw new Error('Browser Operator artifact output must stay inside its private artifact directory.');
  }
  return candidate;
}

function assertArtifactDoesNotExist(filePath: string): void {
  if (fs.existsSync(filePath)) {
    const info = fs.lstatSync(filePath);
    if (info.isSymbolicLink()) {
      throw new Error('Browser Operator refused a symlink artifact target.');
    }
    throw new Error(`Browser Operator artifact already exists: ${path.basename(filePath)}`);
  }
}

function nextAvailableArtifactPath(preferredPath: string): string {
  if (!fs.existsSync(preferredPath)) return preferredPath;
  const extension = path.extname(preferredPath);
  const stem = preferredPath.slice(0, preferredPath.length - extension.length);
  for (let index = 1; index <= 1_000; index++) {
    const candidate = `${stem}.${index}${extension}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Browser Operator could not reserve a unique proof artifact name.');
}

function writePrivateArtifact(filePath: string, content: string | Buffer): void {
  assertArtifactDoesNotExist(filePath);
  const fd = fs.openSync(filePath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(filePath, 0o600);
}

function requireWorkspaceFile(input: string, workspaceRoot: string): string {
  const root = requireWorkspaceRoot(workspaceRoot);
  const candidate = path.resolve(root, input);
  if (!isPathInside(root, candidate)) {
    throw new Error('Browser Operator upload path must stay inside the workspace.');
  }
  try {
    const info = fs.lstatSync(candidate);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('not a regular file');
    const real = fs.realpathSync(candidate);
    if (!isPathInside(root, real)) throw new Error('escaped workspace');
    return real;
  } catch {
    throw new Error(`Browser Operator upload file is unavailable or unsafe: ${input}`);
  }
}

function redactActionLogEntry(entry: BrowserOperatorActionLogEntry): BrowserOperatorActionLogEntry {
  const cloned = JSON.parse(JSON.stringify(entry)) as BrowserOperatorActionLogEntry;
  const inputs = cloned.inputs ?? {};
  const hint = [
    cloned.title,
    cloned.reason,
    inputs.selector,
    inputs.target,
    inputs.label,
    inputs.name,
    inputs.placeholder,
  ].filter(Boolean).join(' ');
  if (SENSITIVE_FIELD_HINT.test(hint)) {
    for (const key of ['value', 'text', 'instruction']) {
      if (inputs[key] !== undefined) inputs[key] = '[REDACTED]';
    }
  }
  if (inputs.fields && typeof inputs.fields === 'object' && !Array.isArray(inputs.fields)) {
    inputs.fields = Object.fromEntries(
      Object.entries(inputs.fields as Record<string, unknown>).map(([key, value]) => [
        key,
        SENSITIVE_FIELD_HINT.test(key) ? '[REDACTED]' : value,
      ]),
    );
  }
  cloned.inputs = inputs;
  return getDataRedactionEngine().redactObject(cloned);
}

function redactSessionForProof(session: BrowserOperatorSessionDraft): BrowserOperatorSessionDraft {
  const cloned = JSON.parse(JSON.stringify(session)) as BrowserOperatorSessionDraft;
  cloned.actionLog = cloned.actionLog.map(redactActionLogEntry);
  return getDataRedactionEngine().redactObject(cloned);
}
