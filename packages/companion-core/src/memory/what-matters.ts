/**
 * The « what matters » sheet — a short, named list of the things a companion
 * must not forget. Deliberately NOT a general memory: a dozen entries at most,
 * each with a provenance, a date and a confidence, so what is remembered can be
 * shown, corrected and forgotten.
 *
 * Two guards define it as much as the API:
 *   - **soft forgetting**, not deletion: an inferred fact loses confidence with
 *     time and drops out; an explicit or pinned one never fades.
 *   - **no clinical record**: a fact may say a rhythm of life, never a diagnosis,
 *     a prescription or a treatment. Those are refused at the door.
 *
 * @module memory/what-matters
 */

import type { Fact, FactProvenance } from '../types.js';

/** Hard ceiling — the sheet is a handful of things that matter, not a dossier. */
export const MAX_FACTS = 12;

/** Confidence below which an unpinned fact leaves the sheet. */
export const FORGET_FLOOR = 0.2;

/** Half-life of an unpinned fact's confidence, in days. */
export const SOFT_FORGET_HALF_LIFE_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_CONFIDENCE: Record<FactProvenance, number> = {
  explicit: 1,
  confirmed: 0.9,
  inferred: 0.5,
};

/** Explicit and confirmed facts are pinned by default; inferred ones are not. */
const DEFAULT_PINNED: Record<FactProvenance, boolean> = {
  explicit: true,
  confirmed: true,
  inferred: false,
};

/**
 * A claim that would turn the sheet into a medical record. The companion is not
 * a clinician; a rhythm of life is welcome, a diagnosis is not.
 */
const CLINICAL =
  /(diagnostic|diagnostique|prescri|posologie|traitement de|ordonnance|symptomes? de|pathologie|diagnos(is|ed)|prescription|dosage|treatment for|medical record)/i;

/** The sheet, in insertion order. Callers keep it as plain data. */
export type WhatMattersSheet = readonly Fact[];

export interface RememberInput {
  key: string;
  value: string;
  provenance?: FactProvenance;
  source?: string;
  /** Override the provenance default. */
  confidence?: number;
  /** Override the provenance default. */
  pinned?: boolean;
}

export type RememberResult =
  | { ok: true; sheet: Fact[]; fact: Fact }
  | { ok: false; sheet: Fact[]; reason: 'empty' | 'clinical' };

function slug(key: string): string {
  return key
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** True when a value reads like a clinical claim and must not be stored. */
export function isClinicalClaim(value: string): boolean {
  // Speech-to-text drops accents; « symptômes » and « symptomes » are the same claim.
  const folded = (value ?? '').normalize('NFD').replace(/\p{M}+/gu, '');
  return CLINICAL.test(folded);
}

/**
 * Add or reconfirm a fact. Reconfirming an existing key raises its confidence
 * and refreshes its date rather than creating a duplicate. Never throws.
 */
export function remember(
  sheet: WhatMattersSheet,
  input: RememberInput,
  now: number,
): RememberResult {
  const key = slug(input.key ?? '');
  const value = (input.value ?? '').trim();
  const current = [...sheet];
  if (!key || !value) return { ok: false, sheet: current, reason: 'empty' };
  if (isClinicalClaim(value)) return { ok: false, sheet: current, reason: 'clinical' };

  const provenance: FactProvenance = input.provenance ?? 'inferred';
  const index = current.findIndex((fact) => fact.key === key);
  const existing = index >= 0 ? current[index] : undefined;
  const baseConfidence = input.confidence ?? DEFAULT_CONFIDENCE[provenance];
  const fact: Fact = {
    key,
    value,
    provenance,
    at: existing?.at ?? now,
    updatedAt: now,
    confidence: Math.max(0, Math.min(1, existing ? Math.max(existing.confidence, baseConfidence) : baseConfidence)),
    pinned: input.pinned ?? (existing?.pinned || DEFAULT_PINNED[provenance]),
  };
  if (input.source) fact.source = input.source;
  else if (existing?.source) fact.source = existing.source;

  const next = index >= 0 ? current.map((f, i) => (i === index ? fact : f)) : [...current, fact];
  return { ok: true, sheet: evict(next), fact };
}

/** Drop the weakest unpinned facts once the sheet exceeds `MAX_FACTS`. */
function evict(sheet: readonly Fact[]): Fact[] {
  if (sheet.length <= MAX_FACTS) return [...sheet];
  const ranked = [...sheet].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    return b.updatedAt - a.updatedAt;
  });
  const kept = new Set(ranked.slice(0, MAX_FACTS).map((f) => f.key));
  return sheet.filter((fact) => kept.has(fact.key));
}

