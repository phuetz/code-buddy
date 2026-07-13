import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { readPrivateMealJson, writePrivateMealJson } from './private-json-store.js';
import {
  cloneFoodProvenance,
  isOffsetTimestamp,
  isRecord,
  parseFoodProvenance,
  requireFoodProvenance,
  requireNonEmptyText,
  requireOffsetTimestamp,
} from './store-validation.js';
import type {
  EvidenceStatus,
  FoodInventoryItem,
  FoodProvenance,
} from './types.js';

const FOOD_INVENTORY_SCHEMA_VERSION = 1 as const;
const STORE_LABEL = 'food inventory store';
const ITEM_ID_RE = /^food_[0-9a-f-]{36}$/i;

export type FoodInventoryKind = FoodInventoryItem['kind'];

export interface StoredFoodInventoryItem extends FoodInventoryItem {
  createdAt: string;
  updatedAt: string;
}

export interface CreateFoodInventoryItem {
  name: string;
  kind: FoodInventoryKind;
  status: EvidenceStatus;
  provenance: FoodProvenance;
  quantity?: number;
  unit?: string;
  /** Absolute timestamp supplied by the caller. No shelf life is inferred. */
  availableUntil?: string;
}

export interface UpdateFoodInventoryItem {
  name?: string;
  kind?: FoodInventoryKind;
  status?: EvidenceStatus;
  provenance: FoodProvenance;
  quantity?: number | null;
  unit?: string | null;
  availableUntil?: string | null;
}

export interface FoodInventoryFilter {
  kind?: FoodInventoryKind;
  status?: EvidenceStatus;
}

interface PersistedFoodInventory {
  schemaVersion: typeof FOOD_INVENTORY_SCHEMA_VERSION;
  items: StoredFoodInventoryItem[];
}

export interface FoodInventoryStoreOptions {
  filePath?: string;
  now?: () => Date;
}

function defaultFilePath(): string {
  return path.join(homedir(), '.codebuddy', 'life', 'meals', 'food-inventory.json');
}

function isInventoryKind(value: unknown): value is FoodInventoryKind {
  return value === 'pantry' || value === 'leftover';
}

function isEvidenceStatus(value: unknown): value is EvidenceStatus {
  return value === 'confirmed' || value === 'unknown';
}

function validQuantityAndUnit(quantity: unknown, unit: unknown): boolean {
  if (quantity === undefined && unit === undefined) return true;
  return typeof quantity === 'number'
    && Number.isFinite(quantity)
    && quantity > 0
    && typeof unit === 'string'
    && unit.trim().length > 0
    && unit === unit.trim()
    && unit.length <= 40;
}

