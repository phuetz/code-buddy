import { loadCoreModule } from '../utils/core-loader';
import type {
  BrowserOperatorOwnedInput,
  BrowserOperatorPrepareInput,
  BrowserOperatorPrepareResult,
  BrowserOperatorRuntimeEvent,
  BrowserOperatorRuntimeListResult,
  BrowserOperatorRuntimeResult,
  BrowserOperatorRuntimeView,
  BrowserOperatorSessionDraftInput,
  BrowserOperatorStartInput,
  BrowserOperatorStopResult,
} from '../../shared/browser-operator-runtime-types';

interface CoreRuntimeEvent {
  type: BrowserOperatorRuntimeEvent['type'];
  runtime: BrowserOperatorRuntimeView;
  action?: BrowserOperatorSessionDraftInput['actionLog'][number];
}

interface CoreRuntimeManager {
  prepare(input: {
    ownerSessionId: string;
    workspaceRoot: string;
    draft: unknown;
  }): BrowserOperatorRuntimeView;
  getPreparedDraft(runtimeId: string, ownerSessionId: string): unknown;
  start(input: {
    runtimeId: string;
    ownerSessionId: string;
    expectedDraftHash: string;
    approvedBy: string;
  }): BrowserOperatorRuntimeView;
  stop(runtimeId: string, ownerSessionId: string): boolean;
  status(runtimeId: string, ownerSessionId: string): BrowserOperatorRuntimeView;
  list(ownerSessionId?: string): BrowserOperatorRuntimeView[];
}

interface CoreRuntimeModule {
  BrowserOperatorRuntimeManager: new (options?: {
    onEvent?: (event: CoreRuntimeEvent) => void;
  }) => CoreRuntimeManager;
}

export interface BrowserOperatorRuntimeBridgeOptions {
  getWorkspaceRoot: () => string | null | undefined;
  loadRuntimeModule?: () => Promise<CoreRuntimeModule | null>;
  sendEvent?: (rendererId: number, event: BrowserOperatorRuntimeEvent) => void;
}

interface RuntimeOwner {
  rendererId: number;
  publicOwnerSessionId: string;
  coreOwnerSessionId: string;
}

const MAX_OWNER_LENGTH = 160;

/**
 * Main-process trust boundary for Browser Operator.
 *
 * A renderer cannot choose a filesystem root or forge another renderer's
 * owner id. The core runtime module stays lazy-loaded so Vite never bundles
 * Code Buddy core into the Electron main bundle.
 */
export class BrowserOperatorRuntimeBridge {
  private readonly options: BrowserOperatorRuntimeBridgeOptions;
  private readonly owners = new Map<string, RuntimeOwner>();
  private managerPromise: Promise<CoreRuntimeManager> | null = null;

  constructor(options: BrowserOperatorRuntimeBridgeOptions) {
    this.options = options;
  }

  async prepare(rendererId: number, input?: BrowserOperatorPrepareInput): Promise<BrowserOperatorPrepareResult> {
    try {
      const owner = requireOwner(rendererId, input?.ownerSessionId);
      if (!input?.draft || typeof input.draft !== 'object') {
        throw new Error('Browser Operator draft is required.');
      }
      const workspaceRoot = this.options.getWorkspaceRoot();
      if (!workspaceRoot) {
        throw new Error('Select an active project with a workspace before preparing Browser Operator.');
      }
      const manager = await this.manager();
      const runtime = manager.prepare({
        ownerSessionId: owner.coreOwnerSessionId,
        workspaceRoot,
        draft: input.draft,
      });
      this.owners.set(runtime.runtimeId, owner);
      const executableDraft = manager.getPreparedDraft(runtime.runtimeId, owner.coreOwnerSessionId);
      return {
        ok: true,
        runtime: publicView(runtime, owner.publicOwnerSessionId),
        draft: executableDraft as BrowserOperatorSessionDraftInput,
      };
    } catch (error) {
      return { ...failure(error), draft: null };
    }
  }

  async start(rendererId: number, input?: BrowserOperatorStartInput): Promise<BrowserOperatorRuntimeResult> {
    try {
      const { owner, runtimeId } = this.requireOwned(rendererId, input);
      if (!input?.expectedDraftHash?.trim() || !input.approvedBy?.trim()) {
        throw new Error('Draft hash and approving operator are required.');
      }
      const runtime = (await this.manager()).start({
        runtimeId,
        ownerSessionId: owner.coreOwnerSessionId,
        expectedDraftHash: input.expectedDraftHash,
        approvedBy: input.approvedBy,
      });
      return { ok: true, runtime: publicView(runtime, owner.publicOwnerSessionId) };
    } catch (error) {
      return failure(error);
    }
  }

