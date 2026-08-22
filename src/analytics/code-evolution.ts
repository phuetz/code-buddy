/**
 * Code Evolution Graphs
 *
 * Track and visualize codebase evolution:
 * - Lines of code over time
 * - File count trends
 * - Complexity evolution
 * - Language distribution changes
 */

import { execFileSync } from 'child_process';
import * as path from 'path';

export interface EvolutionDataPoint {
  date: Date;
  commit: string;
  linesOfCode: number;
  fileCount: number;
  languageBreakdown: Record<string, number>;
}

export interface EvolutionReport {
  dataPoints: EvolutionDataPoint[];
  summary: {
    startDate: Date;
    endDate: Date;
    startLoc: number;
    endLoc: number;
    locChange: number;
    locChangePercent: number;
    startFiles: number;
    endFiles: number;
    fileChange: number;
    avgCommitsPerDay: number;
  };
  trends: {
    locTrend: 'growing' | 'shrinking' | 'stable';
    fileTrend: 'growing' | 'shrinking' | 'stable';
    velocity: number; // lines per day
  };
  generatedAt: Date;
}

export interface EvolutionOptions {
  /** Repository path */
  repoPath?: string;
  /** Number of data points to collect */
  dataPoints?: number;
  /** Days to analyze */
  days?: number;
  /** File extensions to include */
  extensions?: string[];
  /** Directories to exclude */
  exclude?: string[];
}

const DEFAULT_OPTIONS: Required<EvolutionOptions> = {
  repoPath: process.cwd(),
  dataPoints: 30,
  days: 90,
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.h'],
  exclude: ['node_modules', 'dist', 'build', 'coverage', '.git', 'vendor'],
};

/**
 * Generate code evolution report
 */
export function generateEvolutionReport(options: EvolutionOptions = {}): EvolutionReport {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const dataPoints = collectDataPoints(opts);

  if (dataPoints.length === 0) {
    return createEmptyReport();
  }

  const summary = calculateSummary(dataPoints);
  const trends = calculateTrends(dataPoints);

  return {
    dataPoints,
    summary,
    trends,
    generatedAt: new Date(),
  };
}

/**
 * Collect data points from git history
 */
function collectDataPoints(opts: Required<EvolutionOptions>): EvolutionDataPoint[] {
  const dataPoints: EvolutionDataPoint[] = [];

  try {
    // Get commit hashes at regular intervals
    const commits = getCommitsSampled(opts.repoPath, opts.days, opts.dataPoints);

    for (const { hash, date } of commits) {
      try {
        const stats = getStatsAtCommit(opts.repoPath, hash, opts.extensions, opts.exclude);
        dataPoints.push({
          date,
          commit: hash,
          ...stats,
        });
      } catch {
        // Skip commits that can't be analyzed
      }
    }
  } catch {
    // Git commands failed
  }

  return dataPoints.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Get sampled commits from history
 */
function getCommitsSampled(
  repoPath: string,
  days: number,
  samples: number
): Array<{ hash: string; date: Date }> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sinceStr = since.toISOString().split('T')[0];

  const output = execFileSync(
    'git',
    ['log', `--since=${sinceStr}`, '--format=%H|%aI', '--no-merges'],
    { cwd: repoPath, encoding: 'utf-8' }
  );

  const allCommits = output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, dateStr] = line.split('|');
      if (hash === undefined || dateStr === undefined) return undefined;
      return { hash, date: new Date(dateStr) };
    })
    .filter((c): c is { hash: string; date: Date } => c !== undefined);

  if (allCommits.length <= samples) {
    return allCommits;
  }

  // Sample evenly
  const step = Math.floor(allCommits.length / samples);
  const sampled: Array<{ hash: string; date: Date }> = [];

  for (let i = 0; i < allCommits.length; i += step) {
    const commit = allCommits[i];
    if (commit && sampled.length < samples) {
      sampled.push(commit);
    }
  }

  // Always include latest
  const latest = allCommits[0];
  if (latest && sampled[sampled.length - 1]?.hash !== latest.hash) {
    sampled.push(latest);
  }

  return sampled;
}

/**
 * Get code statistics at a specific commit
 */
