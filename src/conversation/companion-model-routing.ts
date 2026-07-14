import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type {
  BlindConversationAggregateReport,
  BlindPreferenceReport,
} from './conversation-blind-comparison.js';
import { writePrivateJsonFile } from './conversation-pilot-corpus.js';
import { planConversationResponse } from './discourse-planner.js';
import type { ConversationTurn } from './types.js';
import { detectEmotion } from '../companion/reply-augment.js';
import { classifyLisaIntrospection } from '../identity/lisa-introspection.js';
import { classifyModelEgress, type ModelEgress } from '../providers/model-egress.js';

export type CompanionRoutingSurface = 'voice' | 'telegram' | 'cowork';
export type CompanionRoutingLane = 'fast' | 'factual' | 'deep' | 'emotional' | 'action';

export interface CompanionRoutingProfile {
  version: 1;
  enabled: boolean;
  profileId: string;
  createdAt: string;
  expiresAt: string;
  source: {
    comparisonId: string;
    evidenceFingerprint: string;
    candidateId: string;
    judgedTrials: number;
    totalTrials: number;
    reviewCoverage: number;
    minimumCoverage: number;
    coverageOverride: boolean;
    automatedRelationshipSafetyTrials: number;
    automatedHighRiskTrials: number;
    automatedHighRiskRelationshipSafetyTrials: number;
    reviewedRelationshipSafetyTrials: number;
    reviewedHighRiskTrials: number;
    reviewedHighRiskRelationshipSafetyTrials: number;
  };
  winner: {
    model: string;
    provider: string;
    averageBorda: number;
    winRate: number;
    automatedScore: number;
    errors: number;
    passRate: number;
    safetyPassRate: number;
    averageLatencyMs: number;
  };
  policy: {
    surfaces: CompanionRoutingSurface[];
    lanes: CompanionRoutingLane[];
  };
}

export interface CompanionRoutingDecision {
  profileId: string;
  surface: CompanionRoutingSurface;
  lane: CompanionRoutingLane;
  model: string;
  provider: string;
}

export interface CompanionRuntimeRoute extends CompanionRoutingDecision {
  apiKey: string;
  baseURL: string;
  /** Actual inference destination; subscription CLIs remain cloud egress. */
  egress: ModelEgress;
  reason: string;
}

export interface CompanionRoutingEvent {
  version: 1;
  timestamp: string;
  profileId: string;
  surface: CompanionRoutingSurface;
  lane: CompanionRoutingLane;
  preferredModel: string;
  selectedModel?: string;
  outcome: 'route_selected' | 'fallback_unavailable' | 'fallback_local_only';
}

export interface RuntimeCandidate {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  egress?: ModelEgress;
}

export interface ResolveCompanionModelRouteOptions {
  surface: CompanionRoutingSurface;
  text: string;
  /** Recent transport-independent turns, oldest first. */
  history?: ConversationTurn[];
  requireLocal?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  profile?: CompanionRoutingProfile | null;
  listCandidates?: () => Promise<RuntimeCandidate[]>;
  resolveExplicit?: (model: string, provider: string) => Promise<RuntimeCandidate | null>;
  recordEvent?: (event: CompanionRoutingEvent) => void;
}

export interface ActivateCompanionRoutingOptions {
  forceCoverage?: boolean;
  minimumCoverage?: number;
  ttlDays?: number;
  now?: Date;
  profilePath?: string;
  previousPath?: string;
}

const MODEL_NAME_PATTERN = /^[A-Za-z0-9._:/@-]{1,160}$/;
const SURFACES = new Set<CompanionRoutingSurface>(['voice', 'telegram', 'cowork']);
const LANES = new Set<CompanionRoutingLane>(['fast', 'factual', 'deep', 'emotional', 'action']);
const BENCHMARK_CATEGORIES = new Set([
  'fresh_information',
  'philosophy',
  'correction',
  'emotional_attunement',
  'cross_channel_continuity',
  'relationship_safety',
]);
const LOCAL_PROVIDERS = new Set([
  'ollama',
  'lmstudio',
  'lm-studio',
  'lemonade',
  'vllm',
  'local',
]);
const DEFAULT_ROUTED_LANES: CompanionRoutingLane[] = ['factual', 'deep', 'emotional'];
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_PROFILE_BYTES = 128 * 1024;
const MAX_EVENT_JOURNAL_BYTES = 1024 * 1024;
const CANDIDATE_CACHE_MS = 60_000;
const ACTION_VERB_PATTERN =
  '(?:execute|executer|lance|lancer|cree|creer|modifie|modifier|installe|installer|commit|push|pousse|supprime|supprimer|cherche|chercher|corrige|corriger|deploie|deployer|redemarre|redemarrer|utilise|utiliser|fais|faire|envoie|envoyer|sauvegarde|sauvegarder|teste|tester)';
const DIRECT_ACTION_PATTERN = new RegExp(
  `^(?:(?:bonjour|bonsoir|salut|coucou|hello|hey)\\s+)?(?:lisa\\s+)?(?:s\\s+il\\s+te\\s+plait\\s+)?${ACTION_VERB_PATTERN}\\b`
);
const POLITE_ACTION_PATTERN = new RegExp(
  `^(?:(?:bonjour|bonsoir|salut|coucou|hello|hey)\\s+)?(?:lisa\\s+)?(?:peux\\s+tu|tu\\s+peux|pourrais\\s+tu|est\\s+ce\\s+que\\s+tu\\s+peux|je\\s+veux\\s+que\\s+tu|il\\s+faut)\\s+(?:me\\s+)?${ACTION_VERB_PATTERN}\\b`
);
const CHAINED_ACTION_PATTERN = new RegExp(
  `\\b(?:puis|ensuite|et\\s+ensuite)\\s+${ACTION_VERB_PATTERN}\\b`
);
const DEEP_TOPIC_PATTERN =
  /\b(philosoph|conscience|identite|liberte|amour|sens de la vie|raisonne|argumente|analyse|nuance|pourquoi|que faire|comprendre|ethique|morale|mort)\b/;
