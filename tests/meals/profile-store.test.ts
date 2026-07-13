import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  FoodProfileDecryptionError,
  FoodProfileKeyError,
  FoodProfileStore,
  LOCAL_KEY_FALLBACK_POLICY,
} from '../../src/meals/profile-store.js';
import type { FoodProfile, FoodProvenance } from '../../src/meals/types.js';

let tmpDir: string;

const provenance: FoodProvenance = {
  source: 'user',
  sourceId: 'explicit-food-settings',
  recordedAt: '2026-07-12T08:00:00.000Z',
  status: 'confirmed',
};

function makeProfile(): FoodProfile {
  return {
    schemaVersion: 1,
    id: 'private-food-profile',
    createdAt: '2026-07-12T08:00:00.000Z',
    updatedAt: '2026-07-12T08:00:00.000Z',
    constraints: [{
      id: 'confirmed-peanut-allergy',
      kind: 'allergy',
      effect: 'exclude',
      status: 'confirmed',
      target: { type: 'allergen', value: 'peanuts' },
      provenance,
    }],
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-meals-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('FoodProfileStore encryption', () => {
  it('round-trips through AES-256-GCM without persisting profile plaintext', async () => {
    const storePath = path.join(tmpDir, 'profile.enc.json');
    const store = new FoodProfileStore({
      storePath,
      localKeyPath: path.join(tmpDir, 'unused.key'),
      encryptionKey: 'correct horse battery staple meal key',
      now: () => new Date('2026-07-12T09:00:00.000Z'),
    });

    const saved = await store.save(makeProfile());
    const raw = fs.readFileSync(storePath, 'utf8');

    expect(saved.keySource).toBe('environment');
    expect(raw).toContain('aes-256-gcm');
    expect(raw).not.toContain('private-food-profile');
    expect(raw).not.toContain('confirmed-peanut-allergy');
    await expect(store.load()).resolves.toEqual(makeProfile());
  });

  it('fails authentication with the wrong environment secret', async () => {
    const storePath = path.join(tmpDir, 'profile.enc.json');
    const localKeyPath = path.join(tmpDir, 'unused.key');
    await new FoodProfileStore({
      storePath,
      localKeyPath,
      encryptionKey: 'the original encryption key is long enough',
    }).save(makeProfile());

    const wrongSecretStore = new FoodProfileStore({
      storePath,
      localKeyPath,
      encryptionKey: 'a different encryption key is long enough',
    });

    await expect(wrongSecretStore.load()).rejects.toBeInstanceOf(FoodProfileDecryptionError);
  });

  it('uses a private random local key when the environment key is absent', async () => {
    const storePath = path.join(tmpDir, 'life', 'profile.enc.json');
    const localKeyPath = path.join(tmpDir, 'life', 'meals.key');
    const store = new FoodProfileStore({ storePath, localKeyPath, encryptionKey: null });

    const saved = await store.save(makeProfile());

    expect(saved.keySource).toBe('local-key-file');
    expect(LOCAL_KEY_FALLBACK_POLICY.plaintextFallback).toBe(false);
    expect(LOCAL_KEY_FALLBACK_POLICY.machineDerivedFallback).toBe(false);
    expect(fs.statSync(localKeyPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(storePath).mode & 0o777).toBe(0o600);
    await expect(new FoodProfileStore({
      storePath,
      localKeyPath,
      encryptionKey: null,
    }).load()).resolves.toEqual(makeProfile());
  });

  it('fails closed when an existing local profile has lost its key', async () => {
    const storePath = path.join(tmpDir, 'profile.enc.json');
    const localKeyPath = path.join(tmpDir, 'meals.key');
    const store = new FoodProfileStore({ storePath, localKeyPath, encryptionKey: null });
    await store.save(makeProfile());
    fs.rmSync(localKeyPath);

    await expect(store.load()).rejects.toBeInstanceOf(FoodProfileKeyError);
    expect(fs.existsSync(localKeyPath)).toBe(false);
  });
});
