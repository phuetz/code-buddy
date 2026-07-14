import { ipcMain } from 'electron';
import { homedir } from 'os';
import { basename, dirname, join, resolve } from 'path';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'fs/promises';
import type {
  VideoExperimentListResult,
  VideoExperimentReviewInput,
  VideoExperimentReviewResult,
  VideoExperimentReviewStatus,
  VideoExperimentView,
} from '../../shared/video-experiments';
import { VIDEO_EXPERIMENT_STATUSES } from '../../shared/video-experiments';
import { logError } from '../utils/logger';

interface RawCandidate {
  id?: unknown;
  title?: unknown;
  category?: unknown;
  verificationStatus?: unknown;
  confidence?: unknown;
  evidence?: { t_start?: unknown; t_end?: unknown; transcript?: unknown };
  namesToVerify?: unknown;
  links?: unknown;
  requirements?: unknown;
  risks?: unknown;
  minimumExperiment?: unknown;
}

interface RawBacklog {
  version?: unknown;
  source?: unknown;
  method?: unknown;
  candidates?: unknown;
}

interface StoredReview {
  status: VideoExperimentReviewStatus;
  note?: string;
  reviewedAt: string;
}

interface ReviewStore {
  version: 1;
  reviews: Record<string, StoredReview>;
}

const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 4_000;
const MAX_NOTE_CHARS = 2_000;

function text(value: unknown, max = MAX_TEXT_CHARS): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function strings(value: unknown, limit = 20): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => text(entry, 500))
        .filter(Boolean)
        .slice(0, limit)
    : [];
}

function workspaceRoot(cwd?: string): string {
  return resolve(cwd && cwd.trim() ? cwd : process.cwd());
}

export function resolveVideoExperimentRoots(cwd?: string, home = homedir()): string[] {
  const roots = [
    join(workspaceRoot(cwd), '.codebuddy', 'video'),
    join(home, '.codebuddy', 'video'),
    join(home, '.codebuddy', 'bot-cwd', '.codebuddy', 'video'),
  ];
  return [...new Set(roots.map((root) => resolve(root)))];
}

function reviewStorePath(cwd?: string): string {
  return join(workspaceRoot(cwd), '.codebuddy', 'video', 'experiment-reviews.json');
}

async function readReviewStore(cwd?: string): Promise<ReviewStore> {
  try {
    const parsed = JSON.parse(await readFile(reviewStorePath(cwd), 'utf8')) as Partial<ReviewStore>;
    if (parsed.version !== 1 || !parsed.reviews || typeof parsed.reviews !== 'object') {
      return { version: 1, reviews: {} };
    }
    const reviews: Record<string, StoredReview> = {};
    for (const [key, review] of Object.entries(parsed.reviews)) {
      if (!review || !isReviewStatus(review.status) || typeof review.reviewedAt !== 'string')
        continue;
      reviews[key] = {
        status: review.status,
        ...(typeof review.note === 'string' && review.note
          ? { note: text(review.note, MAX_NOTE_CHARS) }
          : {}),
        reviewedAt: review.reviewedAt,
      };
    }
    return { version: 1, reviews };
  } catch {
    return { version: 1, reviews: {} };
  }
}

function isReviewStatus(value: unknown): value is VideoExperimentReviewStatus {
  return (
    typeof value === 'string' &&
    VIDEO_EXPERIMENT_STATUSES.includes(value as VideoExperimentReviewStatus)
  );
}

function candidateKey(source: string, id: string): string {
  return `${source}\u241f${id}`;
}

function toView(
  raw: RawCandidate,
  backlog: RawBacklog,
  artifactPath: string,
  discoveredAt: string,
  reviews: Record<string, StoredReview>
): VideoExperimentView | null {
  const source = text(backlog.source, 2_000);
  const id = text(raw.id, 300);
  const title = text(raw.title, 500);
  if (!source || !id || !title) return null;
  const key = candidateKey(source, id);
  const review = reviews[key];
  const view: VideoExperimentView = {
    key,
    id,
    title,
    category: text(raw.category, 100) || 'general-ai',
    verificationStatus: 'unverified',
    confidence: raw.confidence === 'medium' ? 'medium' : 'low',
    evidence: {
      t_start: number(raw.evidence?.t_start),
      t_end: number(raw.evidence?.t_end),
      transcript: text(raw.evidence?.transcript),
    },
    namesToVerify: strings(raw.namesToVerify),
    links: strings(raw.links),
    requirements: strings(raw.requirements),
    risks: strings(raw.risks),
    minimumExperiment: text(raw.minimumExperiment),
    source,
    method: text(backlog.method, 100),
    artifactPath,
    discoveredAt,
    reviewStatus: review?.status ?? 'candidate',
  };
  if (review?.note) view.reviewNote = review.note;
  if (review?.reviewedAt) view.reviewedAt = review.reviewedAt;
  return view;
}

