import { loadCoreModule } from '../utils/core-loader';

export type KanbanStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'archived';
export type KanbanPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface KanbanLink {
  id: string;
  target: string;
  label?: string;
  createdAt: string;
}

export interface KanbanComment {
  id: string;
  author?: string;
  text: string;
  createdAt: string;
}

export interface KanbanCard {
  assignee?: string;
  blockedReason?: string;
  comments: KanbanComment[];
  completedAt?: string;
  createdAt: string;
  description?: string;
  heartbeats: unknown[];
  id: string;
  links: KanbanLink[];
  priority: KanbanPriority;
  status: KanbanStatus;
  tags: string[];
  title: string;
  updatedAt: string;
}

export interface KanbanCreateInput {
  assignee?: string;
  description?: string;
  priority?: KanbanPriority;
  status?: KanbanStatus;
  tags?: string[];
  title: string;
}

export interface KanbanListFilter {
  assignee?: string;
  includeDone?: boolean;
  priority?: KanbanPriority;
  status?: KanbanStatus;
  tag?: string;
}

interface KanbanStoreInstance {
  readonly path: string;
  createCard: (input: KanbanCreateInput) => Promise<KanbanCard>;
  listCards: (filter?: KanbanListFilter) => Promise<KanbanCard[]>;
  completeCard: (id: string, comment?: string, author?: string) => Promise<KanbanCard>;
  blockCard: (id: string, reason: string, author?: string) => Promise<KanbanCard>;
  unblockCard: (id: string, comment?: string, author?: string) => Promise<KanbanCard>;
  commentCard: (id: string, text: string, author?: string) => Promise<KanbanCard>;
  linkCard: (id: string, target: string, label?: string) => Promise<KanbanCard>;
  unlinkCard: (id: string, linkRef: string) => Promise<KanbanCard>;
  assignCard: (id: string, assignee: string | null, author?: string) => Promise<KanbanCard>;
  archiveCard: (id: string, comment?: string, author?: string) => Promise<KanbanCard>;
}

interface KanbanStoreModule {
  KanbanStore: new (options: { rootDir?: string; boardPath?: string }) => KanbanStoreInstance;
}

export interface KanbanBoardInfo {
  slug: string;
  name: string;
  createdAt: string;
  archived: boolean;
  current: boolean;
  cardCount: number;
  path: string;
}

interface KanbanBoardRegistryInstance {
  resolveSlug: (explicit?: string) => string;
  boardPath: (slug: string) => string;
  list: (includeArchived?: boolean) => KanbanBoardInfo[];
  create: (slug: string, name?: string) => KanbanBoardInfo;
  switch: (slug: string) => KanbanBoardInfo;
}

interface KanbanBoardRegistryModule {
  KanbanBoardRegistry: new (options: { rootDir?: string }) => KanbanBoardRegistryInstance;
}

async function buildRegistry(cwd?: string): Promise<KanbanBoardRegistryInstance | null> {
  const mod = await loadCoreModule<KanbanBoardRegistryModule>('kanban/kanban-board-registry.js');
  if (!mod?.KanbanBoardRegistry) return null;
  const rootDir = cwd?.trim() || process.cwd();
  return new mod.KanbanBoardRegistry({ rootDir });
}

async function buildStore(cwd?: string, boardSlug?: string): Promise<KanbanStoreInstance | null> {
  const mod = await loadCoreModule<KanbanStoreModule>('kanban/kanban-store.js');
  if (!mod?.KanbanStore) return null;
  const rootDir = cwd?.trim() || process.cwd();
  // Resolve the active (or explicitly requested) board via the registry so the
  // GUI honours multi-board selection; fall back to the legacy single board.
  const registry = await buildRegistry(cwd);
  if (registry) {
    const slug = registry.resolveSlug(boardSlug);
    return new mod.KanbanStore({ boardPath: registry.boardPath(slug) });
  }
  return new mod.KanbanStore({ rootDir });
}

/** List Kanban boards. Mirrors `buddy hermes kanban boards list`. */
export async function listHermesKanbanBoards(options: {
  cwd?: string;
  includeArchived?: boolean;
}): Promise<KanbanBoardInfo[] | null> {
  const registry = await buildRegistry(options.cwd);
  if (!registry) return null;
  return registry.list(options.includeArchived === true);
}

