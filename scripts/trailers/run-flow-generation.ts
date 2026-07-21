#!/usr/bin/env npx tsx

/** Budget-gated Google Flow generation through an operator-owned CDP browser. */

import { createHash } from 'crypto';
import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  attachToBrowser,
  type FlowAspect,
  type FlowDriver,
  type FlowModel,
} from '../../src/tools/video/google-flow-driver.js';
import {
  canonicalJson,
  verifyGoogleFlowHandoffDigest,
  type GoogleFlowHandoff,
  type GoogleFlowHandoffJob,
} from '../../src/tools/video/google-flow-handoff.js';
import { importGoogleFlowResults } from '../../src/tools/video/google-flow-result-import.js';

export type FlowRunModel = 'fast' | 'quality';

const SAFE_ID = /^[a-z0-9](?:[a-z0-9-]{0,125}[a-z0-9])?$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export interface FlowRunOptions {
  handoffPath: string;
  resultsDirectory: string;
  cdpUrl?: string;
  model?: FlowRunModel;
  maxCredits: number;
  aspect?: FlowAspect;
  dryRun?: boolean;
  importOutputDirectory?: string;
}

export interface PlannedFlowJob {
  jobId: string;
  prompt: string;
  promptSha256: string;
  ingredients: string[];
  destination: string;
  creditCost: number;
}

export interface FlowRunPlan {
  model: FlowRunModel;
  driverModel: FlowModel;
  aspect: FlowAspect;
  maxCredits: number;
  estimatedCredits: number;
  resultsDirectory: string;
  jobs: PlannedFlowJob[];
}

export interface FlowRunLogRecord {
  timestamp: string;
  jobId: string;
  promptSha256: string;
  model: FlowRunModel;
  creditCost: number;
  creditsBefore: number;
  creditsAfter: number;
  resultPath: string;
  sha256: string;
}

export interface FlowRunResult {
  dryRun: boolean;
  estimatedCredits: number;
  spentCredits: number;
  completedJobs: number;
  initialCreditBalance: number;
  logPath?: string;
  importOutputDirectory?: string;
}

export interface FlowGenerationDriver {
  verifyReady(): Promise<void>;
  setModel(model: FlowModel): Promise<void>;
  setAspect(aspect: FlowAspect): Promise<void>;
  setIngredients(imagePaths: string[]): Promise<void>;
  submitPrompt(text: string): Promise<void>;
  downloadResult(destPath: string): Promise<void>;
  readCreditBalance(): Promise<number>;
}

type ImportInput = Parameters<typeof importGoogleFlowResults>[0];

export interface FlowRunDependencies {
  attach?: (options: { cdpUrl?: string }) => Promise<{ driver: FlowGenerationDriver }>;
  importResults?: (input: ImportInput) => Promise<unknown>;
  appendLog?: (logPath: string, record: FlowRunLogRecord) => Promise<void>;
  hashFile?: (filename: string) => Promise<string>;
  now?: () => Date;
  writeOutput?: (message: string) => void;
}

export class FlowCreditBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowCreditBudgetError';
  }
}

export function estimateCreditCost(jobs: readonly unknown[], model: FlowRunModel): number {
  return jobs.length * creditCostPerClip(model);
}

export function assertSufficientCreditBalance(balance: number, estimatedCost: number): void {
  assertNonNegativeInteger(balance, 'Flow credit balance');
  assertNonNegativeInteger(estimatedCost, 'estimated Flow credit cost');
  if (balance < estimatedCost) {
    throw new FlowCreditBudgetError(
      `Insufficient Google Flow credits: balance ${balance}, full-run estimate ${estimatedCost}; no generation submitted`,
    );
  }
}

export function assertCreditBudget(spent: number, nextCost: number, maxCredits: number): void {
  assertNonNegativeInteger(spent, 'spent Flow credits');
  if (!Number.isSafeInteger(nextCost) || nextCost <= 0) throw new Error('next Flow credit cost must be positive');
  if (!Number.isSafeInteger(maxCredits) || maxCredits <= 0) throw new Error('--max-credits must be a positive integer');
  if (spent + nextCost > maxCredits) {
    throw new FlowCreditBudgetError(
      `Flow max-credit guard stopped the run at ${spent}/${maxCredits}; next clip costs ${nextCost}`,
    );
  }
}

export function planFlowRun(
  handoff: GoogleFlowHandoff,
  options: Pick<FlowRunOptions, 'resultsDirectory' | 'model' | 'maxCredits' | 'aspect'>,
): FlowRunPlan {
  assertRunnableHandoff(handoff);
  const model = options.model ?? 'fast';
  const resultsDirectory = path.resolve(options.resultsDirectory);
  const aspect = options.aspect ?? commonHandoffAspect(handoff.jobs);
  assertCreditBudget(0, creditCostPerClip(model), options.maxCredits);
  const creditCost = creditCostPerClip(model);
  return {
    model,
    driverModel: model === 'fast' ? 'veo-3.1-fast' : 'veo-3.1-quality',
    aspect,
    maxCredits: options.maxCredits,
    estimatedCredits: estimateCreditCost(handoff.jobs, model),
    resultsDirectory,
    jobs: handoff.jobs.map((job): PlannedFlowJob => ({
      jobId: job.id,
      prompt: job.prompt,
      promptSha256: sha256(job.prompt),
      ingredients: [job.source.path],
      destination: path.join(resultsDirectory, `${job.id}.mp4`),
      creditCost,
    })),
  };
}