async function listArtifactPaths(roots: string[]): Promise<string[]> {
  const paths: string[] = [];
  for (const root of roots) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && /^experiments-.+\.json$/i.test(entry.name))
          paths.push(join(root, entry.name));
      }
    } catch {
      // Missing/unreadable roots are normal when a channel has not analyzed a video yet.
    }
  }
  return paths;
}

export async function listVideoExperiments(
  cwd?: string,
  options: { home?: string } = {}
): Promise<VideoExperimentListResult> {
  const roots = resolveVideoExperimentRoots(cwd, options.home ?? homedir());
  const reviews = (await readReviewStore(cwd)).reviews;
  const experiments: VideoExperimentView[] = [];
  let skippedArtifacts = 0;

  for (const artifactPath of await listArtifactPaths(roots)) {
    try {
      const metadata = await stat(artifactPath);
      if (!metadata.isFile() || metadata.size > MAX_ARTIFACT_BYTES) {
        skippedArtifacts += 1;
        continue;
      }
      const backlog = JSON.parse(await readFile(artifactPath, 'utf8')) as RawBacklog;
      if (!Array.isArray(backlog.candidates)) {
        skippedArtifacts += 1;
        continue;
      }
      const discoveredAt = metadata.mtime.toISOString();
      for (const candidate of backlog.candidates as RawCandidate[]) {
        const view = toView(candidate, backlog, artifactPath, discoveredAt, reviews);
        if (view) experiments.push(view);
      }
    } catch (error) {
      skippedArtifacts += 1;
      logError(`[video-experiments] skipped ${basename(artifactPath)}:`, error);
    }
  }

  const deduplicated = new Map<string, VideoExperimentView>();
  for (const experiment of experiments) {
    const current = deduplicated.get(experiment.key);
    if (!current || experiment.discoveredAt > current.discoveredAt) {
      deduplicated.set(experiment.key, experiment);
    }
  }
  const uniqueExperiments = [...deduplicated.values()];
  uniqueExperiments.sort(
    (a, b) =>
      b.discoveredAt.localeCompare(a.discoveredAt) || a.evidence.t_start - b.evidence.t_start
  );
  const byStatus = Object.fromEntries(
    VIDEO_EXPERIMENT_STATUSES.map((status) => [status, 0])
  ) as Record<VideoExperimentReviewStatus, number>;
  for (const experiment of uniqueExperiments) byStatus[experiment.reviewStatus] += 1;
  return {
    experiments: uniqueExperiments,
    summary: {
      total: uniqueExperiments.length,
      sources: new Set(uniqueExperiments.map((experiment) => experiment.source)).size,
      byStatus,
      roots,
      reviewStorePath: reviewStorePath(cwd),
      skippedArtifacts,
    },
  };
}

async function persistVideoExperimentReview(
  input: VideoExperimentReviewInput
): Promise<VideoExperimentReviewResult> {
  const key = text(input.key, 2_500);
  if (!key || !isReviewStatus(input.status))
    return { ok: false, error: 'Piste ou statut invalide.' };
  const note = text(input.note, MAX_NOTE_CHARS);
  const reviewedAt = new Date().toISOString();
  const store = await readReviewStore(input.cwd);
  store.reviews[key] = {
    status: input.status,
    ...(note ? { note } : {}),
    reviewedAt,
  };
  const path = reviewStorePath(input.cwd);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, path);
    return {
      ok: true,
      review: { status: input.status, ...(note ? { note } : {}), reviewedAt },
    };
  } catch (error) {
    logError('[video-experiments] review write failed:', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

let reviewWriteQueue: Promise<void> = Promise.resolve();

/** Serialize ledger writes so parallel status changes cannot overwrite each other. */
export function reviewVideoExperiment(
  input: VideoExperimentReviewInput
): Promise<VideoExperimentReviewResult> {
  const operation = reviewWriteQueue.then(() => persistVideoExperimentReview(input));
  reviewWriteQueue = operation.then(
    () => undefined,
    () => undefined
  );
  return operation;
}

export function registerVideoExperimentIpcHandlers(): void {
  ipcMain.handle('videoExperiments.list', async (_event, cwd?: string) =>
    listVideoExperiments(typeof cwd === 'string' ? cwd : undefined)
  );
  ipcMain.handle('videoExperiments.review', async (_event, input: VideoExperimentReviewInput) =>
    reviewVideoExperiment(input)
  );
}
