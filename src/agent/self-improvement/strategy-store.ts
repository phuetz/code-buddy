/**
 * Strategy store — `.codebuddy/strategies/<id>.json` + `active.json` (scope → id).
 * Validated on read (an invalid or foreign file is skipped, never trusted), atomic
 * on write, archive instead of delete. The baseline is virtual: it is always
 * resolvable and never stored, so a corrupt store degrades to Code Buddy's
 * historical behavior rather than to nothing.
 *
 * @module agent/self-improvement/strategy-store
 */

import * as fs from 'fs';
import * as path from 'path';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../../utils/atomic-write.js';
import { logger } from '../../utils/logger.js';
import {
  BASELINE_STRATEGY,
  STRATEGY_SCOPES,
  strategySpecSchema,
  type StrategyScope,
  type StrategySpec,
} from './strategy-types.js';

export interface StrategyStoreOptions {
  /** Workspace root (default cwd). The store lives at `<workDir>/.codebuddy/strategies`. */
  workDir?: string;
  /** Override the directory outright (tests). */
  dir?: string;
}

type ActiveMap = Partial<Record<StrategyScope, string>>;

export class StrategyStore {
  readonly dir: string;
  private readonly activeFile: string;

  constructor(options: StrategyStoreOptions = {}) {
    this.dir = options.dir ?? path.join(options.workDir ?? process.cwd(), '.codebuddy', 'strategies');
    this.activeFile = path.join(this.dir, 'active.json');
  }

  /** Parse + validate one stored file; null when absent, invalid or foreign. */
  get(id: string): StrategySpec | null {
    if (id === BASELINE_STRATEGY.id) return BASELINE_STRATEGY;
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(id)) return null;
    const file = path.join(this.dir, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    const raw = readJsonAtomicSync<unknown>(file, null);
    const parsed = strategySpecSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn(`Strategy file ignored (invalid): ${file}`);
      return null;
    }
    if (parsed.data.id !== id) {
      logger.warn(`Strategy file ignored (id mismatch): ${file}`);
      return null;
    }
    return parsed.data;
  }

  has(id: string): boolean {
    return this.get(id) !== null;
  }

  list(): StrategySpec[] {
    if (!fs.existsSync(this.dir)) return [];
    const out: StrategySpec[] = [];
    for (const name of fs.readdirSync(this.dir).sort()) {
      if (!name.endsWith('.json') || name === 'active.json') continue;
      const spec = this.get(name.slice(0, -'.json'.length));
      if (spec) out.push(spec);
    }
    return out;
  }

  /** Validate then persist. Throws on an invalid spec — the gate must run first. */
  save(spec: StrategySpec): StrategySpec {
    const parsed = strategySpecSchema.parse(spec);
    if (parsed.id === BASELINE_STRATEGY.id) throw new Error('the baseline strategy is virtual and cannot be saved');
    fs.mkdirSync(this.dir, { recursive: true });
    writeJsonAtomicSync(path.join(this.dir, `${parsed.id}.json`), parsed, { mode: 0o600 });
    return parsed;
  }

  private readActive(): ActiveMap {
    if (!fs.existsSync(this.activeFile)) return {};
    const raw = readJsonAtomicSync<unknown>(this.activeFile, null);
    if (!raw || typeof raw !== 'object') return {};
    const out: ActiveMap = {};
    for (const scope of STRATEGY_SCOPES) {
      const id = (raw as Record<string, unknown>)[scope];
      if (typeof id === 'string' && (id === BASELINE_STRATEGY.id || /^[a-z0-9][a-z0-9-]{2,63}$/.test(id))) {
        out[scope] = id;
      }
    }
    return out;
  }

  /** Make `id` the active strategy for `scope`. The id must exist and match the scope. */
  activate(scope: StrategyScope, id: string): void {
    const spec = this.get(id);
    if (!spec) throw new Error(`unknown strategy: ${id}`);
    if (spec.id !== BASELINE_STRATEGY.id && spec.scope !== scope) {
      throw new Error(`strategy ${id} targets scope ${spec.scope}, not ${scope}`);
    }
    fs.mkdirSync(this.dir, { recursive: true });
    const active = this.readActive();
    active[scope] = id;
    writeJsonAtomicSync(this.activeFile, active, { mode: 0o600 });
  }

  activeId(scope: StrategyScope): string {
    const id = this.readActive()[scope];
    if (!id || id === BASELINE_STRATEGY.id) return BASELINE_STRATEGY.id;
    return this.has(id) ? id : BASELINE_STRATEGY.id;
  }

  /**
   * The strategy in force for `scope`: the activated one when it is still valid,
   * else the scope-less `default` activation, else the baseline. Never throws.
   */
  resolveActive(scope: StrategyScope): StrategySpec {
    const active = this.readActive();
    for (const candidate of [active[scope], scope === 'default' ? undefined : active.default]) {
      if (!candidate) continue;
      const spec = this.get(candidate);
      if (spec) return spec;
      logger.warn(`Active strategy ${candidate} for scope ${scope} is missing or invalid — baseline in force`);
    }
    return BASELINE_STRATEGY;
  }

  /** Move a strategy to `archive/` (recoverable). Deactivates it if it was active. */
  archive(id: string): boolean {
    const file = path.join(this.dir, `${id}.json`);
    if (id === BASELINE_STRATEGY.id || !fs.existsSync(file)) return false;
    const archiveDir = path.join(this.dir, 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.renameSync(file, path.join(archiveDir, `${id}.${Date.now()}.json`));
    const active = this.readActive();
    let changed = false;
    for (const scope of STRATEGY_SCOPES) {
      if (active[scope] === id) {
        delete active[scope];
        changed = true;
      }
    }
    if (changed) writeJsonAtomicSync(this.activeFile, active, { mode: 0o600 });
    return true;
  }
}
