/**
 * Multimodal Tool Adapters
 *
 * ITool-compliant adapters for multimodal tools: audio, video, PDF, OCR,
 * QR code, clipboard, diagram, document, export, and archive.
 *
 * Each adapter lazy-loads the underlying tool and dispatches based on
 * the `operation` parameter from the OpenAI function-calling schema.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';

// ============================================================================
// Lazy-loaded tool instances
// ============================================================================

let audioInstance: InstanceType<typeof import('../audio-tool.js').AudioTool> | null = null;
let videoInstance: InstanceType<typeof import('../video-tool.js').VideoTool> | null = null;
let pdfInstance: InstanceType<typeof import('../pdf-tool.js').PDFTool> | null = null;
let ocrInstance: InstanceType<typeof import('../ocr-tool.js').OCRTool> | null = null;
let qrInstance: InstanceType<typeof import('../qr-tool.js').QRTool> | null = null;
let clipboardInstance: InstanceType<typeof import('../clipboard-tool.js').ClipboardTool> | null = null;
let diagramInstance: InstanceType<typeof import('../diagram-tool.js').DiagramTool> | null = null;
let documentInstance: InstanceType<typeof import('../document-tool.js').DocumentTool> | null = null;
let exportInstance: InstanceType<typeof import('../export-tool.js').ExportTool> | null = null;
let archiveInstance: InstanceType<typeof import('../archive-tool.js').ArchiveTool> | null = null;

async function getAudio() {
  if (!audioInstance) {
    const { AudioTool } = await import('../audio-tool.js');
    audioInstance = new AudioTool();
  }
  return audioInstance;
}

async function getVideo() {
  if (!videoInstance) {
    const { VideoTool } = await import('../video-tool.js');
    videoInstance = new VideoTool();
  }
  return videoInstance;
}

async function getPDF() {
  if (!pdfInstance) {
    const { PDFTool } = await import('../pdf-tool.js');
    pdfInstance = new PDFTool();
  }
  return pdfInstance;
}

async function getOCR() {
  if (!ocrInstance) {
    const { OCRTool } = await import('../ocr-tool.js');
    ocrInstance = new OCRTool();
  }
  return ocrInstance;
}

async function getQR() {
  if (!qrInstance) {
    const { QRTool } = await import('../qr-tool.js');
    qrInstance = new QRTool();
  }
  return qrInstance;
}

async function getClipboard() {
  if (!clipboardInstance) {
    const { ClipboardTool } = await import('../clipboard-tool.js');
    clipboardInstance = new ClipboardTool();
  }
  return clipboardInstance;
}

async function getDiagram() {
  if (!diagramInstance) {
    const { DiagramTool } = await import('../diagram-tool.js');
    diagramInstance = new DiagramTool();
  }
  return diagramInstance;
}

async function getDocument() {
  if (!documentInstance) {
    const { DocumentTool } = await import('../document-tool.js');
    documentInstance = new DocumentTool();
  }
  return documentInstance;
}

async function getExport() {
  if (!exportInstance) {
    const { ExportTool } = await import('../export-tool.js');
    exportInstance = new ExportTool();
  }
  return exportInstance;
}

async function getArchive() {
  if (!archiveInstance) {
    const { ArchiveTool } = await import('../archive-tool.js');
    archiveInstance = new ArchiveTool();
  }
  return archiveInstance;
}

/**
 * Reset all shared instances (for testing)
 */
export function resetMultimodalInstances(): void {
  audioInstance = null;
  videoInstance = null;
  pdfInstance = null;
  ocrInstance = null;
  qrInstance = null;
  clipboardInstance = null;
  diagramInstance = null;
  documentInstance = null;
  exportInstance = null;
  archiveInstance = null;
}

// ============================================================================
// AudioExecuteTool
// ============================================================================

export class AudioExecuteTool implements ITool {
  readonly name = 'audio';
  readonly description = 'Process and transcribe audio files. Supports info extraction, transcription (via Whisper API), and format conversion.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getAudio();
    const op = input.operation as string;
    const filePath = input.path as string;