export interface RecallOptions {
  /** Only facts at or above this confidence. */
  minConfidence?: number;
  /** Cap the number returned (strongest first). */
  limit?: number;
  /** Only these keys. */
  keys?: readonly string[];
}

/** Read the sheet back, strongest first. Pinned facts always rank above the rest. */
export function recall(sheet: WhatMattersSheet, options: RecallOptions = {}): Fact[] {
  const min = options.minConfidence ?? 0;
  const wanted = options.keys ? new Set(options.keys.map(slug)) : null;
  const rows = sheet
    .filter((fact) => fact.confidence >= min && (!wanted || wanted.has(fact.key)))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      return b.updatedAt - a.updatedAt;
    });
  return options.limit != null ? rows.slice(0, Math.max(0, options.limit)) : rows;
}

/** Remove a fact outright — the user asked to forget it. */
export function forget(sheet: WhatMattersSheet, key: string): Fact[] {
  const target = slug(key ?? '');
  return sheet.filter((fact) => fact.key !== target);
}

/**
 * Soft forgetting: unpinned facts lose confidence on an exponential curve and
 * leave the sheet below `FORGET_FLOOR`. Pinned, explicit and confirmed facts are
 * untouched — the sheet is what the companion promised to remember.
 */
export function applySoftForgetting(
  sheet: WhatMattersSheet,
  now: number,
  options: { halfLifeDays?: number; floor?: number } = {},
): Fact[] {
  const halfLife = Math.max(1, options.halfLifeDays ?? SOFT_FORGET_HALF_LIFE_DAYS);
  const floor = options.floor ?? FORGET_FLOOR;
  const out: Fact[] = [];
  for (const fact of sheet) {
    if (fact.pinned) {
      out.push(fact);
      continue;
    }
    const ageDays = Math.max(0, (now - fact.updatedAt) / DAY_MS);
    const retention = Math.pow(0.5, ageDays / halfLife);
    const confidence = fact.confidence * retention;
    if (confidence < floor) continue;
    out.push({ ...fact, confidence });
  }
  return out;
}

/** A jargon-free block a prompt can carry: one short line per fact, no numbers. */
export function describeWhatMatters(sheet: WhatMattersSheet, limit = 6): string {
  const rows = recall(sheet, { limit });
  if (rows.length === 0) return '';
  return rows.map((fact) => `- ${fact.value}`).join('\n');
}

/** Coerce untrusted rows (a JSON file, a database) into facts. Never throws. */
export function normalizeSheet(input: unknown): Fact[] {
  if (!Array.isArray(input)) return [];
  const out: Fact[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const key = typeof record.key === 'string' ? slug(record.key) : '';
    const value = typeof record.value === 'string' ? record.value.trim() : '';
    if (!key || !value || isClinicalClaim(value)) continue;
    const provenance: FactProvenance =
      record.provenance === 'explicit' || record.provenance === 'confirmed' ? record.provenance : 'inferred';
    const at = typeof record.at === 'number' ? record.at : 0;
    const fact: Fact = {
      key,
      value,
      provenance,
      at,
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : at,
      confidence:
        typeof record.confidence === 'number' && Number.isFinite(record.confidence)
          ? Math.max(0, Math.min(1, record.confidence))
          : DEFAULT_CONFIDENCE[provenance],
      pinned: typeof record.pinned === 'boolean' ? record.pinned : DEFAULT_PINNED[provenance],
    };
    if (typeof record.source === 'string') fact.source = record.source;
    out.push(fact);
  }
  return evict(out);
}
