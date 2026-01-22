import { AudioTool } from '../../src/tools/audio-tool.js';
import { UnifiedVfsRouter } from '../../src/services/vfs/unified-vfs-router.js';

// Define mocks inside the factory to avoid hoisting issues
jest.mock('../../src/services/vfs/unified-vfs-router.js', () => ({
  UnifiedVfsRouter: {
    Instance: {
      exists: jest.fn(),
      stat: jest.fn(),
      readFileBuffer: jest.fn(),
      readDirectory: jest.fn()
    }
  }
}));

describe('AudioTool', () => {
  let tool: AudioTool;
  // Access the mocked instance
  const mockVfs = UnifiedVfsRouter.Instance as unknown as {
    exists: jest.Mock;
    stat: jest.Mock;
    readFileBuffer: jest.Mock;
    readDirectory: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new AudioTool();
  });

  describe('getInfo', () => {
    it('should return error if file does not exist', async () => {
      mockVfs.exists.mockResolvedValue(false);
      
      const result = await tool.getInfo('test.mp3');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error if format is unsupported', async () => {
      mockVfs.exists.mockResolvedValue(true);
      
      const result = await tool.getInfo('test.txt');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported audio format');
    });

    it('should return basic info for generic audio', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.stat.mockResolvedValue({ size: 1024 });
      mockVfs.readFileBuffer.mockResolvedValue(Buffer.from([]));

      const result = await tool.getInfo('test.mp3');
      
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        filename: 'test.mp3',
        format: 'MP3',
        size: '1.00 KB'
      });
    });

    it('should parse WAV header', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.stat.mockResolvedValue({ size: 44 });
      
      // Create minimal valid WAV header buffer
      const buffer = Buffer.alloc(44);
      buffer.write('RIFF', 0);
      buffer.writeUInt16LE(1, 22); // Channels
      buffer.writeUInt32LE(44100, 24); // Sample Rate
      buffer.writeUInt32LE(88200, 28); // Byte Rate
      buffer.writeUInt32LE(1000, 40); // Data Size

      mockVfs.readFileBuffer.mockResolvedValue(buffer);

      const result = await tool.getInfo('test.wav');
      
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        format: 'WAV',
        channels: 1,
        sampleRate: 44100
      });
    });
  });

  describe('toBase64', () => {
    it('should return base64 string', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readFileBuffer.mockResolvedValue(Buffer.from('hello'));

      const result = await tool.toBase64('test.mp3');
      
      expect(result.success).toBe(true);
      expect((result.data as any).base64).toBe(Buffer.from('hello').toString('base64'));
      expect((result.data as any).mediaType).toBe('audio/mpeg');
    });
  });

  describe('listAudioFiles', () => {
    it('should list audio files in directory', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readDirectory.mockResolvedValue([
        { name: 'song.mp3', isFile: true },
        { name: 'image.png', isFile: true },
        { name: 'folder', isFile: false }
      ]);
      mockVfs.stat.mockResolvedValue({ size: 1024 });

      const result = await tool.listAudioFiles('.');
      
      expect(result.success).toBe(true);
      expect(result.output).toContain('song.mp3');
      expect(result.output).not.toContain('image.png');
    });

    it('should return error if directory not found', async () => {
      mockVfs.exists.mockResolvedValue(false);
      
      const result = await tool.listAudioFiles('/invalid');
      
      expect(result.success).toBe(false);
    });
  });

  describe('isAudio', () => {
    it('should identify audio extensions', () => {
      expect(tool.isAudio('test.mp3')).toBe(true);
      expect(tool.isAudio('test.wav')).toBe(true);
      expect(tool.isAudio('test.txt')).toBe(false);
    });
  });
});