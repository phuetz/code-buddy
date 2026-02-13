/**
 * Auth Profile Manager
 *
 * OpenClaw-inspired profile manager with round-robin rotation and
 * session stickiness. Manages authentication profiles across multiple
 * providers with exponential backoff cooldowns, billing-aware failure
 * handling, and persistent state.
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Authentication profile credentials
 */
export interface AuthProfileCredentials {
  /** API key for api-key auth */
  apiKey?: string;
  /** OAuth access token */
  accessToken?: string;
  /** OAuth refresh token */
  refreshToken?: string;
}

/**
 * Authentication profile metadata
 */
export interface AuthProfileMetadata {
  /** Model to use with this profile */
  model?: string;
  /** Base URL override */
  baseURL?: string;
  /** Additional metadata */
  [key: string]: string | undefined;
}

/**
 * Authentication profile
 */
export interface AuthProfile {
  /** Unique profile ID */
  id: string;
  /** Provider name (e.g. 'grok', 'openai', 'anthropic') */
  provider: string;
  /** Authentication type */
  type: 'api-key' | 'oauth';
  /** Credentials */
  credentials: AuthProfileCredentials;
  /** Priority (higher = preferred) */
  priority: number;
  /** Profile metadata */
  metadata: AuthProfileMetadata;
}

/**
 * Rotation strategy for profile selection
 */
export type RotationStrategy = 'round-robin' | 'priority' | 'random';

/**
 * Auth Profile Manager configuration
 */
export interface AuthProfileManagerConfig {
  /** Profiles to manage */
  profiles: AuthProfile[];
  /** Strategy for selecting next profile */
  rotationStrategy: RotationStrategy;
  /** Stick with a profile once selected for a session */
  sessionSticky: boolean;
  /** Base cooldown duration in ms after failure */
  cooldownMs: number;
  /** Cooldown duration for billing failures (5 hours) */
  billingCooldownMs: number;
  /** Maximum cooldown cap (24 hours) */
  maxCooldownMs: number;
  /** Path to persist state */
  persistPath: string;
}

/**
 * Default configuration
 */
export const DEFAULT_AUTH_PROFILE_MANAGER_CONFIG: AuthProfileManagerConfig = {
  profiles: [],
  rotationStrategy: 'round-robin',
  sessionSticky: true,
  cooldownMs: 60_000,          // 1 minute
  billingCooldownMs: 18_000_000, // 5 hours
  maxCooldownMs: 86_400_000,   // 24 hours
  persistPath: path.join(os.homedir(), '.codebuddy', 'auth-profiles.json'),
};

// ============================================================================
// Internal State Types
// ============================================================================

/**
 * Cooldown state for a profile
 */
interface ProfileCooldownState {
  /** Profile ID */
  profileId: string;
  /** Whether the profile is currently in cooldown */
  inCooldown: boolean;
  /** Timestamp when cooldown expires */
  cooldownUntil: number;
  /** Consecutive failure count */
  failureCount: number;
  /** Whether last failure was billing-related */
  lastFailureWasBilling: boolean;
  /** Last error message */
  lastError?: string;
  /** Timestamp of last failure */
  lastFailureAt?: number;
}

/**
 * Persisted state shape
 */
interface PersistedState {
  cooldowns: Record<string, {
    cooldownUntil: number;
    failureCount: number;
    lastFailureWasBilling: boolean;
    lastError?: string;
    lastFailureAt?: number;
  }>;
  savedAt: number;
}

// ============================================================================
// Auth Profile Manager
// ============================================================================

/**
 * Auth Profile Manager
 *
 * Manages authentication profiles with round-robin rotation, session
 * stickiness, and exponential backoff cooldowns. Supports billing-aware
 * failure handling with separate escalation.
 *
 * Events:
 * - `profile:selected` - Emitted when a profile is selected (profileId, sessionId?)
 * - `profile:failed` - Emitted when a profile fails (profileId, error)
 * - `profile:cooldown` - Emitted when a profile enters cooldown (profileId, cooldownMs)
 * - `profile:recovered` - Emitted when a profile exits cooldown (profileId)
 */
