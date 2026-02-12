import { existsSync, statSync, mkdirSync, unlinkSync, copyFileSync } from 'fs';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

export type MediaType = 'image' | 'audio' | 'video' | 'document' | 'unknown';

export interface MediaFile {
  id: string;
  originalPath: string;
  tempPath: string;
  type: MediaType;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
  metadata: Record<string, unknown>;
}

export interface MediaPipelineConfig {
  tempDir: string;
  maxFileSizeMb: number;
  maxTotalSizeMb: number;
  autoCleanupMs: number;
  allowedTypes: MediaType[];
}

export interface TranscriptionHook {
  name: string;
  mediaTypes: MediaType[];
  process: (file: MediaFile) => Promise<string | null>;
}

const DEFAULT_CONFIG: MediaPipelineConfig = {
  tempDir: '.codebuddy/media/tmp',
  maxFileSizeMb: 25,
  maxTotalSizeMb: 100,
  autoCleanupMs: 3600000,
  allowedTypes: ['image', 'audio', 'video', 'document', 'unknown'],
};

const EXTENSION_TYPE_MAP: Record<string, MediaType> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.svg': 'image',
  '.bmp': 'image',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.ogg': 'audio',
  '.flac': 'audio',
  '.m4a': 'audio',
  '.aac': 'audio',
  '.mp4': 'video',
  '.mkv': 'video',
  '.avi': 'video',
  '.mov': 'video',
  '.webm': 'video',
  '.pdf': 'document',
  '.doc': 'document',
  '.docx': 'document',
  '.txt': 'document',
  '.md': 'document',
};

const EXTENSION_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
};

export class MediaPipeline extends EventEmitter {
  private config: MediaPipelineConfig;
  private files: Map<string, MediaFile> = new Map();
  private hooks: TranscriptionHook[] = [];
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private totalSize: number = 0;

  constructor(config?: Partial<MediaPipelineConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (!existsSync(this.config.tempDir)) {
      mkdirSync(this.config.tempDir, { recursive: true });
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.autoCleanupMs);
  }

  async ingest(filePath: string): Promise<MediaFile | { error: string }> {
    if (!existsSync(filePath)) {
      return { error: `File not found: ${filePath}` };
    }

    const stat = statSync(filePath);
    const sizeMb = stat.size / (1024 * 1024);

    if (sizeMb > this.config.maxFileSizeMb) {
      return { error: `File size ${sizeMb.toFixed(2)}MB exceeds limit of ${this.config.maxFileSizeMb}MB` };
    }

    const newTotalMb = (this.totalSize + stat.size) / (1024 * 1024);
    if (newTotalMb > this.config.maxTotalSizeMb) {
      return { error: `Total size would exceed limit of ${this.config.maxTotalSizeMb}MB` };
    }

    const type = MediaPipeline.detectType(filePath);
    if (!this.config.allowedTypes.includes(type)) {
      return { error: `Media type '${type}' is not allowed` };
    }

    const id = randomUUID();
    const ext = extname(filePath);
    const tempPath = join(this.config.tempDir, `${id}${ext}`);

    copyFileSync(filePath, tempPath);

    const mediaFile: MediaFile = {
      id,
      originalPath: filePath,
      tempPath,
      type,
      mimeType: MediaPipeline.detectMimeType(filePath),
      sizeBytes: stat.size,
      createdAt: Date.now(),
      metadata: {},
    };

    this.files.set(id, mediaFile);
    this.totalSize += stat.size;
    this.emit('ingested', mediaFile);

    return mediaFile;
  }

  get(id: string): MediaFile | undefined {
    return this.files.get(id);
  }

  list(type?: MediaType): MediaFile[] {
    const all = Array.from(this.files.values());
    if (type) {
      return all.filter(f => f.type === type);
    }
    return all;
  }

  remove(id: string): boolean {
    const file = this.files.get(id);
    if (!file) return false;

    if (existsSync(file.tempPath)) {
      unlinkSync(file.tempPath);
    }

    this.totalSize -= file.sizeBytes;
    this.files.delete(id);
    this.emit('removed', id);
    return true;
  }

  registerHook(hook: TranscriptionHook): void {
    this.hooks.push(hook);
  }

  async processHooks(id: string): Promise<string[]> {
    const file = this.files.get(id);
    if (!file) return [];

    const results: string[] = [];
    for (const hook of this.hooks) {
      if (hook.mediaTypes.includes(file.type)) {
        const result = await hook.process(file);
        if (result !== null) {
          results.push(result);
        }
      }
    }
    return results;
  }

  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    const toDelete: string[] = [];
    for (const [id, file] of this.files) {
      if (now - file.createdAt > this.config.autoCleanupMs) {
        if (existsSync(file.tempPath)) {
          unlinkSync(file.tempPath);
        }
        this.totalSize -= file.sizeBytes;
        toDelete.push(id);
        removed++;
      }
    }
    for (const id of toDelete) {
      this.files.delete(id);
    }

    if (removed > 0) {
      this.emit('cleanup', removed);
    }
    return removed;
  }

  getTotalSize(): number {
    return this.totalSize;
  }

  static detectType(filePath: string): MediaType {
    const ext = extname(filePath).toLowerCase();
    return EXTENSION_TYPE_MAP[ext] ?? 'unknown';
  }

  static detectMimeType(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    return EXTENSION_MIME_MAP[ext] ?? 'application/octet-stream';
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const [, file] of this.files) {
      if (existsSync(file.tempPath)) {
        unlinkSync(file.tempPath);
      }
    }

    this.files.clear();
    this.totalSize = 0;
    this.removeAllListeners();
  }
}
