#!/usr/bin/env npx tsx

/**
 * Build the identity LoRA manifest from a Darkstar candidates directory and
 * run both training gates on it (documented step 5 of §6.1 in
 * docs/cinematic-trailer-production.md):
 *
 *   1. the byte gate — `assessDatasetQuality` on the *selected* PNGs only;
 *   2. the identity gate — `assessIdentityDataset` in strictCoverage.
 *
 * Fail-closed by design: candidates listed in ai-preflight.json's
 * `holdForHumanDecision` are excluded unless explicitly reinstated with
 * `--include <id>`, every PNG's bytes are re-hashed against the sidecar's
 * `outputSha256`, and the human approvals (`--license-cleared`,
 * `--evidence-reviewed-by`, `--identity-approved-by`) default to false — the
 * expected first run therefore FAILS on exactly those human gates. The script
 * never trains and never publishes; it only writes `identity-manifest.json`
 * and `identity-gate-report.json` next to the candidates.
 */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assessIdentityDataset,
  type IdentityDatasetImage,
  type IdentityDatasetManifest,
} from '../../src/lora/identity-dataset-gate.js';
import { assessDatasetQuality, type DatasetQualityReport } from '../../src/lora/quality-gate.js';
import { AVATAR_LISA_BRUNETTE, type AvatarProfile } from '../../src/lora/lisa-avatar-bible.js';
import { VARIATIONS } from './generate-krea2-identity-dataset.js';

const DEFAULT_DIR = '.codebuddy/lora/lisa-hq-v2/identity-candidates';
const DEFAULT_APPARENT_AGE = 25; // the avatar bible pins Lisa "mid-20s"

export interface ImageBuckets {
  angle: string;
  framing: string;
  expression: string;
  lighting: string;
  outfit: string;
  background: string;
}

/**
 * Per-variation coverage buckets, aligned index-for-index with the generator's
 * VARIATIONS prompts. Sidecars are matched to a variation by exact prompt
 * string, never by filename order, so a re-ordered prompt list cannot silently
 * mislabel an image.
 */
