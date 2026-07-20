/**
 * Promote a gate-approved identity dataset into a LoRA project's `images/`.
 *
 * Promotion is deliberately separate from assessment and training. It binds the
 * exact manifest bytes to the human-reviewed report, re-hashes every image,
 * re-runs both gates on a private staging directory, and swaps the dataset into
 * place atomically. Existing images are never deleted: `replaceExisting` moves
 * them to a timestamped backup first.
 *
 * @module lora/identity-dataset-promotion
 */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  assessIdentityDataset,
  type IdentityDatasetImage,
  type IdentityDatasetManifest,
} from './identity-dataset-gate.js';
import { assessDatasetQuality } from './quality-gate.js';

const SHA256_RE = /^[a-f0-9]{64}$/i;

interface ApprovedGateReport {
  schemaVersion: number;
  dir: string;
  ok: boolean;
  imageCount: number;
  manifestSha256: string;
  inputProblems: unknown[];
  approvals: {
    licenseCleared: boolean;
    evidenceReviewedBy: string;
    identityApprovedBy: string;
  };
  byteGateOk: boolean;
  identityGateOk: boolean;
}

export interface PromoteIdentityDatasetOptions {
  /** Defaults to `<projectDirectory>/identity-candidates`. */
  candidatesDirectory?: string;
  /** Required when `images/` already contains files. Existing data is backed up. */
  replaceExisting?: boolean;
}

export interface IdentityDatasetPromotionResult {
  projectDirectory: string;
  candidatesDirectory: string;
  imagesDirectory: string;
  imageCount: number;
  manifestSha256: string;
  receiptPath: string;
  /** Present when a previous `images/` directory was preserved. */
  backupDirectory?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${context}.${key} must be a non-empty string`);
  }
  return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string, context: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') throw new Error(`${context}.${key} must be boolean`);
  return value;
}

function parseImage(value: unknown, index: number): IdentityDatasetImage {
  if (!isRecord(value)) throw new Error(`manifest.images[${index}] must be an object`);
  const apparentAge = value.apparentAge;
  if (typeof apparentAge !== 'number') {
    throw new Error(`manifest.images[${index}].apparentAge must be a number`);
  }
  return {
    path: requiredString(value, 'path', `manifest.images[${index}]`),
    sha256: requiredString(value, 'sha256', `manifest.images[${index}]`),
    angle: requiredString(value, 'angle', `manifest.images[${index}]`),
    framing: requiredString(value, 'framing', `manifest.images[${index}]`),
    expression: requiredString(value, 'expression', `manifest.images[${index}]`),
    lighting: requiredString(value, 'lighting', `manifest.images[${index}]`),
    outfit: requiredString(value, 'outfit', `manifest.images[${index}]`),
    background: requiredString(value, 'background', `manifest.images[${index}]`),
    personId: requiredString(value, 'personId', `manifest.images[${index}]`),
    apparentAge,
    immutableTraits: requiredString(value, 'immutableTraits', `manifest.images[${index}]`),
  };
}

function parseManifest(value: unknown): IdentityDatasetManifest {
  if (!isRecord(value)) throw new Error('identity-manifest.json must contain an object');
  if (!isRecord(value.rights)) throw new Error('manifest.rights must be an object');
  if (!Array.isArray(value.images)) throw new Error('manifest.images must be an array');
  const basis = requiredString(value.rights, 'basis', 'manifest.rights');
  if (!['consented-person', 'synthetic-owned', 'licensed-character'].includes(basis)) {
    throw new Error(`manifest.rights.basis is unsupported: ${basis}`);
  }
  return {
    personId: requiredString(value, 'personId', 'manifest'),
    rights: {
      basis: basis as IdentityDatasetManifest['rights']['basis'],
      provenance: requiredString(value.rights, 'provenance', 'manifest.rights'),
      licenseCleared: requiredBoolean(value.rights, 'licenseCleared', 'manifest.rights'),
      identityConsent: requiredBoolean(value.rights, 'identityConsent', 'manifest.rights'),
      evidenceReviewed: requiredBoolean(value.rights, 'evidenceReviewed', 'manifest.rights'),
    },
    identityApproved: requiredBoolean(value, 'identityApproved', 'manifest'),
    canonicalImmutableTraits: requiredString(value, 'canonicalImmutableTraits', 'manifest'),
    images: value.images.map(parseImage),
  };
}

function parseApprovedReport(value: unknown): ApprovedGateReport {
  if (!isRecord(value)) throw new Error('identity-gate-report.json must contain an object');
  if (!isRecord(value.approvals)) throw new Error('report.approvals must be an object');
  if (!isRecord(value.byteGate) || !isRecord(value.identity)) {
    throw new Error('report must contain both gate results');
  }
  if (!Array.isArray(value.inputProblems)) throw new Error('report.inputProblems must be an array');
  if (typeof value.schemaVersion !== 'number' || value.schemaVersion < 2) {
    throw new Error('gate report predates manifest binding; rebuild it before promotion');
  }
  if (typeof value.imageCount !== 'number' || !Number.isInteger(value.imageCount)) {
    throw new Error('report.imageCount must be an integer');
  }
  const report: ApprovedGateReport = {
    schemaVersion: value.schemaVersion,
    dir: requiredString(value, 'dir', 'report'),
    ok: requiredBoolean(value, 'ok', 'report'),
    imageCount: value.imageCount,
    manifestSha256: requiredString(value, 'manifestSha256', 'report'),
    inputProblems: value.inputProblems,
    approvals: {
      licenseCleared: requiredBoolean(value.approvals, 'licenseCleared', 'report.approvals'),
      evidenceReviewedBy: requiredString(value.approvals, 'evidenceReviewedBy', 'report.approvals'),
      identityApprovedBy: requiredString(value.approvals, 'identityApprovedBy', 'report.approvals'),
    },
    byteGateOk: requiredBoolean(value.byteGate, 'ok', 'report.byteGate'),
    identityGateOk: requiredBoolean(value.identity, 'ok', 'report.identity'),
  };
  if (!SHA256_RE.test(report.manifestSha256)) {
    throw new Error('report.manifestSha256 must be a SHA-256 digest');
  }
  if (
    !report.ok ||
    !report.byteGateOk ||
    !report.identityGateOk ||
    report.inputProblems.length > 0 ||
    !report.approvals.licenseCleared
  ) {
    throw new Error('identity dataset report is not fully approved');
  }
  return report;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isDirectChild(filePath: string, directory: string): boolean {
  return path.dirname(path.resolve(filePath)) === path.resolve(directory);
}

function timestampForPath(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomically(destination: string, value: unknown): Promise<void> {
  const temporary = `${destination}.tmp-${randomUUID()}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, destination);
}

