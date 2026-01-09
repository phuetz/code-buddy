/**
 * Unit tests for ExcelAgent
 * Tests Excel/CSV reading, writing, and data manipulation functionality
 */

import { ExcelAgent, getExcelAgent, createExcelAgent } from '../../src/agent/specialized/excel-agent';
import { AgentTask } from '../../src/agent/specialized/types';
import * as fs from 'fs';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

// Mock xlsx module
const mockXlsx = {
  read: jest.fn(),
  utils: {
    book_new: jest.fn(() => ({})),
    aoa_to_sheet: jest.fn(() => ({})),
    book_append_sheet: jest.fn(),
    sheet_to_json: jest.fn(),
  },
  writeFile: jest.fn(),
};
jest.mock('xlsx', () => mockXlsx, { virtual: true });

describe('ExcelAgent', () => {
  let agent: ExcelAgent;
  const mockCsvContent = 'name,age,city\nJohn,30,NYC\nJane,25,LA\nBob,35,Chicago';
  const mockTsvContent = 'name\tage\tcity\nJohn\t30\tNYC\nJane\t25\tLA';

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new ExcelAgent();

    // Default mock implementations
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockImplementation((path: string) => {
      if (path.endsWith('.csv')) return mockCsvContent;
      if (path.endsWith('.tsv')) return mockTsvContent;
      return Buffer.from('mock excel content');
    });

    mockXlsx.read.mockReturnValue({
      SheetNames: ['Sheet1', 'Sheet2'],
      Sheets: {
        Sheet1: {},
        Sheet2: {},
      },
      Props: {
        Creator: 'Test Creator',
        LastAuthor: 'Test Author',
      },
    });
    mockXlsx.utils.sheet_to_json.mockReturnValue([
      ['name', 'age', 'city'],
      ['John', 30, 'NYC'],
      ['Jane', 25, 'LA'],
    ]);
  });

  describe('Constructor and Configuration', () => {
    it('should create agent with correct ID', () => {
      expect(agent.getId()).toBe('excel-agent');
    });

    it('should create agent with correct name', () => {
      expect(agent.getName()).toBe('Excel Agent');
    });

    it('should have excel-read capability', () => {
      expect(agent.hasCapability('excel-read')).toBe(true);
    });

    it('should have excel-write capability', () => {
      expect(agent.hasCapability('excel-write')).toBe(true);
    });

    it('should have csv-parse capability', () => {
      expect(agent.hasCapability('csv-parse')).toBe(true);
    });

    it('should handle xlsx extension', () => {
      expect(agent.canHandleExtension('xlsx')).toBe(true);
    });

    it('should handle xls extension', () => {
      expect(agent.canHandleExtension('xls')).toBe(true);
    });

    it('should handle csv extension', () => {
      expect(agent.canHandleExtension('csv')).toBe(true);
    });

    it('should handle tsv extension', () => {
      expect(agent.canHandleExtension('tsv')).toBe(true);
    });

    it('should not handle unsupported extensions', () => {
      expect(agent.canHandleExtension('pdf')).toBe(false);
      expect(agent.canHandleExtension('txt')).toBe(false);
    });
  });

  describe('initialize()', () => {
    it('should initialize successfully with xlsx available', async () => {
      const emitSpy = jest.spyOn(agent, 'emit');

      await agent.initialize();

      expect(agent.isReady()).toBe(true);
      expect(emitSpy).toHaveBeenCalledWith('initialized');
    });

    it('should initialize with warning when xlsx not available', async () => {
      // Mock xlsx import failure
      jest.doMock('xlsx', () => {
        throw new Error('Module not found');
      }, { virtual: true });

      const freshAgent = new ExcelAgent();
      const emitSpy = jest.spyOn(freshAgent, 'emit');

      await freshAgent.initialize();

      expect(freshAgent.isReady()).toBe(true);
    });
  });

  describe('getSupportedActions()', () => {
    it('should return all supported actions', () => {
      const actions = agent.getSupportedActions();

      expect(actions).toContain('read');
      expect(actions).toContain('write');
      expect(actions).toContain('sheets');
      expect(actions).toContain('convert');
      expect(actions).toContain('filter');
      expect(actions).toContain('stats');
      expect(actions).toContain('merge');
    });
  });

  describe('getActionHelp()', () => {
    it('should return help for read action', () => {
      const help = agent.getActionHelp('read');
      expect(help).toContain('Read');
    });

    it('should return help for write action', () => {
      const help = agent.getActionHelp('write');
      expect(help).toContain('Write');
    });

    it('should return help for sheets action', () => {
      const help = agent.getActionHelp('sheets');
      expect(help).toContain('sheets');
    });

    it('should return help for convert action', () => {
      const help = agent.getActionHelp('convert');
      expect(help).toContain('Convert');
    });

    it('should return help for filter action', () => {
      const help = agent.getActionHelp('filter');
      expect(help).toContain('Filter');
    });

    it('should return help for stats action', () => {
      const help = agent.getActionHelp('stats');
      expect(help).toContain('statistics');
    });

    it('should return help for merge action', () => {
      const help = agent.getActionHelp('merge');
      expect(help).toContain('Merge');
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

    describe('read action', () => {
      it('should read CSV file successfully', async () => {
        const task: AgentTask = {
          action: 'read',
          inputFiles: ['/test/data.csv'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.metadata?.rowCount).toBeGreaterThan(0);
      });

      it('should read TSV file successfully', async () => {
        const task: AgentTask = {
          action: 'read',
          inputFiles: ['/test/data.tsv'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
      });

      it('should return error when no input file specified', async () => {
        const task: AgentTask = {
          action: 'read',
          inputFiles: [],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('No input file');
      });

      it('should return error when file not found', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);

        const task: AgentTask = {
          action: 'read',
          inputFiles: ['/nonexistent/file.csv'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('File not found');
      });

      it('should apply row limit when specified', async () => {
        const task: AgentTask = {
          action: 'read',
          inputFiles: ['/test/data.csv'],
          params: { limit: 2 },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
      });

      it('should read specific sheet by name', async () => {
        const task: AgentTask = {
          action: 'read',
          inputFiles: ['/test/data.xlsx'],
          params: { sheet: 'Sheet1' },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
      });
    });

    describe('write action', () => {
      it('should write CSV file successfully', async () => {
        const task: AgentTask = {
          action: 'write',
          outputFile: '/test/output.csv',
          data: [
            ['name', 'age'],
            ['John', 30],
            ['Jane', 25],
          ],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.outputFile).toBe('/test/output.csv');
        expect(fs.writeFileSync).toHaveBeenCalled();
      });

      it('should write TSV file successfully', async () => {
        const task: AgentTask = {
          action: 'write',
          outputFile: '/test/output.tsv',
          data: [
            ['name', 'age'],
            ['John', 30],
          ],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
      });

      it('should return error when no output file specified', async () => {
        const task: AgentTask = {
          action: 'write',
          data: [['a', 'b']],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('No output file');
      });

      it('should return error when no data to write', async () => {
        const task: AgentTask = {
          action: 'write',
          outputFile: '/test/output.csv',
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('No data');
      });

      it('should return error for invalid data type', async () => {
        const task: AgentTask = {
          action: 'write',
          outputFile: '/test/output.csv',
          data: 'invalid',
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('No data');
      });
    });

    describe('sheets action', () => {
      it('should list sheets from Excel file', async () => {
        const task: AgentTask = {
          action: 'sheets',
          inputFiles: ['/test/data.xlsx'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
      });

      it('should return single sheet info for CSV', async () => {
        const task: AgentTask = {
          action: 'sheets',
          inputFiles: ['/test/data.csv'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.output).toContain('single implicit sheet');
      });

      it('should return error when no input file specified', async () => {
        const task: AgentTask = {
          action: 'sheets',
          inputFiles: [],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('No input file');
      });
    });

    describe('convert action', () => {
      it('should convert CSV to another format', async () => {
        const task: AgentTask = {
          action: 'convert',
          inputFiles: ['/test/input.csv'],
          outputFile: '/test/output.tsv',
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(fs.writeFileSync).toHaveBeenCalled();
      });

      it('should return error when no output file specified', async () => {
        const task: AgentTask = {
          action: 'convert',
          inputFiles: ['/test/input.csv'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('No output file');
      });
    });

    describe('filter action', () => {
      it('should filter rows by column value', async () => {
        const task: AgentTask = {
          action: 'filter',
          inputFiles: ['/test/data.csv'],
          params: {
            column: 'city',
            value: 'NYC',
          },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
      });

      it('should filter with equality operator', async () => {
        const task: AgentTask = {
          action: 'filter',
          inputFiles: ['/test/data.csv'],
          params: {
            column: 'age',
            operator: '==',
            value: '30',
          },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
      });

      it('should filter with greater than operator', async () => {
        const task: AgentTask = {
          action: 'filter',
          inputFiles: ['/test/data.csv'],
          params: {
            column: 'age',
            operator: '>',
            value: '25',
          },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
      });

      it('should filter with contains operator', async () => {
        const task: AgentTask = {
          action: 'filter',
          inputFiles: ['/test/data.csv'],
          params: {
            column: 'name',
            operator: 'contains',
            value: 'Jo',
          },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
      });

      it('should return error when column or value missing', async () => {
        const task: AgentTask = {
          action: 'filter',
          inputFiles: ['/test/data.csv'],
          params: {
            column: 'city',
          },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('column and value');
      });

      it('should return error when column not found', async () => {
        const task: AgentTask = {
          action: 'filter',
          inputFiles: ['/test/data.csv'],
          params: {
            column: 'nonexistent',
            value: 'test',
          },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Column not found');
      });
    });

    describe('stats action', () => {
      it('should calculate statistics for data', async () => {
        const task: AgentTask = {
          action: 'stats',
          inputFiles: ['/test/data.csv'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.output).toContain('STATISTICS');
      });

      it('should return error when no input file specified', async () => {
        const task: AgentTask = {
          action: 'stats',
          inputFiles: [],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
      });
    });

    describe('merge action', () => {
      it('should merge multiple files', async () => {
        const task: AgentTask = {
          action: 'merge',
          inputFiles: ['/test/file1.csv', '/test/file2.csv'],
          outputFile: '/test/merged.csv',
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(fs.writeFileSync).toHaveBeenCalled();
      });

      it('should return error when less than 2 files specified', async () => {
        const task: AgentTask = {
          action: 'merge',
          inputFiles: ['/test/file1.csv'],
          outputFile: '/test/merged.csv',
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('2 input files');
      });

      it('should return error when no output file specified', async () => {
        const task: AgentTask = {
          action: 'merge',
          inputFiles: ['/test/file1.csv', '/test/file2.csv'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('No output file');
      });
    });

    describe('unknown action', () => {
      it('should return error for unknown action', async () => {
        const task: AgentTask = {
          action: 'unknown',
          inputFiles: ['/test/data.csv'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Unknown action');
      });
    });

    describe('error handling', () => {
      it('should catch and return errors gracefully', async () => {
        (fs.readFileSync as jest.Mock).mockImplementation(() => {
          throw new Error('Read error');
        });

        const task: AgentTask = {
          action: 'read',
          inputFiles: ['/test/data.csv'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.duration).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('CSV parsing', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('should handle quoted fields in CSV', async () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('name,city\n"John, Jr.",NYC');

      const task: AgentTask = {
        action: 'read',
        inputFiles: ['/test/data.csv'],
      };

      const result = await agent.execute(task);

      expect(result.success).toBe(true);
    });

    it('should handle escaped quotes in CSV', async () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('name,city\n"He said ""hello""",NYC');

      const task: AgentTask = {
        action: 'read',
        inputFiles: ['/test/data.csv'],
      };

      const result = await agent.execute(task);

      expect(result.success).toBe(true);
    });

    it('should handle empty cells in CSV', async () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('name,city\nJohn,\n,LA');

      const task: AgentTask = {
        action: 'read',
        inputFiles: ['/test/data.csv'],
      };

      const result = await agent.execute(task);

      expect(result.success).toBe(true);
    });
  });
});

describe('getExcelAgent singleton', () => {
  it('should return an ExcelAgent instance', () => {
    const agent = getExcelAgent();
    expect(agent).toBeInstanceOf(ExcelAgent);
  });

  it('should return same instance on multiple calls', () => {
    const agent1 = getExcelAgent();
    const agent2 = getExcelAgent();
    expect(agent1).toBe(agent2);
  });
});

describe('createExcelAgent factory', () => {
  it('should create and initialize an ExcelAgent', async () => {
    const agent = await createExcelAgent();
    expect(agent).toBeInstanceOf(ExcelAgent);
    expect(agent.isReady()).toBe(true);
  });
});
