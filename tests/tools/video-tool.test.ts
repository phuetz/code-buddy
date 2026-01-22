import { VideoTool } from '../../src/tools/video-tool.js';
import { UnifiedVfsRouter } from '../../src/services/vfs/unified-vfs-router.js';
import { EventEmitter } from 'events';

// Define mocks inside the factory to avoid hoisting issues
jest.mock('../../src/services/vfs/unified-vfs-router.js', () => ({
  UnifiedVfsRouter: {
    Instance: {
      exists: jest.fn(),
      stat: jest.fn(),
      ensureDir: jest.fn(),
      readDirectory: jest.fn(),
      readFile: jest.fn(),
    }
  }
}));

// Mock child_process
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args)
}));

describe('VideoTool', () => {
  let tool: VideoTool;
  // Access the mocked instance
  const mockVfs = UnifiedVfsRouter.Instance as unknown as {
    exists: jest.Mock;
    stat: jest.Mock;
    ensureDir: jest.Mock;
    readDirectory: jest.Mock;
    readFile: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new VideoTool();
  });

  const mockProcess = () => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = jest.fn();
    return proc;
  };

  describe('getInfo', () => {
    it('should return error if file does not exist', async () => {
      mockVfs.exists.mockResolvedValue(false);
      
      const result = await tool.getInfo('test.mp4');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error if format is unsupported', async () => {
      mockVfs.exists.mockResolvedValue(true);
      
      const result = await tool.getInfo('test.txt');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported video format');
    });

    it('should return video info successfully', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.stat.mockResolvedValue({ size: 1024 * 1024 * 10 }); // 10MB

      const proc = mockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = tool.getInfo('test.mp4');

      // Simulate ffprobe output
      const ffprobeOutput = JSON.stringify({
        format: {
          duration: '60.5',
          bit_rate: '1000000'
        },
        streams: [
          {
            codec_type: 'video',
            width: 1920,
            height: 1080,
            r_frame_rate: '30/1',
            codec_name: 'h264'
          }
        ]
      });

      // Emit data and close
      setTimeout(() => {
        proc.stdout.emit('data', Buffer.from(ffprobeOutput));
        proc.emit('close', 0);
      }, 10);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        filename: 'test.mp4',
        format: 'MP4',
        duration: 60.5,
        width: 1920,
        height: 1080,
        fps: 30,
        codec: 'h264',
        bitrate: 1000
      });
    });

    it('should handle ffprobe failure', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.stat.mockResolvedValue({ size: 1024 });

      const proc = mockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = tool.getInfo('test.mp4');

      setTimeout(() => {
        proc.emit('close', 1);
      }, 10);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        filename: 'test.mp4'
      });
      expect((result.data as any).duration).toBeUndefined();
    });
  });

  describe('extractFrames', () => {
    it('should extract frames at intervals', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.ensureDir.mockResolvedValue(undefined);

      // Mock ffprobe for duration check
      const ffprobeProc = mockProcess();
      // Mock ffmpeg checks (version check + 1 frame extraction)
      const ffmpegVersionProc = mockProcess();
      const ffmpegExtractProc = mockProcess();

      mockSpawn
        .mockReturnValueOnce(ffmpegVersionProc) // checkFFmpeg
        .mockReturnValueOnce(ffprobeProc)       // getFFProbeInfo
        .mockReturnValue(ffmpegExtractProc);    // extractFrameAtTimestamp (repeated)

      const promise = tool.extractFrames('test.mp4', { count: 1 });

      // Handle ffmpeg version check
      setTimeout(() => ffmpegVersionProc.emit('close', 0), 10);

      // Handle ffprobe
      setTimeout(() => {
        ffprobeProc.stdout.emit('data', JSON.stringify({ format: { duration: '10' } }));
        ffprobeProc.emit('close', 0);
      }, 20);

      // Handle extraction
      setTimeout(() => ffmpegExtractProc.emit('close', 0), 30);

      const result = await promise;

      expect(result.success).toBe(true);
      expect((result.data as any).frames).toHaveLength(1);
      expect((result.data as any).totalFrames).toBe(1);
    });

    it('should return error if ffmpeg is missing', async () => {
      mockVfs.exists.mockResolvedValue(true);
      
      const proc = mockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = tool.extractFrames('test.mp4');

      setTimeout(() => proc.emit('close', 1), 10); // ffmpeg -version fails

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('ffmpeg is required');
    });
  });

  describe('createThumbnail', () => {
    it('should create thumbnail successfully', async () => {
      mockVfs.exists.mockResolvedValue(true);

      const versionProc = mockProcess();
      const extractProc = mockProcess();

      mockSpawn
        .mockReturnValueOnce(versionProc)
        .mockReturnValueOnce(extractProc);

      const promise = tool.createThumbnail('test.mp4', 5);

      setTimeout(() => versionProc.emit('close', 0), 10);
      setTimeout(() => extractProc.emit('close', 0), 20);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.output).toContain('Thumbnail created');
    });
  });

  describe('extractAudio', () => {
    it('should extract audio successfully', async () => {
      mockVfs.exists.mockResolvedValue(true);

      const versionProc = mockProcess();
      const extractProc = mockProcess();

      mockSpawn
        .mockReturnValueOnce(versionProc)
        .mockReturnValueOnce(extractProc);

      const promise = tool.extractAudio('test.mp4');

      setTimeout(() => versionProc.emit('close', 0), 10);
      setTimeout(() => extractProc.emit('close', 0), 20);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.output).toContain('Audio extracted');
    });
  });

  describe('listVideos', () => {
    it('should list video files', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readDirectory.mockResolvedValue([
        { name: 'movie.mp4', isFile: true },
        { name: 'image.jpg', isFile: true },
        { name: 'folder', isFile: false }
      ]);
      mockVfs.stat.mockResolvedValue({ size: 1024 * 1024 * 50 });

      const result = await tool.listVideos('.');

      expect(result.success).toBe(true);
      expect(result.output).toContain('movie.mp4');
      expect(result.output).toContain('50.00 MB');
      expect(result.output).not.toContain('image.jpg');
    });

    it('should handle no videos found', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readDirectory.mockResolvedValue([
        { name: 'image.jpg', isFile: true }
      ]);

      const result = await tool.listVideos('.');

      expect(result.success).toBe(true);
      expect(result.output).toContain('No video files found');
    });
  });
});