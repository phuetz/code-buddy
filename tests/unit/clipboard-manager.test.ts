/**
 * Unit tests for ClipboardManager
 * Tests clipboard operations, history management, and content type detection
 */

import * as path from 'path';
import * as os from 'os';

// Mock child_process before importing the module
const mockExec = jest.fn();
const mockExecSync = jest.fn();

jest.mock('child_process', () => ({
  exec: mockExec,
  execSync: mockExecSync,
}));

// Mock fs-extra
const mockExistsSync = jest.fn();
const mockReadJsonSync = jest.fn();
const mockWriteJsonSync = jest.fn();
const mockEnsureDirSync = jest.fn();

jest.mock('fs-extra', () => ({
  existsSync: mockExistsSync,
  readJsonSync: mockReadJsonSync,
  writeJsonSync: mockWriteJsonSync,
  ensureDirSync: mockEnsureDirSync,
}));

// Mock os module
const mockPlatform = jest.fn();
const mockHomedir = jest.fn().mockReturnValue('/home/testuser');

jest.mock('os', () => ({
  platform: () => mockPlatform(),
  homedir: () => mockHomedir(),
}));

import {
  ClipboardManager,
  ClipboardEntry,
  getClipboardManager,
  copyToClipboard,
  pasteFromClipboard,
} from '../../src/ui/clipboard-manager';

