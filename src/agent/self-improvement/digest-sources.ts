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
