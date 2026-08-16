/**
 * LearningStore — git-backed reversibility for the self-improvement engine.
 *
 * The whole point: if an applied improvement turns out bad, we can return to a
 * version that works better. The learnable state (lessons + the evolutionary
 * archive + the benchmark score of that version) is versioned in a DEDICATED,
 * ISOLATED git repo inside `.codebuddy/self-improvement/store/`. `.codebuddy/` is
 * gitignored by the project, so this nested repo never touches the main history.
 *
 * Each applied improvement becomes a commit carrying its benchmark score in
 * `manifest.json`; `restore({best:true})` deterministically returns to the
 * highest-scoring version. History is append-only — restore moves *forward* by
 * re-applying old content (git-revert semantics), never rewrites history.
 *
 * The store is decoupled from the concrete lessons/benchmark via LearnableStatePort
 * so it is fully unit-testable; the git layer runs against a real repo.
 *
 * @module agent/self-improvement/learning-store
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import type { BenchmarkScore } from './types.js';

export const LEARNING_STORE_SCHEMA_VERSION = 1;

export type LessonCategory = 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT';

export interface LessonSnapshot {
  category: LessonCategory;
  content: string;
  context?: string;
}

/** Decouples the store from the concrete lessons tracker + benchmark. */
export interface LearnableStatePort {
  /** All current lessons (the versioned payload). */
  listLessons(): LessonSnapshot[];
  /** Replace the entire lesson set (clear + re-add) — used by restore. */
  setLessons(lessons: LessonSnapshot[]): void;
  /** Snapshot of the evolutionary archive entries (audit, committed alongside). */
  archive(): unknown[];
  /** Deterministic benchmark score of the CURRENT state. */
  score(): BenchmarkScore;
  /** Learned behavioral rules (optional — versioned + restored when present). */
  listRules?(): unknown[];
  setRules?(rules: unknown[]): void;
}

interface VersionManifest {
  schemaVersion: number;
  score: BenchmarkScore;
  scenarioId?: string;
  delta?: number;
  reason: string;
  generatedAt: string;
}

export interface StoreVersion {
  sha: string;
  shortSha: string;
  createdAt: string;
  message: string;
  /** Null for commits that predate a manifest (e.g. the init commit). */
  score: BenchmarkScore | null;
}

/** Read-only materialisation used by reporting/audit consumers. */
export interface LearningStoreSnapshotVersion {
  sha: string;
  createdAt: string;
  reason: string;
  score: BenchmarkScore | null;
  lessons: LessonSnapshot[];
  scenarioId?: string;
  delta?: number;
}

export interface LearningStoreOptions {
  workDir?: string;
  port: LearnableStatePort;
  now?: () => Date;
}

const GIT_IDENTITY = [
  '-c', 'user.name=Code Buddy Self-Improve',
  '-c', 'user.email=self-improve@codebuddy.local',
  '-c', 'commit.gpgsign=false',
];

export class LearningStore {
  private readonly storeDir: string;
  private readonly port: LearnableStatePort;
  private readonly now: () => Date;

  constructor(options: LearningStoreOptions) {
    const workDir = options.workDir ?? process.cwd();
    this.storeDir = path.join(workDir, '.codebuddy', 'self-improvement', 'store');
    this.port = options.port;
    this.now = options.now ?? (() => new Date());
  }

  get path(): string {
    return this.storeDir;
  }

