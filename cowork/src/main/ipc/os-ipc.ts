import { ipcMain } from 'electron';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { GoalStore } from '../../../../src/goals/goal-store.js';
import { normalizeGoalState, type GoalState } from '../../../../src/goals/goal-state.js';
import { buildIntentGraph } from '../../../../src/goals/intent-graph.js';
import { deriveIntentProgress } from '../../../../src/goals/criterion-progress.js';
import { CounterfactualForge } from '../../../../src/goals/counterfactual-forge.js';
import { ProofLedger } from '../../../../src/goals/proof-ledger.js';
import { ProvenOutcomeStore } from '../../../../src/goals/proven-outcome-memory.js';
import { MissionConstitutionStore } from '../../../../src/goals/mission-constitution.js';
import { MissionExchange } from '../../../../src/goals/mission-exchange.js';
import { ShadowTwinStore } from '../../../../src/goals/shadow-twin.js';
import { OutcomeCapsuleStore } from '../../../../src/goals/outcome-capsule.js';
import type {
  OsCapsuleActivateInput,
  OsCapsuleCreateInput,
  OsCapsuleRevokeInput,
  OsConstitutionUpdateInput,
  OsExchangeAwardInput,
  OsExchangeBidInput,
  OsExchangeRehearseInput,
  OsExchangeRejectInput,
  OsForgeCreateInput,
  OsForgeEvaluateInput,
  OsForgeSelectInput,
  OsIntentActionResult,
  OsIntentProofInput,
  OsIntentProofPayload,
} from '../../shared/intent-proof-types.js';
import type {
  AutonomyMorningBriefArtifact,
  OsAutonomyBriefingPayload,
} from '../../shared/autonomy-briefing-ipc.js';

/**
 * Mission Control OS data bridge — reads the REAL Code Buddy ledgers the CLI
 * council writes (no mock data, fail-open on missing/corrupt files):
 *
 * - `~/.codebuddy/council-deliberation-health.jsonl` — one line per council
 *   run (Deliberation Health Index + run stats), written by the core's
 *   `src/council/deliberation-health.ts`.
 * - `~/.codebuddy/fleet-model-performance.jsonl` — the model scoreboard (one
 *   line per seated model per run: quality, role, latency, cost).
 *
 * Both files belong to the CLI; Cowork only READS them.
 */

interface CouncilHealthLine {
  at: string;
  taskType?: string;
  planMode?: string;
  seats?: number;
  answers?: number;
  judgeAlive?: number;
  dhi?: number;
}

interface ScoreboardLine {
  at: string;
  taskType?: string;
  model?: string;
  provider?: string;
  role?: string;
  won?: boolean;
  quality?: number;
  latencyMs?: number;
  costUsd?: number;
  failed?: boolean;
}

export interface OsCouncilVerdict {
  agentId: string;
  model: string;
  label: string;
  score: number;
  stance: 'approve' | 'revise' | 'reject';
}

export interface OsCouncilSession {
  id: string;
  title: string;
  dhi: number;
  verdicts: OsCouncilVerdict[];
}

export interface OsCouncilHealthPayload {
  session: OsCouncilSession | null;
  /** DHI history, oldest → newest (for trend rendering). */
  history: Array<{ at: string; taskType: string; dhi: number }>;
}

/** A scoreboard entry belongs to a run when written within this window. */
const RUN_MATCH_WINDOW_MS = 90_000;
const MAX_AUTONOMY_BRIEF_BYTES = 1024 * 1024;

function codebuddyDir(): string {
  const configured = process.env.CODEBUDDY_HOME?.trim();
  if (configured) return path.resolve(configured);
  return path.join(os.homedir(), '.codebuddy');
}

