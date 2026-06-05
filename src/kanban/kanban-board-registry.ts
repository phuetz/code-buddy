import fs from 'fs';
import path from 'path';

/**
 * Multi-board Kanban registry (toward upstream Hermes `kanban boards …` parity).
 *
 * Each board is an isolated JSON board file. For backward compatibility the
 * `default` board maps to the legacy single-board path
 * (`<root>/.codebuddy/kanban-board.json`); additional boards live under
 * `<root>/.codebuddy/kanban/<slug>.json`. Metadata + the active-board pointer
 * are stored in `<root>/.codebuddy/kanban/boards.json`.
 *
 * Active-board resolution precedence (mirrors upstream):
 *   explicit slug → CODEBUDDY_KANBAN_BOARD env → registry `current` → `default`.
 */

export const DEFAULT_BOARD_SLUG = 'default';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface KanbanBoardInfo {
  slug: string;
  name: string;
  createdAt: string;
  archived: boolean;
  /** Whether this is the active board. */
  current: boolean;
  /** Number of cards on the board (0 if the file is missing). */
  cardCount: number;
  /** Absolute path to the board JSON file. */
  path: string;
}

interface BoardMetaEntry {
  slug: string;
  name: string;
  createdAt: string;
  archived: boolean;
}

interface BoardsMeta {
  schemaVersion: 1;
  current: string;
  boards: BoardMetaEntry[];
}

export interface KanbanBoardRegistryOptions {
  rootDir?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export function isValidBoardSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

function assertValidSlug(slug: string): void {
  if (!isValidBoardSlug(slug)) {
    throw new Error(
      `invalid board slug "${slug}": use lowercase letters, digits, and hyphens (1-64 chars)`,
    );
  }
}

export class KanbanBoardRegistry {
  private readonly rootDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => Date;

  constructor(options: KanbanBoardRegistryOptions = {}) {
    this.rootDir = options.rootDir ?? process.cwd();
    this.env = options.env ?? process.env;
    this.now = options.now ?? (() => new Date());
  }

  private get codebuddyDir(): string {
    return path.join(this.rootDir, '.codebuddy');
  }

  private get boardsDir(): string {
    return path.join(this.codebuddyDir, 'kanban');
  }

  private get metaPath(): string {
    return path.join(this.boardsDir, 'boards.json');
  }

  private get legacyDefaultPath(): string {
    return path.join(this.codebuddyDir, 'kanban-board.json');
  }

  /** Resolve the on-disk board file for a slug (default → legacy path). */
  boardPath(slug: string): string {
    return slug === DEFAULT_BOARD_SLUG
      ? this.legacyDefaultPath
      : path.join(this.boardsDir, `${slug}.json`);
  }

