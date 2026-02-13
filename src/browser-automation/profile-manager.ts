/**
 * Browser Profile Manager
 *
 * Save/load browser state (cookies, localStorage, sessionStorage) across sessions.
 * OpenClaw-inspired persistent browser profiles.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import type { BrowserProfileData, Cookie } from './types.js';

// ============================================================================
// Profile Manager
// ============================================================================

export class BrowserProfileManager {
  private profilesDir: string;

  constructor(profilesDir?: string) {
    this.profilesDir = profilesDir || path.join(homedir(), '.codebuddy', 'browser-profiles');
  }

  /**
   * Save browser state to a named profile
   */
  async save(
    name: string,
    data: {
      cookies: Cookie[];
      localStorage: Record<string, Record<string, string>>;
      sessionStorage: Record<string, Record<string, string>>;
    }
  ): Promise<void> {
    await fs.mkdir(this.profilesDir, { recursive: true });

    const profile: BrowserProfileData = {
      name,
      cookies: data.cookies,
      localStorage: data.localStorage,
      sessionStorage: data.sessionStorage,
      savedAt: new Date(),
    };

    const filePath = this.getProfilePath(name);
    await fs.writeFile(filePath, JSON.stringify(profile, null, 2), 'utf-8');
    logger.info(`Browser profile saved: ${name}`, { path: filePath });
  }

  /**
   * Load a named profile
   */
  async load(name: string): Promise<BrowserProfileData | null> {
    try {
      const filePath = this.getProfilePath(name);
      const raw = await fs.readFile(filePath, 'utf-8');
      const profile = JSON.parse(raw) as BrowserProfileData;
      profile.savedAt = new Date(profile.savedAt);
      return profile;
    } catch {
      return null;
    }
  }

  /**
   * List available profiles
   */
  async list(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.profilesDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  /**
   * Delete a profile
   */
  async delete(name: string): Promise<boolean> {
    try {
      const filePath = this.getProfilePath(name);
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private getProfilePath(name: string): string {
    // Sanitize name to prevent path traversal
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.profilesDir, `${safeName}.json`);
  }
}
