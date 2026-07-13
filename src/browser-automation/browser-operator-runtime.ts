import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserOperatorExecutor } from './browser-operator-executor.js';
import type {
  BrowserOperatorActionLogEntry,
  BrowserOperatorConsentScope,
  BrowserOperatorSessionDraft,
} from './browser-operator-session.js';

export type BrowserOperatorRuntimeState =
  | 'prepared'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'stopped';

export interface BrowserOperatorExecutionResult {
  success: boolean;
  stopped: boolean;
  actionLog: BrowserOperatorActionLogEntry[];
  proofPath?: string;
}

export interface BrowserOperatorExecutorLike {
  grantConsent(reviewer?: string): void;
  stop(): void;
  execute(cwd?: string): Promise<BrowserOperatorExecutionResult>;
}

export interface BrowserOperatorConsentReceipt {
  draftHash: string;
  approvedBy: string;
  approvedAt: string;
  scopes: BrowserOperatorConsentScope[];
}

export interface BrowserOperatorRuntimeView {
  runtimeId: string;
  ownerSessionId: string;
  workspaceRoot: string;
  draftHash: string;
  state: BrowserOperatorRuntimeState;
  goal: string;
  mode: BrowserOperatorSessionDraft['mode'];
  interactionClass: 'read-only' | 'interactive';
  sourceUrl: string;
  actionCount: number;
  createdAt: string;
  updatedAt: string;
  consent: BrowserOperatorConsentReceipt | null;
  error?: string;
  proofPath?: string;
}

export interface PrepareBrowserOperatorRuntimeInput {
  ownerSessionId: string;
  workspaceRoot: string;
  draft: BrowserOperatorSessionDraft;
}

export interface StartBrowserOperatorRuntimeInput {
  runtimeId: string;
  ownerSessionId: string;
  expectedDraftHash: string;
  approvedBy: string;
}

export interface BrowserOperatorRuntimeEvent {
  type: 'prepared' | 'started' | 'action' | 'stopping' | 'completed' | 'failed' | 'stopped';
  runtime: BrowserOperatorRuntimeView;
  action?: BrowserOperatorActionLogEntry;
}

export interface BrowserOperatorRuntimeManagerOptions {
  executorFactory?: (draft: BrowserOperatorSessionDraft) => BrowserOperatorExecutorLike;
  idFactory?: () => string;
  now?: () => Date;
  onEvent?: (event: BrowserOperatorRuntimeEvent) => void;
  maxRetainedRuntimes?: number;
}

interface RuntimeEntry {
  view: BrowserOperatorRuntimeView;
  draft: BrowserOperatorSessionDraft;
  executor: BrowserOperatorExecutorLike;
  execution?: Promise<void>;
}

const MAX_OWNER_ID_CHARS = 256;
const MAX_RETAINED_RUNTIMES = 100;
const SAFE_RUNTIME_ID = /^[a-zA-Z0-9._-]{1,128}$/;

/**
 * Deliberately smaller than BrowserOperatorExecutor's technical action set.
 * The runtime is an agent-facing trust boundary: credential/storage reads,
 * arbitrary JavaScript, uploads, downloads and browser-context mutation stay
 * unavailable until they each receive a dedicated policy and receipt model.
 */
const RUNTIME_ALLOWED_ACTIONS = new Set([
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
  'get_text',
  'get_url',
  'get_title',
  'screenshot',
  'wait',
  'wait_for_selector',
  'wait_for_navigation',
  'tabs',
  'focus_tab',
  'close_tab',
]);

const NON_BROWSER_PLAN_TOOLS = new Set([
  'web_search',
  'web_fetch',
  'relationship_context',
  'remember',
  'lessons_add',
]);

const MUTATING_RUNTIME_ACTIONS = new Set([
  'act',
  'click',
  'double_click',
  'right_click',
  'type',
  'fill',
  'select',
  'press',
  'drag',
]);

const HIGH_IMPACT_EFFECTS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: 'financial transaction or purchase',
    pattern: /\b(buy|purchase|checkout|pay|payment|order|subscribe|transfer|donate|acheter|achat|payer|paiement|commande|abonner|virement|don)\b/i,
  },
  {
    label: 'message, publication, or submission',
    pattern: /\b(send|submit|post|publish|comment|share|upload|email|message|envoyer|soumettre|publier|commenter|partager|televerser|téléverser|courriel)\b/i,
  },
  {
    label: 'booking or appointment',
    pattern: /\b(book|booking|reserve|reservation|schedule appointment|check[- ]?in|réserver|reservation|réservation|rendez[- ]?vous)\b/i,
  },
  {
    label: 'destructive or account-changing action',
    pattern: /\b(delete|remove|cancel|unsubscribe|close account|change password|create account|invite user|grant permission|supprimer|effacer|annuler|désabonner|fermer le compte|changer le mot de passe|créer un compte|inviter|accorder)\b/i,
  },
];

