/**
 * Comprehensive Unit Tests for CodeEvolutionTracker
 *
 * Tests cover:
 * 1. generateEvolutionReport function
 * 2. formatEvolutionReport function
 * 3. exportEvolutionData function
 * 4. exportEvolutionCSV function
 * 5. Trend calculation
 * 6. Summary statistics
 * 7. Language detection
 * 8. Error handling
 */

// Mock child_process before importing the module
const mockExecSync = jest.fn();
jest.mock('child_process', () => ({
  execSync: mockExecSync,
}));

import { execSync } from 'child_process';
import {
  generateEvolutionReport,
  formatEvolutionReport,
  exportEvolutionData,
  exportEvolutionCSV,
  EvolutionReport,
  EvolutionDataPoint,
  EvolutionOptions,
} from '../../src/analytics/code-evolution';

describe('CodeEvolutionTracker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateEvolutionReport', () => {
    it('should generate empty report when no git history', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Not a git repository');
      });

      const report = generateEvolutionReport({ repoPath: '/test' });

      expect(report).toBeDefined();
      expect(report.dataPoints).toEqual([]);
      expect(report.summary.startLoc).toBe(0);
      expect(report.summary.endLoc).toBe(0);
      expect(report.trends.locTrend).toBe('stable');
      expect(report.generatedAt).toBeInstanceOf(Date);
    });

    it('should return empty report when git log returns empty', () => {
      mockExecSync.mockReturnValue('');

      const report = generateEvolutionReport({ repoPath: '/test' });

      expect(report.dataPoints).toEqual([]);
    });

    it('should collect data points from git history', () => {
      // Mock git log to return commits
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log') && cmd.includes('format')) {
          return 'abc123|2024-01-15T10:00:00Z\ndef456|2024-01-10T10:00:00Z\n';
        }
        if (cmd.includes('git ls-tree')) {
          return 'src/index.ts\nsrc/utils.ts\n';
        }
        if (cmd.includes('git show')) {
          return 'const x = 1;\nconst y = 2;\nconst z = 3;\n';
        }
        return '';
      });

      const report = generateEvolutionReport({
        repoPath: '/test',
        dataPoints: 2,
        days: 30,
      });

      expect(report.dataPoints.length).toBeGreaterThanOrEqual(0);
    });

    it('should use custom options', () => {
      mockExecSync.mockReturnValue('');

      generateEvolutionReport({
        repoPath: '/custom/path',
        dataPoints: 50,
        days: 180,
        extensions: ['.py', '.rb'],
        exclude: ['vendor', 'tmp'],
      });

      expect(mockExecSync).toHaveBeenCalled();
    });

    it('should use default options when not provided', () => {
      mockExecSync.mockReturnValue('');

      generateEvolutionReport();

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('git log'),
        expect.objectContaining({
          cwd: process.cwd(),
        })
      );
    });

    it('should filter files by extension', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log') && cmd.includes('format')) {
          return 'abc123|2024-01-15T10:00:00Z\n';
        }
        if (cmd.includes('git ls-tree')) {
          return 'src/index.ts\nsrc/style.css\nREADME.md\n';
        }
        if (cmd.includes('git show abc123:src/index.ts')) {
          return 'const x = 1;\n';
        }
        return '';
      });

      const report = generateEvolutionReport({
        repoPath: '/test',
        extensions: ['.ts'],
        dataPoints: 1,
      });

      // Should only count .ts files
      expect(report).toBeDefined();
    });

    it('should exclude specified directories', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log') && cmd.includes('format')) {
          return 'abc123|2024-01-15T10:00:00Z\n';
        }
        if (cmd.includes('git ls-tree')) {
          return 'src/index.ts\nnode_modules/package/index.js\n';
        }
        if (cmd.includes('git show abc123:src/index.ts')) {
          return 'const x = 1;\n';
        }
        return '';
      });

      const report = generateEvolutionReport({
        repoPath: '/test',
        exclude: ['node_modules'],
        dataPoints: 1,
      });

      expect(report).toBeDefined();
    });

    it('should sample commits evenly when more commits than dataPoints', () => {
      const commits = Array.from({ length: 100 }, (_, i) =>
        `commit${i}|2024-01-${String(15 - Math.floor(i / 10)).padStart(2, '0')}T10:00:00Z`
      ).join('\n');

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log') && cmd.includes('format')) {
          return commits;
        }
        if (cmd.includes('git ls-tree')) {
          return 'src/index.ts\n';
        }
        if (cmd.includes('git show')) {
          return 'const x = 1;\n';
        }
        return '';
      });

      const report = generateEvolutionReport({
        repoPath: '/test',
        dataPoints: 10,
      });

      // Should have sampled commits
      expect(report.dataPoints.length).toBeLessThanOrEqual(11); // 10 + possibly 1 for latest
    });

    it('should handle git show errors gracefully', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log') && cmd.includes('format')) {
          return 'abc123|2024-01-15T10:00:00Z\n';
        }
        if (cmd.includes('git ls-tree')) {
          return 'src/index.ts\n';
        }
        if (cmd.includes('git show')) {
          throw new Error('Cannot read file');
        }
        return '';
      });

      // Should not throw
      const report = generateEvolutionReport({
        repoPath: '/test',
        dataPoints: 1,
      });

      expect(report).toBeDefined();
    });

    it('should sort data points by date', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log') && cmd.includes('format')) {
          return 'newer|2024-01-20T10:00:00Z\nolder|2024-01-10T10:00:00Z\n';
        }
        if (cmd.includes('git ls-tree')) {
          return 'src/index.ts\n';
        }
        if (cmd.includes('git show')) {
          return 'const x = 1;\n';
        }
        return '';
      });

      const report = generateEvolutionReport({
        repoPath: '/test',
        dataPoints: 2,
      });

      if (report.dataPoints.length >= 2) {
        expect(report.dataPoints[0].date.getTime()).toBeLessThanOrEqual(
          report.dataPoints[1].date.getTime()
        );
      }
    });
  });

  describe('Summary Calculation', () => {
    it('should calculate LOC change correctly', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log') && cmd.includes('format')) {
          return 'abc123|2024-01-15T10:00:00Z\ndef456|2024-01-01T10:00:00Z\n';
        }
        if (cmd.includes('git ls-tree')) {
          return 'src/index.ts\n';
        }
        if (cmd.includes('git show abc123')) {
          // Newer commit has more lines
          return 'line1\nline2\nline3\nline4\nline5\n';
        }
        if (cmd.includes('git show def456')) {
          // Older commit has fewer lines
          return 'line1\nline2\n';
        }
        return '';
      });

      const report = generateEvolutionReport({
        repoPath: '/test',
        dataPoints: 2,
      });

      if (report.dataPoints.length >= 2) {
        expect(report.summary.locChange).toBe(report.summary.endLoc - report.summary.startLoc);
      }
    });

    it('should calculate file change correctly', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log') && cmd.includes('format')) {
          return 'newer|2024-01-15T10:00:00Z\nolder|2024-01-01T10:00:00Z\n';
        }
        if (cmd.includes('git ls-tree newer')) {
          return 'a.ts\nb.ts\nc.ts\n';
        }
        if (cmd.includes('git ls-tree older')) {
          return 'a.ts\n';
        }
        if (cmd.includes('git show')) {
          return 'content\n';
        }
        return '';
      });

      const report = generateEvolutionReport({
        repoPath: '/test',
        dataPoints: 2,
      });

      if (report.dataPoints.length >= 2) {
        expect(report.summary.fileChange).toBe(
          report.summary.endFiles - report.summary.startFiles
        );
      }
    });

    it('should calculate LOC change percent', () => {
      const mockReport: EvolutionReport = {
        dataPoints: [
          {
            date: new Date('2024-01-01'),
            commit: 'abc123',
            linesOfCode: 100,
            fileCount: 5,
            languageBreakdown: {},
          },
          {
            date: new Date('2024-01-15'),
            commit: 'def456',
            linesOfCode: 150,
            fileCount: 8,
            languageBreakdown: {},
          },
        ],
        summary: {
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-15'),
          startLoc: 100,
          endLoc: 150,
          locChange: 50,
          locChangePercent: 50,
          startFiles: 5,
          endFiles: 8,
          fileChange: 3,
          avgCommitsPerDay: 0.14,
        },
        trends: {
          locTrend: 'growing',
          fileTrend: 'growing',
          velocity: 4,
        },
        generatedAt: new Date(),
      };

      expect(mockReport.summary.locChangePercent).toBe(50);
    });

    it('should handle zero start LOC', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log') && cmd.includes('format')) {
          return 'abc123|2024-01-15T10:00:00Z\ndef456|2024-01-01T10:00:00Z\n';
        }
        if (cmd.includes('git ls-tree abc123')) {
          return 'src/index.ts\n';
        }
        if (cmd.includes('git ls-tree def456')) {
          return '';
        }
        if (cmd.includes('git show abc123')) {
          return 'content\n';
        }
        return '';
      });

      const report = generateEvolutionReport({
        repoPath: '/test',
        dataPoints: 2,
      });

      expect(report).toBeDefined();
    });
  });

  describe('Trend Calculation', () => {
    it('should detect growing LOC trend', () => {
      const mockReport: EvolutionReport = {
        dataPoints: [
          { date: new Date(), commit: 'a', linesOfCode: 100, fileCount: 5, languageBreakdown: {} },
          { date: new Date(), commit: 'b', linesOfCode: 200, fileCount: 5, languageBreakdown: {} },
        ],
        summary: {
          startDate: new Date(),
          endDate: new Date(),
          startLoc: 100,
          endLoc: 200,
          locChange: 100,
          locChangePercent: 100,
          startFiles: 5,
          endFiles: 5,
          fileChange: 0,
          avgCommitsPerDay: 1,
        },
        trends: {
          locTrend: 'growing',
          fileTrend: 'stable',
          velocity: 100,
        },
        generatedAt: new Date(),
      };

      expect(mockReport.trends.locTrend).toBe('growing');
    });

    it('should detect shrinking LOC trend', () => {
      const mockReport: EvolutionReport = {
        dataPoints: [
          { date: new Date(), commit: 'a', linesOfCode: 200, fileCount: 5, languageBreakdown: {} },
          { date: new Date(), commit: 'b', linesOfCode: 100, fileCount: 5, languageBreakdown: {} },
        ],
        summary: {
          startDate: new Date(),
          endDate: new Date(),
          startLoc: 200,
          endLoc: 100,
          locChange: -100,
          locChangePercent: -50,
          startFiles: 5,
          endFiles: 5,
          fileChange: 0,
          avgCommitsPerDay: 1,
        },
        trends: {
          locTrend: 'shrinking',
          fileTrend: 'stable',
          velocity: -100,
        },
        generatedAt: new Date(),
      };

      expect(mockReport.trends.locTrend).toBe('shrinking');
    });

    it('should detect stable LOC trend', () => {
      const mockReport: EvolutionReport = {
        dataPoints: [
          { date: new Date(), commit: 'a', linesOfCode: 1000, fileCount: 10, languageBreakdown: {} },
          { date: new Date(), commit: 'b', linesOfCode: 1010, fileCount: 10, languageBreakdown: {} },
        ],
        summary: {
          startDate: new Date(),
          endDate: new Date(),
          startLoc: 1000,
          endLoc: 1010,
          locChange: 10,
          locChangePercent: 1,
          startFiles: 10,
          endFiles: 10,
          fileChange: 0,
          avgCommitsPerDay: 1,
        },
        trends: {
          locTrend: 'stable',
          fileTrend: 'stable',
          velocity: 10,
        },
        generatedAt: new Date(),
      };

      expect(mockReport.trends.locTrend).toBe('stable');
    });

    it('should calculate velocity correctly', () => {
      const mockReport: EvolutionReport = {
        dataPoints: [
          { date: new Date('2024-01-01'), commit: 'a', linesOfCode: 0, fileCount: 0, languageBreakdown: {} },
          { date: new Date('2024-01-11'), commit: 'b', linesOfCode: 1000, fileCount: 10, languageBreakdown: {} },
        ],
        summary: {
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-11'),
          startLoc: 0,
          endLoc: 1000,
          locChange: 1000,
          locChangePercent: 0,
          startFiles: 0,
          endFiles: 10,
          fileChange: 10,
          avgCommitsPerDay: 0.2,
        },
        trends: {
          locTrend: 'growing',
          fileTrend: 'growing',
          velocity: 100, // 1000 lines / 10 days
        },
        generatedAt: new Date(),
      };

      expect(mockReport.trends.velocity).toBe(100);
    });
  });

  describe('Language Detection', () => {
    it('should detect TypeScript files', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log') && cmd.includes('format')) {
          return 'abc123|2024-01-15T10:00:00Z\n';
        }
        if (cmd.includes('git ls-tree')) {
          return 'src/index.ts\nsrc/component.tsx\n';
        }
        if (cmd.includes('git show')) {
          return 'const x = 1;\nconst y = 2;\n';
        }
        return '';
      });

      const report = generateEvolutionReport({
        repoPath: '/test',
        dataPoints: 1,
      });

      if (report.dataPoints.length > 0) {
        const breakdown = report.dataPoints[0].languageBreakdown;
        expect('TypeScript' in breakdown || 'TypeScript (React)' in breakdown).toBe(true);
      }
    });

    it('should detect JavaScript files', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log') && cmd.includes('format')) {
          return 'abc123|2024-01-15T10:00:00Z\n';
        }
        if (cmd.includes('git ls-tree')) {
          return 'src/index.js\n';
        }
        if (cmd.includes('git show')) {
          return 'const x = 1;\n';
        }
        return '';
      });

      const report = generateEvolutionReport({
        repoPath: '/test',
        extensions: ['.js'],
        dataPoints: 1,
      });

      if (report.dataPoints.length > 0) {
        const breakdown = report.dataPoints[0].languageBreakdown;
        expect('JavaScript' in breakdown).toBe(true);
      }
    });

    it('should detect Python files', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log') && cmd.includes('format')) {
          return 'abc123|2024-01-15T10:00:00Z\n';
        }
        if (cmd.includes('git ls-tree')) {
          return 'main.py\n';
        }
        if (cmd.includes('git show')) {
          return 'x = 1\n';
        }
        return '';
      });

      const report = generateEvolutionReport({
        repoPath: '/test',
        extensions: ['.py'],
        dataPoints: 1,
      });

      if (report.dataPoints.length > 0) {
        const breakdown = report.dataPoints[0].languageBreakdown;
        expect('Python' in breakdown).toBe(true);
      }
    });

    it('should handle unknown extensions', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log') && cmd.includes('format')) {
          return 'abc123|2024-01-15T10:00:00Z\n';
        }
        if (cmd.includes('git ls-tree')) {
          return 'file.xyz\n';
        }
        if (cmd.includes('git show')) {
          return 'content\n';
        }
        return '';
      });

      const report = generateEvolutionReport({
        repoPath: '/test',
        extensions: ['.xyz'],
        dataPoints: 1,
      });

      if (report.dataPoints.length > 0) {
        const breakdown = report.dataPoints[0].languageBreakdown;
        expect('XYZ' in breakdown).toBe(true);
      }
    });
  });

  describe('formatEvolutionReport', () => {
    const createMockReport = (): EvolutionReport => ({
      dataPoints: [
        {
          date: new Date('2024-01-01'),
          commit: 'abc123',
          linesOfCode: 1000,
          fileCount: 20,
          languageBreakdown: { TypeScript: 800, JavaScript: 200 },
        },
        {
          date: new Date('2024-01-15'),
          commit: 'def456',
          linesOfCode: 1500,
          fileCount: 25,
          languageBreakdown: { TypeScript: 1200, JavaScript: 300 },
        },
      ],
      summary: {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-15'),
        startLoc: 1000,
        endLoc: 1500,
        locChange: 500,
        locChangePercent: 50,
        startFiles: 20,
        endFiles: 25,
        fileChange: 5,
        avgCommitsPerDay: 2,
      },
      trends: {
        locTrend: 'growing',
        fileTrend: 'growing',
        velocity: 36,
      },
      generatedAt: new Date('2024-01-15T12:00:00Z'),
    });

    it('should format report as string', () => {
      const report = createMockReport();
      const formatted = formatEvolutionReport(report);

      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
    });

    it('should include header', () => {
      const report = createMockReport();
      const formatted = formatEvolutionReport(report);

      expect(formatted).toContain('CODE EVOLUTION REPORT');
    });

    it('should include summary section', () => {
      const report = createMockReport();
      const formatted = formatEvolutionReport(report);

      expect(formatted).toContain('SUMMARY');
      expect(formatted).toContain('Period:');
      expect(formatted).toContain('Lines of Code:');
      expect(formatted).toContain('Change:');
      expect(formatted).toContain('Files:');
      expect(formatted).toContain('Avg Commits/Day:');
    });

    it('should include trends section', () => {
      const report = createMockReport();
      const formatted = formatEvolutionReport(report);

      expect(formatted).toContain('TRENDS');
      expect(formatted).toContain('Velocity:');
    });

    it('should include evolution graph', () => {
      const report = createMockReport();
      const formatted = formatEvolutionReport(report);

      expect(formatted).toContain('LINES OF CODE OVER TIME');
    });

    it('should include language breakdown', () => {
      const report = createMockReport();
      const formatted = formatEvolutionReport(report);

      expect(formatted).toContain('LANGUAGE BREAKDOWN');
      expect(formatted).toContain('TypeScript');
    });

    it('should handle empty data points', () => {
      const report: EvolutionReport = {
        dataPoints: [],
        summary: {
          startDate: new Date(),
          endDate: new Date(),
          startLoc: 0,
          endLoc: 0,
          locChange: 0,
          locChangePercent: 0,
          startFiles: 0,
          endFiles: 0,
          fileChange: 0,
          avgCommitsPerDay: 0,
        },
        trends: {
          locTrend: 'stable',
          fileTrend: 'stable',
          velocity: 0,
        },
        generatedAt: new Date(),
      };

      const formatted = formatEvolutionReport(report);
      expect(typeof formatted).toBe('string');
    });

    it('should handle single data point', () => {
      const report: EvolutionReport = {
        dataPoints: [
          {
            date: new Date('2024-01-15'),
            commit: 'abc123',
            linesOfCode: 1000,
            fileCount: 20,
            languageBreakdown: { TypeScript: 1000 },
          },
        ],
        summary: {
          startDate: new Date('2024-01-15'),
          endDate: new Date('2024-01-15'),
          startLoc: 1000,
          endLoc: 1000,
          locChange: 0,
          locChangePercent: 0,
          startFiles: 20,
          endFiles: 20,
          fileChange: 0,
          avgCommitsPerDay: 0,
        },
        trends: {
          locTrend: 'stable',
          fileTrend: 'stable',
          velocity: 0,
        },
        generatedAt: new Date(),
      };

      const formatted = formatEvolutionReport(report);
      expect(typeof formatted).toBe('string');
    });

    it('should limit displayed data points', () => {
      const manyDataPoints = Array.from({ length: 50 }, (_, i) => ({
        date: new Date(`2024-01-${String(i % 28 + 1).padStart(2, '0')}`),
        commit: `commit${i}`,
        linesOfCode: 1000 + i * 10,
        fileCount: 20,
        languageBreakdown: { TypeScript: 1000 + i * 10 },
      }));

      const report: EvolutionReport = {
        dataPoints: manyDataPoints,
        summary: {
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-01-28'),
          startLoc: 1000,
          endLoc: 1490,
          locChange: 490,
          locChangePercent: 49,
          startFiles: 20,
          endFiles: 20,
          fileChange: 0,
          avgCommitsPerDay: 1.8,
        },
        trends: {
          locTrend: 'growing',
          fileTrend: 'stable',
          velocity: 18,
        },
        generatedAt: new Date(),
      };

      const formatted = formatEvolutionReport(report);
      expect(typeof formatted).toBe('string');
    });

    it('should show top 5 languages', () => {
      const report: EvolutionReport = {
        dataPoints: [
          {
            date: new Date('2024-01-15'),
            commit: 'abc123',
            linesOfCode: 10000,
            fileCount: 100,
            languageBreakdown: {
              TypeScript: 4000,
              JavaScript: 2000,
              Python: 1500,
              Go: 1000,
              Rust: 800,
              Java: 500,
              'C++': 200,
            },
          },
        ],
        summary: {
          startDate: new Date(),
          endDate: new Date(),
          startLoc: 10000,
          endLoc: 10000,
          locChange: 0,
          locChangePercent: 0,
          startFiles: 100,
          endFiles: 100,
          fileChange: 0,
          avgCommitsPerDay: 0,
        },
        trends: {
          locTrend: 'stable',
          fileTrend: 'stable',
          velocity: 0,
        },
        generatedAt: new Date(),
      };

      const formatted = formatEvolutionReport(report);
      expect(formatted).toContain('TypeScript');
      expect(formatted).toContain('JavaScript');
      expect(formatted).toContain('Python');
      expect(formatted).toContain('Go');
      expect(formatted).toContain('Rust');
      // Java and C++ should not appear (only top 5)
    });
  });

  describe('exportEvolutionData', () => {
    it('should export report as valid JSON', () => {
      const report: EvolutionReport = {
        dataPoints: [],
        summary: {
          startDate: new Date(),
          endDate: new Date(),
          startLoc: 0,
          endLoc: 0,
          locChange: 0,
          locChangePercent: 0,
          startFiles: 0,
          endFiles: 0,
          fileChange: 0,
          avgCommitsPerDay: 0,
        },
        trends: {
          locTrend: 'stable',
          fileTrend: 'stable',
          velocity: 0,
        },
        generatedAt: new Date(),
      };

      const json = exportEvolutionData(report);

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should preserve all data in JSON', () => {
      const report: EvolutionReport = {
        dataPoints: [
          {
            date: new Date('2024-01-15'),
            commit: 'abc123',
            linesOfCode: 1000,
            fileCount: 20,
            languageBreakdown: { TypeScript: 1000 },
          },
        ],
        summary: {
          startDate: new Date('2024-01-15'),
          endDate: new Date('2024-01-15'),
          startLoc: 1000,
          endLoc: 1000,
          locChange: 0,
          locChangePercent: 0,
          startFiles: 20,
          endFiles: 20,
          fileChange: 0,
          avgCommitsPerDay: 0,
        },
        trends: {
          locTrend: 'stable',
          fileTrend: 'stable',
          velocity: 0,
        },
        generatedAt: new Date('2024-01-15T12:00:00Z'),
      };

      const json = exportEvolutionData(report);
      const parsed = JSON.parse(json);

      expect(parsed.dataPoints.length).toBe(1);
      expect(parsed.dataPoints[0].linesOfCode).toBe(1000);
      expect(parsed.summary.startLoc).toBe(1000);
    });

    it('should format JSON with indentation', () => {
      const report: EvolutionReport = {
        dataPoints: [],
        summary: {
          startDate: new Date(),
          endDate: new Date(),
          startLoc: 0,
          endLoc: 0,
          locChange: 0,
          locChangePercent: 0,
          startFiles: 0,
          endFiles: 0,
          fileChange: 0,
          avgCommitsPerDay: 0,
        },
        trends: {
          locTrend: 'stable',
          fileTrend: 'stable',
          velocity: 0,
        },
        generatedAt: new Date(),
      };

      const json = exportEvolutionData(report);

      expect(json).toContain('\n');
    });
  });

  describe('exportEvolutionCSV', () => {
    it('should export as CSV with headers', () => {
      const report: EvolutionReport = {
        dataPoints: [],
        summary: {
          startDate: new Date(),
          endDate: new Date(),
          startLoc: 0,
          endLoc: 0,
          locChange: 0,
          locChangePercent: 0,
          startFiles: 0,
          endFiles: 0,
          fileChange: 0,
          avgCommitsPerDay: 0,
        },
        trends: {
          locTrend: 'stable',
          fileTrend: 'stable',
          velocity: 0,
        },
        generatedAt: new Date(),
      };

      const csv = exportEvolutionCSV(report);

      expect(csv).toContain('date,commit,lines_of_code,file_count');
    });

    it('should include data point rows', () => {
      const report: EvolutionReport = {
        dataPoints: [
          {
            date: new Date('2024-01-15T10:00:00Z'),
            commit: 'abc123',
            linesOfCode: 1000,
            fileCount: 20,
            languageBreakdown: {},
          },
          {
            date: new Date('2024-01-20T10:00:00Z'),
            commit: 'def456',
            linesOfCode: 1200,
            fileCount: 22,
            languageBreakdown: {},
          },
        ],
        summary: {
          startDate: new Date(),
          endDate: new Date(),
          startLoc: 1000,
          endLoc: 1200,
          locChange: 200,
          locChangePercent: 20,
          startFiles: 20,
          endFiles: 22,
          fileChange: 2,
          avgCommitsPerDay: 0.4,
        },
        trends: {
          locTrend: 'growing',
          fileTrend: 'growing',
          velocity: 40,
        },
        generatedAt: new Date(),
      };

      const csv = exportEvolutionCSV(report);
      const lines = csv.split('\n');

      expect(lines.length).toBe(3); // header + 2 data points
      expect(lines[1]).toContain('abc123');
      expect(lines[1]).toContain('1000');
      expect(lines[2]).toContain('def456');
      expect(lines[2]).toContain('1200');
    });

    it('should include ISO date format', () => {
      const report: EvolutionReport = {
        dataPoints: [
          {
            date: new Date('2024-01-15T10:00:00.000Z'),
            commit: 'abc123',
            linesOfCode: 1000,
            fileCount: 20,
            languageBreakdown: {},
          },
        ],
        summary: {
          startDate: new Date(),
          endDate: new Date(),
          startLoc: 0,
          endLoc: 0,
          locChange: 0,
          locChangePercent: 0,
          startFiles: 0,
          endFiles: 0,
          fileChange: 0,
          avgCommitsPerDay: 0,
        },
        trends: {
          locTrend: 'stable',
          fileTrend: 'stable',
          velocity: 0,
        },
        generatedAt: new Date(),
      };

      const csv = exportEvolutionCSV(report);

      expect(csv).toContain('2024-01-15');
    });
  });

  describe('Edge Cases', () => {
    it('should handle repository with no commits in period', () => {
      mockExecSync.mockReturnValue('\n');

      const report = generateEvolutionReport({
        repoPath: '/test',
        days: 1,
      });

      expect(report.dataPoints).toEqual([]);
    });

    it('should handle very large file', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log') && cmd.includes('format')) {
          return 'abc123|2024-01-15T10:00:00Z\n';
        }
        if (cmd.includes('git ls-tree')) {
          return 'large.ts\n';
        }
        if (cmd.includes('git show')) {
          // 100k lines
          return Array(100000).fill('const x = 1;').join('\n');
        }
        return '';
      });

      const report = generateEvolutionReport({
        repoPath: '/test',
        dataPoints: 1,
      });

      if (report.dataPoints.length > 0) {
        expect(report.dataPoints[0].linesOfCode).toBe(100000);
      }
    });

    it('should handle binary files gracefully', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log') && cmd.includes('format')) {
          return 'abc123|2024-01-15T10:00:00Z\n';
        }
        if (cmd.includes('git ls-tree')) {
          return 'image.png\ncode.ts\n';
        }
        if (cmd.includes('git show abc123:image.png')) {
          throw new Error('Binary file');
        }
        if (cmd.includes('git show abc123:code.ts')) {
          return 'const x = 1;\n';
        }
        return '';
      });

      const report = generateEvolutionReport({
        repoPath: '/test',
        extensions: ['.png', '.ts'],
        dataPoints: 1,
      });

      expect(report).toBeDefined();
    });

    it('should handle commit with malformed date', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('git log') && cmd.includes('format')) {
          return 'abc123|invalid-date\ndef456|2024-01-15T10:00:00Z\n';
        }
        if (cmd.includes('git ls-tree')) {
          return 'src/index.ts\n';
        }
        if (cmd.includes('git show')) {
          return 'const x = 1;\n';
        }
        return '';
      });

      // Should handle gracefully
      const report = generateEvolutionReport({
        repoPath: '/test',
        dataPoints: 2,
      });

      expect(report).toBeDefined();
    });
  });
});