function parseItem(value: unknown): StoredFoodInventoryItem | null {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !ITEM_ID_RE.test(value.id)
    || typeof value.name !== 'string'
    || value.name.trim().length === 0
    || value.name !== value.name.trim()
    || value.name.length > 200
    || !isInventoryKind(value.kind)
    || !isEvidenceStatus(value.status)
    || !validQuantityAndUnit(value.quantity, value.unit)
    || (value.availableUntil !== undefined && !isOffsetTimestamp(value.availableUntil))
    || !isOffsetTimestamp(value.createdAt)
    || !isOffsetTimestamp(value.updatedAt)) {
    return null;
  }
  const provenance = parseFoodProvenance(value.provenance);
  if (!provenance) return null;
  return {
    id: value.id,
    name: value.name,
    kind: value.kind,
    status: value.status,
    provenance,
    ...(typeof value.quantity === 'number' ? { quantity: value.quantity } : {}),
    ...(typeof value.unit === 'string' ? { unit: value.unit } : {}),
    ...(typeof value.availableUntil === 'string' ? { availableUntil: value.availableUntil } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseEnvelope(value: unknown): PersistedFoodInventory | null {
  if (!isRecord(value)
    || value.schemaVersion !== FOOD_INVENTORY_SCHEMA_VERSION
    || !Array.isArray(value.items)) {
    return null;
  }
  const items = value.items.map(parseItem);
  if (items.some(item => item === null)) return null;
  const validItems = items as StoredFoodInventoryItem[];
  if (new Set(validItems.map(item => item.id)).size !== validItems.length) return null;
  return {
    schemaVersion: FOOD_INVENTORY_SCHEMA_VERSION,
    items: validItems,
  };
}

function cloneItem(item: StoredFoodInventoryItem): StoredFoodInventoryItem {
  return { ...item, provenance: cloneFoodProvenance(item.provenance) };
}

function validateKind(value: unknown): FoodInventoryKind {
  if (!isInventoryKind(value)) throw new RangeError(`Invalid inventory kind: ${String(value)}`);
  return value;
}

function validateStatus(value: unknown): EvidenceStatus {
  if (!isEvidenceStatus(value)) throw new RangeError(`Invalid inventory evidence status: ${String(value)}`);
  return value;
}

interface NormalizedInventoryInput {
  name: string;
  kind: FoodInventoryKind;
  status: EvidenceStatus;
  provenance: FoodProvenance;
  quantity?: number;
  unit?: string;
  availableUntil?: string;
}

function normalizeQuantity(
  quantity: number | undefined,
  unit: string | undefined,
): Pick<NormalizedInventoryInput, 'quantity' | 'unit'> {
  if (quantity === undefined && unit === undefined) return {};
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    throw new RangeError('quantity must be a positive finite number when provided.');
  }
  return {
    quantity,
    unit: requireNonEmptyText(unit, 'unit', 40),
  };
}

function normalizeCreateInput(input: CreateFoodInventoryItem): NormalizedInventoryInput {
  return {
    name: requireNonEmptyText(input.name, 'name', 200),
    kind: validateKind(input.kind),
    status: validateStatus(input.status),
    provenance: requireFoodProvenance(input.provenance),
    ...normalizeQuantity(input.quantity, input.unit),
    ...(input.availableUntil !== undefined
      ? { availableUntil: requireOffsetTimestamp(input.availableUntil, 'availableUntil') }
      : {}),
  };
}

export class FoodInventoryStore {
  readonly filePath: string;
  private readonly now: () => Date;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: FoodInventoryStoreOptions = {}) {
    this.filePath = path.resolve(options.filePath ?? defaultFilePath());
    this.now = options.now ?? (() => new Date());
  }

  async create(input: CreateFoodInventoryItem): Promise<StoredFoodInventoryItem> {
    const normalized = normalizeCreateInput(input);
    return this.enqueueMutation(async () => {
      const now = this.currentTime().toISOString();
      const item: StoredFoodInventoryItem = {
        id: `food_${randomUUID()}`,
        ...normalized,
        createdAt: now,
        updatedAt: now,
      };
      const items = await this.readItems();
      items.push(item);
      await this.writeItems(items);
      return cloneItem(item);
    });
  }

  async get(id: string): Promise<StoredFoodInventoryItem | null> {
    await this.mutationTail;
    const item = (await this.readItems()).find(candidate => candidate.id === id);
    return item ? cloneItem(item) : null;
  }

  async list(filter: FoodInventoryFilter = {}): Promise<StoredFoodInventoryItem[]> {
    await this.mutationTail;
    if (filter.kind !== undefined) validateKind(filter.kind);
    if (filter.status !== undefined) validateStatus(filter.status);
    return (await this.readItems())
      .filter(item => filter.kind === undefined || item.kind === filter.kind)
      .filter(item => filter.status === undefined || item.status === filter.status)
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .map(cloneItem);
  }

  /** List unexpired items without deleting expired evidence from the store. */
  async listActive(
    at?: Date | number,
    filter: FoodInventoryFilter = {},
  ): Promise<StoredFoodInventoryItem[]> {
    await this.mutationTail;
    const now = this.resolveTime(at);
    if (filter.kind !== undefined) validateKind(filter.kind);
    if (filter.status !== undefined) validateStatus(filter.status);
    return (await this.readItems())
      .filter(item => item.availableUntil === undefined || Date.parse(item.availableUntil) > now.getTime())
      .filter(item => filter.kind === undefined || item.kind === filter.kind)
      .filter(item => filter.status === undefined || item.status === filter.status)
      .sort((left, right) => {
        const leftExpiry = left.availableUntil ? Date.parse(left.availableUntil) : Number.POSITIVE_INFINITY;
        const rightExpiry = right.availableUntil ? Date.parse(right.availableUntil) : Number.POSITIVE_INFINITY;
        return leftExpiry - rightExpiry || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
      })
      .map(cloneItem);
  }

  async update(id: string, patch: UpdateFoodInventoryItem): Promise<StoredFoodInventoryItem | null> {
    const provenance = requireFoodProvenance(patch.provenance);
    return this.enqueueMutation(async () => {
      const items = await this.readItems();
      const index = items.findIndex(item => item.id === id);
      if (index < 0) return null;
      const current = items[index]!;

      const quantity = patch.quantity === undefined
        ? current.quantity
        : patch.quantity === null
          ? undefined
          : patch.quantity;
      const unit = patch.unit === undefined
        ? current.unit
        : patch.unit === null
          ? undefined
          : patch.unit;
      const availableUntil = patch.availableUntil === undefined
        ? current.availableUntil
        : patch.availableUntil === null
          ? undefined
          : requireOffsetTimestamp(patch.availableUntil, 'availableUntil');
      const normalized: NormalizedInventoryInput = {
        name: patch.name === undefined ? current.name : requireNonEmptyText(patch.name, 'name', 200),
        kind: patch.kind === undefined ? current.kind : validateKind(patch.kind),
        status: patch.status === undefined ? current.status : validateStatus(patch.status),
        provenance,
        ...normalizeQuantity(quantity, unit),
        ...(availableUntil ? { availableUntil } : {}),
      };
      const updated: StoredFoodInventoryItem = {
        id: current.id,
        ...normalized,
        createdAt: current.createdAt,
        updatedAt: this.currentTime().toISOString(),
      };
      items[index] = updated;
      await this.writeItems(items);
      return cloneItem(updated);
    });
  }

  async remove(id: string): Promise<StoredFoodInventoryItem | null> {
    return this.enqueueMutation(async () => {
      const items = await this.readItems();
      const index = items.findIndex(item => item.id === id);
      if (index < 0) return null;
      const [removed] = items.splice(index, 1);
      await this.writeItems(items);
      return removed ? cloneItem(removed) : null;
    });
  }

  private currentTime(): Date {
    return this.resolveTime(this.now());
  }

  private resolveTime(value?: Date | number): Date {
    const date = value === undefined
      ? this.now()
      : value instanceof Date
        ? new Date(value.getTime())
        : new Date(value);
    if (Number.isNaN(date.getTime())) throw new RangeError('Food inventory clock must be a valid instant.');
    return date;
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(operation, operation);
    this.mutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async readItems(): Promise<StoredFoodInventoryItem[]> {
    const envelope = await readPrivateMealJson(this.filePath, STORE_LABEL, parseEnvelope);
    return envelope?.items.map(cloneItem) ?? [];
  }

  private async writeItems(items: StoredFoodInventoryItem[]): Promise<void> {
    const envelope: PersistedFoodInventory = {
      schemaVersion: FOOD_INVENTORY_SCHEMA_VERSION,
      items: items.map(cloneItem),
    };
    await writePrivateMealJson(this.filePath, STORE_LABEL, envelope);
  }
}