export const VARIATION_BUCKETS: readonly ImageBuckets[] = [
  { angle: 'front', framing: 'close-up', expression: 'neutral', lighting: 'soft-even-studio', outfit: 'black-crew-neck', background: 'light-gray-studio' },
  { angle: 'three-quarter-left', framing: 'medium', expression: 'calm', lighting: 'soft-window', outfit: 'navy-crew-neck', background: 'warm-gray-studio' },
  { angle: 'three-quarter-right', framing: 'medium', expression: 'smile-closed', lighting: 'diffused-key', outfit: 'charcoal-crew-neck', background: 'cool-gray-studio' },
  { angle: 'profile-left', framing: 'medium', expression: 'relaxed', lighting: 'rim', outfit: 'black-crew-neck', background: 'off-white-studio' },
  { angle: 'front', framing: 'waist-up', expression: 'serious', lighting: 'soft-window', outfit: 'white-blouse', background: 'neutral-studio' },
  { angle: 'front', framing: 'full-body', expression: 'neutral', lighting: 'soft-even-studio', outfit: 'jeans-black-top', background: 'seamless-gray-studio' },
  { angle: 'front', framing: 'close-up', expression: 'smile-open', lighting: 'soft-window', outfit: 'dark-top', background: 'beige-studio' },
  { angle: 'off-camera', framing: 'waist-up', expression: 'thoughtful', lighting: 'cinematic-side', outfit: 'burgundy-sweater', background: 'blue-gray-studio' },
  { angle: 'profile-right', framing: 'medium', expression: 'neutral', lighting: 'soft-even-studio', outfit: 'green-crew-neck', background: 'light-gray-studio' },
  { angle: 'three-quarter-left', framing: 'shoulder-up', expression: 'smile-closed', lighting: 'diffuse-daylight', outfit: 'pale-blue-blouse', background: 'cream-studio' },
  { angle: 'front', framing: 'medium-seated', expression: 'neutral', lighting: 'soft-frontal', outfit: 'gray-cardigan', background: 'beige-studio' },
  { angle: 'three-quarter', framing: 'full-body', expression: 'calm', lighting: 'soft-even-studio', outfit: 'black-trousers-ivory-top', background: 'white-studio' },
  { angle: 'front', framing: 'close-up', expression: 'serious', lighting: 'hard-key', outfit: 'black-top', background: 'charcoal-studio' },
  { angle: 'front', framing: 'medium', expression: 'neutral', lighting: 'natural-diffuse', outfit: 'denim-jacket', background: 'outdoor-urban' },
  { angle: 'three-quarter-right', framing: 'waist-up', expression: 'smile-open', lighting: 'soft-window', outfit: 'rust-sweater', background: 'home-interior' },
  { angle: 'front', framing: 'shoulder-up', expression: 'composed', lighting: 'softbox', outfit: 'navy-blazer', background: 'office' },
  { angle: 'front', framing: 'close-up', expression: 'attentive', lighting: 'clamshell', outfit: 'burgundy-crew-neck', background: 'warm-gray-studio' },
  { angle: 'front', framing: 'close-up', expression: 'laugh', lighting: 'soft-window', outfit: 'dark-blue-top', background: 'beige-studio' },
  { angle: 'off-camera-left', framing: 'medium', expression: 'concerned', lighting: 'soft-directional', outfit: 'olive-sweater', background: 'cool-gray-studio' },
  { angle: 'near-profile-right', framing: 'shoulder-up', expression: 'calm', lighting: 'rim', outfit: 'black-turtleneck', background: 'off-white-studio' },
  { angle: 'front', framing: 'full-body', expression: 'neutral', lighting: 'soft-even-studio', outfit: 'navy-dress', background: 'pale-gray-studio' },
  { angle: 'front', framing: 'waist-up', expression: 'smile-subtle', lighting: 'diffuse-daylight', outfit: 'denim-shirt', background: 'cream-studio' },
  { angle: 'off-camera-down', framing: 'close-up', expression: 'introspective', lighting: 'cinematic-top', outfit: 'charcoal-top', background: 'deep-gray-studio' },
  { angle: 'front', framing: 'medium', expression: 'neutral', lighting: 'soft-even-studio', outfit: 'white-crew-neck', background: 'light-gray-studio' },
];

export function bucketsForPrompt(prompt: string): ImageBuckets | undefined {
  const index = (VARIATIONS as readonly string[]).indexOf(prompt.trim());
  return index >= 0 ? VARIATION_BUCKETS[index] : undefined;
}

/**
 * Map the generator's claimed rights basis onto the gate's vocabulary.
 * `unverified` (and anything unknown) deliberately has no mapping — an
 * unverifiable claim must surface as an input problem, not be normalised.
 */
export function mapRightsBasis(
  claimed: string,
): IdentityDatasetManifest['rights']['basis'] | undefined {
  switch (claimed) {
    case 'synthetic-owned':
      return 'synthetic-owned';
    case 'consented-person':
      return 'consented-person';
    case 'licensed':
    case 'licensed-character':
      return 'licensed-character';
    default:
      return undefined;
  }
}

const IMMUTABLE_TRAIT_KEYWORDS = ['skin', 'eyes', 'hair', 'cheekbones', 'lips', 'mid-20s'];

/**
 * Derive the canonical immutable-trait fingerprint from the avatar bible's
 * locked identity, keeping only the fragments that describe traits which must
 * never drift (skin, eyes, hair, bone structure, apparent age band) — single
 * source of truth in lisa-avatar-bible.ts, not a copied string.
 */
