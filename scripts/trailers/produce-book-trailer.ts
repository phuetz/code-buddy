#!/usr/bin/env npx tsx

/** Local book-trailer producer: plan, Flow handoff, and reviewed-later assembly. */

import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  planBookTrailer,
  type TrailerPlannerProvider,
} from '../../src/agent/film/trailer-planner.js';
import {
  extractCandidateExcerpts,
  loadBookManuscript,
  type CandidateExcerpt,
} from '../../src/tools/video/book-manuscript-source.js';
import {
  canonicalSha256,
  createGoogleFlowHandoff,
  verifyGoogleFlowHandoffDigest,
  type GoogleFlowHandoff,
  type GoogleFlowModel,
  type GoogleFlowSourceShot,
} from '../../src/tools/video/google-flow-handoff.js';
import {
  importGoogleFlowResults,
  type GoogleFlowImportReceipt,
} from '../../src/tools/video/google-flow-result-import.js';
import {
  validateCinematicTrailerPlan,
  type CinematicTrailerPlan,
  type TrailerShot,
} from '../../src/tools/video/cinematic-trailer-plan.js';
import {
  assembleFilm,
  type AssembleFilmInput,
  type AssembleFilmResult,
} from '../../src/tools/video/film-assemble.js';

const PLAN_FILENAME = 'trailer-plan.json';
const EXCERPTS_FILENAME = 'excerpts.json';
const HANDOFF_FILENAME = 'flow-handoff.json';
const TRAILER_RECEIPT_FILENAME = 'trailer-receipt.json';
const OVERLAY_TODO_FILENAME = 'trailer-overlay-todo.json';
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const MAX_SOURCE_IMAGE_BYTES = 50 * 1024 * 1024;

export interface ExcerptsDocument {
  schemaVersion: 1;
  book: {
    title: string;
    directory: string;
    coverPath?: string;
  };
  excerpts: CandidateExcerpt[];
}

export interface PlanStageOptions {
  bookDirectory: string;
  workspace: string;
  durationTargetSeconds?: number;
  force?: boolean;
}

export interface HandoffStageOptions {
  workspace: string;
  model?: GoogleFlowModel;
  aspectRatio?: '16:9' | '9:16';
  remainingFlowCredits?: number;
  force?: boolean;
}

export interface AssembleStageOptions {
  workspace: string;
  resultsDirectory: string;
  music?: string;
  force?: boolean;
}

export interface BookTrailerProducerDependencies {
  provider?: TrailerPlannerProvider;
  loadManuscript?: typeof loadBookManuscript;
  extractExcerpts?: typeof extractCandidateExcerpts;
  planTrailer?: typeof planBookTrailer;
  createHandoff?: typeof createGoogleFlowHandoff;
  importResults?: typeof importGoogleFlowResults;
  assemble?: (input: AssembleFilmInput) => Promise<AssembleFilmResult>;
  now?: () => Date;
}

interface TrailerReceiptClip {
  id: string;
  path: string;
  sha256: string;
}

interface UnsignedTrailerReceipt {
  schemaVersion: 1;
  status: 'pending-human-review';
  sourcePlanSha256: string;
  handoffSha256: string;
  importReceiptSha256: string;
  assembledAt: string;
  master: {
    path: string;
    sha256: string;
    mediaSidecarPath: string;
  };
  clips: TrailerReceiptClip[];
  overlays: {
    status: 'pending-operator-render';
    todoFile: string;
    count: number;
  };
  autoPublish: false;
  humanReviewRequired: true;
}

export interface TrailerReceipt extends UnsignedTrailerReceipt {
  receiptSha256: string;
}

function assertValidPlan(value: unknown): asserts value is CinematicTrailerPlan {
  const validation = validateCinematicTrailerPlan(value);
  if (
    validation.blockers.length > 0 ||
    validation.status === 'INCOMPLETE' ||
    validation.qualifiedStatus === 'INCOMPLETE'
  ) {
    throw new Error(`Trailer plan is not valid for preflight: ${validation.blockers.join(', ')}`);
  }
}

