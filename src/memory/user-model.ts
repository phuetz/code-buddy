/**
 * Local user model (Hermes parity — "a deepening model of who you are").
 *
 * Hermes' headline pairs the learning loop with a model of the user that
 * deepens across sessions. Code Buddy already has the learning-loop half
 * (lessons + the lesson-candidate review queue). This is the paired half: a
 * STRUCTURED, queryable, review-gated model of the user's working preferences
 * built from typed observations — distinct from the free-form key/value
 * `CODEBUDDY_MEMORY.md` store.
 *
 * Two deliberate constraints, mirroring the lesson-candidate queue:
 *
 *   1. NO SILENT WRITE. The agent (or a human) PROPOSES observations; nothing
 *      enters the active model until a human accepts one. Proposing only writes
 *      the side-car `.codebuddy/user-model.json`.
 *
 *   2. NARROW PRIVACY SCOPE. Only working preferences, traits, expertise and
 *      working-style are in scope. Health, finances, relationships, credentials
 *      and other sensitive personal data are screened out and refused — this
 *      file must never become a dossier. (See SENSITIVE_PATTERNS.)
 *
 * This is not a silent profiler. LLM and deterministic local inference only
 * propose review-gated observations; the active model changes only after
 * explicit human acceptance.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { CodeBuddyClient } from '../codebuddy/client.js';
import { detectProviderFromEnv } from '../utils/provider-detector.js';
import type { ChatEntry } from '../agent/types.js';

export const USER_MODEL_SCHEMA_VERSION = 1;

export type UserObservationKind = 'preference' | 'trait' | 'expertise' | 'working-style';
export type UserObservationStatus = 'pending' | 'accepted' | 'discarded';

export const USER_OBSERVATION_KINDS: UserObservationKind[] = [
  'preference',
  'trait',
  'expertise',
  'working-style',
];

/**
 * Conservative screen for content that must never be recorded in the user
 * model. Matching is case-insensitive and intentionally broad — when in doubt,
 * the observation is refused rather than stored.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(health|medical|illness|disease|diagnos|disabilit|mdph|therapy|medication|mental health)\b/i,
  /\b(salary|wage|income|net worth|bank|iban|credit card|ssn|social security|tax)\b/i,
  /\b(relationship|married|divorce|girlfriend|boyfriend|partner|spouse|family)\b/i,
  /\b(password|api[_ -]?key|secret|token|credential)\b/i,
  /\b(religio|political|sexual|ethnicit|race)\b/i,
];

export interface UserObservationProvenance {
  runId?: string;
  sessionId?: string;
  note?: string;
}

export interface UserObservation {
  id: string;
  kind: UserObservationKind;
  content: string;
  /** 0..1 confidence the proposer attaches; informational only. */
  confidence?: number;
  status: UserObservationStatus;
  createdAt: number;
  source: 'self_observed' | 'manual';
  provenance?: UserObservationProvenance;
  reviewedAt?: number;
  reviewedBy?: string;
  reviewNote?: string;
}

export interface ObserveUserInput {
  kind: UserObservationKind;
  content: string;
  confidence?: number;
  source?: 'self_observed' | 'manual';
  provenance?: UserObservationProvenance;
}

export interface ObserveUserResult {
  observation: UserObservation;
  /** True when an equivalent pending/accepted observation already existed. */
  deduped: boolean;
}

export interface AcceptUserObservationInput {
  /** Explicit human reviewer — required. Accepting is the only model write. */
  reviewedBy: string;
  content?: string;
  kind?: UserObservationKind;
  reviewNote?: string;
}

export interface DiscardUserObservationInput {
  reviewedBy?: string;
  reason?: string;
}

export interface UserModelStats {
  total: number;
  byStatus: Record<UserObservationStatus, number>;
  byKind: Record<UserObservationKind, number>;
}

export interface UserLocalInferenceOptions {
  provenance?: UserObservationProvenance;
}

interface UserModelFile {
  schemaVersion: typeof USER_MODEL_SCHEMA_VERSION;
  observations: UserObservation[];
}

/** Raised when an observation is refused by the privacy screen. */
export class UserModelPrivacyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserModelPrivacyError';
  }
}