const FACTUAL_TOPIC_PATTERN =
  /\b(actualites?|aujourd hui|nouvelles|source|verifie|explique|comment fonctionne|qu est ce|c est quoi|qui est|quel(?:le)? est)\b/;
const MAX_ROUTING_HISTORY_TURNS = 16;

let candidateCache: { at: number; candidates: RuntimeCandidate[] } | null = null;

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, max = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function finiteNumber(value: unknown, label: string, min = 0, max = Number.MAX_VALUE): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

function validateSafetyCoverage(
  value: unknown,
  label: string,
  totalTrials: number
): {
  relationshipSafetyTrials: number;
  highRiskTrials: number;
  highRiskRelationshipSafetyTrials: number;
} {
  const coverage = recordValue(value, label);
  const categoryTrials = recordValue(coverage.categoryTrials, `${label}.categoryTrials`);
  let categoryTotal = 0;
  for (const [category, rawCount] of Object.entries(categoryTrials)) {
    if (!BENCHMARK_CATEGORIES.has(category)) throw new Error(`${label} contains an unknown category`);
    const count = finiteNumber(rawCount, `${label}.categoryTrials.${category}`, 0, totalTrials);
    if (!Number.isInteger(count)) throw new Error(`${label} category counts must be integers`);
    categoryTotal += count;
  }
  const relationshipSafetyTrials = finiteNumber(
    coverage.relationshipSafetyTrials,
    `${label}.relationshipSafetyTrials`,
    0,
    totalTrials
  );
  const highRiskTrials = finiteNumber(
    coverage.highRiskTrials,
    `${label}.highRiskTrials`,
    0,
    totalTrials
  );
  const highRiskRelationshipSafetyTrials = finiteNumber(
    coverage.highRiskRelationshipSafetyTrials,
    `${label}.highRiskRelationshipSafetyTrials`,
    0,
    totalTrials
  );
  if (
    !Number.isInteger(relationshipSafetyTrials) ||
    !Number.isInteger(highRiskTrials) ||
    !Number.isInteger(highRiskRelationshipSafetyTrials) ||
    categoryTotal !== totalTrials ||
    (categoryTrials.relationship_safety ?? 0) !== relationshipSafetyTrials ||
    highRiskRelationshipSafetyTrials > relationshipSafetyTrials ||
    highRiskRelationshipSafetyTrials > highRiskTrials
  ) {
    throw new Error(`${label} is internally inconsistent`);
  }
  return { relationshipSafetyTrials, highRiskTrials, highRiskRelationshipSafetyTrials };
}

function readBoundedJson(path: string, maxBytes: number): unknown {
  if (statSync(path).size > maxBytes) throw new Error(`Evidence file exceeds ${maxBytes} bytes`);
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function parsePreferenceReport(value: unknown): BlindPreferenceReport {
  const report = recordValue(value, 'preference report');
  if (report.version === 1 && report.kind === 'lisa-blind-preferences') {
    throw new Error(
      'Legacy preference evidence lacks sealed safety coverage; rerun buddy assistant compare and compare-reveal'
    );
  }
  if (report.version !== 2 || report.kind !== 'lisa-blind-preferences') {
    throw new Error('Preference report has an unsupported format');
  }
  requiredString(report.comparisonId, 'preference report comparisonId', 80);
  const totalTrials = finiteNumber(report.totalTrials, 'preference report totalTrials', 1);
  const judgedTrials = finiteNumber(report.judgedTrials, 'preference report judgedTrials', 0, totalTrials);
  if (!Number.isInteger(totalTrials) || !Number.isInteger(judgedTrials)) {
    throw new Error('Preference trial counts must be integers');
  }
  validateSafetyCoverage(
    report.reviewedSafetyCoverage,
    'preference report reviewedSafetyCoverage',
    judgedTrials
  );
  const candidates = report.candidates;
  if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 12) {
    throw new Error('Preference report must contain 2-12 candidates');
  }
  const candidateIds = new Set<string>();
  let totalWins = 0;
  for (const [index, raw] of candidates.entries()) {
    const candidate = recordValue(raw, `preference candidates[${index}]`);
    const candidateId = requiredString(
      candidate.candidateId,
      `preference candidates[${index}].candidateId`,
      80
    );
    if (candidateIds.has(candidateId)) throw new Error('Preference candidate ids must be unique');
    candidateIds.add(candidateId);
    const model = requiredString(candidate.model, `preference candidates[${index}].model`, 160);
    if (!MODEL_NAME_PATTERN.test(model)) throw new Error('Preference report contains an invalid model');
    requiredString(candidate.provider, `preference candidates[${index}].provider`, 80);
    const appearances = finiteNumber(
      candidate.appearances,
      `preference candidates[${index}].appearances`,
      0,
      judgedTrials
    );
    const wins = finiteNumber(
      candidate.wins,
      `preference candidates[${index}].wins`,
      0,
      judgedTrials
    );
    const bordaPoints = finiteNumber(
      candidate.bordaPoints,
      `preference candidates[${index}].bordaPoints`
    );
    const averageBorda = finiteNumber(
      candidate.averageBorda,
      `preference candidates[${index}].averageBorda`
    );
    const winRate = finiteNumber(candidate.winRate, `preference candidates[${index}].winRate`, 0, 1);
    if (
      !Number.isInteger(appearances) ||
      !Number.isInteger(wins) ||
      !Number.isInteger(bordaPoints) ||
      appearances !== judgedTrials ||
      wins > appearances ||
      Math.abs(averageBorda - (appearances ? bordaPoints / appearances : 0)) > 1e-9 ||
      Math.abs(winRate - (judgedTrials ? wins / judgedTrials : 0)) > 1e-9
    ) {
      throw new Error('Preference candidate scores are internally inconsistent');
    }
    totalWins += wins;
  }
  if (totalWins !== judgedTrials) throw new Error('Preference wins do not match judged trials');
  const recommendedCandidateId = requiredString(
    report.recommendedCandidateId,
    'preference report recommendation',
    80
  );
  if (!candidateIds.has(recommendedCandidateId)) {
    throw new Error('Preference recommendation is not a known candidate');
  }
  return report as unknown as BlindPreferenceReport;
}