function getStatsAtCommit(
  repoPath: string,
  commit: string,
  extensions: string[],
  exclude: string[]
): Omit<EvolutionDataPoint, 'date' | 'commit'> {
  // Get file list at commit
  const filesOutput = execFileSync('git', ['ls-tree', '-r', '--name-only', commit], {
    cwd: repoPath,
    encoding: 'utf-8',
  });

  const files = filesOutput
    .trim()
    .split('\n')
    .filter((file) => {
      // Check extension
      const ext = path.extname(file);
      if (!extensions.includes(ext)) return false;

      // Check exclusions
      for (const excl of exclude) {
        if (file.includes(excl)) return false;
      }

      return true;
    });

  // Count lines per language
  const languageBreakdown: Record<string, number> = {};
  let totalLines = 0;

  for (const file of files) {
    try {
      const content = execFileSync('git', ['show', `${commit}:${file}`], {
        cwd: repoPath,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      const lines = content.split('\n').length;
      totalLines += lines;

      const ext = path.extname(file);
      const lang = getLanguageFromExtension(ext);
      languageBreakdown[lang] = (languageBreakdown[lang] || 0) + lines;
    } catch {
      // File can't be read at this commit
    }
  }

  return {
    linesOfCode: totalLines,
    fileCount: files.length,
    languageBreakdown,
  };
}

/**
 * Get language name from extension
 */
function getLanguageFromExtension(ext: string): string {
  const mapping: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript (React)',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript (React)',
    '.py': 'Python',
    '.go': 'Go',
    '.rs': 'Rust',
    '.java': 'Java',
    '.cpp': 'C++',
    '.c': 'C',
    '.h': 'C/C++ Header',
    '.rb': 'Ruby',
    '.php': 'PHP',
    '.swift': 'Swift',
    '.kt': 'Kotlin',
    '.scala': 'Scala',
    '.cs': 'C#',
  };

  return mapping[ext] || ext.slice(1).toUpperCase();
}

/**
 * Calculate summary statistics
 */
function calculateSummary(dataPoints: EvolutionDataPoint[]): EvolutionReport['summary'] {
  const first = dataPoints[0];
  const last = dataPoints[dataPoints.length - 1];
  if (!first || !last) {
    throw new Error('calculateSummary requires at least one data point');
  }

  const daysDiff = (last.date.getTime() - first.date.getTime()) / (1000 * 60 * 60 * 24);

  return {
    startDate: first.date,
    endDate: last.date,
    startLoc: first.linesOfCode,
    endLoc: last.linesOfCode,
    locChange: last.linesOfCode - first.linesOfCode,
    locChangePercent:
      first.linesOfCode > 0
        ? ((last.linesOfCode - first.linesOfCode) / first.linesOfCode) * 100
        : 0,
    startFiles: first.fileCount,
    endFiles: last.fileCount,
    fileChange: last.fileCount - first.fileCount,
    avgCommitsPerDay: daysDiff > 0 ? dataPoints.length / daysDiff : 0,
  };
}

/**
 * Calculate trends
 */
function calculateTrends(dataPoints: EvolutionDataPoint[]): EvolutionReport['trends'] {
  const first = dataPoints[0];
  const last = dataPoints[dataPoints.length - 1];
  if (!first || !last) {
    throw new Error('calculateTrends requires at least one data point');
  }

  const locChange = last.linesOfCode - first.linesOfCode;
  const fileChange = last.fileCount - first.fileCount;

  const daysDiff = (last.date.getTime() - first.date.getTime()) / (1000 * 60 * 60 * 24);
  const velocity = daysDiff > 0 ? locChange / daysDiff : 0;

  const locThreshold = first.linesOfCode * 0.05; // 5% change
  const fileThreshold = Math.max(first.fileCount * 0.05, 2);

  return {
    locTrend:
      locChange > locThreshold ? 'growing' : locChange < -locThreshold ? 'shrinking' : 'stable',
    fileTrend:
      fileChange > fileThreshold ? 'growing' : fileChange < -fileThreshold ? 'shrinking' : 'stable',
    velocity: Math.round(velocity),
  };
}

/**
 * Create empty report
 */
function createEmptyReport(): EvolutionReport {
  const now = new Date();
  return {
    dataPoints: [],
    summary: {
      startDate: now,
      endDate: now,
      startLoc: 0,
      endLoc: 0,
      locChange: 0,
      locChangePercent: 0,
      startFiles: 0,
      endFiles: 0,
      fileChange: 0,
      avgCommitsPerDay: 0,
    },
    trends: {
      locTrend: 'stable',
      fileTrend: 'stable',
      velocity: 0,
    },
    generatedAt: now,
  };
}

/**
 * Format evolution report for terminal display
 */
export function formatEvolutionReport(report: EvolutionReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════════════════════');
  lines.push('                           CODE EVOLUTION REPORT');
  lines.push('═══════════════════════════════════════════════════════════════════════════════');
  lines.push('');

  // Summary
  lines.push('SUMMARY');
  lines.push('───────────────────────────────────────────────────────────────────────────────');
  lines.push(
    `  Period:             ${report.summary.startDate.toLocaleDateString()} - ${report.summary.endDate.toLocaleDateString()}`
  );
  lines.push(
    `  Lines of Code:      ${report.summary.startLoc.toLocaleString()} → ${report.summary.endLoc.toLocaleString()}`
  );
  lines.push(
    `  Change:             ${report.summary.locChange >= 0 ? '+' : ''}${report.summary.locChange.toLocaleString()} (${report.summary.locChangePercent.toFixed(1)}%)`
  );
  lines.push(
    `  Files:              ${report.summary.startFiles} → ${report.summary.endFiles} (${report.summary.fileChange >= 0 ? '+' : ''}${report.summary.fileChange})`
  );
  lines.push(`  Avg Commits/Day:    ${report.summary.avgCommitsPerDay.toFixed(1)}`);
  lines.push('');

  // Trends
  lines.push('TRENDS');
  lines.push('───────────────────────────────────────────────────────────────────────────────');
  const trendIcons = { growing: '📈', shrinking: '📉', stable: '➡️' };
  lines.push(
    `  Lines of Code:      ${trendIcons[report.trends.locTrend]} ${report.trends.locTrend}`
  );
  lines.push(
    `  File Count:         ${trendIcons[report.trends.fileTrend]} ${report.trends.fileTrend}`
  );
  lines.push(
    `  Velocity:           ${report.trends.velocity >= 0 ? '+' : ''}${report.trends.velocity} lines/day`
  );
  lines.push('');

  // Evolution graph (ASCII)
  if (report.dataPoints.length > 1) {
    lines.push('LINES OF CODE OVER TIME');
    lines.push('───────────────────────────────────────────────────────────────────────────────');

    const maxLoc = Math.max(...report.dataPoints.map((d) => d.linesOfCode));
    const minLoc = Math.min(...report.dataPoints.map((d) => d.linesOfCode));
    const range = maxLoc - minLoc || 1;

    // Sample points for display
    const displayPoints =
      report.dataPoints.length <= 20
        ? report.dataPoints
        : report.dataPoints.filter((_, i) => i % Math.ceil(report.dataPoints.length / 20) === 0);

    for (const point of displayPoints) {
      const normalized = (point.linesOfCode - minLoc) / range;
      const barLength = Math.round(normalized * 40) + 1;
      const bar = '█'.repeat(barLength);
      const date = point.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      lines.push(`  ${date.padEnd(7)} ${bar} ${point.linesOfCode.toLocaleString()}`);
    }
    lines.push('');
  }

  // Language breakdown (latest)
  const latest = report.dataPoints[report.dataPoints.length - 1];
  if (latest) {
    const languages = Object.entries(latest.languageBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (languages.length > 0) {
      lines.push('LANGUAGE BREAKDOWN (Current)');
      lines.push('───────────────────────────────────────────────────────────────────────────────');

      const total = Object.values(latest.languageBreakdown).reduce((a, b) => a + b, 0);

      for (const [lang, loc] of languages) {
        const percent = ((loc / total) * 100).toFixed(1);
        const barLength = Math.round((loc / total) * 40);
        const bar = '█'.repeat(barLength);
        lines.push(`  ${lang.padEnd(20)} ${bar} ${percent}%`);
      }
      lines.push('');
    }
  }

  lines.push('═══════════════════════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Export evolution data as JSON
 */
export function exportEvolutionData(report: EvolutionReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Export evolution data as CSV
 */
export function exportEvolutionCSV(report: EvolutionReport): string {
  const headers = ['date', 'commit', 'lines_of_code', 'file_count'];
  const rows = report.dataPoints.map((p) =>
    [p.date.toISOString(), p.commit, p.linesOfCode, p.fileCount].join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

export default generateEvolutionReport;
