/**
 * Changelog Generator
 *
 * Automated changelog generation from git commits:
 * - Conventional commits parsing
 * - Version grouping
 * - Breaking changes detection
 * - Multiple output formats
 */

import { execSync } from 'child_process';
import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import * as path from 'path';

export type CommitType =
  | 'feat'
  | 'fix'
  | 'docs'
  | 'style'
  | 'refactor'
  | 'perf'
  | 'test'
  | 'build'
  | 'ci'
  | 'chore'
  | 'revert';

export interface ConventionalCommit {
  hash: string;
  shortHash: string;
  type: CommitType;
  scope?: string;
  subject: string;
  body?: string;
  breaking: boolean;
  breakingNote?: string;
  date: Date;
  author: string;
  references: string[];
}

export interface VersionEntry {
  version: string;
  date: Date;
  commits: ConventionalCommit[];
  breaking: ConventionalCommit[];
}

export interface ChangelogOptions {
  /** Repository path */
  repoPath?: string;
  /** Number of releases to include (0 = all) */
  releaseCount?: number;
  /** Include unreleased commits */
  includeUnreleased?: boolean;
  /** Group commits by type */
  groupByType?: boolean;
  /** Include commit body */
  includeBody?: boolean;
  /** Include author */
  includeAuthor?: boolean;
  /** Repository URL for links */
  repoUrl?: string;
  /** Output format */
  format?: 'markdown' | 'json' | 'html';
}

const DEFAULT_OPTIONS: Required<ChangelogOptions> = {
  repoPath: process.cwd(),
  releaseCount: 10,
  includeUnreleased: true,
  groupByType: true,
  includeBody: false,
  includeAuthor: false,
  repoUrl: '',
  format: 'markdown',
};

const COMMIT_TYPE_LABELS: Record<CommitType, string> = {
  feat: 'Features',
  fix: 'Bug Fixes',
  docs: 'Documentation',
  style: 'Styles',
  refactor: 'Code Refactoring',
  perf: 'Performance Improvements',
  test: 'Tests',
  build: 'Build System',
  ci: 'CI/CD',
  chore: 'Chores',
  revert: 'Reverts',
};

const COMMIT_TYPE_ORDER: CommitType[] = [
  'feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'style', 'chore', 'revert'
];

/**
 * Changelog Generator
 */
export class ChangelogGenerator {
  private options: Required<ChangelogOptions>;

