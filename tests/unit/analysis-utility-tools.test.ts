
import { DependencyAnalyzer } from '../../src/tools/intelligence/dependency-analyzer.js';
import { analyzeDependencies } from '../../src/tools/dependency-analyzer.js';
import { analyzeCodeQuality } from '../../src/tools/code-quality-scorer.js';
import { formatFile } from '../../src/tools/code-formatter.js';
import { TestGeneratorTool } from '../../src/tools/test-generator.js';
import { UnifiedVfsRouter } from '../../src/services/vfs/unified-vfs-router.js';

// Mock UnifiedVfsRouter
const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();
const mockExists = jest.fn();
const mockReadDirectory = jest.fn();
const mockStat = jest.fn();

jest.mock('../../src/services/vfs/unified-vfs-router.js', () => ({
  UnifiedVfsRouter: {
    Instance: {
      readFile: (...args: unknown[]) => mockReadFile(...args),
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
      exists: (...args: unknown[]) => mockExists(...args),
      readDirectory: (...args: unknown[]) => mockReadDirectory(...args),
      stat: (...args: unknown[]) => mockStat(...args),
    },
  },
}));

describe('Analysis and Utility Tools VFS Migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Intelligence/DependencyAnalyzer', () => {
    it('should use VFS for analyzing dependencies', async () => {
      const analyzer = new DependencyAnalyzer({ rootPath: '.' });
      
      // Mock discoverFiles internal calls
      mockReadDirectory.mockResolvedValue([
        { name: 'index.ts', isFile: true, isDirectory: false }
      ]);
      
      // Mock parseFile calls (indirectly via VFS read if parser reads file)
      // Actually ASTParser reads file. ASTParser likely uses fs directly or needs migration?
      // Assuming ASTParser is used or mocked. But here we just check if analyze calls VFS.
      // analyze calls discoverFiles which calls readDirectory.
      
      await analyzer.analyze();
      expect(mockReadDirectory).toHaveBeenCalled();
    });
  });

  describe('DependencyAnalyzer (Root)', () => {
    it('should use VFS for analyzing package.json', async () => {
      mockExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue(JSON.stringify({
        dependencies: { react: '18.0.0' },
        devDependencies: { typescript: '5.0.0' }
      }));
      
      await analyzeDependencies({ checkOutdated: false, checkUnused: false, checkCircular: false, buildGraph: false });
      
      expect(mockExists).toHaveBeenCalledWith(expect.stringContaining('package.json'));
      expect(mockReadFile).toHaveBeenCalledWith(expect.stringContaining('package.json'));
    });
  });

  describe('CodeQualityScorer', () => {
    it('should use VFS for reading file content', async () => {
      mockReadFile.mockResolvedValue('function test() { return true; }');
      
      await analyzeCodeQuality('test.ts');
      
      expect(mockReadFile).toHaveBeenCalledWith('test.ts', 'utf-8');
    });
  });

  describe('CodeFormatter', () => {
    it('should use VFS for reading and writing formatted file', async () => {
      mockReadFile.mockResolvedValue('const x=1;');
      
      await formatFile('test.ts');
      
      expect(mockReadFile).toHaveBeenCalledWith('test.ts', 'utf-8');
      expect(mockWriteFile).toHaveBeenCalledWith('test.ts', expect.any(String), 'utf-8');
    });
  });

  describe('TestGeneratorTool', () => {
    it('should use VFS for detecting framework', async () => {
      const generator = new TestGeneratorTool();
      
      mockExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue(JSON.stringify({
        devDependencies: { jest: '29.0.0' }
      }));
      
      const framework = await generator.detectFramework();
      
      expect(mockExists).toHaveBeenCalledWith(expect.stringContaining('package.json'));
      expect(framework).toBe('jest');
    });
  });
});
