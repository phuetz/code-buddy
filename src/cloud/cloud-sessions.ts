/**
 * Cloud Web Sessions + Teleport
 *
 * Manages cloud-based coding sessions that run in remote VMs.
 * Supports session creation, lifecycle management, sharing, and
 * teleporting (syncing state between local and cloud).
 */

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
  backend?: CloudSessionBackend;
}

export interface CloudSessionBackend {
  createSession(task: string, options: Partial<CloudSession>, config: CloudConfig): Promise<CloudSession>;
  pauseSession(id: string): Promise<CloudSession>;
  resumeSession(id: string): Promise<CloudSession>;
  terminateSession(id: string): Promise<CloudSession>;
  shareSession(id: string, visibility: CloudSession['visibility'], config: CloudConfig): Promise<string>;
  teleportToLocal(session: CloudSession): Promise<{
    success: boolean;
    localSessionId?: string;
    filesTransferred?: number;
    diffSummary?: string;
  }>;
  pushToCloud(localSessionId: string, config: CloudConfig): Promise<CloudSession>;
  syncState(session: CloudSession): Promise<{
    conflicts: string[];
    merged: number;
  }>;
  getDiff(session: CloudSession): Promise<string>;
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
  private backend?: CloudSessionBackend;

  constructor(config?: Partial<CloudConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessions = new Map();
    this.backend = this.config.backend;
    logger.debug('CloudSessionManager initialized', { endpoint: this.config.apiEndpoint });
  }

  async createSession(task: string, options?: Partial<CloudSession>): Promise<CloudSession> {
    if (!task || task.trim().length === 0) {
      throw new Error('Task description is required');
    }

    const backend = this.requireBackend('create cloud session');
    const session = await backend.createSession(task.trim(), {
      visibility: options?.visibility ?? this.config.defaultVisibility,
      repoAccess: options?.repoAccess ?? false,
      networkAccess: options?.networkAccess ?? this.config.defaultNetworkAccess,
      vmImage: options?.vmImage,
      ...options,
    }, this.config);

    this.sessions.set(session.id, session);

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
    const updated = await this.requireBackend('pause cloud session').pauseSession(id);
    this.sessions.set(id, updated);
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
    const updated = await this.requireBackend('resume cloud session').resumeSession(id);
    this.sessions.set(id, updated);
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
    const updated = await this.requireBackend('terminate cloud session').terminateSession(id);
    this.sessions.set(id, updated);
    logger.info('Session terminated', { id });
    return true;
  }

  async shareSession(id: string, visibility: CloudSession['visibility']): Promise<string> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }
    const shareUrl = await this.requireBackend('share cloud session').shareSession(id, visibility, this.config);
    session.visibility = visibility;
    session.lastActivity = Date.now();
    logger.info('Session shared', { id, visibility, url: shareUrl });
    return shareUrl;
  }

  async sendToCloud(task: string): Promise<CloudSession> {
    logger.info('Sending task to cloud', { task });
    return this.createSession(task, { networkAccess: 'full' });
  }

  async teleportToLocal(sessionId: string): Promise<{
    success: boolean;
    localSessionId?: string;
    filesTransferred?: number;
    diffSummary?: string;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn('Teleport failed: session not found', { sessionId });
      return { success: false };
    }
    if (session.status !== 'running' && session.status !== 'paused') {
      logger.warn('Teleport failed: session not in teleportable state', { sessionId, status: session.status });
      return { success: false };
    }

    return this.requireBackend('teleport cloud session').teleportToLocal({ ...session });
  }

  async pushLocalSessionToCloud(localSessionId: string): Promise<CloudSession> {
    const session = await this.requireBackend('push local session to cloud').pushToCloud(localSessionId, this.config);
    this.sessions.set(session.id, session);
    return { ...session };
  }

  async syncState(sessionId: string): Promise<{
    conflicts: string[];
    merged: number;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return this.requireBackend('sync cloud session state').syncState({ ...session });
  }

  async getDiff(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return this.requireBackend('diff cloud session').getDiff({ ...session });
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

  private requireBackend(operation: string): CloudSessionBackend {
    if (!this.backend) {
      throw new Error(
        `Cloud sessions require a real cloud session backend to ${operation}. ` +
        'Configure CloudConfig.backend before enabling Cloud Web Sessions or Teleport.'
      );
    }
    return this.backend;
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
    logger.info('Teleporting session to local', { sessionId });
    return this.cloudManager.teleportToLocal(sessionId);
  }

  async pushToCloud(localSessionId: string): Promise<CloudSession> {
    if (!localSessionId || localSessionId.trim().length === 0) {
      throw new Error('Local session ID is required');
    }

    logger.info('Pushing local session to cloud', { localSessionId });
    return this.cloudManager.pushLocalSessionToCloud(localSessionId);
  }

  async syncState(sessionId: string): Promise<{
    conflicts: string[];
    merged: number;
  }> {
    logger.info('Syncing state', { sessionId });
    return this.cloudManager.syncState(sessionId);
  }

  async getDiff(sessionId: string): Promise<string> {
    logger.info('Getting diff', { sessionId });
    return this.cloudManager.getDiff(sessionId);
  }
}