function cloneDraft(draft: BrowserOperatorSessionDraft): BrowserOperatorSessionDraft {
  try {
    return JSON.parse(JSON.stringify(draft)) as BrowserOperatorSessionDraft;
  } catch {
    throw new Error('Browser Operator draft must be JSON-serializable.');
  }
}

function normalizeAction(entry: BrowserOperatorActionLogEntry): string {
  return String(entry.action || entry.tool || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function hashBrowserOperatorDraft(draft: BrowserOperatorSessionDraft): string {
  const consentPayload = {
    schemaVersion: draft.schemaVersion,
    goal: draft.goal,
    query: draft.query,
    sourceUrl: draft.sourceUrl,
    mode: draft.mode,
    intent: draft.intent,
    dedicatedTab: draft.dedicatedTab,
    stopControl: draft.stopControl,
    actionLog: draft.actionLog.map((entry) => ({
      id: entry.id,
      sequence: entry.sequence,
      tool: entry.tool,
      action: entry.action,
      stage: entry.stage,
      title: entry.title,
      requiresConsent: entry.requiresConsent,
      reason: entry.reason,
      inputs: entry.inputs,
    })),
  };
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(consentPayload)))
    .digest('hex');
}

function requireOwnerSessionId(value: string): string {
  const owner = value.trim();
  const hasControlCharacter = [...owner].some((character) => character.charCodeAt(0) < 32);
  if (!owner || owner.length > MAX_OWNER_ID_CHARS || hasControlCharacter) {
    throw new Error('Browser Operator owner session id is invalid.');
  }
  return owner;
}

function requireRuntimeId(value: string): string {
  const runtimeId = value.trim();
  if (!SAFE_RUNTIME_ID.test(runtimeId)) {
    throw new Error('Browser Operator runtime id is invalid.');
  }
  return runtimeId;
}

function requireWorkspaceRoot(value: string): string {
  try {
    const root = fs.realpathSync(path.resolve(value));
    if (!fs.statSync(root).isDirectory()) throw new Error('not a directory');
    return root;
  } catch {
    throw new Error('Browser Operator workspace root must be an existing directory.');
  }
}

function requireStartingUrl(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error('Executable Browser Operator drafts require an explicit sourceUrl.');
  }
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('unsupported URL');
    }
    return parsed.toString();
  } catch {
    throw new Error('Browser Operator sourceUrl must be a credential-free HTTP(S) URL.');
  }
}

function resetAction(entry: BrowserOperatorActionLogEntry, sequence: number): BrowserOperatorActionLogEntry {
  return {
    ...entry,
    sequence,
    status: 'planned',
    evidence: entry.evidence,
  };
}

function highImpactEffect(entry: BrowserOperatorActionLogEntry): string | undefined {
  const inputs = entry.inputs ?? {};
  const description = [
    entry.title,
    entry.reason,
    inputs.instruction,
    inputs.text,
    inputs.target,
    inputs.label,
  ].filter(Boolean).join(' ');
  return HIGH_IMPACT_EFFECTS.find(({ pattern }) => pattern.test(description))?.label;
}

/**
 * Convert the review draft into the exact immutable plan covered by consent.
 * Non-browser planning steps are intentionally omitted: this runtime owns a
 * dedicated browser, not web-search, memory, or relationship tools.
 */
