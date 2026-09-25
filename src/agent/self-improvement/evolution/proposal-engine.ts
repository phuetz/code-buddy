/** Read-only selection and planning followed by one isolated proposal archive write. */
import { closeSync, existsSync, mkdirSync, openSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getCodeBuddyHome } from '../../../utils/codebuddy-home.js';
import type { FeatureArea } from './feature-map.js';
import { getFeatureMap } from './feature-map.js';
import {
  buildGoalPrompt,
  makeDefaultChat,
  matchScore,
  parseGoal,
  selectMatches,
  type FeatureMatch,
  type ResearchRecall,
  type SynthChat,
} from './research-weakness-source.js';
import { planVariant, type VariantPlan } from './variant-planner.js';
import type { Weakness } from './evolution-engine.js';
import type { VariantRecord } from './code-variant-store.js';
import { dreamExplorationPolicy, worldsFromVariants } from './dream-replay.js';

export type ProposalStop =
  | 'NO_RECALL'
  | 'RECALL_ERROR'
  | 'BELOW_THRESHOLD'
  | 'CONTRADICTED'
  | 'PROVIDER_MISSING'
  | 'PROVIDER_ERROR'
  | 'GOAL_LLM_UNAVAILABLE'
  | 'GOAL_REJECTED'
  | 'PLAN_UNAVAILABLE'
  | 'ARCHIVE_FAILED'
  | 'DREAM_ARCHIVE_INSUFFICIENT'
  | 'DREAM_POLICY_UNSUPPORTED'
  | 'DREAM_WEAKNESS_UNMAPPED';

export interface ProposalEvent {
  stage: 'source' | 'recall' | 'filter' | 'provider' | 'dream' | 'goal' | 'plan' | 'archive';
  status: 'ok' | 'stopped';
  code: string;
  detail: string;
}

export interface ProposalRecord {
  id: string;
  createdAt: string;
  source: 'research';
  weakness: Weakness;
  feature: { id: string; name: string; catalogIds: string[] };
  article: { id?: string; source?: string; text: string; similarity: number };
  plan: VariantPlan;
  dream?: { policyId: string; weaknessId: string; parentId: string; replayObjective: number; evidence: 'replay'; pairedDecision: string };
  events: ProposalEvent[];
}

export type ProposalResult =
  | { status: 'planned'; events: ProposalEvent[]; archivePath: string; record: ProposalRecord }
  | { status: 'stopped'; reason: ProposalStop; events: ProposalEvent[] };

export interface ProposeOptions {
  features?: FeatureArea[];
  recall?: ResearchRecall;
  chat?: SynthChat;
  hasProvider?: () => boolean | Promise<boolean>;
  model?: string;
  minSimilarity?: number;
  archiveRoot?: string;
  now?: () => Date;
  /** Opt-in override; otherwise only CODEBUDDY_DREAM_RSI=true enables replay. */
  dreamEnabled?: boolean;
  /** Injectable historical archive for offline tests; production reads CodeVariantStore only. */
  dreamRecords?: VariantRecord[];
}

function stop(events: ProposalEvent[], stage: ProposalEvent['stage'], reason: ProposalStop, detail: string): ProposalResult {
  events.push({ stage, status: 'stopped', code: reason, detail });
  return { status: 'stopped', reason, events };
}

async function defaultHasProvider(): Promise<boolean> {
  const { detectProviderFromEnv } = await import('../../../utils/provider-detector.js');
  return Boolean(detectProviderFromEnv());
}

function defaultProposalRecall(): ResearchRecall {
  return async (_query, opts) => {
    const { getCollectiveKnowledgeGraph } = await import('../../../memory/collective-knowledge-graph.js');
    const hits = await getCollectiveKnowledgeGraph().recallHybrid(_query, { types: ['discovery'], limit: opts.limit ?? 5 });
    return hits.map((hit) => ({
      id: hit.id, text: hit.text, similarity: hit.similarity, confidence: hit.confidence,
      corroborations: hit.corroborations, source: hit.source, relations: hit.relations,
    }));
  };
}

