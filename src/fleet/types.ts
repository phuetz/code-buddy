/**
 * Fleet — shared type definitions.
 *
 * Centralises types used across the fleet subsystem: capability
 * advertising, dispatch envelopes, saga state. Kept in its own file
 * (vs. inlined in fleet-listener.ts) so other modules can import
 * without pulling the full WS client.
 *
 * @module fleet/types
 */

import type { ModelStrength } from '../config/model-strengths.js';

/** Provider families a peer can talk to. */
export type FleetProvider =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'gemini-cli'   // wraps the local `gemini` binary (Ultra subscription)
  | 'agy-cli'      // wraps Google Antigravity (cloud subscription)
  | 'ollama'
  | 'lemonade'     // local Ryzen NPU/GPU/CPU OpenAI-compatible server
  | 'openrouter'
  | 'lm-studio'
  | 'chatgpt-oauth'
  | 'grok'
  | 'mistral'
  | 'unknown';

/**
 * Strengths a model is known for. Used by the task router (Fleet P3)
 * to score `model.strengths` vs `task.requires`. The union itself lives
 * in `config/model-strengths.ts` (single source of truth alongside
 * `model-tools.ts`); re-exported here so fleet importers keep working.
 */
export type { ModelStrength } from '../config/model-strengths.js';

/**
 * Egress class describes where the network call physically goes.
 * Critical for privacy routing — a `cloud` egress can leak code to
 * a third party, while `local` stays on the box.
 *
 * - `local`  : same machine, loopback only (Ollama on 127.0.0.1)
 * - `lan`    : same physical / Tailscale network (peer Code Buddy on
 *              another machine)
 * - `cloud`  : public internet (Anthropic API, OpenAI API, Gemini API)
 */
export type FleetEgress = 'local' | 'lan' | 'cloud';

/**
 * One model entry advertised by a peer. The peer enumerates these
 * from its local config (Ollama daemon list, configured cloud keys,
 * etc.) and surfaces them through `peer.describe`.
 */
export interface FleetModelDescriptor {
  /** Provider-side model id, e.g., 'claude-opus-4', 'qwen3.6:35b-a3b-q4_K_M'. */
  id: string;
  /** Native context window in tokens. Used to gate long-context tasks. */
  contextWindow: number;
  /** Heuristic strengths derived from `getModelToolConfig()` glob matches. */
  strengths: ModelStrength[];
  /** Public price (USD per million input tokens). Omitted for local. */
  costInputUsdPerMtok?: number;
  /** Public price (USD per million output tokens). Omitted for local. */
  costOutputUsdPerMtok?: number;
  /** Rolling avg first-token latency in ms (best-effort sample). */
  avgLatencyMs?: number;
  /** Provider family — see `FleetProvider`. */
  provider: FleetProvider;
}

/**
 * Aggregate capability advertised by a single peer. The router uses
 * this to score "which peer + which model is best for this task".
 */
export interface PeerCapability {
  /** All models this peer can route to today. Empty when it has no
      provider keys configured (yet still useful as a fleet observer). */
  models: FleetModelDescriptor[];
  /** Where this peer makes its outbound LLM calls — privacy gate. */
  egress: FleetEgress;
  /** Stable label the user gave the machine (`ministar`, `darkstar`, …). */
  machineLabel: string;
  /**
   * Lightweight machine spec for routing. Optional — a peer may not
   * know its own GPU on Windows without WMI permissions.
   */
  machineSpec?: {
    cpu?: string;
    /** GPU family / model. e.g., 'RTX 3090 ×2', 'Radeon 890M iGPU'. */
    gpu?: string;
    /** RAM in GB. */
    ramGb?: number;
  };
  /**
   * Max concurrent LLM calls this peer is willing to serve. Used by
   * the router's `load` term in scoring. Fall back to `1` if not set.
   */
  maxConcurrency?: number;
  /** Currently in-flight requests — populated dynamically (not from describe). */
  activeRequests?: number;
  /**
   * Hermes-style role tags this peer self-advertises. Values mirror
   * dispatch profile names (`'code' | 'review' | 'research' | 'safe' | 'balanced'`).
   *
   * Populated by `capability-registry.ts`:
   *   1. explicit `CODEBUDDY_FLEET_ROLES` env (CSV) when set, or
   *   2. heuristic from model strengths: `code` strength → `'code'`,
   *      `reasoning` → `'review'` + `'research'`, `cheap`/`fast` → `'safe'`,
   *      default → `'balanced'`.
   *
   * The task router (`task-router.ts`) applies a match-score bonus when
   * a `DispatchConstraints.requiredRole` overlaps with this peer's
   * roles — that's how a `Draft → Review → Test` chain steers each
   * step to the peer best suited for it without hard-coding peer ids.
   */
  roles?: string[];
}
