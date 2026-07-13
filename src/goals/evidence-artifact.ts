import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface EvidenceArtifactReference {
  schemaVersion: 1;
  /** Content address, stable across paths and machines. */
  id: string;
  /** Workspace-relative path; absolute host paths are never persisted. */
  path: string;
  sha256: string;
  sizeBytes: number;
  mediaType: string;
  capturedAt: string;
}

const MAX_ARTIFACTS = 100;
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function toPortablePath(value: string): string {
  return value.split(path.sep).join('/');
}

/**
 * Capture bounded, workspace-owned files as content-addressed metadata.
 * The evidence store deliberately records hashes rather than duplicating file
 * contents: reports/screenshots remain local while their exact bytes are
 * independently identifiable without leaking an absolute host path.
 */
export function captureEvidenceArtifacts(
  artifactPaths: string[],
  workspaceRoot: string,
  now: () => Date = () => new Date(),
): EvidenceArtifactReference[] {
  let root: string;
  try {
    root = fs.realpathSync(path.resolve(workspaceRoot));
  } catch {
    return [];
  }

  const references = new Map<string, EvidenceArtifactReference>();
  for (const rawPath of artifactPaths.slice(0, MAX_ARTIFACTS)) {
    try {
      const requested = path.isAbsolute(rawPath) ? rawPath : path.join(root, rawPath);
      const resolved = fs.realpathSync(requested);
      if (!isInside(root, resolved)) continue;
      const stat = fs.statSync(resolved);
      if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) continue;
      const sha256 = createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
      const relativePath = toPortablePath(path.relative(root, resolved));
      references.set(sha256, {
        schemaVersion: 1,
        id: `sha256:${sha256}`,
        path: relativePath,
        sha256,
        sizeBytes: stat.size,
        mediaType: MEDIA_TYPES[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream',
        capturedAt: now().toISOString(),
      });
    } catch {
      // Missing, transient or escaping artifacts are not proof and are skipped.
    }
  }
  return [...references.values()];
}
