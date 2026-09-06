/**
 * Persisted « what matters » sheet. The pure functions above own the rules; this
 * binds them to a host's `KeyValueStore` so a companion can `remember` /
 * `recall` / `forget` across restarts without the core knowing where the bytes go.
 *
 * @module memory/store
 */

import type { Fact } from '../types.js';
import type { Clock } from '../runtime/clock.js';
import type { KeyValueStore } from '../runtime/store.js';
import { MemoryKeyValueStore } from '../runtime/store.js';
import {
  applySoftForgetting,
  forget as forgetFact,
  normalizeSheet,
  recall as recallFacts,
  remember as rememberFact,
  type RecallOptions,
  type RememberInput,
  type RememberResult,
} from './what-matters.js';

export interface WhatMattersOptions {
  store?: KeyValueStore;
  clock?: Clock;
  /** Storage key. Namespace it per user/companion in a multi-tenant host. */
  storageKey?: string;
  /** Run soft forgetting on every read (default true). */
  softForget?: boolean;
}

/** The `remember` / `recall` / `forget` surface, persisted. */
export class WhatMattersMemory {
  private readonly store: KeyValueStore;
  private readonly clock: Clock;
  private readonly storageKey: string;
  private readonly softForget: boolean;

  constructor(options: WhatMattersOptions = {}) {
    this.store = options.store ?? new MemoryKeyValueStore();
    this.clock = options.clock ?? (() => Date.now());
    this.storageKey = options.storageKey ?? 'companion:what-matters';
    this.softForget = options.softForget ?? true;
  }

  private async read(): Promise<Fact[]> {
    const raw = await this.store.get<unknown>(this.storageKey);
    const sheet = normalizeSheet(raw);
    return this.softForget ? applySoftForgetting(sheet, this.clock()) : sheet;
  }

  private async write(sheet: readonly Fact[]): Promise<void> {
    await this.store.set(this.storageKey, sheet);
  }

  /** Add or reconfirm a fact. A clinical claim is refused, not stored. */
  async remember(input: RememberInput): Promise<RememberResult> {
    const result = rememberFact(await this.read(), input, this.clock());
    await this.write(result.sheet);
    return result;
  }

  /** Read the sheet back, strongest first. */
  async recall(options: RecallOptions = {}): Promise<Fact[]> {
    return recallFacts(await this.read(), options);
  }

  /** Drop one fact for good. */
  async forget(key: string): Promise<Fact[]> {
    const sheet = forgetFact(await this.read(), key);
    await this.write(sheet);
    return sheet;
  }

  /** Empty the sheet — the host's « forget everything about me ». */
  async clear(): Promise<void> {
    await this.store.delete(this.storageKey);
  }
}
