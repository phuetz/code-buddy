/**
 * Identity Links
 *
 * OpenClaw-inspired cross-channel identity system.
 *
 * Collapses sessions from the same person across different channels
 * into one canonical identity. For example, if a user messages via
 * both Telegram and Discord, their sessions can be linked.
 *
 * Usage:
 * ```typescript
 * const identities = getIdentityLinker();
 *
 * // Link two channel identities
 * identities.link(
 *   { channelType: 'telegram', peerId: '12345' },
 *   { channelType: 'discord', peerId: 'user#6789' }
 * );
 *
 * // Resolve canonical identity
 * const canonical = identities.resolve({ channelType: 'telegram', peerId: '12345' });
 * // Returns the canonical identity that includes both telegram and discord
 * ```
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import type { ChannelType } from './index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A channel-specific identity reference
 */
export interface ChannelIdentity {
  /** Channel type */
  channelType: ChannelType;
  /** Peer/user ID on that channel */
  peerId: string;
  /** Optional display name */
  displayName?: string;
  /** When this identity was first seen */
  firstSeen?: Date;
  /** When this identity was last seen */
  lastSeen?: Date;
}

/**
 * A canonical identity that may span multiple channels
 */
export interface CanonicalIdentity {
  /** Unique canonical identity ID */
  id: string;
  /** Display name for this identity */
  name: string;
  /** All linked channel identities */
  identities: ChannelIdentity[];
  /** When this canonical identity was created */
  createdAt: Date;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** Tags for categorization */
  tags?: string[];
}

/**
 * Identity linker configuration
 */
export interface IdentityLinkerConfig {
  /** Path to persist identity links */
  persistPath?: string;
  /** Auto-persist on changes */
  autoPersist: boolean;
  /** Maximum identities to track */
  maxIdentities: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_IDENTITY_CONFIG: IdentityLinkerConfig = {
  autoPersist: true,
  maxIdentities: 10000,
};

// ============================================================================
// Identity Linker
// ============================================================================

export class IdentityLinker extends EventEmitter {
  private config: IdentityLinkerConfig;
  private canonicals: Map<string, CanonicalIdentity> = new Map();
  /** Maps "channelType:peerId" -> canonical ID */
  private lookupIndex: Map<string, string> = new Map();
  private idCounter = 0;
  private dirty = false;

  constructor(config: Partial<IdentityLinkerConfig> = {}) {
    super();
    this.config = {
      ...DEFAULT_IDENTITY_CONFIG,
      ...config,
      persistPath: config.persistPath ??
        path.join(homedir(), '.codebuddy', 'identity-links.json'),
    };
  }

  // ==========================================================================
  // Identity Resolution
  // ==========================================================================

  /**
   * Resolve a channel identity to its canonical identity.
   * Returns null if no canonical identity exists for this peer.
   */
  resolve(identity: Pick<ChannelIdentity, 'channelType' | 'peerId'>): CanonicalIdentity | null {
    const key = this.makeKey(identity.channelType, identity.peerId);
    const canonicalId = this.lookupIndex.get(key);
    if (!canonicalId) return null;
    return this.canonicals.get(canonicalId) ?? null;
  }

  /**
   * Resolve or create a canonical identity for a channel identity.
   */
  resolveOrCreate(identity: ChannelIdentity): CanonicalIdentity {
    const existing = this.resolve(identity);
    if (existing) {
      // Update last seen
      const linked = existing.identities.find(
        i => i.channelType === identity.channelType && i.peerId === identity.peerId
      );
      if (linked) {
        linked.lastSeen = new Date();
        if (identity.displayName) linked.displayName = identity.displayName;
      }
      return existing;
    }

    // Create new canonical identity
    const canonical: CanonicalIdentity = {
      id: `identity-${++this.idCounter}`,
      name: identity.displayName || `${identity.channelType}:${identity.peerId}`,
      identities: [{
        ...identity,
        firstSeen: identity.firstSeen ?? new Date(),
        lastSeen: new Date(),
      }],
      createdAt: new Date(),
    };

    this.canonicals.set(canonical.id, canonical);
    this.lookupIndex.set(this.makeKey(identity.channelType, identity.peerId), canonical.id);
    this.dirty = true;

    this.emit('identity:created', canonical);
    this.autoPersist();

    return canonical;
  }

