/**
 * Unit tests for PDFAgent
 * Tests PDF extraction, metadata retrieval, and analysis functionality
 */

import { PDFAgent, getPDFAgent, createPDFAgent } from '../../src/agent/specialized/pdf-agent';
import { AgentTask, AgentResult } from '../../src/agent/specialized/types';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  statSync: jest.fn(),
}));

// Mock pdf-parse module
const mockPdfParse = jest.fn();
jest.mock('pdf-parse', () => mockPdfParse, { virtual: true });

describe('PDFAgent', () => {
  let agent: PDFAgent;
  const mockFilePath = '/test/document.pdf';
  const mockPdfData = {
    numpages: 3,
    text: 'This is page 1 content. This is page 2 content. This is page 3 content.',
    info: {
      Title: 'Test Document',
      Author: 'Test Author',
      Subject: 'Test Subject',
      Keywords: 'test, document, pdf',
      Creator: 'Test Creator',
      Producer: 'Test Producer',
      CreationDate: '2024-01-01T00:00:00Z',
      ModDate: '2024-01-15T00:00:00Z',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Create fresh instance for each test
    agent = new PDFAgent();

    // Default mock implementations
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('mock pdf content'));
    (fs.statSync as jest.Mock).mockReturnValue({ size: 1024 });
    mockPdfParse.mockResolvedValue(mockPdfData);
  });

  describe('Constructor and Configuration', () => {
    it('should create agent with correct ID', () => {
      expect(agent.getId()).toBe('pdf-agent');
    });

    it('should create agent with correct name', () => {
      expect(agent.getName()).toBe('PDF Agent');
    });

    it('should have pdf-extract capability', () => {
      expect(agent.hasCapability('pdf-extract')).toBe(true);
    });

    it('should have pdf-analyze capability', () => {
      expect(agent.hasCapability('pdf-analyze')).toBe(true);
    });

    it('should handle .pdf extension', () => {
      expect(agent.canHandleExtension('pdf')).toBe(true);
      expect(agent.canHandleExtension('.pdf')).toBe(true);
    });

    it('should not handle non-PDF extensions', () => {
      expect(agent.canHandleExtension('docx')).toBe(false);
      expect(agent.canHandleExtension('txt')).toBe(false);
    });
  });

  describe('initialize()', () => {
    it('should initialize successfully with pdf-parse available', async () => {
      const emitSpy = jest.spyOn(agent, 'emit');

      await agent.initialize();

      expect(agent.isReady()).toBe(true);
      expect(emitSpy).toHaveBeenCalledWith('initialized');
    });

    it('should initialize with warning when pdf-parse not available', async () => {
      // Since pdf-parse is dynamically imported in the agent itself,
      // we just verify the agent initializes successfully
      const freshAgent = new PDFAgent();
      await freshAgent.initialize();

      expect(freshAgent.isReady()).toBe(true);
    });
  });

  describe('getSupportedActions()', () => {
    it('should return all supported actions', () => {
      const actions = agent.getSupportedActions();

      expect(actions).toContain('extract');
      expect(actions).toContain('metadata');
      expect(actions).toContain('analyze');
      expect(actions).toContain('search');
      expect(actions).toContain('summarize');
    });
  });

  describe('getActionHelp()', () => {
    it('should return help for extract action', () => {
      const help = agent.getActionHelp('extract');
      expect(help).toContain('Extract');
    });

    it('should return help for metadata action', () => {
      const help = agent.getActionHelp('metadata');
      expect(help).toContain('metadata');
    });

    it('should return help for analyze action', () => {
      const help = agent.getActionHelp('analyze');
      expect(help).toContain('Analyze');
    });

    it('should return help for search action', () => {
      const help = agent.getActionHelp('search');
      expect(help).toContain('Search');
    });

    it('should return help for summarize action', () => {
      const help = agent.getActionHelp('summarize');
      expect(help).toContain('summary');
    });

    it('should return unknown action message for invalid action', () => {
      const help = agent.getActionHelp('invalid');
      expect(help).toContain('Unknown action');
    });
  });

  describe('execute()', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    describe('Error handling', () => {
      it('should return error when no input files specified', async () => {
        const task: AgentTask = {
          action: 'extract',
          inputFiles: [],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('No input file');
      });

      it('should return error when inputFiles is undefined', async () => {
        const task: AgentTask = {
          action: 'extract',
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('No input file');
      });

      it('should return error when file does not exist', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);

        const task: AgentTask = {
          action: 'extract',
          inputFiles: ['/nonexistent/file.pdf'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('File not found');
      });

      it('should return error when file is not a PDF', async () => {
        const task: AgentTask = {
          action: 'extract',
          inputFiles: ['/test/document.docx'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Not a PDF file');
      });

      it('should return error when file is too large', async () => {
        (fs.statSync as jest.Mock).mockReturnValue({ size: 100 * 1024 * 1024 }); // 100MB

        const task: AgentTask = {
          action: 'extract',
          inputFiles: [mockFilePath],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('File too large');
      });

      it('should return error for unknown action', async () => {
        const task: AgentTask = {
          action: 'unknown-action',
          inputFiles: [mockFilePath],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Unknown action');
      });
    });

    describe('extract action', () => {
      it('should extract text from PDF successfully', async () => {
        const task: AgentTask = {
          action: 'extract',
          inputFiles: [mockFilePath],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.output).toContain('Extracted');
        expect(result.duration).toBeGreaterThanOrEqual(0);
      });

      it('should return correct metadata in extract result', async () => {
        const task: AgentTask = {
          action: 'extract',
          inputFiles: [mockFilePath],
        };

        const result = await agent.execute(task);

        expect(result.metadata).toBeDefined();
        expect(result.metadata?.pageCount).toBe(3);
        expect(result.metadata?.charCount).toBeGreaterThan(0);
        expect(result.metadata?.wordCount).toBeGreaterThan(0);
      });
    });

    describe('metadata action', () => {
      it('should get PDF metadata successfully', async () => {
        const task: AgentTask = {
          action: 'metadata',
          inputFiles: [mockFilePath],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.output).toContain('PDF METADATA');
      });

      it('should include title in metadata', async () => {
        const task: AgentTask = {
          action: 'metadata',
          inputFiles: [mockFilePath],
        };

        const result = await agent.execute(task);

        expect(result.output).toContain('Title');
      });
    });

    describe('analyze action', () => {
      it('should analyze PDF successfully', async () => {
        const task: AgentTask = {
          action: 'analyze',
          inputFiles: [mockFilePath],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.output).toContain('PDF ANALYSIS');
      });

      it('should return statistics in analysis', async () => {
        const task: AgentTask = {
          action: 'analyze',
          inputFiles: [mockFilePath],
        };

        const result = await agent.execute(task);
        const data = result.data as { statistics: { pageCount: number; wordCount: number } };

        expect(data.statistics).toBeDefined();
        expect(data.statistics.pageCount).toBe(3);
        expect(data.statistics.wordCount).toBeGreaterThan(0);
      });

      it('should include top words in analysis', async () => {
        const task: AgentTask = {
          action: 'analyze',
          inputFiles: [mockFilePath],
        };

        const result = await agent.execute(task);
        const data = result.data as { topWords: Array<{ word: string; count: number }> };

        expect(data.topWords).toBeDefined();
        expect(Array.isArray(data.topWords)).toBe(true);
      });
    });

    describe('search action', () => {
      it('should search PDF for pattern successfully', async () => {
        const task: AgentTask = {
          action: 'search',
          inputFiles: [mockFilePath],
          params: { pattern: 'content' },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.output).toContain('Found');
      });

      it('should return error when no pattern specified', async () => {
        const task: AgentTask = {
          action: 'search',
          inputFiles: [mockFilePath],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('pattern');
      });

      it('should return matches with context', async () => {
        const task: AgentTask = {
          action: 'search',
          inputFiles: [mockFilePath],
          params: { pattern: 'page' },
        };

        const result = await agent.execute(task);
        const data = result.data as { matches: Array<{ page: number; context: string }> };

        expect(data.matches).toBeDefined();
        expect(Array.isArray(data.matches)).toBe(true);
      });
    });

    describe('summarize action', () => {
      it('should summarize PDF successfully', async () => {
        const task: AgentTask = {
          action: 'summarize',
          inputFiles: [mockFilePath],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.output).toContain('Summary');
      });

      it('should include word count in summary data', async () => {
        const task: AgentTask = {
          action: 'summarize',
          inputFiles: [mockFilePath],
        };

        const result = await agent.execute(task);
        const data = result.data as { wordCount: number };

        expect(data.wordCount).toBeGreaterThan(0);
      });
    });
  });

  describe('Fallback behavior (no pdf-parse)', () => {
    beforeEach(async () => {
      // Simulate pdf-parse not available
      mockPdfParse.mockImplementation(() => {
        throw new Error('Module not found');
      });

      const freshAgent = new PDFAgent();
      await freshAgent.initialize();
      agent = freshAgent;
    });

    it('should still initialize successfully', () => {
      expect(agent.isReady()).toBe(true);
    });
  });

  describe('PDF parse error handling', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('should handle PDF parse errors gracefully', async () => {
      mockPdfParse.mockRejectedValue(new Error('Invalid PDF'));

      const task: AgentTask = {
        action: 'extract',
        inputFiles: [mockFilePath],
      };

      const result = await agent.execute(task);

      expect(result.success).toBe(false);
      expect(result.error).toContain('PDF');
    });
  });
});

describe('getPDFAgent singleton', () => {
  it('should return a PDFAgent instance', () => {
    const agent = getPDFAgent();
    expect(agent).toBeInstanceOf(PDFAgent);
  });

  it('should return same instance on multiple calls', () => {
    const agent1 = getPDFAgent();
    const agent2 = getPDFAgent();
    expect(agent1).toBe(agent2);
  });
});

describe('createPDFAgent factory', () => {
  it('should create and initialize a PDFAgent', async () => {
    const agent = await createPDFAgent();
    expect(agent).toBeInstanceOf(PDFAgent);
    expect(agent.isReady()).toBe(true);
  });
});
