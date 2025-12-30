/**
 * Three-Way Diff for Conflict Resolution (Item 110)
 * Handles merge conflicts with three-way comparison
 */

import { EventEmitter } from 'events';

export interface DiffLine {
  lineNumber: number;
  content: string;
  source: 'base' | 'ours' | 'theirs' | 'both';
}

export interface DiffHunk {
  startLine: number;
  endLine: number;
  base: string[];
  ours: string[];
  theirs: string[];
  status: 'clean' | 'conflict' | 'auto-merged';
}

export interface ThreeWayDiffResult {
  hunks: DiffHunk[];
  hasConflicts: boolean;
  conflictCount: number;
  merged: string | null;
}

export interface ConflictResolution {
  hunkIndex: number;
  choice: 'ours' | 'theirs' | 'both' | 'custom';
  customContent?: string;
}

export class ThreeWayDiff extends EventEmitter {

  diff(base: string, ours: string, theirs: string): ThreeWayDiffResult {
    const baseLines = base.split('\n');
    const ourLines = ours.split('\n');
    const theirLines = theirs.split('\n');

    const hunks: DiffHunk[] = [];
    let i = 0, j = 0, k = 0;
    let hunkStart = 0;
    let inHunk = false;
    let currentHunk: DiffHunk | null = null;

    const maxLen = Math.max(baseLines.length, ourLines.length, theirLines.length);

    for (let line = 0; line < maxLen; line++) {
      const baseLine = baseLines[line] || '';
      const ourLine = ourLines[line] || '';
      const theirLine = theirLines[line] || '';

      const oursChanged = baseLine !== ourLine;
      const theirsChanged = baseLine !== theirLine;

      if (oursChanged || theirsChanged) {
        if (!inHunk) {
          inHunk = true;
          hunkStart = line;
          currentHunk = {
            startLine: line,
            endLine: line,
            base: [],
            ours: [],
            theirs: [],
            status: 'clean',
          };
        }
        
        currentHunk!.base.push(baseLine);
        currentHunk!.ours.push(ourLine);
        currentHunk!.theirs.push(theirLine);
        currentHunk!.endLine = line;

        if (oursChanged && theirsChanged && ourLine !== theirLine) {
          currentHunk!.status = 'conflict';
        } else if (currentHunk!.status !== 'conflict') {
          currentHunk!.status = 'auto-merged';
        }
      } else if (inHunk && currentHunk) {
        hunks.push(currentHunk);
        inHunk = false;
        currentHunk = null;
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    const hasConflicts = hunks.some(h => h.status === 'conflict');
    const conflictCount = hunks.filter(h => h.status === 'conflict').length;

    return {
      hunks,
      hasConflicts,
      conflictCount,
      merged: hasConflicts ? null : this.autoMerge(baseLines, ourLines, theirLines, hunks),
    };
  }

  private autoMerge(base: string[], ours: string[], theirs: string[], hunks: DiffHunk[]): string {
    const result: string[] = [];
    let lastEndLine = -1;

    for (const hunk of hunks) {
      // Add unchanged lines before hunk
      for (let i = lastEndLine + 1; i < hunk.startLine; i++) {
        result.push(base[i] || '');
      }

      // Add merged content
      if (hunk.status === 'auto-merged') {
        const oursChanged = hunk.base.join('\n') !== hunk.ours.join('\n');
        if (oursChanged) {
          result.push(...hunk.ours);
        } else {
          result.push(...hunk.theirs);
        }
      }

      lastEndLine = hunk.endLine;
    }

    // Add remaining unchanged lines
    for (let i = lastEndLine + 1; i < base.length; i++) {
      result.push(base[i]);
    }

    return result.join('\n');
  }

  resolveConflicts(diff: ThreeWayDiffResult, resolutions: ConflictResolution[]): string {
    const resolved = [...diff.hunks];

    for (const resolution of resolutions) {
      const hunk = resolved[resolution.hunkIndex];
      if (!hunk || hunk.status !== 'conflict') continue;

      switch (resolution.choice) {
        case 'ours':
          hunk.status = 'auto-merged';
          break;
        case 'theirs':
          hunk.ours = [...hunk.theirs];
          hunk.status = 'auto-merged';
          break;
        case 'both':
          hunk.ours = [...hunk.ours, ...hunk.theirs];
          hunk.status = 'auto-merged';
          break;
        case 'custom':
          if (resolution.customContent) {
            hunk.ours = resolution.customContent.split('\n');
            hunk.status = 'auto-merged';
          }
          break;
      }
    }

    // Now merge
    const result: string[] = [];
    for (const hunk of resolved) {
      if (hunk.status === 'conflict') {
        result.push('<<<<<<< OURS');
        result.push(...hunk.ours);
        result.push('=======');
        result.push(...hunk.theirs);
        result.push('>>>>>>> THEIRS');
      } else {
        result.push(...hunk.ours);
      }
    }

    return result.join('\n');
  }

  formatConflictMarkers(hunk: DiffHunk): string {
    const lines: string[] = [];
    lines.push('<<<<<<< OURS');
    lines.push(...hunk.ours);
    lines.push('=======');
    lines.push(...hunk.theirs);
    lines.push('>>>>>>> THEIRS');
    return lines.join('\n');
  }

  parseConflictMarkers(content: string): DiffHunk[] {
    const lines = content.split('\n');
    const hunks: DiffHunk[] = [];
    let inConflict = false;
    let inOurs = false;
    let currentHunk: DiffHunk | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('<<<<<<<')) {
        inConflict = true;
        inOurs = true;
        currentHunk = {
          startLine: i,
          endLine: i,
          base: [],
          ours: [],
          theirs: [],
          status: 'conflict',
        };
      } else if (line.startsWith('=======') && inConflict) {
        inOurs = false;
      } else if (line.startsWith('>>>>>>>') && inConflict) {
        if (currentHunk) {
          currentHunk.endLine = i;
          hunks.push(currentHunk);
        }
        inConflict = false;
        currentHunk = null;
      } else if (inConflict && currentHunk) {
        if (inOurs) {
          currentHunk.ours.push(line);
        } else {
          currentHunk.theirs.push(line);
        }
      }
    }

    return hunks;
  }
}

let instance: ThreeWayDiff | null = null;
export function getThreeWayDiff(): ThreeWayDiff {
  if (!instance) instance = new ThreeWayDiff();
  return instance;
}
export default ThreeWayDiff;
