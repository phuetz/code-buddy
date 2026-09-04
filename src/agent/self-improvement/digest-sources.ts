/**
 * Best-effort I/O adapter for the pure self-improvement digest.
 * Missing/corrupt sources become absent or empty inputs; the digest renderer
 * can then report that limitation without preventing the CLI from working.
 *
 * @module agent/self-improvement/digest-sources
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { getLessonsTracker } from '../lessons-tracker.js';
import { logger } from '../../utils/logger.js';
import { AuthoredToolStore } from './authored-tool-store.js';
import { readBenchmarkHistory, resolveBenchmarkHistoryPath } from './continuous-benchmark.js';
import type {
  DigestArtifactKind,
  DigestArtifactRecord,
  ImprovementDigestSources,
} from './digest.js';
import { EvolutionaryArchive } from './evolutionary-archive.js';
import { createWorkspaceLearningStore } from './index.js';
import type { Experience } from './types.js';
import {
  queryEvolutionNotes,
  readEvolutionNotes,
  type EvolutionNote,
} from '../../self-model/evolution-notes.js';

export interface ReadImprovementDigestSourcesOptions {
  workDir?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
}

export interface EvolutionNotesExperienceSourceOptions {
  workDir?: string;
  env?: Record<string, string | undefined>;
  limit?: number;
  readNotes?: () => Promise<EvolutionNote[]>;
  archive?: EvolutionaryArchive;
}

/**
 * Turns recent, documented release notes into experience for the lesson
 * proposer. This source is opt-in and archives its provenance separately from
 * validated lesson improvements; it never asks the engine to edit `src/`.
 */
export class EvolutionNotesExperienceSource {
  readonly id = 'evolution-notes';

  constructor(private readonly options: EvolutionNotesExperienceSourceOptions = {}) {}

