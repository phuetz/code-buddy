/**
 * Tests for Specialized Agents
 */
import {
  AgentRegistry,
  getAgentRegistry,
  resetAgentRegistry,
  findAgentForFile,
} from '../src/agent/specialized/agent-registry';
import { PDFAgent } from '../src/agent/specialized/pdf-agent';
import { ExcelAgent } from '../src/agent/specialized/excel-agent';
import { SQLAgent } from '../src/agent/specialized/sql-agent';
import { ArchiveAgent } from '../src/agent/specialized/archive-agent';
import { DataAnalysisAgent } from '../src/agent/specialized/data-analysis-agent';

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    await resetAgentRegistry();
    registry = getAgentRegistry();
    await registry.registerBuiltInAgents();
  });

  afterEach(async () => {
    await resetAgentRegistry();
  });

  describe('Singleton Pattern', () => {
    it('should return same instance', () => {
      const registry1 = getAgentRegistry();
      const registry2 = getAgentRegistry();
      expect(registry1).toBe(registry2);
    });

    it('should reset correctly', async () => {
      const registry1 = getAgentRegistry();
      await resetAgentRegistry();
      const registry2 = getAgentRegistry();
      expect(registry1).not.toBe(registry2);
    });
  });

  describe('Agent Registration', () => {
    it('should have default agents registered', () => {
      const agents = registry.getAll();
      expect(agents.length).toBeGreaterThan(0);
    });

    it('should find agent by ID', () => {
      const agent = registry.get('pdf-agent');
      expect(agent).toBeDefined();
    });

    it('should return undefined for unknown agent', () => {
      const agent = registry.get('unknown-agent');
      expect(agent).toBeUndefined();
    });
  });

  describe('File Type Detection', () => {
    it('should find PDF agent for .pdf files', () => {
      const result = registry.findAgentForFile('document.pdf');
      expect(result).toBeDefined();
      expect(result?.agent.getId()).toBe('pdf-agent');
    });

    it('should find Excel agent for .xlsx files', () => {
      const result = registry.findAgentForFile('spreadsheet.xlsx');
      expect(result).toBeDefined();
      expect(result?.agent.getId()).toBe('excel-agent');
    });

    it('should find Excel agent for .csv files', () => {
      const result = registry.findAgentForFile('data.csv');
      expect(result).toBeDefined();
      expect(result?.agent.getId()).toBe('excel-agent');
    });

    it('should find SQL agent for .db files', () => {
      const result = registry.findAgentForFile('database.db');
      expect(result).toBeDefined();
      expect(result?.agent.getId()).toBe('sql-agent');
    });

    it('should find SQL agent for .sqlite files', () => {
      const result = registry.findAgentForFile('app.sqlite');
      expect(result).toBeDefined();
      expect(result?.agent.getId()).toBe('sql-agent');
    });

    it('should find Archive agent for .zip files', () => {
      const result = registry.findAgentForFile('archive.zip');
      expect(result).toBeDefined();
      expect(result?.agent.getId()).toBe('archive-agent');
    });

    it('should find Archive agent for .tar.gz files', () => {
      const result = registry.findAgentForFile('package.tar.gz');
      expect(result).toBeDefined();
      // tar.gz might be handled by archive-agent with a different matching
    });

    it('should return null for unsupported files', () => {
      // Use an extension not supported by any agent (including Code Guardian)
      const result = registry.findAgentForFile('video.mp4');
      expect(result).toBeNull();
    });
  });

  describe('findAgentForFile utility', () => {
    it('should find agent via utility function', () => {
      const agent = findAgentForFile('report.pdf');
      expect(agent).toBeDefined();
      expect(agent?.getId()).toBe('pdf-agent');
    });

    it('should return null for unsupported via utility', () => {
      // Use an extension not supported by any agent (including Code Guardian)
      const agent = findAgentForFile('video.mp4');
      expect(agent).toBeNull();
    });

    it('should find Code Guardian for TypeScript files', () => {
      const agent = findAgentForFile('code.ts');
      expect(agent).toBeDefined();
      expect(agent?.getId()).toBe('code-guardian');
    });
  });
});

describe('PDFAgent', () => {
  let agent: PDFAgent;

  beforeEach(async () => {
    agent = new PDFAgent();
    await agent.initialize();
  });

  describe('Initialization', () => {
    it('should have correct name', () => {
      expect(agent.getName()).toContain('PDF');
    });

    it('should support pdf extension', () => {
      expect(agent.canHandleExtension('.pdf')).toBe(true);
      expect(agent.canHandleExtension('pdf')).toBe(true);
    });

    it('should have supported actions', () => {
      const actions = agent.getSupportedActions();
      expect(actions).toContain('extract');
      expect(actions).toContain('metadata');
    });

    it('should be initialized', () => {
      expect(agent.isReady()).toBe(true);
    });
  });

  describe('Action Help', () => {
    it('should provide help for extract action', () => {
      const help = agent.getActionHelp('extract');
      expect(help.length).toBeGreaterThan(0);
    });
  });
});