function fleetColabDir(): string {
  const configured = process.env.CODEBUDDY_FLEET_COLAB_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(codebuddyDir(), 'fleet');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Strict enough to reject corrupt/stale foreign JSON before it reaches React. */
function isAutonomyMorningBrief(value: unknown): value is AutonomyMorningBriefArtifact {
  if (!isRecord(value)) return false;
  if (value.kind !== 'codebuddy_autonomy_morning_brief' || value.schemaVersion !== 1) return false;
  if (
    typeof value.briefingDate !== 'string'
    || typeof value.generatedAt !== 'string'
    || typeof value.sourceDir !== 'string'
    || typeof value.ledgerPath !== 'string'
  ) return false;
  if (!isRecord(value.window) || typeof value.window.from !== 'string' || typeof value.window.to !== 'string') return false;
  if (!isRecord(value.summary) || !isRecord(value.queue)) return false;
  const summary = value.summary;
  const queue = value.queue;
  const summaryKeys = [
    'observedTicks',
    'completed',
    'failed',
    'selfImproved',
    'maintenanceChecks',
    'goalContinuations',
    'paidModelRuns',
    'worklogEntries',
  ];
  const queueKeys = ['total', 'open', 'inProgress', 'completed', 'blocked', 'criticalAwaitingOperator'];
  if (!summaryKeys.every((key) => isFiniteNumber(summary[key]))) return false;
  if (!queueKeys.every((key) => isFiniteNumber(queue[key]))) return false;
  return Array.isArray(value.notableEvents)
    && Array.isArray(value.worklog)
    && Array.isArray(value.opportunities)
    && Array.isArray(value.guardrails);
}

/**
 * Read the daemon-owned latest briefing from its fixed, main-process-resolved
 * fleet directory. The renderer cannot pass a path, so this bridge cannot be
 * used as an arbitrary file reader.
 */
export async function readAutonomyMorningBriefing(
  dir = fleetColabDir(),
): Promise<OsAutonomyBriefingPayload | null> {
  const briefingDir = path.join(path.resolve(dir), 'briefings');
  const jsonPath = path.join(briefingDir, 'latest.json');
  const markdownPath = path.join(briefingDir, 'latest.md');
  try {
    const stat = await fs.stat(jsonPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_AUTONOMY_BRIEF_BYTES) return null;
    const parsed: unknown = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    if (!isAutonomyMorningBrief(parsed)) return null;
    return { brief: parsed, jsonPath, markdownPath };
  } catch {
    return null;
  }
}

async function readJsonlLines<T>(file: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const out: T[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as T);
      } catch {
        // one corrupt line never hides the rest of the ledger
      }
    }
    return out;
  } catch {
    return [];
  }
}

function toVerdict(entry: ScoreboardLine, index: number): OsCouncilVerdict | null {
  if (!entry.model || typeof entry.quality !== 'number') return null;
  const score = Math.max(0, Math.min(1, entry.quality));
  return {
    // Role qualifies the id — the same model can sit twice (member + reviewer).
    agentId: `${entry.provider ?? 'unknown'}:${entry.model}:${entry.role ?? index}`,
    model: entry.model,
    label: entry.role ? `${entry.model} · ${entry.role}` : entry.model,
    score,
    stance: entry.won ? 'approve' : score >= 0.5 ? 'revise' : 'reject',
  };
}

/** The latest council run as an arena session, plus the DHI history. */
export async function readCouncilHealth(historyLimit = 20, dir = codebuddyDir()): Promise<OsCouncilHealthPayload> {
  const health = await readJsonlLines<CouncilHealthLine>(path.join(dir, 'council-deliberation-health.jsonl'));
  const valid = health.filter((line) => typeof line.at === 'string' && typeof line.dhi === 'number');
  if (valid.length === 0) return { session: null, history: [] };

  const last = valid[valid.length - 1]!;
  const lastAt = Date.parse(last.at);

  const scoreboard = await readJsonlLines<ScoreboardLine>(path.join(dir, 'fleet-model-performance.jsonl'));
  const verdicts = scoreboard
    .filter((entry) => {
      const at = Date.parse(entry.at ?? '');
      return Number.isFinite(at) && Math.abs(at - lastAt) <= RUN_MATCH_WINDOW_MS && !entry.failed;
    })
    .map((entry, index) => toVerdict(entry, index))
    .filter((v): v is OsCouncilVerdict => v !== null);

  return {
    session: {
      id: last.at,
      title: `Council · ${last.taskType ?? 'run'} (${last.answers ?? 0}/${last.seats ?? 0} sièges)`,
      dhi: last.dhi ?? 0,
      verdicts,
    },
    history: valid.slice(-historyLimit).map((line) => ({
      at: line.at,
      taskType: line.taskType ?? 'run',
      dhi: line.dhi ?? 0,
    })),
  };
}

