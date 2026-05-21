
import { DocumentTool } from '../../src/tools/document-tool.js';
import { PDFTool } from '../../src/tools/pdf-tool.js';
import { ArchiveTool } from '../../src/tools/archive-tool.js';
import { ExportTool } from '../../src/tools/export-tool.js';
import { DiagramTool } from '../../src/tools/diagram-tool.js';
import { UnifiedVfsRouter } from '../../src/services/vfs/unified-vfs-router.js';
import path from 'path';

// Mock UnifiedVfsRouter
const mockReadFile = jest.fn();
const mockReadFileBuffer = jest.fn();
const mockWriteFile = jest.fn();
const mockWriteFileBuffer = jest.fn();
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
      writeFileBuffer: (...args: unknown[]) => mockWriteFileBuffer(...args),
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

    it('preserves DOCX paragraph boundaries for question documents', async () => {
      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip();
      zip.addFile(
        'word/document.xml',
        Buffer.from(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
            '<w:body>' +
            '<w:p><w:r><w:t>Functional analysis: impact screen</w:t></w:r></w:p>' +
            '<w:p><w:r><w:t>Question </w:t></w:r><w:r><w:t>1: What changes for A &amp; B?</w:t></w:r></w:p>' +
            '</w:body>' +
            '</w:document>'
        )
      );
      const buffer = zip.toBuffer();
      const tool = new DocumentTool();

      mockExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ size: buffer.length });
      mockReadFileBuffer.mockResolvedValue(buffer);

      const result = await tool.readDocument('questions.docx');

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        text: 'Functional analysis: impact screen\nQuestion 1: What changes for A & B?',
        type: 'docx',
      });
    });

    it('preserves DOCX tables and embedded image markers around questions', async () => {
      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip();
      zip.addFile(
        'word/document.xml',
        Buffer.from(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
            '<w:body>' +
            '<w:p><w:r><w:t>Analyse fonctionnelle avant questions</w:t></w:r></w:p>' +
            '<w:tbl>' +
            '<w:tr>' +
            '<w:tc><w:p><w:r><w:t>Question</w:t></w:r></w:p></w:tc>' +
            '<w:tc><w:p><w:r><w:t>Contexte</w:t></w:r></w:p></w:tc>' +
            '</w:tr>' +
            '<w:tr>' +
            '<w:tc><w:p><w:r><w:t>Question 1</w:t></w:r></w:p></w:tc>' +
            '<w:tc><w:p><w:r><w:t>Capture écran impact demande</w:t></w:r></w:p></w:tc>' +
            '</w:tr>' +
            '</w:tbl>' +
            '<w:p><w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r></w:p>' +
            '<w:p><w:r><w:t>Question 2: détailler le traitement?</w:t></w:r></w:p>' +
            '</w:body>' +
            '</w:document>'
        )
      );
      zip.addFile(
        'word/_rels/document.xml.rels',
        Buffer.from(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/screen-impact.png"/>' +
            '</Relationships>'
        )
      );
      const buffer = zip.toBuffer();
      const tool = new DocumentTool();

      mockExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ size: buffer.length });
      mockReadFileBuffer.mockResolvedValue(buffer);

      const result = await tool.readDocument('questions-with-screens.docx');

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        text: [
          'Analyse fonctionnelle avant questions',
          '[Table]',
          'Question\tContexte',
          'Question 1\tCapture écran impact demande',
          '[Embedded image: media/screen-impact.png]',
          'Question 2: détailler le traitement?',
        ].join('\n'),
        metadata: {
          embeddedImageCount: 1,
        },
      });
    });

    it('does not treat DOCX hyperlink relationship ids as embedded images', async () => {
      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip();
      zip.addFile(
        'word/document.xml',
        Buffer.from(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
            '<w:body>' +
            '<w:p><w:r><w:t>Question source with link</w:t></w:r></w:p>' +
            '<w:p><w:hyperlink r:id="rIdHyper"><w:r><w:t>Reference page</w:t></w:r></w:hyperlink></w:p>' +
            '</w:body>' +
            '</w:document>'
        )
      );
      zip.addFile(
        'word/_rels/document.xml.rels',
        Buffer.from(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rIdHyper" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test/reference" TargetMode="External"/>' +
            '</Relationships>'
        )
      );
      const buffer = zip.toBuffer();
      const tool = new DocumentTool();

      mockExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ size: buffer.length });
      mockReadFileBuffer.mockResolvedValue(buffer);

      const result = await tool.readDocument('questions-with-link.docx');

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        text: 'Question source with link\nReference page',
        metadata: {
          embeddedImageCount: 0,
        },
      });
      expect(result.data?.text).not.toContain('[Embedded image');
    });

    it('extracts embedded DOCX images to an output directory', async () => {
      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip();
      zip.addFile(
        'word/document.xml',
        Buffer.from(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
            '<w:body><w:p><w:r><w:t>Question with screenshot</w:t></w:r></w:p></w:body>' +
            '</w:document>'
        )
      );
      zip.addFile('word/media/image1.png', Buffer.from('png-bytes'));
      zip.addFile('word/media/image2.jpeg', Buffer.from('jpeg-bytes'));
      const buffer = zip.toBuffer();
      const tool = new DocumentTool();
      const outputDir = path.resolve(process.cwd(), 'screens');

      mockExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ size: buffer.length });
      mockReadFileBuffer.mockResolvedValue(buffer);

      const result = await tool.extractEmbeddedImages('questions.docx', 'screens');

      expect(result.success).toBe(true);
      expect(mockEnsureDir).toHaveBeenCalledWith(outputDir);
      expect(mockWriteFileBuffer).toHaveBeenCalledTimes(2);
      expect(mockWriteFileBuffer).toHaveBeenCalledWith(path.join(outputDir, 'image1.png'), Buffer.from('png-bytes'));
      expect(mockWriteFileBuffer).toHaveBeenCalledWith(path.join(outputDir, 'image2.jpeg'), Buffer.from('jpeg-bytes'));
      expect(result.output).toContain('Extracted 2 embedded image(s)');
      expect(result.output).toContain('Markdown references for generate_document:');
      expect(result.output).toContain(`![Source screenshot - image1.png](${path.join(outputDir, 'image1.png').replace(/\\/g, '/')})`);
      expect(result.data).toMatchObject({
        outputDir,
        images: [
          {
            sourcePath: 'word/media/image1.png',
            outputPath: path.join(outputDir, 'image1.png'),
            markdownRef: `![Source screenshot - image1.png](${path.join(outputDir, 'image1.png').replace(/\\/g, '/')})`,
            size: 9,
          },
          {
            sourcePath: 'word/media/image2.jpeg',
            outputPath: path.join(outputDir, 'image2.jpeg'),
            markdownRef: `![Source screenshot - image2.jpeg](${path.join(outputDir, 'image2.jpeg').replace(/\\/g, '/')})`,
            size: 10,
          },
        ],
      });
    });

    it('extracts only referenced DOCX images in document order', async () => {
      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip();
      zip.addFile(
        'word/document.xml',
        Buffer.from(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
            '<w:body>' +
            '<w:p><w:r><w:drawing><a:blip r:embed="rIdSecond"/></w:drawing></w:r></w:p>' +
            '<w:p><w:r><w:drawing><a:blip r:embed="rIdFirst"/></w:drawing></w:r></w:p>' +
            '</w:body>' +
            '</w:document>'
        )
      );
      zip.addFile(
        'word/_rels/document.xml.rels',
        Buffer.from(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rIdFirst" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
            '<Relationship Id="rIdSecond" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.png"/>' +
            '<Relationship Id="rIdUnused" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/unused.png"/>' +
            '<Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.test/screen.png" TargetMode="External"/>' +
            '</Relationships>'
        )
      );
      zip.addFile('word/media/image1.png', Buffer.from('one'));
      zip.addFile('word/media/image2.png', Buffer.from('two'));
      zip.addFile('word/media/unused.png', Buffer.from('unused'));
      const buffer = zip.toBuffer();
      const tool = new DocumentTool();
      const outputDir = path.resolve(process.cwd(), 'screens');

      mockExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ size: buffer.length });
      mockReadFileBuffer.mockResolvedValue(buffer);

      const result = await tool.extractEmbeddedImages('questions.docx', 'screens');

      expect(result.success).toBe(true);
      expect(mockWriteFileBuffer).toHaveBeenCalledTimes(2);
      expect(mockWriteFileBuffer).toHaveBeenNthCalledWith(
        1,
        path.join(outputDir, 'image2.png'),
        Buffer.from('two')
      );
      expect(mockWriteFileBuffer).toHaveBeenNthCalledWith(
        2,
        path.join(outputDir, 'image1.png'),
        Buffer.from('one')
      );
      expect(result.output).not.toContain('unused.png');
      expect(result.data).toMatchObject({
        images: [
          { sourcePath: 'word/media/image2.png' },
          { sourcePath: 'word/media/image1.png' },
        ],
      });
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
