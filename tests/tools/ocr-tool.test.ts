import { OCRTool } from '../../src/tools/ocr-tool.js';
import { UnifiedVfsRouter } from '../../src/services/vfs/unified-vfs-router.js';
import { EventEmitter } from 'events';

// Define mocks inside the factory
jest.mock('../../src/services/vfs/unified-vfs-router.js', () => ({
  UnifiedVfsRouter: {
    Instance: {
      exists: jest.fn(),
      stat: jest.fn(),
      readFileBuffer: jest.fn(),
      ensureDir: jest.fn(),
      remove: jest.fn(),
    }
  }
}));

// Mock child_process
const mockSpawn = jest.fn();
const mockExecSync = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
  execSync: (...args: any[]) => mockExecSync(...args)
}));

describe('OCRTool', () => {
  let tool: OCRTool;
  const mockVfs = UnifiedVfsRouter.Instance as unknown as {
    exists: jest.Mock;
    stat: jest.Mock;
    readFileBuffer: jest.Mock;
    ensureDir: jest.Mock;
    remove: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new OCRTool();
    (tool as any).tesseractAvailable = null;
    
    // Default execSync to return empty string instead of buffer to avoid split errors
    mockExecSync.mockReturnValue('');
  });

  const mockProcess = () => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = jest.fn();
    return proc;
  };

  describe('extractText', () => {
    it('should return error if file does not exist', async () => {
      mockVfs.exists.mockResolvedValue(false);
      
      const result = await tool.extractText('test.png');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error if format is unsupported', async () => {
      mockVfs.exists.mockResolvedValue(true);
      
      const result = await tool.extractText('test.txt');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported image format');
    });

    it('should extract text using Tesseract', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.stat.mockResolvedValue({ size: 1024 });
      
      // Mock checkTesseract success
      mockExecSync.mockReturnValue('tesseract 5.0.0');

      const proc = mockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = tool.extractText('test.png');

      // Simulate TSV output
      const tsvOutput = `level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext
5\t1\t1\t1\t1\t1\t10\t10\t50\t20\t95\tHello
5\t1\t1\t1\t1\t2\t70\t10\t50\t20\t90\tWorld`;

      // Use setImmediate to let the promise chain advance
      await new Promise(resolve => setImmediate(resolve));

      proc.stdout.emit('data', Buffer.from(tsvOutput));
      proc.emit('close', 0);

      const result = await promise;

      expect(result.success).toBe(true);
      expect((result.data as any).text).toBe('Hello World');
    });

    it('should handle Tesseract failure', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.stat.mockResolvedValue({ size: 1024 });
      mockExecSync.mockReturnValue('tesseract 5.0.0');

      const proc = mockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = tool.extractText('test.png');

      await new Promise(resolve => setImmediate(resolve));

      proc.stderr.emit('data', Buffer.from('Error'));
      proc.emit('close', 1);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('Tesseract exited with code 1');
    });

    it('should fallback when Tesseract is missing', async () => {
      const originalEnv = process.env;
      process.env = { ...originalEnv };
      delete process.env.GROK_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        mockVfs.exists.mockResolvedValue(true);
        mockVfs.stat.mockResolvedValue({ size: 1024 });
        
        // Mock checkTesseract failure
        mockExecSync.mockImplementation(() => {
          throw new Error('Command failed');
        });

        const result = await tool.extractText('test.png');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Tesseract OCR not installed');
      } finally {
        process.env = originalEnv;
      }
    });
  });

  describe('listLanguages', () => {
    it('should list available languages', async () => {
      // We need to handle two calls to execSync
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('--version')) return 'tesseract 5.0.0';
        if (cmd.includes('--list-langs')) return 'List of available languages (2):\neng\nfra';
        throw new Error('Unknown command');
      });

      const result = await tool.listLanguages();

      if (!result.success) {
        // console.error('listLanguages failed:', result.error);
        throw new Error(`listLanguages failed: ${result.error}`);
      }

      expect(result.success).toBe(true);
      expect(result.output).toContain('eng');
      expect(result.output).toContain('fra');
    });

    it('should handle missing Tesseract', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('Command failed'); });

      const result = await tool.listLanguages();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Tesseract not installed');
    });
  });

  describe('batchOCR', () => {
    it('should process multiple files', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.stat.mockResolvedValue({ size: 1024 });
      
      // Bypass checkTesseract
      (tool as any).tesseractAvailable = true;
      mockExecSync.mockReturnValue('tesseract 5.0.0');

      const proc1 = mockProcess();
      const proc2 = mockProcess();
      
      mockSpawn
        .mockReturnValueOnce(proc1)
        .mockReturnValueOnce(proc2);

      const promise = tool.batchOCR(['img1.png', 'img2.png']);

      await new Promise(resolve => setImmediate(resolve));

      const tsv = `level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext
5\t1\t1\t1\t1\t1\t10\t10\t50\t20\t95\tText`;
      
      proc1.stdout.emit('data', Buffer.from(tsv));
      proc1.emit('close', 0);
      
      await new Promise(resolve => setImmediate(resolve));

      proc2.stdout.emit('data', Buffer.from(tsv));
      proc2.emit('close', 0);

      const result = await promise;

      expect(result.success).toBe(true);
      expect((result.data as any[])).toHaveLength(2);
    });
  });

  describe('extractRegion', () => {
    it('should extract region using ImageMagick', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.stat.mockResolvedValue({ size: 1024 });
      mockVfs.ensureDir.mockResolvedValue(undefined);
      (tool as any).tesseractAvailable = true;

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'which convert') return '/usr/bin/convert';
        // convert command
        if (cmd.startsWith('convert')) return '';
        return '';
      });

      const proc = mockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = tool.extractRegion('test.png', { x: 0, y: 0, width: 100, height: 100 });

      await new Promise(resolve => setImmediate(resolve));

      const tsv = `level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext
5\t1\t1\t1\t1\t1\t10\t10\t50\t20\t95\tRegionText`;
      
      proc.stdout.emit('data', Buffer.from(tsv));
      proc.emit('close', 0);

      const result = await promise;

      expect(result.success).toBe(true);
      expect((result.data as any).text).toBe('RegionText');
    });

    it('should fail if ImageMagick missing', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd === 'which convert') throw new Error('Not found');
        return '';
      });

      const result = await tool.extractRegion('test.png', { x: 0, y: 0, width: 100, height: 100 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ImageMagick is required');
    });
  });
});
