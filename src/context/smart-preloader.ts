/**
 * Smart Context Preloader
 *
 * Intelligently preloads relevant context based on:
 * - User's recent activity patterns
 * - Project structure analysis
 * - Git changes and history
 * - Import/dependency graphs
 * - Predictive models based on task type
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';

// ============================================================================
// Types
// ============================================================================

export interface PreloadedContext {
  files: PreloadedFile[];
  symbols: PreloadedSymbol[];
  gitContext: GitContext;
  projectInfo: ProjectInfo;
  relevanceScore: number;
  loadTime: number;
}

export interface PreloadedFile {
  path: string;
  content: string;
  relevance: number;
  reason: PreloadReason;
  tokens: number;
}

export interface PreloadedSymbol {
  name: string;
  type: 'function' | 'class' | 'interface' | 'variable' | 'type';
  file: string;
  line: number;
  signature?: string;
}

export interface GitContext {
  branch: string;
  recentCommits: GitCommit[];
  changedFiles: string[];
  stagedFiles: string[];
  untrackedFiles: string[];
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: string[];
}

export interface ProjectInfo {
  type: ProjectType;
  mainLanguage: string;
  frameworks: string[];
  entryPoints: string[];
  configFiles: string[];
  testDirs: string[];
}

export type ProjectType = 'node' | 'python' | 'rust' | 'go' | 'java' | 'unknown';

export type PreloadReason =
  | 'recently_modified'
  | 'git_changed'
  | 'import_dependency'
  | 'entry_point'
  | 'config_file'
  | 'test_file'
  | 'pattern_match'
  | 'user_pattern';

export interface PreloaderConfig {
  maxFiles: number;
  maxTokens: number;
  includeTests: boolean;
  includeConfigs: boolean;
  gitDepth: number;
  patternHistory: number;
  cacheTimeout: number;
}

export interface UserPattern {
  pattern: string;
  frequency: number;
  lastUsed: number;
  files: string[];
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: PreloaderConfig = {
  maxFiles: 20,
  maxTokens: 50000,
  includeTests: true,
  includeConfigs: true,
  gitDepth: 10,
  patternHistory: 50,
  cacheTimeout: 60000,
};

// ============================================================================
// Smart Context Preloader
// ============================================================================

export class SmartContextPreloader extends EventEmitter {
  private config: PreloaderConfig;
  private projectRoot: string;
  private userPatterns: UserPattern[] = [];
  private cache: Map<string, { data: PreloadedContext; timestamp: number }> = new Map();
  private projectInfo: ProjectInfo | null = null;

  constructor(projectRoot: string, config: Partial<PreloaderConfig> = {}) {
    super();
    this.projectRoot = projectRoot;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Preload context for a task
   */
  async preload(taskHint?: string): Promise<PreloadedContext> {
    const startTime = Date.now();

    // Check cache
    const cacheKey = taskHint || 'default';
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.config.cacheTimeout) {
      return cached.data;
    }

    // Analyze project
    if (!this.projectInfo) {
      this.projectInfo = await this.analyzeProject();
    }

    // Collect context from multiple sources
    const [gitContext, recentFiles, dependencyFiles, patternFiles] = await Promise.all([
      this.getGitContext(),
      this.getRecentlyModifiedFiles(),
      this.getDependencyFiles(taskHint),
      this.getPatternBasedFiles(taskHint),
    ]);

    // Merge and deduplicate files
    const allFiles = this.mergeAndRank([
      ...recentFiles,
      ...dependencyFiles,
      ...patternFiles,
    ]);

    // Load file contents
    const files = await this.loadFileContents(allFiles);

    // Extract symbols
    const symbols = await this.extractSymbols(files);

    const context: PreloadedContext = {
      files,
      symbols,
      gitContext,
      projectInfo: this.projectInfo,
      relevanceScore: this.calculateRelevanceScore(files, taskHint),
      loadTime: Date.now() - startTime,
    };

    // Cache result
    this.cache.set(cacheKey, { data: context, timestamp: Date.now() });

    this.emit('preloaded', { context, taskHint });
    return context;
  }

  /**
   * Analyze project structure
   */
  private async analyzeProject(): Promise<ProjectInfo> {
    const info: ProjectInfo = {
      type: 'unknown',
      mainLanguage: 'unknown',
      frameworks: [],
      entryPoints: [],
      configFiles: [],
      testDirs: [],
    };

    // Detect project type
    const files = await this.listFiles(this.projectRoot, 2);

    // Node.js
    if (files.includes('package.json')) {
      info.type = 'node';
      info.mainLanguage = files.some(f => f.endsWith('.ts')) ? 'typescript' : 'javascript';
      info.configFiles.push('package.json');

      if (files.includes('tsconfig.json')) {
        info.configFiles.push('tsconfig.json');
      }

      // Detect frameworks
      try {
        const pkg = JSON.parse(await fs.readFile(path.join(this.projectRoot, 'package.json'), 'utf-8')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (deps['react']) info.frameworks.push('react');
        if (deps['vue']) info.frameworks.push('vue');
        if (deps['express']) info.frameworks.push('express');
        if (deps['next']) info.frameworks.push('next');
        if (deps['nest']) info.frameworks.push('nestjs');
      } catch {
        // Ignore
      }

      // Find entry points
      const srcIndex = files.find(f => f === 'src/index.ts' || f === 'src/index.js');
      if (srcIndex) info.entryPoints.push(srcIndex);
    }

    // Python
    if (files.includes('pyproject.toml') || files.includes('setup.py') || files.includes('requirements.txt')) {
      info.type = 'python';
      info.mainLanguage = 'python';

      if (files.includes('pyproject.toml')) info.configFiles.push('pyproject.toml');
      if (files.includes('requirements.txt')) info.configFiles.push('requirements.txt');

      // Detect frameworks
      try {
        const reqs = await fs.readFile(path.join(this.projectRoot, 'requirements.txt'), 'utf-8');
        if (reqs.includes('django')) info.frameworks.push('django');
        if (reqs.includes('fastapi')) info.frameworks.push('fastapi');
        if (reqs.includes('flask')) info.frameworks.push('flask');
      } catch {
        // Ignore
      }
    }

    // Rust
    if (files.includes('Cargo.toml')) {
      info.type = 'rust';
      info.mainLanguage = 'rust';
      info.configFiles.push('Cargo.toml');
      info.entryPoints.push('src/main.rs', 'src/lib.rs');
    }

    // Go
    if (files.includes('go.mod')) {
      info.type = 'go';
      info.mainLanguage = 'go';
      info.configFiles.push('go.mod');
    }

    // Find test directories
    const testDirs = ['test', 'tests', '__tests__', 'spec', 'specs'];
    for (const dir of testDirs) {
      if (existsSync(path.join(this.projectRoot, dir))) {
        info.testDirs.push(dir);
      }
    }

    return info;
  }

  /**
   * Get git context
   */
  private async getGitContext(): Promise<GitContext> {
    const context: GitContext = {
      branch: 'unknown',
      recentCommits: [],
      changedFiles: [],
      stagedFiles: [],
      untrackedFiles: [],
    };

    try {
      // Current branch
      context.branch = await this.execGit(['rev-parse', '--abbrev-ref', 'HEAD']);

      // Recent commits
      const log = await this.execGit([
        'log',
        `--max-count=${this.config.gitDepth}`,
        '--pretty=format:%H|%s|%an|%ai',
        '--name-only',
      ]);

      const commits: GitCommit[] = [];
      const logParts = log.split('\n\n');

      for (const part of logParts) {
        const lines = part.split('\n');
        if (lines.length > 0) {
          const [hash, message, author, date] = lines[0].split('|');
          if (hash && message) {
            commits.push({
              hash,
              message,
              author: author || 'unknown',
              date: date || '',
              files: lines.slice(1).filter(f => f.trim()),
            });
          }
        }
      }
      context.recentCommits = commits;

      // Changed files
      const status = await this.execGit(['status', '--porcelain']);
      for (const line of status.split('\n')) {
        if (!line.trim()) continue;

        const status = line.slice(0, 2);
        const file = line.slice(3);

        if (status.includes('M') || status.includes('A') || status.includes('D')) {
          context.changedFiles.push(file);
        }
        if (status[0] !== ' ' && status[0] !== '?') {
          context.stagedFiles.push(file);
        }
        if (status === '??') {
          context.untrackedFiles.push(file);
        }
      }
    } catch {
      // Not a git repo or git not available
    }

    return context;
  }

  /**
   * Get recently modified files
   */
  private async getRecentlyModifiedFiles(): Promise<Array<{ path: string; relevance: number; reason: PreloadReason }>> {
    const files: Array<{ path: string; relevance: number; reason: PreloadReason; mtime: number }> = [];

    const walk = async (dir: string, depth = 0): Promise<void> => {
      if (depth > 5) return;

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(this.projectRoot, fullPath);

          // Skip ignored directories
          if (entry.isDirectory()) {
            if (['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'target'].includes(entry.name)) {
              continue;
            }
            await walk(fullPath, depth + 1);
          } else if (this.isSourceFile(entry.name)) {
            const stat = await fs.stat(fullPath);
            files.push({
              path: relativePath,
              relevance: 0,
              reason: 'recently_modified',
              mtime: stat.mtimeMs,
            });
          }
        }
      } catch {
        // Ignore access errors
      }
    };

    await walk(this.projectRoot);

    // Sort by modification time and take top N
    return files
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, this.config.maxFiles)
      .map((f, i) => ({
        path: f.path,
        relevance: 1 - (i / this.config.maxFiles),
        reason: f.reason,
      }));
  }

  /**
   * Get files based on import/dependency analysis
   */
  private async getDependencyFiles(taskHint?: string): Promise<Array<{ path: string; relevance: number; reason: PreloadReason }>> {
    const files: Array<{ path: string; relevance: number; reason: PreloadReason }> = [];

    // Add entry points
    if (this.projectInfo) {
      for (const entry of this.projectInfo.entryPoints) {
        if (existsSync(path.join(this.projectRoot, entry))) {
          files.push({ path: entry, relevance: 0.9, reason: 'entry_point' });
        }
      }

      // Add config files
      if (this.config.includeConfigs) {
        for (const config of this.projectInfo.configFiles) {
          files.push({ path: config, relevance: 0.8, reason: 'config_file' });
        }
      }
    }

    // If task hint mentions specific files/modules, add related files
    if (taskHint) {
      const keywords = this.extractKeywords(taskHint);

      const allFiles = await this.listFiles(this.projectRoot, 4);
      for (const file of allFiles) {
        const fileName = path.basename(file, path.extname(file));
        for (const keyword of keywords) {
          if (fileName.toLowerCase().includes(keyword.toLowerCase())) {
            files.push({ path: file, relevance: 0.85, reason: 'pattern_match' });
            break;
          }
        }
      }
    }

    return files;
  }

  /**
   * Get files based on user patterns
   */
  private async getPatternBasedFiles(taskHint?: string): Promise<Array<{ path: string; relevance: number; reason: PreloadReason }>> {
    const files: Array<{ path: string; relevance: number; reason: PreloadReason }> = [];

    // Use historical patterns
    for (const pattern of this.userPatterns) {
      const recency = (Date.now() - pattern.lastUsed) / (24 * 60 * 60 * 1000); // Days
      const relevance = (pattern.frequency / 10) * Math.exp(-recency / 7);

      if (relevance > 0.3) {
        for (const file of pattern.files) {
          if (existsSync(path.join(this.projectRoot, file))) {
            files.push({ path: file, relevance, reason: 'user_pattern' });
          }
        }
      }
    }

    return files;
  }

  /**
   * Merge and rank files
   */
  private mergeAndRank(files: Array<{ path: string; relevance: number; reason: PreloadReason }>): Array<{ path: string; relevance: number; reason: PreloadReason }> {
    const fileMap = new Map<string, { path: string; relevance: number; reason: PreloadReason }>();

    for (const file of files) {
      const existing = fileMap.get(file.path);
      if (existing) {
        // Combine relevance scores
        existing.relevance = Math.min(1, existing.relevance + file.relevance * 0.5);
      } else {
        fileMap.set(file.path, { ...file });
      }
    }

    return Array.from(fileMap.values())
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, this.config.maxFiles);
  }

  /**
   * Load file contents
   */
  private async loadFileContents(files: Array<{ path: string; relevance: number; reason: PreloadReason }>): Promise<PreloadedFile[]> {
    const results: PreloadedFile[] = [];
    let totalTokens = 0;

    for (const file of files) {
      if (totalTokens >= this.config.maxTokens) break;

      try {
        const fullPath = path.join(this.projectRoot, file.path);
        const content = await fs.readFile(fullPath, 'utf-8');
        const tokens = this.estimateTokens(content);

        if (totalTokens + tokens <= this.config.maxTokens) {
          results.push({
            path: file.path,
            content,
            relevance: file.relevance,
            reason: file.reason,
            tokens,
          });
          totalTokens += tokens;
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return results;
  }

  /**
   * Extract symbols from files
   */
  private async extractSymbols(files: PreloadedFile[]): Promise<PreloadedSymbol[]> {
    const symbols: PreloadedSymbol[] = [];

    for (const file of files) {
      const ext = path.extname(file.path);

      // TypeScript/JavaScript
      if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        symbols.push(...this.extractTSSymbols(file.content, file.path));
      }

      // Python
      if (['.py'].includes(ext)) {
        symbols.push(...this.extractPythonSymbols(file.content, file.path));
      }
    }

    return symbols;
  }

  /**
   * Extract TypeScript/JavaScript symbols
   */
  private extractTSSymbols(content: string, filePath: string): PreloadedSymbol[] {
    const symbols: PreloadedSymbol[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Functions
      const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
      if (funcMatch) {
        symbols.push({
          name: funcMatch[1],
          type: 'function',
          file: filePath,
          line: i + 1,
          signature: line.trim(),
        });
      }

      // Classes
      const classMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          type: 'class',
          file: filePath,
          line: i + 1,
        });
      }

      // Interfaces
      const interfaceMatch = line.match(/(?:export\s+)?interface\s+(\w+)/);
      if (interfaceMatch) {
        symbols.push({
          name: interfaceMatch[1],
          type: 'interface',
          file: filePath,
          line: i + 1,
        });
      }

      // Type aliases
      const typeMatch = line.match(/(?:export\s+)?type\s+(\w+)/);
      if (typeMatch) {
        symbols.push({
          name: typeMatch[1],
          type: 'type',
          file: filePath,
          line: i + 1,
        });
      }
    }

    return symbols;
  }

  /**
   * Extract Python symbols
   */
  private extractPythonSymbols(content: string, filePath: string): PreloadedSymbol[] {
    const symbols: PreloadedSymbol[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Functions
      const funcMatch = line.match(/^(?:async\s+)?def\s+(\w+)/);
      if (funcMatch) {
        symbols.push({
          name: funcMatch[1],
          type: 'function',
          file: filePath,
          line: i + 1,
          signature: line.trim(),
        });
      }

      // Classes
      const classMatch = line.match(/^class\s+(\w+)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          type: 'class',
          file: filePath,
          line: i + 1,
        });
      }
    }

    return symbols;
  }

  /**
   * Record user pattern
   */
  recordPattern(pattern: string, files: string[]): void {
    const existing = this.userPatterns.find(p => p.pattern === pattern);

    if (existing) {
      existing.frequency++;
      existing.lastUsed = Date.now();
      existing.files = [...new Set([...existing.files, ...files])];
    } else {
      this.userPatterns.push({
        pattern,
        frequency: 1,
        lastUsed: Date.now(),
        files,
      });
    }

    // Trim old patterns
    if (this.userPatterns.length > this.config.patternHistory) {
      this.userPatterns.sort((a, b) => b.lastUsed - a.lastUsed);
      this.userPatterns = this.userPatterns.slice(0, this.config.patternHistory);
    }
  }

  /**
   * Calculate relevance score
   */
  private calculateRelevanceScore(files: PreloadedFile[], taskHint?: string): number {
    if (files.length === 0) return 0;

    let score = files.reduce((acc, f) => acc + f.relevance, 0) / files.length;

    // Boost if task hint matches file names
    if (taskHint) {
      const keywords = this.extractKeywords(taskHint);
      const matchingFiles = files.filter(f =>
        keywords.some(k => f.path.toLowerCase().includes(k.toLowerCase()))
      );
      score += (matchingFiles.length / files.length) * 0.2;
    }

    return Math.min(1, score);
  }

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2)
      .filter(w => !['the', 'and', 'for', 'with', 'this', 'that'].includes(w));
  }

  /**
   * Check if file is a source file
   */
  private isSourceFile(name: string): boolean {
    const ext = path.extname(name).toLowerCase();
    const sourceExts = [
      '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go',
      '.java', '.kt', '.swift', '.rb', '.php', '.c', '.cpp', '.h',
      '.css', '.scss', '.less', '.html', '.vue', '.svelte',
      '.json', '.yaml', '.yml', '.toml', '.md',
    ];
    return sourceExts.includes(ext);
  }

  /**
   * List files recursively
   */
  private async listFiles(dir: string, maxDepth: number, depth = 0): Promise<string[]> {
    if (depth > maxDepth) return [];

    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(this.projectRoot, fullPath);

        if (entry.isDirectory()) {
          if (!['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'target'].includes(entry.name)) {
            files.push(...await this.listFiles(fullPath, maxDepth, depth + 1));
          }
        } else {
          files.push(relativePath);
        }
      }
    } catch {
      // Ignore access errors
    }

    return files;
  }

  /**
   * Execute git command
   */
  private execGit(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, { cwd: this.projectRoot });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(stderr || `Git exited with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Estimate token count
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.cache.clear();
    this.userPatterns = [];
    this.projectInfo = null;
    this.removeAllListeners();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createSmartPreloader(
  projectRoot: string,
  config?: Partial<PreloaderConfig>
): SmartContextPreloader {
  return new SmartContextPreloader(projectRoot, config);
}
