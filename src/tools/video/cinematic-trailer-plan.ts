/**
 * Cinematic book-trailer grammar + typed plan contract + fail-closed validation.
 *
 * This is an *editorial* contract, not a rendering engine. It never generates
 * media, spends credits or contacts a service. Its only bridge to execution is a
 * PREVIEW compilation into the existing {@link HybridVideoRequest} shape so the
 * shared {@link routeHybridVideoBatch} router can estimate/distribute work —
 * the preview always reports `executionAuthorized: false`.
 *
 * Both entry points accept `unknown`: {@link validateCinematicTrailerPlan} and
 * {@link compileTrailerPreview} defensively coerce a malformed or partial value
 * into a safe shape and surface the damage as blockers instead of throwing. A
 * malformed plan collapses to `INCOMPLETE` with explicit `malformed-plan[:…]`
 * blockers; it never masks the narrative/business problems that survive coercion.
 *
 * The vocabulary mirrors `bandes-annonces/FLOW-STORYBOARD-TEMPLATE.md` and
 * `FLOW-CINEMATIC-GRAMMAR.md` in the livres-codex pack, but carries no runtime
 * dependency on that repository.
 *
 * @module tools/video/cinematic-trailer-plan
 */

import type { ContentTier } from '../../media/content-tier.js';
import {
  routeHybridVideoBatch,
  type HybridVideoCapacity,
  type HybridVideoRequest,
  type HybridVideoRoute,
  type HybridVideoUseCase,
} from './hybrid-video-router.js';

/** Stable narrative-function tokens (English, matching the storyboard template). */
export const NARRATIVE_TOKENS = [
  'hook',
  'world',
  'protagonist',
  'revelation',
  'escalation',
  'price',
  'false-resolution',
  'withheld',
  'brand',
  'cta',
] as const;
export type NarrativeToken = (typeof NARRATIVE_TOKENS)[number];

/**
 * Minimal contract: the six/eight functions every trailer must cover.
 * `revelation` and `false-resolution` stay optional dramatic devices.
 */
export const REQUIRED_NARRATIVE_TOKENS: readonly NarrativeToken[] = [
  'hook',
  'world',
  'protagonist',
  'escalation',
  'price',
  'withheld',
  'brand',
  'cta',
];

/** Tokens whose shots are purely editorial (cover/title) — no manuscript source. */
const EDITORIAL_TOKENS: ReadonlySet<string> = new Set<string>(['brand', 'cta']);

/** Approval ladder — a higher state is never inferred from the previous one. */
export type TrailerStatus =
  | 'INCOMPLETE'
  | 'READY_FOR_PREFLIGHT'
  | 'APPROVED_FOR_GENERATION'
  | 'APPROVED_FOR_PUBLICATION';

const STATUS_ORDER: readonly TrailerStatus[] = [
  'INCOMPLETE',
  'READY_FOR_PREFLIGHT',
  'APPROVED_FOR_GENERATION',
  'APPROVED_FOR_PUBLICATION',
];

export interface ManuscriptSource {
  /** Manuscript file inside the book pack. */
  file: string;
  /** Scene or line locator within that file. */
  locator: string;
}

export interface TrailerCharacterRef {
  /** Character id referenced by shots. */
  id: string;
  /** Pinned identity / LoRA version for continuity across shots. */
  identityVersion: string;
  /** Approved reference asset path. */
  reference: string;
  /** SHA-256 of the approved reference (64 hex chars). */
  referenceSha256: string;
  /** Explicit human casting approval — never inferred from cover art. */
  castingApproved: boolean;
}

export interface TrailerOverlay {
  timecodeSeconds: number;
  text: string;
  /** Provenance of the words. */
  source: 'manuscript' | 'editorial';
  /** Text sits inside the shared 9:16 / 16:9 safe zone. */
  safeZone: boolean;
}

export interface TrailerShot {
  id: string;
  token: NarrativeToken;
  /** Manuscript evidence — required for every narrative (non-editorial) shot. */
  manuscriptSource?: ManuscriptSource;
  /** The single new information this shot conveys. */
  information: string;
  /** The single human action verb. */
  action: string;
  /** The single camera move (or `static`). */
  cameraMove: string;
  durationSeconds: number;
  /** Recurring characters visible in the shot (ids into `characters`). */
  characters: string[];
  /** 12–18 stable frames at the head for a real editing handle. */
  entryHandle: boolean;
  /** 12–18 stable frames at the tail. */
  exitHandle: boolean;
  /** Text baked into the generated image is forbidden — must stay false. */
  burnedInText: boolean;
  rejectionConditions: string[];
  /** Fleet routing hint. */
  useCase: HybridVideoUseCase;
  requiresLipSync?: boolean;
  premium?: boolean;
}

