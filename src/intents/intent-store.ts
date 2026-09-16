/**
 * Durable, repository-local storage for falsifiable task intents.
 *
 * Each intent is a Markdown file with YAML frontmatter. The companion JSONL
 * ledger is deliberately append-only so checks performed long after creation
 * remain auditable.
 */

import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { logger } from '../utils/logger.js';
import { readTextAtomic, writeFileAtomic } from '../utils/atomic-write.js';

export type IntentStatus = 'active' | 'done' | 'archived';
export type IntentLedgerEventType = 'created' | 'checked' | 'drifted' | 'archived';

export interface IntentCriterion {
  desc: string;
  cmd: string;
  expectExit: number;
}

export interface Intent {
  id: string;
  title: string;
  status: IntentStatus;
  createdAt: string;
  files: string[];
  criteria: IntentCriterion[];
  body: string;
}

export interface CreateIntentInput {
  id?: string;
  title: string;
  status?: IntentStatus;
  createdAt?: string;
  files: string[];
  criteria: IntentCriterion[];
  body?: string;
}

export interface IntentLedgerEvent {
  type: IntentLedgerEventType;
  intentId: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface IntentStoreOptions {
  /** Repository root. Defaults to the current working directory. */
  rootDir?: string;
  now?: () => Date;
  idFactory?: (input: CreateIntentInput, now: Date) => string;
}

interface IntentFrontmatter {
  id: string;
  title: string;
  status: IntentStatus;
  createdAt: string;
  files: string[];
  criteria: IntentCriterion[];
}

const VALID_ID = /^[a-z0-9][a-z0-9._-]*$/;
const VALID_STATUSES = new Set<IntentStatus>(['active', 'done', 'archived']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid intent frontmatter: "${field}" must be a non-empty string.`);
  }
  return value;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`Invalid intent frontmatter: "${field}" must be an array of non-empty strings.`);
  }
  return value.map((item) => (item as string).trim());
}

function parseCriteria(value: unknown): IntentCriterion[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid intent frontmatter: "criteria" must be an array.');
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Invalid intent frontmatter: criterion ${index + 1} must be an object.`);
    }
    const expectExit = item.expectExit;
    if (typeof expectExit !== 'number' || !Number.isSafeInteger(expectExit)) {
      throw new Error(`Invalid intent frontmatter: criterion ${index + 1} has an invalid expectExit.`);
    }
    return {
      desc: requireString(item.desc, `criteria[${index}].desc`).trim(),
      cmd: requireString(item.cmd, `criteria[${index}].cmd`).trim(),
      expectExit,
    };
  });
}

function parseFrontmatter(value: unknown): IntentFrontmatter {
  if (!isRecord(value)) {
    throw new Error('Invalid intent frontmatter: expected a YAML object.');
  }
  const id = requireString(value.id, 'id').trim();
  if (!VALID_ID.test(id)) {
    throw new Error(`Invalid intent id "${id}".`);
  }
  const status = value.status;
  if (typeof status !== 'string' || !VALID_STATUSES.has(status as IntentStatus)) {
    throw new Error('Invalid intent frontmatter: "status" must be active, done, or archived.');
  }
  const createdAt = requireString(value.createdAt, 'createdAt').trim();
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error('Invalid intent frontmatter: "createdAt" must be an ISO date string.');
  }
  return {
    id,
    title: requireString(value.title, 'title').trim(),
    status: status as IntentStatus,
    createdAt,
    files: parseStringArray(value.files, 'files'),
    criteria: parseCriteria(value.criteria),
  };
}

function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'intent';
}

function defaultIdFactory(input: CreateIntentInput, now: Date): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  return `${slugify(input.title)}-${stamp}`;
}

function assertSafeId(id: string): void {
  if (!VALID_ID.test(id)) {
    throw new Error(`Invalid intent id "${id}". Use lowercase letters, digits, dots, dashes, or underscores.`);
  }
}

export function serializeIntent(intent: Intent): string {
  const frontmatter: IntentFrontmatter = {
    id: intent.id,
    title: intent.title,
    status: intent.status,
    createdAt: intent.createdAt,
    files: intent.files,
    criteria: intent.criteria,
  };
  const encoded = yaml.dump(frontmatter, {
    schema: yaml.JSON_SCHEMA,
    noRefs: true,
    lineWidth: -1,
    sortKeys: false,
  }).trimEnd();
  return `---\n${encoded}\n---\n${intent.body}`;
}