  private runGit(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      const proc = spawn('git', args, { cwd: this.storeDir });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => (stdout += d.toString()));
      proc.stderr.on('data', (d) => (stderr += d.toString()));
      proc.on('error', (err) => resolve({ stdout, stderr: stderr + String(err), code: 1 }));
      proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
    });
  }

  private get isRepo(): boolean {
    return fs.existsSync(path.join(this.storeDir, '.git'));
  }

  /** Idempotently init the isolated repo with an empty initial commit. */
  async ensureRepo(): Promise<void> {
    if (this.isRepo) return;
    fs.mkdirSync(this.storeDir, { recursive: true });
    const init = await this.runGit(['init', '-q']);
    // Fail loudly if git is unavailable: a silent no-op here made commitVersion
    // return a fake success (sha '') while nothing was persisted, voiding the
    // reversibility guarantee. Better an honest throw the caller can log.
    if (init.code !== 0 || !this.isRepo) {
      throw new Error(`learning store: git init failed (git unavailable?): ${init.stderr.trim() || `exit ${init.code}`}`);
    }
    fs.writeFileSync(path.join(this.storeDir, '.gitignore'), '', 'utf-8');
    await this.runGit(['add', '-A']);
    await this.runGit([...GIT_IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'init: learning store']);
  }

  private writeSnapshot(manifest: VersionManifest): void {
    const write = (name: string, value: unknown) =>
      fs.writeFileSync(path.join(this.storeDir, name), JSON.stringify(value, null, 2), 'utf-8');
    write('lessons.json', this.port.listLessons());
    write('archive.json', this.port.archive());
    if (this.port.listRules) write('rules.json', this.port.listRules());
    write('manifest.json', manifest);
  }

  /** Snapshot the current learnable state and commit it as a new version. */
  async commitVersion(options: {
    scenarioId?: string;
    delta?: number;
    reason: string;
  }): Promise<{ sha: string; score: BenchmarkScore }> {
    await this.ensureRepo();
    const score = this.port.score();
    const manifest: VersionManifest = {
      schemaVersion: LEARNING_STORE_SCHEMA_VERSION,
      score,
      ...(options.scenarioId ? { scenarioId: options.scenarioId } : {}),
      ...(options.delta !== undefined ? { delta: options.delta } : {}),
      reason: options.reason,
      generatedAt: this.now().toISOString(),
    };
    this.writeSnapshot(manifest);
    await this.runGit(['add', '-A']);
    const subject =
      options.scenarioId && options.delta !== undefined
        ? `improve(${options.scenarioId}): +${options.delta} coverage ${score.covered}/${score.total}`
        : `${options.reason} — coverage ${score.covered}/${score.total}`;
    const message = `${subject}\n\nCo-Authored-By: Code Buddy Self-Improve <self-improve@codebuddy.local>`;
    const commit = await this.runGit([...GIT_IDENTITY, 'commit', '-q', '--allow-empty', '-m', message]);
    const sha = (await this.runGit(['rev-parse', 'HEAD'])).stdout.trim();
    // The version is only reversible if it was actually committed. A blank or
    // non-sha result means git silently failed — surface it instead of
    // returning a fake `{ sha: '' }` success.
    if (commit.code !== 0 || !/^[0-9a-f]{7,40}$/.test(sha)) {
      throw new Error(
        `learning store: version commit did not persist (git error) — reversibility not guaranteed: ${commit.stderr.trim() || `exit ${commit.code}`}`,
      );
    }
    return { sha, score };
  }

  /** List versions (newest first) with their committed benchmark score. */
  async listVersions(): Promise<StoreVersion[]> {
    if (!this.isRepo) return [];
    const log = await this.runGit(['log', '--format=%H%x1f%aI%x1f%s']);
    const lines = log.stdout.split('\n').filter(Boolean);
    const versions: StoreVersion[] = [];
    for (const line of lines) {
      const [sha, createdAt, message] = line.split('\x1f');
      if (!sha) continue;
      let score: BenchmarkScore | null = null;
      const show = await this.runGit(['show', `${sha}:manifest.json`]);
      if (show.code === 0) {
        try {
          score = (JSON.parse(show.stdout) as VersionManifest).score ?? null;
        } catch {
          score = null;
        }
      }
      versions.push({
        sha,
        shortSha: sha.slice(0, 8),
        createdAt: createdAt ?? '',
        message: message ?? '',
        score,
      });
    }
    return versions;
  }

  /**
   * List versioned lesson snapshots without mutating the store. This is kept
   * separate from `listVersions()` because normal status output should not pay
   * the extra `git show` calls needed to reconstruct lesson history.
   */
  async listVersionSnapshots(): Promise<LearningStoreSnapshotVersion[]> {
    const versions = await this.listVersions();
    const snapshots: LearningStoreSnapshotVersion[] = [];
    for (const version of versions) {
      const [manifestShow, lessonsShow] = await Promise.all([
        this.runGit(['show', `${version.sha}:manifest.json`]),
        this.runGit(['show', `${version.sha}:lessons.json`]),
      ]);

      let manifest: Partial<VersionManifest> | null = null;
      if (manifestShow.code === 0) {
        try {
          const parsed: unknown = JSON.parse(manifestShow.stdout);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            manifest = parsed as Partial<VersionManifest>;
          }
        } catch {
          manifest = null;
        }
      }

      let lessons: LessonSnapshot[] = [];
      if (lessonsShow.code === 0) {
        try {
          const parsed: unknown = JSON.parse(lessonsShow.stdout);
          if (Array.isArray(parsed)) {
            lessons = parsed.filter((lesson): lesson is LessonSnapshot => {
              if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) return false;
              const record = lesson as Record<string, unknown>;
              return (
                (record.category === 'PATTERN' ||
                  record.category === 'RULE' ||
                  record.category === 'CONTEXT' ||
                  record.category === 'INSIGHT') &&
                typeof record.content === 'string' &&
                (record.context === undefined || typeof record.context === 'string')
              );
            });
          }
        } catch {
          lessons = [];
        }
      }

      const generatedAt =
        typeof manifest?.generatedAt === 'string' &&
        Number.isFinite(Date.parse(manifest.generatedAt))
          ? manifest.generatedAt
          : version.createdAt;
      snapshots.push({
        sha: version.sha,
        createdAt: generatedAt,
        reason:
          typeof manifest?.reason === 'string' && manifest.reason.trim()
            ? manifest.reason
            : version.message,
        score: manifest?.score ?? version.score,
        lessons,
        ...(typeof manifest?.scenarioId === 'string' ? { scenarioId: manifest.scenarioId } : {}),
        ...(typeof manifest?.delta === 'number' && Number.isFinite(manifest.delta)
          ? { delta: manifest.delta }
          : {}),
      });
    }
    return snapshots;
  }

  /** The highest-scoring version (ties → most recent). The "version qui marche mieux". */
  async bestVersion(): Promise<StoreVersion | null> {
    const scored = (await this.listVersions()).filter((v): v is StoreVersion & { score: BenchmarkScore } =>
      v.score !== null,
    );
    if (scored.length === 0) return null;
    // listVersions is newest-first; a stable reduce keeps the most recent on ties.
    return scored.reduce((best, v) => (v.score.ratio > best.score.ratio ? v : best), scored[0]!);
  }

  /**
   * Restore the learnable state to a known-good version: re-materialise that
   * version's lessons into the live state, then commit the restore (forward,
   * append-only). Returns the restored sha + the re-scored benchmark.
   */
  async restore(
    target: { commit?: string; best?: boolean },
  ): Promise<{ restoredFrom: string; score: BenchmarkScore } | null> {
    if (!this.isRepo) return null;
    let sha = target.commit?.trim();
    if (target.best || !sha) {
      const best = await this.bestVersion();
      if (!best) return null;
      sha = best.sha;
    }
    const show = await this.runGit(['show', `${sha}:lessons.json`]);
    if (show.code !== 0) return null;
    let lessons: LessonSnapshot[];
    try {
      lessons = JSON.parse(show.stdout) as LessonSnapshot[];
    } catch {
      return null;
    }
    this.port.setLessons(lessons);
    // Re-materialise learned rules too, when they were versioned.
    if (this.port.setRules) {
      const rulesShow = await this.runGit(['show', `${sha}:rules.json`]);
      if (rulesShow.code === 0) {
        try {
          this.port.setRules(JSON.parse(rulesShow.stdout) as unknown[]);
        } catch {
          /* leave rules unchanged if the snapshot is unreadable */
        }
      }
    }
    const { score } = await this.commitVersion({ reason: `restore to ${sha.slice(0, 8)}` });
    return { restoredFrom: sha, score };
  }

  /** Push to a configured remote (opt-in). No-op with a clear result if none. */
  async push(): Promise<{ pushed: boolean; reason?: string }> {
    if (!this.isRepo) return { pushed: false, reason: 'no learning store repo' };
    const remotes = await this.runGit(['remote']);
    if (!remotes.stdout.trim()) {
      return { pushed: false, reason: 'no git remote configured for the learning store' };
    }
    const result = await this.runGit(['push']);
    return result.code === 0
      ? { pushed: true }
      : { pushed: false, reason: result.stderr.trim() || 'git push failed' };
  }

  /** Current (HEAD) score and best-known score. */
  async status(): Promise<{ head: BenchmarkScore | null; best: StoreVersion | null; versions: number }> {
    const versions = await this.listVersions();
    return {
      head: versions[0]?.score ?? null,
      best: await this.bestVersion(),
      versions: versions.length,
    };
  }
}
