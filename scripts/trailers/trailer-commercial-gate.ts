import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

export type ManuscriptStatus = 'incomplete' | 'major_revision' | 'approved';

export interface TrailerCatalogEntry {
  titleId: string;
  title: string;
  sourceDirectoryName: string;
  chapterGlob: string;
  expectedChapters: number;
  presentChapters: number;
  manuscriptStatus: ManuscriptStatus;
  approvedContentSha256: string | null;
  cta: string | null;
  url: string | null;
}

export interface CommercialGateReceipt {
  schemaVersion: 1;
  titleId: string;
  title: string;
  manuscriptStatus: ManuscriptStatus;
  expectedChapters: number;
  presentChapters: number;
  complete: boolean;
  approvedContentSha256: string;
  measuredContentSha256: string;
  cta: string;
  url: string;
  status: 'approved-for-trailer-render';
}

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CATALOG_PATH = path.join(MODULE_DIRECTORY, 'catalog-manifest.json');
export const LOCAL_MANIFEST_FILENAME = '.trailer-manuscript.json';
export const COMMERCIAL_GATE_FILENAME = 'commercial-gate.json';
export const EXCERPTS_FILENAME = 'excerpts.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertEntry(value: unknown): asserts value is TrailerCatalogEntry {
  if (!isRecord(value)) throw new Error('Commercial catalog entry must be an object');
  const status = value.manuscriptStatus;
  if (
    typeof value.titleId !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.sourceDirectoryName !== 'string' ||
    typeof value.chapterGlob !== 'string' ||
    !Number.isInteger(value.expectedChapters) ||
    Number(value.expectedChapters) <= 0 ||
    !Number.isInteger(value.presentChapters) ||
    Number(value.presentChapters) < 0 ||
    (status !== 'incomplete' && status !== 'major_revision' && status !== 'approved') ||
    (value.approvedContentSha256 !== null && typeof value.approvedContentSha256 !== 'string') ||
    (value.cta !== null && typeof value.cta !== 'string') ||
    (value.url !== null && typeof value.url !== 'string')
  ) {
    throw new Error('Commercial catalog entry is malformed');
  }
}

export function assertCommercialGateReceipt(
  value: unknown,
): asserts value is CommercialGateReceipt {
  const receipt = value as Partial<CommercialGateReceipt> | null;
  if (
    !receipt ||
    receipt.schemaVersion !== 1 ||
    receipt.status !== 'approved-for-trailer-render' ||
    receipt.manuscriptStatus !== 'approved' ||
    receipt.complete !== true ||
    !Number.isInteger(receipt.expectedChapters) ||
    !Number.isInteger(receipt.presentChapters) ||
    receipt.presentChapters! < receipt.expectedChapters! ||
    !/^[a-f0-9]{64}$/u.test(receipt.approvedContentSha256 ?? '') ||
    receipt.approvedContentSha256 !== receipt.measuredContentSha256 ||
    !receipt.cta?.trim() ||
    !receipt.url?.trim()
  ) {
    throw new Error('Commercial gate receipt is missing, stale, or not approved');
  }
}

async function readJson(filename: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filename, 'utf8')) as unknown;
}

async function loadCatalog(filename = DEFAULT_CATALOG_PATH): Promise<TrailerCatalogEntry[]> {
  const value = await readJson(filename);
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.titles)) {
    throw new Error(`Commercial catalog is malformed: ${filename}`);
  }
  value.titles.forEach(assertEntry);
  return value.titles;
}

const STATUS_PERMISSIVENESS: Record<ManuscriptStatus, number> = {
  incomplete: 0,
  major_revision: 1,
  approved: 2,
};

/**
 * Reconciles a book's own manifest with the shared catalog.
 *
 * The local manifest lives inside the very directory it authorises, so on its
 * own it proves nothing: dropping `{expectedChapters: 1, status: 'approved'}`
 * into a 1-of-40 manuscript would clear the gate and ship a trailer for a novel
 * that does not exist. That is the same class of flaw as a licence whose
 * verifying key is the local file that signs it.
 *
 * So the catalog is the authority: where both know a title, the STRICTER of the
 * two wins. A local manifest may tighten the gate — never loosen it.
 */
function reconcileWithCatalog(
  local: TrailerCatalogEntry,
  catalog: TrailerCatalogEntry | undefined,
): TrailerCatalogEntry {
  if (!catalog) return local;
  return {
    ...local,
    expectedChapters: Math.max(local.expectedChapters, catalog.expectedChapters),
    manuscriptStatus:
      STATUS_PERMISSIVENESS[catalog.manuscriptStatus] <
      STATUS_PERMISSIVENESS[local.manuscriptStatus]
        ? catalog.manuscriptStatus
        : local.manuscriptStatus,
  };
}

