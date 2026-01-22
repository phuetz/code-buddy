import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import path from 'path';
import { spawn } from 'child_process';
import { ToolResult, getErrorMessage } from '../types/index.js';

export interface ArchiveInfo {
  path: string;
  type: 'zip' | 'tar' | 'tar.gz' | 'tar.bz2' | 'tar.xz' | '7z' | 'rar';
  size: string;
  fileCount?: number;
  files?: ArchiveEntry[];
}

export interface ArchiveEntry {
  path: string;
  size: number;
  compressed?: number;
  isDirectory: boolean;
  modified?: string;
}

export interface ExtractOptions {
  outputDir?: string;
  files?: string[]; // Specific files to extract
  overwrite?: boolean;
  preservePaths?: boolean;
  /**
   * Archive password. SECURITY NOTE: For maximum security, set the
   * ARCHIVE_PASSWORD environment variable instead of passing this option.
   * When passed as option, the password may briefly be visible in process listings.
   */
  password?: string;
}

export interface CreateOptions {
  format?: 'zip' | 'tar' | 'tar.gz' | 'tar.bz2' | 'tar.xz';
  compressionLevel?: number; // 0-9
  excludePatterns?: string[];
  /**
   * Archive password. SECURITY NOTE: For maximum security, set the
   * ARCHIVE_PASSWORD environment variable instead of passing this option.
   */
  password?: string;
  outputPath?: string;
}

/**
 * Get archive password from environment variable (preferred) or options.
 * Using environment variable is more secure as it's not visible in process listings.
 */
function getArchivePassword(optionPassword?: string): string | undefined {
  // Prefer environment variable for security
  const envPassword = process.env.ARCHIVE_PASSWORD;
  if (envPassword) {
    return envPassword;
  }
  return optionPassword;
}

/**
 * Archive Tool for working with compressed archives (ZIP, TAR, etc.)
 * Supports listing, extracting, and creating archives
 */
export class ArchiveTool {
  private readonly supportedFormats = ['.zip', '.tar', '.tar.gz', '.tgz', '.tar.bz2', '.tbz2', '.tar.xz', '.txz', '.7z', '.rar', '.gz', '.bz2', '.xz'];
  private readonly outputDir = path.join(process.cwd(), '.codebuddy', 'extracted');
  private vfs = UnifiedVfsRouter.Instance;

