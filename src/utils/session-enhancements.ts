/**
 * Session & Misc Enhancements
 * Per-session settings, update channels, and elevated mode management.
 */

import { readFileSync } from 'fs';
import { logger } from './logger.js';
import { coerce, inc, prerelease } from 'semver';

export class SessionPersistentSettings {
  private static instance: SessionPersistentSettings | null = null;
  private sessions: Map<string, Map<string, unknown>> = new Map();

  static getInstance(): SessionPersistentSettings {
    if (!SessionPersistentSettings.instance) {
      SessionPersistentSettings.instance = new SessionPersistentSettings();
    }
    return SessionPersistentSettings.instance;
  }

  static resetInstance(): void {
    SessionPersistentSettings.instance = null;
  }

  set(sessionId: string, key: string, value: unknown): void {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Map());
    }
    this.sessions.get(sessionId)!.set(key, value);
    logger.debug(`Session ${sessionId}: set ${key}`);
  }

  get(sessionId: string, key: string): unknown {
    return this.sessions.get(sessionId)?.get(key);
  }

  getAll(sessionId: string): Record<string, unknown> {
    const map = this.sessions.get(sessionId);
    if (!map) return {};
    const result: Record<string, unknown> = {};
    for (const [k, v] of map) {
      result[k] = v;
    }
    return result;
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
    logger.debug(`Session ${sessionId}: cleared`);
  }
}

export class UpdateChannelManager {
  private static instance: UpdateChannelManager | null = null;
  readonly channels = ['stable', 'beta', 'dev'] as const;
  private currentChannel: string = 'stable';
  private releaseManifest: Partial<Record<'stable' | 'beta' | 'dev', { version: string; date?: string }>> | null = null;

  static getInstance(): UpdateChannelManager {
    if (!UpdateChannelManager.instance) {
      UpdateChannelManager.instance = new UpdateChannelManager();
    }
    return UpdateChannelManager.instance;
  }

  static resetInstance(): void {
    UpdateChannelManager.instance = null;
  }

  getCurrentChannel(): string {
    return this.currentChannel;
  }

  setChannel(channel: string): void {
    if (!this.isValidChannel(channel)) {
      throw new Error(`Invalid channel: ${channel}. Must be one of: ${this.channels.join(', ')}`);
    }
    this.currentChannel = channel;
    logger.debug(`Update channel set to: ${channel}`);
  }

  getLatestVersion(channel: string): { version: string; channel: string; date: string } {
    if (!this.isValidChannel(channel)) {
      throw new Error(`Invalid channel: ${channel}`);
    }

    const manifest = this.getReleaseManifest();
    const typedChannel = channel as 'stable' | 'beta' | 'dev';
    const fromManifest = manifest?.[typedChannel];
    const version =
      process.env[`CODEBUDDY_${channel.toUpperCase()}_VERSION`] ||
      fromManifest?.version ||
      this.deriveChannelVersion(typedChannel);
    const date =
      process.env[`CODEBUDDY_${channel.toUpperCase()}_DATE`] ||
      fromManifest?.date ||
      new Date().toISOString();

    return {
      version,
      channel,
      date,
    };
  }

  isValidChannel(channel: string): boolean {
    return (this.channels as readonly string[]).includes(channel);
  }

  private getReleaseManifest(): Partial<Record<'stable' | 'beta' | 'dev', { version: string; date?: string }>> {
    if (this.releaseManifest) {
      return this.releaseManifest;
    }

    const manifestCandidates = [
      new URL('../../.codebuddy/update-channels.json', import.meta.url),
      new URL('../../package.json', import.meta.url),
    ];

    for (const manifestUrl of manifestCandidates) {
      try {
        const raw = readFileSync(manifestUrl, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;

        if (
          typeof parsed.stable === 'object' ||
          typeof parsed.beta === 'object' ||
          typeof parsed.dev === 'object'
        ) {
          this.releaseManifest = parsed as Partial<
            Record<'stable' | 'beta' | 'dev', { version: string; date?: string }>
          >;
          return this.releaseManifest;
        }

        if (typeof parsed.version === 'string') {
          this.releaseManifest = {
            stable: { version: parsed.version },
          };
          return this.releaseManifest;
        }
      } catch {
        continue;
      }
    }

    this.releaseManifest = {};
    return this.releaseManifest;
  }

  private deriveChannelVersion(channel: 'stable' | 'beta' | 'dev'): string {
    const stableVersion = this.getStableInstalledVersion();
    if (channel === 'stable') {
      return stableVersion;
    }

    const prereleaseTag = channel === 'beta' ? 'beta' : 'dev';
    const candidate = inc(stableVersion, 'prerelease', prereleaseTag);
    if (candidate) {
      return candidate;
    }

    return `${stableVersion}-${prereleaseTag}.1`;
  }

  private getStableInstalledVersion(): string {
    try {
      const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
      const parsed = JSON.parse(raw) as { version?: string };
      const normalized = coerce(parsed.version || '0.0.0')?.version || '0.0.0';
      return prerelease(parsed.version || '') ? normalized : parsed.version || normalized;
    } catch {
      return '0.0.0';
    }
  }
}

export class ElevatedModeManager {
  private static instance: ElevatedModeManager | null = null;
  private elevated: boolean = false;

  static getInstance(): ElevatedModeManager {
    if (!ElevatedModeManager.instance) {
      ElevatedModeManager.instance = new ElevatedModeManager();
    }
    return ElevatedModeManager.instance;
  }

  static resetInstance(): void {
    ElevatedModeManager.instance = null;
  }

  isElevated(): boolean {
    return this.elevated;
  }

  enable(): void {
    this.elevated = true;
    logger.debug('Elevated mode enabled');
  }

  disable(): void {
    this.elevated = false;
    logger.debug('Elevated mode disabled');
  }

  toggle(): boolean {
    this.elevated = !this.elevated;
    logger.debug(`Elevated mode toggled to: ${this.elevated}`);
    return this.elevated;
  }

  getWarning(): string {
    return 'WARNING: Elevated mode bypasses safety confirmations. Use with caution.';
  }
}
