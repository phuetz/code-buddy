/**
 * Turn Diff Tracker (Codex-inspired)
 *
 * Tracks file changes per agent turn for easy rollback.
 * Before each tool execution that modifies files, snapshots
 * the file state. After the turn, records what changed.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

export interface FileSnapshot {
  path: string;
  content: string | null; // null = file didn't exist
  mtime: number | null;
}

export interface FileDiff {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  before: string | null;
  after: string | null;
}

export interface TurnRecord {
  turnId: number;
  timestamp: number;
  snapshots: FileSnapshot[];
  diffs: FileDiff[];
  toolName?: string;
}

/**
 * Tracks file changes across agent turns for rollback support.
 */
export class TurnDiffTracker {
  private turns: TurnRecord[] = [];
  private currentTurn: TurnRecord | null = null;
  private turnCounter = 0;
  private maxTurns: number;

  constructor(options: { maxTurns?: number } = {}) {
    this.maxTurns = options.maxTurns ?? 50;
  }

  /**
   * Start tracking a new turn.
   */
  startTurn(toolName?: string): number {
    const turnId = ++this.turnCounter;

    this.currentTurn = {
      turnId,
      timestamp: Date.now(),
      snapshots: [],
      diffs: [],
      toolName,
    };

    return turnId;
  }

  /**
   * Snapshot a file before it gets modified.
   * Call this before any file write/edit/delete operation.
   */
  snapshotFile(filePath: string): void {
    if (!this.currentTurn) return;

    // Avoid duplicate snapshots for the same file in the same turn
    const absPath = path.resolve(filePath);
    if (this.currentTurn.snapshots.some(s => s.path === absPath)) return;

    try {
      if (fs.existsSync(absPath)) {
        const stat = fs.statSync(absPath);
        this.currentTurn.snapshots.push({
          path: absPath,
          content: fs.readFileSync(absPath, 'utf-8'),
          mtime: stat.mtimeMs,
        });
      } else {
        this.currentTurn.snapshots.push({
          path: absPath,
          content: null,
          mtime: null,
        });
      }
    } catch (error) {
      logger.debug('Failed to snapshot file', { filePath: absPath, error });
    }
  }

  /**
   * End the current turn. Computes diffs by comparing snapshots to current state.
   */
  endTurn(): TurnRecord | null {
    if (!this.currentTurn) return null;

    const turn = this.currentTurn;

    // Compute diffs
    for (const snapshot of turn.snapshots) {
      try {
        const exists = fs.existsSync(snapshot.path);
        const currentContent = exists ? fs.readFileSync(snapshot.path, 'utf-8') : null;

        if (snapshot.content === null && currentContent !== null) {
          turn.diffs.push({
            path: snapshot.path,
            action: 'created',
            before: null,
            after: currentContent,
          });
        } else if (snapshot.content !== null && currentContent === null) {
          turn.diffs.push({
            path: snapshot.path,
            action: 'deleted',
            before: snapshot.content,
            after: null,
          });
        } else if (snapshot.content !== null && currentContent !== null && snapshot.content !== currentContent) {
          turn.diffs.push({
            path: snapshot.path,
            action: 'modified',
            before: snapshot.content,
            after: currentContent,
          });
        }
      } catch (error) {
        logger.debug('Failed to compute diff', { path: snapshot.path, error });
      }
    }

    this.turns.push(turn);

    // Trim old turns
    while (this.turns.length > this.maxTurns) {
      this.turns.shift();
    }

    this.currentTurn = null;
    return turn;
  }

  /**
   * Rollback a specific turn — restore all files to their pre-turn state.
   */
  rollback(turnId: number): { restored: string[]; errors: string[] } {
    const turn = this.turns.find(t => t.turnId === turnId);
    if (!turn) {
      return { restored: [], errors: [`Turn ${turnId} not found`] };
    }

    const restored: string[] = [];
    const errors: string[] = [];

    for (const snapshot of turn.snapshots) {
      try {
        if (snapshot.content === null) {
          // File didn't exist before — delete it
          if (fs.existsSync(snapshot.path)) {
            fs.unlinkSync(snapshot.path);
            restored.push(`Deleted: ${snapshot.path}`);
          }
        } else {
          // Restore original content
          const dir = path.dirname(snapshot.path);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(snapshot.path, snapshot.content);
          restored.push(`Restored: ${snapshot.path}`);
        }
      } catch (error) {
        errors.push(`Failed to restore ${snapshot.path}: ${error}`);
      }
    }

    // Remove this turn and all subsequent turns
    const turnIdx = this.turns.indexOf(turn);
    if (turnIdx >= 0) {
      this.turns.splice(turnIdx);
    }

    return { restored, errors };
  }

  /**
   * Get the diff summary for a turn.
   */
  getTurnSummary(turnId: number): string | null {
    const turn = this.turns.find(t => t.turnId === turnId);
    if (!turn) return null;

    if (turn.diffs.length === 0) return 'No file changes.';

    return turn.diffs.map(d => {
      const icon = d.action === 'created' ? '+' : d.action === 'deleted' ? '-' : '~';
      return `  ${icon} ${path.relative(process.cwd(), d.path)} (${d.action})`;
    }).join('\n');
  }

  /**
   * Get all recorded turns.
   */
  getTurns(): TurnRecord[] {
    return [...this.turns];
  }

  /**
   * Get the last N turns.
   */
  getRecentTurns(count: number = 5): TurnRecord[] {
    return this.turns.slice(-count);
  }

  /**
   * Get total number of files changed across all turns.
   */
  getStats(): { turns: number; filesChanged: number; created: number; modified: number; deleted: number } {
    const allDiffs = this.turns.flatMap(t => t.diffs);
    return {
      turns: this.turns.length,
      filesChanged: allDiffs.length,
      created: allDiffs.filter(d => d.action === 'created').length,
      modified: allDiffs.filter(d => d.action === 'modified').length,
      deleted: allDiffs.filter(d => d.action === 'deleted').length,
    };
  }
}
