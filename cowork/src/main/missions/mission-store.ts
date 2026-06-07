/**
 * Mission Store — JSON persistence for missions (Phase 1).
 *
 * One file per mission under a configurable base directory (default
 * `~/.codebuddy/missions/`). Writes are ATOMIC (write to a unique temp file
 * then rename over the target) so a crash or a concurrent save can never
 * leave a half-written, corrupt JSON file on disk. Missions survive a Cowork
 * restart because `loadAll()` rehydrates from disk.
 *
 * Design notes (important for testability):
 *   - PURE TypeScript: no Electron, no better-sqlite3, no IPC. The base dir
 *     and the fs implementation are injected via the constructor so tests run
 *     against an `os.tmpdir()` directory with the real `fs/promises`.
 *   - The default base dir resolves through `os.homedir()` (node builtins
 *     only) — we deliberately do NOT import `app` from electron the way
 *     presence-store does, so this file loads in plain vitest.
 *
 * @module cowork/main/missions/mission-store
 */

import { promises as nodeFs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Mission } from './mission-types';

/**
 * The slice of the `fs/promises` API the store needs. Declaring it as an
 * interface lets tests inject a fake fs without pulling in electron, while
 * production passes node's real `fs/promises`.
 */
export interface MissionFs {
  mkdir(dir: string, opts: { recursive: true }): Promise<unknown>;
  readFile(file: string, encoding: 'utf-8'): Promise<string>;
  writeFile(file: string, data: string, encoding: 'utf-8'): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(file: string, opts?: { force?: boolean }): Promise<void>;
  readdir(dir: string): Promise<string[]>;
}

export interface MissionStoreOptions {
  /** Base directory for mission files. Default `~/.codebuddy/missions`. */
  baseDir?: string;
  /** Injectable fs implementation. Default node `fs/promises`. */
  fs?: MissionFs;
  /** Injectable random suffix factory for atomic temp files (tests). */
  tempSuffix?: () => string;
}

/** Default base directory: `~/.codebuddy/missions`. */
export function defaultMissionsDir(): string {
  return path.join(os.homedir(), '.codebuddy', 'missions');
}

function defaultTempSuffix(): string {
  return `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
}

export class MissionStore {
  private readonly baseDir: string;
  private readonly fs: MissionFs;
  private readonly tempSuffix: () => string;

  constructor(options: MissionStoreOptions = {}) {
    this.baseDir = options.baseDir ?? defaultMissionsDir();
    this.fs = options.fs ?? (nodeFs as unknown as MissionFs);
    this.tempSuffix = options.tempSuffix ?? defaultTempSuffix;
  }

  /** Absolute path to the on-disk file for a mission id. */
  fileFor(id: string): string {
    return path.join(this.baseDir, `${sanitizeId(id)}.json`);
  }

  /** Directory the store writes to (exposed for diagnostics). */
  getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * Persist a single mission atomically. Each write uses a unique temp file
   * so two concurrent `save()` calls for the same mission can't clobber each
   * other's temp before the rename — the rename of the last writer wins, and
   * the live file is always a complete JSON document.
   */
  async save(mission: Mission): Promise<void> {
    await this.fs.mkdir(this.baseDir, { recursive: true });
    const target = this.fileFor(mission.id);
    const tmp = `${target}.${this.tempSuffix()}.tmp`;
    const json = JSON.stringify(mission, null, 2);
    await this.fs.writeFile(tmp, json, 'utf-8');
    try {
      await this.fs.rename(tmp, target);
    } catch (err) {
      // Best-effort cleanup of the orphaned temp file on rename failure.
      await this.fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  /** Load a single mission by id, or null if it doesn't exist on disk. */
  async load(id: string): Promise<Mission | null> {
    const file = this.fileFor(id);
    try {
      const raw = await this.fs.readFile(file, 'utf-8');
      return JSON.parse(raw) as Mission;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /** List all mission ids that have a file on disk. */
  async list(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await this.fs.readdir(this.baseDir);
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
    return entries
      .filter((name) => name.endsWith('.json') && !name.endsWith('.tmp'))
      .map((name) => name.slice(0, -'.json'.length));
  }

  /** Load every persisted mission. Skips files that fail to parse. */
  async loadAll(): Promise<Mission[]> {
    const ids = await this.list();
    const missions: Mission[] = [];
    for (const id of ids) {
      try {
        const mission = await this.load(id);
        if (mission) missions.push(mission);
      } catch {
        // Corrupt/partial file — skip rather than fail the whole load.
        // Atomic writes make this rare, but a manual edit could break one.
      }
    }
    return missions;
  }

  /** Remove a mission's file. Returns true if it existed. */
  async remove(id: string): Promise<boolean> {
    const file = this.fileFor(id);
    try {
      await this.fs.rm(file, { force: false });
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }
}

/** Keep ids filesystem-safe — mission ids are uuids, but be defensive. */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isNotFound(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ENOENT';
}