async function pathExists(filename: string): Promise<boolean> {
  try {
    await fs.lstat(filename);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function assertTargetsWritable(targets: readonly string[], force: boolean): Promise<void> {
  if (force) return;
  const existing = (await Promise.all(targets.map(async (target) =>
    (await pathExists(target)) ? target : undefined))).filter((target): target is string => Boolean(target));
  if (existing.length > 0) {
    throw new Error(`Refusing to overwrite existing output without --force: ${existing.join(', ')}`);
  }
}

async function writeJson(filename: string, value: unknown, force: boolean): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (!force) {
    await fs.writeFile(filename, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return;
  }
  const temporary = `${filename}.${process.pid}.tmp`;
  await fs.writeFile(temporary, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await fs.rename(temporary, filename);
}

async function readJsonFile(filename: string): Promise<{ bytes: Buffer; value: unknown }> {
  const info = await fs.lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_JSON_BYTES) {
    throw new Error(`JSON input is missing, unsafe, or too large: ${filename}`);
  }
  const bytes = await fs.readFile(filename);
  return { bytes, value: JSON.parse(bytes.toString('utf8')) as unknown };
}

async function sha256RegularFile(filename: string, maxBytes = Number.MAX_SAFE_INTEGER): Promise<string> {
  const info = await fs.lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maxBytes) {
    throw new Error(`Expected a non-empty regular file within the size limit: ${filename}`);
  }
  return createHash('sha256').update(await fs.readFile(filename)).digest('hex');
}

function assertExcerptsDocument(value: unknown): asserts value is ExcerptsDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Excerpts document must be an object');
  }
  const document = value as Partial<ExcerptsDocument>;
  if (
    document.schemaVersion !== 1 ||
    !document.book ||
    typeof document.book.title !== 'string' ||
    !path.isAbsolute(document.book.directory) ||
    (document.book.coverPath !== undefined && !path.isAbsolute(document.book.coverPath)) ||
    !Array.isArray(document.excerpts)
  ) {
    throw new Error('Excerpts document is malformed');
  }
}

function safeId(value: string, fallback: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 126);
  return normalized || fallback;
}