  async collect(): Promise<Experience[]> {
    const env = this.options.env ?? process.env;
    if (env.CODEBUDDY_SELF_IMPROVE_EVOLUTION_SOURCE !== 'true') return [];

    const workDir = this.options.workDir ?? process.cwd();
    let notes: EvolutionNote[];
    try {
      notes = queryEvolutionNotes(
        await (this.options.readNotes ?? (() => readEvolutionNotes({ workDir })))(),
        { limit: Math.max(1, Math.min(20, this.options.limit ?? 10)) },
      );
    } catch (error) {
      logger.warn('[self-improve] evolution notes unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
    const archive = this.options.archive ?? new EvolutionaryArchive({ workDir });
    const existing = new Set(
      archive.list()
        .filter((entry) => entry.provenance === 'changelog')
        .map((entry) => entry.proposalId),
    );
    const experiences: Experience[] = [];
    for (const note of notes) {
      const experienceId = `changelog:${note.id}`;
      if (!existing.has(experienceId)) {
        archive.append({
          proposalId: experienceId,
          kind: 'evolution-notes',
          targetScenarioId: 'evolution-notes',
          experienceId,
          delta: 0,
          scoreAfter: 0,
          provenance: 'changelog',
          reviewedBy: 'auto:changelog',
        });
        existing.add(experienceId);
      }
      experiences.push({
        id: experienceId,
        source: 'changelog',
        kind: 'evolution-notes',
        detail: `Ce qui a été réparé et pourquoi : ${note.title}.`,
        context: [
          `Changement documenté le ${note.date ?? 'à une date inconnue'}.`,
          ...note.facts.map((fact) => `- ${fact}`),
          note.activation !== 'unspecified' ? `Activation : ${note.activation}.` : '',
        ].filter(Boolean).join('\n'),
        severity: note.activation === 'opt-in' ? 0.4 : 0.6,
      });
    }
    return experiences;
  }
}

export function createDefaultEvolutionNotesExperienceSource(
  options: Omit<EvolutionNotesExperienceSourceOptions, 'readNotes' | 'archive'> = {},
): EvolutionNotesExperienceSource {
  return new EvolutionNotesExperienceSource(options);
}

export const NAMED_DELEGATION_FAILURES = [
  'Maximum tool execution rounds',
  'Unexpected end of JSON input',
  'trim is not a function',
  'peer closed connection',
  'Turn limit',
] as const;

export type NamedDelegationFailure = (typeof NAMED_DELEGATION_FAILURES)[number];

export const PILOT_LESSONS = [
  'HOME isolé pour Vitest',
  'commiter après chaque point',
  'lire le journal du boot précédent avant de relancer',
  'ne pas éditer un script bash en cours d\'exécution',
  'preuve = tests des fichiers touchés',
] as const;

export type PilotLesson = (typeof PILOT_LESSONS)[number];

export interface DelegationFact {
  id: string;
  engine: string;
  durationSec?: number;
  exitCode?: number;
  changes: string[];
  namedFailures: string[];
  pilotLessons: string[];
  rawPath?: string;
  timestamp?: string;
}

export function extractDelegationFacts(content: string, filename = ''): DelegationFact {
  let engine = 'inconnu';
  const engineMatch =
    content.match(/(?:moteur\s+|→\s+)([a-zA-Z0-9_-]+)(?:\s+sur|\s*·)/i) ??
    content.match(/moteur\s*:\s*([a-zA-Z0-9_-]+)/i);
  if (engineMatch?.[1]) {
    engine = engineMatch[1].trim().toLowerCase();
  } else {
    const fileEngineMatch = filename.match(/\d{4}-\d{2}-\d{2}T\d{6}-([a-zA-Z0-9]+)-/);
    if (fileEngineMatch?.[1]) {
      engine = fileEngineMatch[1].trim().toLowerCase();
    } else {
      const launcherMatch = filename.match(/launcher-(?:[a-zA-Z0-9_-]+-)?([a-zA-Z0-9_-]+?)(?:-[0-9]+)?\.out/);
      if (launcherMatch?.[1]) {
        engine = launcherMatch[1].trim().toLowerCase();
      }
    }
  }

  let durationSec: number | undefined;
  const durationMatch =
    content.match(/·\s*(\d+)\s*s(?:\s*·|\s*$)/i) ??
    content.match(/dur[ée]e\s*:\s*(\d+)\s*s/i) ??
    content.match(/(\d+)\s*s\s*·\s*sortie/i);
  if (durationMatch?.[1]) {
    durationSec = parseInt(durationMatch[1], 10);
  } else {
    const tsMatches = Array.from(
      content.matchAll(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\b/g),
    );
    if (tsMatches.length >= 2) {
      const firstStr = tsMatches[0]?.[1];
      const lastStr = tsMatches[tsMatches.length - 1]?.[1];
      if (firstStr && lastStr) {
        const first = Date.parse(firstStr);
        const last = Date.parse(lastStr);
        if (Number.isFinite(first) && Number.isFinite(last) && last >= first) {
          durationSec = Math.round((last - first) / 1000);
        }
      }
    }
  }

  let exitCode: number | undefined;
  const exitMatch = content.match(/sortie\s+(\d+)/i);
  if (exitMatch?.[1]) {
    exitCode = parseInt(exitMatch[1], 10);
  } else if (
    content.includes('❌ ERROR') ||
    content.includes('errorType') ||
    content.includes('Error: API error') ||
    content.includes('failed')
  ) {
    exitCode = 1;
  } else {
    exitCode = 0;
  }

  const changes: string[] = [];
  const changesBlock = content.match(/── ce qui a bougé ──([\s\S]*?)(?:─────────────────────────────|──\s*$|$)/);
  if (changesBlock?.[1]) {
    const lines = changesBlock[1].split('\n');
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (trimmed && !trimmed.startsWith('──')) {
        changes.push(trimmed);
      }
    }
  }

  const namedFailures = NAMED_DELEGATION_FAILURES.filter((failure) =>
    content.includes(failure),
  );

  const pilotLessons: string[] = [];
  if (
    content.includes('HOME isolé pour Vitest') ||
    /HOME(?:=\S+)?\s+isol[eé]/i.test(content) ||
    /HOME=.*_qa.*home/i.test(content) ||
    /_qa\/\S+\/home/i.test(content)
  ) {
    pilotLessons.push('HOME isolé pour Vitest');
  }
  if (
    content.includes('commiter après chaque point') ||
    /commit(?:er|é|e)?\s+après\s+chaque\s+point/i.test(content) ||
    /un\s+commit\s+par\s+point/i.test(content)
  ) {
    pilotLessons.push('commiter après chaque point');
  }
  if (
    content.includes('lire le journal du boot précédent avant de relancer') ||
    /lire\s+le\s+journal\s+(?:du\s+boot\s+précédent|précédent)/i.test(content)
  ) {
    pilotLessons.push('lire le journal du boot précédent avant de relancer');
  }
  if (
    content.includes('ne pas éditer un script bash en cours d\'exécution') ||
    /ne\s+pas\s+[eé]diter\s+(?:un\s+)?script\s+bash\s+en\s+cours/i.test(content)
  ) {
    pilotLessons.push('ne pas éditer un script bash en cours d\'exécution');
  }
  if (
    content.includes('preuve = tests des fichiers touchés') ||
    /preuve\s*=\s*tests\s+des\s+fichiers\s+touch[eé]s/i.test(content) ||
    /tests\s+des\s+fichiers\s+touch[eé]s/i.test(content)
  ) {
    pilotLessons.push('preuve = tests des fichiers touchés');
  }

  const id = filename ? filename.replace(/\.(log|out)$/, '') : `delegation-${Date.now()}`;

  return {
    id,
    engine,
    durationSec,
    exitCode,
    changes,
    namedFailures,
    pilotLessons,
  };
}

export function readDelegationLogs(delegationsDir: string, limit = 50): DelegationFact[] {
  if (!fs.existsSync(delegationsDir)) return [];
  const entries = fs.readdirSync(delegationsDir, { withFileTypes: true });
  const outFiles: string[] = [];
  const logFiles: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.out')) outFiles.push(entry.name);
    else if (entry.name.endsWith('.log')) logFiles.push(entry.name);
  }

