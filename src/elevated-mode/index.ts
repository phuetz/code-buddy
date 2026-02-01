/**
 * Elevated Mode Module
 *
 * Permission management for elevated/privileged operations.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export type PermissionLevel = 'user' | 'elevated' | 'admin' | 'system';

export type PermissionCategory =
  | 'file:read'
  | 'file:write'
  | 'file:delete'
  | 'file:execute'
  | 'process:spawn'
  | 'process:kill'
  | 'network:connect'
  | 'network:listen'
  | 'network:modify'
  | 'system:info'
  | 'system:modify'
  | 'system:shutdown'
  | 'credential:read'
  | 'credential:write';

export interface Permission {
  /** Permission category */
  category: PermissionCategory;
  /** Resource pattern (glob) */
  resource?: string;
  /** Required level */
  level: PermissionLevel;
  /** Description */
  description?: string;
}

export interface PermissionRequest {
  /** Unique request ID */
  id: string;
  /** Requested permission */
  permission: Permission;
  /** Requesting context */
  context: {
    /** Source (tool name, etc.) */
    source: string;
    /** Reason for request */
    reason?: string;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
  };
  /** Request timestamp */
  timestamp: Date;
  /** Timeout in ms */
  timeoutMs?: number;
}

export interface PermissionGrant {
  /** Grant ID */
  id: string;
  /** Associated request ID */
  requestId: string;
  /** Granted permission */
  permission: Permission;
  /** Grant type */
  type: 'allow-once' | 'allow-session' | 'allow-always' | 'deny';
  /** Expiration timestamp */
  expiresAt?: Date;
  /** Grant timestamp */
  grantedAt: Date;
  /** Who granted (user, auto, etc.) */
  grantedBy: string;
}

export interface ElevatedSession {
  /** Session ID */
  id: string;
  /** Current permission level */
  level: PermissionLevel;
  /** Elevated since */
  elevatedAt?: Date;
  /** Elevation expires at */
  expiresAt?: Date;
  /** Granted permissions */
  grants: Map<string, PermissionGrant>;
  /** Request history */
  requestHistory: PermissionRequest[];
}

export interface ElevatedModeConfig {
  /** Default permission level */
  defaultLevel: PermissionLevel;
  /** Session elevation timeout (ms) */
  elevationTimeoutMs: number;
  /** Auto-grant safe permissions */
  autoGrantSafe: boolean;
  /** Request timeout (ms) */
  requestTimeoutMs: number;
  /** Require confirmation for elevated */
  requireConfirmation: boolean;
  /** Safe permission categories */
  safeCategories: PermissionCategory[];
  /** Dangerous permission categories */
  dangerousCategories: PermissionCategory[];
  /** Max grants per session */
  maxGrantsPerSession: number;
}

export const DEFAULT_ELEVATED_CONFIG: ElevatedModeConfig = {
  defaultLevel: 'user',
  elevationTimeoutMs: 30 * 60 * 1000, // 30 minutes
  autoGrantSafe: true,
  requestTimeoutMs: 60000, // 1 minute
  requireConfirmation: true,
  safeCategories: ['file:read', 'system:info'],
  dangerousCategories: ['system:modify', 'system:shutdown', 'credential:write'],
  maxGrantsPerSession: 100,
};

export interface ElevatedModeEvents {
  'permission-request': (request: PermissionRequest) => void;
  'permission-grant': (grant: PermissionGrant) => void;
  'permission-deny': (request: PermissionRequest, reason: string) => void;
  'level-change': (from: PermissionLevel, to: PermissionLevel) => void;
  'session-expire': (session: ElevatedSession) => void;
  'grant-expire': (grant: PermissionGrant) => void;
}

// ============================================================================
// Permission Utilities
// ============================================================================

const LEVEL_HIERARCHY: PermissionLevel[] = ['user', 'elevated', 'admin', 'system'];

/**
 * Compare permission levels
 */
export function compareLevels(a: PermissionLevel, b: PermissionLevel): number {
  return LEVEL_HIERARCHY.indexOf(a) - LEVEL_HIERARCHY.indexOf(b);
}

/**
 * Check if level meets requirement
 */
export function meetsLevel(current: PermissionLevel, required: PermissionLevel): boolean {
  return compareLevels(current, required) >= 0;
}

/**
 * Check if permission matches a pattern
 */
export function matchesPattern(resource: string, pattern: string): boolean {
  // Simple glob matching
  const regex = new RegExp(
    '^' +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.') +
    '$'
  );
  return regex.test(resource);
}

/**
 * Create a permission key
 */
export function permissionKey(permission: Permission): string {
  return `${permission.category}:${permission.resource || '*'}`;
}

// ============================================================================
// Elevated Mode Manager
// ============================================================================

export class ElevatedModeManager extends EventEmitter {
  private config: ElevatedModeConfig;
  private session: ElevatedSession;
  private pendingRequests: Map<string, {
    request: PermissionRequest;
    resolve: (grant: PermissionGrant | null) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private expirationTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<ElevatedModeConfig> = {}) {
    super();
    this.config = { ...DEFAULT_ELEVATED_CONFIG, ...config };
    this.session = this.createSession();
  }