export function parseIntentMarkdown(markdown: string): Intent {
  const match = markdown.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid intent Markdown: missing YAML frontmatter delimiters.');
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(match[1] ?? '', { schema: yaml.JSON_SCHEMA });
  } catch (error) {
    throw new Error(`Invalid intent YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ...parseFrontmatter(parsed), body: match[2] ?? '' };
}

export class IntentStore {
  readonly rootDir: string;
  readonly intentsDir: string;
  readonly ledgerPath: string;

  private readonly now: () => Date;
  private readonly idFactory: (input: CreateIntentInput, now: Date) => string;

  constructor(options: IntentStoreOptions | string = {}) {
    const normalized = typeof options === 'string' ? { rootDir: options } : options;
    this.rootDir = path.resolve(normalized.rootDir ?? process.cwd());
    this.intentsDir = path.join(this.rootDir, '.codebuddy', 'intents');
    this.ledgerPath = path.join(this.intentsDir, 'ledger.jsonl');
    this.now = normalized.now ?? (() => new Date());
    this.idFactory = normalized.idFactory ?? defaultIdFactory;
  }

  getPath(id: string): string {
    assertSafeId(id);
    return path.join(this.intentsDir, `${id}.md`);
  }

  async create(input: CreateIntentInput): Promise<Intent> {
    const now = this.now();
    const id = (input.id ?? this.idFactory(input, now)).trim();
    assertSafeId(id);
    const createdAt = input.createdAt ?? now.toISOString();
    const intent = parseFrontmatter({
      id,
      title: input.title,
      status: input.status ?? 'active',
      createdAt,
      files: input.files,
      criteria: input.criteria,
    });
    const stored: Intent = { ...intent, body: input.body ?? '' };
    await mkdir(this.intentsDir, { recursive: true });
    try {
      await writeFile(this.getPath(id), serializeIntent(stored), { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
      if (code === 'EEXIST') {
        throw new Error(`Intent "${id}" already exists.`);
      }
      throw error;
    }
    await this.appendEvent({ type: 'created', intentId: id, timestamp: now.toISOString() });
    return stored;
  }

  async get(id: string): Promise<Intent | null> {
    const filePath = this.getPath(id);
    let markdown: string;
    try {
      markdown = await readTextAtomic(filePath, '');
      if (!markdown) return null;
    } catch (error) {
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
      if (code === 'ENOENT') return null;
      throw error;
    }
    const intent = parseIntentMarkdown(markdown);
    if (intent.id !== id) {
      throw new Error(`Intent id mismatch: requested "${id}" but file declares "${intent.id}".`);
    }
    return intent;
  }

  async list(): Promise<Intent[]> {
    let names: string[];
    try {
      names = await readdir(this.intentsDir);
    } catch (error) {
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
      if (code === 'ENOENT') return [];
      logger.warn('Unable to list intent files.', { error: String(error) });
      return [];
    }
    const intents: Intent[] = [];
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      const id = name.slice(0, -3);
      if (!VALID_ID.test(id)) continue;
      try {
        const intent = await this.get(id);
        if (intent) intents.push(intent);
      } catch (error) {
        logger.warn(`Skipping invalid intent file "${name}".`, { error: String(error) });
      }
    }
    return intents.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
  }

  async setStatus(id: string, status: IntentStatus): Promise<Intent> {
    if (!VALID_STATUSES.has(status)) {
      throw new Error(`Invalid intent status "${String(status)}".`);
    }
    const current = await this.get(id);
    if (!current) throw new Error(`Intent "${id}" not found.`);
    if (current.status === status) return current;
    const updated: Intent = { ...current, status };
    await writeFileAtomic(this.getPath(id), serializeIntent(updated), { mode: 0o600 });
    if (status === 'archived') {
      await this.appendEvent({
        type: 'archived',
        intentId: id,
        timestamp: this.now().toISOString(),
        details: { previousStatus: current.status },
      });
    }
    return updated;
  }

  async appendEvent(event: IntentLedgerEvent): Promise<void> {
    await mkdir(this.intentsDir, { recursive: true });
    await appendFile(this.ledgerPath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  async recordChecked(intentId: string, details: Record<string, unknown>): Promise<void> {
    await this.appendEvent({
      type: 'checked',
      intentId,
      timestamp: this.now().toISOString(),
      details,
    });
  }

  async recordDrifted(intentId: string, details: Record<string, unknown>): Promise<void> {
    await this.appendEvent({
      type: 'drifted',
      intentId,
      timestamp: this.now().toISOString(),
      details,
    });
  }
}
