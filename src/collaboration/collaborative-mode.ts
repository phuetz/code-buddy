/**
 * Collaborative Mode
 *
 * Multi-user collaboration features for Code Buddy:
 * - Shared sessions between users
 * - Real-time synchronization
 * - Presence indicators
 * - Conflict resolution
 * - Permission management
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

export interface User {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
  color: string;
  cursor?: CursorPosition;
  lastActive: Date;
}

export type UserRole = 'owner' | 'editor' | 'viewer';

export interface CursorPosition {
  file: string;
  line: number;
  column: number;
}

export interface CollaborativeSession {
  id: string;
  name: string;
  ownerId: string;
  users: Map<string, User>;
  sharedContext: SharedContext;
  permissions: SessionPermissions;
  createdAt: Date;
  expiresAt?: Date;
}

export interface SharedContext {
  messages: SharedMessage[];
  files: Map<string, FileState>;
  variables: Map<string, unknown>;
}

/**
 * Maximum number of messages to keep in shared context.
 * Older messages are trimmed to prevent memory leaks in long sessions.
 */
const MAX_SHARED_MESSAGES = 500;

export interface SharedMessage {
  id: string;
  userId: string;
  content: string;
  timestamp: Date;
  type: 'user' | 'assistant' | 'system';
}

export interface FileState {
  path: string;
  content: string;
  version: number;
  lastModifiedBy: string;
  lastModifiedAt: Date;
  locks: Map<string, FileLock>;
}

export interface FileLock {
  userId: string;
  region?: { start: number; end: number };
  acquiredAt: Date;
  expiresAt: Date;
}

export interface SessionPermissions {
  allowEditing: boolean;
  allowExecution: boolean;
  allowFileOperations: boolean;
  requireApproval: boolean;
  maxUsers: number;
}

export interface CollaborationConfig {
  serverUrl?: string;
  port?: number;
  heartbeatInterval?: number;
  lockTimeout?: number;
  maxSessionDuration?: number;
}

const DEFAULT_CONFIG: Required<CollaborationConfig> = {
  serverUrl: 'ws://localhost',
  port: 9876,
  heartbeatInterval: 30000,
  lockTimeout: 300000,
  maxSessionDuration: 86400000,
};

const USER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
];

export type CollaborationEvent =
  | { type: 'user-joined'; user: User }
  | { type: 'user-left'; userId: string }
  | { type: 'cursor-moved'; userId: string; position: CursorPosition }
  | { type: 'message-added'; message: SharedMessage }
  | { type: 'file-changed'; path: string; content: string; userId: string }
  | { type: 'file-locked'; path: string; userId: string }
  | { type: 'file-unlocked'; path: string; userId: string };

/**
 * Collaborative Session Manager
 */
export class CollaborativeSessionManager extends EventEmitter {
  private config: Required<CollaborationConfig>;
  private sessions: Map<string, CollaborativeSession> = new Map();
  private currentSession: CollaborativeSession | null = null;
  private currentUser: User | null = null;

  constructor(config: CollaborationConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  createSession(
    name: string,
    user: Omit<User, 'id' | 'color' | 'lastActive' | 'role'>,
    permissions: Partial<SessionPermissions> = {}
  ): CollaborativeSession {
    const sessionId = this.generateId('sess');
    const userId = this.generateId('user');

    const owner: User = {
      ...user,
      id: userId,
      role: 'owner',
      color: this.assignColor(0),
      lastActive: new Date(),
    };

    const session: CollaborativeSession = {
      id: sessionId,
      name,
      ownerId: userId,
      users: new Map([[userId, owner]]),
      sharedContext: {
        messages: [],
        files: new Map(),
        variables: new Map(),
      },
      permissions: {
        allowEditing: true,
        allowExecution: true,
        allowFileOperations: true,
        requireApproval: false,
        maxUsers: 10,
        ...permissions,
      },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.maxSessionDuration),
    };

    this.sessions.set(sessionId, session);
    this.currentSession = session;
    this.currentUser = owner;
    this.emit('session-created', session);
    return session;
  }