function parseAggregateReport(value: unknown): BlindConversationAggregateReport {
  const report = recordValue(value, 'aggregate report');
  if (report.version === 1 && report.kind === 'lisa-blind-comparison-aggregate') {
    throw new Error(
      'Legacy aggregate evidence lacks relationship-safety coverage; rerun buddy assistant compare'
    );
  }
  if (report.version !== 2 || report.kind !== 'lisa-blind-comparison-aggregate') {
    throw new Error('Aggregate report has an unsupported format');
  }
  requiredString(report.comparisonId, 'aggregate report comparisonId', 80);
  const scenarioCount = finiteNumber(report.scenarioCount, 'aggregate report scenarioCount', 1);
  const trialsPerCandidate = finiteNumber(
    report.trialsPerCandidate,
    'aggregate report trialsPerCandidate',
    1
  );
  if (!Number.isInteger(scenarioCount) || !Number.isInteger(trialsPerCandidate)) {
    throw new Error('Aggregate trial counts must be integers');
  }
  validateSafetyCoverage(
    report.safetyCoverage,
    'aggregate report safetyCoverage',
    trialsPerCandidate
  );
  const candidates = report.candidates;
  if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 12) {
    throw new Error('Aggregate report must contain 2-12 candidates');
  }
  const candidateIds = new Set<string>();
  for (const [index, raw] of candidates.entries()) {
    const candidate = recordValue(raw, `aggregate candidates[${index}]`);
    const candidateId = requiredString(
      candidate.candidateId,
      `aggregate candidates[${index}].candidateId`,
      80
    );
    if (candidateIds.has(candidateId)) throw new Error('Aggregate candidate ids must be unique');
    candidateIds.add(candidateId);
    const model = requiredString(candidate.model, `aggregate candidates[${index}].model`, 160);
    if (!MODEL_NAME_PATTERN.test(model)) throw new Error('Aggregate report contains an invalid model');
    requiredString(candidate.provider, `aggregate candidates[${index}].provider`, 80);
    const runs = finiteNumber(candidate.runs, `aggregate candidates[${index}].runs`, 1);
    const errors = finiteNumber(candidate.errors, `aggregate candidates[${index}].errors`, 0, runs);
    const passed = finiteNumber(candidate.passed, `aggregate candidates[${index}].passed`, 0, runs);
    finiteNumber(candidate.passRate, `aggregate candidates[${index}].passRate`, 0, 1);
    finiteNumber(candidate.safetyPassRate, `aggregate candidates[${index}].safetyPassRate`, 0, 1);
    finiteNumber(candidate.averageScore, `aggregate candidates[${index}].averageScore`, 0, 1);
    finiteNumber(candidate.averageLatencyMs, `aggregate candidates[${index}].averageLatencyMs`);
    if (
      !Number.isInteger(runs) ||
      !Number.isInteger(errors) ||
      !Number.isInteger(passed) ||
      runs !== trialsPerCandidate ||
      passed + errors > runs
    ) {
      throw new Error('Aggregate candidate counts are internally inconsistent');
    }
  }
  const recommendedCandidateId = requiredString(
    report.recommendedCandidateId,
    'aggregate report recommendation',
    80
  );
  if (!candidateIds.has(recommendedCandidateId)) {
    throw new Error('Aggregate recommendation is not a known candidate');
  }
  return report as unknown as BlindConversationAggregateReport;
}

function normalizedProvider(provider: string): string {
  const clean = provider.trim().toLowerCase().replace(/_/g, '-');
  if (clean === 'xai-oauth') return 'grok-oauth';
  if (clean === 'xai') return 'grok';
  if (clean === 'lm-studio') return 'lmstudio';
  return clean;
}

function providerBackend(provider: string): string {
  return normalizedProvider(provider).replace(/-oauth$/, '');
}

function profileEvidenceFingerprint(
  preferences: BlindPreferenceReport,
  aggregate: BlindConversationAggregateReport
): string {
  return createHash('sha256')
    .update(JSON.stringify({ preferences, aggregate }))
    .digest('hex')
    .slice(0, 24);
}

export function defaultCompanionRoutingPaths(home = homedir()): {
  profile: string;
  previous: string;
  events: string;
} {
  const directory = join(home, '.codebuddy', 'companion');
  return {
    profile: join(directory, 'companion-routing-profile.json'),
    previous: join(directory, 'companion-routing-profile.previous.json'),
    events: join(directory, 'companion-routing-events.jsonl'),
  };
}

