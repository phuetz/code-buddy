/**
 * Memory provider boundary.
 *
 * Hermes Agent supports pluggable memory providers (and user modeling à la
 * Honcho). Code Buddy keeps local SQLite/markdown as the default and durable
 * source of truth, but this boundary lets optional adapters (Mem0,
 * Honcho-style modeling, Supermemory) be swapped in without the agent loop
 * caring which implementation is active.
 *
 * Design rules (P3 acceptance: "changing provider does not affect the agent
 * loop"):
 *   - The default provider is `local`, wrapping the existing
 *     `PersistentMemoryManager`. Nothing changes for current callers.
 *   - The interface is async-friendly so a remote provider (network round-trip)
 *     can implement it; the local provider resolves synchronously.
 *   - Selection happens through the registry; the agent loop is untouched until
 *     it opts in.
 */

import type { Memory, MemoryCategory } from './persistent-memory.js';
import type { MemoryKind, MemoryProvenance } from './memory-provenance.js';
import { logger } from '../utils/logger.js';
import { LocalMemoryProvider } from './local-memory-provider.js';

export interface MemoryRememberOptions {
  scope?: 'project' | 'user';
  category?: MemoryCategory;
  tags?: string[];
  kind?: MemoryKind;
  provenance?: MemoryProvenance;
}

export interface MemoryProvider {
  /** Stable id, e.g. `local`, `mem0`, `honcho`. */
  readonly id: string;
  initialize(): Promise<void>;
  remember(key: string, value: string, options?: MemoryRememberOptions): Promise<void>;
  recall(key: string, scope?: 'project' | 'user'): Promise<string | null>;
  getRelevantMemories(query: string, limit?: number): Promise<Memory[]>;
  getContextForPrompt(): Promise<string>;
}

export { LocalMemoryProvider } from './local-memory-provider.js';

import {
  Mem0MemoryProvider,
  HonchoMemoryProvider,
  SupermemoryMemoryProvider,
  OpenVikingMemoryProvider,
  RetainDBMemoryProvider,
} from './adapters/network-memory-adapters.js';
import { ByteRoverMemoryProvider } from './adapters/cli-memory-adapters.js';

/**
 * Registry of memory providers. The agent and any caller resolve the active
 * provider through here; swapping providers never touches the agent loop.
 */
export class MemoryProviderRegistry {
  private providers = new Map<string, MemoryProvider>();
  private activeId = 'local';

  constructor() {
    this.register(new LocalMemoryProvider());
    this.register(new Mem0MemoryProvider());
    this.register(new HonchoMemoryProvider());
    this.register(new SupermemoryMemoryProvider());
    this.register(new OpenVikingMemoryProvider());
    this.register(new RetainDBMemoryProvider());
    this.register(new ByteRoverMemoryProvider());

    const envProvider = process.env.CODEBUDDY_MEMORY_PROVIDER;
    if (envProvider && this.has(envProvider)) {
      this.activeId = envProvider;
      logger.debug(`MemoryProviderRegistry: active provider set from environment: ${envProvider}`);
    }
  }

  register(provider: MemoryProvider): void {
    if (!provider.id) {
      throw new Error('MemoryProvider must have a non-empty id');
    }
    this.providers.set(provider.id, provider);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }

  /** Switch the active provider. Throws if the id was never registered. */
  setActive(id: string): void {
    if (!this.providers.has(id)) {
      throw new Error(`Unknown memory provider: ${id}. Registered: ${this.list().join(', ')}`);
    }
    this.activeId = id;
    logger.debug('MemoryProviderRegistry: active provider set', { id });
  }

  getActiveId(): string {
    return this.activeId;
  }

  getActive(): MemoryProvider {
    const provider = this.providers.get(this.activeId);
    if (!provider) {
      // Should never happen: 'local' is always registered.
      throw new Error(`Active memory provider missing: ${this.activeId}`);
    }
    return provider;
  }

  get(id: string): MemoryProvider | undefined {
    return this.providers.get(id);
  }
}

let _registry: MemoryProviderRegistry | null = null;

export function getMemoryProviderRegistry(): MemoryProviderRegistry {
  if (!_registry) {
    _registry = new MemoryProviderRegistry();
  }
  return _registry;
}

/** Convenience: the currently active provider (default `local`). */
export function getActiveMemoryProvider(): MemoryProvider {
  return getMemoryProviderRegistry().getActive();
}

export function resetMemoryProviderRegistry(): void {
  _registry = null;
}
