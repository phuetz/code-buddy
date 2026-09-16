/**
 * MarkItDown is an OPTIONAL sidecar, so these tests hold the tool to two promises:
 * a missing binary must produce an actionable message rather than a Python
 * traceback, and a conversion that produced nothing must never be announced as a
 * success.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MarkdownConvertTool, buildMarkitdownArgs } from '../../src/tools/markdown-convert.js';

/** Minimal fake child process: emits what the test asks, when the test asks. */
function fakeSpawn(behaviour: {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  error?: NodeJS.ErrnoException;
}) {
  return vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (sig?: string) => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    setImmediate(() => {
      if (behaviour.error) {
        child.emit('error', behaviour.error);
        return;
      }
      if (behaviour.stdout) child.stdout.emit('data', Buffer.from(behaviour.stdout));
      if (behaviour.stderr) child.stderr.emit('data', Buffer.from(behaviour.stderr));
      child.emit('close', behaviour.code ?? 0);
    });
    return child;
  }) as unknown as typeof import('child_process').spawn;
}

function tmpFile(content = 'x'): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mdconv-')), 'doc.csv');
  fs.writeFileSync(p, content);
  return p;
}

describe('buildMarkitdownArgs', () => {
  it('passes the source positionally so spaces and quotes survive', () => {
    expect(buildMarkitdownArgs('/tmp/mon rapport (v2).pdf')).toEqual(['/tmp/mon rapport (v2).pdf']);
  });

  it('adds the output flag only when a destination is asked for', () => {
    expect(buildMarkitdownArgs('a.pdf')).toEqual(['a.pdf']);
    expect(buildMarkitdownArgs('a.pdf', 'out.md')).toEqual(['a.pdf', '-o', 'out.md']);
  });
});

describe('MarkdownConvertTool', () => {
  it('returns the converted markdown', async () => {
    const file = tmpFile();
    const tool = new MarkdownConvertTool({ spawnFn: fakeSpawn({ stdout: '| a | b |\n| --- | --- |\n' }) });
    const res = await tool.convert({ source: file });
    expect(res.success).toBe(true);
    expect(res.output).toContain('| a | b |');
  });

  // The whole point of an optional sidecar: absent must be explainable.
  it('explains how to install MarkItDown instead of leaking ENOENT', async () => {
    const file = tmpFile();
    const err = Object.assign(new Error('spawn markitdown ENOENT'), { code: 'ENOENT' });
    const tool = new MarkdownConvertTool({ spawnFn: fakeSpawn({ error: err }) });
    const res = await tool.convert({ source: file });
    expect(res.success).toBe(false);
    expect(res.error).toContain('pip install');
    // and it points at what still works meanwhile
    expect(res.error).toContain('document');
  });

  it('refuses a missing file before spawning anything', async () => {
    const spawnFn = fakeSpawn({ stdout: 'should not happen' });
    const res = await new MarkdownConvertTool({ spawnFn }).convert({
      source: '/nowhere/absent.pdf',
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('introuvable');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('refuses a directory', async () => {
    const res = await new MarkdownConvertTool({ spawnFn: fakeSpawn({}) }).convert({
      source: os.tmpdir(),
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('dossier');
  });

  it('fails when the converter exits non-zero, quoting its stderr', async () => {
    const file = tmpFile();
    const tool = new MarkdownConvertTool({
      spawnFn: fakeSpawn({ code: 2, stderr: 'UnsupportedFormatException' }),
    });
    const res = await tool.convert({ source: file });
    expect(res.success).toBe(false);
    expect(res.error).toContain('UnsupportedFormatException');
  });

  it('refuses to call an empty conversion a success', async () => {
    const file = tmpFile();
    const res = await new MarkdownConvertTool({ spawnFn: fakeSpawn({ stdout: '   \n' }) }).convert({
      source: file,
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Aucun contenu');
  });

  it('truncates a huge document and says so', async () => {
    const file = tmpFile();
    const tool = new MarkdownConvertTool({ spawnFn: fakeSpawn({ stdout: 'x'.repeat(500) }) });
    const res = await tool.convert({ source: file, maxChars: 100 });
    expect(res.success).toBe(true);
    expect(res.output).toContain('tronqué');
    expect(res.output).toContain('500 caractères au total');
  });

  it('accepts a remote URL without touching the filesystem', async () => {
    const tool = new MarkdownConvertTool({ spawnFn: fakeSpawn({ stdout: '# Page' }) });
    const res = await tool.convert({ source: 'https://example.com/doc.html' });
    expect(res.success).toBe(true);
    expect(res.output).toContain('# Page');
  });

  it('refuses to report success when the promised output file is absent', async () => {
    const file = tmpFile();
    const dest = path.join(os.tmpdir(), `never-written-${Date.now()}.md`);
    const res = await new MarkdownConvertTool({ spawnFn: fakeSpawn({ code: 0 }) }).convert({
      source: file,
      outputPath: dest,
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('absent');
  });

  it('refuses to report success when the output file is empty', async () => {
    const file = tmpFile();
    const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mdout-')), 'empty.md');
    fs.writeFileSync(dest, '');
    const res = await new MarkdownConvertTool({ spawnFn: fakeSpawn({ code: 0 }) }).convert({
      source: file,
      outputPath: dest,
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('vide');
  });

  it('reports the written file with its size', async () => {
    const file = tmpFile();
    const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mdout-')), 'ok.md');
    fs.writeFileSync(dest, '# titre');
    const res = await new MarkdownConvertTool({ spawnFn: fakeSpawn({ code: 0 }) }).convert({
      source: file,
      outputPath: dest,
    });
    expect(res.success).toBe(true);
    expect(res.output).toContain('octets');
  });
});