  // ==========================================================================
  // Linking
  // ==========================================================================

  /**
   * Link two channel identities together.
   * If both already have canonical identities, they are merged.
   * If one has a canonical identity, the other is added to it.
   * If neither has one, a new canonical identity is created for both.
   */
  link(
    identity1: ChannelIdentity,
    identity2: ChannelIdentity,
    name?: string
  ): CanonicalIdentity {
    const canonical1 = this.resolve(identity1);
    const canonical2 = this.resolve(identity2);

    if (canonical1 && canonical2) {
      if (canonical1.id === canonical2.id) {
        return canonical1; // Already linked
      }
      // Merge canonical2 into canonical1
      return this.mergeCanonicals(canonical1, canonical2);
    }

    if (canonical1) {
      return this.addToCanonical(canonical1, identity2);
    }

    if (canonical2) {
      return this.addToCanonical(canonical2, identity1);
    }

    // Create new canonical with both identities
    const canonical: CanonicalIdentity = {
      id: `identity-${++this.idCounter}`,
      name: name || identity1.displayName || identity2.displayName ||
        `${identity1.channelType}:${identity1.peerId}`,
      identities: [
        { ...identity1, firstSeen: new Date(), lastSeen: new Date() },
        { ...identity2, firstSeen: new Date(), lastSeen: new Date() },
      ],
      createdAt: new Date(),
    };

    this.canonicals.set(canonical.id, canonical);
    this.lookupIndex.set(this.makeKey(identity1.channelType, identity1.peerId), canonical.id);
    this.lookupIndex.set(this.makeKey(identity2.channelType, identity2.peerId), canonical.id);
    this.dirty = true;

    this.emit('identity:linked', canonical, identity1, identity2);
    this.autoPersist();

    return canonical;
  }

  /**
   * Unlink a channel identity from its canonical identity
   */
  unlink(identity: Pick<ChannelIdentity, 'channelType' | 'peerId'>): boolean {
    const key = this.makeKey(identity.channelType, identity.peerId);
    const canonicalId = this.lookupIndex.get(key);
    if (!canonicalId) return false;

    const canonical = this.canonicals.get(canonicalId);
    if (!canonical) return false;

    canonical.identities = canonical.identities.filter(
      i => !(i.channelType === identity.channelType && i.peerId === identity.peerId)
    );
    this.lookupIndex.delete(key);

    // If only one identity left, keep it; if none, remove canonical
    if (canonical.identities.length === 0) {
      this.canonicals.delete(canonicalId);
    }

    this.dirty = true;
    this.emit('identity:unlinked', canonicalId, identity);
    this.autoPersist();

    return true;
  }

  // ==========================================================================
  // Query
  // ==========================================================================

  /**
   * Get all canonical identities
   */
  listAll(): CanonicalIdentity[] {
    return Array.from(this.canonicals.values());
  }

  /**
   * Get canonical identity by ID
   */
  get(id: string): CanonicalIdentity | undefined {
    return this.canonicals.get(id);
  }

  /**
   * Find identities by display name
   */
  findByName(name: string): CanonicalIdentity[] {
    const lower = name.toLowerCase();
    return Array.from(this.canonicals.values()).filter(c =>
      c.name.toLowerCase().includes(lower) ||
      c.identities.some(i => i.displayName?.toLowerCase().includes(lower))
    );
  }

  /**
   * Check if two channel identities are the same person
   */
  areSamePerson(
    identity1: Pick<ChannelIdentity, 'channelType' | 'peerId'>,
    identity2: Pick<ChannelIdentity, 'channelType' | 'peerId'>
  ): boolean {
    const c1 = this.resolve(identity1);
    const c2 = this.resolve(identity2);
    if (!c1 || !c2) return false;
    return c1.id === c2.id;
  }

