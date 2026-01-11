/**
 * Unit tests for SecurityReviewAgent
 * Tests security vulnerability detection and reporting
 */

import { SecurityReviewAgent, getSecurityReviewAgent, resetSecurityReviewAgent } from '../../src/agent/specialized/security-review-agent';
import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  statSync: jest.fn(),
}));

// Mock fast-glob
jest.mock('fast-glob');

describe('SecurityReviewAgent', () => {
  let agent: SecurityReviewAgent;
  const mockPath = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();
    resetSecurityReviewAgent();
    agent = new SecurityReviewAgent();
    
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.statSync as jest.Mock).mockReturnValue({ isFile: () => false, size: 1024 });
    (fg as unknown as jest.Mock).mockResolvedValue([]);
  });

  describe('Initialization', () => {
    it('should initialize correctly', async () => {
      await agent.initialize();
      expect(agent.isReady()).toBe(true);
    });
  });

  describe('fullScan()', () => {
    it('should detect hardcoded API keys', async () => {
      const content = 'const API_KEY = "AKIAIOSFODNN7EXAMPLE";';
      (fg as unknown as jest.Mock).mockResolvedValue(['/test/file.ts']);
      (fs.readFileSync as jest.Mock).mockReturnValue(content);
      (fs.statSync as jest.Mock).mockReturnValue({ isFile: () => true, size: 100 });

      const result = await agent.fullScan(mockPath);

      expect(result.success).toBe(true);
      expect(result.findings?.some(f => f.category === 'secrets')).toBe(true);
    });

    it('should detect potential SQL injection', async () => {
      const content = 'const q = "SELECT * FROM users WHERE id = " + req.params.id;';
      (fg as unknown as jest.Mock).mockResolvedValue(['/test/db.ts']);
      (fs.readFileSync as jest.Mock).mockReturnValue(content);
      (fs.statSync as jest.Mock).mockReturnValue({ isFile: () => true, size: 100 });

      const result = await agent.fullScan(mockPath);

      expect(result.success).toBe(true);
      expect(result.findings?.some(f => f.category === 'injection')).toBe(true);
    });

    it('should detect insecure HTTP connections', async () => {
      const content = 'const url = "http://example.com/api";';
      (fg as unknown as jest.Mock).mockResolvedValue(['/test/net.ts']);
      (fs.readFileSync as jest.Mock).mockReturnValue(content);
      (fs.statSync as jest.Mock).mockReturnValue({ isFile: () => true, size: 100 });

      const result = await agent.fullScan(mockPath);

      expect(result.success).toBe(true);
      expect(result.findings?.some(f => f.id.startsWith('http-insecure'))).toBe(true);
    });
  });

  describe('auditDependencies()', () => {
    it('should find wildcard versions in package.json', async () => {
      const packageJson = JSON.stringify({
        dependencies: {
          'lodash': '*', 
          'express': 'latest'
        }
      });
      (fs.existsSync as jest.Mock).mockImplementation((p) => p.endsWith('package.json'));
      (fs.readFileSync as jest.Mock).mockReturnValue(packageJson);

      const result = await agent.auditDependencies(mockPath);

      expect(result.success).toBe(true);
      expect(result.findings).toHaveLength(2);
      expect(result.findings![0].title).toContain('Wildcard');
    });

    it('should find unpinned versions in requirements.txt', async () => {
      const requirements = 'requests\nflask>=2.0';
      (fs.existsSync as jest.Mock).mockImplementation((p) => p.endsWith('requirements.txt'));
      (fs.readFileSync as jest.Mock).mockReturnValue(requirements);

      const result = await agent.auditDependencies(mockPath);

      expect(result.success).toBe(true);
      expect(result.findings?.some(f => f.title.includes('Unpinned'))).toBe(true);
    });
  });

  describe('auditPermissions()', () => {
    it('should flag world-readable sensitive files', async () => {
      (fs.existsSync as jest.Mock).mockImplementation((p) => p.endsWith('.env'));
      (fs.statSync as jest.Mock).mockReturnValue({ mode: 0o644 }); // Readable by others

      const result = await agent.auditPermissions(mockPath);

      expect(result.findings?.some(f => f.category === 'permissions')).toBe(true);
    });
  });

  describe('generateReport()', () => {
    it('should generate text report', async () => {
      // Run a scan first to have results
      (fg as unknown as jest.Mock).mockResolvedValue(['/test/file.ts']);
      (fs.readFileSync as jest.Mock).mockReturnValue('const key = "AKIA1234567890123456";');
      (fs.statSync as jest.Mock).mockReturnValue({ isFile: () => true, size: 100 });
      await agent.fullScan(mockPath);

      const result = await agent.generateReport('text');

      expect(result.success).toBe(true);
      expect(result.output).toContain('SECURITY SCAN REPORT');
      expect(result.output).toContain('CRITICAL');
    });

    it('should generate markdown report', async () => {
      await agent.fullScan(mockPath);
      const result = await agent.generateReport('markdown');

      expect(result.success).toBe(true);
      expect(result.output).toContain('# Security Scan Report');
    });

    it('should return error if no scan performed', async () => {
      const result = await agent.generateReport('json');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No scan results');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty directories', async () => {
      (fg as unknown as jest.Mock).mockResolvedValue([]);
      const result = await agent.fullScan(mockPath);
      expect(result.success).toBe(true);
      expect(result.findings).toHaveLength(0);
    });

    it('should skip files exceeding max size', async () => {
      (fg as unknown as jest.Mock).mockResolvedValue(['/test/large.js']);
      (fs.statSync as jest.Mock).mockReturnValue({ isFile: () => true, size: 10 * 1024 * 1024 }); // 10MB

      const result = await agent.fullScan(mockPath);
      expect(result.findings).toHaveLength(0);
    });
  });
});

describe('SecurityReviewAgent Singleton', () => {
  it('should return same instance', () => {
    const a1 = getSecurityReviewAgent();
    const a2 = getSecurityReviewAgent();
    expect(a1).toBe(a2);
  });
});