/** Create + switch to a board. Mirrors `buddy hermes kanban boards create`. */
export async function createHermesKanbanBoard(options: {
  cwd?: string;
  name?: string;
  slug: string;
}): Promise<KanbanBoardInfo | null> {
  const registry = await buildRegistry(options.cwd);
  if (!registry) return null;
  return registry.create(options.slug, options.name);
}

/** Switch the active board. Mirrors `buddy hermes kanban boards switch`. */
export async function switchHermesKanbanBoard(options: {
  cwd?: string;
  slug: string;
}): Promise<KanbanBoardInfo | null> {
  const registry = await buildRegistry(options.cwd);
  if (!registry) return null;
  return registry.switch(options.slug);
}

export interface KanbanListResult {
  boardPath: string;
  cards: KanbanCard[];
}

/** List cards on the workspace board. Mirrors `buddy hermes kanban list`. */
export async function listHermesKanbanCards(options: {
  cwd?: string;
  filter?: KanbanListFilter;
}): Promise<KanbanListResult | null> {
  const store = await buildStore(options.cwd);
  if (!store) return null;
  const cards = await store.listCards(options.filter ?? {});
  return { boardPath: store.path, cards };
}

/** Create a card. Mirrors `buddy hermes kanban create`. */
export async function createHermesKanbanCard(options: {
  cwd?: string;
  input: KanbanCreateInput;
}): Promise<KanbanCard | null> {
  const store = await buildStore(options.cwd);
  if (!store) return null;
  return store.createCard(options.input);
}

/** Mark a card done. Mirrors `buddy hermes kanban complete`. */
export async function completeHermesKanbanCard(options: {
  comment?: string;
  cwd?: string;
  id: string;
}): Promise<KanbanCard | null> {
  const store = await buildStore(options.cwd);
  if (!store) return null;
  return store.completeCard(options.id, options.comment);
}

/** Block a card with a reason. Mirrors `buddy hermes kanban block`. */
export async function blockHermesKanbanCard(options: {
  cwd?: string;
  id: string;
  reason: string;
}): Promise<KanbanCard | null> {
  const store = await buildStore(options.cwd);
  if (!store) return null;
  return store.blockCard(options.id, options.reason);
}

/** Clear a card block. Mirrors `buddy hermes kanban unblock`. */
export async function unblockHermesKanbanCard(options: {
  comment?: string;
  cwd?: string;
  id: string;
}): Promise<KanbanCard | null> {
  const store = await buildStore(options.cwd);
  if (!store) return null;
  return store.unblockCard(options.id, options.comment);
}

/** Add a comment to a card. Mirrors `buddy hermes kanban comment`. */
export async function commentHermesKanbanCard(options: {
  cwd?: string;
  id: string;
  text: string;
}): Promise<KanbanCard | null> {
  const store = await buildStore(options.cwd);
  if (!store) return null;
  return store.commentCard(options.id, options.text);
}

/** Link a card to a target. Mirrors `buddy hermes kanban link`. */
export async function linkHermesKanbanCard(options: {
  cwd?: string;
  id: string;
  label?: string;
  target: string;
}): Promise<KanbanCard | null> {
  const store = await buildStore(options.cwd);
  if (!store) return null;
  return store.linkCard(options.id, options.target, options.label);
}

/** Remove a link from a card. Mirrors `buddy hermes kanban unlink`. */
export async function unlinkHermesKanbanCard(options: {
  cwd?: string;
  id: string;
  linkRef: string;
}): Promise<KanbanCard | null> {
  const store = await buildStore(options.cwd);
  if (!store) return null;
  return store.unlinkCard(options.id, options.linkRef);
}

/** Assign (or clear) a card assignee. Mirrors `buddy hermes kanban assign`. */
export async function assignHermesKanbanCard(options: {
  assignee: string | null;
  cwd?: string;
  id: string;
}): Promise<KanbanCard | null> {
  const store = await buildStore(options.cwd);
  if (!store) return null;
  return store.assignCard(options.id, options.assignee);
}

/** Archive a card. Mirrors `buddy hermes kanban archive`. */
export async function archiveHermesKanbanCard(options: {
  comment?: string;
  cwd?: string;
  id: string;
}): Promise<KanbanCard | null> {
  const store = await buildStore(options.cwd);
  if (!store) return null;
  return store.archiveCard(options.id, options.comment);
}