  async stop(rendererId: number, input?: BrowserOperatorOwnedInput): Promise<BrowserOperatorStopResult> {
    try {
      const { owner, runtimeId } = this.requireOwned(rendererId, input);
      const manager = await this.manager();
      const stopped = manager.stop(runtimeId, owner.coreOwnerSessionId);
      const runtime = manager.status(runtimeId, owner.coreOwnerSessionId);
      return {
        ok: true,
        stopped,
        runtime: publicView(runtime, owner.publicOwnerSessionId),
      };
    } catch (error) {
      return { ...failure(error), stopped: false };
    }
  }

  async status(rendererId: number, input?: BrowserOperatorOwnedInput): Promise<BrowserOperatorRuntimeResult> {
    try {
      const { owner, runtimeId } = this.requireOwned(rendererId, input);
      const runtime = (await this.manager()).status(runtimeId, owner.coreOwnerSessionId);
      return { ok: true, runtime: publicView(runtime, owner.publicOwnerSessionId) };
    } catch (error) {
      return failure(error);
    }
  }

  async list(rendererId: number, ownerSessionId?: string): Promise<BrowserOperatorRuntimeListResult> {
    try {
      const owner = requireOwner(rendererId, ownerSessionId);
      const runtimes = (await this.manager())
        .list(owner.coreOwnerSessionId)
        .map((runtime) => publicView(runtime, owner.publicOwnerSessionId));
      return { ok: true, runtimes };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        runtimes: [],
      };
    }
  }

  private requireOwned(
    rendererId: number,
    input?: BrowserOperatorOwnedInput,
  ): { owner: RuntimeOwner; runtimeId: string } {
    const runtimeId = input?.runtimeId?.trim();
    if (!runtimeId) throw new Error('Browser Operator runtime id is required.');
    const owner = this.owners.get(runtimeId);
    if (!owner) throw new Error(`Browser Operator runtime not found: ${runtimeId}`);
    const requested = requireOwner(rendererId, input?.ownerSessionId);
    if (
      owner.rendererId !== rendererId ||
      owner.coreOwnerSessionId !== requested.coreOwnerSessionId
    ) {
      throw new Error('Browser Operator runtime owner mismatch.');
    }
    return { owner, runtimeId };
  }

  private manager(): Promise<CoreRuntimeManager> {
    this.managerPromise ??= this.createManager();
    return this.managerPromise;
  }

  private async createManager(): Promise<CoreRuntimeManager> {
    const module = await (this.options.loadRuntimeModule?.()
      ?? loadCoreModule<CoreRuntimeModule>('browser-automation/browser-operator-runtime.js'));
    if (!module?.BrowserOperatorRuntimeManager) {
      throw new Error('Browser Operator runtime module is unavailable. Build the Code Buddy core first.');
    }
    return new module.BrowserOperatorRuntimeManager({
      onEvent: (event) => {
        const owner = this.owners.get(event.runtime.runtimeId);
        if (!owner) return;
        this.options.sendEvent?.(owner.rendererId, {
          type: event.type,
          runtime: publicView(event.runtime, owner.publicOwnerSessionId),
          ...(event.action ? { action: event.action } : {}),
        });
      },
    });
  }
}

function requireOwner(rendererId: number, ownerSessionId: string | undefined): RuntimeOwner {
  if (!Number.isSafeInteger(rendererId) || rendererId <= 0) {
    throw new Error('Browser Operator renderer identity is invalid.');
  }
  const publicOwnerSessionId = ownerSessionId?.trim() ?? '';
  const hasControlCharacter = [...publicOwnerSessionId]
    .some((character) => character.charCodeAt(0) < 32);
  if (
    !publicOwnerSessionId ||
    publicOwnerSessionId.length > MAX_OWNER_LENGTH ||
    hasControlCharacter
  ) {
    throw new Error('Browser Operator owner session id is invalid.');
  }
  return {
    rendererId,
    publicOwnerSessionId,
    coreOwnerSessionId: `cowork:${rendererId}:${publicOwnerSessionId}`,
  };
}

function publicView(
  runtime: BrowserOperatorRuntimeView,
  publicOwnerSessionId: string,
): BrowserOperatorRuntimeView {
  return {
    ...runtime,
    ownerSessionId: publicOwnerSessionId,
    consent: runtime.consent
      ? { ...runtime.consent, scopes: [...runtime.consent.scopes] }
      : null,
  };
}

function failure(error: unknown): { ok: false; error: string; runtime: null } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    runtime: null,
  };
}