  constructor(options: ChangelogOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Generate changelog
   */
  async generate(): Promise<string> {
    const versions = await this.parseVersions();

    switch (this.options.format) {
      case 'json':
        return JSON.stringify(versions, null, 2);
      case 'html':
        return this.formatHtml(versions);
      default:
        return this.formatMarkdown(versions);
    }
  }

  /**
   * Parse versions from git history
   */
  async parseVersions(): Promise<VersionEntry[]> {
    const tags = this.getTags();
    const commits = this.getCommits();
    const versions: VersionEntry[] = [];

    // Group commits by version
    let _currentVersion: VersionEntry | null = null;
    let tagIndex = 0;

    // Add unreleased if requested
    if (this.options.includeUnreleased) {
      const unreleasedCommits = commits.filter(c => {
        if (tags.length === 0) return true;
        return c.date > tags[0].date;
      });

      if (unreleasedCommits.length > 0) {
        versions.push({
          version: 'Unreleased',
          date: new Date(),
          commits: unreleasedCommits,
          breaking: unreleasedCommits.filter(c => c.breaking),
        });
      }
    }

    // Group by tags
    for (const tag of tags) {
      const nextTag = tags[tagIndex + 1];
      const versionCommits = commits.filter(c => {
        if (c.date > tag.date) return false;
        if (nextTag && c.date <= nextTag.date) return false;
        return true;
      });

      if (versionCommits.length > 0 || tagIndex === 0) {
        versions.push({
          version: tag.name,
          date: tag.date,
          commits: versionCommits,
          breaking: versionCommits.filter(c => c.breaking),
        });
      }

      tagIndex++;

      if (this.options.releaseCount > 0 && versions.length >= this.options.releaseCount) {
        break;
      }
    }

    return versions;
  }

  /**
   * Get git tags sorted by date
   */
  private getTags(): Array<{ name: string; date: Date }> {
    try {
      const output = execSync(
        'git tag --sort=-creatordate --format="%(refname:short)|%(creatordate:iso)"',
        { cwd: this.options.repoPath, encoding: 'utf-8' }
      );

      return output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const [name, dateStr] = line.split('|');
          return {
            name,
            date: new Date(dateStr),
          };
        })
        .filter(tag => /^v?\d+\.\d+\.\d+/.test(tag.name)); // Only semver tags
    } catch {
      return [];
    }
  }

  /**
   * Get parsed commits
   */
  private getCommits(): ConventionalCommit[] {
    try {
      const format = '%H|%h|%s|%b|%an|%aI';
      const output = execSync(
        `git log --format="${format}" --no-merges`,
        { cwd: this.options.repoPath, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      );

      const commits: ConventionalCommit[] = [];

      for (const entry of output.split('\n\n')) {
        if (!entry.trim()) continue;

        const lines = entry.split('\n');
        const firstLine = lines[0];
        const parts = firstLine.split('|');

        if (parts.length < 6) continue;

        const [hash, shortHash, subject, body, author, dateStr] = parts;
        const parsed = this.parseConventionalCommit(subject, body || '');

        if (parsed) {
          commits.push({
            hash,
            shortHash,
            ...parsed,
            body: body || undefined,
            date: new Date(dateStr),
            author,
          });
        }
      }

      return commits.sort((a, b) => b.date.getTime() - a.date.getTime());
    } catch {
      return [];
    }
  }

  /**
   * Parse conventional commit format
   */
  private parseConventionalCommit(
    subject: string,
    body: string
  ): Omit<ConventionalCommit, 'hash' | 'shortHash' | 'date' | 'author' | 'body'> | null {
    // Pattern: type(scope)!: subject
    const pattern = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/;
    const match = subject.match(pattern);

    if (!match) {
      // Not a conventional commit
      return null;
    }

    const [, type, scope, breakingMark, subjectText] = match;

    // Validate type
    if (!COMMIT_TYPE_LABELS[type as CommitType]) {
      return null;
    }

    // Check for breaking changes
    const breaking = breakingMark === '!' ||
      body.includes('BREAKING CHANGE:') ||
      body.includes('BREAKING-CHANGE:');

    let breakingNote: string | undefined;
    if (breaking && body) {
      const breakingMatch = body.match(/BREAKING[ -]CHANGE:\s*(.+?)(?:\n\n|$)/s);
      if (breakingMatch) {
        breakingNote = breakingMatch[1].trim();
      }
    }

    // Extract issue references
    const references: string[] = [];
    const refPattern = /#(\d+)/g;
    let refMatch;
    while ((refMatch = refPattern.exec(subject + ' ' + body)) !== null) {
      references.push(refMatch[1]);
    }

    return {
      type: type as CommitType,
      scope: scope || undefined,
      subject: subjectText.trim(),
      breaking,
      breakingNote,
      references,
    };
  }

  /**
   * Format as Markdown
   */
  private formatMarkdown(versions: VersionEntry[]): string {
    const lines: string[] = [
      '# Changelog',
      '',
      'All notable changes to this project will be documented in this file.',
      '',
      'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),',
      'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).',
      '',
    ];

    for (const version of versions) {
      // Version header
      const dateStr = version.version === 'Unreleased'
        ? ''
        : ` - ${version.date.toISOString().split('T')[0]}`;
      lines.push(`## [${version.version}]${dateStr}`);
      lines.push('');

      // Breaking changes
      if (version.breaking.length > 0) {
        lines.push('### ⚠️ BREAKING CHANGES');
        lines.push('');
        for (const commit of version.breaking) {
          const note = commit.breakingNote || commit.subject;
          lines.push(`- ${note}`);
        }
        lines.push('');
      }

      if (this.options.groupByType) {
        // Group by type
        for (const type of COMMIT_TYPE_ORDER) {
          const typeCommits = version.commits.filter(c => c.type === type);
          if (typeCommits.length === 0) continue;

          lines.push(`### ${COMMIT_TYPE_LABELS[type]}`);
          lines.push('');

          for (const commit of typeCommits) {
            lines.push(this.formatCommitMarkdown(commit));
          }
          lines.push('');
        }
      } else {
        // All commits together
        for (const commit of version.commits) {
          lines.push(this.formatCommitMarkdown(commit));
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Format single commit as Markdown
   */
  private formatCommitMarkdown(commit: ConventionalCommit): string {
    let line = '- ';

    if (commit.scope) {
      line += `**${commit.scope}:** `;
    }

    line += commit.subject;

    if (commit.references.length > 0 && this.options.repoUrl) {
      const refs = commit.references.map(ref =>
        `[#${ref}](${this.options.repoUrl}/issues/${ref})`
      ).join(', ');
      line += ` (${refs})`;
    } else if (commit.references.length > 0) {
      line += ` (#${commit.references.join(', #')})`;
    }

    if (this.options.includeAuthor) {
      line += ` - ${commit.author}`;
    }

    if (this.options.repoUrl) {
      line += ` ([${commit.shortHash}](${this.options.repoUrl}/commit/${commit.hash}))`;
    }

    return line;
  }

  /**
   * Format as HTML
   */
  private formatHtml(versions: VersionEntry[]): string {
    const lines: string[] = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="UTF-8">',
      '  <title>Changelog</title>',
      '  <style>',
      '    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }',
      '    h1 { border-bottom: 2px solid #333; padding-bottom: 10px; }',
      '    h2 { color: #0366d6; margin-top: 30px; }',
      '    h3 { color: #666; margin-top: 20px; }',
      '    ul { list-style-type: disc; padding-left: 20px; }',
      '    li { margin: 5px 0; }',
      '    .breaking { background: #fff3cd; padding: 10px; border-left: 4px solid #ffc107; margin: 10px 0; }',
      '    .scope { font-weight: bold; color: #6f42c1; }',
      '    .hash { font-family: monospace; font-size: 0.9em; color: #999; }',
      '  </style>',
      '</head>',
      '<body>',
      '  <h1>Changelog</h1>',
    ];

    for (const version of versions) {
      const dateStr = version.version === 'Unreleased'
        ? ''
        : ` <small>(${version.date.toISOString().split('T')[0]})</small>`;

      lines.push(`  <h2>${version.version}${dateStr}</h2>`);

      if (version.breaking.length > 0) {
        lines.push('  <div class="breaking">');
        lines.push('    <strong>⚠️ Breaking Changes:</strong>');
        lines.push('    <ul>');
        for (const commit of version.breaking) {
          lines.push(`      <li>${commit.breakingNote || commit.subject}</li>`);
        }
        lines.push('    </ul>');
        lines.push('  </div>');
      }

      for (const type of COMMIT_TYPE_ORDER) {
        const typeCommits = version.commits.filter(c => c.type === type);
        if (typeCommits.length === 0) continue;

        lines.push(`  <h3>${COMMIT_TYPE_LABELS[type]}</h3>`);
        lines.push('  <ul>');

        for (const commit of typeCommits) {
          let item = '    <li>';
          if (commit.scope) {
            item += `<span class="scope">${commit.scope}:</span> `;
          }
          item += commit.subject;
          item += ` <span class="hash">(${commit.shortHash})</span>`;
          item += '</li>';
          lines.push(item);
        }

        lines.push('  </ul>');
      }
    }

    lines.push('</body>');
    lines.push('</html>');

    return lines.join('\n');
  }

  /**
   * Write changelog to file
   */
  async writeToFile(filePath: string): Promise<void> {
    const content = await this.generate();
    await UnifiedVfsRouter.Instance.writeFile(filePath, content, 'utf-8');
  }

  /**
   * Update existing CHANGELOG.md
   */
  async updateChangelog(changelogPath: string = 'CHANGELOG.md'): Promise<void> {
    const content = await this.generate();
    const fullPath = path.join(this.options.repoPath, changelogPath);
    await UnifiedVfsRouter.Instance.writeFile(fullPath, content, 'utf-8');
  }
}

/**
 * Generate changelog
 */
export async function generateChangelog(options?: ChangelogOptions): Promise<string> {
  const generator = new ChangelogGenerator(options);
  return generator.generate();
}

/**
 * Update CHANGELOG.md file
 */
export async function updateChangelog(options?: ChangelogOptions): Promise<void> {
  const generator = new ChangelogGenerator(options);
  await generator.updateChangelog();
}

export default ChangelogGenerator;