  outFiles.sort().reverse();
  logFiles.sort().reverse();

  const consumedLogs = new Set<string>();
  const facts: DelegationFact[] = [];

  for (const outFile of outFiles) {
    if (facts.length >= limit) break;
    const outPath = path.join(delegationsDir, outFile);
    let outContent = '';
    try {
      outContent = fs.readFileSync(outPath, 'utf8');
    } catch {
      continue;
    }
    const logMatch = outContent.match(/journal\s*:\s*(\S+\.log)/i);
    let companionContent = '';
    let logBaseName = '';
    if (logMatch?.[1]) {
      const referencedLogName = path.basename(logMatch[1]);
      logBaseName = referencedLogName.replace(/\.log$/, '');
      consumedLogs.add(referencedLogName);
      const fullLogPath = path.join(delegationsDir, referencedLogName);
      if (fs.existsSync(fullLogPath)) {
        try {
          companionContent = fs.readFileSync(fullLogPath, 'utf8');
        } catch {
          /* ignore */
        }
      }
    }
    const combinedContent = companionContent ? `${companionContent}\n${outContent}` : outContent;
    const factId = logBaseName || outFile.replace(/\.out$/, '');
    facts.push(extractDelegationFacts(combinedContent, factId));
  }

  for (const logFile of logFiles) {
    if (facts.length >= limit) break;
    if (consumedLogs.has(logFile)) continue;
    const logPath = path.join(delegationsDir, logFile);
    try {
      const content = fs.readFileSync(logPath, 'utf8');
      const factId = logFile.replace(/\.log$/, '');
      facts.push(extractDelegationFacts(content, factId));
    } catch {
      continue;
    }
  }

  return facts;
}

export interface DelegationLogsExperienceSourceOptions {
  workDir?: string;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  delegationsDir?: string;
  limit?: number;
  readLogs?: () => Promise<DelegationFact[]>;
  archive?: EvolutionaryArchive;
  enabled?: boolean;
}