/** Effective private paths, including test/deployment overrides. */
export function configuredCompanionRoutingPaths(
  env: NodeJS.ProcessEnv = process.env
): ReturnType<typeof defaultCompanionRoutingPaths> {
  const defaults = defaultCompanionRoutingPaths();
  const profile = env.CODEBUDDY_COMPANION_ROUTING_PROFILE?.trim() || defaults.profile;
  return {
    profile,
    previous:
      env.CODEBUDDY_COMPANION_ROUTING_PREVIOUS?.trim() ||
      (profile === defaults.profile ? defaults.previous : `${profile}.previous`),
    events: env.CODEBUDDY_COMPANION_ROUTING_EVENTS?.trim() || defaults.events,
  };
}

export function validateCompanionRoutingProfile(value: unknown): CompanionRoutingProfile {
  const profile = recordValue(value, 'routing profile');
  if (profile.version !== 1 || typeof profile.enabled !== 'boolean') {
    throw new Error('Routing profile has an unsupported format');
  }
  const source = recordValue(profile.source, 'routing profile source');
  const winner = recordValue(profile.winner, 'routing profile winner');
  const policy = recordValue(profile.policy, 'routing profile policy');
  const model = requiredString(winner.model, 'routing profile winner.model', 160);
  if (!MODEL_NAME_PATTERN.test(model)) throw new Error('Routing profile contains an invalid model');
  const surfaces = policy.surfaces;
  const lanes = policy.lanes;
  if (
    !Array.isArray(surfaces) ||
    surfaces.length < 1 ||
    surfaces.some((surface) => typeof surface !== 'string' || !SURFACES.has(surface as CompanionRoutingSurface)) ||
    new Set(surfaces).size !== surfaces.length
  ) {
    throw new Error('Routing profile contains invalid surfaces');
  }
  if (
    !Array.isArray(lanes) ||
    lanes.length < 1 ||
    lanes.some((lane) => typeof lane !== 'string' || !LANES.has(lane as CompanionRoutingLane)) ||
    new Set(lanes).size !== lanes.length
  ) {
    throw new Error('Routing profile contains invalid lanes');
  }
  const createdAt = requiredString(profile.createdAt, 'routing profile createdAt', 40);
  const expiresAt = requiredString(profile.expiresAt, 'routing profile expiresAt', 40);
  const createdAtMs = Date.parse(createdAt);
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= createdAtMs) {
    throw new Error('Routing profile dates must be ISO timestamps');
  }
  const judgedTrials = finiteNumber(source.judgedTrials, 'routing profile judgedTrials');
  const totalTrials = finiteNumber(source.totalTrials, 'routing profile totalTrials', 1);
  if (
    !Number.isInteger(judgedTrials) ||
    !Number.isInteger(totalTrials) ||
    judgedTrials > totalTrials
  ) {
    throw new Error('Routing profile trial counts must be valid integers');
  }
  if (typeof source.coverageOverride !== 'boolean') {
    throw new Error('Routing profile coverageOverride must be boolean');
  }
  const reviewCoverage = finiteNumber(
    source.reviewCoverage,
    'routing profile reviewCoverage',
    0,
    1
  );
  const minimumCoverage = finiteNumber(
    source.minimumCoverage,
    'routing profile minimumCoverage',
    0.1,
    1
  );
  const safetyCounts = [
    finiteNumber(
      source.automatedRelationshipSafetyTrials,
      'routing profile automatedRelationshipSafetyTrials',
      1,
      totalTrials
    ),
    finiteNumber(
      source.automatedHighRiskTrials,
      'routing profile automatedHighRiskTrials',
      1,
      totalTrials
    ),
    finiteNumber(
      source.automatedHighRiskRelationshipSafetyTrials,
      'routing profile automatedHighRiskRelationshipSafetyTrials',
      1,
      totalTrials
    ),
    finiteNumber(
      source.reviewedRelationshipSafetyTrials,
      'routing profile reviewedRelationshipSafetyTrials',
      1,
      judgedTrials
    ),
    finiteNumber(
      source.reviewedHighRiskTrials,
      'routing profile reviewedHighRiskTrials',
      1,
      judgedTrials
    ),
    finiteNumber(
      source.reviewedHighRiskRelationshipSafetyTrials,
      'routing profile reviewedHighRiskRelationshipSafetyTrials',
      1,
      judgedTrials
    ),
  ];
  if (
    safetyCounts.some((count) => !Number.isInteger(count)) ||
    safetyCounts[2]! > safetyCounts[0]! ||
    safetyCounts[2]! > safetyCounts[1]! ||
    safetyCounts[5]! > safetyCounts[3]! ||
    safetyCounts[5]! > safetyCounts[4]! ||
    Math.abs(reviewCoverage - judgedTrials / totalTrials) > 1e-9 ||
    (!source.coverageOverride && reviewCoverage < minimumCoverage)
  ) {
    throw new Error('Routing profile evidence coverage is internally inconsistent');
  }
  const errors = finiteNumber(winner.errors, 'routing profile errors');
  const passRate = finiteNumber(winner.passRate, 'routing profile passRate', 0, 1);
  const safetyPassRate = finiteNumber(
    winner.safetyPassRate,
    'routing profile safetyPassRate',
    0,
    1
  );
  if (!Number.isInteger(errors) || errors !== 0 || passRate < 0.8 || safetyPassRate !== 1) {
    throw new Error('Routing profile does not satisfy the non-bypassable safety gate');
  }
  const evidenceFingerprint = requiredString(
    source.evidenceFingerprint,
    'routing profile evidence fingerprint',
    80
  );
  if (!/^[a-f0-9]{24}$/.test(evidenceFingerprint)) {
    throw new Error('Routing profile evidence fingerprint is invalid');
  }
  return {
    version: 1,
    enabled: profile.enabled,
    profileId: requiredString(profile.profileId, 'routing profile profileId', 80),
    createdAt,
    expiresAt,
    source: {
      comparisonId: requiredString(source.comparisonId, 'routing profile comparisonId', 80),
      evidenceFingerprint,
      candidateId: requiredString(source.candidateId, 'routing profile candidateId', 80),
      judgedTrials,
      totalTrials,
      reviewCoverage,
      minimumCoverage,
      coverageOverride: source.coverageOverride,
      automatedRelationshipSafetyTrials: safetyCounts[0]!,
      automatedHighRiskTrials: safetyCounts[1]!,
      automatedHighRiskRelationshipSafetyTrials: safetyCounts[2]!,
      reviewedRelationshipSafetyTrials: safetyCounts[3]!,
      reviewedHighRiskTrials: safetyCounts[4]!,
      reviewedHighRiskRelationshipSafetyTrials: safetyCounts[5]!,
    },
    winner: {
      model,
      provider: requiredString(winner.provider, 'routing profile winner.provider', 80),
      averageBorda: finiteNumber(winner.averageBorda, 'routing profile averageBorda'),
      winRate: finiteNumber(winner.winRate, 'routing profile winRate', 0, 1),
      automatedScore: finiteNumber(winner.automatedScore, 'routing profile automatedScore', 0, 1),
      errors,
      passRate,
      safetyPassRate,
      averageLatencyMs: finiteNumber(winner.averageLatencyMs, 'routing profile averageLatencyMs'),
    },
    policy: {
      surfaces: surfaces as CompanionRoutingSurface[],
      lanes: lanes as CompanionRoutingLane[],
    },
  };
}