// ============================================================================
// Singleton registry (one model per working directory)
// ============================================================================

const registry = new Map<string, LocalUserModel>();

export function getUserModel(workDir: string = process.cwd()): LocalUserModel {
  const key = path.resolve(workDir);
  if (!registry.has(key)) {
    registry.set(key, new LocalUserModel(key));
    if (registry.size > 20) {
      const firstKey = registry.keys().next().value;
      if (firstKey) registry.delete(firstKey);
    }
  }
  return registry.get(key)!;
}

/** Test helper: drop cached model instances so a fresh workDir is re-read. */
export function resetUserModels(): void {
  registry.clear();
}

/** Screen content against the privacy boundary. Returns the reason on a hit. */
export function screenUserModelContent(content: string): string | null {
  for (const pattern of SENSITIVE_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      return `refused: "${match[0]}" is outside the user-model privacy scope (working preferences only)`;
    }
  }
  return null;
}

// ============================================================================
// LocalUserModel
// ============================================================================

export class LocalUserModel {
  private filePath: string;
  private observations: UserObservation[] = [];
  private loaded = false;

  constructor(private workDir: string = process.cwd()) {
    // Workspace-scoped for now (mirrors the lesson-candidate queue). A
    // cross-workspace / ~/.codebuddy merge is future work.
    this.filePath = path.join(workDir, '.codebuddy', 'user-model.json');
  }

