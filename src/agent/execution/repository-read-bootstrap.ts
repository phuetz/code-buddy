import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CodeBuddyToolCall } from '../../codebuddy/client.js';
import type { ToolResult } from '../../types/index.js';

/** Narrow first-contact requests: don't pre-read files for general conversation. */
export function needsRepositoryRead(query: string): boolean {
  return /\breadme\b|\bentry\s*points?\b|\bpoint\s+d[’']?\s*entr[ée]e\b|\b(?:explain|analyse|analyze)\s+(?:this\s+code|(?:the\s+)?codebase(?:\s+structure)?)\b/i.test(query);
}

/**
 * Host-requested reads, through the ordinary tool pipeline (permissions, hooks,
 * workspace validation, recovery). These are observations, never model claims.
 * Contents stay bounded and package main paths cannot escape the workspace.
 */
export async function* bootstrapRepositoryReads(
  query: string,
  cwd: string,
  execute: (call: CodeBuddyToolCall) => Promise<ToolResult>,
): AsyncGenerator<{ toolCall: CodeBuddyToolCall; toolResult: ToolResult }> {
  if (!needsRepositoryRead(query)) return;
  const readmeOnly = /\breadme\b/i.test(query) && !/entry|entr[ée]e/i.test(query);
  const paths = readmeOnly ? ['README.md'] : ['package.json', 'README.md'];
  const used = new Set<string>();
  const root = await realpath(cwd);
  for (const file of paths) {
    const absolute = path.resolve(cwd, file);
    const relative = path.relative(cwd, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || used.has(relative)) continue;
    try {
      const canonical = path.relative(root, await realpath(absolute));
      if (canonical.startsWith('..') || path.isAbsolute(canonical) || !(await stat(absolute)).isFile()) continue;
    } catch { continue; }
    used.add(relative);
    const toolCall: CodeBuddyToolCall = {
      id: `repository_read_${randomUUID()}`, type: 'function',
      function: { name: 'view_file', arguments: JSON.stringify({ path: relative, start_line: 1, end_line: 120 }) },
    };
    const toolResult = await execute(toolCall);
    yield { toolCall, toolResult };
    if (file === 'package.json' && toolResult.success) {
      try {
        const text = (toolResult.output ?? '').split('\n').filter(line => /^\d+: /.test(line))
          .map(line => line.replace(/^\d+: /, '')).join('\n');
        const manifest = JSON.parse(text) as { main?: unknown };
        if (typeof manifest.main === 'string' && manifest.main.length < 256 && /\.(?:[cm]?[jt]sx?)$/.test(manifest.main)) paths.push(manifest.main);
      } catch { /* partial or invalid manifest: don't guess a declared entry */ }
      // Common source entrypoints when package.main points to an unbuilt dist.
      paths.push('src/index.ts', 'index.js');
    }
    if (used.size >= 4) break;
  }
}
