/**
 * Archive Agent
 *
 * Specialized agent for managing archive files.
 * Supports zip, tar, tar.gz, and other common formats.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { basename, join, dirname, relative } from 'path';
import {
  SpecializedAgent,
  SpecializedAgentConfig,
  AgentTask,
  AgentResult,
  ArchiveFormat,
  ArchiveEntry,
  ArchiveInfo,
  ArchiveCreateOptions,
  ArchiveExtractOptions,
} from './types.js';
import { getErrorMessage } from '../../types/index.js';

// ============================================================================
// Configuration
// ============================================================================

const ARCHIVE_AGENT_CONFIG: SpecializedAgentConfig = {
  id: 'archive-agent',
  name: 'Archive Agent',
  description: 'Create, extract, and inspect archive files (zip, tar, gzip)',
  capabilities: ['archive-extract', 'archive-create'],
  fileExtensions: ['zip', 'tar', 'gz', 'tgz', 'tar.gz', 'tar.bz2', '7z', 'rar'],
  maxFileSize: 1024 * 1024 * 1024, // 1GB
  requiredTools: [],
};

// ============================================================================
// Archive Agent Implementation
// ============================================================================

export class ArchiveAgent extends SpecializedAgent {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private jszip: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tar: any = null;

  constructor() {
    super(ARCHIVE_AGENT_CONFIG);
  }

  async initialize(): Promise<void> {
    // Try to load archiving libraries
    try {
      const jszipModule = await import('jszip');
      this.jszip = jszipModule.default || jszipModule;
    } catch (_error) {
      // jszip not available
    }

    try {
      const tarModule = await import('tar');
      this.tar = tarModule;
    } catch (_error) {
      // tar not available
    }

    this.isInitialized = true;
    this.emit('initialized', {
      jszip: !!this.jszip,
      tar: !!this.tar,
    });
  }

  getSupportedActions(): string[] {
    return ['list', 'extract', 'create', 'info', 'add', 'remove'];
  }

  getActionHelp(action: string): string {
    const help: Record<string, string> = {
      list: 'List contents of an archive',
      extract: 'Extract files from an archive',
      create: 'Create a new archive',
      info: 'Get information about an archive',
      add: 'Add files to an existing archive',
      remove: 'Remove files from an archive',
    };
    return help[action] || `Unknown action: ${action}`;
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      switch (task.action) {
        case 'list':
          return await this.listArchive(task, startTime);
        case 'extract':
          return await this.extractArchive(task, startTime);
        case 'create':
          return await this.createArchive(task, startTime);
        case 'info':
          return await this.getArchiveInfo(task, startTime);
        case 'add':
          return await this.addToArchive(task, startTime);
        case 'remove':
          return await this.removeFromArchive(task, startTime);
        default:
          return { success: false, error: `Unknown action: ${task.action}` };
      }
    } catch (error) {
      return {
        success: false,
        error: `Archive error: ${getErrorMessage(error)}`,
        duration: Date.now() - startTime,
      };
    }
  }

  // ============================================================================
  // Actions
  // ============================================================================

  private async listArchive(task: AgentTask, startTime: number): Promise<AgentResult> {
    if (!task.inputFiles || task.inputFiles.length === 0) {
      return { success: false, error: 'No archive file specified' };
    }

    const archivePath = task.inputFiles[0];
    if (!existsSync(archivePath)) {
      return { success: false, error: `Archive not found: ${archivePath}` };
    }

    const format = this.detectFormat(archivePath);
    let entries: ArchiveEntry[];

    switch (format) {
      case 'zip':
        entries = await this.listZip(archivePath);
        break;
      case 'tar':
      case 'tar.gz':
      case 'tgz':
        entries = await this.listTar(archivePath, format !== 'tar');
        break;
      default:
        return { success: false, error: `Unsupported format: ${format}` };
    }

    return {
      success: true,
      data: entries,
      output: this.formatEntryList(entries),
      duration: Date.now() - startTime,
      metadata: {
        format,
        entryCount: entries.length,
        totalSize: entries.reduce((sum, e) => sum + e.size, 0),
      },
    };
  }

  private async extractArchive(task: AgentTask, startTime: number): Promise<AgentResult> {
    if (!task.inputFiles || task.inputFiles.length === 0) {
      return { success: false, error: 'No archive file specified' };
    }

    const archivePath = task.inputFiles[0];
    if (!existsSync(archivePath)) {
      return { success: false, error: `Archive not found: ${archivePath}` };
    }

    const options = (task.params || {}) as Partial<ArchiveExtractOptions>;
    const outputDir = options.outputDir || dirname(archivePath);

    // Create output directory
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const format = this.detectFormat(archivePath);
    let extractedFiles: string[];

    switch (format) {
      case 'zip':
        extractedFiles = await this.extractZip(archivePath, outputDir, options);
        break;
      case 'tar':
      case 'tar.gz':
      case 'tgz':
        extractedFiles = await this.extractTar(archivePath, outputDir, format !== 'tar', options);
        break;
      default:
        return { success: false, error: `Unsupported format: ${format}` };
    }

    return {
      success: true,
      data: { extractedFiles, outputDir },
      output: `Extracted ${extractedFiles.length} files to ${outputDir}`,
      duration: Date.now() - startTime,
      metadata: {
        format,
        fileCount: extractedFiles.length,
      },
    };
  }

  private async createArchive(task: AgentTask, startTime: number): Promise<AgentResult> {
    if (!task.outputFile) {
      return { success: false, error: 'No output file specified' };
    }

    if (!task.inputFiles || task.inputFiles.length === 0) {
      return { success: false, error: 'No input files specified' };
    }

    const options = (task.params || {}) as Partial<ArchiveCreateOptions>;
    const format = options.format || this.detectFormat(task.outputFile);

    // Collect all files to archive
    const files = this.collectFiles(task.inputFiles, options);

    if (files.length === 0) {
      return { success: false, error: 'No files to archive' };
    }

    switch (format) {
      case 'zip':
        await this.createZip(task.outputFile, files, options);
        break;
      case 'tar':
      case 'tar.gz':
      case 'tgz':
        await this.createTar(task.outputFile, files, format !== 'tar', options);
        break;
      default:
        return { success: false, error: `Unsupported format: ${format}` };
    }

    const stats = statSync(task.outputFile);

    return {
      success: true,
      outputFile: task.outputFile,
      output: `Created ${task.outputFile} (${this.formatSize(stats.size)}) with ${files.length} files`,
      duration: Date.now() - startTime,
      metadata: {
        format,
        fileCount: files.length,
        archiveSize: stats.size,
      },
    };
  }

  private async getArchiveInfo(task: AgentTask, startTime: number): Promise<AgentResult> {
    if (!task.inputFiles || task.inputFiles.length === 0) {
      return { success: false, error: 'No archive file specified' };
    }

    const archivePath = task.inputFiles[0];
    if (!existsSync(archivePath)) {
      return { success: false, error: `Archive not found: ${archivePath}` };
    }

    const stats = statSync(archivePath);
    const format = this.detectFormat(archivePath);

    // Get entries for detailed info
    const listResult = await this.listArchive(task, startTime);
    if (!listResult.success) {
      return listResult;
    }

    const entries = listResult.data as ArchiveEntry[];
    const totalUncompressed = entries.reduce((sum, e) => sum + e.size, 0);
    const directories = entries.filter(e => e.isDirectory).length;
    const files = entries.length - directories;

    const info: ArchiveInfo = {
      format,
      filename: basename(archivePath),
      totalSize: totalUncompressed,
      compressedSize: stats.size,
      entryCount: entries.length,
      entries,
    };

    const compressionRatio = totalUncompressed > 0
      ? ((1 - stats.size / totalUncompressed) * 100).toFixed(1)
      : '0';

    return {
      success: true,
      data: info,
      output: this.formatArchiveInfo(info, compressionRatio, files, directories),
      duration: Date.now() - startTime,
    };
  }

  private async addToArchive(task: AgentTask, startTime: number): Promise<AgentResult> {
    if (!task.inputFiles || task.inputFiles.length < 2) {
      return { success: false, error: 'Archive file and files to add required' };
    }

    const archivePath = task.inputFiles[0];
    const filesToAdd = task.inputFiles.slice(1);

    if (!existsSync(archivePath)) {
      return { success: false, error: `Archive not found: ${archivePath}` };
    }

    const format = this.detectFormat(archivePath);

    if (format !== 'zip') {
      return { success: false, error: 'Adding files is only supported for ZIP archives' };
    }

    if (!this.jszip) {
      return { success: false, error: 'jszip library required. Install with: npm install jszip' };
    }

    // Read existing archive
    const buffer = readFileSync(archivePath);
    const zip = await this.jszip.loadAsync(buffer);

    // Add new files
    const files = this.collectFiles(filesToAdd, {});
    for (const { path, fullPath } of files) {
      const content = readFileSync(fullPath);
      zip.file(path, content);
    }

    // Write back
    const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    writeFileSync(archivePath, output);

    return {
      success: true,
      output: `Added ${files.length} files to ${archivePath}`,
      duration: Date.now() - startTime,
    };
  }

  private async removeFromArchive(task: AgentTask, startTime: number): Promise<AgentResult> {
    if (!task.inputFiles || task.inputFiles.length === 0) {
      return { success: false, error: 'No archive file specified' };
    }

    const patterns = task.params?.patterns as string[] || [];
    if (patterns.length === 0) {
      return { success: false, error: 'Patterns to remove required' };
    }

    const archivePath = task.inputFiles[0];
    if (!existsSync(archivePath)) {
      return { success: false, error: `Archive not found: ${archivePath}` };
    }

    const format = this.detectFormat(archivePath);

    if (format !== 'zip') {
      return { success: false, error: 'Removing files is only supported for ZIP archives' };
    }

    if (!this.jszip) {
      return { success: false, error: 'jszip library required' };
    }

    // Read existing archive
    const buffer = readFileSync(archivePath);
    const zip = await this.jszip.loadAsync(buffer);

    // Remove matching files
    let removedCount = 0;
    for (const pattern of patterns) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      zip.forEach((path: string) => {
        if (regex.test(path)) {
          zip.remove(path);
          removedCount++;
        }
      });
    }

    // Write back
    const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    writeFileSync(archivePath, output);

    return {
      success: true,
      output: `Removed ${removedCount} files from ${archivePath}`,
      duration: Date.now() - startTime,
    };
  }

  // ============================================================================
  // ZIP Operations
  // ============================================================================

  private async listZip(archivePath: string): Promise<ArchiveEntry[]> {
    if (!this.jszip) {
      throw new Error('jszip library required. Install with: npm install jszip');
    }

    const buffer = readFileSync(archivePath);
    const zip = await this.jszip.loadAsync(buffer);

    const entries: ArchiveEntry[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    zip.forEach((path: string, file: any) => {
      entries.push({
        path,
        name: basename(path),
        size: file._data?.uncompressedSize || 0,
        compressedSize: file._data?.compressedSize || 0,
        isDirectory: file.dir,
        modifiedDate: file.date,
      });
    });

    return entries;
  }

  private async extractZip(
    archivePath: string,
    outputDir: string,
    options: Partial<ArchiveExtractOptions>
  ): Promise<string[]> {
    if (!this.jszip) {
      throw new Error('jszip library required');
    }

    const buffer = readFileSync(archivePath);
    const zip = await this.jszip.loadAsync(buffer);

    const extractedFiles: string[] = [];
    const filterRegex = options.filterPatterns
      ? new RegExp(options.filterPatterns.map(p => p.replace(/\*/g, '.*')).join('|'))
      : null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const [path, file] of Object.entries(zip.files) as [string, any][]) {
      if (file.dir) continue;

      if (filterRegex && !filterRegex.test(path)) continue;

      const outputPath = join(outputDir, options.preserveStructure !== false ? path : basename(path));

      // Check overwrite
      if (!options.overwrite && existsSync(outputPath)) {
        continue;
      }

      // Create directory
      const dir = dirname(outputPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Extract file
      const content = await file.async('nodebuffer');
      writeFileSync(outputPath, content);
      extractedFiles.push(outputPath);
    }

    return extractedFiles;
  }

  private async createZip(
    outputPath: string,
    files: Array<{ path: string; fullPath: string }>,
    options: Partial<ArchiveCreateOptions>
  ): Promise<void> {
    if (!this.jszip) {
      throw new Error('jszip library required');
    }

    const zip = new this.jszip();

    for (const { path, fullPath } of files) {
      const content = readFileSync(fullPath);
      zip.file(path, content, {
        compression: 'DEFLATE',
        compressionOptions: { level: options.compressionLevel || 6 },
      });
    }

    const output = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: options.compressionLevel || 6 },
    });

    writeFileSync(outputPath, output);
  }

  // ============================================================================
  // TAR Operations
  // ============================================================================

  private async listTar(archivePath: string, gzipped: boolean): Promise<ArchiveEntry[]> {
    if (!this.tar) {
      throw new Error('tar library required. Install with: npm install tar');
    }

    const entries: ArchiveEntry[] = [];

    await this.tar.list({
      file: archivePath,
      gzip: gzipped,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onentry: (entry: any) => {
        entries.push({
          path: entry.path,
          name: basename(entry.path),
          size: entry.size,
          isDirectory: entry.type === 'Directory',
          modifiedDate: entry.mtime,
          permissions: entry.mode?.toString(8),
        });
      },
    });

    return entries;
  }

  private async extractTar(
    archivePath: string,
    outputDir: string,
    gzipped: boolean,
    options: Partial<ArchiveExtractOptions>
  ): Promise<string[]> {
    if (!this.tar) {
      throw new Error('tar library required');
    }

    const extractedFiles: string[] = [];
    const filterRegex = options.filterPatterns
      ? new RegExp(options.filterPatterns.map(p => p.replace(/\*/g, '.*')).join('|'))
      : null;

    await this.tar.extract({
      file: archivePath,
      cwd: outputDir,
      gzip: gzipped,
      filter: (path: string) => {
        if (filterRegex && !filterRegex.test(path)) return false;
        extractedFiles.push(join(outputDir, path));
        return true;
      },
      newer: !options.overwrite,
    });

    return extractedFiles;
  }

  private async createTar(
    outputPath: string,
    files: Array<{ path: string; fullPath: string }>,
    gzipped: boolean,
    _options: Partial<ArchiveCreateOptions>
  ): Promise<void> {
    if (!this.tar) {
      throw new Error('tar library required');
    }

    // Find common base directory
    const baseDirs = files.map(f => dirname(f.fullPath));
    const commonBase = this.findCommonBase(baseDirs);

    await this.tar.create(
      {
        file: outputPath,
        gzip: gzipped,
        cwd: commonBase,
        portable: true,
      },
      files.map(f => relative(commonBase, f.fullPath))
    );
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private detectFormat(filePath: string): ArchiveFormat {
    const name = basename(filePath).toLowerCase();

    if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) return 'tar.gz';
    if (name.endsWith('.tar.bz2')) return 'tar.bz2';
    if (name.endsWith('.tar')) return 'tar';
    if (name.endsWith('.zip')) return 'zip';
    if (name.endsWith('.7z')) return '7z';
    if (name.endsWith('.rar')) return 'rar';

    return 'zip'; // Default
  }

  private collectFiles(
    paths: string[],
    options: Partial<ArchiveCreateOptions>
  ): Array<{ path: string; fullPath: string }> {
    const files: Array<{ path: string; fullPath: string }> = [];
    const excludeRegex = options.excludePatterns
      ? new RegExp(options.excludePatterns.map(p => p.replace(/\*/g, '.*')).join('|'))
      : null;

    const collectDir = (dir: string, basePath: string = '') => {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = basePath ? join(basePath, entry.name) : entry.name;

        // Skip hidden files unless included
        if (!options.includeHidden && entry.name.startsWith('.')) continue;

        // Skip excluded patterns
        if (excludeRegex && excludeRegex.test(relativePath)) continue;

        if (entry.isDirectory()) {
          collectDir(fullPath, relativePath);
        } else {
          files.push({ path: relativePath, fullPath });
        }
      }
    };

    for (const path of paths) {
      if (!existsSync(path)) continue;

      const stats = statSync(path);
      if (stats.isDirectory()) {
        collectDir(path, basename(path));
      } else {
        files.push({ path: basename(path), fullPath: path });
      }
    }

    return files;
  }

  private findCommonBase(paths: string[]): string {
    if (paths.length === 0) return process.cwd();
    if (paths.length === 1) return paths[0];

    const parts = paths.map(p => p.split('/'));
    const common: string[] = [];

    for (let i = 0; i < parts[0].length; i++) {
      const part = parts[0][i];
      if (parts.every(p => p[i] === part)) {
        common.push(part);
      } else {
        break;
      }
    }

    return common.join('/') || '/';
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  private formatEntryList(entries: ArchiveEntry[]): string {
    const lines: string[] = [
      'Archive Contents:',
      '─'.repeat(70),
      'Size'.padEnd(12) + 'Modified'.padEnd(22) + 'Name',
      '─'.repeat(70),
    ];

    for (const entry of entries.slice(0, 50)) {
      const size = entry.isDirectory ? '<DIR>' : this.formatSize(entry.size);
      const date = entry.modifiedDate
        ? new Date(entry.modifiedDate).toISOString().slice(0, 19)
        : '-'.repeat(19);
      lines.push(`${size.padEnd(12)}${date.padEnd(22)}${entry.path}`);
    }

    if (entries.length > 50) {
      lines.push(`... and ${entries.length - 50} more entries`);
    }

    return lines.join('\n');
  }

  private formatArchiveInfo(
    info: ArchiveInfo,
    compressionRatio: string,
    files: number,
    directories: number
  ): string {
    return [
      '┌─────────────────────────────────────────┐',
      '│          ARCHIVE INFORMATION            │',
      '├─────────────────────────────────────────┤',
      `│ File: ${info.filename.slice(0, 32).padEnd(32)}│`,
      `│ Format: ${info.format.toUpperCase().padEnd(30)}│`,
      `│ Compressed: ${this.formatSize(info.compressedSize).padEnd(26)}│`,
      `│ Uncompressed: ${this.formatSize(info.totalSize).padEnd(24)}│`,
      `│ Compression: ${(compressionRatio + '%').padEnd(25)}│`,
      `│ Files: ${String(files).padEnd(31)}│`,
      `│ Directories: ${String(directories).padEnd(25)}│`,
      '└─────────────────────────────────────────┘',
    ].join('\n');
  }
}

// ============================================================================
// Factory
// ============================================================================

let archiveAgentInstance: ArchiveAgent | null = null;

export function getArchiveAgent(): ArchiveAgent {
  if (!archiveAgentInstance) {
    archiveAgentInstance = new ArchiveAgent();
  }
  return archiveAgentInstance;
}

export async function createArchiveAgent(): Promise<ArchiveAgent> {
  const agent = getArchiveAgent();
  if (!agent.isReady()) {
    await agent.initialize();
  }
  return agent;
}