// ---------------------------------------------------------------------------
// Collective Knowledge Graph — read the append-only CKG ledger
// (~/.codebuddy/collective/ckg-ledger.jsonl, written by the core's
// collective-knowledge-graph.ts). Read-only fold: last write per id wins,
// tombstones/retracts drop the id.
// ---------------------------------------------------------------------------

interface CkgLedgerLine {
  kind?: string;
  id?: string;
  type?: string;
  name?: string;
  text?: string;
  confidence?: number;
  sourceId?: string;
  targetId?: string;
  relType?: string;
}

export interface OsKnowledgeNode {
  id: string;
  type: 'lesson' | 'decision' | 'fact' | 'discovery';
  label: string;
  confidence?: number;
}

export interface OsKnowledgeEdge {
  from: string;
  to: string;
  kind: string;
}

export interface OsKnowledgeGraphPayload {
  nodes: OsKnowledgeNode[];
  edges: OsKnowledgeEdge[];
  /** True when nodes were dropped to respect maxNodes. */
  truncated: boolean;
}

const KNOWN_NODE_TYPES = new Set(['lesson', 'decision', 'fact', 'discovery']);

/** Fold the CKG ledger into current nodes + edges (newest last). */
export async function readKnowledgeGraph(maxNodes = 4000, dir = codebuddyDir()): Promise<OsKnowledgeGraphPayload> {
  const lines = await readJsonlLines<CkgLedgerLine>(path.join(dir, 'collective', 'ckg-ledger.jsonl'));
  const nodes = new Map<string, OsKnowledgeNode>();
  const edges: OsKnowledgeEdge[] = [];

  for (const line of lines) {
    if (line.kind === 'entity' && line.id && KNOWN_NODE_TYPES.has(line.type ?? '')) {
      nodes.delete(line.id); // re-insert so the LAST write also gets the newest position
      nodes.set(line.id, {
        id: line.id,
        type: line.type as OsKnowledgeNode['type'],
        label: (line.name || line.text || line.id).slice(0, 160),
        ...(typeof line.confidence === 'number' ? { confidence: line.confidence } : {}),
      });
    } else if (line.kind === 'relation' && line.sourceId && line.targetId) {
      edges.push({ from: line.sourceId, to: line.targetId, kind: line.relType ?? 'related_to' });
    } else if ((line.kind === 'tombstone' || line.kind === 'retract') && line.id) {
      nodes.delete(line.id);
    }
  }

  const all = Array.from(nodes.values());
  const truncated = all.length > maxNodes;
  // Newest entries are the most relevant in the cockpit — keep the tail.
  const kept = truncated ? all.slice(all.length - maxNodes) : all;
  const keptIds = new Set(kept.map((n) => n.id));
  return {
    nodes: kept,
    edges: edges.filter((e) => keptIds.has(e.from) && keptIds.has(e.to)),
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Code Buddy 2.0 Intent Graph + Proof Ledger. GoalState stays the only
// persisted mission source; Cowork reads a deterministic graph projection and
// the append-only proof ledger. No renderer-side filesystem access.
// ---------------------------------------------------------------------------

function safeProofLimit(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value === undefined || value <= 0) return 50;
  return Math.min(value, 200);
}

function safeSessionId(value: string | undefined): string {
  if (typeof value !== 'string') return '';
  const clean = value.trim();
  return clean && clean.length <= 256 && !clean.includes('\0') ? clean : '';
}

async function readLatestGoalState(goalsDir: string): Promise<GoalState | null> {
  try {
    const entries = await fs.readdir(goalsDir, { withFileTypes: true });
    const states = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => {
          try {
            const raw = await fs.readFile(path.join(goalsDir, entry.name), 'utf8');
            return normalizeGoalState(JSON.parse(raw));
          } catch {
            return null;
          }
        }),
    );
    return states
      .filter((state): state is GoalState => Boolean(state && state.status !== 'cleared'))
      .sort(
        (left, right) =>
          (right.lastTurnAt || right.createdAt) - (left.lastTurnAt || left.createdAt),
      )[0] ?? null;
  } catch {
    return null;
  }
}

