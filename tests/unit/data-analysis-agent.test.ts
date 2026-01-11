/**
 * Unit tests for DataAnalysisAgent
 * Tests data manipulation, transformation, and statistical analysis functionality
 */

import { DataAnalysisAgent, getDataAnalysisAgent, createDataAnalysisAgent } from '../../src/agent/specialized/data-analysis-agent';
import { AgentTask } from '../../src/agent/specialized/types';
import * as fs from 'fs';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

describe('DataAnalysisAgent', () => {
  let agent: DataAnalysisAgent;
  const mockData = [
    { id: 1, name: 'Alice', age: 30, city: 'New York', salary: 50000 },
    { id: 2, name: 'Bob', age: 25, city: 'London', salary: 40000 },
    { id: 3, name: 'Charlie', age: 35, city: 'New York', salary: 60000 },
    { id: 4, name: 'David', age: 40, city: 'Paris', salary: 70000 },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new DataAnalysisAgent();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
  });

  describe('Constructor and Configuration', () => {
    it('should create agent with correct ID', () => {
      expect(agent.getId()).toBe('data-analysis-agent');
    });

    it('should have data capabilities', () => {
      expect(agent.hasCapability('data-transform')).toBe(true);
      expect(agent.hasCapability('data-visualize')).toBe(true);
    });
  });

  describe('execute() with in-memory data', () => {
    it('should analyze in-memory data successfully', async () => {
      const result = await agent.execute({
        action: 'analyze',
        data: mockData,
      });

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.rowCount).toBe(4);
      expect(data.columnCount).toBe(5);
      expect(result.output).toContain('DATA ANALYSIS');
    });

    it('should describe in-memory data successfully', async () => {
      const result = await agent.execute({
        action: 'describe',
        data: mockData,
      });

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.age).toBeDefined();
      expect(data.age.mean).toBe(32.5);
    });
  });

  describe('execute() with file data', () => {
    it('should load and analyze JSON file', async () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockData));

      const result = await agent.execute({
        action: 'analyze',
        inputFiles: ['test.json'],
      });

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.rowCount).toBe(4);
    });

    it('should load and analyze CSV file', async () => {
      const csvContent = 'id,name,age\n1,Alice,30\n2,Bob,25';
      (fs.readFileSync as jest.Mock).mockReturnValue(csvContent);

      const result = await agent.execute({
        action: 'analyze',
        inputFiles: ['test.csv'],
      });

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.rowCount).toBe(2);
      expect(data.columns[0].name).toBe('id');
    });
  });

  describe('Data Transformations', () => {
    it('should filter data', async () => {
      const result = await agent.execute({
        action: 'filter',
        data: mockData,
        params: { column: 'city', operator: '==', value: 'New York' },
      });

      expect(result.success).toBe(true);
      const data = result.data as any[];
      expect(data).toHaveLength(2);
      expect(data[0].name).toBe('Alice');
    });

    it('should sort data', async () => {
      const result = await agent.execute({
        action: 'sort',
        data: mockData,
        params: { column: 'age', ascending: false },
      });

      expect(result.success).toBe(true);
      const data = result.data as any[];
      expect(data[0].name).toBe('David'); // Age 40
    });

    it('should select columns', async () => {
      const result = await agent.execute({
        action: 'select',
        data: mockData,
        params: { columns: ['name', 'city'] },
      });

      expect(result.success).toBe(true);
      const data = result.data as any[];
      expect(Object.keys(data[0])).toEqual(['name', 'city']);
    });
  });

  describe('Aggregation and Grouping', () => {
    it('should aggregate data', async () => {
      const result = await agent.execute({
        action: 'aggregate',
        data: mockData,
        params: {
          groupBy: ['city'],
          aggregations: { salary: 'sum', age: 'avg' }
        },
      });

      expect(result.success).toBe(true);
      const data = result.data as any[];
      const nyGroup = data.find((g: any) => g.city === 'New York');
      expect(nyGroup.salary_sum).toBe(110000);
      expect(nyGroup.age_avg).toBe(32.5);
    });

    it('should group data', async () => {
      const result = await agent.execute({
        action: 'group',
        data: mockData,
        params: { by: ['city'] },
      });

      expect(result.success).toBe(true);
      const data = result.data as any[];
      expect(data).toHaveLength(3); // NY, London, Paris
    });
  });

  describe('Pivot Table', () => {
    it('should pivot data', async () => {
      const pivotData = [
        { year: 2020, quarter: 'Q1', revenue: 100 },
        { year: 2020, quarter: 'Q2', revenue: 120 },
        { year: 2021, quarter: 'Q1', revenue: 150 },
        { year: 2021, quarter: 'Q2', revenue: 180 },
      ];

      const result = await agent.execute({
        action: 'pivot',
        data: pivotData,
        params: {
          index: 'year',
          columns: 'quarter',
          values: 'revenue',
        },
      });

      expect(result.success).toBe(true);
      const data = result.data as any[];
      expect(data).toHaveLength(2);
      expect(data[0].Q1).toBe(100);
      expect(data[1].Q2).toBe(180);
    });
  });

  describe('Advanced Analysis', () => {
    it('should calculate correlations', async () => {
      const result = await agent.execute({
        action: 'correlate',
        data: mockData,
      });

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.age.salary).toBeDefined();
      expect(data.age.salary).toBeGreaterThan(0);
    });

    it('should generate histogram data', async () => {
      const result = await agent.execute({
        action: 'histogram',
        data: mockData,
        params: { column: 'age', bins: 2 },
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });
  });

  describe('Join Operation', () => {
    it('should join two datasets', async () => {
      const otherData = [
        { id: 1, department: 'Engineering' },
        { id: 2, department: 'Sales' },
      ];
      
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(otherData));

      const result = await agent.execute({
        action: 'join',
        data: mockData,
        inputFiles: ['left.json', 'right.json'],
        params: { leftKey: 'id', how: 'inner' },
      });

      expect(result.success).toBe(true);
      const data = result.data as any[];
      expect(data).toHaveLength(2);
      expect(data[0].department).toBe('Engineering');
    });
  });

  describe('Error Handling', () => {
    it('should return error for unknown action', async () => {
      const result = await agent.execute({
        action: 'unknown-action',
        data: mockData,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action');
    });

    it('should return error when no data or file provided', async () => {
      const result = await agent.execute({
        action: 'analyze',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No data');
    });

    it('should handle parse errors gracefully', async () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid json');

      const result = await agent.execute({
        action: 'analyze',
        inputFiles: ['test.json'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Parse error');
    });
  });
});

describe('DataAnalysisAgent Factory', () => {
  it('should return a singleton instance', () => {
    const agent1 = getDataAnalysisAgent();
    const agent2 = getDataAnalysisAgent();
    expect(agent1).toBe(agent2);
  });

  it('should create and initialize an agent', async () => {
    const agent = await createDataAnalysisAgent();
    expect(agent.isReady()).toBe(true);
  });
});