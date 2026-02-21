/**
 * Scoped Authorization Manager
 *
 * Enterprise-grade permission model for channel interactions.
 * Supports tiered scopes, secret handles, temporary access, and double confirmation.
 * Channel-agnostic - works with any channel adapter.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import os from 'os';
import { randomBytes } from 'crypto';
import type {
  AuthScope,
  AuthDecision,
  ScopedPermission,
  SecretHandle,
  PendingConfirm,
  TemporaryAccess,
  ScopeCheckContext,
} from './types.js';
import { SCOPE_LEVEL } from './types.js';

/** Persisted auth state */
interface AuthState {
  permissions: ScopedPermission[];
  secrets: SecretHandle[];
  temporaryAccess: TemporaryAccess[];
}

/**
 * Manages scoped authorization for channel users.
 */
export class ScopedAuthManager {
  private permissions: Map<string, ScopedPermission> = new Map();
  private secrets: Map<string, SecretHandle> = new Map();
  private temporaryAccess: Map<string, TemporaryAccess> = new Map();
  private pendingConfirms: Map<string, PendingConfirm> = new Map();
  private configPath: string;
  private adminUsers: Set<string>;

  /** Confirmation timeout in ms (default 2 minutes) */
  private confirmTimeoutMs = 120_000;

  constructor(adminUsers: string[] = [], configDir?: string) {
    const dir = configDir || join(os.homedir(), '.codebuddy');
    this.configPath = join(dir, 'channel-scoped-auth.json');
    this.adminUsers = new Set(adminUsers);
    this.load();
  }

  /**
   * Check if a user has the required scope
   */
  checkScope(userId: string, scope: AuthScope, context?: ScopeCheckContext): AuthDecision {
    if (this.adminUsers.has(userId)) {
      return { allowed: true };
    }

    const tempAccess = this.temporaryAccess.get(userId);
    if (tempAccess && Date.now() < tempAccess.expiresAt) {
      return { allowed: true };
    }

    if (tempAccess && Date.now() >= tempAccess.expiresAt) {
      this.temporaryAccess.delete(userId);
      this.save();
    }

    const perm = this.permissions.get(userId);
    if (!perm) {
      return {
        allowed: false,
        reason: 'No permissions configured for this user',
        requiredScope: scope,
      };
    }

    if (perm.expiresAt && new Date(perm.expiresAt).getTime() < Date.now()) {
      return {
        allowed: false,
        reason: 'Permissions have expired',
        requiredScope: scope,
      };
    }

    const hasScope = perm.scopes.some(
      (s) => SCOPE_LEVEL[s] >= SCOPE_LEVEL[scope]
    );

    if (!hasScope) {
      return {
        allowed: false,
        reason: `Requires '${scope}' scope`,
        requiredScope: scope,
        userScopes: perm.scopes,
      };
    }

    if (context?.command && perm.denyCommands.length > 0) {
      const denied = perm.denyCommands.some((pattern) => {
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          return regex.test(context.command!);
        }
        return context.command === pattern;
      });
      if (denied) {
        return {
          allowed: false,
          reason: `Command '${context.command}' is denied`,
          requiredScope: scope,
          userScopes: perm.scopes,
        };
      }
    }