async function resolveIntentState(
  input: Pick<OsIntentProofInput, 'sessionId'>,
  dir: string,
): Promise<{ source: OsIntentProofPayload['source']; state: GoalState | null }> {
  const goalsDir = path.join(dir, 'goals');
  const sessionId = safeSessionId(input.sessionId);
  if (sessionId) {
    const store = new GoalStore({ storeDir: goalsDir });
    const state = store.load(`cowork:${sessionId}`) ?? store.load(sessionId);
    return {
      source: state && state.status !== 'cleared' ? 'cowork-session' : 'none',
      state: state?.status === 'cleared' ? null : state,
    };
  }
  const state = await readLatestGoalState(goalsDir);
  return { source: state ? 'latest' : 'none', state };
}

export async function readIntentProof(
  input: OsIntentProofInput = {},
  dir = codebuddyDir(),
): Promise<OsIntentProofPayload> {
  const { source, state } = await resolveIntentState(input, dir);

  if (!state) {
    return {
      source: 'none',
      state: null,
      graph: null,
      progress: null,
      proofs: [],
      integrity: { status: 'empty', checked: 0, legacy: 0, errors: [] },
      forgeBranches: [],
      outcomes: [],
      constitution: null,
      exchangeBids: [],
      shadowRehearsals: [],
      capsules: [],
    };
  }

  const proofLedger = new ProofLedger(state.goalId, { storeDir: path.join(dir, 'proofs') });
  const proofs = proofLedger.list(safeProofLimit(input.proofLimit));
  const graph = buildIntentGraph(state);
  const forgeBranches = new CounterfactualForge(state.goalId, {
    storeDir: path.join(dir, 'forge'),
  }).list();
  const outcomes = new ProvenOutcomeStore({
    filePath: path.join(dir, 'outcomes', 'proven-outcomes.jsonl'),
  }).list(state.goalId, 20);
  const constitutionStore = new MissionConstitutionStore(state.goalId, {
    storeDir: path.join(dir, 'constitutions'),
  });
  const constitution = constitutionStore.get(graph);
  const exchange = new MissionExchange(state.goalId, { storeDir: path.join(dir, 'exchange') });
  const shadowRehearsals = new ShadowTwinStore(state.goalId, {
    storeDir: path.join(dir, 'shadows'),
  }).list(200);
  const exchangeBids = exchange.rank(graph, constitution, shadowRehearsals);
  const capsuleStore = new OutcomeCapsuleStore({
    filePath: path.join(dir, 'capsules', 'outcome-capsules.jsonl'),
  });

  return {
    source,
    state: {
      goalId: state.goalId,
      goal: state.goal,
      status: state.status,
      turnsUsed: state.turnsUsed,
      maxTurns: state.maxTurns,
      verifyGated: state.verifyGated === true,
      ...(state.lastVerdict ? { lastVerdict: state.lastVerdict } : {}),
      ...(state.lastReason ? { lastReason: state.lastReason } : {}),
    },
    graph,
    progress: deriveIntentProgress(graph, proofs),
    proofs,
    integrity: proofLedger.verifyIntegrity(),
    forgeBranches,
    outcomes,
    constitution,
    exchangeBids,
    shadowRehearsals,
    capsules: capsuleStore.list(state.goalId, 100),
    ledgerPath: proofLedger.getFilePath(),
  };
}

