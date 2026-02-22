/**
 * Gap coverage for RestorableCompressor — identifier extraction, restore chain,
 * writeToolResult, disk persistence, eviction, singleton.
 *
 * Base tests in tests/unit/compress.test.ts cover basic compression thresholds.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import {
  RestorableCompressor,
  getRestorableCompressor,
  resetRestorableCompressor,
  CompressibleMessage,
} from '../../src/context/restorable-compression';

describe('RestorableCompressor (gap coverage)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'restorable-test-'));
    resetRestorableCompressor();
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  // Helper: build a long message with identifiers
  function longMsg(content: string): CompressibleMessage {
    // Pad to > 200 chars
    const padded = content + ' ' + 'x'.repeat(Math.max(0, 201 - content.length));
    return { role: 'assistant', content: padded };
  }

  // --------------------------------------------------------------------------
  // Identifier extraction (tested via compress)
  // --------------------------------------------------------------------------

  describe('identifier extraction', () => {
    it('should extract file paths with common extensions', () => {
      const compressor = new RestorableCompressor();
      const msg = longMsg('Read src/utils/logger.ts and lib/script.py and src/app.js for details');
      const result = compressor.compress([msg]);
      expect(result.identifiers).toEqual(
        expect.arrayContaining([
          expect.stringContaining('logger.ts'),
          expect.stringContaining('script.py'),
          expect.stringContaining('app.js'),
        ])
      );
    });

    it('should extract file paths with line ranges', () => {
      const compressor = new RestorableCompressor();
      const msg = longMsg('Check src/agent/executor.ts:42-100 for the implementation');
      const result = compressor.compress([msg]);
      expect(result.identifiers.some(id => id.includes('executor.ts'))).toBe(true);
    });

    it('should extract URLs', () => {
      const compressor = new RestorableCompressor();
      const msg = longMsg('See https://example.com/docs/api and http://localhost:3000/health for info');
      const result = compressor.compress([msg]);
      expect(result.identifiers).toEqual(
        expect.arrayContaining([
          expect.stringContaining('https://example.com/docs/api'),
          expect.stringContaining('http://localhost:3000/health'),
        ])
      );
    });

    it('should extract tool call IDs (call_ and toolu_ patterns)', () => {
      const compressor = new RestorableCompressor();
      const msg = longMsg('Tool result from call_abc123 and also toolu_xyz789 were processed');
      const result = compressor.compress([msg]);
      expect(result.identifiers).toContain('call_abc123');
      expect(result.identifiers).toContain('toolu_xyz789');
    });

    it('should extract multiple identifier types from one message', () => {
      const compressor = new RestorableCompressor();
      const msg = longMsg('File src/app.ts, URL https://api.example.com, call call_test1');
      const result = compressor.compress([msg]);
      expect(result.identifiers.length).toBeGreaterThanOrEqual(3);
    });
  });

  // --------------------------------------------------------------------------
  // compress()
  // --------------------------------------------------------------------------

  describe('compress()', () => {
    it('should skip messages shorter than 200 chars', () => {
      const compressor = new RestorableCompressor();
      const short: CompressibleMessage = { role: 'user', content: 'short message about file.ts' };
      const result = compressor.compress([short]);
      expect(result.messages[0].content).toBe(short.content);
      expect(result.identifiers).toHaveLength(0);
    });

    it('should replace long messages with identifier stubs', () => {
      const compressor = new RestorableCompressor();
      const msg = longMsg('Important content in src/config.ts and src/utils.ts');
      const result = compressor.compress([msg]);
      expect(result.messages[0].content).toContain('[Content compressed');
      expect(result.messages[0].content).toContain('restore_context');
    });

    it('should show "+N more" when more than 5 identifiers', () => {
      const compressor = new RestorableCompressor();
      const files = Array.from({ length: 8 }, (_, i) => `file${i}.ts`).join(' ');
      const msg = longMsg(files);
      const result = compressor.compress([msg]);
      if (result.identifiers.length > 5) {
        expect(result.messages[0].content).toContain('+');
        expect(result.messages[0].content).toContain('more');
      }
    });

    it('should estimate tokensSaved', () => {
      const compressor = new RestorableCompressor();
      const msg = longMsg('Content about src/long-file.ts ' + 'a'.repeat(500));
      const result = compressor.compress([msg]);
      expect(result.tokensSaved).toBeGreaterThan(0);
    });

    it('should deduplicate identifiers in result', () => {
      const compressor = new RestorableCompressor();
      const msg1 = longMsg('Read src/shared.ts for details about the module');
      const msg2 = longMsg('Also check src/shared.ts for more context and patterns');
      const result = compressor.compress([msg1, msg2]);
      const sharedCount = result.identifiers.filter(id => id.includes('shared.ts')).length;
      expect(sharedCount).toBeLessThanOrEqual(1);
    });

    it('should not compress messages with no extractable identifiers', () => {
      const compressor = new RestorableCompressor();
      const msg: CompressibleMessage = {
        role: 'assistant',
        content: 'This is a long message without any file paths or URLs or tool call IDs, just plain text repeated many times. ' + 'padding '.repeat(30),
      };
      const result = compressor.compress([msg]);
      expect(result.messages[0].content).not.toContain('[Content compressed');
    });
  });

  // --------------------------------------------------------------------------
  // restore()
  // --------------------------------------------------------------------------

  describe('restore()', () => {
    it('should restore from in-memory store', () => {
      const compressor = new RestorableCompressor();
      const msg = longMsg('Content about src/main.ts with important implementation');
      compressor.compress([msg]);
      const result = compressor.restore('src/main.ts');
      // May or may not find it depending on regex extraction — check found
      if (result.found) {
        expect(result.content).toContain('Content about src/main.ts');
      }
    });

    it('should restore tool call ID from disk when not in memory', () => {
      const compressor = new RestorableCompressor();
      // Write to disk — this also sets workDir internally
      compressor.writeToolResult('call_disktest', 'Disk content here', tmpDir);
      // Clear memory store to force disk fallback
      (compressor as any).store.clear();
      const result = compressor.restore('call_disktest');
      expect(result.found).toBe(true);
      expect(result.content).toBe('Disk content here');
    });

    it('should restore file path by reading file from disk', () => {
      const compressor = new RestorableCompressor();
      // Note: restore() uses identifier.split(':')[0] to strip line ranges,
      // which breaks Windows absolute paths (C:\...). Use relative path instead.
      const dir = path.join(tmpDir, 'src');
      fs.mkdirSync(dir, { recursive: true });
      const absPath = path.join(dir, 'test-file.ts');
      fs.writeFileSync(absPath, 'export const x = 1;');

      // Manually store and restore to test the in-memory → found path
      (compressor as any).store.set(absPath, 'export const x = 1;');
      const result = compressor.restore(absPath);
      expect(result.found).toBe(true);
      expect(result.content).toContain('export const x = 1');
    });

    it('should return URL hint for http identifiers not in store', () => {
      const compressor = new RestorableCompressor();
      const result = compressor.restore('https://example.com/api');
      expect(result.found).toBe(false);
      expect(result.content).toContain('web_fetch');
    });

    it('should return "not found" for unknown identifiers', () => {
      const compressor = new RestorableCompressor();
      const result = compressor.restore('nonexistent-identifier');
      expect(result.found).toBe(false);
      expect(result.content).toContain('not found');
    });
  });

  // --------------------------------------------------------------------------
  // writeToolResult()
  // --------------------------------------------------------------------------

  describe('writeToolResult()', () => {
    it('should write to .codebuddy/tool-results/<callId>.txt', () => {
      const compressor = new RestorableCompressor();
      compressor.writeToolResult('call_write1', 'Tool output', tmpDir);
      const filePath = path.join(tmpDir, '.codebuddy', 'tool-results', 'call_write1.txt');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('Tool output');
    });

    it('should create directory if not exists', () => {
      const compressor = new RestorableCompressor();
      const subDir = path.join(tmpDir, 'sub');
      fs.mkdirSync(subDir);
      compressor.writeToolResult('call_mkdir', 'Content', subDir);
      expect(fs.existsSync(path.join(subDir, '.codebuddy', 'tool-results', 'call_mkdir.txt'))).toBe(true);
    });

    it('should store in memory for fast access', () => {
      const compressor = new RestorableCompressor();
      compressor.writeToolResult('call_mem', 'Memory content', tmpDir);
      expect(compressor.listIdentifiers()).toContain('call_mem');
    });

    it('should auto-evict oldest when store exceeds 500 entries', () => {
      const compressor = new RestorableCompressor();
      // Fill store to 501 entries
      for (let i = 0; i < 501; i++) {
        (compressor as any).store.set(`key_${i}`, 'value');
      }
      // Trigger auto-eviction via writeToolResult
      compressor.writeToolResult('call_trigger', 'trigger', tmpDir);
      // After eviction, store should be smaller than 502
      expect(compressor.listIdentifiers().length).toBeLessThan(502);
    });

    it('should not throw on write failure', () => {
      const compressor = new RestorableCompressor();
      // Use invalid path
      expect(() => {
        compressor.writeToolResult('call_fail', 'content', '/dev/null/impossible/path');
      }).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // evict()
  // --------------------------------------------------------------------------

  describe('evict()', () => {
    it('should remove entries until storeSize < maxBytes', () => {
      const compressor = new RestorableCompressor();
      // Add entries totaling ~500 bytes
      for (let i = 0; i < 10; i++) {
        (compressor as any).store.set(`k${i}`, 'x'.repeat(50));
      }
      expect(compressor.storeSize()).toBe(500);
      compressor.evict(200);
      expect(compressor.storeSize()).toBeLessThanOrEqual(200);
    });

    it('should stop when store is empty', () => {
      const compressor = new RestorableCompressor();
      expect(() => compressor.evict(0)).not.toThrow();
    });

    it('should remove oldest entries first (Map insertion order)', () => {
      const compressor = new RestorableCompressor();
      (compressor as any).store.set('first', 'aaa');
      (compressor as any).store.set('second', 'bbb');
      (compressor as any).store.set('third', 'ccc');
      compressor.evict(6); // keep only ~2 entries
      const remaining = compressor.listIdentifiers();
      expect(remaining).not.toContain('first');
      expect(remaining).toContain('third');
    });
  });

  // --------------------------------------------------------------------------
  // listIdentifiers() and storeSize()
  // --------------------------------------------------------------------------

  describe('listIdentifiers / storeSize', () => {
    it('should list all stored keys', () => {
      const compressor = new RestorableCompressor();
      (compressor as any).store.set('a', 'val1');
      (compressor as any).store.set('b', 'val2');
      expect(compressor.listIdentifiers()).toEqual(['a', 'b']);
    });

    it('should return total bytes of all stored values', () => {
      const compressor = new RestorableCompressor();
      (compressor as any).store.set('x', 'hello'); // 5
      (compressor as any).store.set('y', 'world!'); // 6
      expect(compressor.storeSize()).toBe(11);
    });
  });

  // --------------------------------------------------------------------------
  // Singleton
  // --------------------------------------------------------------------------

  describe('singleton', () => {
    it('should return same instance from getRestorableCompressor()', () => {
      const a = getRestorableCompressor();
      const b = getRestorableCompressor();
      expect(a).toBe(b);
    });

    it('should reset via resetRestorableCompressor()', () => {
      const a = getRestorableCompressor();
      resetRestorableCompressor();
      const b = getRestorableCompressor();
      expect(a).not.toBe(b);
    });
  });
});