    if (context?.repo && perm.repos.length > 0) {
      const repoAllowed = perm.repos.some((pattern) => {
        if (pattern === '*') return true;
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          return regex.test(context.repo!);
        }
        return context.repo === pattern;
      });
      if (!repoAllowed) {
        return {
          allowed: false,
          reason: `Repo '${context.repo}' not in allowed list`,
          requiredScope: scope,
          userScopes: perm.scopes,
        };
      }
    }

    if (context?.folder && perm.folders.length > 0) {
      const folderAllowed = perm.folders.some((pattern) => {
        if (pattern === '*' || pattern === '**') return true;
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
          return regex.test(context.folder!);
        }
        return context.folder!.startsWith(pattern);
      });
      if (!folderAllowed) {
        return {
          allowed: false,
          reason: `Folder '${context.folder}' not in allowed list`,
          requiredScope: scope,
          userScopes: perm.scopes,
        };
      }
    }

    return { allowed: true, userScopes: perm.scopes };
  }

  /**
   * Grant scopes to a user
   */
  grantScope(
    userId: string,
    scopes: AuthScope[],
    options?: {
      repos?: string[];
      folders?: string[];
      denyCommands?: string[];
      ttlMs?: number;
      grantedBy?: string;
    }
  ): ScopedPermission {
    const perm: ScopedPermission = {
      userId,
      scopes,
      repos: options?.repos || ['*'],
      folders: options?.folders || ['**'],
      denyCommands: options?.denyCommands || [],
      grantedAt: new Date().toISOString(),
      grantedBy: options?.grantedBy,
    };

    if (options?.ttlMs) {
      perm.expiresAt = new Date(Date.now() + options.ttlMs).toISOString();
    }

    this.permissions.set(userId, perm);
    this.save();
    return perm;
  }

  /**
   * Revoke all scopes from a user
   */
  revokeScope(userId: string): boolean {
    const deleted = this.permissions.delete(userId);
    if (deleted) {
      this.save();
    }
    return deleted;
  }

  /**
   * Get permissions for a user
   */
  getPermission(userId: string): ScopedPermission | undefined {
    return this.permissions.get(userId);
  }

  /**
   * List all permissions
   */
  listPermissions(): ScopedPermission[] {
    return Array.from(this.permissions.values());
  }

  /**
   * Register a secret handle (maps friendly name to env var)
   */
  registerSecret(handle: string, envVar: string, description?: string): SecretHandle {
    const secret: SecretHandle = {
      handle,
      envVar,
      description,
      addedAt: new Date().toISOString(),
    };
    this.secrets.set(handle, secret);
    this.save();
    return secret;
  }

  /**
   * Resolve a secret handle to its value (from env)
   */
  resolveSecret(handle: string): string | undefined {
    const secret = this.secrets.get(handle);
    if (!secret) return undefined;
    return process.env[secret.envVar];
  }

  /**
   * List secret handles (never exposes values)
   */
  listHandles(): Array<{ handle: string; description?: string; hasValue: boolean }> {
    return Array.from(this.secrets.values()).map((s) => ({
      handle: s.handle,
      description: s.description,
      hasValue: !!process.env[s.envVar],
    }));
  }

  /**
   * Remove a secret handle
   */
  removeSecret(handle: string): boolean {
    const deleted = this.secrets.delete(handle);
    if (deleted) {
      this.save();
    }
    return deleted;
  }

  /**
   * Grant temporary full access to a user
   */
  grantTemporaryFullAccess(
    userId: string,
    durationMs: number,
    grantedBy?: string
  ): TemporaryAccess {
    const access: TemporaryAccess = {
      userId,
      grantedAt: Date.now(),
      expiresAt: Date.now() + durationMs,
      grantedBy,
    };
    this.temporaryAccess.set(userId, access);
    this.save();
    return access;
  }

  /**
   * Revoke temporary access
   */
  revokeTemporaryAccess(userId: string): boolean {
    const deleted = this.temporaryAccess.delete(userId);
    if (deleted) {
      this.save();
    }
    return deleted;
  }

  /**
   * Require double confirmation for a risky operation
   */
  requireDoubleConfirm(userId: string, operation: string, details?: string): PendingConfirm {
    const confirm: PendingConfirm = {
      id: randomBytes(3).toString('hex'),
      userId,
      operation,
      details,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.confirmTimeoutMs,
    };
    this.pendingConfirms.set(confirm.id, confirm);
    return confirm;
  }

  /**
   * Verify a double confirmation
   */
  verifyDoubleConfirm(confirmId: string, userId: string): { valid: boolean; reason?: string } {
    const confirm = this.pendingConfirms.get(confirmId);
    if (!confirm) {
      return { valid: false, reason: 'Confirmation not found' };
    }
    if (confirm.userId !== userId) {
      return { valid: false, reason: 'Confirmation belongs to a different user' };
    }
    if (Date.now() > confirm.expiresAt) {
      this.pendingConfirms.delete(confirmId);
      return { valid: false, reason: 'Confirmation has expired' };
    }
    this.pendingConfirms.delete(confirmId);
    return { valid: true };
  }

  /**
   * Check if user is an admin
   */
  isAdmin(userId: string): boolean {
    return this.adminUsers.has(userId);
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();

    for (const [userId, perm] of this.permissions) {
      if (perm.expiresAt && new Date(perm.expiresAt).getTime() < now) {
        this.permissions.delete(userId);
      }
    }

    for (const [userId, access] of this.temporaryAccess) {
      if (now >= access.expiresAt) {
        this.temporaryAccess.delete(userId);
      }
    }

    for (const [id, confirm] of this.pendingConfirms) {
      if (now > confirm.expiresAt) {
        this.pendingConfirms.delete(id);
      }
    }

    this.save();
  }

  private load(): void {
    try {
      if (existsSync(this.configPath)) {
        const data: AuthState = JSON.parse(readFileSync(this.configPath, 'utf-8'));
        if (data.permissions) {
          for (const perm of data.permissions) {
            this.permissions.set(perm.userId, perm);
          }
        }
        if (data.secrets) {
          for (const secret of data.secrets) {
            this.secrets.set(secret.handle, secret);
          }
        }
        if (data.temporaryAccess) {
          for (const access of data.temporaryAccess) {
            this.temporaryAccess.set(access.userId, access);
          }
        }
      }
    } catch {
      // Start fresh on load failure
    }
  }

  private save(): void {
    try {
      const dir = dirname(this.configPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const state: AuthState = {
        permissions: Array.from(this.permissions.values()),
        secrets: Array.from(this.secrets.values()),
        temporaryAccess: Array.from(this.temporaryAccess.values()),
      };
      writeFileSync(this.configPath, JSON.stringify(state, null, 2));
    } catch {
      // Silently fail on save errors
    }
  }
}
