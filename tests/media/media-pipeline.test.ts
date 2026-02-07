import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { MediaPipeline, MediaFile, MediaType } from '../../src/media/media-pipeline.js';

const TEST_DIR = join(__dirname, '__test-tmp__');
const TEMP_DIR = join(TEST_DIR, 'pipeline-tmp');

function createTestFile(name: string, sizeBytes: number = 100): string {
  const filePath = join(TEST_DIR, name);
  writeFileSync(filePath, Buffer.alloc(sizeBytes, 'x'));
  return filePath;
}

describe('MediaPipeline', () => {
  let pipeline: MediaPipeline;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    pipeline = new MediaPipeline({
      tempDir: TEMP_DIR,
      maxFileSizeMb: 1,
      maxTotalSizeMb: 2,
      autoCleanupMs: 60000,
    });
  });

  afterEach(() => {
    pipeline.dispose();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('detectType', () => {
    it.each<[string, MediaType]>([
      ['/foo/bar.png', 'image'],
      ['/foo/bar.jpg', 'image'],
      ['/foo/bar.jpeg', 'image'],
      ['/foo/bar.gif', 'image'],
      ['/foo/bar.webp', 'image'],
      ['/foo/bar.svg', 'image'],
      ['/foo/bar.bmp', 'image'],
      ['/foo/bar.mp3', 'audio'],
      ['/foo/bar.wav', 'audio'],
      ['/foo/bar.ogg', 'audio'],
      ['/foo/bar.flac', 'audio'],
      ['/foo/bar.m4a', 'audio'],
      ['/foo/bar.aac', 'audio'],
      ['/foo/bar.mp4', 'video'],
      ['/foo/bar.mkv', 'video'],
      ['/foo/bar.avi', 'video'],
      ['/foo/bar.mov', 'video'],
      ['/foo/bar.webm', 'video'],
      ['/foo/bar.pdf', 'document'],
      ['/foo/bar.doc', 'document'],
      ['/foo/bar.docx', 'document'],
      ['/foo/bar.txt', 'document'],
      ['/foo/bar.md', 'document'],
      ['/foo/bar.xyz', 'unknown'],
    ])('should detect %s as %s', (path, expected) => {
      expect(MediaPipeline.detectType(path)).toBe(expected);
    });
  });

  describe('detectMimeType', () => {
    it.each([
      ['/foo/bar.png', 'image/png'],
      ['/foo/bar.jpg', 'image/jpeg'],
      ['/foo/bar.mp3', 'audio/mpeg'],
      ['/foo/bar.mp4', 'video/mp4'],
      ['/foo/bar.pdf', 'application/pdf'],
      ['/foo/bar.xyz', 'application/octet-stream'],
    ])('should detect %s as %s', (path, expected) => {
      expect(MediaPipeline.detectMimeType(path)).toBe(expected);
    });
  });

  describe('ingest', () => {
    it('should copy file to temp dir and return MediaFile', async () => {
      const src = createTestFile('test.png', 200);
      const result = await pipeline.ingest(src);

      expect('id' in result).toBe(true);
      const file = result as MediaFile;
      expect(file.type).toBe('image');
      expect(file.mimeType).toBe('image/png');
      expect(file.sizeBytes).toBe(200);
      expect(existsSync(file.tempPath)).toBe(true);
    });

    it('should reject non-existent file', async () => {
      const result = await pipeline.ingest('/no/such/file.png');
      expect('error' in result).toBe(true);
    });

    it('should reject files over size limit', async () => {
      const src = createTestFile('big.png', 2 * 1024 * 1024);
      const result = await pipeline.ingest(src);
      expect('error' in result).toBe(true);
      expect((result as { error: string }).error).toContain('exceeds limit');
    });

    it('should reject when total size exceeded', async () => {
      const src1 = createTestFile('a.png', 1024 * 1024);
      const src2 = createTestFile('b.png', 1024 * 1024);
      const src3 = createTestFile('c.png', 1024 * 1024);

      await pipeline.ingest(src1);
      await pipeline.ingest(src2);
      const result = await pipeline.ingest(src3);
      expect('error' in result).toBe(true);
      expect((result as { error: string }).error).toContain('Total size');
    });

    it('should emit ingested event', async () => {
      const src = createTestFile('test.wav', 100);
      const handler = jest.fn();
      pipeline.on('ingested', handler);

      await pipeline.ingest(src);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].type).toBe('audio');
    });
  });

  describe('get', () => {
    it('should return file by ID', async () => {
      const src = createTestFile('test.txt', 50);
      const result = await pipeline.ingest(src) as MediaFile;
      expect(pipeline.get(result.id)).toBeDefined();
      expect(pipeline.get(result.id)!.id).toBe(result.id);
    });

    it('should return undefined for unknown ID', () => {
      expect(pipeline.get('nonexistent')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should return all files', async () => {
      await pipeline.ingest(createTestFile('a.png', 50));
      await pipeline.ingest(createTestFile('b.mp3', 50));
      expect(pipeline.list()).toHaveLength(2);
    });

    it('should filter by type', async () => {
      await pipeline.ingest(createTestFile('a.png', 50));
      await pipeline.ingest(createTestFile('b.mp3', 50));
      expect(pipeline.list('image')).toHaveLength(1);
      expect(pipeline.list('audio')).toHaveLength(1);
      expect(pipeline.list('video')).toHaveLength(0);
    });
  });

  describe('remove', () => {
    it('should delete file and update tracking', async () => {
      const src = createTestFile('test.png', 50);
      const file = await pipeline.ingest(src) as MediaFile;

      expect(pipeline.remove(file.id)).toBe(true);
      expect(pipeline.get(file.id)).toBeUndefined();
      expect(existsSync(file.tempPath)).toBe(false);
      expect(pipeline.getTotalSize()).toBe(0);
    });

    it('should return false for unknown ID', () => {
      expect(pipeline.remove('nonexistent')).toBe(false);
    });
  });

  describe('hooks', () => {
    it('should register and run matching hooks', async () => {
      const src = createTestFile('test.mp3', 50);
      const file = await pipeline.ingest(src) as MediaFile;

      pipeline.registerHook({
        name: 'audio-transcriber',
        mediaTypes: ['audio'],
        process: async () => 'transcribed audio',
      });

      pipeline.registerHook({
        name: 'image-ocr',
        mediaTypes: ['image'],
        process: async () => 'ocr text',
      });

      const results = await pipeline.processHooks(file.id);
      expect(results).toEqual(['transcribed audio']);
    });

    it('should return empty for unknown file', async () => {
      const results = await pipeline.processHooks('nonexistent');
      expect(results).toEqual([]);
    });

    it('should skip hooks returning null', async () => {
      const src = createTestFile('test.png', 50);
      const file = await pipeline.ingest(src) as MediaFile;

      pipeline.registerHook({
        name: 'nullable',
        mediaTypes: ['image'],
        process: async () => null,
      });

      const results = await pipeline.processHooks(file.id);
      expect(results).toEqual([]);
    });
  });

  describe('cleanup', () => {
    it('should remove expired files', async () => {
      const src = createTestFile('old.png', 50);
      const file = await pipeline.ingest(src) as MediaFile;

      // Manually backdate
      file.createdAt = Date.now() - 120000;

      const shortPipeline = new MediaPipeline({
        tempDir: TEMP_DIR,
        autoCleanupMs: 60000,
      });
      // Transfer file reference
      (shortPipeline as unknown as { files: Map<string, MediaFile> }).files.set(file.id, file);
      (shortPipeline as unknown as { totalSize: number }).totalSize = file.sizeBytes;

      const removed = shortPipeline.cleanup();
      expect(removed).toBe(1);
      shortPipeline.dispose();
    });
  });

  describe('dispose', () => {
    it('should clean everything', async () => {
      const src = createTestFile('test.png', 50);
      const file = await pipeline.ingest(src) as MediaFile;
      const tempPath = file.tempPath;

      pipeline.dispose();
      expect(existsSync(tempPath)).toBe(false);
      expect(pipeline.list()).toHaveLength(0);
      expect(pipeline.getTotalSize()).toBe(0);
    });
  });
});