  async joinSession(
    sessionId: string,
    user: Omit<User, 'id' | 'color' | 'lastActive' | 'role'>
  ): Promise<CollaborativeSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);
    if (session.users.size >= session.permissions.maxUsers) {
      throw new Error(`Session is full (${session.permissions.maxUsers} users maximum). Wait for someone to leave or ask the owner to increase the limit.`);
    }

    const userId = this.generateId('user');
    const newUser: User = {
      ...user,
      id: userId,
      role: 'editor',
      color: this.assignColor(session.users.size),
      lastActive: new Date(),
    };

    session.users.set(userId, newUser);
    this.currentSession = session;
    this.currentUser = newUser;
    this.emit('user-joined', { session, user: newUser });
    return session;
  }

  leaveSession(): void {
    if (!this.currentSession || !this.currentUser) return;
    const session = this.currentSession;
    const userId = this.currentUser.id;

    for (const file of session.sharedContext.files.values()) {
      file.locks.delete(userId);
    }
    session.users.delete(userId);

    if (session.ownerId === userId) {
      const nextOwner = Array.from(session.users.values())[0];
      if (nextOwner) {
        session.ownerId = nextOwner.id;
        nextOwner.role = 'owner';
      } else {
        this.sessions.delete(session.id);
      }
    }

    this.currentSession = null;
    this.currentUser = null;
    this.emit('user-left', { sessionId: session.id, userId });
  }

  addMessage(content: string, type: SharedMessage['type'] = 'user'): SharedMessage {
    if (!this.currentSession || !this.currentUser) {
      throw new Error('Not currently in a collaborative session. Join or create a session first.');
    }
    const message: SharedMessage = {
      id: this.generateId('msg'),
      userId: this.currentUser.id,
      content,
      timestamp: new Date(),
      type,
    };
    this.currentSession.sharedContext.messages.push(message);

    // Trim old messages to prevent memory leaks
    this.trimMessages();

    return message;
  }

  /**
   * Trim old messages from shared context to prevent memory leaks.
   * Uses a sliding window approach, keeping the most recent messages.
   */
  private trimMessages(): void {
    if (!this.currentSession) return;

    const messages = this.currentSession.sharedContext.messages;
    if (messages.length > MAX_SHARED_MESSAGES) {
      const trimCount = messages.length - MAX_SHARED_MESSAGES;
      this.currentSession.sharedContext.messages = messages.slice(trimCount);
    }
  }

  /**
   * Get current message count and limit for monitoring
   */
  getMessageStats(): { count: number; max: number } | null {
    if (!this.currentSession) return null;
    return {
      count: this.currentSession.sharedContext.messages.length,
      max: MAX_SHARED_MESSAGES,
    };
  }

  updateCursor(position: CursorPosition): void {
    if (!this.currentSession || !this.currentUser) return;
    this.currentUser.cursor = position;
    this.currentUser.lastActive = new Date();
  }

  lockFile(path: string, region?: { start: number; end: number }): boolean {
    if (!this.currentSession || !this.currentUser) return false;
    const file = this.currentSession.sharedContext.files.get(path);
    if (!file) return false;

    for (const lock of file.locks.values()) {
      if (lock.userId !== this.currentUser.id) {
        if (!region || !lock.region) return false;
        if (region.start <= lock.region.end && region.end >= lock.region.start) {
          return false;
        }
      }
    }

    file.locks.set(this.currentUser.id, {
      userId: this.currentUser.id,
      region,
      acquiredAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.lockTimeout),
    });
    return true;
  }

  unlockFile(path: string): boolean {
    if (!this.currentSession || !this.currentUser) return false;
    const file = this.currentSession.sharedContext.files.get(path);
    return file ? file.locks.delete(this.currentUser.id) : false;
  }

  updateFile(path: string, content: string): boolean {
    if (!this.currentSession || !this.currentUser) return false;
    if (!this.currentSession.permissions.allowEditing) return false;

    let file = this.currentSession.sharedContext.files.get(path);
    if (!file) {
      file = {
        path,
        content: '',
        version: 0,
        lastModifiedBy: this.currentUser.id,
        lastModifiedAt: new Date(),
        locks: new Map(),
      };
      this.currentSession.sharedContext.files.set(path, file);
    }

    const lock = file.locks.get(this.currentUser.id);
    if (file.locks.size > 0 && !lock) return false;

    file.content = content;
    file.version++;
    file.lastModifiedBy = this.currentUser.id;
    file.lastModifiedAt = new Date();
    return true;
  }

  getCurrentSession(): CollaborativeSession | null {
    return this.currentSession;
  }

  getCurrentUser(): User | null {
    return this.currentUser;
  }

  getUsers(): User[] {
    return this.currentSession ? Array.from(this.currentSession.users.values()) : [];
  }

  hasPermission(permission: keyof SessionPermissions): boolean {
    if (!this.currentSession || !this.currentUser) return false;
    if (this.currentUser.role === 'owner') return true;
    if (this.currentUser.role === 'viewer') return false;
    return !!this.currentSession.permissions[permission];
  }

  generateInviteLink(): string {
    if (!this.currentSession) throw new Error('Not currently in a collaborative session. Join or create a session first.');
    const inviteCode = crypto.randomBytes(16).toString('base64url');
    return 'codebuddy://join/' + this.currentSession.id + '?code=' + inviteCode;
  }

  private generateId(prefix: string): string {
    return prefix + '_' + crypto.randomBytes(8).toString('hex');
  }

  private assignColor(index: number): string {
    return USER_COLORS[index % USER_COLORS.length];
  }

  dispose(): void {
    this.leaveSession();
    this.sessions.clear();
    this.removeAllListeners();
  }
}

let collaborationInstance: CollaborativeSessionManager | null = null;

export function getCollaborationManager(config?: CollaborationConfig): CollaborativeSessionManager {
  if (!collaborationInstance) {
    collaborationInstance = new CollaborativeSessionManager(config);
  }
  return collaborationInstance;
}

export function resetCollaborationManager(): void {
  if (collaborationInstance) collaborationInstance.dispose();
  collaborationInstance = null;
}

export default CollaborativeSessionManager;
