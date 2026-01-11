/**
 * Unit tests for ArchiveAgent
 * Tests archive creation, extraction, and listing functionality
 */

import { ArchiveAgent, getArchiveAgent, createArchiveAgent } from '../../src/agent/specialized/archive-agent';
import { AgentTask } from '../../src/agent/specialized/types';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
}));

// Mock jszip and tar
const mockZipFile = jest.fn();
const mockZipGenerate = jest.fn();
const mockZipLoad = jest.fn();
const mockZipForEach = jest.fn();
const mockZipRemove = jest.fn();

class MockJSZip {
  file = mockZipFile;
  generateAsync = mockZipGenerate;
  loadAsync = mockZipLoad;
  forEach = mockZipForEach;
  remove = mockZipRemove;
  static loadAsync = mockZipLoad;
  files = {};
}

const mockTarList = jest.fn();
const mockTarExtract = jest.fn();
const mockTarCreate = jest.fn();

jest.mock('jszip', () => MockJSZip, { virtual: true });
jest.mock('tar', () => ({
  list: mockTarList,
  extract: mockTarExtract,
  create: mockTarCreate,
}), { virtual: true });

describe('ArchiveAgent', () => {
  let agent: ArchiveAgent;
  const mockZipPath = '/test/archive.zip';
  const mockTarPath = '/test/archive.tar.gz';

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new ArchiveAgent();

    // Default mock implementations
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('mock content'));
    (fs.statSync as jest.Mock).mockReturnValue({ size: 1024, isDirectory: () => false });
    (fs.readdirSync as jest.Mock).mockReturnValue([]);

    mockZipLoad.mockResolvedValue(new MockJSZip());
    mockZipGenerate.mockResolvedValue(Buffer.from('new zip content'));
    mockTarList.mockResolvedValue(undefined);
    mockTarExtract.mockResolvedValue(undefined);
    mockTarCreate.mockResolvedValue(undefined);
  });

  describe('Constructor and Configuration', () => {
    it('should create agent with correct ID', () => {
      expect(agent.getId()).toBe('archive-agent');
    });

    it('should have archive capabilities', () => {
      expect(agent.hasCapability('archive-extract')).toBe(true);
      expect(agent.hasCapability('archive-create')).toBe(true);
    });

    it('should handle archive extensions', () => {
      expect(agent.canHandleExtension('zip')).toBe(true);
      expect(agent.canHandleExtension('tar.gz')).toBe(true);
      expect(agent.canHandleExtension('tgz')).toBe(true);
    });
  });

  describe('initialize()', () => {
    it('should initialize successfully', async () => {
      await agent.initialize();
      expect(agent.isReady()).toBe(true);
    });
  });

  describe('getSupportedActions()', () => {
    it('should return all supported actions', () => {
      const actions = agent.getSupportedActions();
      expect(actions).toContain('list');
      expect(actions).toContain('extract');
      expect(actions).toContain('create');
      expect(actions).toContain('info');
    });
  });

  describe('execute()', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    describe('list action', () => {
      it('should list ZIP contents', async () => {
        const mockZip = new MockJSZip();
        mockZip.files = {
          'file1.txt': { name: 'file1.txt', dir: false, date: new Date(), _data: { uncompressedSize: 100 } }
        };
        mockZipForEach.mockImplementation((cb) => {
          Object.entries(mockZip.files).forEach(([path, file]) => cb(path, file));
        });
        mockZipLoad.mockResolvedValue(mockZip);

        const result = await agent.execute({
          action: 'list',
          inputFiles: [mockZipPath],
        });

        expect(result.success).toBe(true);
        expect(mockZipLoad).toHaveBeenCalled();
        expect(result.metadata?.format).toBe('zip');
      });

      it('should list TAR contents', async () => {
        mockTarList.mockImplementation((options) => {
          options.onentry({
            path: 'file1.txt',
            size: 100,
            type: 'File',
            mtime: new Date(),
          });
          return Promise.resolve();
        });

        const result = await agent.execute({
          action: 'list',
          inputFiles: [mockTarPath],
        });

        expect(result.success).toBe(true);
        expect(mockTarList).toHaveBeenCalled();
        expect(result.metadata?.format).toBe('tar.gz');
      });

      it('should return error if file not found', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);

        const result = await agent.execute({
          action: 'list',
          inputFiles: ['/nonexistent.zip'],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });
    });

    describe('extract action', () => {
      it('should extract ZIP archive', async () => {
        const mockZip = new MockJSZip();
        const mockFile = {
          dir: false,
          async: jest.fn().mockResolvedValue(Buffer.from('extracted content')),
        };
        mockZip.files = { 'file1.txt': mockFile };
        mockZipLoad.mockResolvedValue(mockZip);
        (fs.existsSync as jest.Mock).mockImplementation((p) => {
          if (p === mockZipPath) return true;
          if (p === '/output') return true;
          return false;
        });

        const result = await agent.execute({
          action: 'extract',
          inputFiles: [mockZipPath],
          params: { outputDir: '/output' },
        });

        expect(result.success).toBe(true);
        expect(fs.writeFileSync).toHaveBeenCalled();
      });

      it('should extract TAR archive', async () => {
        const result = await agent.execute({
          action: 'extract',
          inputFiles: [mockTarPath],
          params: { outputDir: '/output' },
        });

        expect(result.success).toBe(true);
        expect(mockTarExtract).toHaveBeenCalled();
      });
    });

    describe('create action', () => {
      it('should create ZIP archive', async () => {
        (fs.statSync as jest.Mock).mockReturnValue({ size: 100, isDirectory: () => false });

        const result = await agent.execute({
          action: 'create',
          inputFiles: ['/file1.txt', '/file2.txt'],
          outputFile: '/new.zip',
        });

        expect(result.success).toBe(true);
        expect(mockZipGenerate).toHaveBeenCalled();
        expect(fs.writeFileSync).toHaveBeenCalled();
      });

      it('should create TAR archive', async () => {
        (fs.statSync as jest.Mock).mockReturnValue({ size: 100, isDirectory: () => false });

        const result = await agent.execute({
          action: 'create',
          inputFiles: ['/file1.txt'],
          outputFile: '/new.tar.gz',
        });

        expect(result.success).toBe(true);
        expect(mockTarCreate).toHaveBeenCalled();
      });

      it('should return error if no output file specified', async () => {
        const result = await agent.execute({
          action: 'create',
          inputFiles: ['/file1.txt'],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('output file');
      });
    });

    describe('info action', () => {
      it('should return archive info', async () => {
        const mockZip = new MockJSZip();
        mockZipForEach.mockImplementation(() => {});
        mockZipLoad.mockResolvedValue(mockZip);

        const result = await agent.execute({
          action: 'info',
          inputFiles: [mockZipPath],
        });

        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('filename');
        expect(result.data).toHaveProperty('totalSize');
      });
    });

    describe('add action', () => {
      it('should add files to ZIP', async () => {
        const mockZip = new MockJSZip();
        mockZipLoad.mockResolvedValue(mockZip);

        const result = await agent.execute({
          action: 'add',
          inputFiles: [mockZipPath, '/newfile.txt'],
        });

        expect(result.success).toBe(true);
        expect(mockZipFile).toHaveBeenCalled();
        expect(mockZipGenerate).toHaveBeenCalled();
      });

      it('should return error for non-ZIP formats', async () => {
        const result = await agent.execute({
          action: 'add',
          inputFiles: [mockTarPath, '/newfile.txt'],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('ZIP');
      });
    });

    describe('remove action', () => {
      it('should remove files from ZIP', async () => {
        const mockZip = new MockJSZip();
        mockZipForEach.mockImplementation((cb) => cb('toremove.txt'));
        mockZipLoad.mockResolvedValue(mockZip);

        const result = await agent.execute({
          action: 'remove',
          inputFiles: [mockZipPath],
          params: { patterns: ['toremove*'] },
        });

        expect(result.success).toBe(true);
        expect(mockZipRemove).toHaveBeenCalled();
      });
    });
  });
});

describe('ArchiveAgent Factory', () => {
  it('should return a singleton instance', () => {
    const agent1 = getArchiveAgent();
    const agent2 = getArchiveAgent();
    expect(agent1).toBe(agent2);
  });

  it('should create and initialize an agent', async () => {
    const agent = await createArchiveAgent();
    expect(agent.isReady()).toBe(true);
  });
});
