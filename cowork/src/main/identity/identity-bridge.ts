/**
 * IdentityBridge — Claude Cowork parity Phase 3 step 11
 *
 * Lists available personas (identity files + user-defined persona/*.md
 * documents) from both the active workspace and the user's global
 * `~/.codebuddy/` directory, supports activating one as the default
 * persona, and watches the underlying directories so the renderer can
 * hot-reload when files change on disk.
 *
 * Persona sources (in priority order):
 *   1. Workspace `.codebuddy/persona/*.md`
 *   2. Workspace identity files (SOUL.md, USER.md, AGENTS.md, …)
 *   3. Global `~/.codebuddy/persona/*.md`
 *   4. Global identity files
 *
 * Active persona metadata is persisted to `<userData>/active-persona.json`.
 *
 * @module main/identity/identity-bridge
 */

import { EventEmitter } from 'events';
import { FSWatcher, watch } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import os from 'os';
import { log, logWarn } from '../utils/logger';

const IDENTITY_FILE_NAMES = [
  'SOUL.md',
  'USER.md',
  'AGENTS.md',
  'IDENTITY.md',
  'TOOLS.md',
  'INSTRUCTIONS.md',
];

export interface PersonaEntry {
  /** Stable ID derived from `${source}:${relativePath}` */
  id: string;
  /** Display name (frontmatter `name` or filename without extension) */
  name: string;
  /** Short description (frontmatter `description` or first heading/paragraph) */
  description?: string;
  /** Absolute path on disk */
  filePath: string;
  /** Source scope */
  source: 'workspace' | 'global';
  /** 'identity' for SOUL.md/USER.md/etc, 'persona' for persona/*.md */
  kind: 'identity' | 'persona';
  /** Last modified timestamp (ms) */
  mtime: number;
  /** File size in bytes */
  size: number;
  /** Whether this entry is currently the active persona */
  active: boolean;
}

export interface PersonaDetail extends PersonaEntry {
  content: string;
}

interface ActivePersonaFile {
  id: string | null;
  filePath: string | null;
  activatedAt: number;
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  if (!content.startsWith('---')) return {};
  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) return {};
  const block = content.slice(3, endIdx).trim();
  const out: { name?: string; description?: string } = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === 'name') out.name = value;
    else if (key === 'description') out.description = value;
  }
  return out;
}

function firstParagraph(content: string): string | undefined {
  const stripped = content.replace(/^---[\s\S]*?\n---\s*/, '').trim();
  for (const line of stripped.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('#')) continue;
    return t.length > 160 ? `${t.slice(0, 157)}…` : t;
  }
  return undefined;
}

function computeId(source: 'workspace' | 'global', relativePath: string): string {
  return `${source}:${relativePath.replace(/\\/g, '/')}`;
}

export class IdentityBridge extends EventEmitter {
  private workspaceDir: string | null = null;
  private watchers: FSWatcher[] = [];
  private cachedEntries: PersonaEntry[] = [];
  private activePersona: ActivePersonaFile = {
    id: null,
    filePath: null,
    activatedAt: 0,
  };
  private readonly activeFilePath: string;
  private readonly initializationPromise: Promise<void>;
  private loaded = false;
  private listPromise: Promise<PersonaEntry[]> | null = null;
  private readonly detailCache = new Map<string, { mtime: number; content: string }>();

  constructor() {
    super();
    const userData = app.isReady() ? app.getPath('userData') : path.join(os.homedir(), '.codebuddy-cowork');
    this.activeFilePath = path.join(userData, 'active-persona.json');
    this.initializationPromise = this.loadActivePersona();
  }

  setWorkspace(dir: string | null): void {
    if (dir === this.workspaceDir) return;
    this.workspaceDir = dir;
    this.loaded = false;
    this.rewatch();
    void this.list();
  }

