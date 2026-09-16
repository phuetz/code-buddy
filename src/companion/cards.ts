import { mkdir } from 'fs/promises';
import * as crypto from 'crypto';
import * as path from 'path';
import { readJsonAtomic, writeJsonAtomic } from '../utils/atomic-write.js';
import { recordCompanionPercept } from './percepts.js';
import { recordCompanionSafetyEvent } from './safety-ledger.js';

export type CompanionCardKind =
  | 'status'
  | 'approval'
  | 'camera'
  | 'checklist'
  | 'mission'
  | 'timer'
  | 'weather'
  | 'tool';
export type CompanionCardPriority = 'low' | 'medium' | 'high';
export type CompanionCardStatus = 'open' | 'resolved' | 'dismissed';

export interface CompanionCardAction {
  id: string;
  label: string;
  command?: string;
  style?: 'primary' | 'secondary' | 'danger';
}

export interface CompanionCard {
  id: string;
  kind: CompanionCardKind;
  status: CompanionCardStatus;
  priority: CompanionCardPriority;
  title: string;
  body: string;
  actions: CompanionCardAction[];
  payload: Record<string, unknown>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  resolvedAt?: string;
}

export interface CompanionCardInput {
  kind: CompanionCardKind;
  title: string;
  body?: string;
  priority?: CompanionCardPriority;
  actions?: CompanionCardAction[];
  payload?: Record<string, unknown>;
  tags?: string[];
  expiresAt?: string;
}

export interface CompanionCardStore {
  schemaVersion: 1;
  cwd: string;
  storePath: string;
  updatedAt: string;
  cards: CompanionCard[];
}

export interface CompanionCardOptions {
  cwd?: string;
  now?: Date;
  storePath?: string;
}

export interface CompanionCardQueryOptions extends CompanionCardOptions {
  status?: CompanionCardStatus;
  kind?: CompanionCardKind;
  limit?: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

export function getCompanionCardsPath(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'companion', 'cards.json');
}

function resolveStorePath(options: CompanionCardOptions = {}): string {
  const cwd = resolveCwd(options.cwd);
  return path.resolve(cwd, options.storePath || getCompanionCardsPath(cwd));
}

function emptyStore(options: CompanionCardOptions = {}): CompanionCardStore {
  const cwd = resolveCwd(options.cwd);
  return {
    schemaVersion: 1,
    cwd,
    storePath: resolveStorePath(options),
    updatedAt: (options.now || new Date()).toISOString(),
    cards: [],
  };
}