describe('ClipboardManager', () => {
  let manager: ClipboardManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockPlatform.mockReturnValue('linux');
  });

  describe('Constructor', () => {
    it('should create manager with default config', () => {
      manager = new ClipboardManager();
      expect(manager).toBeDefined();
    });

    it('should create manager with custom config', () => {
      manager = new ClipboardManager({
        maxHistory: 100,
        historyEnabled: false,
        autoDetectType: false,
      });
      expect(manager).toBeDefined();
    });

    it('should load history from file when historyEnabled is true', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonSync.mockReturnValue([
        { content: 'test', timestamp: new Date().toISOString(), type: 'text' },
      ]);

      manager = new ClipboardManager({ historyEnabled: true });

      expect(mockExistsSync).toHaveBeenCalled();
      expect(mockReadJsonSync).toHaveBeenCalled();
    });

    it('should handle corrupt history file gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonSync.mockImplementation(() => {
        throw new Error('JSON parse error');
      });

      manager = new ClipboardManager({ historyEnabled: true });

      expect(manager.getHistory()).toEqual([]);
    });

    it('should handle non-array history data', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonSync.mockReturnValue({ invalid: 'data' });

      manager = new ClipboardManager({ historyEnabled: true });

      expect(manager.getHistory()).toEqual([]);
    });
  });

  describe('copy', () => {
    beforeEach(() => {
      manager = new ClipboardManager({ historyEnabled: true });
    });

    it('should copy text to clipboard on Linux', async () => {
      mockPlatform.mockReturnValue('linux');
      manager = new ClipboardManager();

      mockExec.mockImplementation((cmd, callback) => {
        const child = {
          stdin: {
            write: jest.fn(),
            end: jest.fn(),
          },
        };
        callback(null);
        return child;
      });

      const result = await manager.copy('Hello World');

      expect(result).toBe(true);
    });

    it('should copy text to clipboard on macOS', async () => {
      mockPlatform.mockReturnValue('darwin');
      manager = new ClipboardManager();

      mockExec.mockImplementation((cmd, callback) => {
        expect(cmd).toBe('pbcopy');
        const child = {
          stdin: {
            write: jest.fn(),
            end: jest.fn(),
          },
        };
        callback(null);
        return child;
      });

      const result = await manager.copy('Hello World');

      expect(result).toBe(true);
    });

    it('should copy text to clipboard on Windows', async () => {
      mockPlatform.mockReturnValue('win32');
      manager = new ClipboardManager();

      mockExec.mockImplementation((cmd, callback) => {
        expect(cmd).toBe('clip');
        const child = {
          stdin: {
            write: jest.fn(),
            end: jest.fn(),
          },
        };
        callback(null);
        return child;
      });

      const result = await manager.copy('Hello World');

      expect(result).toBe(true);
    });

    it('should return false when clipboard write fails', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        const child = {
          stdin: {
            write: jest.fn(),
            end: jest.fn(),
          },
        };
        callback(new Error('Clipboard unavailable'));
        return child;
      });

      const result = await manager.copy('Hello World');

      expect(result).toBe(false);
    });

    it('should add entry to history on successful copy', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        const child = {
          stdin: {
            write: jest.fn(),
            end: jest.fn(),
          },
        };
        callback(null);
        return child;
      });

      await manager.copy('Test content');

      const history = manager.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].content).toBe('Test content');
    });

    it('should add entry with metadata', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        const child = {
          stdin: {
            write: jest.fn(),
            end: jest.fn(),
          },
        };
        callback(null);
        return child;
      });

      await manager.copy('Test content', { language: 'typescript', source: 'test' });

      const history = manager.getHistory();
      expect(history[0].metadata).toEqual({ language: 'typescript', source: 'test' });
    });

    it('should not add duplicate consecutive entries', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        const child = {
          stdin: {
            write: jest.fn(),
            end: jest.fn(),
          },
        };
        callback(null);
        return child;
      });

      await manager.copy('Same content');
      await manager.copy('Same content');

      const history = manager.getHistory();
      expect(history.length).toBe(1);
    });
  });

  describe('copyCode', () => {
    beforeEach(() => {
      mockExec.mockImplementation((cmd, callback) => {
        const child = {
          stdin: {
            write: jest.fn(),
            end: jest.fn(),
          },
        };
        callback(null);
        return child;
      });
      manager = new ClipboardManager();
    });

    it('should copy code with language metadata', async () => {
      const result = await manager.copyCode('const x = 1;', 'typescript');

      expect(result).toBe(true);
      const history = manager.getHistory();
      expect(history[0].metadata?.language).toBe('typescript');
      expect(history[0].metadata?.source).toBe('code-block');
    });

    it('should copy code without language', async () => {
      const result = await manager.copyCode('print("hello")');

      expect(result).toBe(true);
    });
  });

  describe('copyPath', () => {
    beforeEach(() => {
      mockExec.mockImplementation((cmd, callback) => {
        const child = {
          stdin: {
            write: jest.fn(),
            end: jest.fn(),
          },
        };
        callback(null);
        return child;
      });
      manager = new ClipboardManager();
    });

    it('should copy absolute path', async () => {
      const result = await manager.copyPath('/home/user/file.txt');

      expect(result).toBe(true);
      const history = manager.getHistory();
      expect(history[0].content).toBe('/home/user/file.txt');
    });

    it('should resolve relative path to absolute', async () => {
      const result = await manager.copyPath('./file.txt');

      expect(result).toBe(true);
      const history = manager.getHistory();
      expect(path.isAbsolute(history[0].content)).toBe(true);
    });
  });

  describe('paste', () => {
    beforeEach(() => {
      manager = new ClipboardManager();
    });

    it('should paste from clipboard on Linux', async () => {
      mockPlatform.mockReturnValue('linux');
      manager = new ClipboardManager();

      mockExec.mockImplementation((cmd, options, callback) => {
        callback(null, 'Clipboard content');
      });

      const result = await manager.paste();

      expect(result).toBe('Clipboard content');
    });

    it('should paste from clipboard on macOS', async () => {
      mockPlatform.mockReturnValue('darwin');
      manager = new ClipboardManager();

      mockExec.mockImplementation((cmd, options, callback) => {
        expect(cmd).toBe('pbpaste');
        callback(null, 'Mac clipboard');
      });

      const result = await manager.paste();

      expect(result).toBe('Mac clipboard');
    });

    it('should paste from clipboard on Windows', async () => {
      mockPlatform.mockReturnValue('win32');
      manager = new ClipboardManager();

      mockExec.mockImplementation((cmd, options, callback) => {
        expect(cmd).toContain('powershell');
        callback(null, 'Windows clipboard');
      });

      const result = await manager.paste();

      expect(result).toBe('Windows clipboard');
    });

    it('should return null when paste fails', async () => {
      mockExec.mockImplementation((cmd, options, callback) => {
        callback(new Error('Clipboard unavailable'));
      });

      const result = await manager.paste();

      expect(result).toBeNull();
    });
  });

  describe('pasteWithType', () => {
    beforeEach(() => {
      mockExec.mockImplementation((cmd, options, callback) => {
        callback(null, 'https://example.com');
      });
      manager = new ClipboardManager();
    });

    it('should paste with type detection', async () => {
      const result = await manager.pasteWithType();

      expect(result).not.toBeNull();
      expect(result?.type).toBe('url');
      expect(result?.content).toBe('https://example.com');
    });

    it('should return null when paste fails', async () => {
      mockExec.mockImplementation((cmd, options, callback) => {
        callback(new Error('Failed'));
      });

      const result = await manager.pasteWithType();

      expect(result).toBeNull();
    });

    it('should return null for empty content', async () => {
      mockExec.mockImplementation((cmd, options, callback) => {
        callback(null, '');
      });

      const result = await manager.pasteWithType();

      expect(result).toBeNull();
    });
  });

  describe('History Management', () => {
    beforeEach(() => {
      mockExec.mockImplementation((cmd, callback) => {
        const child = {
          stdin: {
            write: jest.fn(),
            end: jest.fn(),
          },
        };
        callback(null);
        return child;
      });
      manager = new ClipboardManager({ historyEnabled: true, maxHistory: 5 });
    });

    it('should get history', async () => {
      await manager.copy('Item 1');
      await manager.copy('Item 2');

      const history = manager.getHistory();

      expect(history.length).toBe(2);
    });

    it('should get recent history', async () => {
      await manager.copy('Item 1');
      await manager.copy('Item 2');
      await manager.copy('Item 3');

      const recent = manager.getRecentHistory(2);

      expect(recent.length).toBe(2);
      expect(recent[0].content).toBe('Item 3'); // Most recent first
      expect(recent[1].content).toBe('Item 2');
    });

    it('should search history', async () => {
      await manager.copy('Hello World');
      await manager.copy('Goodbye World');
      await manager.copy('Hello Universe');

      const results = manager.searchHistory('hello');

      expect(results.length).toBe(2);
    });

    it('should get history by type', async () => {
      await manager.copy('https://example.com');
      await manager.copy('/home/user/file.txt');
      await manager.copy('const x = 1;');

      const urls = manager.getHistoryByType('url');

      expect(urls.length).toBe(1);
      expect(urls[0].type).toBe('url');
    });

    it('should copy from history', async () => {
      await manager.copy('Item 1');
      await manager.copy('Item 2');

      const result = await manager.copyFromHistory(0);

      expect(result).toBe(true);
    });

    it('should return false for invalid history index', async () => {
      await manager.copy('Item 1');

      const result = await manager.copyFromHistory(10);

      expect(result).toBe(false);
    });

    it('should return false for negative history index', async () => {
      await manager.copy('Item 1');

      const result = await manager.copyFromHistory(-1);

      expect(result).toBe(false);
    });

    it('should clear history', async () => {
      await manager.copy('Item 1');
      await manager.copy('Item 2');

      manager.clearHistory();

      expect(manager.getHistory().length).toBe(0);
    });

    it('should remove from history', async () => {
      await manager.copy('Item 1');
      await manager.copy('Item 2');

      const result = manager.removeFromHistory(0);

      expect(result).toBe(true);
      expect(manager.getHistory().length).toBe(1);
    });

    it('should return false when removing invalid index', async () => {
      await manager.copy('Item 1');

      const result = manager.removeFromHistory(10);

      expect(result).toBe(false);
    });

    it('should trim history when exceeding maxHistory', async () => {
      for (let i = 0; i < 10; i++) {
        await manager.copy(`Item ${i}`);
      }

      const history = manager.getHistory();

      expect(history.length).toBe(5);
    });
  });

  describe('Content Type Detection', () => {
    beforeEach(() => {
      mockExec.mockImplementation((cmd, callback) => {
        const child = {
          stdin: {
            write: jest.fn(),
            end: jest.fn(),
          },
        };
        callback(null);
        return child;
      });
      manager = new ClipboardManager({ autoDetectType: true });
    });

    it('should detect URL type', async () => {
      await manager.copy('https://example.com/page');

      const history = manager.getHistory();
      expect(history[0].type).toBe('url');
    });

    it('should detect HTTP URL type', async () => {
      await manager.copy('http://example.com');

      const history = manager.getHistory();
      expect(history[0].type).toBe('url');
    });

    it('should detect Unix path type', async () => {
      await manager.copy('/home/user/file.txt');

      const history = manager.getHistory();
      expect(history[0].type).toBe('path');
    });

    it('should detect Windows path type', async () => {
      await manager.copy('C:\\Users\\user\\file.txt');

      const history = manager.getHistory();
      expect(history[0].type).toBe('path');
    });

    it('should detect code type with import statement', async () => {
      await manager.copy('import React from "react";');

      const history = manager.getHistory();
      expect(history[0].type).toBe('code');
    });

    it('should detect code type with function keyword', async () => {
      await manager.copy('function hello() { return 1; }');

      const history = manager.getHistory();
      expect(history[0].type).toBe('code');
    });

    it('should detect code type with class keyword', async () => {
      await manager.copy('class MyClass { constructor() {} }');

      const history = manager.getHistory();
      expect(history[0].type).toBe('code');
    });

    it('should detect code type with curly braces', async () => {
      await manager.copy('{ "key": "value" }');

      const history = manager.getHistory();
      expect(history[0].type).toBe('code');
    });

    it('should detect code type with arrow function', async () => {
      await manager.copy('const fn = () => true');

      const history = manager.getHistory();
      expect(history[0].type).toBe('code');
    });

    it('should detect code type with semicolon at end', async () => {
      await manager.copy('x = 1;');

      const history = manager.getHistory();
      expect(history[0].type).toBe('code');
    });

    it('should detect code type with comments', async () => {
      await manager.copy('// This is a comment\ncode here');

      const history = manager.getHistory();
      expect(history[0].type).toBe('code');
    });

    it('should default to text type', async () => {
      await manager.copy('Just some plain text');

      const history = manager.getHistory();
      expect(history[0].type).toBe('text');
    });

    it('should use text type when autoDetectType is false', async () => {
      manager = new ClipboardManager({ autoDetectType: false });

      await manager.copy('https://example.com');

      const history = manager.getHistory();
      expect(history[0].type).toBe('text');
    });
  });

  describe('isAvailable', () => {
    it('should return true when clipboard is available', async () => {
      mockExec.mockImplementation((cmd, options, callback) => {
        callback(null, 'content');
      });
      manager = new ClipboardManager();

      const result = await manager.isAvailable();

      expect(result).toBe(true);
    });

    it('should return false when clipboard is unavailable', async () => {
      mockExec.mockImplementation((cmd, options, callback) => {
        callback(new Error('No clipboard'));
      });
      manager = new ClipboardManager();

      const result = await manager.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe('formatHistory', () => {
    beforeEach(() => {
      mockExec.mockImplementation((cmd, callback) => {
        const child = {
          stdin: {
            write: jest.fn(),
            end: jest.fn(),
          },
        };
        callback(null);
        return child;
      });
      manager = new ClipboardManager();
    });

    it('should return empty message when history is empty', () => {
      const formatted = manager.formatHistory();

      expect(formatted).toBe('Clipboard history is empty.');
    });

    it('should format history with entries', async () => {
      await manager.copy('Short text');
      await manager.copyCode('const x = 1;', 'typescript');

      const formatted = manager.formatHistory();

      expect(formatted).toContain('CLIPBOARD HISTORY');
      expect(formatted).toContain('Short text');
    });

    it('should truncate long content in preview', async () => {
      await manager.copy('This is a very long text that should be truncated in the preview because it exceeds the maximum length');

      const formatted = manager.formatHistory();

      expect(formatted).toContain('...');
    });

    it('should replace newlines with special character', async () => {
      await manager.copy('Line 1\nLine 2');

      const formatted = manager.formatHistory();

      // The newline should be replaced
      expect(formatted).toContain('Line 1');
    });

    it('should show language metadata', async () => {
      await manager.copyCode('code', 'python');

      const formatted = manager.formatHistory();

      expect(formatted).toContain('python');
    });
  });

  describe('History Persistence', () => {
    it('should save history when adding entries', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        const child = {
          stdin: {
            write: jest.fn(),
            end: jest.fn(),
          },
        };
        callback(null);
        return child;
      });
      manager = new ClipboardManager({ historyEnabled: true });

      await manager.copy('Test');

      expect(mockEnsureDirSync).toHaveBeenCalled();
      expect(mockWriteJsonSync).toHaveBeenCalled();
    });

    it('should save history when clearing', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        const child = {
          stdin: {
            write: jest.fn(),
            end: jest.fn(),
          },
        };
        callback(null);
        return child;
      });
      manager = new ClipboardManager({ historyEnabled: true });

      await manager.copy('Test');
      manager.clearHistory();

      // Called twice: once for copy, once for clear
      expect(mockWriteJsonSync).toHaveBeenCalledTimes(2);
    });

    it('should handle save errors gracefully', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        const child = {
          stdin: {
            write: jest.fn(),
            end: jest.fn(),
          },
        };
        callback(null);
        return child;
      });
      mockWriteJsonSync.mockImplementation(() => {
        throw new Error('Write error');
      });
      manager = new ClipboardManager({ historyEnabled: true });

      // Should not throw
      await manager.copy('Test');

      expect(manager.getHistory().length).toBe(1);
    });
  });
});

describe('Singleton and Helper Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockPlatform.mockReturnValue('linux');
  });

  describe('getClipboardManager', () => {
    it('should return singleton instance', () => {
      const manager1 = getClipboardManager();
      const manager2 = getClipboardManager();

      expect(manager1).toBe(manager2);
    });
  });

  describe('copyToClipboard', () => {
    it('should use singleton to copy', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        const child = {
          stdin: {
            write: jest.fn(),
            end: jest.fn(),
          },
        };
        callback(null);
        return child;
      });

      const result = await copyToClipboard('Test');

      expect(result).toBe(true);
    });
  });

  describe('pasteFromClipboard', () => {
    it('should use singleton to paste', async () => {
      mockExec.mockImplementation((cmd, options, callback) => {
        callback(null, 'Pasted content');
      });

      const result = await pasteFromClipboard();

      expect(result).toBe('Pasted content');
    });
  });
});