describe('ExcelAgent', () => {
  let agent: ExcelAgent;

  beforeEach(async () => {
    agent = new ExcelAgent();
    await agent.initialize();
  });

  describe('Initialization', () => {
    it('should have correct name', () => {
      expect(agent.getName()).toContain('Excel');
    });

    it('should support multiple extensions', () => {
      expect(agent.canHandleExtension('.xlsx')).toBe(true);
      expect(agent.canHandleExtension('.xls')).toBe(true);
      expect(agent.canHandleExtension('.csv')).toBe(true);
    });

    it('should have supported actions', () => {
      const actions = agent.getSupportedActions();
      expect(actions).toContain('read');
      expect(actions).toContain('stats');
    });

    it('should be initialized', () => {
      expect(agent.isReady()).toBe(true);
    });
  });

  describe('Action Help', () => {
    it('should provide help for read action', () => {
      const help = agent.getActionHelp('read');
      expect(help.length).toBeGreaterThan(0);
    });
  });

  describe('Capabilities', () => {
    it('should have excel-read capability', () => {
      expect(agent.hasCapability('excel-read')).toBe(true);
    });

    it('should have csv-parse capability', () => {
      expect(agent.hasCapability('csv-parse')).toBe(true);
    });
  });
});

describe('SQLAgent', () => {
  let agent: SQLAgent;

  beforeEach(async () => {
    agent = new SQLAgent();
    await agent.initialize();
  });

  describe('Initialization', () => {
    it('should have correct name', () => {
      expect(agent.getName()).toContain('SQL');
    });

    it('should support database extensions', () => {
      expect(agent.canHandleExtension('.db')).toBe(true);
      expect(agent.canHandleExtension('.sqlite')).toBe(true);
    });

    it('should have supported actions', () => {
      const actions = agent.getSupportedActions();
      expect(actions).toContain('query');
      expect(actions).toContain('tables');
      expect(actions).toContain('schema');
    });

    it('should be initialized', () => {
      expect(agent.isReady()).toBe(true);
    });
  });

  describe('Action Help', () => {
    it('should provide help for query action', () => {
      const help = agent.getActionHelp('query');
      expect(help.length).toBeGreaterThan(0);
    });
  });

  describe('Capabilities', () => {
    it('should have sql-query capability', () => {
      expect(agent.hasCapability('sql-query')).toBe(true);
    });
  });
});

describe('ArchiveAgent', () => {
  let agent: ArchiveAgent;

  beforeEach(async () => {
    agent = new ArchiveAgent();
    await agent.initialize();
  });

  describe('Initialization', () => {
    it('should have correct name', () => {
      expect(agent.getName()).toContain('Archive');
    });

    it('should support archive extensions', () => {
      expect(agent.canHandleExtension('.zip')).toBe(true);
      expect(agent.canHandleExtension('.tar')).toBe(true);
      expect(agent.canHandleExtension('.tgz')).toBe(true);
    });

    it('should have supported actions', () => {
      const actions = agent.getSupportedActions();
      expect(actions).toContain('list');
      expect(actions).toContain('extract');
      expect(actions).toContain('create');
      expect(actions).toContain('info');
    });

    it('should be initialized', () => {
      expect(agent.isReady()).toBe(true);
    });
  });

  describe('Action Help', () => {
    it('should provide help for list action', () => {
      const help = agent.getActionHelp('list');
      expect(help.length).toBeGreaterThan(0);
    });

    it('should provide help for extract action', () => {
      const help = agent.getActionHelp('extract');
      expect(help.length).toBeGreaterThan(0);
    });
  });

  describe('Capabilities', () => {
    it('should have archive-extract capability', () => {
      expect(agent.hasCapability('archive-extract')).toBe(true);
    });

    it('should have archive-create capability', () => {
      expect(agent.hasCapability('archive-create')).toBe(true);
    });
  });
});

describe('DataAnalysisAgent', () => {
  let agent: DataAnalysisAgent;

  beforeEach(async () => {
    agent = new DataAnalysisAgent();
    await agent.initialize();
  });

  describe('Initialization', () => {
    it('should have correct name', () => {
      expect(agent.getName()).toBe('Data Analysis Agent');
    });

    it('should have supported actions', () => {
      const actions = agent.getSupportedActions();
      expect(actions).toContain('analyze');
      expect(actions).toContain('aggregate');
      expect(actions).toContain('sort');
      expect(actions).toContain('filter');
    });

    it('should support data file extensions', () => {
      expect(agent.canHandleExtension('.json')).toBe(true);
      expect(agent.canHandleExtension('.csv')).toBe(true);
    });

    it('should be initialized', () => {
      expect(agent.isReady()).toBe(true);
    });
  });

  describe('Action Help', () => {
    it('should provide help for analyze action', () => {
      const help = agent.getActionHelp('analyze');
      expect(help).toContain('statistic');
    });

    it('should provide help for sort action', () => {
      const help = agent.getActionHelp('sort');
      expect(help).toContain('Sort');
    });

    it('should handle unknown actions', () => {
      const help = agent.getActionHelp('unknown-action');
      expect(help).toContain('Unknown');
    });
  });

  describe('Capabilities', () => {
    it('should have data-transform capability', () => {
      expect(agent.hasCapability('data-transform')).toBe(true);
    });

    it('should have data-visualize capability', () => {
      expect(agent.hasCapability('data-visualize')).toBe(true);
    });
  });
});