  /**
   * Propose an observation about the user. This is the "agent proposes" half:
   * it never folds into the active model. Equivalent pending/accepted
   * observations (same kind + content) collapse onto the existing one, and
   * sensitive content is refused by the privacy screen.
   */
  observe(input: ObserveUserInput): ObserveUserResult {
    this.load();
    const kind = normalizeKind(input.kind);
    const content = (input.content ?? '').trim();
    if (!content) {
      throw new Error('User observation content is required.');
    }

    const privacyReason = screenUserModelContent(content);
    if (privacyReason) {
      throw new UserModelPrivacyError(privacyReason);
    }

    const existing = this.observations.find(
      (obs) =>
        obs.status !== 'discarded' &&
        obs.kind === kind &&
        obs.content.trim().toLowerCase() === content.toLowerCase(),
    );
    if (existing) {
      return { observation: existing, deduped: true };
    }

    const observation: UserObservation = {
      id: `um-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      kind,
      content,
      ...(typeof input.confidence === 'number' ? { confidence: clampConfidence(input.confidence) } : {}),
      status: 'pending',
      createdAt: Date.now(),
      source: input.source ?? 'self_observed',
      ...(input.provenance && hasProvenance(input.provenance) ? { provenance: input.provenance } : {}),
    };
    this.observations.push(observation);
    this.save();
    return { observation, deduped: false };
  }

  list(status?: UserObservationStatus): UserObservation[] {
    this.load();
    const items = status ? this.observations.filter((o) => o.status === status) : this.observations;
    return [...items].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): UserObservation | null {
    this.load();
    return this.observations.find((o) => o.id === id) ?? null;
  }

  /** The active model: accepted observations only. */
  getAccepted(kind?: UserObservationKind): UserObservation[] {
    this.load();
    return this.observations.filter((o) => o.status === 'accepted' && (!kind || o.kind === kind));
  }

  /**
   * Accept a pending observation into the active model. The ONLY method that
   * mutates the model. Requires an explicit human reviewer; supports inline
   * edits. Re-screens edited content against the privacy boundary.
   */
  accept(id: string, input: AcceptUserObservationInput): UserObservation {
    this.load();
    const reviewedBy = input.reviewedBy?.trim();
    if (!reviewedBy) {
      throw new Error('Human approval (reviewedBy) is required before an observation enters the user model.');
    }

    const obs = this.observations.find((o) => o.id === id);
    if (!obs) {
      throw new Error(`User observation not found: ${id}`);
    }
    if (obs.status !== 'pending') {
      throw new Error(`User observation ${id} is already ${obs.status}; only pending observations can be accepted.`);
    }

    const kind = input.kind ? normalizeKind(input.kind) : obs.kind;
    const content = (input.content ?? obs.content).trim();
    if (!content) {
      throw new Error('Accepted observation content cannot be empty.');
    }
    const privacyReason = screenUserModelContent(content);
    if (privacyReason) {
      throw new UserModelPrivacyError(privacyReason);
    }

    obs.status = 'accepted';
    obs.kind = kind;
    obs.content = content;
    obs.reviewedAt = Date.now();
    obs.reviewedBy = reviewedBy;
    if (input.reviewNote?.trim()) {
      obs.reviewNote = input.reviewNote.trim();
    }
    this.save();
    return obs;
  }

  /** Reject an observation. Discarding an accepted one removes it from the model. */
  discard(id: string, input: DiscardUserObservationInput = {}): UserObservation {
    this.load();
    const obs = this.observations.find((o) => o.id === id);
    if (!obs) {
      throw new Error(`User observation not found: ${id}`);
    }
    if (obs.status === 'discarded') {
      throw new Error(`User observation ${id} is already discarded; discarded observations cannot be discarded again.`);
    }
    obs.status = 'discarded';
    obs.reviewedAt = Date.now();
    if (input.reviewedBy?.trim()) {
      obs.reviewedBy = input.reviewedBy.trim();
    }
    if (input.reason?.trim()) {
      obs.reviewNote = input.reason.trim();
    }
    this.save();
    return obs;
  }

  /**
   * Build a compact prompt-injection block from accepted observations, grouped
   * by kind. Returns null when the model is empty (avoids noisy injection).
   */
  summarize(): string | null {
    this.load();
    const accepted = this.observations.filter((o) => o.status === 'accepted');
    if (accepted.length === 0) return null;

    const lines = ['<user_model>', '## What we know about the user (accepted, working preferences only)', ''];
    const labels: Record<UserObservationKind, string> = {
      preference: 'Preferences',
      trait: 'Traits',
      expertise: 'Expertise',
      'working-style': 'Working style',
    };
    for (const kind of USER_OBSERVATION_KINDS) {
      const items = accepted.filter((o) => o.kind === kind);
      if (items.length === 0) continue;
      lines.push(`**${labels[kind]}:**`);
      for (const item of items) {
        lines.push(`- ${item.content}`);
      }
    }
    lines.push('</user_model>');
    return lines.join('\n');
  }

  getStats(): UserModelStats {
    this.load();
    const byStatus: Record<UserObservationStatus, number> = { pending: 0, accepted: 0, discarded: 0 };
    const byKind: Record<UserObservationKind, number> = {
      preference: 0,
      trait: 0,
      expertise: 0,
      'working-style': 0,
    };
    for (const obs of this.observations) {
      byStatus[obs.status] += 1;
      byKind[obs.kind] += 1;
    }
    return { total: this.observations.length, byStatus, byKind };
  }

  /** Clear observations (all, or only one status). Returns the count removed. */
  clear(status?: UserObservationStatus): number {
    this.load();
    const before = this.observations.length;
    this.observations = status ? this.observations.filter((o) => o.status !== status) : [];
    this.save();
    return before - this.observations.length;
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as UserModelFile;
      if (Array.isArray(parsed.observations)) {
        this.observations = parsed.observations.filter(isValidObservation);
      }
    } catch (err) {
      logger.warn('[user-model] failed to load model', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const file: UserModelFile = {
        schemaVersion: USER_MODEL_SCHEMA_VERSION,
        observations: this.observations,
      };
      fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('[user-model] failed to save model', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeKind(value: UserObservationKind | string): UserObservationKind {
  const lower = String(value ?? '').toLowerCase() as UserObservationKind;
  if (!USER_OBSERVATION_KINDS.includes(lower)) {
    throw new Error(`kind must be one of: ${USER_OBSERVATION_KINDS.join(', ')}`);
  }
  return lower;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function hasProvenance(provenance: UserObservationProvenance): boolean {
  return Boolean(provenance.runId || provenance.sessionId || provenance.note);
}

function isValidObservation(value: unknown): value is UserObservation {
  if (typeof value !== 'object' || value === null) return false;
  const obs = value as Partial<UserObservation>;
  return (
    typeof obs.id === 'string' &&
    typeof obs.content === 'string' &&
    typeof obs.kind === 'string' &&
    USER_OBSERVATION_KINDS.includes(obs.kind as UserObservationKind) &&
    (obs.status === 'pending' || obs.status === 'accepted' || obs.status === 'discarded')
  );
}

/**
 * Run dialectic inference on a session's chat history/transcript.
 * This analyzes the transcript with an LLM and proposes candidate observations.
 */
export async function runUserDialecticInference(
  chatHistory: ChatEntry[],
  workDir: string = process.cwd(),
  client?: CodeBuddyClient
): Promise<UserObservation[]> {
  if (!chatHistory || chatHistory.length === 0) {
    logger.debug('[user-model] No chat history to run dialectic inference on.');
    return [];
  }

  // 1. Resolve LLM client
  let llmClient: CodeBuddyClient;
  if (client) {
    llmClient = client;
  } else {
    const detected = detectProviderFromEnv();
    if (!detected) {
      logger.warn('[user-model] No LLM provider configuration found. Skipping dialectic inference.');
      return [];
    }
    llmClient = new CodeBuddyClient(detected.apiKey, detected.defaultModel, detected.baseURL);
  }

  // Format transcript for the prompt
  const transcriptLines: string[] = [];
  for (const entry of chatHistory) {
    if (entry.type === 'user') {
      transcriptLines.push(`User: ${entry.content}`);
    } else if (entry.type === 'assistant') {
      transcriptLines.push(`Assistant: ${entry.content}`);
    } else if (entry.type === 'tool_result') {
      const toolName = entry.toolCall?.function?.name || 'unknown';
      const outputPreview = entry.content.length > 500 ? entry.content.slice(0, 500) + '...' : entry.content;
      transcriptLines.push(`[Tool Result - ${toolName}]: ${outputPreview}`);
    }
  }
  const transcript = transcriptLines.join('\n');

  const systemPrompt = `You are the user-model dialectic engine for Code Buddy.
Your task is to analyze the history of the conversation between the user and the AI assistant, and infer the user's working preferences, traits, expertise, or working style.

Analyze the transcript and identify any clear, concrete preferences/traits/expertise/working style of the user.
Follow these rules:
1. ONLY return observations related to working preferences, traits, expertise, or working-style.
2. DO NOT extract personal sensitive information like health, relationships, finances, credentials, religion, or politics.
3. Be specific and concise (e.g. "Prefers typescript for backend projects", "Uses Vitest for testing").
4. Rate your confidence from 0.0 to 1.0.
5. You must output the result as a raw JSON array matching this TypeScript type:
Array<{
  kind: 'preference' | 'trait' | 'expertise' | 'working-style';
  content: string;
  confidence: number;
}>

Example output:
[
  {
    "kind": "preference",
    "content": "Prefers writing clean TypeScript and using ESM modules.",
    "confidence": 0.9
  }
]`;

  const userPrompt = `Here is the conversation transcript to analyze:\n\n${transcript}`;

  try {
    const response = await llmClient.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]);

    const reply = response.choices[0]?.message?.content || '';
    const candidates = parseLLMResponse(reply);

    const model = getUserModel(workDir);
    const proposed: UserObservation[] = [];

    for (const cand of candidates) {
      const content = (cand.content || '').trim();
      const confidence = typeof cand.confidence === 'number' ? cand.confidence : 0.5;
      let kind: UserObservationKind;

      try {
        kind = normalizeKind(cand.kind);
      } catch {
        continue;
      }

      if (!content) {
        continue;
      }

      // Check privacy screen
      if (screenUserModelContent(content)) {
        logger.debug(`[user-model] Dialectic observation screened out: ${content}`);
        continue;
      }

      try {
        const { observation, deduped } = model.observe({
          kind,
          content,
          confidence,
          source: 'self_observed',
          provenance: {
            note: 'Dialectic LLM inference'
          }
        });
        if (!deduped) {
          proposed.push(observation);
          logger.info(`[user-model] Proposed dialectic observation: ${observation.content} (${observation.kind})`);
        }
      } catch (err) {
        logger.debug('[user-model] Failed to propose observation', { error: String(err) });
      }
    }

    return proposed;
  } catch (err) {
    logger.warn('[user-model] Dialectic inference LLM call failed', {
      error: err instanceof Error ? err.message : String(err)
    });
    return [];
  }
}

/**
 * Deterministic, credential-free inference for obvious working preferences.
 *
 * This is intentionally conservative and review-gated: it only proposes
 * pending observations when repeated/local transcript cues are clear, and it
 * never writes into the accepted user model.
 */
export function runUserLocalInference(
  chatHistory: ChatEntry[],
  workDir: string = process.cwd(),
  options: UserLocalInferenceOptions = {},
): UserObservation[] {
  if (!chatHistory || chatHistory.length === 0) {
    logger.debug('[user-model] No chat history to run local inference on.');
    return [];
  }

  const userText = chatHistory
    .filter((entry) => entry.type === 'user')
    .map((entry) => entry.content)
    .join('\n');
  const proposed: UserObservation[] = [];
  const model = getUserModel(workDir);
  const provenance = {
    note: 'Local deterministic inference',
    ...options.provenance,
  };

  for (const candidate of inferLocalUserObservations(userText)) {
    try {
      const { observation, deduped } = model.observe({
        ...candidate,
        source: 'self_observed',
        provenance,
      });
      if (!deduped) {
        proposed.push(observation);
      }
    } catch (err) {
      logger.debug('[user-model] Local inference candidate screened out', { error: String(err) });
    }
  }

  return proposed;
}

function inferLocalUserObservations(userText: string): ObserveUserInput[] {
  const text = userText.trim();
  if (!text) return [];

  const candidates: ObserveUserInput[] = [];
  const lower = text.toLowerCase();
  const hasRealTestSignal =
    /\btests?\s+r[ée]els?\b/i.test(text)
    || /\btest[s]?\s+real\b/i.test(lower)
    || /\bno\s+mocks?\b/i.test(lower)
    || /\bpas\s+de\s+mocks?\b/i.test(lower)
    || /\bdu\s+r[ée]el\b/i.test(text);
  if (hasRealTestSignal) {
    candidates.push({
      kind: 'working-style',
      content: 'Prefers real verification paths over mocks for completion evidence.',
      confidence: 0.92,
    });
  }

  const autonomousSignal =
    /\bmode autonome\b/i.test(lower)
    || (/\bautonome\b/i.test(lower) && /\bcontinue\b/i.test(lower))
    || /\btoutes\s+les\s+10\s+minutes\b/i.test(lower)
    || /<heartbeat>/i.test(text);
  if (autonomousSignal) {
    candidates.push({
      kind: 'working-style',
      content: 'Prefers autonomous continuation with concise periodic progress when the task is clear.',
      confidence: 0.85,
    });
  }

  const commitPushSignal =
    /\bcommit(?:ter)?\b/i.test(lower) && /\bpush\b/i.test(lower);
  if (commitPushSignal) {
    candidates.push({
      kind: 'preference',
      content: 'Wants useful verified changes committed and pushed after completion.',
      confidence: 0.8,
    });
  }

  if (countFrenchSignals(text) >= 2) {
    candidates.push({
      kind: 'preference',
      content: 'Prefers French for collaboration updates.',
      confidence: 0.78,
    });
  }

  return candidates;
}

function countFrenchSignals(text: string): number {
  const signals = [
    /\bje\b/i,
    /\btu\b/i,
    /\bfais\b/i,
    /\bcorrige\b/i,
    /\bam[ée]liore\b/i,
    /\bcontinuer?\b/i,
    /\bqu['’]?as\b/i,
    /[àâçéèêëîïôùûü]/i,
  ];
  return signals.filter((pattern) => pattern.test(text)).length;
}

function parseLLMResponse(text: string): Array<{ kind: string; content: string; confidence: number }> {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
  const jsonText = (jsonMatch ? jsonMatch[1] : text) ?? text;
  try {
    const parsed = JSON.parse(jsonText.trim());
    if (Array.isArray(parsed)) return parsed;
  } catch (err) {
    logger.warn('[user-model] Failed to parse user dialectic JSON response', { text, error: String(err) });
  }
  return [];
}