export function canonicalImmutableTraits(profile: AvatarProfile = AVATAR_LISA_BRUNETTE): string {
  return profile.identity
    .split(', ')
    .filter((fragment) => IMMUTABLE_TRAIT_KEYWORDS.some((keyword) => fragment.includes(keyword)))
    .join(', ');
}

export interface CandidateSidecar {
  id: string;
  prompt: string;
  outputSha256: string;
  subjectId: string;
  claimedIdentityRightsBasis: string;
  workflowRevision?: string;
  referenceSha256?: string;
}

export interface CandidateInput {
  sidecar: CandidateSidecar;
  imagePath: string;
  /** SHA-256 actually computed from the PNG bytes on disk. */
  imageSha256: string;
}

export interface BuildManifestOptions {
  apparentAge: number;
  licenseCleared: boolean;
  evidenceReviewedBy?: string;
  identityApprovedBy?: string;
  identityConsent: boolean;
}

export interface BuildManifestResult {
  manifest: IdentityDatasetManifest;
  /** Input-integrity problems; any entry means the manifest is not trustworthy. */
  problems: string[];
}

/** Pure manifest assembly — no filesystem access, fully testable. */
export function buildIdentityManifest(
  candidates: CandidateInput[],
  options: BuildManifestOptions,
): BuildManifestResult {
  const problems: string[] = [];
  if (candidates.length === 0) problems.push('no-candidates');

  const subjects = new Set(candidates.map((c) => c.sidecar.subjectId));
  if (subjects.size > 1) {
    problems.push(`mixed-subjects:${[...subjects].sort().join(',')}`);
  }
  const claimedBases = new Set(candidates.map((c) => c.sidecar.claimedIdentityRightsBasis));
  if (claimedBases.size > 1) {
    problems.push(`mixed-rights-bases:${[...claimedBases].sort().join(',')}`);
  }
  const claimedBasis = [...claimedBases][0] ?? '';
  const basis = mapRightsBasis(claimedBasis);
  if (candidates.length > 0 && !basis) {
    problems.push(`unmappable-rights-basis:${claimedBasis || 'empty'}`);
  }

  const workflowRevisions = new Set(
    candidates.map((c) => c.sidecar.workflowRevision).filter(Boolean),
  );
  const referenceShas = new Set(
    candidates.map((c) => c.sidecar.referenceSha256).filter(Boolean),
  );
  const traits = canonicalImmutableTraits();
  const personId = [...subjects][0] ?? '';

  const images: IdentityDatasetImage[] = [];
  for (const candidate of candidates) {
    if (candidate.imageSha256 !== candidate.sidecar.outputSha256) {
      problems.push(`sha-mismatch:${candidate.sidecar.id}`);
      continue;
    }
    const buckets = bucketsForPrompt(candidate.sidecar.prompt);
    if (!buckets) {
      problems.push(`unknown-variation:${candidate.sidecar.id}`);
      continue;
    }
    images.push({
      path: candidate.imagePath,
      sha256: candidate.imageSha256,
      ...buckets,
      personId: candidate.sidecar.subjectId,
      apparentAge: options.apparentAge,
      // The per-image fingerprint is the claim, checked by the human identity
      // review, that this image respects the canonical traits; the gate
      // catches any *declared* drift when datasets are merged later.
      immutableTraits: traits,
    });
  }

  const manifest: IdentityDatasetManifest = {
    personId,
    rights: {
      basis: basis ?? 'synthetic-owned',
      provenance: candidates.length
        ? [
            'darkstar comfyui krea2 identity edit',
            ...(workflowRevisions.size ? [`workflow ${[...workflowRevisions].sort().join(',')}`] : []),
            ...(referenceShas.size ? [`reference sha256 ${[...referenceShas].sort().join(',')}`] : []),
            'generator scripts/darkstar/generate-krea2-identity-dataset.ts',
          ].join('; ')
        : '',
      licenseCleared: options.licenseCleared,
      identityConsent: options.identityConsent,
      evidenceReviewed: Boolean(options.evidenceReviewedBy?.trim()),
    },
    identityApproved: Boolean(options.identityApprovedBy?.trim()),
    canonicalImmutableTraits: traits,
    images,
  };
  return { manifest, problems };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseSidecar(value: unknown, fileBase: string): CandidateSidecar | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id !== fileBase ||
    typeof value.prompt !== 'string' ||
    typeof value.outputSha256 !== 'string' ||
    typeof value.subjectId !== 'string' ||
    typeof value.claimedIdentityRightsBasis !== 'string'
  ) {
    return undefined;
  }
  return {
    id: value.id,
    prompt: value.prompt,
    outputSha256: value.outputSha256,
    subjectId: value.subjectId,
    claimedIdentityRightsBasis: value.claimedIdentityRightsBasis,
    ...(typeof value.workflowRevision === 'string'
      ? { workflowRevision: value.workflowRevision }
      : {}),
    ...(typeof value.referenceSha256 === 'string'
      ? { referenceSha256: value.referenceSha256 }
      : {}),
  };
}

