import { copyFile, mkdir, readdir, rm, stat } from 'fs/promises';
import * as path from 'path';
import { getCompanionCardsPath, readCompanionCards } from './cards.js';
import { getCompanionGatewayProfilePath, readCompanionGatewayProfile } from './gateway.js';
import { getCompanionPerceptsPath, getCompanionPerceptStats } from './percepts.js';
import { getCompanionSafetyLedgerPath, getCompanionSafetyLedgerStats } from './safety-ledger.js';
import { getCompanionSkillCandidatePath, readCompanionSkillCandidates } from './skill-curator.js';
import { writeJsonAtomic } from '../utils/atomic-write.js';

export type CompanionPrivacyKind =
  | 'percepts'
  | 'safety'
  | 'cards'
  | 'gateway'
  | 'skills'
  | 'camera';

export interface CompanionPrivacyStoreSummary {
  kind: CompanionPrivacyKind;
  path: string;
  exists: boolean;
  bytes: number;
  entries: number;
}

export interface CompanionPrivacyReport {
  schemaVersion: 1;
  cwd: string;
  generatedAt: string;
  stores: CompanionPrivacyStoreSummary[];
  totalBytes: number;
  totalEntries: number;
}

export interface CompanionPrivacyOptions {
  cwd?: string;
  now?: Date;
}

export interface CompanionPrivacyExportOptions extends CompanionPrivacyOptions {
  outputDir?: string;
  kinds?: CompanionPrivacyKind[];
}

export interface CompanionPrivacyExportResult {
  exportDir: string;
  manifestPath: string;
  report: CompanionPrivacyReport;
  copied: Array<{ kind: CompanionPrivacyKind; from: string; to: string }>;
}

export interface CompanionPrivacyPurgeOptions extends CompanionPrivacyOptions {
  kinds?: CompanionPrivacyKind[];
  backup?: boolean;
  outputDir?: string;
}

export interface CompanionPrivacyPurgeResult {
  purgedAt: string;
  cwd: string;
  kinds: CompanionPrivacyKind[];
  removed: Array<{ kind: CompanionPrivacyKind; path: string; existed: boolean }>;
  backup?: CompanionPrivacyExportResult;
}

const ALL_KINDS: CompanionPrivacyKind[] = ['percepts', 'safety', 'cards', 'gateway', 'skills', 'camera'];

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:.TZ]/g, '');
}

function defaultExportDir(cwd: string, now: Date): string {
  return path.join(cwd, '.codebuddy', 'companion', 'privacy-exports', `privacy-${stamp(now)}`);
}

function cameraDir(cwd: string): string {
  return path.join(cwd, '.codebuddy', 'camera');
}

function filePathForKind(cwd: string, kind: Exclude<CompanionPrivacyKind, 'camera'>): string {
  switch (kind) {
    case 'percepts':
      return getCompanionPerceptsPath(cwd);
    case 'safety':
      return getCompanionSafetyLedgerPath(cwd);
    case 'cards':
      return getCompanionCardsPath(cwd);
    case 'gateway':
      return getCompanionGatewayProfilePath(cwd);
    case 'skills':
      return getCompanionSkillCandidatePath(cwd);
  }
}

function uniqueKinds(kinds: CompanionPrivacyKind[] | undefined): CompanionPrivacyKind[] {
  if (!kinds || kinds.length === 0) return ALL_KINDS;
  return ALL_KINDS.filter(kind => kinds.includes(kind));
}

async function fileBytes(filePath: string): Promise<{ exists: boolean; bytes: number }> {
  try {
    const info = await stat(filePath);
    return { exists: info.isFile(), bytes: info.isFile() ? info.size : 0 };
  } catch {
    return { exists: false, bytes: 0 };
  }
}

async function cameraSummary(cwd: string): Promise<CompanionPrivacyStoreSummary> {
  const dir = cameraDir(cwd);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    let bytes = 0;
    let count = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      count += 1;
      const info = await stat(path.join(dir, entry.name));
      bytes += info.size;
    }
    return { kind: 'camera', path: dir, exists: count > 0, bytes, entries: count };
  } catch {
    return { kind: 'camera', path: dir, exists: false, bytes: 0, entries: 0 };
  }
}