  private createSession(): ElevatedSession {
    return {
      id: crypto.randomUUID(),
      level: this.config.defaultLevel,
      grants: new Map(),
      requestHistory: [],
    };
  }

  // ============================================================================
  // Permission Checking
  // ============================================================================

  /**
   * Check if permission is granted
   */
  hasPermission(permission: Permission): boolean {
    // Check level
    if (meetsLevel(this.session.level, permission.level)) {
      return true;
    }

    // Check grants
    const key = permissionKey(permission);
    const grant = this.session.grants.get(key);

    if (grant && grant.type !== 'deny') {
      // Check expiration
      if (grant.expiresAt && grant.expiresAt < new Date()) {
        this.session.grants.delete(key);
        this.emit('grant-expire', grant);
        return false;
      }
      return true;
    }

    // Check pattern matches
    for (const [_, existingGrant] of this.session.grants) {
      if (
        existingGrant.permission.category === permission.category &&
        existingGrant.permission.resource &&
        permission.resource &&
        matchesPattern(permission.resource, existingGrant.permission.resource) &&
        existingGrant.type !== 'deny'
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if permission is safe (auto-grantable)
   */
  isSafePermission(permission: Permission): boolean {
    return this.config.safeCategories.includes(permission.category);
  }

  /**
   * Check if permission is dangerous
   */
  isDangerousPermission(permission: Permission): boolean {
    return this.config.dangerousCategories.includes(permission.category);
  }

  // ============================================================================
  // Permission Requests
  // ============================================================================

  /**
   * Request a permission
   */
  async requestPermission(
    category: PermissionCategory,
    options?: {
      resource?: string;
      reason?: string;
      source?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<PermissionGrant | null> {
    const permission: Permission = {
      category,
      resource: options?.resource,
      level: this.getRequiredLevel(category),
    };

    // Already have permission?
    if (this.hasPermission(permission)) {
      const key = permissionKey(permission);
      const existing = this.session.grants.get(key);
      if (existing) return existing;

      // Create implicit grant
      return this.createGrant(permission, 'allow-session', 'implicit');
    }

    // Auto-grant safe permissions
    if (this.config.autoGrantSafe && this.isSafePermission(permission)) {
      return this.createGrant(permission, 'allow-session', 'auto');
    }

    // Create request
    const request: PermissionRequest = {
      id: crypto.randomUUID(),
      permission,
      context: {
        source: options?.source || 'unknown',
        reason: options?.reason,
        metadata: options?.metadata,
      },
      timestamp: new Date(),
      timeoutMs: this.config.requestTimeoutMs,
    };

    this.session.requestHistory.push(request);
    this.emit('permission-request', request);

    // Return promise that resolves when granted/denied
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        this.emit('permission-deny', request, 'Request timed out');
        resolve(null);
      }, this.config.requestTimeoutMs);

      this.pendingRequests.set(request.id, { request, resolve, timeout });
    });
  }

  /**
   * Grant a pending request
   */
  grantRequest(
    requestId: string,
    type: 'allow-once' | 'allow-session' | 'allow-always' = 'allow-session',
    grantedBy = 'user'
  ): PermissionGrant | null {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return null;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);

    const grant = this.createGrant(
      pending.request.permission,
      type,
      grantedBy,
      pending.request.id
    );

    pending.resolve(grant);
    return grant;
  }

