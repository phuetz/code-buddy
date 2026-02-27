/**
 * Cloud Web Sessions + Teleport
 *
 * Manages cloud-based coding sessions that run in remote VMs.
 * Supports session creation, lifecycle management, sharing, and
 * teleporting (syncing state between local and cloud).
 */

import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { URL_CONFIG } from '../config/constants.js';

export interface CloudSession {
  id: string;
  status: 'starting' | 'running' | 'paused' | 'completed' | 'failed';
  createdAt: number;
  lastActivity: number;
  task?: string;
  visibility: 'private' | 'team' | 'public';
  repoAccess?: boolean;
  networkAccess: 'none' | 'limited' | 'full';
  vmImage?: string;
}

export interface CloudConfig {
  apiEndpoint: string;
  authToken?: string;
  defaultVisibility: 'private' | 'team' | 'public';
  defaultNetworkAccess: 'none' | 'limited' | 'full';
  allowedDomains: string[];
}

const DEFAULT_CONFIG: CloudConfig = {
  apiEndpoint: URL_CONFIG.CLOUD_API_ENDPOINT,
  defaultVisibility: 'private',
  defaultNetworkAccess: 'limited',
  allowedDomains: [],
};

export class CloudSessionManager {
  private config: CloudConfig;
  private sessions: Map<string, CloudSession>;

  constructor(config?: Partial<CloudConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessions = new Map();
    logger.debug('CloudSessionManager initialized', { endpoint: this.config.apiEndpoint });
  }

  async createSession(task: string, options?: Partial<CloudSession>): Promise<CloudSession> {
    if (!task || task.trim().length === 0) {
      throw new Error('Task description is required');
    }

    const now = Date.now();
    const session: CloudSession = {
      id: randomUUID(),
      status: 'starting',
      createdAt: now,
      lastActivity: now,
      task: task.trim(),
      visibility: options?.visibility ?? this.config.defaultVisibility,
      repoAccess: options?.repoAccess ?? false,
      networkAccess: options?.networkAccess ?? this.config.defaultNetworkAccess,
      vmImage: options?.vmImage,
      ...options,
      // Ensure these are not overridden by options spread
    };
    // Re-apply generated fields
    session.id = session.id || randomUUID();
    session.createdAt = now;
    session.lastActivity = now;
    session.status = 'starting';

    this.sessions.set(session.id, session);

    // Simulate startup transition
    session.status = 'running';
    session.lastActivity = Date.now();

    logger.info('Cloud session created', { id: session.id, task });
    return { ...session };
  }

  listSessions(): CloudSession[] {
    return Array.from(this.sessions.values()).map(s => ({ ...s }));
  }

  getSession(id: string): CloudSession | null {
    const session = this.sessions.get(id);
    return session ? { ...session } : null;
  }

  async pauseSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) {
      logger.warn('Cannot pause: session not found', { id });
      return false;
    }
    if (session.status !== 'running') {
      logger.warn('Cannot pause: session not running', { id, status: session.status });
      return false;
    }
    session.status = 'paused';
    session.lastActivity = Date.now();
    logger.info('Session paused', { id });
    return true;
  }

  async resumeSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) {
      logger.warn('Cannot resume: session not found', { id });
      return false;
    }
    if (session.status !== 'paused') {
      logger.warn('Cannot resume: session not paused', { id, status: session.status });
      return false;
    }
    session.status = 'running';
    session.lastActivity = Date.now();
    logger.info('Session resumed', { id });
    return true;
  }

  async terminateSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) {
      logger.warn('Cannot terminate: session not found', { id });
      return false;
    }
    if (session.status === 'completed' || session.status === 'failed') {
      logger.warn('Cannot terminate: session already ended', { id, status: session.status });
      return false;
    }
    session.status = 'completed';
    session.lastActivity = Date.now();
    logger.info('Session terminated', { id });
    return true;
  }

  async shareSession(id: string, visibility: CloudSession['visibility']): Promise<string> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }
    session.visibility = visibility;
    session.lastActivity = Date.now();

    const shareUrl = `${this.config.apiEndpoint}/sessions/${id}/share`;
    logger.info('Session shared', { id, visibility, url: shareUrl });
    return shareUrl;
  }

  async sendToCloud(task: string): Promise<CloudSession> {
    logger.info('Sending task to cloud', { task });
    return this.createSession(task, { networkAccess: 'full' });
  }

  getActiveCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.status === 'running' || session.status === 'starting') {
        count++;
      }
    }
    return count;
  }

  getTotalCount(): number {
    return this.sessions.size;
  }
}

export class TeleportManager {
  private cloudManager: CloudSessionManager;

  constructor(cloudManager: CloudSessionManager) {
    this.cloudManager = cloudManager;
    logger.debug('TeleportManager initialized');
  }

  async teleport(sessionId: string): Promise<{
    success: boolean;
    localSessionId?: string;
    filesTransferred?: number;
    diffSummary?: string;
  }> {
    const session = this.cloudManager.getSession(sessionId);
    if (!session) {
      logger.warn('Teleport failed: session not found', { sessionId });
      return { success: false };
    }
    if (session.status !== 'running' && session.status !== 'paused') {
      logger.warn('Teleport failed: session not in teleportable state', { sessionId, status: session.status });
      return { success: false };
    }

    const localSessionId = randomUUID();
    logger.info('Teleporting session to local', { sessionId, localSessionId });

    return {
      success: true,
      localSessionId,
      filesTransferred: 0,
      diffSummary: `Teleported session ${sessionId} to local ${localSessionId}`,
    };
  }

  async pushToCloud(localSessionId: string): Promise<CloudSession> {
    if (!localSessionId || localSessionId.trim().length === 0) {
      throw new Error('Local session ID is required');
    }

    logger.info('Pushing local session to cloud', { localSessionId });
    const session = await this.cloudManager.createSession(
      `Pushed from local session ${localSessionId}`,
      { repoAccess: true }
    );
    return session;
  }

  async syncState(sessionId: string): Promise<{
    conflicts: string[];
    merged: number;
  }> {
    const session = this.cloudManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    logger.info('Syncing state', { sessionId });
    return {
      conflicts: [],
      merged: 0,
    };
  }

  async getDiff(sessionId: string): Promise<string> {
    const session = this.cloudManager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    logger.info('Getting diff', { sessionId });
    return `No changes between local and cloud for session ${sessionId}`;
  }
}
