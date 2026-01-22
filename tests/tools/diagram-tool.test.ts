import { DiagramTool } from '../../src/tools/diagram-tool.js';
import { UnifiedVfsRouter } from '../../src/services/vfs/unified-vfs-router.js';
import { EventEmitter } from 'events';

// Define mocks inside the factory
jest.mock('../../src/services/vfs/unified-vfs-router.js', () => ({
  UnifiedVfsRouter: {
    Instance: {
      ensureDir: jest.fn(),
      exists: jest.fn(),
      writeFile: jest.fn(),
      readFile: jest.fn(),
      remove: jest.fn(),
      readDirectory: jest.fn(),
      stat: jest.fn(),
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

describe('DiagramTool', () => {
  let tool: DiagramTool;
  const mockVfs = UnifiedVfsRouter.Instance as unknown as {
    ensureDir: jest.Mock;
    exists: jest.Mock;
    writeFile: jest.Mock;
    readFile: jest.Mock;
    remove: jest.Mock;
    readDirectory: jest.Mock;
    stat: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new DiagramTool();
  });

  const mockProcess = () => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = jest.fn();
    return proc;
  };

  describe('generateFromMermaid', () => {
    it('should generate ASCII diagram', async () => {
      mockVfs.ensureDir.mockResolvedValue(undefined);
      
      const result = await tool.generateFromMermaid('graph TD; A-->B;', { outputFormat: 'ascii' });
      
      expect(result.success).toBe(true);
      expect((result.data as any).format).toBe('ascii');
      expect(result.output).toContain('No nodes found in flowchart'); // Basic mock implementation check
    });

    it('should generate diagram with mmdc', async () => {
      mockVfs.ensureDir.mockResolvedValue(undefined);
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readFile.mockResolvedValue('<svg>...</svg>');
      mockExecSync.mockReturnValue(Buffer.from('10.0.0')); // mmdc version check

      const proc = mockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = tool.generateFromMermaid('graph TD; A-->B;');

      setTimeout(() => proc.emit('close', 0), 10);

      const result = await promise;

      expect(result.success).toBe(true);
      expect((result.data as any).format).toBe('svg');
      expect(result.output).toContain('Diagram generated');
    });

    it('should fallback when mmdc is missing', async () => {
      mockVfs.ensureDir.mockResolvedValue(undefined);
      mockExecSync.mockImplementation(() => { throw new Error('Command failed'); });

      const result = await tool.generateFromMermaid('graph TD; A-->B;');

      expect(result.success).toBe(true);
      expect(result.output).toContain('Mermaid CLI not installed');
      expect((result.data as any).format).toBe('mermaid');
    });

    it('should handle mmdc failure', async () => {
      mockVfs.ensureDir.mockResolvedValue(undefined);
      mockExecSync.mockReturnValue(Buffer.from('10.0.0'));
      mockVfs.exists.mockResolvedValue(true); // Temp file exists

      const proc = mockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = tool.generateFromMermaid('graph TD; A-->B;');

      setTimeout(() => proc.emit('close', 1), 10);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('Mermaid CLI failed');
    });
  });

  describe('generateFlowchart', () => {
    it('should generate flowchart mermaid code', async () => {
      // Mock generateFromMermaid behavior (fallback mode)
      mockExecSync.mockImplementation(() => { throw new Error('Command failed'); });
      mockVfs.ensureDir.mockResolvedValue(undefined);

      const nodes = [{ id: 'A', label: 'Start', type: 'round' as const }];
      const connections = [{ from: 'A', to: 'B', label: 'Go', type: 'arrow' as const }];

      const result = await tool.generateFlowchart(nodes, connections);

      expect(result.success).toBe(true);
      expect((result.data as any).mermaidCode).toContain('flowchart TD');
      expect((result.data as any).mermaidCode).toContain('A(Start)');
      expect((result.data as any).mermaidCode).toContain('A -- Go --> B');
    });
  });

  describe('generateSequenceDiagram', () => {
    it('should generate sequence diagram mermaid code', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('Command failed'); });
      mockVfs.ensureDir.mockResolvedValue(undefined);

      const participants = ['Alice', 'Bob'];
      const messages = [{ from: 'Alice', to: 'Bob', message: 'Hi', type: 'sync' as const }];

      const result = await tool.generateSequenceDiagram(participants, messages);

      expect(result.success).toBe(true);
      expect((result.data as any).mermaidCode).toContain('sequenceDiagram');
      expect((result.data as any).mermaidCode).toContain('participant Alice');
      expect((result.data as any).mermaidCode).toContain('Alice->>Bob: Hi');
    });
  });

  describe('generateClassDiagram', () => {
    it('should generate class diagram mermaid code', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('Command failed'); });
      mockVfs.ensureDir.mockResolvedValue(undefined);

      const classes = [{ name: 'User', attributes: ['+name: string'], methods: ['+getName()'] }];
      const relationships = [{ from: 'User', to: 'Person', type: 'inheritance' as const }];

      const result = await tool.generateClassDiagram(classes, relationships);

      expect(result.success).toBe(true);
      expect((result.data as any).mermaidCode).toContain('classDiagram');
      expect((result.data as any).mermaidCode).toContain('class User');
      expect((result.data as any).mermaidCode).toContain('+name: string');
      expect((result.data as any).mermaidCode).toContain('+getName()');
      expect((result.data as any).mermaidCode).toContain('Person <|-- User');
    });
  });

  describe('generatePieChart', () => {
    it('should generate pie chart mermaid code', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('Command failed'); });
      mockVfs.ensureDir.mockResolvedValue(undefined);

      const data = [{ label: 'A', value: 10 }, { label: 'B', value: 20 }];

      const result = await tool.generatePieChart('Test Chart', data);

      expect(result.success).toBe(true);
      expect((result.data as any).mermaidCode).toContain('pie title Test Chart');
      expect((result.data as any).mermaidCode).toContain('"A" : 10');
    });
  });

  describe('generateGanttChart', () => {
    it('should generate gantt chart mermaid code', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('Command failed'); });
      mockVfs.ensureDir.mockResolvedValue(undefined);

      const sections = [{
        name: 'Section 1',
        tasks: [{ name: 'Task 1', id: 't1', start: '2023-01-01', duration: '3d' }]
      }];

      const result = await tool.generateGanttChart('Project', sections);

      expect(result.success).toBe(true);
      expect((result.data as any).mermaidCode).toContain('gantt');
      expect((result.data as any).mermaidCode).toContain('title Project');
      expect((result.data as any).mermaidCode).toContain('section Section 1');
      expect((result.data as any).mermaidCode).toContain('Task 1: t1, 2023-01-01, 3d');
    });
  });

  describe('listDiagrams', () => {
    it('should list generated diagrams', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readDirectory.mockResolvedValue([
        { name: 'diagram.svg', isFile: true },
        { name: 'image.jpg', isFile: true }
      ]);
      mockVfs.stat.mockResolvedValue({ size: 1024 });

      const result = await tool.listDiagrams();

      expect(result.success).toBe(true);
      expect(result.output).toContain('diagram.svg');
      expect(result.output).not.toContain('image.jpg');
    });

    it('should handle no diagrams found', async () => {
      mockVfs.exists.mockResolvedValue(true);
      mockVfs.readDirectory.mockResolvedValue([]);

      const result = await tool.listDiagrams();

      expect(result.success).toBe(true);
      expect(result.output).toContain('No diagrams found');
    });

    it('should handle directory not found', async () => {
      mockVfs.exists.mockResolvedValue(false);

      const result = await tool.listDiagrams();

      expect(result.success).toBe(true);
      expect(result.output).toContain('No diagrams generated yet');
    });
  });
});
