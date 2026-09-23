import {
  getLessonsTracker,
  type LessonItem,
  type LessonsTracker,
} from '../agent/lessons-tracker.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getSessionStore,
  type Session,
  type SessionStore,
} from '../persistence/session-store.js';
import { RunStore } from './run-store.js';
import type { RunEvent, RunSearchResult, RunSummary } from './run-store.js';

export const RUN_RECALL_PACK_SCHEMA_VERSION = 1;

export interface BuildRunRecallPackOptions {
  cwd?: string;
  includeLessons?: boolean;
  includeMemories?: boolean;
  includeSessions?: boolean;
  lessonsTracker?: Pick<LessonsTracker, 'search'>;
  limit?: number;
  maxMemories?: number;
  maxMatchesPerRun?: number;
  maxLessons?: number;
  maxSessions?: number;
  memoryFiles?: string[];
  sessionStore?: Pick<SessionStore, 'searchSessions'>;
  sources?: string[];
  store?: RunStore;
}

export interface RunRecallPackMatch {
  artifact?: string;
  eventType?: string;
  matched: RunSearchResult['matched'];
  score: number;
  snippet: string;
}

export interface RunRecallPackRun {
  artifactCount: number;
  channel?: string;
  eventCount: number;
  matches: RunRecallPackMatch[];
  objective: string;
  runId: string;
  source?: string;
  startedAt: number;
  status: RunSummary['status'];
  tags: string[];
  toolFilterBlocks: RunRecallPackToolFilterBlock[];
}

export interface RunRecallPackToolFilterBlock {
  eventType: RunEvent['type'];
  reason?: string;
  sequence: number;
  source?: string;
  toolCallId?: string;
  toolName: string;
}

export interface RunRecallPackLesson {
  category: LessonItem['category'];
  content: string;
  context?: string;
  createdAt: number;
  id: string;
  source: LessonItem['source'];
}

export interface RunRecallPackSession {
  id: string;
  lastAccessedAt: string;
  messageId?: number;
  name: string;
  parentSessionId?: string;
  role?: string;
  score?: number;
  snippet?: string;
  workingDirectory: string;
}

export interface RunRecallPackMemory {
  category?: string;
  content: string;
  file: string;
  key?: string;
  line: number;
  scope: 'project' | 'project-memory' | 'user' | 'custom';
  score: number;
  sourceSessionId?: string;
}

export interface RunRecallPack {
  schemaVersion: 1;
  generatedAt: string;
  query: string;
  filters: {
    limit: number;
    maxMemories: number;
    maxMatchesPerRun: number;
    maxLessons: number;
    maxSessions: number;
    sources: string[];
  };
  count: number;
  lessonCount: number;
  lessons: RunRecallPackLesson[];
  memories: RunRecallPackMemory[];
  memoryCount: number;
  results: RunSearchResult[];
  runCount: number;
  runs: RunRecallPackRun[];
  sessionCount: number;
  sessions: RunRecallPackSession[];
  promptContext: string;
}

export function buildRunRecallPack(
  query: string,
  options: BuildRunRecallPackOptions = {},
): RunRecallPack {
  const normalizedQuery = query.trim();
  const limit = normalizeLimit(options.limit);
  const maxMemories = normalizeMaxMemories(options.maxMemories);
  const maxMatchesPerRun = normalizeMaxMatchesPerRun(options.maxMatchesPerRun);
  const maxLessons = normalizeMaxLessons(options.maxLessons);
  const maxSessions = normalizeMaxSessions(options.maxSessions);
  const sources = normalizeSources(options.sources);
  const store = options.store ?? RunStore.getInstance();
  const results = normalizedQuery
    ? store.searchRuns(normalizedQuery, { limit, sources })
    : [];
  const runs = groupRecallPackRuns(results, store, maxMatchesPerRun);
  const lessons = findRecallPackLessons(normalizedQuery, options, maxLessons);
  const memories = findRecallPackMemories(normalizedQuery, options, maxMemories);

  const pack: Omit<RunRecallPack, 'promptContext'> = {
    schemaVersion: RUN_RECALL_PACK_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    query: normalizedQuery,
    filters: {
      limit,
      maxMemories,
      maxMatchesPerRun,
      maxLessons,
      maxSessions,
      sources,
    },
    count: results.length,
    lessonCount: lessons.length,
    lessons,
    memories,
    memoryCount: memories.length,
    results,
    runCount: runs.length,
    runs,
    sessionCount: 0,
    sessions: [],
  };

  return {
    ...pack,
    promptContext: formatRunRecallPromptContext(pack),
  };
}