async function localOrCatalogEntry(
  bookDirectory: string,
  catalogPath?: string,
): Promise<TrailerCatalogEntry> {
  const directoryName = path.basename(bookDirectory);
  let entries: TrailerCatalogEntry[] = [];
  let catalogError: unknown;
  try {
    entries = await loadCatalog(catalogPath);
  } catch (error) {
    catalogError = error;
  }
  const catalogEntry = entries.find(
    (candidate) => candidate.sourceDirectoryName === directoryName,
  );

  const localPath = path.join(bookDirectory, LOCAL_MANIFEST_FILENAME);
  try {
    const local = await readJson(localPath);
    assertEntry(local);
    return reconcileWithCatalog(local, catalogEntry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (!catalogEntry) {
    if (catalogError) throw catalogError;
    throw new Error(
      `Trailer refused: missing ${LOCAL_MANIFEST_FILENAME}; manuscript completeness is unproven`,
    );
  }
  return catalogEntry;
}

function chapterPattern(glob: string): { directory: string; suffix: string } {
  const normalized = glob.replace(/\\/gu, '/');
  const match = /^(.*)\/\*([^/]*)$/u.exec(normalized);
  if (!match) throw new Error(`Unsupported chapterGlob (expected directory/*.ext): ${glob}`);
  return { directory: match[1]!, suffix: match[2]! };
}

async function chapterFiles(bookDirectory: string, glob: string): Promise<string[]> {
  const pattern = chapterPattern(glob);
  const directory = path.resolve(bookDirectory, pattern.directory);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(pattern.suffix))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

async function contentDigest(files: readonly string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const filename of files) {
    hash.update(path.basename(filename));
    hash.update('\0');
    hash.update(await fs.readFile(filename));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Fail-closed gate used before planning, generation, assembly and publication. */
export async function assertTrailerCommerciallyRenderable(
  bookDirectoryInput: string,
  options: { catalogPath?: string } = {},
): Promise<CommercialGateReceipt> {
  const bookDirectory = path.resolve(bookDirectoryInput);
  const entry = await localOrCatalogEntry(bookDirectory, options.catalogPath);
  const files = await chapterFiles(bookDirectory, entry.chapterGlob);
  const presentChapters = files.length;
  if (presentChapters < entry.expectedChapters) {
    throw new Error(
      `Trailer refused — manuscript incomplete: ${presentChapters}/${entry.expectedChapters} chapters ` +
      `for ${entry.title} (${entry.titleId})`,
    );
  }
  if (entry.manuscriptStatus !== 'approved') {
    throw new Error(
      `Trailer refused — manuscript status is ${entry.manuscriptStatus}, expected approved: ${entry.titleId}`,
    );
  }
  if (!entry.approvedContentSha256 || !/^[a-f0-9]{64}$/u.test(entry.approvedContentSha256)) {
    throw new Error(`Trailer refused — approved manuscript digest is missing: ${entry.titleId}`);
  }
  if (!entry.cta?.trim() || !entry.url?.trim()) {
    throw new Error(`Trailer refused — approved CTA/URL are missing: ${entry.titleId}`);
  }
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    throw new Error(`Trailer refused — CTA URL is invalid: ${entry.titleId}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Trailer refused — CTA URL must use HTTPS: ${entry.titleId}`);
  }
  const measuredContentSha256 = await contentDigest(files);
  if (measuredContentSha256 !== entry.approvedContentSha256) {
    throw new Error(
      `Trailer refused — manuscript changed since approval: ${entry.titleId}`,
    );
  }
  return {
    schemaVersion: 1,
    titleId: entry.titleId,
    title: entry.title,
    manuscriptStatus: entry.manuscriptStatus,
    expectedChapters: entry.expectedChapters,
    presentChapters,
    complete: true,
    approvedContentSha256: entry.approvedContentSha256,
    measuredContentSha256,
    cta: entry.cta,
    url: entry.url,
    status: 'approved-for-trailer-render',
  };
}

/**
 * Revalidates a persisted trailer workspace against the manuscript currently
 * on disk. This prevents replaying a stale Flow handoff after source changes.
 */
export async function revalidateTrailerCommercialWorkspace(
  workspaceInput: string,
  options: { catalogPath?: string } = {},
): Promise<CommercialGateReceipt> {
  const workspace = path.resolve(workspaceInput);
  const [stored, excerpts] = await Promise.all([
    readJson(path.join(workspace, COMMERCIAL_GATE_FILENAME)),
    readJson(path.join(workspace, EXCERPTS_FILENAME)),
  ]);
  assertCommercialGateReceipt(stored);
  if (
    !isRecord(excerpts) ||
    !isRecord(excerpts.book) ||
    typeof excerpts.book.directory !== 'string'
  ) {
    throw new Error('Trailer refused — excerpts.json does not identify its manuscript');
  }
  const current = await assertTrailerCommerciallyRenderable(
    excerpts.book.directory,
    options,
  );
  assertCommercialGateReceipt(current);
  if (
    current.titleId !== stored.titleId ||
    current.expectedChapters !== stored.expectedChapters ||
    current.presentChapters !== stored.presentChapters ||
    current.measuredContentSha256 !== stored.measuredContentSha256
  ) {
    throw new Error('Commercial gate changed since trailer planning; restart from plan');
  }
  return current;
}
