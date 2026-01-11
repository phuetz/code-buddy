
import { DocumentTool } from '../../src/tools/document-tool.js';
import { PDFTool } from '../../src/tools/pdf-tool.js';
import { ArchiveTool } from '../../src/tools/archive-tool.js';
import { ExportTool } from '../../src/tools/export-tool.js';
import { DiagramTool } from '../../src/tools/diagram-tool.js';
import { UnifiedVfsRouter } from '../../src/services/vfs/unified-vfs-router.js';

// Mock UnifiedVfsRouter
const mockReadFile = jest.fn();
const mockReadFileBuffer = jest.fn();
const mockWriteFile = jest.fn();
const mockExists = jest.fn();
const mockEnsureDir = jest.fn();
const mockStat = jest.fn();
const mockReadDirectory = jest.fn();
const mockRemove = jest.fn();

jest.mock('../../src/services/vfs/unified-vfs-router.js', () => ({
  UnifiedVfsRouter: {
    Instance: {
      readFile: (...args: unknown[]) => mockReadFile(...args),
      readFileBuffer: (...args: unknown[]) => mockReadFileBuffer(...args),
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
      exists: (...args: unknown[]) => mockExists(...args),
      ensureDir: (...args: unknown[]) => mockEnsureDir(...args),
      stat: (...args: unknown[]) => mockStat(...args),
      readDirectory: (...args: unknown[]) => mockReadDirectory(...args),
      remove: (...args: unknown[]) => mockRemove(...args),
    },
  },
}));

describe('Document and Media Tools VFS Migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('DocumentTool', () => {
    it('should use VFS for reading CSV', async () => {
      const tool = new DocumentTool();
      
      mockExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ size: 1024 });
      mockReadFile.mockResolvedValue('col1,col2\nval1,val2');
      
      await tool.readDocument('test.csv');
      
      expect(mockExists).toHaveBeenCalled();
      expect(mockStat).toHaveBeenCalled();
      expect(mockReadFile).toHaveBeenCalled();
    });
  });

  describe('PDFTool', () => {
    it('should use VFS for extracting text', async () => {
      const tool = new PDFTool();
      
      mockExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ size: 1024 });
      mockReadFileBuffer.mockResolvedValue(Buffer.from('%PDF-1.4...'));
      
      await tool.extractText('test.pdf');
      
      expect(mockExists).toHaveBeenCalled();
      expect(mockStat).toHaveBeenCalled();
      expect(mockReadFileBuffer).toHaveBeenCalled();
    });
  });

  describe('ArchiveTool', () => {
    it('should use VFS for listing archive', async () => {
      const tool = new ArchiveTool();
      
      mockExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ size: 1024 });
      
      // We can't fully test listing without mocking specific archive readers (adm-zip etc), 
      // but we can verify VFS checks are made before that
      try {
        await tool.list('test.zip');
      } catch {
        // Expected to fail on adm-zip without proper mock
      }
      
      expect(mockExists).toHaveBeenCalled();
    });
  });

  describe('ExportTool', () => {
    it('should use VFS for exporting conversation', async () => {
      const tool = new ExportTool();
      
      await tool.exportConversation(
        [{ role: 'user', content: 'hello' }],
        { format: 'json' }
      );
      
      expect(mockEnsureDir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalled();
    });
  });

  describe('DiagramTool', () => {
    it('should use VFS for ensuring output dir', async () => {
      const tool = new DiagramTool();
      
      // We'll test generating ASCII which doesn't require external tools
      await tool.generateFromMermaid('graph TD; A-->B;', { outputFormat: 'ascii' });
      
      expect(mockEnsureDir).toHaveBeenCalled();
    });
  });
});