export function compileExecutableBrowserOperatorDraft(
  input: BrowserOperatorSessionDraft,
  runtimeId: string,
): BrowserOperatorSessionDraft {
  const draft = cloneDraft(input);
  const sourceUrl = requireStartingUrl(draft.sourceUrl);
  const browserEntries: BrowserOperatorActionLogEntry[] = [];

  for (const entry of draft.actionLog) {
    const action = normalizeAction(entry);
    if (NON_BROWSER_PLAN_TOOLS.has(action)) continue;
    if (!RUNTIME_ALLOWED_ACTIONS.has(action)) {
      throw new Error(`Browser Operator action is not allowed by the executable runtime: ${action}`);
    }
    if (MUTATING_RUNTIME_ACTIONS.has(action)) {
      const effect = highImpactEffect(entry);
      if (effect) {
        throw new Error(
          `Browser Operator runtime requires a dedicated policy and approval receipt for this ${effect}.`,
        );
      }
    }
    browserEntries.push(entry);
  }

  const firstAction = browserEntries[0] ? normalizeAction(browserEntries[0]) : '';
  if (firstAction !== 'navigate') {
    browserEntries.unshift({
      id: 'runtime-navigate',
      sequence: 1,
      status: 'planned',
      tool: 'navigate',
      action: 'navigate',
      stage: 'observe',
      title: 'Open the reviewed starting URL',
      evidence: 'visible-state',
      requiresConsent: false,
      expectedArtifact: 'browser-observation.json',
      reason: 'Every executable session starts from the exact URL reviewed by the operator.',
      inputs: { url: sourceUrl },
    });
  }

  if (browserEntries.length === 0) {
    throw new Error('Browser Operator draft has no executable browser actions.');
  }

  const scopes = Array.from(new Set<BrowserOperatorConsentScope>([
    ...draft.consent.scopes,
    draft.mode === 'local' ? 'local_browser' : 'public_web_read',
    ...(draft.mode === 'local' ? ['authenticated_tabs' as const] : []),
    ...(browserEntries.some((entry) => entry.requiresConsent) ? ['browser_interaction' as const] : []),
  ]));

  return {
    ...draft,
    sessionId: requireRuntimeId(runtimeId),
    sourceUrl,
    consent: {
      required: true,
      granted: false,
      scopes,
      reason: 'Execution requires a local human receipt bound to this exact immutable draft.',
    },
    actionLog: browserEntries.map((entry, index) => resetAction(entry, index + 1)),
    proofExport: {
      ...draft.proofExport,
      artifactName: `${runtimeId}.browser-operator.json`,
    },
  };
}

export class BrowserOperatorRuntimeManager {
  private readonly executorFactory: (draft: BrowserOperatorSessionDraft) => BrowserOperatorExecutorLike;
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private readonly onEvent?: (event: BrowserOperatorRuntimeEvent) => void;
  private readonly maxRetainedRuntimes: number;
  private readonly entries = new Map<string, RuntimeEntry>();

  constructor(options: BrowserOperatorRuntimeManagerOptions = {}) {
    this.executorFactory = options.executorFactory ?? ((draft) => new BrowserOperatorExecutor(draft, {
      onEvent: (event) => {
        if (event.type !== 'action' || !event.action) return;
        const entry = this.entries.get(event.sessionId);
        if (!entry) return;
        this.emitAction(entry.view, event.action);
      },
    }));
    this.idFactory = options.idFactory ?? (() => `browser-operator-${randomUUID()}`);
    this.now = options.now ?? (() => new Date());
    this.onEvent = options.onEvent;
    this.maxRetainedRuntimes = Math.max(
      10,
      Math.min(options.maxRetainedRuntimes ?? MAX_RETAINED_RUNTIMES, 1_000),
    );
  }

  prepare(input: PrepareBrowserOperatorRuntimeInput): BrowserOperatorRuntimeView {
    const ownerSessionId = requireOwnerSessionId(input.ownerSessionId);
    const workspaceRoot = requireWorkspaceRoot(input.workspaceRoot);
    const runtimeId = requireRuntimeId(this.idFactory());
    if (this.entries.has(runtimeId)) throw new Error('Browser Operator runtime id collision.');
    const draft = compileExecutableBrowserOperatorDraft(input.draft, runtimeId);
    const draftHash = hashBrowserOperatorDraft(draft);
    const timestamp = this.now().toISOString();
    const view: BrowserOperatorRuntimeView = {
      runtimeId,
      ownerSessionId,
      workspaceRoot,
      draftHash,
      state: 'prepared',
      goal: draft.goal,
      mode: draft.mode,
      interactionClass: draft.actionLog.some((entry) => MUTATING_RUNTIME_ACTIONS.has(normalizeAction(entry)))
        ? 'interactive'
        : 'read-only',
      sourceUrl: draft.sourceUrl!,
      actionCount: draft.actionLog.length,
      createdAt: timestamp,
      updatedAt: timestamp,
      consent: null,
    };
    this.entries.set(runtimeId, {
      view,
      draft,
      executor: this.executorFactory(draft),
    });
    this.prune();
    this.emit('prepared', view);
    return this.copyView(view);
  }

  getPreparedDraft(runtimeId: string, ownerSessionId: string): BrowserOperatorSessionDraft {
    const entry = this.requireOwned(runtimeId, ownerSessionId);
    return cloneDraft(entry.draft);
  }

  status(runtimeId: string, ownerSessionId: string): BrowserOperatorRuntimeView {
    return this.copyView(this.requireOwned(runtimeId, ownerSessionId).view);
  }