/**
 * Prepare the exact approved dataset for the existing local/cloud trainers.
 * This function never trains, uploads, publishes, or deletes prior images.
 */
export async function promoteIdentityDataset(
  projectDirectory: string,
  options: PromoteIdentityDatasetOptions = {},
): Promise<IdentityDatasetPromotionResult> {
  const project = path.resolve(projectDirectory);
  const candidates = path.resolve(options.candidatesDirectory ?? path.join(project, 'identity-candidates'));
  await fs.access(path.join(project, 'project.json'));

  const manifestPath = path.join(candidates, 'identity-manifest.json');
  const reportPath = path.join(candidates, 'identity-gate-report.json');
  const [manifestText, reportText] = await Promise.all([
    fs.readFile(manifestPath, 'utf8'),
    fs.readFile(reportPath, 'utf8'),
  ]);
  const report = parseApprovedReport(JSON.parse(reportText) as unknown);
  const manifestDigest = sha256(manifestText);
  if (manifestDigest !== report.manifestSha256.toLowerCase()) {
    throw new Error('manifest digest does not match the approved gate report');
  }
  if (path.resolve(report.dir) !== candidates) {
    throw new Error('gate report was produced for a different candidates directory');
  }

  const manifest = parseManifest(JSON.parse(manifestText) as unknown);
  if (report.imageCount !== manifest.images.length) {
    throw new Error(`report/manifest image count mismatch: ${report.imageCount} != ${manifest.images.length}`);
  }

  const stageRoot = path.join(project, `.identity-promotion-${randomUUID()}`);
  const stageImages = path.join(stageRoot, 'images');
  await fs.mkdir(stageImages, { recursive: true });
  const selected: Array<{ file: string; sha256: string }> = [];
  const names = new Set<string>();

  try {
    for (const image of manifest.images) {
      const source = path.resolve(image.path);
      if (!isDirectChild(source, candidates) || path.extname(source).toLowerCase() !== '.png') {
        throw new Error(`manifest image is outside candidates directory or not PNG: ${image.path}`);
      }
      const file = path.basename(source);
      if (names.has(file)) throw new Error(`duplicate promoted filename: ${file}`);
      names.add(file);

      const imageBytes = await fs.readFile(source);
      const actualSha = sha256(imageBytes);
      if (!SHA256_RE.test(image.sha256) || actualSha !== image.sha256.toLowerCase()) {
        throw new Error(`image digest mismatch: ${file}`);
      }
      const stem = file.slice(0, -path.extname(file).length);
      const captionPath = path.join(candidates, `${stem}.txt`);
      const caption = await fs.readFile(captionPath, 'utf8');
      if (!caption.trim()) throw new Error(`empty caption: ${path.basename(captionPath)}`);

      // Write the bytes we just verified, rather than copying by path after the
      // check. This closes the check/copy race if a renderer is still active.
      await fs.writeFile(path.join(stageImages, file), imageBytes);
      await fs.writeFile(path.join(stageImages, `${stem}.txt`), caption, 'utf8');
      selected.push({ file, sha256: actualSha });
    }

    const byteGate = await assessDatasetQuality(stageRoot);
    const identityGate = assessIdentityDataset(manifest, {
      strictCoverage: true,
      qualityReport: byteGate,
    });
    if (!byteGate.ok || !identityGate.ok) {
      const details = [...byteGate.issues.map((issue) => issue.kind), ...identityGate.blockers];
      throw new Error(`promotion recheck failed: ${details.join(', ')}`);
    }

    const imagesDirectory = path.join(project, 'images');
    let backupDirectory: string | undefined;
    if (await pathExists(imagesDirectory)) {
      const existing = await fs.readdir(imagesDirectory);
      if (existing.length > 0 && !options.replaceExisting) {
        throw new Error('images directory is not empty; pass replaceExisting to preserve it as a backup');
      }
      if (existing.length > 0) {
        backupDirectory = path.join(
          project,
          `images.backup-${timestampForPath()}-${randomUUID().slice(0, 8)}`,
        );
        await fs.rename(imagesDirectory, backupDirectory);
      } else {
        await fs.rmdir(imagesDirectory);
      }
    }

    try {
      await fs.rename(stageImages, imagesDirectory);
    } catch (error) {
      if (backupDirectory && !(await pathExists(imagesDirectory))) {
        await fs.rename(backupDirectory, imagesDirectory);
      }
      throw error;
    }

    const receiptPath = path.join(project, 'identity-training-receipt.json');
    await writeJsonAtomically(receiptPath, {
      schemaVersion: 1,
      promotedAt: new Date().toISOString(),
      projectDirectory: project,
      candidatesDirectory: candidates,
      manifestSha256: manifestDigest,
      reportSchemaVersion: report.schemaVersion,
      approvals: report.approvals,
      imageCount: selected.length,
      images: selected,
      byteGate: { ok: byteGate.ok, imageCount: byteGate.imageCount },
      identityGate: {
        ok: identityGate.ok,
        imageCount: identityGate.imageCount,
        coverage: identityGate.coverage,
      },
      backupDirectory: backupDirectory ?? null,
    });

    return {
      projectDirectory: project,
      candidatesDirectory: candidates,
      imagesDirectory,
      imageCount: selected.length,
      manifestSha256: manifestDigest,
      receiptPath,
      ...(backupDirectory ? { backupDirectory } : {}),
    };
  } finally {
    await fs.rm(stageRoot, { recursive: true, force: true });
  }
}