async function summarizeKind(cwd: string, kind: CompanionPrivacyKind): Promise<CompanionPrivacyStoreSummary> {
  if (kind === 'camera') return cameraSummary(cwd);

  const filePath = filePathForKind(cwd, kind);
  const info = await fileBytes(filePath);
  let entries = 0;
  if (kind === 'percepts') entries = (await getCompanionPerceptStats({ cwd })).total;
  if (kind === 'safety') entries = (await getCompanionSafetyLedgerStats({ cwd })).total;
  if (kind === 'cards') entries = (await readCompanionCards({ cwd, limit: 100 })).cards.length;
  if (kind === 'gateway' && info.exists) entries = (await readCompanionGatewayProfile({ cwd })).channels.length;
  if (kind === 'skills' && info.exists) entries = (await readCompanionSkillCandidates({ cwd })).candidates.length;
  return { kind, path: filePath, exists: info.exists, bytes: info.bytes, entries };
}

export async function buildCompanionPrivacyReport(
  options: CompanionPrivacyOptions = {},
): Promise<CompanionPrivacyReport> {
  const cwd = resolveCwd(options.cwd);
  const generatedAt = (options.now || new Date()).toISOString();
  const stores = await Promise.all(ALL_KINDS.map(kind => summarizeKind(cwd, kind)));
  return {
    schemaVersion: 1,
    cwd,
    generatedAt,
    stores,
    totalBytes: stores.reduce((sum, item) => sum + item.bytes, 0),
    totalEntries: stores.reduce((sum, item) => sum + item.entries, 0),
  };
}

async function copyKind(
  cwd: string,
  exportDir: string,
  kind: CompanionPrivacyKind,
): Promise<Array<{ kind: CompanionPrivacyKind; from: string; to: string }>> {
  if (kind === 'camera') {
    const dir = cameraDir(cwd);
    const copied: Array<{ kind: CompanionPrivacyKind; from: string; to: string }> = [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const targetDir = path.join(exportDir, 'camera');
      await mkdir(targetDir, { recursive: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const from = path.join(dir, entry.name);
        const to = path.join(targetDir, entry.name);
        await copyFile(from, to);
        copied.push({ kind, from, to });
      }
    } catch {
      return copied;
    }
    return copied;
  }

  const from = filePathForKind(cwd, kind);
  const info = await fileBytes(from);
  if (!info.exists) return [];
  const to = path.join(exportDir, path.basename(from));
  await copyFile(from, to);
  return [{ kind, from, to }];
}

export async function exportCompanionPrivacyBundle(
  options: CompanionPrivacyExportOptions = {},
): Promise<CompanionPrivacyExportResult> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const exportDir = path.resolve(cwd, options.outputDir || defaultExportDir(cwd, now));
  await mkdir(exportDir, { recursive: true });

  const report = await buildCompanionPrivacyReport({ cwd, now });
  const copied = (await Promise.all(uniqueKinds(options.kinds).map(kind => copyKind(cwd, exportDir, kind)))).flat();
  const manifestPath = path.join(exportDir, 'manifest.json');
  await writeJsonAtomic(manifestPath, { ...report, copied }, { mode: 0o600 });
  return { exportDir, manifestPath, report, copied };
}

export async function purgeCompanionPrivacyData(
  options: CompanionPrivacyPurgeOptions = {},
): Promise<CompanionPrivacyPurgeResult> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const kinds = uniqueKinds(options.kinds);
  const backup = options.backup === false
    ? undefined
    : await exportCompanionPrivacyBundle({
        cwd,
        now,
        outputDir: options.outputDir,
        kinds,
      });
  const removed: Array<{ kind: CompanionPrivacyKind; path: string; existed: boolean }> = [];

  for (const kind of kinds) {
    const target = kind === 'camera' ? cameraDir(cwd) : filePathForKind(cwd, kind);
    const existed = kind === 'camera'
      ? (await cameraSummary(cwd)).exists
      : (await fileBytes(target)).exists;
    await rm(target, { recursive: true, force: true });
    removed.push({ kind, path: target, existed });
  }

  return {
    purgedAt: now.toISOString(),
    cwd,
    kinds,
    removed,
    backup,
  };
}