  private async loadActivePersona(): Promise<void> {
    try {
      const raw = await fs.readFile(this.activeFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as ActivePersonaFile;
      this.activePersona = {
        id: parsed.id ?? null,
        filePath: parsed.filePath ?? null,
        activatedAt: parsed.activatedAt ?? 0,
      };
    } catch {
      // First launch or missing file — leave defaults
    }
  }

  private async saveActivePersona(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.activeFilePath), { recursive: true });
      await fs.writeFile(this.activeFilePath, JSON.stringify(this.activePersona, null, 2), 'utf-8');
    } catch (err) {
      logWarn('[IdentityBridge] saveActivePersona failed:', err);
    }
  }

  private globalDir(): string {
    return path.join(os.homedir(), '.codebuddy');
  }

  private async scanIdentityDir(
    baseDir: string,
    source: 'workspace' | 'global'
  ): Promise<PersonaEntry[]> {
    const entries: PersonaEntry[] = [];
    for (const name of IDENTITY_FILE_NAMES) {
      const filePath = path.join(baseDir, name);
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;
        const content = await fs.readFile(filePath, 'utf-8');
        const trimmed = content.trim();
        if (!trimmed) continue;
        const fm = parseFrontmatter(content);
        entries.push({
          id: computeId(source, name),
          name: fm.name ?? name.replace(/\.md$/i, ''),
          description: fm.description ?? firstParagraph(content),
          filePath,
          source,
          kind: 'identity',
          mtime: stat.mtimeMs,
          size: stat.size,
          active: this.activePersona.filePath === filePath,
        });
      } catch {
        // Missing file, ignore
      }
    }
    return entries;
  }

  private async scanPersonaDir(
    baseDir: string,
    source: 'workspace' | 'global'
  ): Promise<PersonaEntry[]> {
    const personaDir = path.join(baseDir, 'persona');
    try {
      const files = await fs.readdir(personaDir);
      const entries: PersonaEntry[] = [];
      for (const file of files) {
        if (!file.toLowerCase().endsWith('.md')) continue;
        const filePath = path.join(personaDir, file);
        try {
          const stat = await fs.stat(filePath);
          if (!stat.isFile()) continue;
          const content = await fs.readFile(filePath, 'utf-8');
          const trimmed = content.trim();
          if (!trimmed) continue;
          const fm = parseFrontmatter(content);
          entries.push({
            id: computeId(source, path.join('persona', file)),
            name: fm.name ?? file.replace(/\.md$/i, ''),
            description: fm.description ?? firstParagraph(content),
            filePath,
            source,
            kind: 'persona',
            mtime: stat.mtimeMs,
            size: stat.size,
            active: this.activePersona.filePath === filePath,
          });
        } catch {
          // ignore
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  async list(): Promise<PersonaEntry[]> {
    if (this.listPromise) return this.listPromise;
    const pending = this.scanEntries();
    this.listPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.listPromise === pending) this.listPromise = null;
    }
  }

  /** Ensure the watcher-backed cache has been populated without rescanning on every turn. */
  async ensureLoaded(): Promise<PersonaEntry[]> {
    await this.initializationPromise;
    if (this.loaded) return this.cachedEntries;
    return this.list();
  }

  private async scanEntries(): Promise<PersonaEntry[]> {
    await this.initializationPromise;
    const results: PersonaEntry[] = [];
    if (this.workspaceDir) {
      const wsCodebuddy = path.join(this.workspaceDir, '.codebuddy');
      results.push(...(await this.scanPersonaDir(wsCodebuddy, 'workspace')));
      results.push(...(await this.scanIdentityDir(wsCodebuddy, 'workspace')));
    }
    const globalDir = this.globalDir();
    results.push(...(await this.scanPersonaDir(globalDir, 'global')));
    results.push(...(await this.scanIdentityDir(globalDir, 'global')));
    // Dedupe by id (workspace wins)
    const seen = new Set<string>();
    const deduped: PersonaEntry[] = [];
    for (const e of results) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      deduped.push(e);
    }
    this.cachedEntries = deduped;
    this.loaded = true;
    const liveIds = new Set(deduped.map((entry) => entry.id));
    for (const id of this.detailCache.keys()) {
      if (!liveIds.has(id)) this.detailCache.delete(id);
    }
    this.emit('personas:updated', deduped);
    return deduped;
  }

  async getDetail(id: string): Promise<PersonaDetail | null> {
    const entry = this.cachedEntries.find((e) => e.id === id);
    if (!entry) return null;
    const cached = this.detailCache.get(id);
    if (cached?.mtime === entry.mtime) {
      return { ...entry, content: cached.content };
    }
    try {
      const content = await fs.readFile(entry.filePath, 'utf-8');
      this.detailCache.set(id, { mtime: entry.mtime, content });
      return { ...entry, content };
    } catch (err) {
      logWarn('[IdentityBridge] getDetail failed:', err);
      return null;
    }
  }

  async activate(id: string): Promise<{ success: boolean; active?: PersonaEntry; error?: string }> {
    const entry = this.cachedEntries.find((e) => e.id === id);
    if (!entry) {
      return { success: false, error: 'Persona not found' };
    }
    this.activePersona = {
      id: entry.id,
      filePath: entry.filePath,
      activatedAt: Date.now(),
    };
    await this.saveActivePersona();
    // Refresh active flags in cache
    for (const e of this.cachedEntries) {
      e.active = e.id === entry.id;
    }
    const active = this.cachedEntries.find((e) => e.id === entry.id) ?? entry;
    this.emit('personas:activated', active);
    log(`[IdentityBridge] Activated persona ${entry.id}`);
    return { success: true, active };
  }

  async deactivate(): Promise<{ success: boolean }> {
    this.activePersona = { id: null, filePath: null, activatedAt: Date.now() };
    await this.saveActivePersona();
    for (const e of this.cachedEntries) {
      e.active = false;
    }
    this.emit('personas:activated', null);
    return { success: true };
  }

  getActive(): PersonaEntry | null {
    if (!this.activePersona.id) return null;
    return this.cachedEntries.find((e) => e.id === this.activePersona.id) ?? null;
  }

  private rewatch(): void {
    this.unwatch();

    const watchedDirs: string[] = [];
    if (this.workspaceDir) {
      watchedDirs.push(path.join(this.workspaceDir, '.codebuddy'));
      watchedDirs.push(path.join(this.workspaceDir, '.codebuddy', 'persona'));
    }
    watchedDirs.push(this.globalDir());
    watchedDirs.push(path.join(this.globalDir(), 'persona'));

    let debounceTimer: NodeJS.Timeout | null = null;
    const triggerRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void this.list().catch(() => {
          /* ignore */
        });
      }, 150);
    };

    for (const dir of watchedDirs) {
      try {
        const watcher = watch(dir, () => triggerRefresh());
        this.watchers.push(watcher);
      } catch {
        // Directory may not exist yet — skipped
      }
    }
  }

  unwatch(): void {
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    this.watchers = [];
  }

  dispose(): void {
    this.unwatch();
    this.removeAllListeners();
  }
}

let singleton: IdentityBridge | null = null;

export function getIdentityBridge(): IdentityBridge {
  if (!singleton) {
    singleton = new IdentityBridge();
  }
  return singleton;
}