function validateCompanionRoutingEvent(value: unknown): CompanionRoutingEvent {
  const raw = recordValue(value, 'routing event');
  if (
    raw.version !== 1 ||
    typeof raw.surface !== 'string' ||
    !SURFACES.has(raw.surface as CompanionRoutingSurface) ||
    typeof raw.lane !== 'string' ||
    !LANES.has(raw.lane as CompanionRoutingLane) ||
    (raw.outcome !== 'route_selected' &&
      raw.outcome !== 'fallback_unavailable' &&
      raw.outcome !== 'fallback_local_only')
  ) {
    throw new Error('Routing event has an unsupported format');
  }
  const timestamp = requiredString(raw.timestamp, 'routing event timestamp', 40);
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error('Routing event timestamp is invalid');
  const preferredModel = requiredString(
    raw.preferredModel,
    'routing event preferredModel',
    160
  );
  if (!MODEL_NAME_PATTERN.test(preferredModel)) {
    throw new Error('Routing event preferredModel is invalid');
  }
  const selectedModel =
    raw.selectedModel === undefined
      ? undefined
      : requiredString(raw.selectedModel, 'routing event selectedModel', 160);
  if (selectedModel && !MODEL_NAME_PATTERN.test(selectedModel)) {
    throw new Error('Routing event selectedModel is invalid');
  }
  if (
    (raw.outcome === 'route_selected' && !selectedModel) ||
    (raw.outcome !== 'route_selected' && selectedModel)
  ) {
    throw new Error('Routing event outcome and selectedModel are inconsistent');
  }
  return {
    version: 1,
    timestamp,
    profileId: requiredString(raw.profileId, 'routing event profileId', 80),
    surface: raw.surface as CompanionRoutingSurface,
    lane: raw.lane as CompanionRoutingLane,
    preferredModel,
    ...(selectedModel ? { selectedModel } : {}),
    outcome: raw.outcome,
  };
}

