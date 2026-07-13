import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FoodInventoryStore } from '../../src/meals/food-inventory-store.js';
import { MealStoreCorruptionError } from '../../src/meals/private-json-store.js';
import type { FoodProvenance } from '../../src/meals/types.js';

let tmpDir: string;
let filePath: string;

function provenance(source: 'user' | 'pantry' | 'leftover', status: 'confirmed' | 'unknown' = 'confirmed'): FoodProvenance {
  return {
    source,
    sourceId: `${source}-test`,
    recordedAt: '2026-07-12T08:00:00.000Z',
    status,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'food-inventory-store-'));
  filePath = path.join(tmpDir, 'private', 'inventory.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('FoodInventoryStore', () => {
  it('supports CRUD for pantry and leftover items without allergen inference', async () => {
    let now = new Date('2026-07-12T08:00:00.000Z');
    const store = new FoodInventoryStore({ filePath, now: () => now });
    const created = await store.create({
      name: 'Cacahuètes au nom non vérifié',
      kind: 'pantry',
      status: 'unknown',
      quantity: 2,
      unit: 'paquets',
      provenance: provenance('pantry', 'unknown'),
    });

    expect(created).not.toHaveProperty('allergens');
    expect(created).not.toHaveProperty('allergenDisclosure');
    expect(await store.list({ status: 'unknown' })).toHaveLength(1);
    expect(fs.statSync(path.dirname(filePath)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);

    now = new Date('2026-07-12T09:00:00.000Z');
    const updated = await store.update(created.id, {
      status: 'confirmed',
      quantity: 1,
      unit: 'paquet',
      provenance: provenance('user'),
    });
    expect(updated?.status).toBe('confirmed');
    expect(updated?.quantity).toBe(1);
    expect(updated?.updatedAt).toBe('2026-07-12T09:00:00.000Z');

    await expect(store.remove(created.id)).resolves.toEqual(updated);
    await expect(store.get(created.id)).resolves.toBeNull();
  });

  it('filters expired items and preserves active leftovers', async () => {
    const store = new FoodInventoryStore({ filePath });
    await store.create({
      name: 'Soupe ancienne',
      kind: 'leftover',
      status: 'confirmed',
      availableUntil: '2026-07-12T10:00:00+02:00',
      provenance: provenance('leftover'),
    });
    const activeLeftover = await store.create({
      name: 'Riz cuit',
      kind: 'leftover',
      status: 'confirmed',
      availableUntil: '2026-07-13T10:00:00+02:00',
      provenance: provenance('leftover'),
    });
    await store.create({
      name: 'Pâtes sèches',
      kind: 'pantry',
      status: 'unknown',
      provenance: provenance('pantry', 'unknown'),
    });

    const active = await store.listActive(
      new Date('2026-07-12T08:00:00.000Z'),
    );
    const leftovers = await store.listActive(
      new Date('2026-07-12T08:00:00.000Z'),
      { kind: 'leftover', status: 'confirmed' },
    );

    // Expiration at the exact comparison instant is no longer active.
    expect(active.map(item => item.name)).toEqual(['Riz cuit', 'Pâtes sèches']);
    expect(leftovers.map(item => item.id)).toEqual([activeLeftover.id]);
    expect(await store.list()).toHaveLength(3);
  });

  it('requires an unambiguous expiration timestamp', async () => {
    const store = new FoodInventoryStore({ filePath });
    await expect(store.create({
      name: 'Reste',
      kind: 'leftover',
      status: 'confirmed',
      availableUntil: '2026-07-13',
      provenance: provenance('leftover'),
    })).rejects.toThrow(/explicit UTC offset/);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('fails closed on corrupt inventory data', async () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, items: [{ bad: true }] }), { mode: 0o600 });
    const store = new FoodInventoryStore({ filePath });

    await expect(store.listActive()).rejects.toBeInstanceOf(MealStoreCorruptionError);
    await expect(store.create({
      name: 'Riz',
      kind: 'pantry',
      status: 'confirmed',
      provenance: provenance('pantry'),
    })).rejects.toBeInstanceOf(MealStoreCorruptionError);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({
      schemaVersion: 1,
      items: [{ bad: true }],
    });
  });
});
