import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

export type KanbanStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'archived';
export type KanbanPriority = 'low' | 'medium' | 'high' | 'urgent';

/** Per-status / per-assignee / per-priority counts (`hermes kanban stats`). */
export interface KanbanStats {
  total: number;
  byStatus: Record<KanbanStatus, number>;
  byPriority: Record<KanbanPriority, number>;
  byAssignee: Record<string, number>;
  unassigned: number;
}

export interface KanbanComment {
  id: string;
  author?: string;
  text: string;
  createdAt: string;
}

export interface KanbanHeartbeat {
  id: string;
  author?: string;
  message?: string;
  createdAt: string;
}

export interface KanbanLink {
  id: string;
  target: string;
  label?: string;
  createdAt: string;
}

export interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  assignee?: string;
  tags: string[];
  blockedReason?: string;
  links: KanbanLink[];
  comments: KanbanComment[];
  heartbeats: KanbanHeartbeat[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface KanbanBoard {
  schemaVersion: 1;
  cards: KanbanCard[];
  updatedAt: string;
}

export interface CreateKanbanCardInput {
  id?: string;
  title: string;
  description?: string;
  status?: KanbanStatus;
  priority?: KanbanPriority;
  assignee?: string;
  tags?: string[];
}

export interface ListKanbanCardsFilter {
  status?: KanbanStatus;
  priority?: KanbanPriority;
  assignee?: string;
  tag?: string;
  includeDone?: boolean;
  /** Include archived cards. Default false (archived cards are hidden). */
  includeArchived?: boolean;
}

export interface KanbanStoreOptions {
  rootDir?: string;
  boardPath?: string;
  now?: () => Date;
  createId?: () => string;
}

export class KanbanStore {
  private readonly boardPath: string;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(options: KanbanStoreOptions = {}) {
    const rootDir = options.rootDir ?? process.cwd();
    this.boardPath = options.boardPath ?? path.join(rootDir, '.codebuddy', 'kanban-board.json');
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => randomUUID());
  }

  get path(): string {
    return this.boardPath;
  }

  async createCard(input: CreateKanbanCardInput): Promise<KanbanCard> {
    const title = input.title.trim();
    if (!title) {
      throw new Error('title is required');
    }

    const board = await this.readBoard();
    const now = this.isoNow();
    const id = input.id?.trim() || this.buildCardId(title, board);
    if (board.cards.some((card) => card.id === id)) {
      throw new Error(`kanban card already exists: ${id}`);
    }

    const card: KanbanCard = {
      id,
      title,
      status: input.status ?? 'todo',
      priority: input.priority ?? 'medium',
      tags: normalizeTags(input.tags),
      links: [],
      comments: [],
      heartbeats: [],
      createdAt: now,
      updatedAt: now,
    };

    if (input.description?.trim()) {
      card.description = input.description.trim();
    }
    if (input.assignee?.trim()) {
      card.assignee = input.assignee.trim();
    }

    board.cards.push(card);
    await this.writeBoard(board);
    return { ...card };
  }

  async listCards(filter: ListKanbanCardsFilter = {}): Promise<KanbanCard[]> {
    const board = await this.readBoard();
    const includeDone = filter.includeDone !== false;

    const includeArchived = filter.includeArchived === true || filter.status === 'archived';

    return board.cards
      .filter((card) => {
        if (!includeDone && card.status === 'done') return false;
        if (!includeArchived && card.status === 'archived') return false;
        if (filter.status && card.status !== filter.status) return false;
        if (filter.priority && card.priority !== filter.priority) return false;
        if (filter.assignee && card.assignee !== filter.assignee) return false;
        if (filter.tag && !card.tags.includes(filter.tag)) return false;
        return true;
      })
      .sort(compareCards)
      .map((card) => ({ ...card }));
  }

  async showCard(id: string): Promise<KanbanCard> {
    const board = await this.readBoard();
    return { ...findCardOrThrow(board, normalizeId(id)) };
  }

  async completeCard(id: string, comment?: string, author?: string): Promise<KanbanCard> {
    return this.updateCard(id, (card, now) => {
      card.status = 'done';
      card.completedAt = now;
      delete card.blockedReason;
      if (comment?.trim()) {
        card.comments.push(this.createComment(comment, now, author));
      }
    });
  }

  async blockCard(id: string, reason: string, author?: string): Promise<KanbanCard> {
    const blockedReason = reason.trim();
    if (!blockedReason) {
      throw new Error('reason is required');
    }

    return this.updateCard(id, (card, now) => {
      card.status = 'blocked';
      card.blockedReason = blockedReason;
      card.comments.push(this.createComment(`Blocked: ${blockedReason}`, now, author));
    });
  }

  async unblockCard(id: string, comment?: string, author?: string): Promise<KanbanCard> {
    return this.updateCard(id, (card, now) => {
      if (card.status === 'blocked') {
        card.status = 'in_progress';
      }
      delete card.blockedReason;
      card.comments.push(this.createComment(comment?.trim() || 'Unblocked', now, author));
    });
  }

  async commentCard(id: string, text: string, author?: string): Promise<KanbanCard> {
    const comment = text.trim();
    if (!comment) {
      throw new Error('text is required');
    }

    return this.updateCard(id, (card, now) => {
      card.comments.push(this.createComment(comment, now, author));
    });
  }

  async heartbeatCard(id: string, message?: string, author?: string): Promise<KanbanCard> {
    return this.updateCard(id, (card, now) => {
      if (card.status === 'todo') {
        card.status = 'in_progress';
      }
      card.heartbeats.push(this.createHeartbeat(message, now, author));
    });
  }

  async linkCard(id: string, target: string, label?: string): Promise<KanbanCard> {
    const normalizedTarget = target.trim();
    if (!normalizedTarget) {
      throw new Error('target is required');
    }

    return this.updateCard(id, (card, now) => {
      card.links.push({
        id: this.createId(),
        target: normalizedTarget,
        createdAt: now,
        ...(label?.trim() ? { label: label.trim() } : {}),
      });
    });
  }

  /** Remove a link by its link id or by target id. Mirrors `hermes kanban unlink`. */
  async unlinkCard(id: string, linkRef: string): Promise<KanbanCard> {
    const ref = linkRef.trim();
    if (!ref) {
      throw new Error('linkRef is required');
    }
    return this.updateCard(id, (card) => {
      const before = card.links.length;
      card.links = card.links.filter((link) => link.id !== ref && link.target !== ref);
      if (card.links.length === before) {
        throw new Error(`kanban link not found: ${ref}`);
      }
    });
  }

  /** Set or clear a card assignee. Mirrors `hermes kanban assign`. */
  async assignCard(id: string, assignee: string | null, author?: string): Promise<KanbanCard> {
    const next = assignee?.trim() || undefined;
    return this.updateCard(id, (card, now) => {
      if (next) {
        card.assignee = next;
        card.comments.push(this.createComment(`Assigned to ${next}`, now, author));
      } else {
        delete card.assignee;
        card.comments.push(this.createComment('Unassigned', now, author));
      }
    });
  }

  /** Archive a card (hidden from default lists). Mirrors `hermes kanban archive`. */
  async archiveCard(id: string, comment?: string, author?: string): Promise<KanbanCard> {
    return this.updateCard(id, (card, now) => {
      card.status = 'archived';
      delete card.blockedReason;
      card.comments.push(this.createComment(comment?.trim() || 'Archived', now, author));
    });
  }

  /** Per-status / per-priority / per-assignee counts. Mirrors `hermes kanban stats`. */
  async stats(): Promise<KanbanStats> {
    const board = await this.readBoard();
    const byStatus: Record<KanbanStatus, number> = {
      todo: 0,
      in_progress: 0,
      blocked: 0,
      done: 0,
      archived: 0,
    };
    const byPriority: Record<KanbanPriority, number> = { low: 0, medium: 0, high: 0, urgent: 0 };
    const byAssignee: Record<string, number> = {};
    let unassigned = 0;
    for (const card of board.cards) {
      byStatus[card.status] += 1;
      byPriority[card.priority] += 1;
      if (card.assignee) {
        byAssignee[card.assignee] = (byAssignee[card.assignee] ?? 0) + 1;
      } else {
        unassigned += 1;
      }
    }
    return { total: board.cards.length, byStatus, byPriority, byAssignee, unassigned };
  }

  async readBoard(): Promise<KanbanBoard> {
    try {
      const raw = await fs.readFile(this.boardPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<KanbanBoard>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.cards)) {
        throw new Error(`invalid kanban board schema at ${this.boardPath}`);
      }
      return {
        schemaVersion: 1,
        cards: parsed.cards.map(normalizeCard),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : this.isoNow(),
      };
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return this.emptyBoard();
      }
      throw error;
    }
  }

  private async updateCard(
    id: string,
    updater: (card: KanbanCard, now: string) => void,
  ): Promise<KanbanCard> {
    const board = await this.readBoard();
    const card = findCardOrThrow(board, normalizeId(id));
    const now = this.isoNow();
    updater(card, now);
    card.updatedAt = now;
    await this.writeBoard(board);
    return { ...card };
  }

  private async writeBoard(board: KanbanBoard): Promise<void> {
    board.updatedAt = this.isoNow();
    await fs.mkdir(path.dirname(this.boardPath), { recursive: true });
    const tempPath = `${this.boardPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, this.boardPath);
  }

  private emptyBoard(): KanbanBoard {
    return {
      schemaVersion: 1,
      cards: [],
      updatedAt: this.isoNow(),
    };
  }

  private buildCardId(title: string, board: KanbanBoard): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'card';
    const suffix = this.createId().replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || String(board.cards.length + 1);
    return `kb-${slug}-${suffix}`;
  }

  private createComment(text: string, createdAt: string, author?: string): KanbanComment {
    return {
      id: this.createId(),
      text,
      createdAt,
      ...(author?.trim() ? { author: author.trim() } : {}),
    };
  }

  private createHeartbeat(message: string | undefined, createdAt: string, author?: string): KanbanHeartbeat {
    return {
      id: this.createId(),
      createdAt,
      ...(message?.trim() ? { message: message.trim() } : {}),
      ...(author?.trim() ? { author: author.trim() } : {}),
    };
  }

  private isoNow(): string {
    return this.now().toISOString();
  }
}

function normalizeId(id: string): string {
  const normalized = id.trim();
  if (!normalized) {
    throw new Error('id is required');
  }
  return normalized;
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function normalizeCard(card: Partial<KanbanCard>): KanbanCard {
  if (!card.id || !card.title || !card.createdAt || !card.updatedAt) {
    throw new Error('invalid kanban card record');
  }

  return {
    id: card.id,
    title: card.title,
    status: normalizeStatus(card.status),
    priority: normalizePriority(card.priority),
    tags: normalizeTags(card.tags),
    links: Array.isArray(card.links) ? card.links.map(normalizeLink) : [],
    comments: Array.isArray(card.comments) ? card.comments.map(normalizeComment) : [],
    heartbeats: Array.isArray(card.heartbeats) ? card.heartbeats.map(normalizeHeartbeat) : [],
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    ...(card.description ? { description: card.description } : {}),
    ...(card.assignee ? { assignee: card.assignee } : {}),
    ...(card.blockedReason ? { blockedReason: card.blockedReason } : {}),
    ...(card.completedAt ? { completedAt: card.completedAt } : {}),
  };
}

function normalizeLink(link: Partial<KanbanLink>): KanbanLink {
  if (!link.id || !link.target || !link.createdAt) {
    throw new Error('invalid kanban link record');
  }
  return {
    id: link.id,
    target: link.target,
    createdAt: link.createdAt,
    ...(link.label ? { label: link.label } : {}),
  };
}

function normalizeComment(comment: Partial<KanbanComment>): KanbanComment {
  if (!comment.id || !comment.text || !comment.createdAt) {
    throw new Error('invalid kanban comment record');
  }
  return {
    id: comment.id,
    text: comment.text,
    createdAt: comment.createdAt,
    ...(comment.author ? { author: comment.author } : {}),
  };
}

function normalizeHeartbeat(heartbeat: Partial<KanbanHeartbeat>): KanbanHeartbeat {
  if (!heartbeat.id || !heartbeat.createdAt) {
    throw new Error('invalid kanban heartbeat record');
  }
  return {
    id: heartbeat.id,
    createdAt: heartbeat.createdAt,
    ...(heartbeat.message ? { message: heartbeat.message } : {}),
    ...(heartbeat.author ? { author: heartbeat.author } : {}),
  };
}

function normalizeStatus(status: unknown): KanbanStatus {
  if (
    status === 'todo' ||
    status === 'in_progress' ||
    status === 'blocked' ||
    status === 'done' ||
    status === 'archived'
  ) {
    return status;
  }
  return 'todo';
}

function normalizePriority(priority: unknown): KanbanPriority {
  if (priority === 'low' || priority === 'medium' || priority === 'high' || priority === 'urgent') {
    return priority;
  }
  return 'medium';
}

function findCardOrThrow(board: KanbanBoard, id: string): KanbanCard {
  const card = board.cards.find((candidate) => candidate.id === id);
  if (!card) {
    throw new Error(`kanban card not found: ${id}`);
  }
  return card;
}

function compareCards(a: KanbanCard, b: KanbanCard): number {
  const statusOrder: Record<KanbanStatus, number> = {
    blocked: 0,
    in_progress: 1,
    todo: 2,
    done: 3,
    archived: 4,
  };
  const priorityOrder: Record<KanbanPriority, number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return (
    statusOrder[a.status] - statusOrder[b.status] ||
    priorityOrder[a.priority] - priorityOrder[b.priority] ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}