export function readCompanionRoutingProfile(
  path = configuredCompanionRoutingPaths().profile
): CompanionRoutingProfile | null {
  if (!existsSync(path)) return null;
  if (statSync(path).size > MAX_PROFILE_BYTES) throw new Error('Routing profile is too large');
  return validateCompanionRoutingProfile(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

export function activateCompanionRoutingFromFiles(
  preferencesPath: string,
  aggregatePath: string,
  options: ActivateCompanionRoutingOptions = {}
): CompanionRoutingProfile {
  const preferences = parsePreferenceReport(readBoundedJson(preferencesPath, MAX_REPORT_BYTES));
  const aggregate = parseAggregateReport(readBoundedJson(aggregatePath, MAX_REPORT_BYTES));
  if (preferences.comparisonId !== aggregate.comparisonId) {
    throw new Error('Preference and aggregate reports belong to different comparisons');
  }
  const aggregateCandidates = new Map(
    aggregate.candidates.map((candidate) => [candidate.candidateId, candidate])
  );
  if (
    aggregateCandidates.size !== preferences.candidates.length ||
    preferences.candidates.some((candidate) => {
      const aggregateCandidate = aggregateCandidates.get(candidate.candidateId);
      return (
        !aggregateCandidate ||
        aggregateCandidate.model !== candidate.model ||
        normalizedProvider(aggregateCandidate.provider) !== normalizedProvider(candidate.provider)
      );
    })
  ) {
    throw new Error('Preference and aggregate reports contain different candidate sets');
  }
  const candidateId = preferences.recommendedCandidateId;
  if (!candidateId) throw new Error('Preference report has no recommended candidate');
  const human = preferences.candidates.find((candidate) => candidate.candidateId === candidateId);
  const automated = aggregate.candidates.find((candidate) => candidate.candidateId === candidateId);
  if (
    aggregate.recommendedCandidateId !== candidateId ||
    !human ||
    !automated ||
    human.model !== automated.model ||
    normalizedProvider(human.provider) !== normalizedProvider(automated.provider)
  ) {
    throw new Error('The preferred candidate is missing or inconsistent across evidence files');
  }
  const minimumCoverage = options.minimumCoverage ?? 0.5;
  if (!Number.isFinite(minimumCoverage) || minimumCoverage < 0.1 || minimumCoverage > 1) {
    throw new Error('minimumCoverage must be a finite number between 0.1 and 1');
  }
  const coverage = preferences.judgedTrials / preferences.totalTrials;
  const minimumJudged = Math.min(preferences.totalTrials, 3);
  if (
    !options.forceCoverage &&
    (coverage < minimumCoverage || preferences.judgedTrials < minimumJudged)
  ) {
    throw new Error(
      `Blind review coverage is insufficient (${preferences.judgedTrials}/${preferences.totalTrials}); rank at least ${Math.max(minimumJudged, Math.ceil(preferences.totalTrials * minimumCoverage))} trials`
    );
  }
  if (
    aggregate.safetyCoverage.highRiskRelationshipSafetyTrials < 1 ||
    preferences.reviewedSafetyCoverage.highRiskRelationshipSafetyTrials < 1
  ) {
    throw new Error(
      'Routing activation requires automated and human-reviewed relationship-safety/high-risk coverage'
    );
  }
  // Safety is never forceable: an attractive but dependency-inducing model must
  // not become Lisa's default brain.
  if (automated.safetyPassRate !== 1 || automated.errors !== 0 || automated.passRate < 0.8) {
    throw new Error('Preferred candidate did not pass the non-bypassable quality and relationship-safety gate');
  }
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Routing activation date is invalid');
  const ttlDays = options.ttlDays ?? 30;
  if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 365) {
    throw new Error('ttlDays must be an integer between 1 and 365');
  }
  const evidenceFingerprint = profileEvidenceFingerprint(preferences, aggregate);
  const profile: CompanionRoutingProfile = {
    version: 1,
    enabled: true,
    profileId: `pilot-${evidenceFingerprint.slice(0, 12)}`,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlDays * 86_400_000).toISOString(),
    source: {
      comparisonId: preferences.comparisonId,
      evidenceFingerprint,
      candidateId,
      judgedTrials: preferences.judgedTrials,
      totalTrials: preferences.totalTrials,
      reviewCoverage: coverage,
      minimumCoverage,
      coverageOverride: options.forceCoverage === true,
      automatedRelationshipSafetyTrials:
        aggregate.safetyCoverage.relationshipSafetyTrials,
      automatedHighRiskTrials: aggregate.safetyCoverage.highRiskTrials,
      automatedHighRiskRelationshipSafetyTrials:
        aggregate.safetyCoverage.highRiskRelationshipSafetyTrials,
      reviewedRelationshipSafetyTrials:
        preferences.reviewedSafetyCoverage.relationshipSafetyTrials,
      reviewedHighRiskTrials: preferences.reviewedSafetyCoverage.highRiskTrials,
      reviewedHighRiskRelationshipSafetyTrials:
        preferences.reviewedSafetyCoverage.highRiskRelationshipSafetyTrials,
    },
    winner: {
      model: human.model,
      provider: human.provider,
      averageBorda: human.averageBorda,
      winRate: human.winRate,
      automatedScore: automated.averageScore,
      errors: automated.errors,
      passRate: automated.passRate,
      safetyPassRate: automated.safetyPassRate,
      averageLatencyMs: automated.averageLatencyMs,
    },
    policy: {
      surfaces: ['voice', 'telegram', 'cowork'],
      lanes: [...DEFAULT_ROUTED_LANES],
    },
  };
  const paths = configuredCompanionRoutingPaths();
  const profilePath = options.profilePath ?? paths.profile;
  const previousPath =
    options.previousPath ?? (options.profilePath ? `${profilePath}.previous` : paths.previous);
  if (profilePath === previousPath) throw new Error('Profile and previous paths must be different');
  const current = readCompanionRoutingProfile(profilePath);
  if (current) writePrivateJsonFile(previousPath, current);
  writePrivateJsonFile(profilePath, profile);
  return profile;
}

export function rollbackCompanionRoutingProfile(
  profilePath = configuredCompanionRoutingPaths().profile,
  previousPath?: string
): CompanionRoutingProfile | null {
  const configured = configuredCompanionRoutingPaths();
  const resolvedPreviousPath =
    previousPath ??
    (profilePath === configured.profile ? configured.previous : `${profilePath}.previous`);
  if (profilePath === resolvedPreviousPath) {
    throw new Error('Profile and previous paths must be different');
  }
  const current = readCompanionRoutingProfile(profilePath);
  const previous = readCompanionRoutingProfile(resolvedPreviousPath);
  if (previous) {
    const rollbackPath = `${resolvedPreviousPath}.${process.pid}.${Date.now()}.rollback`;
    renameSync(resolvedPreviousPath, rollbackPath);
    try {
      writePrivateJsonFile(profilePath, previous);
      unlinkSync(rollbackPath);
      return previous;
    } catch (error) {
      try {
        renameSync(rollbackPath, resolvedPreviousPath);
      } catch {
        /* Preserve the original failure; the temporary file remains recoverable. */
      }
      throw error;
    }
  }
  return current ? disableCompanionRoutingProfile(profilePath) : null;
}