export async function runFlowGeneration(
  handoff: GoogleFlowHandoff,
  handoffBytes: Uint8Array,
  options: FlowRunOptions,
  dependencies: FlowRunDependencies = {},
): Promise<FlowRunResult> {
  assertHandoffBytes(handoff, handoffBytes);
  const plan = planFlowRun(handoff, options);
  const now = dependencies.now ?? (() => new Date());
  const writeOutput = dependencies.writeOutput ?? ((message) => process.stdout.write(message));
  const attached = await (dependencies.attach ?? defaultAttach)({ ...(options.cdpUrl ? { cdpUrl: options.cdpUrl } : {}) });
  const driver = attached.driver;
  await driver.verifyReady();
  const initialCreditBalance = await driver.readCreditBalance();
  assertSufficientCreditBalance(initialCreditBalance, plan.estimatedCredits);

  await fs.mkdir(plan.resultsDirectory, { recursive: true, mode: 0o700 });
  if (options.dryRun) {
    let checkedCredits = 0;
    for (const job of plan.jobs) {
      assertCreditBudget(checkedCredits, job.creditCost, plan.maxCredits);
      await driver.setModel(plan.driverModel);
      await driver.setAspect(plan.aspect);
      await driver.setIngredients(job.ingredients);
      checkedCredits += job.creditCost;
    }
    writeOutput(
      `Dry run passed for ${plan.jobs.length} Flow job(s); selectors and ${plan.estimatedCredits}-credit balance checked, nothing submitted.\n`,
    );
    return {
      dryRun: true,
      estimatedCredits: plan.estimatedCredits,
      spentCredits: 0,
      completedJobs: 0,
      initialCreditBalance,
    };
  }

  const startedAt = now();
  const logPath = path.join(plan.resultsDirectory, `flow-run-${fileTimestamp(startedAt)}.jsonl`);
  const appendLog = dependencies.appendLog ?? appendFlowRunLog;
  const hashFile = dependencies.hashFile ?? sha256File;
  let spentCredits = 0;
  let completedJobs = 0;

  for (const job of plan.jobs) {
    assertCreditBudget(spentCredits, job.creditCost, plan.maxCredits);
    await assertDestinationAbsent(job.destination);
    await driver.setModel(plan.driverModel);
    await driver.setAspect(plan.aspect);
    await driver.setIngredients(job.ingredients);
    const creditsBefore = await driver.readCreditBalance();
    if (creditsBefore < job.creditCost) {
      throw new FlowCreditBudgetError(
        `Google Flow balance dropped to ${creditsBefore}; refusing ${job.jobId} costing ${job.creditCost}`,
      );
    }
    await driver.submitPrompt(job.prompt);
    await driver.downloadResult(job.destination);
    const [creditsAfter, resultSha256] = await Promise.all([
      driver.readCreditBalance(),
      hashFile(job.destination),
    ]);
    spentCredits += job.creditCost;
    completedJobs += 1;
    const record: FlowRunLogRecord = {
      timestamp: now().toISOString(),
      jobId: job.jobId,
      promptSha256: job.promptSha256,
      model: plan.model,
      creditCost: job.creditCost,
      creditsBefore,
      creditsAfter,
      resultPath: job.destination,
      sha256: resultSha256,
    };
    await appendLog(logPath, record);
    writeOutput(
      `Flow ${job.jobId}: ${creditsBefore} -> ${creditsAfter} credits, ${job.destination}, sha256 ${resultSha256}\n`,
    );
  }

  const importOutputDirectory = path.resolve(
    options.importOutputDirectory ?? path.join(path.dirname(options.handoffPath), 'imported'),
  );
  await (dependencies.importResults ?? importGoogleFlowResults)({
    handoff,
    handoffBytes,
    resultsRoot: plan.resultsDirectory,
    outputRoot: importOutputDirectory,
  });
  writeOutput(
    `Fail-closed Flow import completed into ${importOutputDirectory}; every clip remains pending human review and nothing was published.\n`,
  );
  return {
    dryRun: false,
    estimatedCredits: plan.estimatedCredits,
    spentCredits,
    completedJobs,
    initialCreditBalance,
    logPath,
    importOutputDirectory,
  };
}