async function forgeActionResult(
  input: Pick<OsIntentProofInput, 'sessionId'>,
  action: (state: GoalState, forge: CounterfactualForge) => void,
  dir = codebuddyDir(),
): Promise<OsIntentActionResult> {
  try {
    const { state } = await resolveIntentState(input, dir);
    if (!state) {
      return { ok: false, error: 'No durable intent for this session.', payload: await readIntentProof(input, dir) };
    }
    const forge = new CounterfactualForge(state.goalId, { storeDir: path.join(dir, 'forge') });
    action(state, forge);
    return { ok: true, payload: await readIntentProof(input, dir) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      payload: await readIntentProof(input, dir),
    };
  }
}

export function createIntentForgeBranch(
  input: OsForgeCreateInput,
  dir = codebuddyDir(),
): Promise<OsIntentActionResult> {
  return forgeActionResult(input, (state, forge) => {
    forge.create(buildIntentGraph(state), {
      label: input.label,
      hypothesis: input.hypothesis,
      strategy: input.strategy,
      ...(input.parentBranchId ? { parentBranchId: input.parentBranchId } : {}),
    });
  }, dir);
}

export function evaluateIntentForgeBranch(
  input: OsForgeEvaluateInput,
  dir = codebuddyDir(),
): Promise<OsIntentActionResult> {
  return forgeActionResult(input, (state, forge) => {
    const graph = buildIntentGraph(state);
    const proofs = new ProofLedger(state.goalId, { storeDir: path.join(dir, 'proofs') }).list(1000);
    forge.evaluate(input.branchId, {
      graph,
      proofs,
      ...(input.proofIds ? { proofIds: input.proofIds } : {}),
      ...(input.quality !== undefined ? { quality: input.quality } : {}),
      ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
      ...(input.costUsd !== undefined ? { costUsd: input.costUsd } : {}),
      ...(input.regressions ? { regressions: input.regressions } : {}),
    });
  }, dir);
}

export function selectIntentForgeBranch(
  input: OsForgeSelectInput,
  dir = codebuddyDir(),
): Promise<OsIntentActionResult> {
  return forgeActionResult(input, (_state, forge) => {
    const selected = forge.select(input.branchId);
    if (!selected) throw new Error('No eligible branch. Full criterion proof coverage is required.');
  }, dir);
}

async function sovereignActionResult(
  input: Pick<OsIntentProofInput, 'sessionId'>,
  action: (state: GoalState, graph: ReturnType<typeof buildIntentGraph>, dir: string) => void,
  dir = codebuddyDir(),
): Promise<OsIntentActionResult> {
  try {
    const { state } = await resolveIntentState(input, dir);
    if (!state) {
      return { ok: false, error: 'No durable intent for this session.', payload: await readIntentProof(input, dir) };
    }
    action(state, buildIntentGraph(state), dir);
    return { ok: true, payload: await readIntentProof(input, dir) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      payload: await readIntentProof(input, dir),
    };
  }
}

export function updateIntentConstitution(
  input: OsConstitutionUpdateInput,
  dir = codebuddyDir(),
): Promise<OsIntentActionResult> {
  return sovereignActionResult(input, (state, graph, root) => {
    new MissionConstitutionStore(state.goalId, {
      storeDir: path.join(root, 'constitutions'),
    }).set(graph, input);
  }, dir);
}

