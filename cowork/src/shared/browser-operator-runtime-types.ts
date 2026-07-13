/**
 * Browser Operator runtime IPC contract.
 *
 * The renderer only proposes a review draft. The main process chooses the
 * active workspace, creates the server-owned runtime id and binds approval to
 * the returned SHA-256 draft hash.
 */

export type BrowserOperatorRuntimeState =
  | 'prepared'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'stopped';

export interface BrowserOperatorRuntimeView {
  runtimeId: string;
  ownerSessionId: string;
  workspaceRoot: string;
  draftHash: string;
  state: BrowserOperatorRuntimeState;
  goal: string;
  mode: 'isolated' | 'local';
  interactionClass: 'read-only' | 'interactive';
  sourceUrl: string;
  actionCount: number;
  createdAt: string;
  updatedAt: string;
  consent: {
    draftHash: string;
    approvedBy: string;
    approvedAt: string;
    scopes: string[];
  } | null;
  error?: string;
  proofPath?: string;
}

/** Kept structural so Cowork never needs to bundle the core type module. */
export interface BrowserOperatorSessionDraftInput {
  schemaVersion: 1;
  sessionId: string;
  generatedAt: string;
  goal: string;
  query: string;
  sourceUrl?: string;
  mode: 'isolated' | 'local';
  intent: string;
  dedicatedTab: { label: string; reason: string };
  consent: {
    required: boolean;
    granted: boolean;
    scopes: string[];
    reason: string;
    grantedBy?: string;
    grantedAt?: string;
  };
  stopControl: { enabled: true; label: string; stopConditions: string[] };
  actionLog: Array<{
    id: string;
    sequence: number;
    status: string;
    tool: string;
    action?: string;
    stage: string;
    title: string;
    evidence: string;
    requiresConsent: boolean;
    expectedArtifact: string;
    reason: string;
    inputs?: Record<string, unknown>;
  }>;
  proofExport: { artifactName: string; includes: string[] };
}

export interface BrowserOperatorPrepareInput {
  ownerSessionId: string;
  draft: BrowserOperatorSessionDraftInput;
}

export interface BrowserOperatorOwnedInput {
  runtimeId: string;
  ownerSessionId: string;
}

export interface BrowserOperatorStartInput extends BrowserOperatorOwnedInput {
  expectedDraftHash: string;
  approvedBy: string;
}

export type BrowserOperatorRuntimeResult =
  | { ok: true; runtime: BrowserOperatorRuntimeView }
  | { ok: false; error: string; runtime: null };

export type BrowserOperatorPrepareResult =
  | {
      ok: true;
      runtime: BrowserOperatorRuntimeView;
      /** Exact server-compiled draft covered by runtime.draftHash. */
      draft: BrowserOperatorSessionDraftInput;
    }
  | { ok: false; error: string; runtime: null; draft: null };

export type BrowserOperatorRuntimeListResult =
  | { ok: true; runtimes: BrowserOperatorRuntimeView[] }
  | { ok: false; error: string; runtimes: [] };

export type BrowserOperatorStopResult =
  | { ok: true; stopped: boolean; runtime: BrowserOperatorRuntimeView }
  | { ok: false; error: string; stopped: false; runtime: null };

export interface BrowserOperatorRuntimeEvent {
  type: 'prepared' | 'started' | 'action' | 'stopping' | 'completed' | 'failed' | 'stopped';
  runtime: BrowserOperatorRuntimeView;
  action?: BrowserOperatorSessionDraftInput['actionLog'][number];
}

export const BROWSER_OPERATOR_RUNTIME_CHANNELS = {
  prepare: 'browserOperatorRuntime.prepare',
  start: 'browserOperatorRuntime.start',
  stop: 'browserOperatorRuntime.stop',
  status: 'browserOperatorRuntime.status',
  list: 'browserOperatorRuntime.list',
  event: 'browserOperatorRuntime.event',
} as const;