export async function appendFlowRunLog(logPath: string, record: FlowRunLogRecord): Promise<void> {
  const handle = await fs.open(
    logPath,
    fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
}

export async function runFlowGenerationCli(argv = process.argv): Promise<void> {
  const handoffArgument = argument(argv, 'handoff');
  const resultsArgument = argument(argv, 'results');
  if (!handoffArgument || !resultsArgument) throw new Error('--handoff and --results are required');
  const maxCredits = integerArgument(argv, 'max-credits');
  const handoffPath = path.resolve(handoffArgument);
  const handoffBytes = await readSafeHandoff(handoffPath);
  const handoff = JSON.parse(Buffer.from(handoffBytes).toString('utf8')) as GoogleFlowHandoff;
  await runFlowGeneration(handoff, handoffBytes, {
    handoffPath,
    resultsDirectory: path.resolve(resultsArgument),
    cdpUrl: argument(argv, 'cdp') || undefined,
    model: modelArgument(argv),
    maxCredits,
    aspect: aspectArgument(argv),
    dryRun: argv.includes('--dry-run'),
  });
}

function creditCostPerClip(model: FlowRunModel): 10 | 100 {
  if (model === 'fast') return 10;
  if (model === 'quality') return 100;
  throw new Error('Flow model must be fast or quality');
}

function assertRunnableHandoff(handoff: GoogleFlowHandoff): void {
  const uniqueJobIds = Array.isArray(handoff?.jobs) ? new Set(handoff.jobs.map((job) => job.id)) : new Set<string>();
  if (
    handoff?.schemaVersion !== 2 || handoff.provider !== 'google-flow-web' ||
    handoff.billingMode !== 'google-ai-ultra-flow-credits' || handoff.humanFlowSessionRequired !== true ||
    handoff.apiBillingAllowed !== false || handoff.autoPublish !== false ||
    !SAFE_ID.test(handoff.batchId) || !SHA256.test(handoff.sourcePlanSha256) ||
    !Array.isArray(handoff.jobs) || !handoff.jobs.length || handoff.jobs.length > 100 ||
    uniqueJobIds.size !== handoff.jobs.length ||
    handoff.estimatedCredits !== handoff.jobs.reduce((total, job) => total + job.estimatedCredits, 0) ||
    !verifyGoogleFlowHandoffDigest(handoff) ||
    handoff.jobs.some((job) =>
      !SAFE_ID.test(job.id) || !job.engine.startsWith('google-flow-') || !SHA256.test(job.source.sha256) ||
      job.executionMode !== 'browser-assisted' || job.status !== 'awaiting-flow-generation' ||
      !path.isAbsolute(job.source.path) || !job.prompt.trim() ||
      job.settings.audio !== 'ambient-only' || job.settings.lipSync !== false)
  ) throw new Error('Flow handoff is invalid, modified or unsafe; refusing browser generation');
}

function assertHandoffBytes(handoff: GoogleFlowHandoff, bytes: Uint8Array): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw new Error('Flow handoff bytes are not valid JSON');
  }
  if (canonicalJson(parsed) !== canonicalJson(handoff)) {
    throw new Error('Flow handoff bytes do not match the parsed handoff');
  }
}

function commonHandoffAspect(jobs: GoogleFlowHandoffJob[]): FlowAspect {
  const aspects = new Set(jobs.map((job) => job.settings.aspectRatio));
  if (aspects.size !== 1) throw new Error('Flow handoff mixes aspect ratios; pass --aspect explicitly');
  const aspect = jobs[0]?.settings.aspectRatio;
  if (aspect !== '9:16' && aspect !== '16:9') throw new Error('Flow handoff has an unsupported aspect ratio');
  return aspect;
}

async function defaultAttach(options: { cdpUrl?: string }): Promise<{ driver: FlowDriver }> {
  const attached = await attachToBrowser(options);
  return { driver: attached.driver };
}

async function assertDestinationAbsent(filename: string): Promise<void> {
  try {
    await fs.lstat(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Refusing to overwrite existing Flow result ${filename}`);
}

async function sha256File(filename: string): Promise<string> {
  const handle = await fs.open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0) throw new Error(`Downloaded Flow result is not a non-empty regular file: ${filename}`);
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

async function readSafeHandoff(filename: string): Promise<Buffer> {
  const handle = await fs.open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0 || info.size > 10 * 1024 * 1024) throw new Error('Flow handoff is unsafe');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function argument(argv: string[], name: string): string {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1]! : '';
}

function integerArgument(argv: string[], name: string): number {
  const raw = argument(argv, name);
  const value = Number.parseInt(raw, 10);
  if (!raw || !Number.isInteger(value) || value <= 0 || String(value) !== raw) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return value;
}

function modelArgument(argv: string[]): FlowRunModel {
  const model = argument(argv, 'model') || 'fast';
  if (model !== 'fast' && model !== 'quality') throw new Error('--model must be fast or quality');
  return model;
}

function aspectArgument(argv: string[]): FlowAspect | undefined {
  const aspect = argument(argv, 'aspect');
  if (!aspect) return undefined;
  if (aspect !== '9:16' && aspect !== '16:9') throw new Error('--aspect must be 9:16 or 16:9');
  return aspect;
}

function fileTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/gu, '-');
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runFlowGenerationCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