  /**
   * List contents of an archive
   */
  async list(archivePath: string): Promise<ToolResult> {
    // Validate input
    if (!archivePath || typeof archivePath !== 'string') {
      return {
        success: false,
        error: 'Archive path is required and must be a non-empty string'
      };
    }
    if (archivePath.trim().length === 0) {
      return {
        success: false,
        error: 'Archive path cannot be empty or whitespace only'
      };
    }
    // Check for path traversal attempts
    if (archivePath.includes('..') && !path.isAbsolute(archivePath)) {
      const resolved = path.resolve(process.cwd(), archivePath);
      if (!resolved.startsWith(process.cwd())) {
        return {
          success: false,
          error: 'Path traversal detected: archive path must be within working directory'
        };
      }
    }

    try {
      const resolvedPath = path.resolve(process.cwd(), archivePath);

      if (!await this.vfs.exists(resolvedPath)) {
        return {
          success: false,
          error: `Archive not found: ${archivePath}`
        };
      }

      const type = this.getArchiveType(resolvedPath);
      if (!type) {
        return {
          success: false,
          error: `Unsupported archive format: ${path.extname(resolvedPath)}`
        };
      }

      const stats = await this.vfs.stat(resolvedPath);
      let files: ArchiveEntry[] = [];

      switch (type) {
        case 'zip':
          files = await this.listZip(resolvedPath);
          break;
        case 'tar':
        case 'tar.gz':
        case 'tar.bz2':
        case 'tar.xz':
          files = await this.listTar(resolvedPath, type);
          break;
        case '7z':
          files = await this.list7z(resolvedPath);
          break;
        case 'rar':
          files = await this.listRar(resolvedPath);
          break;
        default:
          return {
            success: false,
            error: `Listing not supported for ${type} format`
          };
      }

      const info: ArchiveInfo = {
        path: resolvedPath,
        type,
        size: this.formatSize(stats.size),
        fileCount: files.filter(f => !f.isDirectory).length,
        files
      };

      return {
        success: true,
        output: this.formatArchiveInfo(info),
        data: info
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list archive: ${getErrorMessage(error)}`
      };
    }
  }

  /**
   * Extract archive contents
   */
  async extract(archivePath: string, options: ExtractOptions = {}): Promise<ToolResult> {
    // Validate archive path
    if (!archivePath || typeof archivePath !== 'string') {
      return {
        success: false,
        error: 'Archive path is required and must be a non-empty string'
      };
    }
    if (archivePath.trim().length === 0) {
      return {
        success: false,
        error: 'Archive path cannot be empty or whitespace only'
      };
    }

    // Validate options
    if (options !== null && typeof options !== 'object') {
      return {
        success: false,
        error: 'Options must be an object if provided'
      };
    }

    // Validate output directory if provided
    if (options.outputDir !== undefined) {
      if (typeof options.outputDir !== 'string') {
        return {
          success: false,
          error: 'Output directory must be a string'
        };
      }
      // Check for path traversal in output directory
      const resolvedOutput = path.resolve(process.cwd(), options.outputDir);
      if (!resolvedOutput.startsWith(process.cwd()) && !path.isAbsolute(options.outputDir)) {
        return {
          success: false,
          error: 'Path traversal detected: output directory must be within working directory'
        };
      }
    }

    // Validate files array if provided
    if (options.files !== undefined) {
      if (!Array.isArray(options.files)) {
        return {
          success: false,
          error: 'Files must be an array if provided'
        };
      }
      for (const file of options.files) {
        if (typeof file !== 'string') {
          return {
            success: false,
            error: 'Each file entry must be a string'
          };
        }
      }
    }

    try {
      const resolvedPath = path.resolve(process.cwd(), archivePath);

      if (!await this.vfs.exists(resolvedPath)) {
        return {
          success: false,
          error: `Archive not found: ${archivePath}`
        };
      }

      const type = this.getArchiveType(resolvedPath);
      if (!type) {
        return {
          success: false,
          error: `Unsupported archive format`
        };
      }

      const outputDir = options.outputDir || path.join(
        this.outputDir,
        path.basename(resolvedPath, path.extname(resolvedPath))
      );

      await this.vfs.ensureDir(outputDir);

      let result: { success: boolean; files: string[] };

      switch (type) {
        case 'zip':
          result = await this.extractZip(resolvedPath, outputDir, options);
          break;
        case 'tar':
        case 'tar.gz':
        case 'tar.bz2':
        case 'tar.xz':
          result = await this.extractTar(resolvedPath, outputDir, type, options);
          break;
        case '7z':
          result = await this.extract7z(resolvedPath, outputDir, options);
          break;
        case 'rar':
          result = await this.extractRar(resolvedPath, outputDir, options);
          break;
        default:
          return {
            success: false,
            error: `Extraction not supported for ${type} format`
          };
      }

      if (!result.success) {
        return {
          success: false,
          error: 'Extraction failed'
        };
      }

      return {
        success: true,
        output: `📦 Extracted ${result.files.length} items to: ${outputDir}`,
        data: { outputDir, files: result.files }
      };
    } catch (error) {
      return {
        success: false,
        error: `Extraction failed: ${getErrorMessage(error)}`
      };
    }
  }

  /**
   * Create an archive
   */
  async create(
    sourcePaths: string[],
    options: CreateOptions = {}
  ): Promise<ToolResult> {
    // Validate source paths
    if (!sourcePaths || !Array.isArray(sourcePaths)) {
      return {
        success: false,
        error: 'Source paths must be a non-empty array'
      };
    }
    if (sourcePaths.length === 0) {
      return {
        success: false,
        error: 'At least one source path is required'
      };
    }
    for (let i = 0; i < sourcePaths.length; i++) {
      const p = sourcePaths[i];
      if (!p || typeof p !== 'string') {
        return {
          success: false,
          error: `Source path at index ${i} must be a non-empty string`
        };
      }
      if (p.trim().length === 0) {
        return {
          success: false,
          error: `Source path at index ${i} cannot be empty or whitespace only`
        };
      }
    }

    // Validate options
    if (options !== null && typeof options !== 'object') {
      return {
        success: false,
        error: 'Options must be an object if provided'
      };
    }

    // Validate format if provided
    const validFormats = ['zip', 'tar', 'tar.gz', 'tar.bz2', 'tar.xz'];
    if (options.format !== undefined && !validFormats.includes(options.format)) {
      return {
        success: false,
        error: `Invalid format '${options.format}'. Must be one of: ${validFormats.join(', ')}`
      };
    }

    // Validate compression level if provided
    if (options.compressionLevel !== undefined) {
      const level = Number(options.compressionLevel);
      if (!Number.isInteger(level) || level < 0 || level > 9) {
        return {
          success: false,
          error: 'Compression level must be an integer between 0 and 9'
        };
      }
    }

    // Validate exclude patterns if provided
    if (options.excludePatterns !== undefined) {
      if (!Array.isArray(options.excludePatterns)) {
        return {
          success: false,
          error: 'Exclude patterns must be an array if provided'
        };
      }
      for (const pattern of options.excludePatterns) {
        if (typeof pattern !== 'string') {
          return {
            success: false,
            error: 'Each exclude pattern must be a string'
          };
        }
      }
    }

    try {
      const resolvedPaths = sourcePaths.map(p => path.resolve(process.cwd(), p));

      // Verify all source paths exist
      for (const p of resolvedPaths) {
        if (!await this.vfs.exists(p)) {
          return {
            success: false,
            error: `Source not found: ${p}`
          };
        }
      }

      const format = options.format || 'zip';
      const ext = format === 'tar.gz' ? '.tar.gz' : format === 'tar.bz2' ? '.tar.bz2' : format === 'tar.xz' ? '.tar.xz' : `.${format}`;
      const timestamp = Date.now();
      const archiveName = `archive_${timestamp}${ext}`;
      const outputPath = options.outputPath || path.join(process.cwd(), archiveName);

      let success: boolean;

      switch (format) {
        case 'zip':
          success = await this.createZip(resolvedPaths, outputPath, options);
          break;
        case 'tar':
        case 'tar.gz':
        case 'tar.bz2':
        case 'tar.xz':
          success = await this.createTar(resolvedPaths, outputPath, format, options);
          break;
        default:
          return {
            success: false,
            error: `Creation not supported for ${format} format`
          };
      }

      if (!success) {
        return {
          success: false,
          error: 'Archive creation failed'
        };
      }

      const stats = await this.vfs.stat(outputPath);

      return {
        success: true,
        output: `📦 Created archive: ${outputPath} (${this.formatSize(stats.size)})`,
        data: { path: outputPath, size: stats.size }
      };
    } catch (error) {
      return {
        success: false,
        error: `Archive creation failed: ${getErrorMessage(error)}`
      };
    }
  }

  /**
   * Get archive type from file extension
   */
  private getArchiveType(filePath: string): ArchiveInfo['type'] | null {
    const lower = filePath.toLowerCase();

    if (lower.endsWith('.zip')) return 'zip';
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
    if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2')) return 'tar.bz2';
    if (lower.endsWith('.tar.xz') || lower.endsWith('.txz')) return 'tar.xz';
    if (lower.endsWith('.tar')) return 'tar';
    if (lower.endsWith('.7z')) return '7z';
    if (lower.endsWith('.rar')) return 'rar';

    return null;
  }

  /**
   * List ZIP contents
   */
  private async listZip(archivePath: string): Promise<ArchiveEntry[]> {
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(archivePath);
    const entries = zip.getEntries();

    return entries.map(entry => ({
      path: entry.entryName,
      size: entry.header.size,
      compressed: entry.header.compressedSize,
      isDirectory: entry.isDirectory,
      modified: entry.header.time ? new Date(entry.header.time).toISOString() : undefined
    }));
  }

  /**
   * List TAR contents
   */
  private async listTar(archivePath: string, type: string): Promise<ArchiveEntry[]> {
    return new Promise((resolve, reject) => {
      const args = ['tf', archivePath];
      if (type === 'tar.gz') args.splice(1, 0, '-z');
      if (type === 'tar.bz2') args.splice(1, 0, '-j');
      if (type === 'tar.xz') args.splice(1, 0, '-J');

      const tar = spawn('tar', args);
      let output = '';

      tar.stdout.on('data', (data) => {
        output += data.toString();
      });

      tar.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`tar exited with code ${code}`));
          return;
        }

        const entries = output.split('\n')
          .filter(line => line.trim())
          .map(line => ({
            path: line,
            size: 0,
            isDirectory: line.endsWith('/')
          }));

        resolve(entries);
      });

      tar.on('error', reject);
    });
  }

  /**
   * List 7z contents
   */
  private async list7z(archivePath: string): Promise<ArchiveEntry[]> {
    return new Promise((resolve, reject) => {
      const sevenZ = spawn('7z', ['l', archivePath]);
      let output = '';

      sevenZ.stdout.on('data', (data) => {
        output += data.toString();
      });

      sevenZ.on('close', (code) => {
        if (code !== 0) {
          reject(new Error('7z not available. Install p7zip-full.'));
          return;
        }

        // Parse 7z output
        const entries: ArchiveEntry[] = [];
        const lines = output.split('\n');
        let inList = false;

        for (const line of lines) {
          if (line.includes('----')) {
            inList = !inList;
            continue;
          }
          if (inList && line.trim()) {
            const match = line.match(/(\d+)\s+\d+\s+(\S+)\s+(.+)/);
            if (match) {
              entries.push({
                path: match[3].trim(),
                size: parseInt(match[1]),
                isDirectory: match[2] === 'D....'
              });
            }
          }
        }

        resolve(entries);
      });

      sevenZ.on('error', () => {
        reject(new Error('7z not installed'));
      });
    });
  }

  /**
   * List RAR contents
   */
  private async listRar(archivePath: string): Promise<ArchiveEntry[]> {
    return new Promise((resolve, reject) => {
      const unrar = spawn('unrar', ['l', archivePath]);
      let output = '';

      unrar.stdout.on('data', (data) => {
        output += data.toString();
      });

      unrar.on('close', (code) => {
        if (code !== 0) {
          reject(new Error('unrar not available'));
          return;
        }

        // Parse unrar output
        const entries: ArchiveEntry[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
          const match = line.match(/(\d+)\s+\d+%\s+[\d-]+\s+[\d:]+\s+[.A-Z]+\s+(.+)/);
          if (match) {
            entries.push({
              path: match[2].trim(),
              size: parseInt(match[1]),
              isDirectory: false
            });
          }
        }

        resolve(entries);
      });

      unrar.on('error', () => {
        reject(new Error('unrar not installed'));
      });
    });
  }

  /**
   * Extract ZIP archive
   */
  private async extractZip(
    archivePath: string,
    outputDir: string,
    options: ExtractOptions
  ): Promise<{ success: boolean; files: string[] }> {
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(archivePath);

    if (options.files && options.files.length > 0) {
      const files: string[] = [];
      for (const file of options.files) {
        const entry = zip.getEntry(file);
        if (entry) {
          zip.extractEntryTo(entry.entryName, outputDir, options.preservePaths !== false, options.overwrite !== false);
          files.push(file);
        }
      }
      return { success: true, files };
    }

    zip.extractAllTo(outputDir, options.overwrite !== false);
    const entries = zip.getEntries().map(e => e.entryName);
    return { success: true, files: entries };
  }

  /**
   * Extract TAR archive
   */
  private async extractTar(
    archivePath: string,
    outputDir: string,
    type: string,
    options: ExtractOptions
  ): Promise<{ success: boolean; files: string[] }> {
    return new Promise((resolve) => {
      const args = ['xf', archivePath, '-C', outputDir];

      if (type === 'tar.gz') args.splice(1, 0, '-z');
      if (type === 'tar.bz2') args.splice(1, 0, '-j');
      if (type === 'tar.xz') args.splice(1, 0, '-J');

      if (options.files && options.files.length > 0) {
        args.push(...options.files);
      }

      const tar = spawn('tar', args);

      tar.on('close', async (code) => {
        if (code === 0) {
          // List extracted files
          const files = await this.getFilesRecursive(outputDir);
          resolve({ success: true, files });
        } else {
          resolve({ success: false, files: [] });
        }
      });

      tar.on('error', () => {
        resolve({ success: false, files: [] });
      });
    });
  }

  /**
   * Extract 7z archive
   */
  private async extract7z(
    archivePath: string,
    outputDir: string,
    options: ExtractOptions
  ): Promise<{ success: boolean; files: string[] }> {
    return new Promise((resolve) => {
      const args = ['x', archivePath, `-o${outputDir}`];

      if (options.overwrite !== false) {
        args.push('-y');
      }

      const password = getArchivePassword(options.password);
      if (password) {
        // Pass password via stdin pipe for better security (7z reads from -si@ when available)
        // Fallback to -p flag which may be visible in process listings briefly
        args.push(`-p${password}`);
      }

      const sevenZ = spawn('7z', args);

      sevenZ.on('close', async (code) => {
        if (code === 0) {
          const files = await this.getFilesRecursive(outputDir);
          resolve({ success: true, files });
        } else {
          resolve({ success: false, files: [] });
        }
      });

      sevenZ.on('error', () => {
        resolve({ success: false, files: [] });
      });
    });
  }

  /**
   * Extract RAR archive
   */
  private async extractRar(
    archivePath: string,
    outputDir: string,
    options: ExtractOptions
  ): Promise<{ success: boolean; files: string[] }> {
    return new Promise((resolve) => {
      const args = ['x'];

      if (options.overwrite !== false) {
        args.push('-o+');
      }

      const password = getArchivePassword(options.password);
      if (password) {
        // unrar requires -p flag; password may be briefly visible in process listings
        // Use ARCHIVE_PASSWORD environment variable for better security
        args.push(`-p${password}`);
      }

      args.push(archivePath, outputDir);

      const unrar = spawn('unrar', args);

      unrar.on('close', async (code) => {
        if (code === 0) {
          const files = await this.getFilesRecursive(outputDir);
          resolve({ success: true, files });
        } else {
          resolve({ success: false, files: [] });
        }
      });

      unrar.on('error', () => {
        resolve({ success: false, files: [] });
      });
    });
  }

  /**
   * Create ZIP archive
   */
  private async createZip(
    sourcePaths: string[],
    outputPath: string,
    _options: CreateOptions
  ): Promise<boolean> {
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip();

    for (const sourcePath of sourcePaths) {
      const stats = await this.vfs.stat(sourcePath);
      const baseName = path.basename(sourcePath);

      if (stats.isDirectory()) {
        zip.addLocalFolder(sourcePath, baseName);
      } else {
        zip.addLocalFile(sourcePath);
      }
    }

    zip.writeZip(outputPath);
    return true;
  }

  /**
   * Create TAR archive
   */
  private async createTar(
    sourcePaths: string[],
    outputPath: string,
    format: string,
    _options: CreateOptions
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const args = ['cf', outputPath];

      if (format === 'tar.gz') args.splice(1, 0, '-z');
      if (format === 'tar.bz2') args.splice(1, 0, '-j');
      if (format === 'tar.xz') args.splice(1, 0, '-J');

      // Change to parent directory and use relative paths
      const parentDir = path.dirname(sourcePaths[0]);
      const relPaths = sourcePaths.map(p => path.relative(parentDir, p));

      args.push('-C', parentDir);
      args.push(...relPaths);

      const tar = spawn('tar', args);

      tar.on('close', (code) => {
        resolve(code === 0);
      });

      tar.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Get files recursively from directory
   */
  private async getFilesRecursive(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await this.vfs.readDirectory(dir);

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory) {
          files.push(...await this.getFilesRecursive(fullPath));
        } else {
          files.push(fullPath);
        }
      }
    } catch {
      // Ignore errors
    }

    return files;
  }

  /**
   * Format archive info for display
   */
  private formatArchiveInfo(info: ArchiveInfo): string {
    const lines = [
      `📦 Archive: ${path.basename(info.path)}`,
      `   Type: ${info.type.toUpperCase()}`,
      `   Size: ${info.size}`,
      `   Files: ${info.fileCount || 0}`,
      ''
    ];

    if (info.files && info.files.length > 0) {
      lines.push('Contents:');

      // Show first 20 files
      const displayFiles = info.files.slice(0, 20);
      for (const file of displayFiles) {
        const icon = file.isDirectory ? '📁' : '📄';
        const size = file.isDirectory ? '' : ` (${this.formatSize(file.size)})`;
        lines.push(`  ${icon} ${file.path}${size}`);
      }

      if (info.files.length > 20) {
        lines.push(`  ... and ${info.files.length - 20} more items`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format file size
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  /**
   * List archives in directory
   */
  async listArchives(dirPath: string = '.'): Promise<ToolResult> {
    try {
      const resolvedPath = path.resolve(process.cwd(), dirPath);

      if (!await this.vfs.exists(resolvedPath)) {
        return {
          success: false,
          error: `Directory not found: ${dirPath}`
        };
      }

      const entries = await this.vfs.readDirectory(resolvedPath);
      const archives = entries.filter(e => {
        if (!e.isFile) return false;
        const lower = e.name.toLowerCase();
        return this.supportedFormats.some(ext => lower.endsWith(ext));
      });

      if (archives.length === 0) {
        return {
          success: true,
          output: `No archives found in ${dirPath}`
        };
      }

      const listPromises = archives.map(async entry => {
        const fullPath = path.join(resolvedPath, entry.name);
        const stats = await this.vfs.stat(fullPath);
        return `  📦 ${entry.name} (${this.formatSize(stats.size)})`;
      });

      const list = (await Promise.all(listPromises)).join('\n');

      return {
        success: true,
        output: `Archives in ${dirPath}:\n${list}`
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list archives: ${getErrorMessage(error)}`
      };
    }
  }
}