  private readMeta(): BoardsMeta {
    let meta: BoardsMeta = { schemaVersion: 1, current: DEFAULT_BOARD_SLUG, boards: [] };
    try {
      const raw = fs.readFileSync(this.metaPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<BoardsMeta>;
      if (parsed && Array.isArray(parsed.boards)) {
        meta = {
          schemaVersion: 1,
          current: typeof parsed.current === 'string' ? parsed.current : DEFAULT_BOARD_SLUG,
          boards: parsed.boards.filter(
            (b): b is BoardMetaEntry => Boolean(b && typeof b.slug === 'string'),
          ),
        };
      }
    } catch {
      /* no meta yet — synthesize a default */
    }
    // The default board always exists, even before any boards.json is written.
    if (!meta.boards.some((b) => b.slug === DEFAULT_BOARD_SLUG)) {
      meta.boards.unshift({
        slug: DEFAULT_BOARD_SLUG,
        name: 'Default',
        createdAt: this.now().toISOString(),
        archived: false,
      });
    }
    return meta;
  }

  private writeMeta(meta: BoardsMeta): void {
    fs.mkdirSync(this.boardsDir, { recursive: true });
    fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  }

  private countCards(boardPath: string): number {
    try {
      const parsed = JSON.parse(fs.readFileSync(boardPath, 'utf-8')) as { cards?: unknown[] };
      return Array.isArray(parsed.cards) ? parsed.cards.length : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Resolve the active board slug:
   *   explicit → CODEBUDDY_KANBAN_BOARD → registry.current → default.
   * Falls back to `default` if the chosen board is missing or archived.
   */
  resolveSlug(explicit?: string): string {
    const meta = this.readMeta();
    const candidate =
      explicit?.trim() ||
      this.env.CODEBUDDY_KANBAN_BOARD?.trim() ||
      meta.current ||
      DEFAULT_BOARD_SLUG;
    const entry = meta.boards.find((b) => b.slug === candidate);
    if (!entry || entry.archived) return DEFAULT_BOARD_SLUG;
    return candidate;
  }

  /** List boards (default first), with card counts and the active marker. */
  list(includeArchived = false): KanbanBoardInfo[] {
    const meta = this.readMeta();
    const current = this.resolveSlug();
    return meta.boards
      .filter((b) => includeArchived || !b.archived)
      .map((b) => ({
        slug: b.slug,
        name: b.name,
        createdAt: b.createdAt,
        archived: b.archived,
        current: b.slug === current,
        cardCount: this.countCards(this.boardPath(b.slug)),
        path: this.boardPath(b.slug),
      }));
  }

  /** Create a new board and switch to it. */
  create(slug: string, name?: string): KanbanBoardInfo {
    assertValidSlug(slug);
    const meta = this.readMeta();
    if (meta.boards.some((b) => b.slug === slug && !b.archived)) {
      throw new Error(`board already exists: ${slug}`);
    }
    // Reviving an archived board re-uses its file; a fresh one starts empty.
    const existing = meta.boards.find((b) => b.slug === slug);
    if (existing) {
      existing.archived = false;
      if (name) existing.name = name;
    } else {
      meta.boards.push({
        slug,
        name: name ?? slug,
        createdAt: this.now().toISOString(),
        archived: false,
      });
    }
    const boardPath = this.boardPath(slug);
    if (!fs.existsSync(boardPath)) {
      fs.mkdirSync(path.dirname(boardPath), { recursive: true });
      fs.writeFileSync(
        boardPath,
        JSON.stringify({ schemaVersion: 1, cards: [], updatedAt: this.now().toISOString() }, null, 2),
        'utf-8',
      );
    }
    meta.current = slug;
    this.writeMeta(meta);
    return this.list(true).find((b) => b.slug === slug)!;
  }

  /** Switch the active board. */
  switch(slug: string): KanbanBoardInfo {
    const meta = this.readMeta();
    const entry = meta.boards.find((b) => b.slug === slug);
    if (!entry || entry.archived) {
      throw new Error(`board not found: ${slug}`);
    }
    meta.current = slug;
    this.writeMeta(meta);
    return this.list(true).find((b) => b.slug === slug)!;
  }

  /**
   * Archive a board (default) or hard-delete it (`hardDelete`). The `default`
   * board cannot be removed. If the active board is removed, the pointer resets
   * to `default`.
   */
  remove(slug: string, options: { hardDelete?: boolean } = {}): void {
    if (slug === DEFAULT_BOARD_SLUG) {
      throw new Error('the default board cannot be removed');
    }
    const meta = this.readMeta();
    const entry = meta.boards.find((b) => b.slug === slug);
    if (!entry) {
      throw new Error(`board not found: ${slug}`);
    }
    if (options.hardDelete) {
      meta.boards = meta.boards.filter((b) => b.slug !== slug);
      try {
        fs.rmSync(this.boardPath(slug), { force: true });
      } catch {
        /* best-effort */
      }
    } else {
      entry.archived = true;
    }
    if (meta.current === slug) meta.current = DEFAULT_BOARD_SLUG;
    this.writeMeta(meta);
  }
}
