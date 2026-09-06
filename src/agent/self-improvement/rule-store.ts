/**
 * Rule store + labeled trajectory corpus for the execution-grounded learning loop.
 *
 * Accepted behavioral rules (structured, checkable predicates + their human-readable
 * statement) persist to `.codebuddy/self-improvement/rules.json`. The labeled
 * trajectory corpus the rules are validated against loads from
 * `.codebuddy/self-improvement/corpus.json` (curated by a human — eval curation
 * stays human-gated) with a small SEED fallback so the loop runs out of the box.
 *
 * @module agent/self-improvement/rule-store
 */

import fs from 'fs';
import path from 'path';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../../utils/atomic-write.js';

import type { BehavioralCheck, LabeledTrajectory } from './execution-gate.js';

export const RULE_STORE_SCHEMA_VERSION = 1;

export interface StoredRule {
  check: BehavioralCheck;
  statement: string;
  createdAt: string;
}

interface RuleFile {
  schemaVersion: number;
  rules: StoredRule[];
}

export interface RuleStoreOptions {
  workDir?: string;
  now?: () => Date;
}

export class RuleStore {
  private readonly filePath: string;
  private readonly now: () => Date;

  constructor(options: RuleStoreOptions = {}) {
    const root = options.workDir ?? process.cwd();
    this.filePath = path.join(root, '.codebuddy', 'self-improvement', 'rules.json');
    this.now = options.now ?? (() => new Date());
  }

  get path(): string {
    return this.filePath;
  }

  private read(): RuleFile {
    try {
      const parsed = readJsonAtomicSync<Partial<RuleFile>>(this.filePath, {}, { mode: 0o600 });
      if (Array.isArray(parsed.rules)) {
        return { schemaVersion: RULE_STORE_SCHEMA_VERSION, rules: parsed.rules };
      }
    } catch {
      /* none yet */
    }
    return { schemaVersion: RULE_STORE_SCHEMA_VERSION, rules: [] };
  }

  private write(file: RuleFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeJsonAtomicSync(this.filePath, file, { mode: 0o600 });
  }

  list(): StoredRule[] {
    return this.read().rules;
  }

  /** The active checks the corpus is scored against. */
  checks(): BehavioralCheck[] {
    return this.list().map((r) => r.check);
  }

  add(check: BehavioralCheck, statement: string): StoredRule {
    const file = this.read();
    const stored: StoredRule = { check, statement, createdAt: this.now().toISOString() };
    file.rules.push(stored);
    this.write(file);
    return stored;
  }

  /** Replace all rules (used by git-store restore). */
  setAll(rules: StoredRule[]): void {
    this.write({ schemaVersion: RULE_STORE_SCHEMA_VERSION, rules });
  }
}

/**
 * Seed corpus — a few labeled behavioral examples so the loop runs deterministically
 * out of the box. `shouldPass: false` marks a run whose behavior a rule SHOULD flag.
 * Curated, and meant to be extended from real labeled runs in corpus.json.
 */
export const SEED_TRAJECTORY_CORPUS: LabeledTrajectory[] = [
  { id: 'seed-readonly-1', shouldPass: true, trajectory: { toolNames: ['view_file', 'search'], text: 'inspected the code', profile: 'safe' } },
  { id: 'seed-readonly-2', shouldPass: true, trajectory: { toolNames: ['list_directory', 'view_file'], text: 'reviewed structure', profile: 'review' } },
  { id: 'seed-mutation-1', shouldPass: false, trajectory: { toolNames: ['view_file', 'bash'], text: 'ran a shell command in a read-only review', profile: 'safe' } },
  { id: 'seed-mutation-2', shouldPass: false, trajectory: { toolNames: ['write_file'], text: 'wrote a file during an audit', profile: 'review' } },
];

/** Load the labeled corpus from corpus.json, falling back to the seed corpus. */
export function loadTrajectoryCorpus(workDir: string = process.cwd()): LabeledTrajectory[] {
  const corpus = new CorpusStore({ workDir }).list();
  return corpus.length > 0 ? corpus : SEED_TRAJECTORY_CORPUS;
}

/**
 * Human-curated labeled trajectory corpus (`.codebuddy/self-improvement/corpus.json`).
 * Eval curation stays human-gated: only the operator labels a run pass/fail; the
 * engine never labels its own corpus.
 */
export class CorpusStore {
  private readonly filePath: string;

  constructor(options: { workDir?: string } = {}) {
    const root = options.workDir ?? process.cwd();
    this.filePath = path.join(root, '.codebuddy', 'self-improvement', 'corpus.json');
  }

  get path(): string {
    return this.filePath;
  }

  list(): LabeledTrajectory[] {
    try {
      const parsed = readJsonAtomicSync<{ trajectories?: LabeledTrajectory[] }>(this.filePath, {}, { mode: 0o600 });
      return Array.isArray(parsed.trajectories) ? parsed.trajectories : [];
    } catch {
      return [];
    }
  }

  private write(trajectories: LabeledTrajectory[]): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeJsonAtomicSync(this.filePath, { schemaVersion: 1, trajectories }, { mode: 0o600 });
  }

  /** Add or replace a labeled trajectory by id. */
  add(entry: LabeledTrajectory): void {
    const list = this.list().filter((t) => t.id !== entry.id);
    list.push(entry);
    this.write(list);
  }

  remove(id: string): boolean {
    const list = this.list();
    const next = list.filter((t) => t.id !== id);
    if (next.length === list.length) return false;
    this.write(next);
    return true;
  }
}