export class DelegationLogsExperienceSource {
  readonly id = 'delegation-log';

  constructor(private readonly options: DelegationLogsExperienceSourceOptions = {}) {}

  async collect(): Promise<Experience[]> {
    const env = this.options.env ?? process.env;
    const enabled =
      this.options.enabled ?? (env.CODEBUDDY_SELF_IMPROVE_DELEGATION_SOURCE === 'true');
    if (!enabled) return [];

    const workDir = this.options.workDir ?? process.cwd();
    const homeDir = this.options.homeDir ?? env.HOME ?? os.homedir();
    const delegationsDir =
      this.options.delegationsDir ??
      env.CODEBUDDY_DELEGATIONS_DIR ??
      path.join(homeDir, '.codebuddy', 'delegations');

    let facts: DelegationFact[];
    try {
      if (this.options.readLogs) {
        facts = await this.options.readLogs();
      } else {
        facts = readDelegationLogs(
          delegationsDir,
          Math.max(1, Math.min(50, this.options.limit ?? 20)),
        );
      }
    } catch (error) {
      logger.warn('[self-improve] delegation logs unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    const archive = this.options.archive ?? new EvolutionaryArchive({ workDir });
    const existing = new Set(
      archive
        .list()
        .filter((entry) => entry.provenance === 'delegation-log')
        .map((entry) => entry.proposalId),
    );

    const experiences: Experience[] = [];
    for (const fact of facts) {
      const experienceId = `delegation:${fact.id}`;
      if (!existing.has(experienceId)) {
        archive.append({
          proposalId: experienceId,
          kind: 'delegation-log',
          targetScenarioId: fact.namedFailures[0] ?? 'delegation-log',
          experienceId,
          delta: 0,
          scoreAfter: 0,
          provenance: 'delegation-log',
          reviewedBy: `auto:${fact.engine}`,
        });
        existing.add(experienceId);
      }
      experiences.push({
        id: experienceId,
        source: 'delegation-log',
        kind: fact.namedFailures[0] ?? (fact.exitCode === 0 ? 'success' : 'failure'),
        detail: `Délégation ${fact.engine} (${fact.durationSec ?? 0} s, sortie ${fact.exitCode ?? 0}) : ${
          fact.namedFailures.length > 0 ? fact.namedFailures.join(', ') : 'succès'
        }.`,
        context: [
          `Moteur : ${fact.engine}.`,
          fact.durationSec !== undefined ? `Durée : ${fact.durationSec} s.` : '',
          fact.exitCode !== undefined ? `Sortie : ${fact.exitCode}.` : '',
          fact.changes.length > 0
            ? `Ce qui a bougé :\n${fact.changes.map((c) => `  - ${c}`).join('\n')}`
            : '',
          fact.namedFailures.length > 0 ? `Échecs nommés : ${fact.namedFailures.join(', ')}.` : '',
          fact.pilotLessons.length > 0 ? `Leçons du pilote : ${fact.pilotLessons.join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        severity: fact.namedFailures.length > 0 ? 0.8 : fact.exitCode === 0 ? 0.2 : 0.6,
      });
    }

    return experiences;
  }
}

export function createDefaultDelegationLogsExperienceSource(
  options: Omit<DelegationLogsExperienceSourceOptions, 'readLogs' | 'archive'> = {},
): DelegationLogsExperienceSource {
  return new DelegationLogsExperienceSource(options);
}


function artifactTimestamp(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    const timestamp =
      stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.ctimeMs > 0 ? stat.ctimeMs : stat.mtimeMs;
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  } catch {
    return null;
  }
}

function scanSkillRoot(
  root: string,
  allowedKinds: ReadonlySet<DigestArtifactKind>
): DigestArtifactRecord[] {
  if (!fs.existsSync(root)) return [];
  const artifacts: DigestArtifactRecord[] = [];
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const kind: DigestArtifactKind | null = entry.name.startsWith('authored-')
        ? 'authored-skill'
        : entry.name.startsWith('imported-')
          ? 'imported-skill'
          : null;
      if (!kind || !allowedKinds.has(kind)) continue;
      const skillFile = path.join(root, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const createdAt = artifactTimestamp(skillFile);
      if (!createdAt) continue;
      artifacts.push({
        name: entry.name,
        kind,
        createdAt,
        // SKILL.md schema has no import/creation timestamp yet. Filesystem
        // birth time is the least-bad read-only fallback and is labelled.
        estimated: true,
      });
    }
  } catch (error) {
    logger.warn('[improve-digest] could not scan skills', {
      root,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return artifacts;
}

function readAuthoredToolFallback(
  workDir: string,
  archiveToolNames: ReadonlySet<string>
): DigestArtifactRecord[] {
  const store = new AuthoredToolStore({ workDir });
  if (!fs.existsSync(store.path)) return [];
  const createdAt = artifactTimestamp(store.path);
  if (!createdAt) return [];
  try {
    return store
      .list()
      .filter((tool) => !archiveToolNames.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        kind: 'tool' as const,
        createdAt,
        // authored-tools.json does not timestamp individual specs. The file
        // timestamp is used only for tools absent from the canonical archive.
        estimated: true,
      }));
  } catch (error) {
    logger.warn('[improve-digest] could not read authored tools', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** Read every current digest source without creating or mutating any store. */
export async function readImprovementDigestSources(
  options: ReadImprovementDigestSourcesOptions = {}
): Promise<ImprovementDigestSources> {
  const workDir = options.workDir ?? process.cwd();
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();

  const archiveStore = new EvolutionaryArchive({ workDir });
  const archiveAvailable = fs.existsSync(archiveStore.path);
  const archive = archiveAvailable ? archiveStore.list() : undefined;
  const archiveToolNames = new Set(
    (archive ?? [])
      .filter((entry) => entry.kind === 'tool' && entry.appliedRef)
      .map((entry) => entry.appliedRef!)
  );

  const learningStore = createWorkspaceLearningStore({ workDir });
  const learningStoreAvailable = fs.existsSync(path.join(learningStore.path, '.git'));
  const learningSnapshots = learningStoreAvailable
    ? (await learningStore.listVersionSnapshots()).map((version) => ({
        id: version.sha,
        createdAt: version.createdAt,
        reason: version.reason,
        score: version.score?.ratio ?? null,
        lessons: version.lessons,
        ...(version.scenarioId ? { scenarioId: version.scenarioId } : {}),
        ...(version.delta !== undefined ? { delta: version.delta } : {}),
      }))
    : undefined;

  const benchmarkPath = resolveBenchmarkHistoryPath(env);
  const benchmarkAvailable = fs.existsSync(benchmarkPath);
  const benchmark = benchmarkAvailable ? await readBenchmarkHistory(env) : undefined;

  const workspaceSkills = scanSkillRoot(
    path.join(workDir, '.codebuddy', 'skills'),
    new Set<DigestArtifactKind>(['authored-skill', 'imported-skill'])
  );
  const managedSkills = scanSkillRoot(
    path.join(homeDir, '.codebuddy', 'skills', 'managed'),
    new Set<DigestArtifactKind>(['imported-skill'])
  );
  const authoredTools = readAuthoredToolFallback(workDir, archiveToolNames);
  const currentLessons = getLessonsTracker(workDir)
    .list()
    .map((lesson) => ({
      id: lesson.id,
      category: lesson.category,
      content: lesson.content,
      ...(lesson.context ? { context: lesson.context } : {}),
    }));

  return {
    ...(archive ? { archive } : {}),
    archiveMode: 'accepted-only',
    ...(learningSnapshots ? { learningStore: learningSnapshots } : {}),
    ...(benchmark ? { benchmark } : {}),
    artifacts: [...authoredTools, ...workspaceSkills, ...managedSkills],
    currentLessons,
  };
}
