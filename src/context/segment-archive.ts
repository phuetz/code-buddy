import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import type { CodeBuddyMessage } from '../codebuddy/client.js';
import { logger } from '../utils/logger.js';

const DEFAULT_MAX_MB = 200;
const SUMMARY_PREVIEW_CHARS = 500;
const SAFE_PATH_COMPONENT = /^[a-zA-Z0-9._-]+$/;

export class SegmentIntegrityError extends Error {
  readonly segmentId: string;

  constructor(segmentId: string, message?: string) {
    super(
      message ??
        `Context segment "${segmentId}" failed integrity check: ` +
          'stored content hash does not match the identifier. ' +
          'Refusing to inject unverified content.',
    );
    this.name = 'SegmentIntegrityError';
    this.segmentId = segmentId;
  }
}

export function hashArchivedMessages(messages: CodeBuddyMessage[]): string {
  return createHash('sha256')
    .update(JSON.stringify(messages))
    .digest('hex')
    .slice(0, 16);
}

export interface ArchivedSegment {
  segmentId: string;
  sessionId: string;
  ts: string;
  messages: CodeBuddyMessage[];
  tokenEstimate: number;
  summaryPreview: string;
}

export function isContextZoomEnabled(): boolean {
  return process.env.CODEBUDDY_CONTEXT_ZOOM === 'true';
}

/**
 * Durable, per-session storage for messages removed by context compaction.
 * Production data is always rooted below ~/.codebuddy/context-archive.
 */
export class SegmentArchive {
  private readonly archiveRoot: string;
  private readonly renameFile: typeof fs.renameSync;

  constructor(
    homeDirectory: string = homedir(),
    renameFile: typeof fs.renameSync = fs.renameSync,
  ) {
    this.archiveRoot = path.join(homeDirectory, '.codebuddy', 'context-archive');
    this.renameFile = renameFile;
  }

  archive(
    sessionId: string,
    messages: CodeBuddyMessage[],
    summary: string,
  ): string | null {
    let temporaryPath: string | null = null;
    try {
      if (!this.isSafeComponent(sessionId) || messages.length === 0) {
        logger.warn('Context segment archive rejected invalid input', {
          sessionId,
          messageCount: messages.length,
        });
        return null;
      }

      const serializedMessages = JSON.stringify(messages);
      const segmentId = hashArchivedMessages(messages);
      const sessionDirectory = this.sessionDirectory(sessionId);
      const destination = path.join(sessionDirectory, `${segmentId}.json`);

      fs.mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 });

      if (fs.existsSync(destination) && this.existingRecordIsReusable(destination, sessionId, segmentId)) {
        const now = new Date();
        fs.utimesSync(destination, now, now);
        this.purgeLru(sessionDirectory);
        return fs.existsSync(destination) ? segmentId : null;
      }

      const record: ArchivedSegment = {
        segmentId,
        sessionId,
        ts: new Date().toISOString(),
        messages,
        tokenEstimate: Math.ceil(serializedMessages.length / 4),
        summaryPreview: summary.slice(0, SUMMARY_PREVIEW_CHARS),
      };
      const payload = `${JSON.stringify(record, null, 2)}\n`;
      temporaryPath = path.join(
        sessionDirectory,
        `.${segmentId}.${process.pid}.${createHash('sha256').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 8)}.tmp`,
      );

      fs.writeFileSync(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 });
      this.renameFile(temporaryPath, destination);
      temporaryPath = null;
      this.purgeLru(sessionDirectory);
      return fs.existsSync(destination) ? segmentId : null;
    } catch (error) {
      if (temporaryPath) {
        try {
          fs.rmSync(temporaryPath, { force: true });
        } catch {
          // Best-effort cleanup: the primary archive failure is logged below.
        }
      }
      logger.warn('Failed to archive compacted context segment', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  get(sessionId: string, segmentId: string): ArchivedSegment | null {
    try {
      if (!this.isSafeComponent(sessionId) || !this.isSafeComponent(segmentId)) {
        return null;
      }
      const filePath = path.join(this.sessionDirectory(sessionId), `${segmentId}.json`);
      const record = this.readRecord(filePath);
      if (!record || record.sessionId !== sessionId || record.segmentId !== segmentId) {
        return null;
      }
      this.assertRecordIntegrity(record, segmentId);
      const now = new Date();
      fs.utimesSync(filePath, now, now);
      return record;
    } catch (error) {
      if (error instanceof SegmentIntegrityError) throw error;
      logger.warn('Failed to read context segment archive', {
        sessionId,
        segmentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  list(sessionId: string): ArchivedSegment[] {
    try {
      if (!this.isSafeComponent(sessionId)) return [];
      const sessionDirectory = this.sessionDirectory(sessionId);
      if (!fs.existsSync(sessionDirectory)) return [];

      return fs.readdirSync(sessionDirectory, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .map(entry => this.readRecord(path.join(sessionDirectory, entry.name)))
        .filter((record): record is ArchivedSegment => record !== null && record.sessionId === sessionId)
        .sort((left, right) => right.ts.localeCompare(left.ts));
    } catch (error) {
      logger.warn('Failed to list context segment archive', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private sessionDirectory(sessionId: string): string {
    return path.join(this.archiveRoot, sessionId);
  }

  private isSafeComponent(value: string): boolean {
    return value.length > 0 && value.length <= 200 && SAFE_PATH_COMPONENT.test(value);
  }

  private readRecord(filePath: string): ArchivedSegment | null {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!this.isArchivedSegment(parsed)) return null;
    return parsed;
  }

  private isArchivedSegment(value: unknown): value is ArchivedSegment {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (
      typeof record.segmentId === 'string' &&
      typeof record.sessionId === 'string' &&
      typeof record.ts === 'string' &&
      Array.isArray(record.messages) &&
      typeof record.tokenEstimate === 'number' &&
      typeof record.summaryPreview === 'string'
    );
  }

  private existingRecordIsReusable(
    destination: string,
    sessionId: string,
    segmentId: string,
  ): boolean {
    try {
      const existing = this.readRecord(destination);
      if (!existing || existing.sessionId !== sessionId || existing.segmentId !== segmentId) {
        return false;
      }
      this.assertRecordIntegrity(existing, segmentId);
      return true;
    } catch {
      return false;
    }
  }

  private assertRecordIntegrity(record: ArchivedSegment, segmentId: string): void {
    const contentHash = hashArchivedMessages(record.messages);
    if (contentHash !== segmentId || contentHash !== record.segmentId) {
      throw new SegmentIntegrityError(segmentId);
    }
  }

  private maxBytes(): number {
    const configured = Number(process.env.CODEBUDDY_CONTEXT_ZOOM_MAX_MB);
    const maxMb = Number.isFinite(configured) && configured >= 0
      ? configured
      : DEFAULT_MAX_MB;
    return Math.floor(maxMb * 1024 * 1024);
  }

  private purgeLru(sessionDirectory: string): void {
    try {
      const files = fs.readdirSync(sessionDirectory, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .map(entry => {
          const filePath = path.join(sessionDirectory, entry.name);
          const stats = fs.statSync(filePath);
          return { filePath, size: stats.size, lastUsed: stats.mtimeMs };
        });
      let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes <= this.maxBytes()) return;

      files.sort((left, right) => left.lastUsed - right.lastUsed);
      for (const file of files) {
        if (totalBytes <= this.maxBytes()) break;
        fs.rmSync(file.filePath, { force: true });
        totalBytes -= file.size;
      }
    } catch (error) {
      logger.warn('Failed to purge context segment archive', {
        sessionDirectory,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