function uniqueJobIds(shots: readonly TrailerShot[]): string[] {
  const used = new Set<string>();
  return shots.map((shot, index) => {
    const base = safeId(shot.id, `shot-${index + 1}`);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base.slice(0, 120)}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

/** Pure cinematic prompt construction from the normative one-action shot grammar. */
export function buildTrailerMotionPrompt(plan: CinematicTrailerPlan, shot: TrailerShot): string {
  const characterDirective = shot.characters.length > 0
    ? `Visible recurring fictional adults: ${shot.characters.join(', ')}.`
    : 'No recurring character identity is required in this shot.';
  return [
    `Narrative function: ${shot.token}.`,
    `Single information: ${shot.information.trim()}.`,
    `Single action: ${shot.action.trim()}.`,
    `Single camera move: ${shot.cameraMove.trim()}.`,
    characterDirective,
    `Cinematic ${plan.book.genre} feature-film lighting, production design, natural depth of field and controlled contrast.`,
    'Preserve 12 to 18 stable frames at both head and tail as editing handles.',
    'Do not resolve the withheld climax. No captions, typography, title, watermark, logo or burned-in text.',
  ].join(' ');
}

interface ResolvedSource {
  path: string;
  sha256: string;
  characterName: string;
}

async function resolveShotSource(
  plan: CinematicTrailerPlan,
  shot: TrailerShot,
  excerpts: ExcerptsDocument,
): Promise<ResolvedSource> {
  const characters = new Map(plan.characters.map((character) => [character.id, character]));
  for (const id of shot.characters) {
    const character = characters.get(id);
    if (!character?.reference.trim()) continue;
    const referencePath = path.isAbsolute(character.reference)
      ? character.reference
      : path.resolve(excerpts.book.directory, character.reference);
    const actualSha256 = await sha256RegularFile(referencePath, MAX_SOURCE_IMAGE_BYTES);
    if (character.referenceSha256 !== actualSha256) {
      throw new Error(`Character reference digest mismatch for ${id}`);
    }
    if (!character.castingApproved) throw new Error(`Character reference is not casting-approved: ${id}`);
    return { path: await fs.realpath(referencePath), sha256: actualSha256, characterName: id };
  }
  if (!excerpts.book.coverPath) {
    throw new Error(`Shot ${shot.id} has no approved character reference or local book cover`);
  }
  const coverSha256 = await sha256RegularFile(excerpts.book.coverPath, MAX_SOURCE_IMAGE_BYTES);
  return {
    path: await fs.realpath(excerpts.book.coverPath),
    sha256: coverSha256,
    characterName: `adult ensemble for ${plan.book.title}`,
  };
}

/** Resolve one local, hashed Flow source per trailer shot; never generates media. */
export async function createTrailerFlowSourceShots(
  plan: CinematicTrailerPlan,
  excerpts: ExcerptsDocument,
): Promise<GoogleFlowSourceShot[]> {
  const ids = uniqueJobIds(plan.shots);
  return Promise.all(plan.shots.map(async (shot, index) => {
    const source = await resolveShotSource(plan, shot, excerpts);
    return {
      id: ids[index]!,
      characterName: source.characterName,
      declaredAdultAge: 30,
      sourcePath: source.path,
      sourceSha256: source.sha256,
      motionPrompt: buildTrailerMotionPrompt(plan, shot),
      role: shot.token === 'hook' ? 'hero' : shot.token === 'brand' || shot.token === 'cta' ? 'transition' : 'b-roll',
      consumerShortIds: ['book-trailer'],
      consumers: [{ shortId: 'book-trailer', shotIndex: index + 1 }],
    };
  }));
}

export async function runPlanStage(
  options: PlanStageOptions,
  dependencies: BookTrailerProducerDependencies = {},
): Promise<{ plan: CinematicTrailerPlan; excerpts: ExcerptsDocument }> {
  const workspace = path.resolve(options.workspace);
  const planPath = path.join(workspace, PLAN_FILENAME);
  const excerptsPath = path.join(workspace, EXCERPTS_FILENAME);
  await assertTargetsWritable([planPath, excerptsPath], options.force ?? false);
  const load = dependencies.loadManuscript ?? loadBookManuscript;
  const extract = dependencies.extractExcerpts ?? extractCandidateExcerpts;
  const planner = dependencies.planTrailer ?? planBookTrailer;
  const bookDirectory = path.resolve(options.bookDirectory);
  const manuscript = await load(bookDirectory);
  const excerpts = extract(manuscript);
  if (excerpts.length === 0) throw new Error('No cinematic candidate excerpts were found in the manuscript');
  const plan = await planner({
    manuscript,
    excerpts,
    ...(options.durationTargetSeconds !== undefined
      ? { durationTargetSeconds: options.durationTargetSeconds }
      : {}),
    ...(dependencies.provider ? { provider: dependencies.provider } : {}),
  });
  assertValidPlan(plan);
  const document: ExcerptsDocument = {
    schemaVersion: 1,
    book: {
      title: manuscript.title,
      directory: bookDirectory,
      ...(manuscript.coverPath ? { coverPath: manuscript.coverPath } : {}),
    },
    excerpts,
  };
  await fs.mkdir(workspace, { recursive: true });
  await writeJson(planPath, plan, options.force ?? false);
  await writeJson(excerptsPath, document, options.force ?? false);
  return { plan, excerpts: document };
}

export async function runHandoffStage(
  options: HandoffStageOptions,
  dependencies: BookTrailerProducerDependencies = {},
): Promise<GoogleFlowHandoff> {
  const workspace = path.resolve(options.workspace);
  const outputPath = path.join(workspace, HANDOFF_FILENAME);
  await assertTargetsWritable([outputPath], options.force ?? false);
  const [{ value: planValue }, { value: excerptValue }] = await Promise.all([
    readJsonFile(path.join(workspace, PLAN_FILENAME)),
    readJsonFile(path.join(workspace, EXCERPTS_FILENAME)),
  ]);
  assertValidPlan(planValue);
  assertExcerptsDocument(excerptValue);
  const remainingCredits = options.remainingFlowCredits ?? 25_000;
  if (!Number.isInteger(remainingCredits) || remainingCredits < 0) {
    throw new Error('Remaining Flow credits must be a non-negative integer');
  }
  const model = options.model ?? 'quality';
  const aspectRatio = options.aspectRatio ?? '16:9';
  const sourceShots = await createTrailerFlowSourceShots(planValue, excerptValue);
  const create = dependencies.createHandoff ?? createGoogleFlowHandoff;
  const handoff = create(sourceShots, {
    sourcePlanSha256: canonicalSha256(planValue),
    batchId: safeId(`book-${path.basename(workspace)}`, 'book-trailer'),
    model,
    locale: 'und',
    durationSeconds: 8,
    aspectRatio,
    upscale4k: false,
    capacity: {
      darkstar: false,
      ministar: false,
      googleFlow: true,
      remainingFlowCredits: remainingCredits,
      maxFlowCreditsPerBatch: remainingCredits,
    },
  });
  if (!verifyGoogleFlowHandoffDigest(handoff) || handoff.remainingCreditsAfterEstimate < 0) {
    throw new Error('Flow handoff failed its canonical digest or credit budget check');
  }
  await writeJson(outputPath, handoff, options.force ?? false);
  return handoff;
}

function assertImportReceipt(
  receipt: GoogleFlowImportReceipt,
  handoff: GoogleFlowHandoff,
): void {
  const { receiptSha256, ...unsigned } = receipt;
  const expectedIds = handoff.jobs.map((job) => job.id).sort();
  const actualIds = receipt.jobs.map((job) => job.id).sort();
  if (
    receipt.schemaVersion !== 2 ||
    canonicalSha256(unsigned) !== receiptSha256 ||
    receipt.batchId !== handoff.batchId ||
    receipt.sourcePlanSha256 !== handoff.sourcePlanSha256 ||
    receipt.handoffSha256 !== handoff.handoffSha256 ||
    receipt.autoPublish !== false ||
    receipt.humanReviewRequired !== true ||
    expectedIds.length !== actualIds.length ||
    expectedIds.some((id, index) => id !== actualIds[index]) ||
    receipt.jobs.some((job) => job.qaStatus !== 'pending-human-review')
  ) {
    throw new Error('Flow import receipt is invalid, incomplete, or not pending human review');
  }
}

async function findExistingImportReceipt(
  resultsDirectory: string,
  handoff: GoogleFlowHandoff,
): Promise<{ receipt: GoogleFlowImportReceipt; clipRoot: string } | undefined> {
  const candidates = [
    path.join(resultsDirectory, 'receipt.json'),
    path.join(resultsDirectory, handoff.batchId, 'receipt.json'),
  ];
  for (const candidate of candidates) {
    if (!(await pathExists(candidate))) continue;
    const { value } = await readJsonFile(candidate);
    const receipt = value as GoogleFlowImportReceipt;
    assertImportReceipt(receipt, handoff);
    const receiptDirectory = path.dirname(candidate);
    const clipRoot = path.basename(receiptDirectory) === handoff.batchId
      ? path.dirname(receiptDirectory)
      : receiptDirectory;
    return { receipt, clipRoot };
  }
  return undefined;
}

async function orderedImportedClips(
  receipt: GoogleFlowImportReceipt,
  handoff: GoogleFlowHandoff,
  clipRoot: string,
): Promise<TrailerReceiptClip[]> {
  const imported = new Map(receipt.jobs.map((job) => [job.id, job]));
  const clips: TrailerReceiptClip[] = [];
  for (const expected of handoff.jobs) {
    const job = imported.get(expected.id);
    if (!job) throw new Error(`Missing imported Flow clip: ${expected.id}`);
    const clipPath = path.resolve(clipRoot, job.outputFile);
    const relative = path.relative(path.resolve(clipRoot), clipPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Imported Flow clip escapes its receipt root: ${expected.id}`);
    }
    const actualSha256 = await sha256RegularFile(clipPath, 1024 * 1024 * 1024);
    if (actualSha256 !== job.sha256) throw new Error(`Imported Flow clip digest mismatch: ${expected.id}`);
    clips.push({ id: expected.id, path: clipPath, sha256: actualSha256 });
  }
  return clips;
}

/** Pure receipt construction after all filesystem hashes have been verified. */
export function createTrailerReceipt(
  input: Omit<UnsignedTrailerReceipt, 'schemaVersion' | 'status' | 'autoPublish' | 'humanReviewRequired'>,
): TrailerReceipt {
  const unsigned: UnsignedTrailerReceipt = {
    schemaVersion: 1,
    status: 'pending-human-review',
    ...input,
    autoPublish: false,
    humanReviewRequired: true,
  };
  return { ...unsigned, receiptSha256: canonicalSha256(unsigned) };
}

export async function runAssembleStage(
  options: AssembleStageOptions,
  dependencies: BookTrailerProducerDependencies = {},
): Promise<TrailerReceipt> {
  const workspace = path.resolve(options.workspace);
  const resultsDirectory = path.resolve(options.resultsDirectory);
  const receiptPath = path.join(workspace, TRAILER_RECEIPT_FILENAME);
  const overlayTodoPath = path.join(workspace, OVERLAY_TODO_FILENAME);
  const expectedMasterPath = path.join(
    workspace,
    '.codebuddy',
    'media-generation',
    'films',
    'book-trailer-master.mp4',
  );
  await assertTargetsWritable([
    receiptPath,
    overlayTodoPath,
    expectedMasterPath,
    `${expectedMasterPath}.meta.json`,
  ], options.force ?? false);
  const [{ value: planValue }, handoffFile] = await Promise.all([
    readJsonFile(path.join(workspace, PLAN_FILENAME)),
    readJsonFile(path.join(workspace, HANDOFF_FILENAME)),
  ]);
  assertValidPlan(planValue);
  const handoff = handoffFile.value as GoogleFlowHandoff;
  if (!verifyGoogleFlowHandoffDigest(handoff) || handoff.sourcePlanSha256 !== canonicalSha256(planValue)) {
    throw new Error('Flow handoff is invalid or does not match the trailer plan');
  }

  let imported = await findExistingImportReceipt(resultsDirectory, handoff);
  if (!imported) {
    const outputRoot = path.join(workspace, 'flow-import');
    const importer = dependencies.importResults ?? importGoogleFlowResults;
    const receipt = await importer({
      handoff,
      handoffBytes: handoffFile.bytes,
      resultsRoot: resultsDirectory,
      outputRoot,
      ...(dependencies.now ? { now: dependencies.now } : {}),
    });
    assertImportReceipt(receipt, handoff);
    imported = { receipt, clipRoot: outputRoot };
  }
  const clips = await orderedImportedClips(imported.receipt, handoff, imported.clipRoot);
  const assemble = dependencies.assemble ?? ((input: AssembleFilmInput) => assembleFilm(input));
  const result = await assemble({
    clips: clips.map((clip) => clip.path),
    transitions: 'fade',
    transitionDuration: 0.3,
    aspectRatio: handoff.jobs[0]!.settings.aspectRatio,
    resolution: '1080p',
    fit: 'cover',
    ...(options.music ? { music: path.resolve(options.music), musicVolume: 0.25, ducking: true } : {}),
    output: 'book-trailer-master.mp4',
    rootDir: workspace,
    name: planValue.book.title,
  });
  if (!result.success || !result.outputPath) {
    throw new Error(`Film assembly failed: ${result.error ?? 'no master output'}`);
  }
  const masterSha256 = await sha256RegularFile(result.outputPath, 10 * 1024 * 1024 * 1024);
  const mediaSidecarPath = `${result.outputPath}.meta.json`;
  await sha256RegularFile(mediaSidecarPath, MAX_JSON_BYTES);
  const overlayTodo = {
    schemaVersion: 1,
    status: 'pending-operator-render',
    reason: 'No existing repository component overlays timed text onto an assembled film; do not burn text into generated Flow clips.',
    masterPath: result.outputPath,
    overlays: planValue.overlays,
  } as const;
  await writeJson(overlayTodoPath, overlayTodo, options.force ?? false);

  const receipt = createTrailerReceipt({
    sourcePlanSha256: handoff.sourcePlanSha256,
    handoffSha256: handoff.handoffSha256,
    importReceiptSha256: imported.receipt.receiptSha256,
    assembledAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    master: {
      path: result.outputPath,
      sha256: masterSha256,
      mediaSidecarPath,
    },
    clips,
    overlays: {
      status: 'pending-operator-render',
      todoFile: overlayTodoPath,
      count: planValue.overlays.length,
    },
  });
  await writeJson(receiptPath, receipt, options.force ?? false);
  return receipt;
}

function argument(argv: readonly string[], name: string, fallback = ''): string {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1]! : fallback;
}

function requiredArgument(argv: readonly string[], name: string): string {
  const value = argument(argv, name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function optionalNonNegativeInteger(argv: readonly string[], name: string): number | undefined {
  const raw = argument(argv, name);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} must be a non-negative integer`);
  return value;
}

function modelArgument(argv: readonly string[]): GoogleFlowModel {
  const value = argument(argv, 'model', 'quality');
  if (value !== 'lite' && value !== 'fast' && value !== 'quality') {
    throw new Error('--model must be lite, fast or quality');
  }
  return value;
}

function aspectArgument(argv: readonly string[]): '16:9' | '9:16' {
  const value = argument(argv, 'aspect', '16:9');
  if (value !== '16:9' && value !== '9:16') throw new Error('--aspect must be 16:9 or 9:16');
  return value;
}

export async function runBookTrailerProducer(
  argv: readonly string[] = process.argv,
  dependencies: BookTrailerProducerDependencies = {},
): Promise<void> {
  const stage = requiredArgument(argv, 'stage');
  const force = argv.includes('--force');
  if (stage === 'plan') {
    const result = await runPlanStage({
      bookDirectory: requiredArgument(argv, 'book'),
      workspace: requiredArgument(argv, 'out'),
      force,
    }, dependencies);
    process.stdout.write(`Planned ${result.plan.shots.length} trailer shot(s) -> ${path.resolve(requiredArgument(argv, 'out'))}\n`);
    return;
  }
  if (stage === 'handoff') {
    const remainingFlowCredits = optionalNonNegativeInteger(argv, 'remaining-credits');
    const result = await runHandoffStage({
      workspace: requiredArgument(argv, 'workspace'),
      model: modelArgument(argv),
      aspectRatio: aspectArgument(argv),
      ...(remainingFlowCredits !== undefined
        ? { remainingFlowCredits }
        : {}),
      force,
    }, dependencies);
    process.stdout.write(`Prepared ${result.jobs.length} Flow job(s), estimated ${result.estimatedCredits} credits -> ${path.resolve(requiredArgument(argv, 'workspace'), HANDOFF_FILENAME)}\n`);
    return;
  }
  if (stage === 'assemble') {
    const music = argument(argv, 'music');
    const result = await runAssembleStage({
      workspace: requiredArgument(argv, 'workspace'),
      resultsDirectory: requiredArgument(argv, 'results'),
      ...(music ? { music } : {}),
      force,
    }, dependencies);
    process.stdout.write(`Assembled private master pending human review -> ${result.master.path}\n`);
    return;
  }
  throw new Error('--stage must be plan, handoff or assemble');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runBookTrailerProducer().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
