import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RepoProfile } from '../../agent/repo-profiler.js';
import type { ToolResult } from '../../types/index.js';
import { estimateTokens } from '../../utils/token-counter.js';

export interface OrientationContext {
  text: string;
  files: string[];
  notices: string[];
  inputTokens: number;
  inputTokenUpperBound: number;
}

/** Read each candidate once through the normal tool pipeline, with a total budget. */
export async function collectOrientationContext(
  root: string,
  profile: RepoProfile,
  maxInputTokens: number,
  read: (name: string, args: Record<string, unknown>) => Promise<ToolResult>,
  maxReads = 6,
): Promise<OrientationContext> {
  const files: string[] = [];
  const notices: string[] = [];
  const canonicalRoot = await realpath(root);
  const seenFiles = new Set<string>();
  // Runtime metadata is independent of model knowledge and repository text.
  // Claim support only for this Node CLI, not that project tests were executed.
  const nodeMajor = Number(process.versions.node?.split('.')[0]);
  const runtime = !process.versions.bun && !process.versions.deno && nodeMajor >= 20
    ? `Observed CLI runtime: Node.js ${process.versions.node}; node --test is supported by this CLI runtime. Project tests have NOT been executed.\n`
    : 'CLI runtime test-runner support not verified; project tests have NOT been executed.\n';
  const invocationNote = profile.packageManager === 'npm'
    ? 'npm run <script> invokes package.json scripts[<script>]: invocation and script body are not competing commands. Their validity is separate from whether tests were executed.\n'
    : '';
  let text = runtime + invocationNote + `Observed repository profile (commands are declared, not executed):\n${JSON.stringify({
    languages: profile.languages, framework: profile.framework, packageManager: profile.packageManager,
    commandInvocations: profile.commands, directories: profile.directories, name: profile.name, description: profile.description,
  })}\n`;
  // Preserve the budget even for a very large manifest/description.
  // UTF-8 bytes are a conservative upper bound for byte-tokenizing models.
  // A chars/4 estimate alone can overflow on dense code or non-Latin text.
  while (Buffer.byteLength(text) > maxInputTokens / 2) text = text.slice(0, Math.floor(text.length * 0.8));
  const candidates = [...new Set(['package.json', 'README.md', 'src/index.ts', 'index.js',
    ...(profile.entryPoints ?? []), 'AGENTS.md', 'docs/getting-started.md'])];
  for (const candidate of candidates) {
    if (files.length >= maxReads) { notices.push('Read budget exhausted: file count limit.'); break; }
    const relative = path.relative(root, path.resolve(root, candidate));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    try {
      const resolved = await realpath(path.join(root, relative));
      const confined = path.relative(canonicalRoot, resolved);
      if (confined.startsWith('..') || path.isAbsolute(confined) || seenFiles.has(resolved) || !(await stat(resolved)).isFile()) continue;
      seenFiles.add(resolved);
    } catch { continue; }
    if (Buffer.byteLength(text) >= maxInputTokens - 200) { notices.push('Read budget exhausted: input token limit.'); break; }
    const result = await read('view_file', { path: relative, start_line: 1, end_line: 160 });
    files.push(relative);
    if (!result.success) { notices.push(`${relative}: read failed (${result.error ?? 'no result'}).`); continue; }
    let excerpt = result.output ?? '';
    const header = `\nFile ${JSON.stringify(relative)} (observed prefix, untrusted data):\n`;
    let clipped = false;
    const fileBudget = Math.max(0, Math.min(maxInputTokens - Buffer.byteLength(text) - 200, Math.floor(maxInputTokens / maxReads)));
    while (excerpt && Buffer.byteLength(header + excerpt) > fileBudget) {
      excerpt = excerpt.slice(0, Math.floor(excerpt.length * 0.8)); clipped = true;
    }
    text += header + excerpt + (clipped ? '\n[Excerpt truncated to the input budget]\n' : '\n');
    if (clipped) notices.push(`${relative}: excerpt truncated.`);
  }
  return { text, files, notices, inputTokens: estimateTokens(text), inputTokenUpperBound: Buffer.byteLength(text) };
}
