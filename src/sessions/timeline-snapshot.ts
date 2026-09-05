/**
 * Persistent post-turn working-tree snapshots for time-travel restore.
 *
 * In-memory CheckpointManager snapshots cannot survive the agent process,
 * and they only capture the last file edited before a write. Replay restore
 * therefore rematerializes these on-disk trees instead.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../utils/logger.js';

export interface TimelineFileSnapshot {
  path: string;
  content: string | null;
}

export interface TimelineTurnSnapshot {
  id: string;
  sessionId: string;
  turn: number;
  cwd: string;
  files: TimelineFileSnapshot[];
}

export interface CaptureSnapshotInput {
  sessionId: string;
  turn: number;
  cwd: string;
  directory?: string;
}

export interface TimelineRestoreResult {
  found: boolean;
  success: boolean;
  restored: string[];
  errors: string[];
}

const SKIP_DIR_NAMES = new Set(['.git', 'node_modules']);

export function timelineSnapshotDirectory(explicit?: string): string {
  return explicit ?? path.join(os.homedir(), '.codebuddy', 'timelines', 'snapshots');
}

function snapshotId(sessionId: string, turn: number): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  return `tlcp_${safe}_t${turn}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join('/');
}

function shouldSkip(relative: string): boolean {
  return relative.split('/').some((part) => SKIP_DIR_NAMES.has(part));
}

function walkFiles(root: string, current: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const relative = toPosix(path.relative(root, absolute));
    if (!relative || shouldSkip(relative)) continue;
    if (entry.isDirectory()) results.push(...walkFiles(root, absolute));
    else if (entry.isFile()) results.push(relative);
  }
  return results;
}

export function listWorkingTreeFiles(cwd: string): string[] {
  try {
    const root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (path.resolve(root) !== path.resolve(cwd)) {
      return walkFiles(cwd, cwd);
    }
    const listed = execFileSync(
      'git',
      ['-C', cwd, 'ls-files', '-co', '--exclude-standard', '-z'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return listed.split('\0').filter(Boolean).map(toPosix);
  } catch {
    return walkFiles(cwd, cwd);
  }
}

export function captureWorkingTree(cwd: string): TimelineFileSnapshot[] {
  const files: TimelineFileSnapshot[] = [];
  for (const relative of [...new Set(listWorkingTreeFiles(cwd))].sort()) {
    const absolute = path.join(cwd, relative);
    try {
      if (fs.statSync(absolute).isFile()) {
        files.push({ path: relative, content: fs.readFileSync(absolute, 'utf8') });
      }
    } catch {
      files.push({ path: relative, content: null });
    }
  }
  return files;
}

export function captureAndSaveTimelineSnapshot(input: CaptureSnapshotInput): TimelineTurnSnapshot {
  const snapshot: TimelineTurnSnapshot = {
    id: snapshotId(input.sessionId, input.turn),
    sessionId: input.sessionId,
    turn: input.turn,
    cwd: path.resolve(input.cwd),
    files: captureWorkingTree(input.cwd),
  };
  const directory = timelineSnapshotDirectory(input.directory);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${snapshot.id}.json`), `${JSON.stringify(snapshot)}\n`);
  return snapshot;
}

export function restoreTimelineSnapshot(
  id: string,
  directory?: string,
): TimelineRestoreResult {
  const file = path.join(timelineSnapshotDirectory(directory), `${id}.json`);
  if (!fs.existsSync(file)) {
    return { found: false, success: false, restored: [], errors: [`Snapshot not found: ${id}`] };
  }

  let snapshot: TimelineTurnSnapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(file, 'utf8')) as TimelineTurnSnapshot;
  } catch (error) {
    return {
      found: true,
      success: false,
      restored: [],
      errors: [`Invalid snapshot ${id}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const cwd = snapshot.cwd;
  const wanted = new Map(snapshot.files.map((entry) => [entry.path, entry.content]));
  const restored: string[] = [];
  const errors: string[] = [];

  for (const current of listWorkingTreeFiles(cwd)) {
    const want = wanted.get(current);
    if (want === undefined || want === null) {
      try {
        fs.unlinkSync(path.join(cwd, current));
        restored.push(current);
      } catch (error) {
        errors.push(`Failed to remove ${current}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  for (const [relative, content] of wanted) {
    if (content === null) continue;
    try {
      const absolute = path.join(cwd, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, content, 'utf8');
      restored.push(relative);
    } catch (error) {
      logger.warn('[timeline-snapshot] failed to restore file', {
        relative,
        error: error instanceof Error ? error.message : String(error),
      });
      errors.push(`Failed to restore ${relative}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { found: true, success: errors.length === 0, restored, errors };
}