export interface TrailerRetentionHypotheses {
  hookA: string;
  hookB: string;
  promise: string;
  proofWithinThreeSeconds: string;
  deeperPayoff: string;
  singleAbVariable: string;
}

export interface TrailerCost {
  /** The credit cost was shown in the UI before any approval. */
  displayedInUi: boolean;
  estimatedFlowCredits: number;
  approvedCeilingFlowCredits: number;
  /** Who approved the ceiling (empty ⇒ not approved). */
  approvedBy?: string;
}

/** Separate human approvals — each must be granted explicitly. */
export interface TrailerApprovals {
  narrativeReviewed: boolean;
  castingReviewed: boolean;
  costApproved: boolean;
  publicationApproved: boolean;
}

export interface TrailerPublication {
  visibility: 'private';
  autoPublish: false;
  containsSyntheticMedia: true;
  humanReviewRequired: true;
}

export interface CinematicTrailerPlan {
  schemaVersion: 1;
  /** Status the author claims — validation downgrades it fail-closed. */
  status: TrailerStatus;
  /** Book trailers are advertiser-facing; only `safe` is permitted. */
  contentTier: ContentTier;
  book: {
    title: string;
    genre: string;
    /** "We move from <A> to <B>, seen from <POV>, without revealing <answer>." */
    stagingSentence: string;
    spoilerLimit: string;
    commercialAction: string;
  };
  /** Master cut target in seconds (60–90s per method). Derivatives are remixed. */
  masterDurationSeconds: number;
  characters: TrailerCharacterRef[];
  shots: TrailerShot[];
  overlays: TrailerOverlay[];
  sound: {
    /** Four separated layers: ambience, foley, motif, speech. */
    layers: string[];
    /** Rendered master deliverables (one layer never doubled across masters). */
    masters: string[];
  };
  retention: TrailerRetentionHypotheses;
  cost: TrailerCost;
  approvals: TrailerApprovals;
  publication: TrailerPublication;
}

export interface TrailerValidation {
  /** Effective status = min(claimed, qualified). Fail-closed, never promoted. */
  status: TrailerStatus;
  claimedStatus: TrailerStatus;
  /** Highest gate the plan actually qualifies for. */
  qualifiedStatus: TrailerStatus;
  /**
   * Reasons the plan is not sound. Structural (`malformed-plan…`) and narrative
   * blockers are ALWAYS listed — they are diagnostic and never hidden, even when
   * the claimed status is `INCOMPLETE`. Generation- and publication-gate reasons
   * are listed only when the *claimed* status reaches that rung of the ladder,
   * so `blockers` answers "why is the claim not met" without ever suppressing a
   * structural defect.
   */
  blockers: string[];
  warnings: string[];
}

const SHA256_RE = /^[a-f0-9]{64}$/i;
function isSha256(value: string): boolean {
  return SHA256_RE.test(value.trim());
}

// Temporal connectors that betray more than one action/move packed in a field.
const SEQUENCE_CONNECTOR = /(\bpuis\b|\bthen\b|\bensuite\b|\bpendant que\b|\bwhile\b|\bmeanwhile\b|\band then\b|\s&\s|\s\+\s)/iu;
function packsMultiple(text: string): boolean {
  return SEQUENCE_CONNECTOR.test(text.trim());
}

function statusIndex(status: TrailerStatus): number {
  return STATUS_ORDER.indexOf(status);
}

function isTrailerStatus(value: unknown): value is TrailerStatus {
  return typeof value === 'string' && (STATUS_ORDER as readonly string[]).includes(value);
}