const SIDECAR_RE = /^([a-z][a-z0-9_-]*_identity_\d{3})\.json$/;

export interface CollectResult {
  candidates: CandidateInput[];
  /** Candidate ids excluded because ai-preflight.json holds them for a human. */
  excludedHeld: string[];
  problems: string[];
}

/** Read sidecars + PNGs from a candidates directory, hashing real bytes. */
export async function collectCandidates(
  dir: string,
  includeHeld: ReadonlySet<string> = new Set(),
): Promise<CollectResult> {
  const problems: string[] = [];
  const candidates: CandidateInput[] = [];

  let held: string[] = [];
  try {
    const preflight = JSON.parse(
      await fs.readFile(path.join(dir, 'ai-preflight.json'), 'utf8'),
    ) as unknown;
    if (isRecord(preflight) && isRecord(preflight.visualRecommendation)) {
      const hold = preflight.visualRecommendation.holdForHumanDecision;
      if (Array.isArray(hold)) held = hold.filter((id): id is string => typeof id === 'string');
    }
  } catch {
    problems.push('missing-or-invalid-ai-preflight');
  }
  const excludedHeld = held.filter((id) => !includeHeld.has(id)).sort();
  const excluded = new Set(excludedHeld);

  const entries = (await fs.readdir(dir)).sort();
  for (const entry of entries) {
    const match = SIDECAR_RE.exec(entry);
    if (!match) continue;
    const id = match[1]!;
    if (excluded.has(id)) continue;
    let sidecar: CandidateSidecar | undefined;
    try {
      sidecar = parseSidecar(JSON.parse(await fs.readFile(path.join(dir, entry), 'utf8')), id);
    } catch {
      /* handled below as invalid-sidecar */
    }
    if (!sidecar) {
      problems.push(`invalid-sidecar:${id}`);
      continue;
    }
    const imagePath = path.join(dir, `${id}.png`);
    let imageSha256: string;
    try {
      imageSha256 = createHash('sha256').update(await fs.readFile(imagePath)).digest('hex');
    } catch {
      problems.push(`missing-image:${id}`);
      continue;
    }
    try {
      await fs.access(path.join(dir, `${id}.txt`));
    } catch {
      problems.push(`missing-caption:${id}`);
      continue;
    }
    candidates.push({ sidecar, imagePath, imageSha256 });
  }
  return { candidates, excludedHeld, problems };
}

/**
 * Run the byte gate on exactly the selected PNGs by staging copies in a
 * throwaway `<tmp>/images` directory (assessDatasetQuality scans a project's
 * images/ subdirectory; held/excluded files must not leak into the report).
 */