export async function buildRunRecallPackAsync(
  query: string,
  options: BuildRunRecallPackOptions = {},
): Promise<RunRecallPack> {
  const basePack = buildRunRecallPack(query, options);
  const sessions = await findRecallPackSessions(
    basePack.query,
    options,
    basePack.filters.maxSessions,
  );

  if (sessions.length === 0) {
    return basePack;
  }

  const pack: Omit<RunRecallPack, 'promptContext'> = {
    ...basePack,
    sessionCount: sessions.length,
    sessions,
  };

  return {
    ...pack,
    promptContext: formatRunRecallPromptContext(pack),
  };
}

function groupRecallPackRuns(
  results: RunSearchResult[],
  store: RunStore,
  maxMatchesPerRun: number,
): RunRecallPackRun[] {
  const byRun = new Map<string, RunRecallPackRun>();

  for (const result of results) {
    let run = byRun.get(result.runId);
    if (!run) {
      const record = store.getRun(result.runId);
      const summary = record?.summary;
      run = {
        artifactCount: summary?.artifactCount ?? 0,
        channel: summary?.metadata?.channel,
        eventCount: summary?.eventCount ?? 0,
        matches: [],
        objective: result.objective,
        runId: result.runId,
        source: result.source,
        startedAt: result.startedAt,
        status: result.status,
        tags: summary?.metadata?.tags ?? [],
        toolFilterBlocks: record
          ? extractRecallPackToolFilterBlocks(record.summary.runId, store)
          : [],
      };
      byRun.set(result.runId, run);
    }

    if (run.matches.length < maxMatchesPerRun) {
      run.matches.push({
        artifact: result.artifact,
        eventType: result.eventType,
        matched: result.matched,
        score: result.score,
        snippet: result.snippet,
      });
    }
  }

  return [...byRun.values()];
}

function findRecallPackLessons(
  query: string,
  options: BuildRunRecallPackOptions,
  maxLessons: number,
): RunRecallPackLesson[] {
  const shouldInclude = options.includeLessons === true || Boolean(options.lessonsTracker);
  if (!shouldInclude || !query || maxLessons <= 0) return [];

  const tracker = options.lessonsTracker ?? getLessonsTracker(options.cwd ?? process.cwd());
  return tracker.search(query)
    .slice(0, maxLessons)
    .map((lesson) => ({
      category: lesson.category,
      content: lesson.content,
      context: lesson.context,
      createdAt: lesson.createdAt,
      id: lesson.id,
      source: lesson.source,
    }));
}