/** Emergency stop that never restores or mutates the previous profile. */
export function disableCompanionRoutingProfile(
  profilePath = configuredCompanionRoutingPaths().profile
): CompanionRoutingProfile | null {
  const current = readCompanionRoutingProfile(profilePath);
  if (!current) return null;
  const disabled: CompanionRoutingProfile = { ...current, enabled: false };
  writePrivateJsonFile(profilePath, disabled);
  return disabled;
}

function normalizeRoutingText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'_-]/g, ' ')
    .replace(/[^a-z0-9\s/.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Classify only the current utterance, preserving the established fast/action precedence. */
function classifyCurrentCompanionRoutingLane(
  text: string,
  normalized = normalizeRoutingText(text)
): CompanionRoutingLane {
  if (!normalized) return 'fast';
  const introspectionIntent = classifyLisaIntrospection(text);
  if (introspectionIntent === 'improve') return 'action';
  if (introspectionIntent === 'describe' || introspectionIntent === 'inspect') return 'deep';
  if (
    /^\//.test(text.trim()) ||
    DIRECT_ACTION_PATTERN.test(normalized) ||
    POLITE_ACTION_PATTERN.test(normalized) ||
    CHAINED_ACTION_PATTERN.test(normalized)
  ) {
    return 'action';
  }
  const words = normalized.split(' ');
  if (
    words.length <= 14 &&
    /^(bonjour|bonsoir|salut|coucou|hello|hey)\b/.test(normalized) &&
    !/\b(pourquoi|actualites?|nouvelles|explique|analyse|argumente|verifie)\b/.test(normalized)
  ) {
    return 'fast';
  }
  if (detectEmotion(text).emotion !== 'neutral') return 'emotional';
  if (DEEP_TOPIC_PATTERN.test(normalized)) {
    return 'deep';
  }
  if (FACTUAL_TOPIC_PATTERN.test(normalized)) {
    return 'factual';
  }
  if (normalized.split(' ').length <= 7) return 'fast';
  return 'deep';
}

/**
 * Classify a turn in its real discussion. Elliptical follow-ups inherit the
 * active deliberation, so "Continue" and "Et la réciprocité ?" remain deep
 * after a philosophical exchange. The planner explicitly cancels inheritance
 * for a brief request, action, closing, phatic or ordinary backchannel turn.
 * Explicit current-turn action, emotion, factual and deep signals still win.
 */
export function classifyCompanionRoutingLane(
  text: string,
  history: ConversationTurn[] = []
): CompanionRoutingLane {
  const current = classifyCurrentCompanionRoutingLane(text);
  if (current !== 'fast' || history.length === 0) return current;
  const plan = planConversationResponse(text, history.slice(-MAX_ROUTING_HISTORY_TURNS));
  return plan.analysis.continuesDeliberation && plan.depth === 'deliberative'
    ? 'deep'
    : current;
}

export function decideCompanionRouting(
  profile: CompanionRoutingProfile | null,
  surface: CompanionRoutingSurface,
  text: string,
  now: Date = new Date(),
  history: ConversationTurn[] = []
): CompanionRoutingDecision | null {
  if (!profile?.enabled || Date.parse(profile.expiresAt) <= now.getTime()) return null;
  const lane = classifyCompanionRoutingLane(text, history);
  if (!profile.policy.surfaces.includes(surface) || !profile.policy.lanes.includes(lane)) return null;
  return {
    profileId: profile.profileId,
    surface,
    lane,
    model: profile.winner.model,
    provider: profile.winner.provider,
  };
}

async function defaultCandidates(env: NodeJS.ProcessEnv): Promise<RuntimeCandidate[]> {
  const cacheable = env === process.env;
  if (cacheable && candidateCache && Date.now() - candidateCache.at < CANDIDATE_CACHE_MS) {
    return candidateCache.candidates;
  }
  const { listActiveLlmModelPool } = await import('../providers/active-llm-model-pool.js');
  const candidates = await listActiveLlmModelPool({ env });
  if (cacheable) candidateCache = { at: Date.now(), candidates };
  return candidates;
}

async function defaultExplicitResolver(
  model: string,
  preferredProvider: string
): Promise<RuntimeCandidate | null> {
  if (normalizedProvider(preferredProvider) === 'grok-oauth') {
    try {
      const { getValidXaiAccessToken, hasXaiCredentials, XAI_OAUTH_BASE_URL } = await import(
        '../providers/xai-oauth.js'
      );
      if (!hasXaiCredentials()) return null;
      const apiKey = await getValidXaiAccessToken();
      return apiKey
        ? {
            provider: 'grok-oauth',
            model,
            apiKey,
            baseURL: XAI_OAUTH_BASE_URL,
          }
        : null;
    } catch {
      return null;
    }
  }
  const { resolveCommandProviderWithOAuth } = await import('../commands/llm-provider-resolution.js');
  const resolved = await resolveCommandProviderWithOAuth({ explicitModel: model });
  return resolved
    ? {
        provider: resolved.providerLabel,
        model: resolved.model ?? model,
        apiKey: resolved.apiKey,
        baseURL: resolved.baseURL,
      }
    : null;
}

function isLocalCandidate(candidate: RuntimeCandidate): boolean {
  return LOCAL_PROVIDERS.has(providerBackend(candidate.provider));
}

function isExactRuntimeCandidate(
  candidate: RuntimeCandidate | null | undefined,
  decision: CompanionRoutingDecision
): candidate is RuntimeCandidate & { apiKey: string; baseURL: string } {
  return Boolean(
    candidate?.apiKey &&
      candidate.baseURL &&
      candidate.model.toLowerCase() === decision.model.toLowerCase() &&
      normalizedProvider(candidate.provider) === normalizedProvider(decision.provider)
  );
}

export function recordCompanionRoutingEvent(
  event: CompanionRoutingEvent,
  path = configuredCompanionRoutingPaths().events
): void {
  try {
    // Rebuild a strict allowlisted record before touching disk. TypeScript types
    // do not protect this exported runtime boundary from extra user fields.
    const privateEvent = validateCompanionRoutingEvent(event);
    if (existsSync(path) && statSync(path).size > MAX_EVENT_JOURNAL_BYTES) {
      try {
        unlinkSync(`${path}.1`);
      } catch {
        /* The previous rotation may not exist. */
      }
      renameSync(path, `${path}.1`);
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
      chmodSync(dirname(path), 0o700);
    } catch {
      /* Best effort on filesystems without POSIX permissions. */
    }
    appendFileSync(path, `${JSON.stringify(privateEvent)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      chmodSync(path, 0o600);
      chmodSync(dirname(path), 0o700);
    } catch {
      /* Best effort on filesystems without POSIX permissions. */
    }
  } catch {
    /* Observability must never break a conversation. */
  }
}

export async function resolveCompanionModelRoute(
  options: ResolveCompanionModelRouteOptions
): Promise<CompanionRuntimeRoute | null> {
  const env = options.env ?? process.env;
  if (env.CODEBUDDY_COMPANION_ROUTING === 'false') return null;
  let profile: CompanionRoutingProfile | null;
  try {
    profile =
      options.profile === undefined
        ? readCompanionRoutingProfile(configuredCompanionRoutingPaths(env).profile)
        : options.profile;
  } catch {
    return null;
  }
  const decision = decideCompanionRouting(
    profile,
    options.surface,
    options.text,
    options.now?.() ?? new Date(),
    options.history
  );
  if (!decision) return null;
  const record =
    options.recordEvent ??
    ((event: CompanionRoutingEvent) =>
      recordCompanionRoutingEvent(event, configuredCompanionRoutingPaths(env).events));
  const explicitResolver =
    options.resolveExplicit ?? (env === process.env ? defaultExplicitResolver : null);
  const preferExplicit = Boolean(options.resolveExplicit || !options.listCandidates);
  let explicitAttempted = false;
  let selected: RuntimeCandidate | undefined;
  const tryExplicit = async (): Promise<void> => {
    if (!explicitResolver || explicitAttempted) return;
    explicitAttempted = true;
    try {
      const candidate = await explicitResolver(decision.model, decision.provider);
      if (isExactRuntimeCandidate(candidate, decision)) selected = candidate;
    } catch {
      /* The active pool remains a safe fallback. */
    }
  };
  if (preferExplicit) await tryExplicit();
  if (!selected) {
    try {
      const candidates = await (options.listCandidates ?? (() => defaultCandidates(env)))();
      selected = candidates.find((candidate) => isExactRuntimeCandidate(candidate, decision));
    } catch {
      /* Explicit resolver below is still worth trying. */
    }
  }
  if (!selected) await tryExplicit();
  if (selected && options.requireLocal && !isLocalCandidate(selected)) {
    record({
      version: 1,
      timestamp: (options.now?.() ?? new Date()).toISOString(),
      profileId: decision.profileId,
      surface: decision.surface,
      lane: decision.lane,
      preferredModel: decision.model,
      outcome: 'fallback_local_only',
    });
    return null;
  }
  if (!isExactRuntimeCandidate(selected, decision)) {
    record({
      version: 1,
      timestamp: (options.now?.() ?? new Date()).toISOString(),
      profileId: decision.profileId,
      surface: decision.surface,
      lane: decision.lane,
      preferredModel: decision.model,
      outcome: 'fallback_unavailable',
    });
    return null;
  }
  record({
    version: 1,
    timestamp: (options.now?.() ?? new Date()).toISOString(),
    profileId: decision.profileId,
    surface: decision.surface,
    lane: decision.lane,
    preferredModel: decision.model,
    selectedModel: selected.model,
    outcome: 'route_selected',
  });
  return {
    ...decision,
    model: selected.model,
    provider: selected.provider,
    apiKey: selected.apiKey,
    baseURL: selected.baseURL,
    egress: selected.egress ?? classifyModelEgress(selected.baseURL, isLocalCandidate(selected)),
    reason: `blind pilot ${decision.profileId} (${decision.lane}, ${decision.surface})`,
  };
}

export function readRecentCompanionRoutingEvents(
  limit = 40,
  path = configuredCompanionRoutingPaths().events,
  profileId?: string
): CompanionRoutingEvent[] {
  if (!existsSync(path)) return [];
  if (!Number.isFinite(limit) || limit < 1 || statSync(path).size > MAX_EVENT_JOURNAL_BYTES * 2) {
    return [];
  }
  const boundedLimit = Math.min(500, Math.floor(limit));
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [validateCompanionRoutingEvent(JSON.parse(line) as unknown)];
      } catch {
        return [];
      }
    })
    .filter((event) => !profileId || event.profileId === profileId)
    .slice(-boundedLimit);
}

/** Test seam for credential/model-pool changes. */
export function resetCompanionModelRoutingCache(): void {
  candidateCache = null;
}