function createCardId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '');
  return `card-${stamp}-${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return [...new Set(tags.map(tag => tag.trim().toLowerCase()).filter(Boolean))];
}

function isKind(value: unknown): value is CompanionCardKind {
  return value === 'status'
    || value === 'approval'
    || value === 'camera'
    || value === 'checklist'
    || value === 'mission'
    || value === 'timer'
    || value === 'weather'
    || value === 'tool';
}

function isPriority(value: unknown): value is CompanionCardPriority {
  return value === 'low' || value === 'medium' || value === 'high';
}

function isStatus(value: unknown): value is CompanionCardStatus {
  return value === 'open' || value === 'resolved' || value === 'dismissed';
}

function parseAction(value: unknown): CompanionCardAction | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<CompanionCardAction>;
  if (typeof raw.id !== 'string' || typeof raw.label !== 'string') return null;
  return {
    id: raw.id,
    label: raw.label,
    command: raw.command,
    style: raw.style === 'primary' || raw.style === 'secondary' || raw.style === 'danger'
      ? raw.style
      : undefined,
  };
}

function parseCard(value: unknown): CompanionCard | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<CompanionCard>;
  if (
    typeof raw.id !== 'string'
    || !isKind(raw.kind)
    || !isStatus(raw.status)
    || !isPriority(raw.priority)
    || typeof raw.title !== 'string'
    || typeof raw.body !== 'string'
    || typeof raw.createdAt !== 'string'
    || typeof raw.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    id: raw.id,
    kind: raw.kind,
    status: raw.status,
    priority: raw.priority,
    title: raw.title,
    body: raw.body,
    actions: Array.isArray(raw.actions)
      ? raw.actions.map(parseAction).filter((action): action is CompanionCardAction => Boolean(action))
      : [],
    payload: typeof raw.payload === 'object' && raw.payload !== null ? raw.payload as Record<string, unknown> : {},
    tags: Array.isArray(raw.tags) ? normalizeTags(raw.tags.filter((tag): tag is string => typeof tag === 'string')) : [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    expiresAt: raw.expiresAt,
    resolvedAt: raw.resolvedAt,
  };
}

function sortCards(cards: CompanionCard[]): CompanionCard[] {
  const statusRank: Record<CompanionCardStatus, number> = { open: 0, resolved: 1, dismissed: 2 };
  const priorityRank: Record<CompanionCardPriority, number> = { high: 0, medium: 1, low: 2 };
  return [...cards].sort((a, b) =>
    statusRank[a.status] - statusRank[b.status]
    || priorityRank[a.priority] - priorityRank[b.priority]
    || b.updatedAt.localeCompare(a.updatedAt));
}

async function writeStore(store: CompanionCardStore): Promise<void> {
  await writeJsonAtomic(store.storePath, store, { mode: 0o600 });
}

export async function readCompanionCards(
  options: CompanionCardQueryOptions = {},
): Promise<CompanionCardStore> {
  const fallback = emptyStore(options);
  const parsed = await readJsonAtomic<Partial<CompanionCardStore> | null>(fallback.storePath, null, {
    mode: 0o600,
    isValid: (value): value is Partial<CompanionCardStore> => Boolean(
      value && typeof value === 'object' && !Array.isArray(value),
    ),
  });
  if (!parsed) return fallback;
  try {
    const cards = Array.isArray(parsed.cards)
      ? parsed.cards.map(parseCard).filter((card): card is CompanionCard => Boolean(card))
      : [];
    const filtered = cards
      .filter(card => !options.status || card.status === options.status)
      .filter(card => !options.kind || card.kind === options.kind)
      .slice(0, Math.max(1, Math.min(MAX_LIMIT, options.limit || DEFAULT_LIMIT)));
    return {
      schemaVersion: 1,
      cwd: typeof parsed.cwd === 'string' ? parsed.cwd : fallback.cwd,
      storePath: fallback.storePath,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : fallback.updatedAt,
      cards: sortCards(filtered),
    };
  } catch {
    return fallback;
  }
}

async function readFullCardStore(options: CompanionCardOptions = {}): Promise<CompanionCardStore> {
  return readCompanionCards({ ...options, limit: MAX_LIMIT });
}

export async function createCompanionCard(
  input: CompanionCardInput,
  options: CompanionCardOptions = {},
): Promise<CompanionCard> {
  const now = options.now || new Date();
  const nowIso = now.toISOString();
  const store = await readFullCardStore(options);
  const card: CompanionCard = {
    id: createCardId(now),
    kind: input.kind,
    status: 'open',
    priority: input.priority || 'medium',
    title: input.title.trim(),
    body: (input.body || '').trim(),
    actions: input.actions || [],
    payload: input.payload || {},
    tags: normalizeTags(['card', input.kind, ...(input.tags || [])]),
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt: input.expiresAt,
  };
  const next: CompanionCardStore = {
    ...store,
    updatedAt: nowIso,
    cards: sortCards([card, ...store.cards]),
  };
  await writeStore(next);

  await recordCompanionPercept({
    modality: 'tool',
    source: 'companion_cards',
    summary: `Created ${card.kind} companion card: ${card.title}.`,
    confidence: 1,
    payload: {
      cardId: card.id,
      kind: card.kind,
      priority: card.priority,
    },
    tags: card.tags,
  }, { cwd: store.cwd, now });

  if (card.kind === 'approval') {
    await recordCompanionSafetyEvent({
      kind: 'permission',
      risk: card.priority === 'high' ? 'high' : 'medium',
      action: 'companion_card_approval',
      reason: `Created approval card ${card.id}: ${card.title}.`,
      status: 'planned',
      source: 'companion_cards',
      payload: {
        cardId: card.id,
        actions: card.actions.map(action => action.id),
      },
      tags: card.tags,
    }, { cwd: store.cwd, now });
  }

  return card;
}

export async function updateCompanionCardStatus(
  cardId: string,
  status: CompanionCardStatus,
  options: CompanionCardOptions = {},
): Promise<CompanionCard> {
  const now = options.now || new Date();
  const nowIso = now.toISOString();
  const store = await readFullCardStore(options);
  const card = store.cards.find(item => item.id === cardId);
  if (!card) {
    throw new Error(`Companion card not found: ${cardId}`);
  }

  const updated: CompanionCard = {
    ...card,
    status,
    updatedAt: nowIso,
    resolvedAt: status === 'resolved' || status === 'dismissed' ? nowIso : undefined,
  };
  const next: CompanionCardStore = {
    ...store,
    updatedAt: nowIso,
    cards: sortCards(store.cards.map(item => item.id === cardId ? updated : item)),
  };
  await writeStore(next);
  await recordCompanionPercept({
    modality: 'tool',
    source: 'companion_cards',
    summary: `Companion card ${cardId} marked ${status}.`,
    confidence: 1,
    payload: {
      cardId,
      status,
    },
    tags: ['card', 'status', status, updated.kind],
  }, { cwd: store.cwd, now });

  return updated;
}

export function formatCompanionCards(store: CompanionCardStore): string {
  const lines = [
    'Buddy Companion Cards',
    '='.repeat(50),
    '',
    `Workspace: ${store.cwd}`,
    `Path: ${store.storePath}`,
    `Updated: ${store.updatedAt}`,
    `Cards: ${store.cards.length}`,
  ];

  if (store.cards.length === 0) {
    lines.push('', 'No companion cards yet.');
    return lines.join('\n');
  }

  for (const card of store.cards) {
    lines.push(
      '',
      `[${card.priority}] [${card.status}] ${card.kind} ${card.id}`,
      `  ${card.title}`,
    );
    if (card.body) lines.push(`  ${card.body}`);
    if (card.actions.length > 0) {
      lines.push(`  Actions: ${card.actions.map(action => action.command ? `${action.label} -> ${action.command}` : action.label).join(', ')}`);
    }
  }

  return lines.join('\n');
}