export function submitIntentExchangeBid(
  input: OsExchangeBidInput,
  dir = codebuddyDir(),
): Promise<OsIntentActionResult> {
  return sovereignActionResult(input, (state, graph, root) => {
    new MissionExchange(state.goalId, { storeDir: path.join(root, 'exchange') }).submit(graph, {
      label: input.label,
      provider: input.provider,
      model: input.model,
      origin: 'cowork',
      strategy: input.strategy,
      hypothesis: input.hypothesis,
      evidencePlan: input.evidencePlan,
      ...(input.criterionIds ? { criterionIds: input.criterionIds } : {}),
      prediction: { quality: input.quality, latencyMs: input.latencyMs, costUsd: input.costUsd },
      privacy: input.privacy,
      reversible: input.reversible,
      risk: input.risk,
    });
  }, dir);
}

export function rehearseIntentExchangeBid(
  input: OsExchangeRehearseInput,
  dir = codebuddyDir(),
): Promise<OsIntentActionResult> {
  return sovereignActionResult(input, (state, graph, root) => {
    const exchange = new MissionExchange(state.goalId, { storeDir: path.join(root, 'exchange') });
    const bid = exchange.get(input.bidId);
    if (!bid) throw new Error(`mission bid not found: ${input.bidId}`);
    const shadow = new ShadowTwinStore(state.goalId, { storeDir: path.join(root, 'shadows') });
    const rehearsal = shadow.record(graph, {
      bidId: bid.id,
      prediction: bid.prediction,
      observation: { quality: input.quality, latencyMs: input.latencyMs, costUsd: input.costUsd },
      reversibility: input.reversibility,
      ...(input.maxDrift !== undefined ? { maxDrift: input.maxDrift } : {}),
    });
    exchange.linkRehearsal(bid.id, rehearsal);
  }, dir);
}

export function awardIntentExchangeBid(
  input: OsExchangeAwardInput,
  dir = codebuddyDir(),
): Promise<OsIntentActionResult> {
  return sovereignActionResult(input, (state, graph, root) => {
    const constitution = new MissionConstitutionStore(state.goalId, {
      storeDir: path.join(root, 'constitutions'),
    }).get(graph);
    const shadows = new ShadowTwinStore(state.goalId, {
      storeDir: path.join(root, 'shadows'),
    }).list(1000);
    const forge = new CounterfactualForge(state.goalId, { storeDir: path.join(root, 'forge') });
    new MissionExchange(state.goalId, { storeDir: path.join(root, 'exchange') }).award(
      graph,
      constitution,
      shadows,
      input.bidId,
      {
        humanApproved: input.humanApproved === true,
        createForgeBranch: (bid) => forge.create(graph, {
          label: bid.label,
          hypothesis: bid.hypothesis,
          strategy: bid.strategy,
        }).id,
      },
    );
  }, dir);
}

export function rejectIntentExchangeBid(
  input: OsExchangeRejectInput,
  dir = codebuddyDir(),
): Promise<OsIntentActionResult> {
  return sovereignActionResult(input, (state, _graph, root) => {
    new MissionExchange(state.goalId, { storeDir: path.join(root, 'exchange') }).reject(input.bidId);
  }, dir);
}

export function createIntentCapsule(
  input: OsCapsuleCreateInput,
  dir = codebuddyDir(),
): Promise<OsIntentActionResult> {
  return sovereignActionResult(input, (state, graph, root) => {
    const outcome = new ProvenOutcomeStore({
      filePath: path.join(root, 'outcomes', 'proven-outcomes.jsonl'),
    }).get(input.outcomeId);
    if (!outcome || outcome.goalId !== state.goalId) throw new Error('proven outcome not found for this intent');
    const constitution = new MissionConstitutionStore(state.goalId, {
      storeDir: path.join(root, 'constitutions'),
    }).get(graph);
    const exchange = new MissionExchange(state.goalId, { storeDir: path.join(root, 'exchange') });
    const shadows = new ShadowTwinStore(state.goalId, { storeDir: path.join(root, 'shadows') }).list(1000);
    new OutcomeCapsuleStore({
      filePath: path.join(root, 'capsules', 'outcome-capsules.jsonl'),
    }).create({
      outcome,
      constitution,
      evaluations: exchange.rank(graph, constitution, shadows),
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.parameters ? { parameters: input.parameters } : {}),
      ...(input.requiredRuntimes !== undefined ? { requiredRuntimes: input.requiredRuntimes } : {}),
    });
  }, dir);
}

