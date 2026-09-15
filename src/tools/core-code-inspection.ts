import fs from 'node:fs';
import path from 'node:path';
import type { CoreRootResolution } from '../identity/operational-self-model.js';

export interface CoreCodeRequest {
  operation: 'list' | 'read' | 'search';
  path?: string;
  query?: string;
  line?: number;
  offset?: number;
}

const TEXT_FILE = /\.(?:[cm]?[jt]sx?|md)$/i;
const MAX_FILE_BYTES = 512 * 1024;

/** Read only implementation files within the already-attested core, never the user's project. */
export function inspectCoreCode(core: CoreRootResolution, request: CoreCodeRequest) {
  if (core.layout === 'unknown') throw new Error('Code Buddy implementation root is not attested.');
  const root = fs.realpathSync(core.root);
  const relative = request.path || (core.layout === 'source' ? 'src' : 'dist');
  if (path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p => p === '..' || p.startsWith('.')) ||
    !/^(src|dist|packages)(\/|$)/.test(relative)) {
    throw new Error('Use a relative implementation path under src/, dist/ or packages/.');
  }
  const target = path.resolve(root, relative);
  function confined(file: string): boolean {
    const real = fs.realpathSync(file);
    const rel = path.relative(root, real);
    return !path.isAbsolute(rel) && /^(src|dist|packages)(\/|$)/.test(rel.split(path.sep).join('/')) &&
      !rel.split(path.sep).some(part => part.startsWith('.'));
  }
  if (!confined(target)) throw new Error('Implementation path escapes the core root.');
  const stat = fs.statSync(target);
  if (request.operation === 'read') {
    if (!stat.isFile() || !TEXT_FILE.test(target) || stat.size > MAX_FILE_BYTES) throw new Error('Expected an implementation text file of at most 512 KiB.');
    const lines = fs.readFileSync(target, 'utf8').split('\n');
    const start = Math.max(1, request.line ?? 1);
    return { operation: 'read', path: relative, line: start, totalLines: lines.length,
      content: lines.slice(start - 1, start + 119).map((text, i) => `${start + i}: ${text.slice(0, 500)}`).join('\n'),
      truncated: start + 119 < lines.length };
  }
  if (!stat.isDirectory()) throw new Error('Expected an implementation directory.');
  if (request.operation === 'list') {
    const entries = fs.readdirSync(target, { withFileTypes: true }).filter(entry =>
      !entry.name.startsWith('.') && entry.name !== 'node_modules' && !entry.isSymbolicLink() &&
      (entry.isDirectory() || TEXT_FILE.test(entry.name)));
    const offset = request.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('List offset must be a non-negative integer.');
    const nextOffset = offset + 100 < entries.length ? offset + 100 : null;
    return { operation: 'list', path: relative, entries: entries.slice(offset, offset + 100).map(entry => ({
      name: entry.name, directory: entry.isDirectory(),
    })), offset, nextOffset, totalEntries: entries.length, truncated: nextOffset !== null };
  }
  if (!request.query?.trim() || request.query.length > 160) throw new Error('Search requires a literal query of 1–160 characters.');
  const query = request.query.toLowerCase();
  const matches: Array<{ path: string; line: number; text: string }> = [];
  const pending = [target];
  let visited = 0;
  let bytes = 0;
  while (pending.length && visited < 4000 && matches.length < 30 && bytes < 8 * 1024 * 1024) {
    const dir = pending.shift()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (++visited >= 4000 || matches.length >= 30 || bytes >= 8 * 1024 * 1024) break;
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (!confined(file)) continue;
      if (entry.isDirectory()) { pending.push(file); continue; }
      if (!entry.isFile() || !TEXT_FILE.test(entry.name)) continue;
      const size = fs.statSync(file).size;
      if (size > MAX_FILE_BYTES) continue;
      bytes += size;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length && matches.length < 30; i++) {
        if (lines[i]!.toLowerCase().includes(query)) matches.push({
          path: path.relative(root, file).split(path.sep).join('/'), line: i + 1, text: lines[i]!.slice(0, 500),
        });
      }
    }
  }
  return { operation: 'search', path: relative, query: request.query, matches,
    truncated: pending.length > 0 || visited >= 4000 || matches.length >= 30 || bytes >= 8 * 1024 * 1024 };
}
