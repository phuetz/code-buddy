/**
 * Council types — the data contracts of the 8-step deliberation pipeline.
 *
 * The pipeline itself lives in `council-engine.ts` (host-agnostic: takes
 * injected dependencies, returns a `CouncilRunResult`); the CLI presenter in
 * `src/commands/council.ts` only renders these types. Keeping the contracts
 * here lets any host (server, Cowork, voice loop, sagas) consume a council
 * run as data without importing CLI code.
 *
 * @module council/types
 */

import type { ModelStrength } from '../fleet/types.js';
import type { ConsensusSummary } from '../fleet/result-aggregator.js';
import type { ModelScoreboard } from '../fleet/model-scoreboard.js';
import type { DeliberationHealth } from './deliberation-health.js';

/** One usable LLM as exposed by the active-LLM registry. */
export interface CouncilCandidate {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  costInputUsdPerMtok: number;
}

export interface RankedCandidate {
  c: CouncilCandidate;
  strengths: ModelStrength[];
  score: number;
  /** Raw historical win rate (0-1), display only — selection uses selectionBias. */
  hist: number;
}

export interface CouncilOptions {
  /** How many models to consult (default 3). */
  count?: number;
  /** Comma list of provider/model substrings to restrict candidates. */
  models?: string;
  /** Provider/model substring to use as the judge (default: a neutral strong model). */
  judge?: string;
  /** Override the inferred task type. */
  taskType?: string;
  /** commander sets this false on --no-consensus. */
  consensus?: boolean;
  /** Just print the learned scoreboard and exit. */
  scoreboard?: boolean;
  /** Also consult connected fleet peers (other machines' Code Buddy) via peer.chat. */
  fleet?: boolean;
  /** Use adaptive conductor roles instead of asking every model the exact same prompt. Default true. */
  conductor?: boolean;
  /** Use a final synthesis pass for collective conductor runs. Default true. */
  synthesis?: boolean;
  /** Inject peer connections (tests/scripts); else read getFleetRegistry().list(). */
  fleetPeers?: CouncilPeer[];
  /** Per-peer timeout for the fleet round-trip (default = council timeout). */
  peerTimeoutMs?: number;
}

// --- conductor roles ---

export interface CouncilRole {
  id: string;
  label: string;
  mission: string;
  focus: string[];
}

export interface CouncilConductorPlan {
  mode: 'direct' | 'collective';
  reason: string;
  roles: CouncilRole[];
}

// --- chat surface ---

/** Normalised chat result the council needs from any LLM client. */
export interface CouncilChatResult {
  content: string;
  promptTokens: number;
  totalTokens: number;
}

/**
 * Minimal chat surface consumed by the engine. `CodeBuddyClient` is adapted
 * to this in the presenter; tests inject plain objects.
 */
export interface CouncilChatClient {
  chat(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    options?: { signal?: AbortSignal },
  ): Promise<CouncilChatResult>;
}

// --- answers ---

export type CouncilAnswerSource =
  | { kind: 'local'; provider: string; model: string }
  | { kind: 'peer'; peerId: string; model: string };

export interface CouncilAnswer {
  source: CouncilAnswerSource;
  /** Model id locally, `peerId:model` for fleet peers — the judged display name. */
  displayName: string;
  role?: CouncilRole;
  content: string;
  latencyMs: number;
  tokensUsed: number;
  costUsd: number;
}

// --- judge ---

export interface JudgeVerdict {
  /** 'abstained' = no reliable verdict (non-JSON, timeout, no judge) — never a fabricated winner. */
  kind: 'judged' | 'abstained';
  winnerIdx: number | null;
  /** Task-fit scores (0-1) — the winner is chosen on these. */
  scores: number[];
  /**
   * Role-fit scores (0-1) — did each answer hold its announced role (a critic
   * exposing precise breaking conditions holds its role even without a full
   * answer)? Feeds the scoreboard's role learning so specialised roles are no
   * longer punished for doing their job. Falls back to `scores` when the
   * judge only returned single scores.
   */
  roleScores: number[];
  rationale: string;
  /** What the judge re-verified itself (counts, computations) — '' when nothing. */
  verified: string;
  judgeModel: string | null;
  /** False when the judge is itself a panel member — display-only, never trains the scoreboard. */
  neutral: boolean;
  /** True when the judge CALL failed (timeout/transport) — the judge model itself is penalised. */
  judgeCallFailed?: boolean;
}

// --- signals / synthesis ---

export interface CouncilDecisionSignals {
  confidence: 'high' | 'medium' | 'low';
  winnerScore: number;
  runnerUpScore: number;
  margin: number;
  consensusScore: number;
  reasons: string[];
}

export interface CouncilSynthesisCandidate {
  modelName: string;
  roleLabel?: string;
  score: number;
  winner: boolean;
  content: string;
}

export interface CouncilSynthesisPrompt {
  system: string;
  user: string;
}