  /**
   * Deny a pending request
   */
  denyRequest(requestId: string, reason = 'Denied by user'): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);

    this.emit('permission-deny', pending.request, reason);
    pending.resolve(null);
  }

  /**
   * Create a grant
   */
  private createGrant(
    permission: Permission,
    type: PermissionGrant['type'],
    grantedBy: string,
    requestId?: string
  ): PermissionGrant {
    const grant: PermissionGrant = {
      id: crypto.randomUUID(),
      requestId: requestId || '',
      permission,
      type,
      grantedAt: new Date(),
      grantedBy,
    };

    // Set expiration for session grants
    if (type === 'allow-session' && this.session.expiresAt) {
      grant.expiresAt = this.session.expiresAt;
    }

    // Store grant (unless deny or once)
    if (type !== 'deny' && type !== 'allow-once') {
      // Check max grants
      if (this.session.grants.size >= this.config.maxGrantsPerSession) {
        // Remove oldest grant
        const oldest = Array.from(this.session.grants.values())
          .sort((a, b) => a.grantedAt.getTime() - b.grantedAt.getTime())[0];
        if (oldest) {
          this.session.grants.delete(permissionKey(oldest.permission));
        }
      }

      this.session.grants.set(permissionKey(permission), grant);
    }

    this.emit('permission-grant', grant);
    return grant;
  }

  /**
   * Get required level for a category
   */
  private getRequiredLevel(category: PermissionCategory): PermissionLevel {
    if (this.config.dangerousCategories.includes(category)) {
      return 'admin';
    }
    if (this.config.safeCategories.includes(category)) {
      return 'user';
    }
    return 'elevated';
  }

  // ============================================================================
  // Level Management
  // ============================================================================

  /**
   * Get current permission level
   */
  getLevel(): PermissionLevel {
    // Check if elevation expired
    if (this.session.expiresAt && this.session.expiresAt < new Date()) {
      this.dropElevation();
    }
    return this.session.level;
  }

  /**
   * Elevate to a higher level
   */
  elevate(level: PermissionLevel, durationMs?: number): boolean {
    if (compareLevels(level, this.session.level) <= 0) {
      return false; // Already at or above requested level
    }

    const previousLevel = this.session.level;
    this.session.level = level;
    this.session.elevatedAt = new Date();
    this.session.expiresAt = new Date(
      Date.now() + (durationMs || this.config.elevationTimeoutMs)
    );

    // Set expiration timer
    if (this.expirationTimer) {
      clearTimeout(this.expirationTimer);
    }
    this.expirationTimer = setTimeout(() => {
      this.dropElevation();
    }, durationMs || this.config.elevationTimeoutMs);

    this.emit('level-change', previousLevel, level);
    return true;
  }

  /**
   * Drop elevation back to default
   */
  dropElevation(): void {
    if (this.expirationTimer) {
      clearTimeout(this.expirationTimer);
      this.expirationTimer = null;
    }

    const previousLevel = this.session.level;
    this.session.level = this.config.defaultLevel;
    this.session.elevatedAt = undefined;
    this.session.expiresAt = undefined;

    // Clear session grants
    const toRemove: string[] = [];
    for (const [key, grant] of this.session.grants) {
      if (grant.type === 'allow-session') {
        toRemove.push(key);
        this.emit('grant-expire', grant);
      }
    }
    toRemove.forEach(key => this.session.grants.delete(key));

    if (previousLevel !== this.config.defaultLevel) {
      this.emit('level-change', previousLevel, this.config.defaultLevel);
    }
  }

  /**
   * Check if elevated
   */
  isElevated(): boolean {
    return compareLevels(this.getLevel(), 'user') > 0;
  }

  /**
   * Get time until elevation expires
   */
  getElevationTimeRemaining(): number {
    if (!this.session.expiresAt) return 0;
    return Math.max(0, this.session.expiresAt.getTime() - Date.now());
  }

  // ============================================================================
  // Grant Management
  // ============================================================================

  /**
   * Get all grants
   */
  getGrants(): PermissionGrant[] {
    return Array.from(this.session.grants.values());
  }

  /**
   * Revoke a grant
   */
  revokeGrant(grantId: string): boolean {
    for (const [key, grant] of this.session.grants) {
      if (grant.id === grantId) {
        this.session.grants.delete(key);
        this.emit('grant-expire', grant);
        return true;
      }
    }
    return false;
  }

  /**
   * Revoke all grants for a category
   */
  revokeCategory(category: PermissionCategory): number {
    let count = 0;
    const toRemove: string[] = [];

    for (const [key, grant] of this.session.grants) {
      if (grant.permission.category === category) {
        toRemove.push(key);
        this.emit('grant-expire', grant);
        count++;
      }
    }

    toRemove.forEach(key => this.session.grants.delete(key));
    return count;
  }

  /**
   * Clear all grants
   */
  clearGrants(): void {
    for (const grant of this.session.grants.values()) {
      this.emit('grant-expire', grant);
    }
    this.session.grants.clear();
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Get session info
   */
  getSession(): {
    id: string;
    level: PermissionLevel;
    elevatedAt?: Date;
    expiresAt?: Date;
    grantCount: number;
    requestCount: number;
    pendingCount: number;
  } {
    return {
      id: this.session.id,
      level: this.getLevel(),
      elevatedAt: this.session.elevatedAt,
      expiresAt: this.session.expiresAt,
      grantCount: this.session.grants.size,
      requestCount: this.session.requestHistory.length,
      pendingCount: this.pendingRequests.size,
    };
  }

  /**
   * Get request history
   */
  getRequestHistory(): PermissionRequest[] {
    return [...this.session.requestHistory];
  }

  /**
   * Reset session
   */
  resetSession(): void {
    // Cancel pending requests
    for (const [_, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.resolve(null);
    }
    this.pendingRequests.clear();

    // Clear timers
    if (this.expirationTimer) {
      clearTimeout(this.expirationTimer);
      this.expirationTimer = null;
    }

    // Create new session
    const oldSession = this.session;
    this.session = this.createSession();

    this.emit('session-expire', oldSession);
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Get configuration
   */
  getConfig(): ElevatedModeConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ElevatedModeConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let elevatedModeInstance: ElevatedModeManager | null = null;

export function getElevatedMode(config?: Partial<ElevatedModeConfig>): ElevatedModeManager {
  if (!elevatedModeInstance) {
    elevatedModeInstance = new ElevatedModeManager(config);
  }
  return elevatedModeInstance;
}

export function resetElevatedMode(): void {
  if (elevatedModeInstance) {
    elevatedModeInstance.resetSession();
    elevatedModeInstance = null;
  }
}