export async function runByteGate(images: readonly string[]): Promise<DatasetQualityReport> {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'identity-byte-gate-'));
  try {
    const imagesDir = path.join(staging, 'images');
    await fs.mkdir(imagesDir);
    for (const image of images) {
      await fs.copyFile(image, path.join(imagesDir, path.basename(image)));
    }
    return await assessDatasetQuality(staging);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

function argument(name: string, fallback: string): string {
  const exact = process.argv.indexOf(`--${name}`);
  if (exact >= 0 && process.argv[exact + 1]) return process.argv[exact + 1]!;
  const prefix = `--${name}=`;
  return process.argv.find((entry) => entry.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function repeatable(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] === `--${name}` && process.argv[index + 1]) {
      values.push(process.argv[index + 1]!);
    } else if (process.argv[index]!.startsWith(`--${name}=`)) {
      values.push(process.argv[index]!.slice(`--${name}=`.length));
    }
  }
  return values;
}

export function parseApparentAge(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 120) {
    throw new Error('--apparent-age must be a plausible positive number of years');
  }
  return value;
}

async function writeReportAtomically(destination: string, value: unknown): Promise<void> {
  await writeTextAtomically(destination, serializeJson(value));
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeTextAtomically(destination: string, content: string): Promise<void> {
  const temporary = `${destination}.tmp-${randomUUID()}`;
  await fs.writeFile(temporary, content);
  await fs.rename(temporary, destination);
}

async function main(): Promise<void> {
  const dir = path.resolve(argument('dir', DEFAULT_DIR));
  const apparentAge = parseApparentAge(argument('apparent-age', String(DEFAULT_APPARENT_AGE)));
  const includeHeld = new Set(repeatable('include'));
  const evidenceReviewedBy = argument('evidence-reviewed-by', '').trim();
  const identityApprovedBy = argument('identity-approved-by', '').trim();

  const collected = await collectCandidates(dir, includeHeld);
  const built = buildIdentityManifest(collected.candidates, {
    apparentAge,
    licenseCleared: flag('license-cleared'),
    identityConsent: flag('identity-consent'),
    ...(evidenceReviewedBy ? { evidenceReviewedBy } : {}),
    ...(identityApprovedBy ? { identityApprovedBy } : {}),
  });
  const inputProblems = [...collected.problems, ...built.problems];

  const byteGate = await runByteGate(built.manifest.images.map((image) => image.path));
  const identity = assessIdentityDataset(built.manifest, {
    strictCoverage: true,
    qualityReport: byteGate,
  });
  const ok = inputProblems.length === 0 && identity.ok;
  const manifestText = serializeJson(built.manifest);
  const manifestSha256 = createHash('sha256').update(manifestText).digest('hex');

  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    dir,
    ok,
    imageCount: built.manifest.images.length,
    // Binds the human approvals and both gate results to the exact manifest
    // bytes consumed by the promotion step. A later manifest edit invalidates
    // this report instead of silently inheriting its approvals.
    manifestSha256,
    excludedHeld: collected.excludedHeld,
    reinstatedHeld: [...includeHeld].sort(),
    inputProblems,
    approvals: {
      licenseCleared: built.manifest.rights.licenseCleared,
      evidenceReviewedBy: evidenceReviewedBy || null,
      identityApprovedBy: identityApprovedBy || null,
    },
    byteGate,
    identity,
  };

  await writeTextAtomically(path.join(dir, 'identity-manifest.json'), manifestText);
  await writeReportAtomically(path.join(dir, 'identity-gate-report.json'), report);

  console.log(`[identity-manifest] dir=${dir} images=${report.imageCount} ok=${ok}`);
  if (collected.excludedHeld.length) {
    console.log(`[identity-manifest] held for human decision: ${collected.excludedHeld.join(', ')}`);
  }
  for (const problem of inputProblems) console.log(`PROBLEM ${problem}`);
  for (const blocker of identity.blockers) console.log(`BLOCKER ${blocker}`);
  for (const warning of [...byteGate.warnings, ...identity.warnings]) console.log(`WARN    ${warning}`);
  if (!ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