function findRecallPackMemories(
  query: string,
  options: BuildRunRecallPackOptions,
  maxMemories: number,
): RunRecallPackMemory[] {
  const shouldInclude = options.includeMemories === true || Array.isArray(options.memoryFiles);
  if (!shouldInclude || !query || maxMemories <= 0) return [];

  const queryWords = tokenizeRecallQuery(query);
  const files = options.memoryFiles ?? defaultMemoryFiles(options.cwd);
  const seenFiles = new Set<string>();
  const candidates: RunRecallPackMemory[] = [];

  for (const file of files) {
    const resolved = path.resolve(file);
    if (seenFiles.has(resolved) || !fs.existsSync(resolved)) continue;
    seenFiles.add(resolved);

    let content: string;
    try {
      content = fs.readFileSync(resolved, 'utf-8');
    } catch {
      continue;
    }

    for (const memory of parseRecallPackMemories(resolved, content, options.cwd)) {
      const score = scoreRecallText(
        queryWords,
        [memory.key, memory.category, memory.content].filter(Boolean).join(' '),
      );
      if (score > 0) {
        candidates.push({ ...memory, score });
      }
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line)
    .slice(0, maxMemories);
}

async function findRecallPackSessions(
  query: string,
  options: BuildRunRecallPackOptions,
  maxSessions: number,
): Promise<RunRecallPackSession[]> {
  const shouldInclude = options.includeSessions === true || Boolean(options.sessionStore);
  if (!shouldInclude || !query || maxSessions <= 0) return [];

  const sessionStore = options.sessionStore ?? getSessionStore();
  const sessions = await sessionStore.searchSessions(query);
  return sessions.slice(0, maxSessions).map(formatRecallPackSession);
}

function formatRecallPackSession(session: Session): RunRecallPackSession {
  return {
    id: session.id,
    lastAccessedAt: session.lastAccessedAt.toISOString(),
    messageId: session.metadata?.searchMessageId,
    name: session.name,
    parentSessionId: session.metadata?.parentSessionId,
    role: session.metadata?.searchRole,
    score: session.metadata?.searchScore,
    snippet: session.metadata?.searchSnippet,
    workingDirectory: session.workingDirectory,
  };
}

function formatRunRecallPromptContext(pack: Omit<RunRecallPack, 'promptContext'>): string {
  if (
    pack.runs.length === 0 &&
    pack.lessons.length === 0 &&
    pack.memories.length === 0 &&
    pack.sessions.length === 0
  ) {
    return [
      '# Run recall pack',
      `Query: ${pack.query || '(empty)'}`,
      '',
      'No matching runs were found.',
    ].join('\n');
  }

  const lines = [
    '# Run recall pack',
    `Query: ${pack.query}`,
    `Generated: ${pack.generatedAt}`,
    `Matches: ${pack.count} across ${pack.runCount} run(s)`,
    `Lessons: ${pack.lessonCount}`,
    `Memories: ${pack.memoryCount}`,
    `Sessions: ${pack.sessionCount}`,
    '',
  ];

  if (pack.sessions.length > 0) {
    lines.push('## Sessions');
    for (const session of pack.sessions) {
      const role = session.role ? ` role=${session.role}` : '';
      const message = session.messageId ? ` message=${session.messageId}` : '';
      const parent = session.parentSessionId ? ` parent=${session.parentSessionId}` : '';
      lines.push(`- ${session.id}${role}${message}${parent}: ${session.name}`);
      if (session.snippet) {
        lines.push(`  ${session.snippet}`);
      }
    }
    lines.push('');
  }

  if (pack.memories.length > 0) {
    lines.push('## Memories');
    for (const memory of pack.memories) {
      const key = memory.key ? ` ${memory.key}` : '';
      const category = memory.category ? `[${memory.category}]` : '[memory]';
      const source = memory.sourceSessionId ? ` source=session:${memory.sourceSessionId}` : '';
      lines.push(`- ${category}${key} (${memory.scope}:${path.basename(memory.file)}:${memory.line})${source}`);
      lines.push(`  ${memory.content}`);
    }
    lines.push('');
  }

  if (pack.lessons.length > 0) {
    lines.push('## Lessons');
    for (const lesson of pack.lessons) {
      const context = lesson.context ? ` context=${lesson.context}` : '';
      lines.push(`- [${lesson.category}] ${lesson.id}${context}: ${lesson.content}`);
    }
    lines.push('');
  }

  for (const run of pack.runs) {
    const tags = run.tags.length > 0 ? ` tags=${run.tags.join(',')}` : '';
    const source = run.source ? ` source=${run.source}` : '';
    lines.push(`## ${run.runId}`);
    lines.push(`Objective: ${run.objective}`);
    lines.push(`Status: ${run.status}${source}${tags}`);
    for (const match of run.matches) {
      const label = match.artifact
        ? `${match.matched}:${match.artifact}`
        : match.eventType
          ? `${match.matched}:${match.eventType}`
          : match.matched;
      lines.push(`- ${label} score=${match.score}: ${match.snippet}`);
    }
    if (run.toolFilterBlocks.length > 0) {
      lines.push('Policy blocks:');
      for (const block of run.toolFilterBlocks.slice(0, 8)) {
        const call = block.toolCallId ? ` call=${block.toolCallId}` : '';
        const source = block.source ? ` source=${block.source}` : '';
        const reason = block.reason ? `: ${block.reason}` : '';
        lines.push(`- ${block.toolName}${call}${source}${reason}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function extractRecallPackToolFilterBlocks(
  runId: string,
  store: RunStore,
): RunRecallPackToolFilterBlock[] {
  const events = store.getEvents(runId);
  const byKey = new Map<string, RunRecallPackToolFilterBlock>();

  for (const [index, event] of events.entries()) {
    const block = readToolFilterBlock(event, index + 1);
    if (!block) continue;

    const key = block.toolCallId ?? `${block.toolName}:${block.reason ?? ''}`;
    const existing = byKey.get(key);
    if (!existing || existing.eventType !== 'decision') {
      byKey.set(key, block);
    }
  }

  return [...byKey.values()];
}

function readToolFilterBlock(
  event: RunEvent,
  sequence: number,
): RunRecallPackToolFilterBlock | null {
  const data = event.data;
  const kind = readString(data.kind);
  const source = readString(data.source);
  const blockedBy = readString(data.blockedBy);
  const reason = readString(data.reason) ?? readString(data.error);
  const toolName = readString(data.toolName) ?? readString(data.name);
  if (!toolName) return null;

  const isDecisionBlock =
    event.type === 'decision' && (kind === 'tool_filter_block' || source === 'active_tool_filter');
  const isResultBlock =
    event.type === 'tool_result' &&
    (blockedBy === 'active_tool_filter' || /active tool filter/i.test(reason ?? ''));
  if (!isDecisionBlock && !isResultBlock) return null;

  return {
    eventType: event.type,
    reason,
    sequence,
    source: source ?? blockedBy,
    toolCallId: readString(data.toolCallId),
    toolName,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(100, Math.max(1, Math.trunc(value as number)));
}

function normalizeMaxMemories(value: number | undefined): number {
  if (!Number.isFinite(value)) return 5;
  return Math.min(20, Math.max(0, Math.trunc(value as number)));
}

function normalizeMaxMatchesPerRun(value: number | undefined): number {
  if (!Number.isFinite(value)) return 3;
  return Math.min(10, Math.max(1, Math.trunc(value as number)));
}

function normalizeMaxLessons(value: number | undefined): number {
  if (!Number.isFinite(value)) return 5;
  return Math.min(20, Math.max(0, Math.trunc(value as number)));
}

function normalizeMaxSessions(value: number | undefined): number {
  if (!Number.isFinite(value)) return 3;
  return Math.min(20, Math.max(0, Math.trunc(value as number)));
}

function normalizeSources(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .flatMap((value) => value.split(','))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function defaultMemoryFiles(cwd: string | undefined): string[] {
  const files: string[] = [];
  if (cwd) {
    files.push(
      path.join(cwd, '.codebuddy', 'CODEBUDDY_MEMORY.md'),
      path.join(cwd, '.codebuddy', 'memory', 'MEMORY.md'),
      path.join(cwd, '.codebuddy', 'memory', 'memory_summary.md'),
    );
  }

  const homeMemory = path.join(os.homedir(), '.codebuddy', 'memory.md');
  files.push(homeMemory);

  const configuredHome = process.env.CODEBUDDY_HOME?.trim() || process.env.GROK_HOME?.trim();
  if (configuredHome) {
    files.push(path.join(configuredHome, 'memory.md'));
  }

  return files;
}

function parseRecallPackMemories(
  file: string,
  content: string,
  cwd: string | undefined,
): Omit<RunRecallPackMemory, 'score'>[] {
  const scope = inferMemoryScope(file, cwd);
  const memories: Omit<RunRecallPackMemory, 'score'>[] = [];
  let section = '';

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line?.trim();
    if (!trimmed) continue;

    const heading = trimmed.match(/^##\s+(.+)$/);
    if (heading) {
      const headingText = heading[1];
      if (headingText !== undefined) {
        section = headingText.trim();
      }
      continue;
    }

    const persistent = trimmed.match(/^-\s*\*\*([^*]+)\*\*:\s*(.+)$/);
    if (persistent) {
      const persistentKey = persistent[1];
      const persistentContent = persistent[2];
      if (persistentKey !== undefined && persistentContent !== undefined) {
        memories.push({
          category: normalizeMemoryCategory(section),
          content: persistentContent.trim(),
          file,
          key: persistentKey.trim(),
          line: index + 1,
          scope,
        });
      }
      continue;
    }

    const project = trimmed.match(
      /^-\s*\[(preference|pattern|context|decision)\]\s*(.+?)(?:\s*\(from session:([^)]+)\))?$/i,
    );
    if (project) {
      const projectCategory = project[1];
      const projectContent = project[2];
      if (projectCategory !== undefined && projectContent !== undefined) {
        memories.push({
          category: projectCategory.toLowerCase(),
          content: projectContent.trim(),
          file,
          line: index + 1,
          scope,
          sourceSessionId: project[3],
        });
      }
    }
  }

  return memories;
}

function inferMemoryScope(
  file: string,
  cwd: string | undefined,
): RunRecallPackMemory['scope'] {
  const resolved = path.resolve(file);
  if (cwd) {
    const relative = path.relative(path.resolve(cwd), resolved).replace(/\\/g, '/');
    if (relative === '.codebuddy/CODEBUDDY_MEMORY.md') return 'project';
    if (relative.startsWith('.codebuddy/memory/')) return 'project-memory';
  }
  const configuredHome = process.env.CODEBUDDY_HOME?.trim() || process.env.GROK_HOME?.trim();
  if (
    resolved === path.resolve(path.join(os.homedir(), '.codebuddy', 'memory.md')) ||
    (configuredHome && resolved === path.resolve(path.join(configuredHome, 'memory.md')))
  ) {
    return 'user';
  }
  return 'custom';
}

function normalizeMemoryCategory(section: string): string | undefined {
  const normalized = section.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes('project')) return 'project';
  if (normalized.includes('preference')) return 'preferences';
  if (normalized.includes('decision')) return 'decisions';
  if (normalized.includes('pattern')) return 'patterns';
  if (normalized.includes('context')) return 'context';
  return normalized.replace(/\s+/g, '-');
}

function tokenizeRecallQuery(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^\p{L}\p{N}_-]+/u)
      .map((word) => word.trim())
      .filter((word) => word.length > 1),
  )];
}

function scoreRecallText(queryWords: string[], text: string): number {
  const haystack = text.toLowerCase();
  return queryWords.reduce((score, word) => (
    haystack.includes(word) ? score + 1 : score
  ), 0);
}