  /**
   * Get all channel identities for a peer (across channels)
   */
  getAllIdentitiesForPeer(
    identity: Pick<ChannelIdentity, 'channelType' | 'peerId'>
  ): ChannelIdentity[] {
    const canonical = this.resolve(identity);
    if (!canonical) return [];
    return [...canonical.identities];
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  /**
   * Merge two canonical identities
   */
  private mergeCanonicals(
    target: CanonicalIdentity,
    source: CanonicalIdentity
  ): CanonicalIdentity {
    // Move all source identities to target
    for (const identity of source.identities) {
      const key = this.makeKey(identity.channelType, identity.peerId);
      this.lookupIndex.set(key, target.id);
      if (!target.identities.some(
        i => i.channelType === identity.channelType && i.peerId === identity.peerId
      )) {
        target.identities.push(identity);
      }
    }

    // Merge metadata
    if (source.metadata) {
      target.metadata = { ...target.metadata, ...source.metadata };
    }

    // Remove source canonical
    this.canonicals.delete(source.id);
    this.dirty = true;

    this.emit('identity:merged', target, source);
    this.autoPersist();

    return target;
  }

  /**
   * Add a channel identity to an existing canonical
   */
  private addToCanonical(
    canonical: CanonicalIdentity,
    identity: ChannelIdentity
  ): CanonicalIdentity {
    const key = this.makeKey(identity.channelType, identity.peerId);
    this.lookupIndex.set(key, canonical.id);

    if (!canonical.identities.some(
      i => i.channelType === identity.channelType && i.peerId === identity.peerId
    )) {
      canonical.identities.push({
        ...identity,
        firstSeen: new Date(),
        lastSeen: new Date(),
      });
    }

    this.dirty = true;
    this.emit('identity:added', canonical, identity);
    this.autoPersist();

    return canonical;
  }

  /**
   * Make lookup key from channel type and peer ID
   */
  private makeKey(channelType: ChannelType, peerId: string): string {
    return `${channelType}:${peerId}`;
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Auto-persist if enabled
   */
  private autoPersist(): void {
    if (this.config.autoPersist && this.dirty) {
      this.persist().catch(() => {});
    }
  }

  /**
   * Persist identity links to disk
   */
  async persist(): Promise<void> {
    if (!this.config.persistPath) return;

    const data = {
      version: 1,
      idCounter: this.idCounter,
      identities: Array.from(this.canonicals.values()),
    };

    const dir = path.dirname(this.config.persistPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.config.persistPath, JSON.stringify(data, null, 2));
    this.dirty = false;
  }

  /**
   * Load identity links from disk
   */
  async load(): Promise<void> {
    if (!this.config.persistPath) return;

    try {
      const content = await fs.readFile(this.config.persistPath, 'utf-8');
      const data = JSON.parse(content) as {
        version: number;
        idCounter: number;
        identities: CanonicalIdentity[];
      };

      this.idCounter = data.idCounter || 0;
      this.canonicals.clear();
      this.lookupIndex.clear();

      for (const canonical of data.identities) {
        canonical.createdAt = new Date(canonical.createdAt);
        for (const id of canonical.identities) {
          if (id.firstSeen) id.firstSeen = new Date(id.firstSeen);
          if (id.lastSeen) id.lastSeen = new Date(id.lastSeen);
        }

        this.canonicals.set(canonical.id, canonical);
        for (const identity of canonical.identities) {
          this.lookupIndex.set(
            this.makeKey(identity.channelType, identity.peerId),
            canonical.id
          );
        }
      }

      this.dirty = false;
    } catch {
      // File doesn't exist yet, that's OK
    }
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  getStats(): {
    totalCanonical: number;
    totalLinked: number;
    multiChannelCount: number;
    channelDistribution: Record<string, number>;
  } {
    const channelDistribution: Record<string, number> = {};
    let totalLinked = 0;
    let multiChannelCount = 0;

    for (const canonical of this.canonicals.values()) {
      totalLinked += canonical.identities.length;
      if (canonical.identities.length > 1) multiChannelCount++;

      for (const id of canonical.identities) {
        channelDistribution[id.channelType] =
          (channelDistribution[id.channelType] || 0) + 1;
      }
    }

    return {
      totalCanonical: this.canonicals.size,
      totalLinked,
      multiChannelCount,
      channelDistribution,
    };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  dispose(): void {
    this.canonicals.clear();
    this.lookupIndex.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let linkerInstance: IdentityLinker | null = null;

export function getIdentityLinker(config?: Partial<IdentityLinkerConfig>): IdentityLinker {
  if (!linkerInstance) {
    linkerInstance = new IdentityLinker(config);
  }
  return linkerInstance;
}

export function resetIdentityLinker(): void {
  if (linkerInstance) {
    linkerInstance.dispose();
  }
  linkerInstance = null;
}