export class AuthProfileManager extends EventEmitter {
  private config: AuthProfileManagerConfig;
  private profiles: Map<string, AuthProfile> = new Map();
  private cooldownStates: Map<string, ProfileCooldownState> = new Map();
  private sessionBindings: Map<string, string> = new Map(); // sessionId -> profileId
  private roundRobinIndex: number = 0;
  private recoveryTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: Partial<AuthProfileManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_AUTH_PROFILE_MANAGER_CONFIG, ...config };

    // Register provided profiles
    for (const profile of this.config.profiles) {
      this.profiles.set(profile.id, profile);
      this.cooldownStates.set(profile.id, {
        profileId: profile.id,
        inCooldown: false,
        cooldownUntil: 0,
        failureCount: 0,
        lastFailureWasBilling: false,
      });
    }

    // Load persisted state
    this.loadState();
  }

  // ============================================================================
  // Profile Management
  // ============================================================================

  /**
   * Add a profile
   */
  addProfile(profile: AuthProfile): void {
    this.profiles.set(profile.id, profile);
    if (!this.cooldownStates.has(profile.id)) {
      this.cooldownStates.set(profile.id, {
        profileId: profile.id,
        inCooldown: false,
        cooldownUntil: 0,
        failureCount: 0,
        lastFailureWasBilling: false,
      });
    }
  }

  /**
   * Remove a profile
   */
  removeProfile(profileId: string): boolean {
    const timer = this.recoveryTimers.get(profileId);
    if (timer) {
      clearTimeout(timer);
      this.recoveryTimers.delete(profileId);
    }
    this.cooldownStates.delete(profileId);

    // Remove session bindings pointing to this profile
    for (const [sessionId, boundProfileId] of this.sessionBindings.entries()) {
      if (boundProfileId === profileId) {
        this.sessionBindings.delete(sessionId);
      }
    }

    return this.profiles.delete(profileId);
  }

  /**
   * Get a profile by ID
   */
  getProfile(profileId: string): AuthProfile | undefined {
    return this.profiles.get(profileId);
  }

  /**
   * Get all registered profiles
   */
  getAllProfiles(): AuthProfile[] {
    return Array.from(this.profiles.values());
  }

  // ============================================================================
  // Profile Selection
  // ============================================================================

  /**
   * Get the next available profile, optionally sticky to a session.
   *
   * If sessionSticky is enabled and a session already has a bound profile
   * that is healthy, that profile is returned. Otherwise a new profile is
   * selected using the configured rotation strategy.
   */
  getNextProfile(sessionId?: string): AuthProfile | null {
    // Session stickiness: return the bound profile if healthy
    if (sessionId && this.config.sessionSticky) {
      const boundProfileId = this.sessionBindings.get(sessionId);
      if (boundProfileId) {
        const profile = this.profiles.get(boundProfileId);
        if (profile && !this.isInCooldown(boundProfileId)) {
          this.emit('profile:selected', boundProfileId, sessionId);
          return profile;
        }
        // Bound profile is unhealthy, unbind
        this.sessionBindings.delete(sessionId);
      }
    }

    const healthy = this.getHealthyProfiles();
    if (healthy.length === 0) {
      return null;
    }

    let selected: AuthProfile;

    switch (this.config.rotationStrategy) {
      case 'round-robin':
        selected = this.selectRoundRobin(healthy);
        break;
      case 'priority':
        selected = this.selectByPriority(healthy);
        break;
      case 'random':
        selected = this.selectRandom(healthy);
        break;
      default:
        selected = this.selectRoundRobin(healthy);
    }

    // Bind to session if sticky
    if (sessionId && this.config.sessionSticky) {
      this.sessionBindings.set(sessionId, selected.id);
    }

    this.emit('profile:selected', selected.id, sessionId);
    logger.debug(`Auth profile selected: ${selected.id} (${selected.provider})`);

    return selected;
  }

  /**
   * Get the sticky profile for a session (without selecting a new one)
   */
  getProfileForSession(sessionId: string): AuthProfile | null {
    const boundProfileId = this.sessionBindings.get(sessionId);
    if (!boundProfileId) {
      return null;
    }
    return this.profiles.get(boundProfileId) ?? null;
  }

  /**
   * Get all profiles not currently in cooldown
   */
  getHealthyProfiles(): AuthProfile[] {
    const now = Date.now();
    const healthy: AuthProfile[] = [];

    for (const profile of this.profiles.values()) {
      const state = this.cooldownStates.get(profile.id);
      if (!state || !state.inCooldown || state.cooldownUntil <= now) {
        // If cooldown has expired, mark as recovered
        if (state && state.inCooldown && state.cooldownUntil <= now) {
          this.recoverProfile(profile.id);
        }
        healthy.push(profile);
      }
    }

    // OAuth profiles are prioritized over API key profiles
    healthy.sort((a, b) => {
      if (a.type === 'oauth' && b.type !== 'oauth') return -1;
      if (a.type !== 'oauth' && b.type === 'oauth') return 1;
      return b.priority - a.priority;
    });

    return healthy;
  }

  // ============================================================================
  // Failure & Recovery
  // ============================================================================

  /**
   * Mark a profile as failed with exponential backoff cooldown.
   *
   * Normal failures: 1min -> 5min -> 25min -> 1h (max)
   * Billing failures: 5h -> 10h -> 20h -> 24h (max)
   *
   * The backoff multiplier is 5x for normal and 2x for billing.
   */
  markFailed(profileId: string, error: string, isBilling: boolean = false): void {
    const state = this.cooldownStates.get(profileId);
    if (!state) {
      logger.warn(`markFailed called for unknown profile: ${profileId}`);
      return;
    }

    state.failureCount++;
    state.lastError = error;
    state.lastFailureAt = Date.now();
    state.lastFailureWasBilling = isBilling;

    // Calculate cooldown with exponential backoff
    let cooldownMs: number;

    if (isBilling) {
      // Billing: 5h initial, 2x escalation, capped at 24h
      cooldownMs = this.config.billingCooldownMs * Math.pow(2, state.failureCount - 1);
      cooldownMs = Math.min(cooldownMs, this.config.maxCooldownMs);
    } else {
      // Normal: 1min initial, 5x escalation, capped at 1h (3_600_000 ms)
      cooldownMs = this.config.cooldownMs * Math.pow(5, state.failureCount - 1);
      cooldownMs = Math.min(cooldownMs, 3_600_000);
    }

    state.inCooldown = true;
    state.cooldownUntil = Date.now() + cooldownMs;

    this.emit('profile:failed', profileId, error);
    this.emit('profile:cooldown', profileId, cooldownMs);
    logger.warn(
      `Auth profile ${profileId} failed (${isBilling ? 'billing' : 'error'}), ` +
      `cooldown ${Math.round(cooldownMs / 1000)}s, failures: ${state.failureCount}`
    );

    // Schedule recovery timer
    this.scheduleRecovery(profileId, cooldownMs);

    // Persist state
    this.saveState();
  }

  /**
   * Mark a profile as successful, resetting its failure count
   */
  markSuccess(profileId: string): void {
    const state = this.cooldownStates.get(profileId);
    if (!state) return;

    state.failureCount = 0;
    state.inCooldown = false;
    state.cooldownUntil = 0;
    state.lastError = undefined;
    state.lastFailureWasBilling = false;

    // Cancel recovery timer since we're already healthy
    const timer = this.recoveryTimers.get(profileId);
    if (timer) {
      clearTimeout(timer);
      this.recoveryTimers.delete(profileId);
    }

    // Persist state
    this.saveState();
  }

  /**
   * Release a session's sticky profile binding
   */
  releaseSession(sessionId: string): void {
    this.sessionBindings.delete(sessionId);
  }

  // ============================================================================
  // Internal Selection Strategies
  // ============================================================================

  /**
   * Round-robin selection across healthy profiles
   */
  private selectRoundRobin(healthy: AuthProfile[]): AuthProfile {
    if (this.roundRobinIndex >= healthy.length) {
      this.roundRobinIndex = 0;
    }
    const selected = healthy[this.roundRobinIndex];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % healthy.length;
    return selected;
  }

  /**
   * Priority-based selection (highest priority first)
   */
  private selectByPriority(healthy: AuthProfile[]): AuthProfile {
    // Already sorted by priority in getHealthyProfiles()
    return healthy[0];
  }

  /**
   * Random selection
   */
  private selectRandom(healthy: AuthProfile[]): AuthProfile {
    const index = Math.floor(Math.random() * healthy.length);
    return healthy[index];
  }

  // ============================================================================
  // Cooldown Management
  // ============================================================================

  /**
   * Check if a profile is currently in cooldown
   */
  private isInCooldown(profileId: string): boolean {
    const state = this.cooldownStates.get(profileId);
    if (!state || !state.inCooldown) return false;

    if (state.cooldownUntil <= Date.now()) {
      // Cooldown expired, recover
      this.recoverProfile(profileId);
      return false;
    }

    return true;
  }

  /**
   * Recover a profile from cooldown
   */
  private recoverProfile(profileId: string): void {
    const state = this.cooldownStates.get(profileId);
    if (!state) return;

    state.inCooldown = false;
    // Keep failureCount so next failure escalates appropriately
    // Only markSuccess() fully resets

    const timer = this.recoveryTimers.get(profileId);
    if (timer) {
      clearTimeout(timer);
      this.recoveryTimers.delete(profileId);
    }

    this.emit('profile:recovered', profileId);
    logger.info(`Auth profile ${profileId} recovered from cooldown`);

    this.saveState();
  }

  /**
   * Schedule automatic recovery after cooldown expires
   */
  private scheduleRecovery(profileId: string, cooldownMs: number): void {
    // Cancel existing timer
    const existing = this.recoveryTimers.get(profileId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.recoveryTimers.delete(profileId);
      this.recoverProfile(profileId);
    }, cooldownMs);

    // Unref so it doesn't keep the process alive
    if (timer.unref) {
      timer.unref();
    }

    this.recoveryTimers.set(profileId, timer);
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  /**
   * Save cooldown states to disk
   */
  private saveState(): void {
    try {
      const persistDir = path.dirname(this.config.persistPath);
      if (!fs.existsSync(persistDir)) {
        fs.mkdirSync(persistDir, { recursive: true });
      }

      const state: PersistedState = {
        cooldowns: {},
        savedAt: Date.now(),
      };

      for (const [id, cooldownState] of this.cooldownStates.entries()) {
        state.cooldowns[id] = {
          cooldownUntil: cooldownState.cooldownUntil,
          failureCount: cooldownState.failureCount,
          lastFailureWasBilling: cooldownState.lastFailureWasBilling,
          lastError: cooldownState.lastError,
          lastFailureAt: cooldownState.lastFailureAt,
        };
      }

      fs.writeFileSync(this.config.persistPath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      logger.warn(`Failed to save auth profile state: ${err}`);
    }
  }

  /**
   * Load cooldown states from disk
   */
  private loadState(): void {
    try {
      if (!fs.existsSync(this.config.persistPath)) {
        return;
      }

      const raw = fs.readFileSync(this.config.persistPath, 'utf-8');
      const state: PersistedState = JSON.parse(raw);

      if (!state || !state.cooldowns) {
        return;
      }

      const now = Date.now();

      for (const [id, saved] of Object.entries(state.cooldowns)) {
        const existing = this.cooldownStates.get(id);
        if (!existing) continue;

        existing.failureCount = saved.failureCount;
        existing.lastFailureWasBilling = saved.lastFailureWasBilling;
        existing.lastError = saved.lastError;
        existing.lastFailureAt = saved.lastFailureAt;

        if (saved.cooldownUntil > now) {
          existing.inCooldown = true;
          existing.cooldownUntil = saved.cooldownUntil;
          // Schedule recovery for remaining time
          this.scheduleRecovery(id, saved.cooldownUntil - now);
        } else {
          // Cooldown already expired
          existing.inCooldown = false;
          existing.cooldownUntil = 0;
        }
      }

      logger.debug('Auth profile state loaded from disk');
    } catch (err) {
      logger.warn(`Failed to load auth profile state: ${err}`);
    }
  }

  // ============================================================================
  // Stats & Diagnostics
  // ============================================================================

  /**
   * Get status of all profiles
   */
  getStatus(): Array<{
    profileId: string;
    provider: string;
    type: 'api-key' | 'oauth';
    priority: number;
    healthy: boolean;
    failureCount: number;
    inCooldown: boolean;
    cooldownRemainingMs: number;
    lastError?: string;
  }> {
    const now = Date.now();
    return this.getAllProfiles().map(profile => {
      const state = this.cooldownStates.get(profile.id);
      const inCooldown = state?.inCooldown && (state.cooldownUntil > now);
      return {
        profileId: profile.id,
        provider: profile.provider,
        type: profile.type,
        priority: profile.priority,
        healthy: !inCooldown,
        failureCount: state?.failureCount ?? 0,
        inCooldown: !!inCooldown,
        cooldownRemainingMs: inCooldown ? state!.cooldownUntil - now : 0,
        lastError: state?.lastError,
      };
    });
  }

  /**
   * Shutdown - clear all timers
   */
  shutdown(): void {
    for (const timer of this.recoveryTimers.values()) {
      clearTimeout(timer);
    }
    this.recoveryTimers.clear();
    this.sessionBindings.clear();
    this.saveState();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let authProfileManagerInstance: AuthProfileManager | null = null;

/**
 * Get the auth profile manager singleton
 */
export function getAuthProfileManager(
  config?: Partial<AuthProfileManagerConfig>
): AuthProfileManager {
  if (!authProfileManagerInstance) {
    authProfileManagerInstance = new AuthProfileManager(config);
  }
  return authProfileManagerInstance;
}

/**
 * Reset the auth profile manager singleton
 */
export function resetAuthProfileManager(): void {
  if (authProfileManagerInstance) {
    authProfileManagerInstance.shutdown();
    authProfileManagerInstance = null;
  }
}

export default AuthProfileManager;