// ── Defensive coercion of an untrusted plan ───────────────────────────────
// The public entry points accept `unknown`. These helpers coerce each field to
// a safe shape (never throwing) and the caller records `malformed-plan[:…]`
// blockers for anything missing or mistyped, so a broken plan degrades to
// INCOMPLETE + diagnostics rather than a crash.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN;
}
function asBoolean(value: unknown): boolean {
  return value === true;
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function asStringArray(value: unknown): string[] {
  return asArray(value).map(asString);
}

interface SafeCharacter {
  id: string;
  identityVersion: string;
  reference: string;
  referenceSha256: string;
  castingApproved: boolean;
}
interface SafeShot {
  id: string;
  token: string;
  hasManuscriptSource: boolean;
  manuscriptFile: string;
  manuscriptLocator: string;
  information: string;
  action: string;
  cameraMove: string;
  durationSeconds: number;
  characters: string[];
  entryHandle: boolean;
  exitHandle: boolean;
  burnedInText: boolean;
  rejectionConditions: string[];
  useCase: string;
  requiresLipSync: boolean;
  premium: boolean;
}
interface SafeOverlay {
  timecodeSeconds: number;
  text: string;
  source: string;
  safeZone: boolean;
}
interface SafePlan {
  schemaVersion: number;
  status: TrailerStatus;
  contentTier: string;
  book: { title: string; genre: string; stagingSentence: string; spoilerLimit: string; commercialAction: string };
  masterDurationSeconds: number;
  characters: SafeCharacter[];
  shots: SafeShot[];
  overlays: SafeOverlay[];
  sound: { layers: string[]; masters: string[] };
  retention: { hookA: string; hookB: string; promise: string; proofWithinThreeSeconds: string; deeperPayoff: string; singleAbVariable: string };
  cost: { displayedInUi: boolean; estimatedFlowCredits: number; approvedCeilingFlowCredits: number; approvedBy: string };
  approvals: { narrativeReviewed: boolean; castingReviewed: boolean; costApproved: boolean; publicationApproved: boolean };
  publication: { visibility: unknown; autoPublish: unknown; containsSyntheticMedia: unknown; humanReviewRequired: unknown };
}

function normalizeCharacter(value: unknown): SafeCharacter {
  const r = isRecord(value) ? value : {};
  return {
    id: asString(r.id),
    identityVersion: asString(r.identityVersion),
    reference: asString(r.reference),
    referenceSha256: asString(r.referenceSha256),
    castingApproved: asBoolean(r.castingApproved),
  };
}

function normalizeShot(value: unknown): SafeShot {
  const r = isRecord(value) ? value : {};
  const src = isRecord(r.manuscriptSource) ? r.manuscriptSource : null;
  return {
    id: asString(r.id),
    token: asString(r.token),
    hasManuscriptSource: src !== null,
    manuscriptFile: src ? asString(src.file) : '',
    manuscriptLocator: src ? asString(src.locator) : '',
    information: asString(r.information),
    action: asString(r.action),
    cameraMove: asString(r.cameraMove),
    durationSeconds: asNumber(r.durationSeconds),
    characters: asStringArray(r.characters),
    entryHandle: asBoolean(r.entryHandle),
    exitHandle: asBoolean(r.exitHandle),
    burnedInText: asBoolean(r.burnedInText),
    rejectionConditions: asStringArray(r.rejectionConditions),
    useCase: asString(r.useCase),
    requiresLipSync: asBoolean(r.requiresLipSync),
    premium: asBoolean(r.premium),
  };
}

function normalizeOverlay(value: unknown): SafeOverlay {
  const r = isRecord(value) ? value : {};
  return {
    timecodeSeconds: asNumber(r.timecodeSeconds),
    text: asString(r.text),
    source: asString(r.source),
    safeZone: asBoolean(r.safeZone),
  };
}

/**
 * Coerce an untrusted value into a {@link SafePlan}. Records one
 * `malformed-plan[:section]` blocker per missing/mistyped structural piece so
 * the malformed shape is explicit, while still exposing every business problem
 * that survives coercion (per-section defaults keep the narrative checks alive).
 */
function normalizePlan(input: unknown): { plan: SafePlan; structural: string[] } {
  const structural: string[] = [];
  const root = isRecord(input) ? input : null;
  if (!root) structural.push('malformed-plan');
  const o: Record<string, unknown> = root ?? {};

  if (root && !isTrailerStatus(o.status)) structural.push('invalid-status');
  const status: TrailerStatus = isTrailerStatus(o.status) ? o.status : 'INCOMPLETE';

  const bookRec = isRecord(o.book) ? o.book : null;
  if (root && !bookRec) structural.push('malformed-plan:book');
  const b: Record<string, unknown> = bookRec ?? {};

  const soundRec = isRecord(o.sound) ? o.sound : null;
  if (root && !soundRec) structural.push('malformed-plan:sound');
  const s: Record<string, unknown> = soundRec ?? {};

  const retentionRec = isRecord(o.retention) ? o.retention : null;
  if (root && !retentionRec) structural.push('malformed-plan:retention');
  const ret: Record<string, unknown> = retentionRec ?? {};

  const costRec = isRecord(o.cost) ? o.cost : null;
  if (root && !costRec) structural.push('malformed-plan:cost');
  const c: Record<string, unknown> = costRec ?? {};

  const approvalsRec = isRecord(o.approvals) ? o.approvals : null;
  if (root && !approvalsRec) structural.push('malformed-plan:approvals');
  const a: Record<string, unknown> = approvalsRec ?? {};

  const publicationRec = isRecord(o.publication) ? o.publication : null;
  if (root && !publicationRec) structural.push('malformed-plan:publication');
  const p: Record<string, unknown> = publicationRec ?? {};

  if (root && !Array.isArray(o.characters)) structural.push('malformed-plan:characters');
  if (root && !Array.isArray(o.shots)) structural.push('malformed-plan:shots');
  if (root && !Array.isArray(o.overlays)) structural.push('malformed-plan:overlays');

  const plan: SafePlan = {
    schemaVersion: asNumber(o.schemaVersion),
    status,
    contentTier: asString(o.contentTier),
    book: {
      title: asString(b.title),
      genre: asString(b.genre),
      stagingSentence: asString(b.stagingSentence),
      spoilerLimit: asString(b.spoilerLimit),
      commercialAction: asString(b.commercialAction),
    },
    masterDurationSeconds: asNumber(o.masterDurationSeconds),
    characters: asArray(o.characters).map(normalizeCharacter),
    shots: asArray(o.shots).map(normalizeShot),
    overlays: asArray(o.overlays).map(normalizeOverlay),
    sound: { layers: asStringArray(s.layers), masters: asStringArray(s.masters) },
    retention: {
      hookA: asString(ret.hookA),
      hookB: asString(ret.hookB),
      promise: asString(ret.promise),
      proofWithinThreeSeconds: asString(ret.proofWithinThreeSeconds),
      deeperPayoff: asString(ret.deeperPayoff),
      singleAbVariable: asString(ret.singleAbVariable),
    },
    cost: {
      displayedInUi: asBoolean(c.displayedInUi),
      estimatedFlowCredits: asNumber(c.estimatedFlowCredits),
      approvedCeilingFlowCredits: asNumber(c.approvedCeilingFlowCredits),
      approvedBy: asString(c.approvedBy),
    },
    approvals: {
      narrativeReviewed: asBoolean(a.narrativeReviewed),
      castingReviewed: asBoolean(a.castingReviewed),
      costApproved: asBoolean(a.costApproved),
      publicationApproved: asBoolean(a.publicationApproved),
    },
    publication: {
      visibility: p.visibility,
      autoPublish: p.autoPublish,
      containsSyntheticMedia: p.containsSyntheticMedia,
      humanReviewRequired: p.humanReviewRequired,
    },
  };
  return { plan, structural };
}

/**
 * Pure, fail-closed validation. Accepts an untrusted value: a malformed plan
 * degrades to `INCOMPLETE` with explicit `malformed-plan[:…]` blockers instead
 * of throwing. Returns categorised reasons; never throws for malformed narrative
 * content (only surfaces it as blockers/warnings).
 */
export function validateCinematicTrailerPlan(input: unknown): TrailerValidation {
  const { plan, structural } = normalizePlan(input);

  // Blockers that gate READY_FOR_PREFLIGHT (narrative completeness + safety).
  const narrative: string[] = [];
  // Extra blockers that gate APPROVED_FOR_GENERATION (casting + cost).
  const generation: string[] = [];
  // Extra blockers that gate APPROVED_FOR_PUBLICATION.
  const publication: string[] = [];
  const warnings: string[] = [];

  if (plan.schemaVersion !== 1) narrative.push('unsupported-schema');

  // ── Editorial contract ──────────────────────────────────────────────
  if (!plan.book.title.trim() || !plan.book.genre.trim()) narrative.push('missing-book-metadata');
  if (!plan.book.stagingSentence.trim()) narrative.push('missing-staging-sentence');
  if (!plan.book.spoilerLimit.trim()) narrative.push('missing-spoiler-limit');
  if (!plan.book.commercialAction.trim()) narrative.push('missing-commercial-action');

  // Book trailers are advertiser-safe by contract.
  if (plan.contentTier !== 'safe') narrative.push(`non-safe-trailer-tier:${plan.contentTier}`);

  if (!(plan.masterDurationSeconds >= 60 && plan.masterDurationSeconds <= 90)) {
    narrative.push('master-duration-out-of-range');
  }

  // ── Character declarations (integrity — always visible) ─────────────
  const declaredIds = new Set<string>();
  const declared = new Map<string, SafeCharacter>();
  for (const character of plan.characters) {
    const id = character.id.trim();
    if (!id) {
      narrative.push('empty-character-id');
      continue;
    }
    if (declaredIds.has(id)) {
      narrative.push(`duplicate-character-declaration:${id}`);
      continue;
    }
    declaredIds.add(id);
    declared.set(id, character);
  }

  // ── Shots / plan grammar ────────────────────────────────────────────
  const shotIds = new Set<string>();
  const covered = new Set<string>();
  const characterAppearances = new Map<string, number>();
  let timeline = 0;
  for (const shot of plan.shots) {
    if (!shot.id.trim() || shotIds.has(shot.id)) narrative.push('duplicate-or-empty-shot-id');
    shotIds.add(shot.id);
    covered.add(shot.token);

    if (!(shot.durationSeconds > 0 && shot.durationSeconds <= 12)) {
      narrative.push(`invalid-shot-duration:${shot.id}`);
    }
    if (Number.isFinite(shot.durationSeconds)) timeline += shot.durationSeconds;

    // One information / one action / one camera move per shot.
    if (packsMultiple(shot.information)) narrative.push(`multiple-information:${shot.id}`);
    if (packsMultiple(shot.action)) narrative.push(`multiple-action:${shot.id}`);
    if (packsMultiple(shot.cameraMove)) narrative.push(`multiple-camera-move:${shot.id}`);

    // Every narrative shot needs a manuscript source; editorial shots do not.
    if (!EDITORIAL_TOKENS.has(shot.token)) {
      if (!shot.hasManuscriptSource) {
        narrative.push(`missing-manuscript-source:${shot.id}`);
      } else if (!shot.manuscriptFile.trim() || !shot.manuscriptLocator.trim()) {
        narrative.push(`incomplete-manuscript-source:${shot.id}`);
      }
    }

    // Text baked into the frame is forbidden.
    if (shot.burnedInText) narrative.push(`burned-in-text-forbidden:${shot.id}`);

    if (!shot.entryHandle || !shot.exitHandle) warnings.push(`missing-editing-handle:${shot.id}`);
    if (!shot.rejectionConditions.length) warnings.push(`no-rejection-conditions:${shot.id}`);

    // Count a character at most once per shot: a repeated id inside one shot is
    // not "recurring across shots", so it must not fake up the recurring gate.
    const uniqueInShot = new Set(shot.characters.map((ch) => ch.trim()).filter(Boolean));
    for (const character of uniqueInShot) {
      characterAppearances.set(character, (characterAppearances.get(character) ?? 0) + 1);
    }
  }

  for (const token of REQUIRED_NARRATIVE_TOKENS) {
    if (!covered.has(token)) narrative.push(`missing-function:${token}`);
  }

  // Timeline continuity: the shots must sum to the declared master duration.
  if (plan.shots.length && Math.abs(timeline - plan.masterDurationSeconds) > 0.5) {
    narrative.push('timeline-duration-mismatch');
  }

  // ── Overlays ────────────────────────────────────────────────────────
  for (const overlay of plan.overlays) {
    if (!overlay.text.trim()) narrative.push('empty-overlay');
    // A finite timecode bounded by the master duration — otherwise the overlay
    // cannot be placed on the timeline at all.
    if (
      !Number.isFinite(overlay.timecodeSeconds) ||
      overlay.timecodeSeconds < 0 ||
      overlay.timecodeSeconds > plan.masterDurationSeconds
    ) {
      narrative.push(`overlay-timecode-out-of-range:${overlay.timecodeSeconds}`);
    }
    if (!overlay.safeZone) warnings.push(`overlay-outside-safe-zone:${overlay.timecodeSeconds}`);
  }

  // ── Sound ───────────────────────────────────────────────────────────
  // At least four DISTINCT non-empty layers (ambience, foley, motif, speech):
  // four copies of the same word is not a four-layer mix.
  const distinctLayers = new Set(plan.sound.layers.map((l) => l.trim().toLowerCase()).filter(Boolean));
  if (distinctLayers.size < 4) narrative.push('incomplete-sound-layers');
  if (!plan.sound.masters.filter((m) => m.trim()).length) narrative.push('missing-sound-master');

  // ── Retention hypotheses ────────────────────────────────────────────
  const r = plan.retention;
  if (
    !r.hookA.trim() || !r.hookB.trim() || !r.promise.trim() ||
    !r.proofWithinThreeSeconds.trim() || !r.deeperPayoff.trim() || !r.singleAbVariable.trim()
  ) {
    narrative.push('incomplete-retention-hypotheses');
  }

  // ── Publication safety (fail-closed, always enforced) ───────────────
  if (
    plan.publication.visibility !== 'private' ||
    plan.publication.autoPublish !== false ||
    plan.publication.containsSyntheticMedia !== true ||
    plan.publication.humanReviewRequired !== true
  ) {
    narrative.push('unsafe-publication-gate');
  }

  // ── Generation gate: casting + recurring identity + cost ────────────
  if (!plan.approvals.narrativeReviewed) generation.push('narrative-not-reviewed');
  if (!plan.approvals.castingReviewed) generation.push('casting-not-reviewed');

  for (const [id, appearances] of characterAppearances) {
    const ref = declared.get(id);
    if (!ref) {
      generation.push(`undeclared-character:${id}`);
      continue;
    }
    // Recurring characters (>1 shot) need an approved, hashed reference.
    if (appearances > 1) {
      if (!ref.reference.trim()) generation.push(`missing-character-reference:${id}`);
      if (!isSha256(ref.referenceSha256)) generation.push(`invalid-character-sha:${id}`);
      if (!ref.identityVersion.trim()) generation.push(`missing-identity-version:${id}`);
      // Cover art is never casting authority — approval must be explicit.
      if (!ref.castingApproved) generation.push(`character-casting-not-approved:${id}`);
    }
  }

  if (!plan.cost.displayedInUi) generation.push('cost-not-displayed');
  if (!plan.approvals.costApproved || !plan.cost.approvedBy.trim()) generation.push('cost-not-approved');
  // Cost figures must be real, finite and non-negative — otherwise a NaN/negative
  // silently defeats the ceiling comparison instead of blocking generation.
  const estimate = plan.cost.estimatedFlowCredits;
  const ceiling = plan.cost.approvedCeilingFlowCredits;
  if (!Number.isFinite(estimate) || estimate < 0) generation.push('invalid-cost-estimate');
  if (!Number.isFinite(ceiling) || ceiling < 0) generation.push('invalid-cost-ceiling');
  if (Number.isFinite(estimate) && Number.isFinite(ceiling) && estimate > ceiling) {
    generation.push('cost-exceeds-ceiling');
  }

  // ── Publication gate ────────────────────────────────────────────────
  if (!plan.approvals.publicationApproved) publication.push('publication-not-approved');

  // ── Ladder: highest gate actually met (each level is cumulative) ────
  let qualified: TrailerStatus = 'INCOMPLETE';
  const structuralOk = structural.length === 0;
  if (structuralOk && narrative.length === 0) qualified = 'READY_FOR_PREFLIGHT';
  if (structuralOk && narrative.length === 0 && generation.length === 0) qualified = 'APPROVED_FOR_GENERATION';
  if (structuralOk && narrative.length === 0 && generation.length === 0 && publication.length === 0) {
    qualified = 'APPROVED_FOR_PUBLICATION';
  }

  // Structural + narrative blockers are ALWAYS surfaced (diagnostic). Generation
  // and publication reasons are surfaced only when the *claimed* status reaches
  // that rung — preserving "blockers = why the claim is not met" for the ladder
  // while never hiding a structural/narrative defect at INCOMPLETE.
  const claimed = plan.status;
  const claimedIdx = statusIndex(claimed);
  const blockers: string[] = [...structural, ...narrative];
  if (claimedIdx >= statusIndex('APPROVED_FOR_GENERATION')) blockers.push(...generation);
  if (claimedIdx >= statusIndex('APPROVED_FOR_PUBLICATION')) blockers.push(...publication);

  // Effective status is never promoted above the claim, nor above what is met.
  const effectiveIdx = Math.min(claimedIdx, statusIndex(qualified));
  return {
    status: STATUS_ORDER[effectiveIdx] ?? 'INCOMPLETE',
    claimedStatus: claimed,
    qualifiedStatus: qualified,
    blockers,
    warnings,
  };
}

export interface TrailerPreviewCompilation {
  /** A preview NEVER authorizes execution. */
  executionAuthorized: false;
  /** A preview NEVER authorizes publication. */
  publicationAuthorized: false;
  /**
   * Gate state: the plan qualifies for generation AND the actually-routed cost
   * sits within the approved ceiling. Still not an authorization.
   */
  readyForGeneration: boolean;
  /** Gate state: the plan qualifies for publication (and routed cost is in budget). */
  readyForPublication: boolean;
  status: TrailerStatus;
  qualifiedStatus: TrailerStatus;
  blockers: string[];
  /** Shots mapped to the existing hybrid-video request shape (one clip each). */
  requests: HybridVideoRequest[];
  /** Estimate/distribution from the shared router — no execution triggered. */
  routing: { routes: HybridVideoRoute[]; estimatedFlowCredits: number };
}

/**
 * PREVIEW-only compilation to the existing hybrid-video request/route shapes.
 * Accepts an untrusted value and NEVER throws: a malformed plan or an
 * unavailable route yields empty/partial `requests`/`routing` plus a diagnostic
 * blocker, with `executionAuthorized`/`publicationAuthorized` always `false`.
 *
 * The router's own estimate is confronted with `approvedCeilingFlowCredits`: if
 * the distributed cost exceeds the approved ceiling, generation/publication are
 * marked not-ready and a `routed-cost-exceeds-ceiling` blocker is surfaced —
 * even when the plan's *declared* estimate looked within budget.
 */
export function compileTrailerPreview(
  input: unknown,
  capacity: HybridVideoCapacity,
): TrailerPreviewCompilation {
  const validation = validateCinematicTrailerPlan(input);
  const { plan } = normalizePlan(input);
  const blockers = [...validation.blockers];

  const requests: HybridVideoRequest[] = plan.shots.map((shot) => ({
    id: shot.id,
    useCase: shot.useCase as HybridVideoUseCase,
    contentTier: plan.contentTier as ContentTier,
    quantity: 1,
    requiresLipSync: shot.requiresLipSync,
    premium: shot.premium,
  }));

  let routing: { routes: HybridVideoRoute[]; estimatedFlowCredits: number } = {
    routes: [],
    estimatedFlowCredits: 0,
  };
  let routedCostWithinCeiling = false;
  try {
    routing = routeHybridVideoBatch(requests, capacity);
    if (routing.routes.length > 0) {
      const routed = routing.estimatedFlowCredits;
      const ceiling = plan.cost.approvedCeilingFlowCredits;
      if (Number.isFinite(ceiling) && ceiling >= 0 && Number.isFinite(routed) && routed <= ceiling) {
        routedCostWithinCeiling = true;
      } else {
        blockers.push(`routed-cost-exceeds-ceiling:${routed}>${ceiling}`);
      }
    }
  } catch (err) {
    // Route unavailability is a real business signal, not something to mask.
    routing = { routes: [], estimatedFlowCredits: 0 };
    blockers.push(`routing-unavailable:${err instanceof Error ? err.message : String(err)}`);
  }

  const generationQualified =
    validation.qualifiedStatus === 'APPROVED_FOR_GENERATION' ||
    validation.qualifiedStatus === 'APPROVED_FOR_PUBLICATION';
  const publicationQualified = validation.qualifiedStatus === 'APPROVED_FOR_PUBLICATION';

  return {
    executionAuthorized: false,
    publicationAuthorized: false,
    readyForGeneration: generationQualified && routedCostWithinCeiling,
    readyForPublication: publicationQualified && routedCostWithinCeiling,
    status: validation.status,
    qualifiedStatus: validation.qualifiedStatus,
    blockers,
    requests,
    routing,
  };
}