  list(ownerSessionId?: string): BrowserOperatorRuntimeView[] {
    const owner = ownerSessionId === undefined ? undefined : requireOwnerSessionId(ownerSessionId);
    return [...this.entries.values()]
      .filter((entry) => owner === undefined || entry.view.ownerSessionId === owner)
      .map((entry) => this.copyView(entry.view))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  start(input: StartBrowserOperatorRuntimeInput): BrowserOperatorRuntimeView {
    const entry = this.requireOwned(input.runtimeId, input.ownerSessionId);
    if (entry.view.state !== 'prepared') {
      throw new Error(`Browser Operator runtime is not prepared (${entry.view.state}).`);
    }
    if (input.expectedDraftHash !== entry.view.draftHash) {
      throw new Error('Browser Operator draft changed after review; review the current plan again.');
    }
    const approvedBy = input.approvedBy.trim().slice(0, 160);
    if (!approvedBy) throw new Error('Browser Operator execution requires an approving operator.');
    const competing = [...this.entries.values()].find(
      (candidate) =>
        (
          candidate.view.ownerSessionId === entry.view.ownerSessionId
          || (entry.view.mode === 'local' && candidate.view.mode === 'local')
        ) &&
        ['running', 'stopping'].includes(candidate.view.state),
    );
    if (competing) {
      throw new Error(`A Browser Operator runtime is already running for this session: ${competing.view.runtimeId}`);
    }

    const approvedAt = this.now().toISOString();
    entry.view.consent = {
      draftHash: entry.view.draftHash,
      approvedBy,
      approvedAt,
      scopes: [...entry.draft.consent.scopes],
    };
    entry.view.state = 'running';
    entry.view.updatedAt = approvedAt;
    entry.executor.grantConsent(approvedBy);
    this.emit('started', entry.view);

    entry.execution = entry.executor.execute(entry.view.workspaceRoot)
      .then((result) => {
        entry.view.state = result.stopped ? 'stopped' : result.success ? 'completed' : 'failed';
        entry.view.updatedAt = this.now().toISOString();
        if (result.proofPath) entry.view.proofPath = result.proofPath;
        if (!result.success && !result.stopped) {
          entry.view.error = 'Browser Operator execution did not complete successfully.';
        }
        this.emit(entry.view.state, entry.view);
      })
      .catch((error) => {
        entry.view.state = entry.view.state === 'stopping' ? 'stopped' : 'failed';
        entry.view.updatedAt = this.now().toISOString();
        entry.view.error = error instanceof Error ? error.message : String(error);
        this.emit(entry.view.state, entry.view);
      });

    return this.copyView(entry.view);
  }

  stop(runtimeId: string, ownerSessionId: string): boolean {
    const entry = this.requireOwned(runtimeId, ownerSessionId);
    if (entry.view.state !== 'running') return false;
    entry.view.state = 'stopping';
    entry.view.updatedAt = this.now().toISOString();
    this.emit('stopping', entry.view);
    entry.executor.stop();
    return true;
  }

  async wait(runtimeId: string, ownerSessionId: string): Promise<BrowserOperatorRuntimeView> {
    const entry = this.requireOwned(runtimeId, ownerSessionId);
    await entry.execution;
    return this.copyView(entry.view);
  }

  private requireOwned(runtimeId: string, ownerSessionId: string): RuntimeEntry {
    const entry = this.entries.get(requireRuntimeId(runtimeId));
    if (!entry) throw new Error(`Browser Operator runtime not found: ${runtimeId}`);
    if (entry.view.ownerSessionId !== requireOwnerSessionId(ownerSessionId)) {
      throw new Error('Browser Operator runtime owner mismatch.');
    }
    return entry;
  }

  private emit(type: BrowserOperatorRuntimeEvent['type'], view: BrowserOperatorRuntimeView): void {
    try {
      this.onEvent?.({ type, runtime: this.copyView(view) });
    } catch {
      // Observability callbacks must never alter browser execution semantics.
    }
  }

  private emitAction(view: BrowserOperatorRuntimeView, action: BrowserOperatorActionLogEntry): void {
    try {
      this.onEvent?.({
        type: 'action',
        runtime: this.copyView(view),
        action: JSON.parse(JSON.stringify(action)) as BrowserOperatorActionLogEntry,
      });
    } catch {
      // Observability callbacks must never alter browser execution semantics.
    }
  }

  private copyView(view: BrowserOperatorRuntimeView): BrowserOperatorRuntimeView {
    return {
      ...view,
      consent: view.consent
        ? { ...view.consent, scopes: [...view.consent.scopes] }
        : null,
    };
  }

  private prune(): void {
    if (this.entries.size <= this.maxRetainedRuntimes) return;
    const removable = [...this.entries.values()]
      .filter((entry) => !['running', 'stopping'].includes(entry.view.state))
      .sort((left, right) => left.view.updatedAt.localeCompare(right.view.updatedAt));
    for (const entry of removable.slice(0, this.entries.size - this.maxRetainedRuntimes)) {
      this.entries.delete(entry.view.runtimeId);
    }
  }
}