function archiveProposal(root: string, record: ProposalRecord): string {
  const srcRoot = realpathSync(path.join(process.cwd(), 'src'));
  const requested = path.resolve(root);
  let ancestor = requested;
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const resolved = path.resolve(realpathSync(ancestor), path.relative(ancestor, requested));
  const relative = path.relative(srcRoot, resolved);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('Proposal archive must stay outside src/');
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const target = path.join(root, `${record.id}.json`);
  const descriptor = openSync(target, 'wx', 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  } finally {
    closeSync(descriptor);
  }
  return target;
}

/** No mutator, worktree, branch or baseline scorer is called; optional replay only reads the variant store. */
export async function proposeResearchImprovement(options: ProposeOptions = {}): Promise<ProposalResult> {
  const events: ProposalEvent[] = [{ stage: 'source', status: 'ok', code: 'RESEARCH_SELECTED', detail: 'Research discovery source selected.' }];
  let providerAvailable: boolean;
  try {
    providerAvailable = options.hasProvider ? await options.hasProvider() : (options.chat ? true : await defaultHasProvider());
  } catch (error) {
    return stop(events, 'provider', 'PROVIDER_ERROR', error instanceof Error ? error.message : String(error));
  }
  if (!providerAvailable) return stop(events, 'provider', 'PROVIDER_MISSING', 'No configured LLM provider for goal synthesis and planning.');
  events.push({ stage: 'provider', status: 'ok', code: 'PROVIDER_AVAILABLE', detail: options.chat ? 'Injected LLM call available.' : 'Configured LLM provider detected.' });

  const features = options.features ?? await getFeatureMap({ enrich: async () => [], catalog: 'generate' });
  const dreamEnabled = options.dreamEnabled ?? process.env.CODEBUDDY_DREAM_RSI === 'true';
  let selectedDream: Extract<ReturnType<typeof dreamExplorationPolicy>, { status: 'selected' }> | undefined;
  let dreamArchiveRecords: VariantRecord[] = [];
  let sourceFeatures = features;
  if (dreamEnabled) {
    if (options.dreamRecords) dreamArchiveRecords = options.dreamRecords;
    else {
      const { CodeVariantStore } = await import('./code-variant-store.js');
      dreamArchiveRecords = new CodeVariantStore().list();
    }
    const result = dreamExplorationPolicy(worldsFromVariants(dreamArchiveRecords));
    if (result.status !== 'selected') {
      return stop(events, 'dream', result.reason === 'ARCHIVE_INSUFFICIENT'
        ? 'DREAM_ARCHIVE_INSUFFICIENT' : 'DREAM_POLICY_UNSUPPORTED', result.reason);
    }
    const selectedFeature = features.find((feature) => {
      const prefix = `research-${feature.id}`;
      const suffix = result.selection.weaknessId.slice(prefix.length);
      return result.selection.weaknessId.startsWith(prefix) && (suffix === '' || /^-\d+$/.test(suffix));
    });
    if (!selectedFeature) return stop(events, 'dream', 'DREAM_WEAKNESS_UNMAPPED', `No feature matches ${result.selection.weaknessId}.`);
    selectedDream = result;
    sourceFeatures = [selectedFeature];
    events.push({
      stage: 'dream', status: 'ok', code: 'DREAM_POLICY_SELECTED',
      detail: `Replay policy ${result.best.policy.id}; weakness ${result.selection.weaknessId}; parent ${result.selection.parentId}; paired ${result.paired.decision} (replay only).`,
    });
  }
  const recall = options.recall ?? defaultProposalRecall();
  const candidates: FeatureMatch[] = [];
  let recallErrors = 0;
  for (const feature of sourceFeatures) {
    let hits: Awaited<ReturnType<ResearchRecall>>;
    try {
      hits = await recall(feature.description, { types: ['discovery'], limit: 5 });
    } catch {
      recallErrors += 1;
      hits = [];
    }
    for (const hit of hits) if (hit?.text) candidates.push({ feature, hit, score: matchScore(hit) });
  }
  if (candidates.length === 0 && recallErrors > 0) return stop(events, 'recall', 'RECALL_ERROR', `Recall failed for ${recallErrors} of ${sourceFeatures.length} domains; no discovery available.`);
  if (candidates.length === 0) return stop(events, 'recall', 'NO_RECALL', `No discovery recalled across ${sourceFeatures.length} domains.`);
  events.push({ stage: 'recall', status: 'ok', code: 'RECALL_FOUND', detail: `${candidates.length} discovery matches recalled.` });

  const floor = options.minSimilarity ?? 0.32;
  const matches = selectMatches(candidates, { minSimilarity: floor, limit: 1 });
  if (matches.length === 0) {
    const aboveFloor = candidates.some((candidate) => (candidate.hit.similarity ?? 0) >= floor);
    return aboveFloor
      ? stop(events, 'filter', 'CONTRADICTED', 'Discoveries above the threshold are contradicted.')
      : stop(events, 'filter', 'BELOW_THRESHOLD', `No discovery meets similarity ${floor}.`);
  }
  const selected = matches[0]!;
  events.push({ stage: 'filter', status: 'ok', code: 'WEAKNESS_SELECTED', detail: `Domain ${selected.feature.id}; article ${selected.hit.id ?? 'unknown'}; similarity ${selected.hit.similarity ?? 0}.` });

  const chat = options.chat ?? makeDefaultChat(options.model);
  let rawGoal: string | null;
  try { rawGoal = await chat(buildGoalPrompt(selected.feature, selected.hit)); } catch { rawGoal = null; }
  if (!rawGoal?.trim()) return stop(events, 'goal', 'GOAL_LLM_UNAVAILABLE', 'LLM did not return a goal response.');
  const goal = parseGoal(rawGoal);
  if (!goal) return stop(events, 'goal', 'GOAL_REJECTED', 'LLM returned no actionable goal.');
  const weakness: Weakness = {
    id: selectedDream?.selection.weaknessId ?? `research-${selected.feature.id}`,
    kind: 'research', goal,
  };
  events.push({ stage: 'goal', status: 'ok', code: 'GOAL_SYNTHESIZED', detail: goal });

  const parent = selectedDream?.selection.parentId;
  const parentRecord = parent && parent !== 'root'
    ? dreamArchiveRecords.find((record) => record.id === parent)
    : undefined;
  const inspirations = parentRecord ? [{
    id: parentRecord.id, goal: parentRecord.detail ?? parentRecord.id,
    score: parentRecord.score, diff: '',
  }] : [];
  const plan = await planVariant({ weakness, inspirations }, chat);
  if (!plan || !plan.steps.length || /^none$/i.test(plan.summary.trim())) {
    return stop(events, 'plan', 'PLAN_UNAVAILABLE', 'LLM returned no usable plan.');
  }
  if (parent) {
    plan.approach = parent === 'root' ? 'fresh' : 'build-on';
    if (parent === 'root') delete plan.basedOn;
    else plan.basedOn = parent;
  }
  events.push({ stage: 'plan', status: 'ok', code: 'PLAN_CREATED', detail: `${plan.steps.length} step(s).` });

  const root = options.archiveRoot ?? path.join(getCodeBuddyHome(), 'self-improvement', 'evolution', 'proposals');
  const id = `proposal-${randomUUID()}`;
  const record: ProposalRecord = {
    id, createdAt: (options.now ?? (() => new Date()))().toISOString(), source: 'research', weakness,
    feature: { id: selected.feature.id, name: selected.feature.name, catalogIds: selected.feature.catalogIds ?? [] },
    article: {
      ...(selected.hit.id ? { id: selected.hit.id } : {}),
      ...(selected.hit.source ? { source: selected.hit.source } : {}),
      text: selected.hit.text, similarity: selected.hit.similarity ?? 0,
    },
    plan,
    ...(selectedDream ? { dream: {
      policyId: selectedDream.best.policy.id,
      weaknessId: selectedDream.selection.weaknessId,
      parentId: selectedDream.selection.parentId,
      replayObjective: selectedDream.best.objective,
      evidence: 'replay' as const,
      pairedDecision: selectedDream.paired.decision,
    } } : {}),
    events: [...events, { stage: 'archive', status: 'ok', code: 'PLAN_ARCHIVED', detail: 'Plan stored in isolated proposal archive.' }],
  };
  try {
    const archivePath = archiveProposal(root, record);
    return { status: 'planned', archivePath, events: record.events, record };
  } catch (error) {
    return stop(events, 'archive', 'ARCHIVE_FAILED', error instanceof Error ? error.message : String(error));
  }
}
