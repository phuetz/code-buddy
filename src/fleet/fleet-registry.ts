/**
 * Fleet Registry — singleton store of active fleet listeners.
 *
 * Promoted from `src/commands/handlers/fleet-handler.ts` in Phase (d).17
 * so the LLM-facing tools (`peer_delegate`, `list_peers`) and the
 * system-prompt fleet nudge can read connected-peer state without
 * importing the command-handler layer (a sibling, not a dependency).
 *
 * Both the slash handler and the tools are now consumers of this
 * singleton. Comportement unchanged from the user's perspective.
 *
 * @module src/fleet/fleet-registry
 */

/**
 * Public structural shape of FleetListener — narrowed to what consumers
 * (slash handler + tools) actually need. The real FleetListener class in
 * `src/fleet/fleet-listener.ts` satisfies this shape structurally; we
 * keep the interface here so `fleet-registry.ts` doesn't depend on the
 * full listener module (avoids pulling ws at handler-load time).
 */
export interface FleetListenerPublicAPI {
  /** Actual transport state when supplied by the listener. */
  isConnected?: () => boolean;
  disconnect: () => Promise<void>;
  getReconnectAttempts: () => number;
  isReconnecting: () => boolean;
  /** Phase (d).13 — peer RPC invoker. Resolves with payload or rejects with a code-bearing Error. */
  request: (
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number; traceId?: string; depth?: number },
  ) => Promise<unknown>;
  /** Phase (d).19 — streaming variant; onChunk fires for every peer:chunk frame. */
  requestStream?: (
    method: string,
    params: Record<string, unknown>,
    onChunk: (delta: string) => void,
    options?: { timeoutMs?: number; traceId?: string; depth?: number },
  ) => Promise<unknown>;
  /** Phase (d).23 / V1.3 — convenience wrapper around peer.tool.invoke. */
  invokeTool?: (
    toolName: string,
    args?: Record<string, unknown>,
    options?: { timeoutMs?: number; traceId?: string; depth?: number },
  ) => Promise<{ tool: string; output: string; durationMs: number; truncated?: boolean }>;
  /** Phase (d).23 / V1.3 — streaming variant; onChunk fires for every peer:chunk frame. */
  invokeToolStream?: (
    toolName: string,
    args: Record<string, unknown>,
    onChunk: (delta: string) => void,
    options?: { timeoutMs?: number; traceId?: string; depth?: number },
  ) => Promise<{ tool: string; output: string; durationMs: number; truncated?: boolean }>;
  getLastSeen: () => { at: number | null; reason: string | null; ageMs: number | null };
  isStale: (thresholdMs?: number) => boolean;
  getPeerCompactionState: () => {
    active: boolean;
    startedAt: number | null;
    ageMs: number | null;
    lastResult: {
      success?: boolean;
      originalTokens?: number;
      compactedTokens?: number;
      messagesRemoved?: number;
      strategy?: string;
      durationMs?: number;
      completedAt: number;
    } | null;
  };
  getEventHistory: () => readonly {
    at: number;
    type: string;
    payload: Record<string, unknown>;
    hostname?: string;
    agentId?: string;
  }[];
}

/** One registered peer connection. Mirror of the previous `ActiveListener` interface. */
export interface ActiveListenerEntry {
  /** Stable peer id (the Map key). Used by /fleet stop, /fleet history, and the tools. */
  id: string;
  url: string;
  startedAt: Date;
  eventCount: number;
  autoReconnect: boolean;
  /** Tighter cap than the manager default; stored for /fleet status display. */
  maxAttempts: number;
  listener: FleetListenerPublicAPI;
}

class FleetRegistryImpl {
  private readonly entries = new Map<string, ActiveListenerEntry>();

  register(entry: ActiveListenerEntry): void {
    this.entries.set(entry.id, entry);
  }

  unregister(id: string): boolean {
    return this.entries.delete(id);
  }

  get(id: string): ActiveListenerEntry | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  list(): ActiveListenerEntry[] {
    return [...this.entries.values()];
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

let instance: FleetRegistryImpl | null = null;

export function getFleetRegistry(): FleetRegistryImpl {
  if (instance === null) instance = new FleetRegistryImpl();
  return instance;
}

/** Test-only — drops the singleton so the next getFleetRegistry() rebuilds. */
export function _resetFleetRegistryForTests(): void {
  instance = null;
}