// --- fleet peers ---

export interface CouncilPeer {
  id: string;
  listener: {
    request: (method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }) => Promise<unknown>;
  };
}

export interface PeerAnswer {
  modelId: string;
  modelName: string;
  content: string;
  latency: number;
  tokensUsed: number;
  cost: number;
  role?: CouncilRole;
}

export interface GatherPeerAnswersOptions {
  promptForPeer?: (peer: CouncilPeer, index: number) => string;
  roleForPeer?: (peer: CouncilPeer, index: number) => CouncilRole | undefined;
}

// --- engine ---

export type CouncilProgressEvent =
  | {
      type: 'panel';
      taskType: string;
      entries: Array<{ model: string; histWinRate: number }>;
      peerCount: number;
      /** Model granted the ε-exploration seat this run, if any. */
      explored?: string;
    }
  | { type: 'conductor'; roles: string[] }
  | { type: 'fleet_no_peers' }
  | { type: 'fleet_consulting'; peerCount: number }
  | { type: 'answer_failed'; source: string; error: string }
  /**
   * Cheap triage verdict (opt-in `CODEBUDDY_COUNCIL_TRIAGE`). `single` = the
   * question was classified simple enough for one model and the expensive
   * fan-out was skipped; `council` = the full deliberation runs as usual.
   */
  | { type: 'triage'; decision: 'single' | 'council'; model?: string; reason?: string };

/**
 * A cheap triage-stage model pick — the minimal shape the engine needs to
 * build a client and short-circuit to a single answer. Structurally a subset
 * of `fleet/model-selector.ts`'s `ModelSelection` so the default selector
 * (`selectFastestModel`) adapts trivially.
 */
export interface TriageModelSelection {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  isLocal: boolean;
  reason: string;
}

export interface CouncilEngineDeps {
  /** Thunk (not a value) so hosts keep the lazy registry import until a run actually starts. */
  loadRegistry: () => Promise<CouncilCandidate[]>;
  scoreboard: ModelScoreboard;
  clientFactory: (c: CouncilCandidate) => CouncilChatClient;
  /** Fleet peers to consult when opts.fleet is set (empty array = none connected). */
  peers: CouncilPeer[];
  /** Injectable randomness (judge shuffle + exploration seat) for deterministic tests. */
  rng?: () => number;
  /** Per-model wall-clock cap; default CODEBUDDY_COUNCIL_TIMEOUT_MS or 45s. */
  timeoutMs?: number;
  peerTimeoutMs?: number;
  /** ε for the exploration seat; default CODEBUDDY_COUNCIL_EXPLORE or 0.1. */
  exploreEpsilon?: number;
  /** Injectable clock for deterministic outcome timestamps. */
  now?: () => Date;
  /**
   * Where to persist the per-run deliberation-health record (DHI). The engine
   * only computes and hands it over — file IO is host policy (the CLI
   * presenter appends to ~/.codebuddy/council-deliberation-health.jsonl).
   */
  healthSink?: (health: DeliberationHealth) => void;
  /**
   * Cheap triage-stage model selector, used only when `CODEBUDDY_COUNCIL_TRIAGE`
   * is on. Defaults to a wrapper over `fleet/model-selector.ts selectFastestModel`
   * (latency-routed, local/free-preferable). Injected in tests to stay offline.
   */
  selectTriageModel?: (
    task: string,
    opts: { localOnly?: boolean; preferModel?: string; env?: NodeJS.ProcessEnv },
  ) => Promise<TriageModelSelection | null>;
  /** Env source for triage flags (tests inject a plain object). Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export interface CouncilRunResult {
  taskType: string;
  plan: CouncilConductorPlan;
  answers: CouncilAnswer[];
  failures: Array<{ source: string; error: string }>;
  verdict: JudgeVerdict;
  consensus: ConsensusSummary;
  signals: CouncilDecisionSignals;
  synthesis: string | null;
  /** synthesis ?? judged winner ?? labelled concatenation of all answers. */
  finalText: string;
  /** True when this run's outcomes were recorded to the scoreboard. */
  learned: boolean;
  learnSkipReason?: string;
  /** Per-run deliberation-health metrics (DHI) — see council/deliberation-health.ts. */
  health: DeliberationHealth;
  /**
   * True when the cheap triage stage short-circuited the run to a single model
   * (no multi-model fan-out). Only ever set when `CODEBUDDY_COUNCIL_TRIAGE` is
   * on; absent/undefined for every normal deliberation (OFF = unchanged shape).
   */
  triaged?: boolean;
  /** The single model that answered when `triaged` — provenance for consumers. */
  singleModel?: string;
  /** The triage classifier's short reason for choosing SINGLE. */
  triageReason?: string;
}

export class CouncilError extends Error {
  constructor(
    readonly code: 'no-candidates' | 'all-failed',
    message: string,
  ) {
    super(message);
    this.name = 'CouncilError';
  }
}
