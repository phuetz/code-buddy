/**
 * PDF Agent
 *
 * Specialized agent for PDF extraction and analysis.
 * Uses pdf-parse for text extraction.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { extname } from 'path';
import {
  SpecializedAgent,
  SpecializedAgentConfig,
  AgentTask,
  AgentResult,
  PDFMetadata,
  PDFPage,
  PDFExtractResult,
} from './types.js';
import { getErrorMessage } from '../../types/index.js';

// ============================================================================
// Configuration
// ============================================================================

const PDF_AGENT_CONFIG: SpecializedAgentConfig = {
  id: 'pdf-agent',
  name: 'PDF Agent',
  description: 'Extract text, metadata, and analyze PDF documents',
  capabilities: ['pdf-extract', 'pdf-analyze'],
  fileExtensions: ['pdf'],
  maxFileSize: 50 * 1024 * 1024, // 50MB
  requiredTools: [],
};

// ============================================================================
// PDF Agent Implementation
// ============================================================================

export class PDFAgent extends SpecializedAgent {
  private pdfParse: ((buffer: Buffer) => Promise<any>) | null = null;

  constructor() {
    super(PDF_AGENT_CONFIG);
  }

  async initialize(): Promise<void> {
    try {
      // Dynamic import of pdf-parse
      // @ts-expect-error - Optional dependency
      const pdfParseModule = await import('pdf-parse');
      this.pdfParse = pdfParseModule.default || pdfParseModule;
      this.isInitialized = true;
      this.emit('initialized');
    } catch (_error) {
      // pdf-parse not available, will use fallback
      this.isInitialized = true;
      this.emit('initialized', { warning: 'pdf-parse not available, using limited functionality' });
    }
  }

  getSupportedActions(): string[] {
    return ['extract', 'metadata', 'analyze', 'search', 'summarize'];
  }

  getActionHelp(action: string): string {
    const help: Record<string, string> = {
      extract: 'Extract all text content from a PDF file',
      metadata: 'Get PDF metadata (title, author, page count, etc.)',
      analyze: 'Analyze PDF structure and content statistics',
      search: 'Search for text patterns in the PDF',
      summarize: 'Generate a summary of the PDF content',
    };
    return help[action] || `Unknown action: ${action}`;
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      if (!task.inputFiles || task.inputFiles.length === 0) {
        return {
          success: false,
          error: 'No input file specified',
        };
      }

      const filePath = task.inputFiles[0];

      // Validate file
      if (!existsSync(filePath)) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }

      const ext = extname(filePath).toLowerCase();
      if (ext !== '.pdf') {
        return {
          success: false,
          error: `Not a PDF file: ${filePath}`,
        };
      }

      const stats = statSync(filePath);
      if (this.config.maxFileSize && stats.size > this.config.maxFileSize) {
        return {
          success: false,
          error: `File too large: ${stats.size} bytes (max: ${this.config.maxFileSize})`,
        };
      }

      // Execute action
      switch (task.action) {
        case 'extract':
          return await this.extractText(filePath, startTime);
        case 'metadata':
          return await this.getMetadata(filePath, startTime);
        case 'analyze':
          return await this.analyzePDF(filePath, startTime);
        case 'search':
          return await this.searchPDF(filePath, task.params?.pattern as string, startTime);
        case 'summarize':
          return await this.summarizePDF(filePath, startTime);
        default:
          return {
            success: false,
            error: `Unknown action: ${task.action}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `PDF processing error: ${getErrorMessage(error)}`,
        duration: Date.now() - startTime,
      };
    }
  }

  private async extractText(filePath: string, startTime: number): Promise<AgentResult> {
    const result = await this.parsePDF(filePath);

    if (!result.success) {
      return result;
    }

    const extractResult = result.data as PDFExtractResult;

    return {
      success: true,
      data: extractResult,
      output: `Extracted ${extractResult.pages.length} pages, ${extractResult.text.length} characters`,
      duration: Date.now() - startTime,
      metadata: {
        pageCount: extractResult.metadata.pageCount,
        charCount: extractResult.text.length,
        wordCount: extractResult.text.split(/\s+/).filter(w => w).length,
      },
    };
  }

  private async getMetadata(filePath: string, startTime: number): Promise<AgentResult> {
    const result = await this.parsePDF(filePath);

    if (!result.success) {
      return result;
    }

    const extractResult = result.data as PDFExtractResult;

    return {
      success: true,
      data: extractResult.metadata,
      output: this.formatMetadata(extractResult.metadata),
      duration: Date.now() - startTime,
    };
  }

  private async analyzePDF(filePath: string, startTime: number): Promise<AgentResult> {
    const result = await this.parsePDF(filePath);

    if (!result.success) {
      return result;
    }

    const extractResult = result.data as PDFExtractResult;
    const text = extractResult.text;

    // Analyze content
    const words = text.split(/\s+/).filter(w => w);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim());
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

    // Word frequency
    const wordFreq: Record<string, number> = {};
    for (const word of words) {
      const normalized = word.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalized.length > 2) {
        wordFreq[normalized] = (wordFreq[normalized] || 0) + 1;
      }
    }

    // Top words
    const topWords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({ word, count }));

    const analysis = {
      metadata: extractResult.metadata,
      statistics: {
        pageCount: extractResult.pages.length,
        characterCount: text.length,
        wordCount: words.length,
        sentenceCount: sentences.length,
        paragraphCount: paragraphs.length,
        avgWordsPerSentence: Math.round(words.length / sentences.length) || 0,
        avgWordsPerPage: Math.round(words.length / extractResult.pages.length) || 0,
      },
      topWords,
      pageStats: extractResult.pages.map(p => ({
        page: p.pageNumber,
        characters: p.text.length,
        words: p.text.split(/\s+/).filter(w => w).length,
      })),
    };

    return {
      success: true,
      data: analysis,
      output: this.formatAnalysis(analysis),
      duration: Date.now() - startTime,
    };
  }

  private async searchPDF(filePath: string, pattern: string, startTime: number): Promise<AgentResult> {
    if (!pattern) {
      return {
        success: false,
        error: 'Search pattern is required',
      };
    }

    const result = await this.parsePDF(filePath);

    if (!result.success) {
      return result;
    }

    const extractResult = result.data as PDFExtractResult;
    const regex = new RegExp(pattern, 'gi');
    const matches: Array<{ page: number; context: string; position: number }> = [];

    for (const page of extractResult.pages) {
      let match;
      while ((match = regex.exec(page.text)) !== null) {
        // Get context around match
        const start = Math.max(0, match.index - 50);
        const end = Math.min(page.text.length, match.index + match[0].length + 50);
        const context = page.text.slice(start, end).replace(/\n/g, ' ');

        matches.push({
          page: page.pageNumber,
          context: `...${context}...`,
          position: match.index,
        });
      }
    }

    return {
      success: true,
      data: { pattern, matches, matchCount: matches.length },
      output: `Found ${matches.length} matches for "${pattern}"`,
      duration: Date.now() - startTime,
    };
  }

  private async summarizePDF(filePath: string, startTime: number): Promise<AgentResult> {
    const result = await this.parsePDF(filePath);

    if (!result.success) {
      return result;
    }

    const extractResult = result.data as PDFExtractResult;
    const text = extractResult.text;

    // Simple extractive summary (first sentences from each page)
    const summaryParts: string[] = [];
    for (const page of extractResult.pages.slice(0, 5)) { // First 5 pages
      const sentences = page.text.split(/[.!?]+/).filter(s => s.trim());
      if (sentences.length > 0) {
        summaryParts.push(sentences[0].trim() + '.');
      }
    }

    const summary = summaryParts.join(' ').slice(0, 1000);

    return {
      success: true,
      data: {
        summary,
        metadata: extractResult.metadata,
        wordCount: text.split(/\s+/).filter(w => w).length,
      },
      output: `Summary (${extractResult.pages.length} pages):\n\n${summary}`,
      duration: Date.now() - startTime,
    };
  }

  private async parsePDF(filePath: string): Promise<AgentResult> {
    const buffer = readFileSync(filePath);
    const stats = statSync(filePath);

    if (this.pdfParse) {
      try {
        const data = await this.pdfParse(buffer);

        const metadata: PDFMetadata = {
          title: data.info?.Title,
          author: data.info?.Author,
          subject: data.info?.Subject,
          keywords: data.info?.Keywords?.split(',').map((k: string) => k.trim()),
          creator: data.info?.Creator,
          producer: data.info?.Producer,
          creationDate: data.info?.CreationDate ? new Date(data.info.CreationDate) : undefined,
          modificationDate: data.info?.ModDate ? new Date(data.info.ModDate) : undefined,
          pageCount: data.numpages,
          fileSize: stats.size,
        };

        // Split text by page (approximate)
        const textPerPage = Math.ceil(data.text.length / data.numpages);
        const pages: PDFPage[] = [];

        for (let i = 0; i < data.numpages; i++) {
          const start = i * textPerPage;
          const end = Math.min((i + 1) * textPerPage, data.text.length);
          pages.push({
            pageNumber: i + 1,
            text: data.text.slice(start, end),
          });
        }

        const extractResult: PDFExtractResult = {
          metadata,
          pages,
          text: data.text,
        };

        return {
          success: true,
          data: extractResult,
        };
      } catch (error) {
        return {
          success: false,
          error: `PDF parse error: ${getErrorMessage(error)}`,
        };
      }
    }

    // Fallback: return basic info without text extraction
    return {
      success: true,
      data: {
        metadata: {
          pageCount: 0,
          fileSize: stats.size,
        },
        pages: [],
        text: '[PDF text extraction not available - install pdf-parse]',
      } as PDFExtractResult,
      output: 'Warning: pdf-parse not available. Install with: npm install pdf-parse',
    };
  }

  private formatMetadata(metadata: PDFMetadata): string {
    const lines: string[] = [
      '┌─────────────────────────────────────────┐',
      '│           PDF METADATA                  │',
      '├─────────────────────────────────────────┤',
    ];

    if (metadata.title) lines.push(`│ Title: ${metadata.title.slice(0, 35).padEnd(35)}│`);
    if (metadata.author) lines.push(`│ Author: ${metadata.author.slice(0, 34).padEnd(34)}│`);
    if (metadata.subject) lines.push(`│ Subject: ${metadata.subject.slice(0, 33).padEnd(33)}│`);
    lines.push(`│ Pages: ${String(metadata.pageCount).padEnd(35)}│`);
    lines.push(`│ Size: ${this.formatBytes(metadata.fileSize).padEnd(36)}│`);
    if (metadata.creationDate) {
      lines.push(`│ Created: ${metadata.creationDate.toISOString().slice(0, 19).padEnd(33)}│`);
    }

    lines.push('└─────────────────────────────────────────┘');
    return lines.join('\n');
  }

  private formatAnalysis(analysis: any): string {
    const lines: string[] = [
      '┌─────────────────────────────────────────┐',
      '│           PDF ANALYSIS                  │',
      '├─────────────────────────────────────────┤',
      `│ Pages: ${String(analysis.statistics.pageCount).padEnd(35)}│`,
      `│ Words: ${String(analysis.statistics.wordCount).padEnd(35)}│`,
      `│ Sentences: ${String(analysis.statistics.sentenceCount).padEnd(31)}│`,
      `│ Paragraphs: ${String(analysis.statistics.paragraphCount).padEnd(30)}│`,
      `│ Avg words/page: ${String(analysis.statistics.avgWordsPerPage).padEnd(26)}│`,
      '├─────────────────────────────────────────┤',
      '│ Top Words:                              │',
    ];

    for (const { word, count } of analysis.topWords.slice(0, 5)) {
      lines.push(`│   ${word.padEnd(25)} ${String(count).padStart(10)} │`);
    }

    lines.push('└─────────────────────────────────────────┘');
    return lines.join('\n');
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

// ============================================================================
// Factory
// ============================================================================

let pdfAgentInstance: PDFAgent | null = null;

export function getPDFAgent(): PDFAgent {
  if (!pdfAgentInstance) {
    pdfAgentInstance = new PDFAgent();
  }
  return pdfAgentInstance;
}

export async function createPDFAgent(): Promise<PDFAgent> {
  const agent = getPDFAgent();
  if (!agent.isReady()) {
    await agent.initialize();
  }
  return agent;
}