export function activateIntentCapsule(
  input: OsCapsuleActivateInput,
  dir = codebuddyDir(),
): Promise<OsIntentActionResult> {
  return sovereignActionResult(input, (_state, _graph, root) => {
    new OutcomeCapsuleStore({ filePath: path.join(root, 'capsules', 'outcome-capsules.jsonl') })
      .activate(input.capsuleId, input.humanApproved === true);
  }, dir);
}

export function revokeIntentCapsule(
  input: OsCapsuleRevokeInput,
  dir = codebuddyDir(),
): Promise<OsIntentActionResult> {
  return sovereignActionResult(input, (_state, _graph, root) => {
    new OutcomeCapsuleStore({ filePath: path.join(root, 'capsules', 'outcome-capsules.jsonl') })
      .revoke(input.capsuleId);
  }, dir);
}

export function registerOsIpcHandlers() {
  ipcMain.handle('os.autonomyBriefing', async () => readAutonomyMorningBriefing());

  ipcMain.handle('os.councilHealth', async (_event, historyLimit?: number) => {
    try {
      return await readCouncilHealth(historyLimit);
    } catch {
      return { session: null, history: [] } satisfies OsCouncilHealthPayload;
    }
  });

  ipcMain.handle('os.knowledgeGraph', async (_event, maxNodes?: number) => {
    try {
      return await readKnowledgeGraph(maxNodes);
    } catch {
      return { nodes: [], edges: [], truncated: false } satisfies OsKnowledgeGraphPayload;
    }
  });

  ipcMain.handle('os.intentProof', async (_event, input?: OsIntentProofInput) => {
    try {
      return await readIntentProof(input);
    } catch {
      return {
        source: 'none',
        state: null,
        graph: null,
        progress: null,
        proofs: [],
        integrity: { status: 'empty', checked: 0, legacy: 0, errors: [] },
        forgeBranches: [],
        outcomes: [],
        constitution: null,
        exchangeBids: [],
        shadowRehearsals: [],
        capsules: [],
      } satisfies OsIntentProofPayload;
    }
  });

  ipcMain.handle('os.intentForgeCreate', async (_event, input: OsForgeCreateInput) =>
    createIntentForgeBranch(input));
  ipcMain.handle('os.intentForgeEvaluate', async (_event, input: OsForgeEvaluateInput) =>
    evaluateIntentForgeBranch(input));
  ipcMain.handle('os.intentForgeSelect', async (_event, input: OsForgeSelectInput) =>
    selectIntentForgeBranch(input));
  ipcMain.handle('os.intentConstitutionUpdate', async (_event, input: OsConstitutionUpdateInput) =>
    updateIntentConstitution(input));
  ipcMain.handle('os.intentExchangeBid', async (_event, input: OsExchangeBidInput) =>
    submitIntentExchangeBid(input));
  ipcMain.handle('os.intentExchangeRehearse', async (_event, input: OsExchangeRehearseInput) =>
    rehearseIntentExchangeBid(input));
  ipcMain.handle('os.intentExchangeAward', async (_event, input: OsExchangeAwardInput) =>
    awardIntentExchangeBid(input));
  ipcMain.handle('os.intentExchangeReject', async (_event, input: OsExchangeRejectInput) =>
    rejectIntentExchangeBid(input));
  ipcMain.handle('os.intentCapsuleCreate', async (_event, input: OsCapsuleCreateInput) =>
    createIntentCapsule(input));
  ipcMain.handle('os.intentCapsuleActivate', async (_event, input: OsCapsuleActivateInput) =>
    activateIntentCapsule(input));
  ipcMain.handle('os.intentCapsuleRevoke', async (_event, input: OsCapsuleRevokeInput) =>
    revokeIntentCapsule(input));
}
