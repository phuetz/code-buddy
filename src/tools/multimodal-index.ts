/**
 * Multimodal Tools Index
 * Exports all multimodal tools for easy import
 */

// PDF Tool - Read and extract content from PDF files
import { PDFTool } from './pdf-tool.js';
export { PDFTool };
export type { PDFContent, PDFMetadata, PDFPage } from './pdf-tool.js';

// Audio Tool - Audio file analysis and transcription
import { AudioTool } from './audio-tool.js';
export { AudioTool };
export type { AudioInfo, TranscriptionResult, TranscriptionSegment } from './audio-tool.js';

// Video Tool - Video processing and frame extraction
import { VideoTool } from './video-tool.js';
export { VideoTool };
export type { VideoInfo, FrameExtraction, ExtractedFrame } from './video-tool.js';

// Screenshot Tool - Screen capture functionality
import { ScreenshotTool } from './screenshot-tool.js';
export { ScreenshotTool };
export type { ScreenshotOptions, ScreenshotResult } from './screenshot-tool.js';

// Clipboard Tool - System clipboard integration
import { ClipboardTool } from './clipboard-tool.js';
export { ClipboardTool };
export type { ClipboardContent } from './clipboard-tool.js';

// Document Tool - Office document support (DOCX, XLSX, PPTX)
import { DocumentTool } from './document-tool.js';
export { DocumentTool };
export type { DocumentContent, DocumentMetadata, SheetContent, SlideContent } from './document-tool.js';

// OCR Tool - Optical character recognition
import { OCRTool } from './ocr-tool.js';
export { OCRTool };
export type { OCRResult, OCRBlock, OCROptions } from './ocr-tool.js';

// Diagram Tool - Diagram generation (Mermaid, ASCII)
import { DiagramTool } from './diagram-tool.js';
export { DiagramTool };
export type { DiagramType, DiagramOptions, DiagramResult } from './diagram-tool.js';

// Export Tool - Conversation and data export
import { ExportTool } from './export-tool.js';
export { ExportTool };
export type { ExportFormat, Message, ConversationExport, ExportOptions } from './export-tool.js';

// QR Tool - QR code generation and reading
import { QRTool } from './qr-tool.js';
export { QRTool };
export type { QRGenerateOptions, QRDecodeResult } from './qr-tool.js';

// Archive Tool - Archive handling (ZIP, TAR, etc.)
import { ArchiveTool } from './archive-tool.js';
export { ArchiveTool };
export type { ArchiveInfo, ArchiveEntry, ExtractOptions, CreateOptions } from './archive-tool.js';

/**
 * Create instances of all multimodal tools
 */
export function createMultimodalTools() {
  return {
    pdf: new PDFTool(),
    audio: new AudioTool(),
    video: new VideoTool(),
    screenshot: new ScreenshotTool(),
    clipboard: new ClipboardTool(),
    document: new DocumentTool(),
    ocr: new OCRTool(),
    diagram: new DiagramTool(),
    export: new ExportTool(),
    qr: new QRTool(),
    archive: new ArchiveTool(),
  };
}

/**
 * Multimodal tool descriptions for help display
 */
export const MULTIMODAL_TOOL_DESCRIPTIONS = {
  pdf: {
    name: 'PDF Tool',
    description: 'Read and extract content from PDF files',
    operations: ['extractText', 'getInfo', 'listPDFs', 'toBase64']
  },
  audio: {
    name: 'Audio Tool',
    description: 'Analyze and transcribe audio files',
    operations: ['getInfo', 'transcribe', 'toBase64', 'listAudioFiles']
  },
  video: {
    name: 'Video Tool',
    description: 'Process video files and extract frames',
    operations: ['getInfo', 'extractFrames', 'createThumbnail', 'extractAudio', 'listVideos']
  },
  screenshot: {
    name: 'Screenshot Tool',
    description: 'Capture screenshots',
    operations: ['capture', 'captureWindow', 'captureRegion', 'captureDelayed', 'listScreenshots']
  },
  clipboard: {
    name: 'Clipboard Tool',
    description: 'Read and write to system clipboard',
    operations: ['readText', 'writeText', 'readImage', 'writeImage', 'clear']
  },
  document: {
    name: 'Document Tool',
    description: 'Read Office documents (DOCX, XLSX, PPTX, CSV)',
    operations: ['readDocument', 'listDocuments']
  },
  ocr: {
    name: 'OCR Tool',
    description: 'Extract text from images using OCR',
    operations: ['extractText', 'listLanguages', 'batchOCR', 'extractRegion']
  },
  diagram: {
    name: 'Diagram Tool',
    description: 'Generate flowcharts, sequence diagrams, and more',
    operations: ['generateFromMermaid', 'generateFlowchart', 'generateSequenceDiagram', 'generateClassDiagram', 'generatePieChart', 'generateGanttChart']
  },
  export: {
    name: 'Export Tool',
    description: 'Export conversations to various formats',
    operations: ['exportConversation', 'exportToCSV', 'exportCodeSnippets', 'listExports']
  },
  qr: {
    name: 'QR Tool',
    description: 'Generate and read QR codes',
    operations: ['generate', 'decode', 'generateWiFi', 'generateVCard', 'generateURL']
  },
  archive: {
    name: 'Archive Tool',
    description: 'Work with compressed archives (ZIP, TAR, etc.)',
    operations: ['list', 'extract', 'create', 'listArchives']
  }
};