    switch (op) {
      case 'info':
        return tool.getInfo(filePath);
      case 'transcribe':
        return tool.transcribe(filePath, {
          language: input.language as string | undefined,
          prompt: input.prompt as string | undefined,
        });
      case 'list':
        return tool.listAudioFiles(filePath);
      case 'to_base64':
        return tool.toBase64(filePath);
      default:
        return { success: false, error: `Unknown audio operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['info', 'transcribe', 'list', 'to_base64'], description: 'Operation to perform' },
          path: { type: 'string', description: 'Path to audio file or directory' },
          language: { type: 'string', description: 'Language code for transcription' },
          prompt: { type: 'string', description: 'Optional prompt to guide transcription' },
        },
        required: ['operation', 'path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    if (typeof d.path !== 'string') return { valid: false, errors: ['path is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['audio', 'transcribe', 'whisper', 'sound', 'music'], priority: 3, modifiesFiles: false, makesNetworkRequests: true };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// VideoExecuteTool
// ============================================================================

export class VideoExecuteTool implements ITool {
  readonly name = 'video';
  readonly description = 'Process video files: get info, extract frames, create thumbnails, extract audio. Requires ffmpeg.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getVideo();
    const op = input.operation as string;
    const filePath = input.path as string;

    switch (op) {
      case 'info':
        return tool.getInfo(filePath);
      case 'extract_frames':
        return tool.extractFrames(filePath, {
          interval: input.interval as number | undefined,
          count: input.count as number | undefined,
          timestamps: input.timestamps as number[] | undefined,
          outputDir: input.output_dir as string | undefined,
        });
      case 'thumbnail':
        return tool.createThumbnail(filePath, undefined, input.output_dir as string | undefined);
      case 'extract_audio':
        return tool.extractAudio(filePath, input.output_dir as string | undefined);
      case 'list':
        return tool.listVideos(filePath);
      default:
        return { success: false, error: `Unknown video operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['info', 'extract_frames', 'thumbnail', 'extract_audio', 'list'], description: 'Operation to perform' },
          path: { type: 'string', description: 'Path to video file or directory' },
          interval: { type: 'number', description: 'Seconds between frames for frame extraction' },
          count: { type: 'number', description: 'Number of frames to extract' },
          timestamps: { type: 'array', items: { type: 'number' }, description: 'Specific timestamps to extract frames from' },
          output_dir: { type: 'string', description: 'Output directory for extracted content' },
        },
        required: ['operation', 'path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    if (typeof d.path !== 'string') return { valid: false, errors: ['path is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['video', 'ffmpeg', 'frames', 'thumbnail', 'extract'], priority: 3, modifiesFiles: true, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// PDFExecuteTool
// ============================================================================

export class PDFExecuteTool implements ITool {
  readonly name = 'pdf';
  readonly description = 'Read and extract content from PDF files. Supports text extraction, metadata reading, and page-specific extraction.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getPDF();
    const op = input.operation as string;
    const filePath = input.path as string;

    switch (op) {
      case 'extract':
        return tool.extractText(filePath, {
          pages: input.pages as number[] | undefined,
          maxPages: input.max_pages as number | undefined,
        });
      case 'info':
        return tool.getInfo(filePath);
      case 'list':
        return tool.listPDFs(filePath);
      case 'to_base64':
        return tool.toBase64(filePath);
      default:
        return { success: false, error: `Unknown PDF operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['extract', 'info', 'list', 'to_base64'], description: 'Operation to perform' },
          path: { type: 'string', description: 'Path to PDF file or directory' },
          pages: { type: 'array', items: { type: 'number' }, description: 'Specific page numbers to extract' },
          max_pages: { type: 'number', description: 'Maximum pages to extract' },
        },
        required: ['operation', 'path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    if (typeof d.path !== 'string') return { valid: false, errors: ['path is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['pdf', 'document', 'extract', 'text', 'pages'], priority: 4, modifiesFiles: false, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// OCRExecuteTool
// ============================================================================

export class OCRExecuteTool implements ITool {
  readonly name = 'ocr';
  readonly description = 'Extract text from images using OCR. Uses Tesseract if available, or vision API as fallback.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getOCR();
    const op = input.operation as string;

    switch (op) {
      case 'extract':
        return tool.extractText(input.path as string, {
          language: input.language as string | undefined,
        });
      case 'extract_region':
        return tool.extractRegion(
          input.path as string,
          input.region as { x: number; y: number; width: number; height: number },
          { language: input.language as string | undefined },
        );
      case 'list_languages':
        return tool.listLanguages();
      case 'batch':
        return tool.batchOCR(
          input.paths as string[],
          { language: input.language as string | undefined },
        );
      default:
        return { success: false, error: `Unknown OCR operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['extract', 'extract_region', 'list_languages', 'batch'], description: 'OCR operation to perform' },
          path: { type: 'string', description: 'Path to image file' },
          paths: { type: 'array', items: { type: 'string' }, description: 'Array of image paths for batch OCR' },
          language: { type: 'string', description: "OCR language code (e.g., 'eng', 'fra')" },
          region: { type: 'object', description: 'Region to OCR: { x, y, width, height }' },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['ocr', 'image', 'text', 'tesseract', 'recognition'], priority: 3, modifiesFiles: false, makesNetworkRequests: true };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// QRExecuteTool
// ============================================================================

export class QRExecuteTool implements ITool {
  readonly name = 'qr';
  readonly description = 'Generate and read QR codes. Supports URL, WiFi, vCard, and custom data.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getQR();
    const op = input.operation as string;

    switch (op) {
      case 'generate':
        return tool.generate(input.data as string, {
          format: input.format as 'png' | 'svg' | 'ascii' | 'utf8' | undefined,
        });
      case 'generate_url':
        return tool.generateURL(input.url as string, {
          format: input.format as 'png' | 'svg' | 'ascii' | 'utf8' | undefined,
        });
      case 'generate_wifi':
        return tool.generateWiFi(
          input.ssid as string,
          input.password as string | undefined,
          input.wifi_type as 'WPA' | 'WEP' | 'nopass' | undefined,
        );
      case 'generate_vcard':
        return tool.generateVCard(input.contact as Record<string, string>);
      case 'decode':
        return tool.decode(input.path as string);
      case 'list':
        return tool.listQRCodes();
      default:
        return { success: false, error: `Unknown QR operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['generate', 'generate_url', 'generate_wifi', 'generate_vcard', 'decode', 'list'], description: 'QR code operation' },
          data: { type: 'string', description: 'Data to encode' },
          url: { type: 'string', description: 'URL for generate_url' },
          ssid: { type: 'string', description: 'WiFi SSID' },
          password: { type: 'string', description: 'WiFi password' },
          wifi_type: { type: 'string', enum: ['WPA', 'WEP', 'nopass'], description: 'WiFi security type' },
          contact: { type: 'object', description: 'Contact info for vCard' },
          path: { type: 'string', description: 'Path to QR code image for decode' },
          format: { type: 'string', enum: ['ascii', 'utf8', 'svg', 'png'], description: 'Output format' },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['qr', 'qrcode', 'barcode', 'generate', 'decode'], priority: 3, modifiesFiles: true, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// ClipboardExecuteTool
// ============================================================================

export class ClipboardExecuteTool implements ITool {
  readonly name = 'clipboard';
  readonly description = 'Read and write to system clipboard. Supports text, images, and HTML content.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getClipboard();
    const op = input.operation as string;

    switch (op) {
      case 'read_text':
        return tool.readText();
      case 'write_text':
        return tool.writeText(input.text as string);
      case 'read_image':
        return tool.readImage(input.path as string | undefined);
      case 'write_image':
        return tool.writeImage(input.path as string);
      case 'read_html':
        return tool.readHtml();
      case 'copy_file_path':
        return tool.copyFilePath(input.path as string);
      case 'copy_file_content':
        return tool.copyFileContent(input.path as string);
      case 'get_type':
        return tool.getContentType();
      case 'clear':
        return tool.clear();
      default:
        return { success: false, error: `Unknown clipboard operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['read_text', 'write_text', 'read_image', 'write_image', 'read_html', 'copy_file_path', 'copy_file_content', 'get_type', 'clear'], description: 'Clipboard operation' },
          text: { type: 'string', description: 'Text to write (for write_text)' },
          path: { type: 'string', description: 'File path (for image ops or copy_file_*)' },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['clipboard', 'copy', 'paste', 'text', 'image'], priority: 4, modifiesFiles: false, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// DiagramExecuteTool
// ============================================================================

export class DiagramExecuteTool implements ITool {
  readonly name = 'diagram';
  readonly description = 'Generate diagrams: flowcharts, sequence diagrams, class diagrams, pie charts, Gantt charts, and ASCII art.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getDiagram();
    const op = input.operation as string;
    const opts = { outputFormat: input.format as 'svg' | 'png' | 'ascii' | undefined };

    switch (op) {
      case 'mermaid':
        return tool.generateFromMermaid(input.code as string, opts);
      case 'flowchart':
        return tool.generateFlowchart(
          input.nodes as Array<{ id: string; label: string; type?: string }>,
          input.connections as Array<{ from: string; to: string; label?: string; type?: string }>,
          { title: input.title as string | undefined, ...opts },
        );
      case 'sequence':
        return tool.generateSequenceDiagram(
          input.participants as string[],
          input.messages as Array<{ from: string; to: string; message: string; type?: string }>,
          { title: input.title as string | undefined, ...opts },
        );
      case 'class':
        return tool.generateClassDiagram(
          input.classes as Array<{ name: string; attributes?: string[]; methods?: string[] }>,
          input.relationships as Array<{ from: string; to: string; type: string; label?: string }>,
          { title: input.title as string | undefined, ...opts },
        );
      case 'pie':
        return tool.generatePieChart(
          input.data as Array<{ label: string; value: number }>,
          { title: input.title as string | undefined, ...opts },
        );
      case 'gantt':
        return tool.generateGanttChart(
          input.sections as Array<{ name: string; tasks: Array<{ name: string; id: string; start: string; duration: string; status?: string }> }>,
          { title: input.title as string | undefined, ...opts },
        );
      case 'list':
        return tool.listDiagrams();
      default:
        return { success: false, error: `Unknown diagram operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['mermaid', 'flowchart', 'sequence', 'class', 'pie', 'gantt', 'list'], description: 'Type of diagram to generate' },
          code: { type: 'string', description: 'Mermaid code for mermaid operation' },
          title: { type: 'string', description: 'Title for the diagram' },
          nodes: { type: 'array', description: 'Nodes for flowchart' },
          connections: { type: 'array', description: 'Connections between nodes' },
          participants: { type: 'array', items: { type: 'string' }, description: 'Participants for sequence diagram' },
          messages: { type: 'array', description: 'Messages for sequence diagram' },
          classes: { type: 'array', description: 'Classes for class diagram' },
          relationships: { type: 'array', description: 'Relationships for class diagram' },
          data: { type: 'array', description: 'Data points for pie chart' },
          sections: { type: 'array', description: 'Sections for Gantt chart' },
          format: { type: 'string', enum: ['svg', 'png', 'ascii', 'utf8'], description: 'Output format' },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['diagram', 'flowchart', 'mermaid', 'sequence', 'class', 'gantt', 'chart'], priority: 3, modifiesFiles: true, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// DocumentExecuteTool
// ============================================================================

export class DocumentExecuteTool implements ITool {
  readonly name = 'document';
  readonly description = 'Read Office documents (DOCX, XLSX, PPTX, CSV, RTF). Extracts text, metadata, and structure.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getDocument();
    const op = input.operation as string;
    const filePath = input.path as string;

    switch (op) {
      case 'read':
        return tool.readDocument(filePath);
      case 'list':
        return tool.listDocuments(filePath);
      default:
        return { success: false, error: `Unknown document operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['read', 'list'], description: 'Operation to perform' },
          path: { type: 'string', description: 'Path to document or directory' },
        },
        required: ['operation', 'path'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    if (typeof d.path !== 'string') return { valid: false, errors: ['path is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['document', 'docx', 'xlsx', 'pptx', 'csv', 'office'], priority: 4, modifiesFiles: false, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// ExportExecuteTool
// ============================================================================

export class ExportExecuteTool implements ITool {
  readonly name = 'export';
  readonly description = 'Export conversations to various formats: JSON, Markdown, HTML, plain text, or PDF.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getExport();
    const op = input.operation as string;

    switch (op) {
      case 'conversation':
        return tool.exportConversation(
          input.messages as Array<{ role: string; content: string; timestamp?: string }>,
          {
            format: input.format as 'json' | 'markdown' | 'html' | 'txt' | 'pdf' | undefined,
            outputPath: input.output_path as string | undefined,
            includeMetadata: input.include_metadata as boolean | undefined,
            includeTimestamps: input.include_timestamps as boolean | undefined,
          },
        );
      case 'csv':
        return tool.exportToCSV(
          input.data as Array<Record<string, unknown>>,
          { outputPath: input.output_path as string | undefined },
        );
      case 'code_snippets':
        return tool.exportCodeSnippets(
          input.messages as Array<{ role: string; content: string }>,
          { outputPath: input.output_path as string | undefined },
        );
      case 'list':
        return tool.listExports();
      default:
        return { success: false, error: `Unknown export operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['conversation', 'csv', 'code_snippets', 'list'], description: 'Export operation' },
          format: { type: 'string', enum: ['json', 'markdown', 'html', 'txt', 'pdf'], description: 'Export format' },
          messages: { type: 'array', description: 'Messages to export' },
          data: { type: 'array', description: 'Data array for CSV export' },
          title: { type: 'string', description: 'Title for the export' },
          include_metadata: { type: 'boolean', description: 'Include metadata' },
          include_timestamps: { type: 'boolean', description: 'Include timestamps' },
          output_path: { type: 'string', description: 'Output file path' },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['export', 'conversation', 'json', 'markdown', 'html', 'csv'], priority: 3, modifiesFiles: true, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// ArchiveExecuteTool
// ============================================================================

export class ArchiveExecuteTool implements ITool {
  readonly name = 'archive';
  readonly description = 'Work with compressed archives: ZIP, TAR, TAR.GZ, 7Z, RAR. List, extract, and create archives.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getArchive();
    const op = input.operation as string;

    switch (op) {
      case 'list':
        return tool.list(input.path as string);
      case 'extract':
        return tool.extract(input.path as string, {
          outputDir: input.output_dir as string | undefined,
          files: input.files as string[] | undefined,
          overwrite: input.overwrite as boolean | undefined,
          password: input.password as string | undefined,
        });
      case 'create':
        return tool.create(
          input.sources as string[],
          input.output_path as string,
          { format: input.format as 'zip' | 'tar' | 'tar.gz' | 'tar.bz2' | 'tar.xz' | undefined },
        );
      case 'list_archives':
        return tool.listArchives(input.path as string | undefined);
      default:
        return { success: false, error: `Unknown archive operation: ${op}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['list', 'extract', 'create', 'list_archives'], description: 'Archive operation' },
          path: { type: 'string', description: 'Path to archive file or directory' },
          sources: { type: 'array', items: { type: 'string' }, description: 'Source paths for creating archive' },
          output_dir: { type: 'string', description: 'Output directory for extraction' },
          output_path: { type: 'string', description: 'Output path for created archive' },
          format: { type: 'string', enum: ['zip', 'tar', 'tar.gz', 'tar.bz2', 'tar.xz'], description: 'Archive format' },
          files: { type: 'array', items: { type: 'string' }, description: 'Specific files to extract' },
          password: { type: 'string', description: 'Password for encrypted archives' },
          overwrite: { type: 'boolean', description: 'Overwrite existing files' },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return { name: this.name, description: this.description, category: 'utility' as ToolCategoryType, keywords: ['archive', 'zip', 'tar', 'compress', 'extract', '7z', 'rar'], priority: 3, requiresConfirmation: true, modifiesFiles: true, makesNetworkRequests: false };
  }

  isAvailable(): boolean { return true; }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create all multimodal tool instances
 */
export function createMultimodalTools(): ITool[] {
  return [
    new AudioExecuteTool(),
    new VideoExecuteTool(),
    new PDFExecuteTool(),
    new OCRExecuteTool(),
    new QRExecuteTool(),
    new ClipboardExecuteTool(),
    new DiagramExecuteTool(),
    new DocumentExecuteTool(),
    new ExportExecuteTool(),
    new ArchiveExecuteTool(),
  ];
}
