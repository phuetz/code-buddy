/**
 * Team Collaboration System
 *
 * Features:
 * - Session sharing with team members
 * - Real-time collaboration
 * - Role-based permissions
 * - Session history and audit log
 * - Workspace synchronization
 *
 * Inspired by collaborative coding tools like VS Code Live Share.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import WebSocket from 'ws';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  avatar?: string;
  status: 'online' | 'offline' | 'away';
  lastSeen: Date;
  permissions: Permission[];
}

export interface Permission {
  resource: string;
  actions: ('read' | 'write' | 'execute' | 'delete' | 'share')[];
}

export interface SharedSession {
  id: string;
  name: string;
  description?: string;
  owner: string;
  members: TeamMember[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  settings: SessionSettings;
  state: SessionState;
  auditLog: AuditEntry[];
}

export interface SessionSettings {
  allowAnonymous: boolean;
  requireApproval: boolean;
  maxMembers: number;
  autoExpire: boolean;
  expireAfterHours: number;
  allowFileEdits: boolean;
  allowTerminalAccess: boolean;
  allowCodeExecution: boolean;
  notifyOnJoin: boolean;
  notifyOnLeave: boolean;
  recordSession: boolean;
}

export interface SessionState {
  isActive: boolean;
  currentFile?: string;
  cursorPositions: Map<string, CursorPosition>;
  sharedContext: SharedContext;
  pendingChanges: PendingChange[];
}

export interface CursorPosition {
  memberId: string;
  file: string;
  line: number;
  column: number;
  selection?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}

export interface SharedContext {
  conversationHistory: ConversationMessage[];
  sharedFiles: string[];
  pinnedMessages: string[];
  annotations: Annotation[];
}

export interface ConversationMessage {
  id: string;
  memberId: string;
  memberName: string;
  content: string;
  timestamp: Date;
  type: 'user' | 'assistant' | 'system';
  attachments?: string[];
}

export interface Annotation {
  id: string;
  memberId: string;
  file: string;
  line: number;
  content: string;
  createdAt: Date;
  resolved: boolean;
}

export interface PendingChange {
  id: string;
  memberId: string;
  type: 'file_edit' | 'file_create' | 'file_delete' | 'terminal_command';
  target: string;
  content?: string;
  timestamp: Date;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
}

export interface AuditEntry {
  id: string;
  timestamp: Date;
  memberId: string;
  memberName: string;
  action: string;
  details: Record<string, unknown>;
  ipAddress?: string;
}

export interface TeamSessionConfig {
  serverUrl?: string;
  enableEncryption: boolean;
  encryptionKey?: string;
  autoReconnect: boolean;
  reconnectInterval: number;
  heartbeatInterval: number;
  maxReconnectAttempts: number;
}

const DEFAULT_CONFIG: TeamSessionConfig = {
  enableEncryption: true,
  autoReconnect: true,
  reconnectInterval: 5000,
  heartbeatInterval: 30000,
  maxReconnectAttempts: 10,
};

const DEFAULT_SETTINGS: SessionSettings = {
  allowAnonymous: false,
  requireApproval: true,
  maxMembers: 10,
  autoExpire: true,
  expireAfterHours: 24,
  allowFileEdits: true,
  allowTerminalAccess: false,
  allowCodeExecution: false,
  notifyOnJoin: true,
  notifyOnLeave: true,
  recordSession: true,
};

/**
 * Team Session Manager
 */
export class TeamSessionManager extends EventEmitter {
  private config: TeamSessionConfig;
  private currentSession: SharedSession | null = null;
  private currentMember: TeamMember | null = null;
  private ws: WebSocket | null = null;
  private reconnectAttempts: number = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private sessionsDir: string;

  constructor(config: Partial<TeamSessionConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionsDir = path.join(os.homedir(), '.grok', 'sessions');
    this.initialize();
  }

  /**
   * Initialize the session manager
   */
  private async initialize(): Promise<void> {
    await fs.ensureDir(this.sessionsDir);
    this.loadMemberProfile();
  }

  /**
   * Load member profile from disk
   */
  private loadMemberProfile(): void {
    const profilePath = path.join(os.homedir(), '.grok', 'profile.json');

    if (fs.existsSync(profilePath)) {
      try {
        const profile = fs.readJSONSync(profilePath);
        this.currentMember = {
          id: profile.id || this.generateId(),
          name: profile.name || os.userInfo().username,
          email: profile.email || '',
          role: 'owner',
          status: 'online',
          lastSeen: new Date(),
          permissions: [],
        };
      } catch {
        this.createDefaultProfile();
      }
    } else {
      this.createDefaultProfile();
    }
  }

  /**
   * Create default member profile
   */
  private createDefaultProfile(): void {
    this.currentMember = {
      id: this.generateId(),
      name: os.userInfo().username,
      email: '',
      role: 'owner',
      status: 'online',
      lastSeen: new Date(),
      permissions: [],
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generate session share code
   */
  private generateShareCode(): string {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  /**
   * Create a new shared session
   */
  async createSession(name: string, settings: Partial<SessionSettings> = {}): Promise<SharedSession> {
    if (!this.currentMember) {
      throw new Error('Member profile not initialized');
    }

    const session: SharedSession = {
      id: this.generateId(),
      name,
      owner: this.currentMember.id,
      members: [this.currentMember],
      createdAt: new Date(),
      updatedAt: new Date(),
      settings: { ...DEFAULT_SETTINGS, ...settings },
      state: {
        isActive: true,
        cursorPositions: new Map(),
        sharedContext: {
          conversationHistory: [],
          sharedFiles: [],
          pinnedMessages: [],
          annotations: [],
        },
        pendingChanges: [],
      },
      auditLog: [],
    };

    // Add creation to audit log
    this.addAuditEntry(session, 'session_created', { name });

    // Save session
    await this.saveSession(session);

    this.currentSession = session;
    this.emit('session:created', { session });

    return session;
  }

  /**
   * Join an existing session
   */
  async joinSession(sessionId: string, shareCode?: string): Promise<SharedSession | null> {
    if (!this.currentMember) {
      throw new Error('Member profile not initialized');
    }

    // Load session
    const session = await this.loadSession(sessionId);
    if (!session) {
      this.emit('error', new Error('Session not found'));
      return null;
    }

    // Check if session is active
    if (!session.state.isActive) {
      this.emit('error', new Error('Session is no longer active'));
      return null;
    }

    // Check member limit
    if (session.members.length >= session.settings.maxMembers) {
      this.emit('error', new Error('Session is full'));
      return null;
    }

    // Add member with viewer role (owner can upgrade)
    const newMember: TeamMember = {
      ...this.currentMember,
      role: 'viewer',
    };

    if (session.settings.requireApproval) {
      // Add pending approval
      this.emit('join:pending', { session, member: newMember });
      return null;
    }

    session.members.push(newMember);
    session.updatedAt = new Date();

    // Add to audit log
    this.addAuditEntry(session, 'member_joined', {
      memberId: newMember.id,
      memberName: newMember.name,
    });

    await this.saveSession(session);
    this.currentSession = session;

    this.emit('session:joined', { session, member: newMember });

    // Connect to real-time updates if server configured
    if (this.config.serverUrl) {
      this.connectWebSocket(sessionId);
    }

    return session;
  }

  /**
   * Leave current session
   */
  async leaveSession(): Promise<void> {
    if (!this.currentSession || !this.currentMember) {
      return;
    }

    const session = this.currentSession;
    const memberIndex = session.members.findIndex(m => m.id === this.currentMember!.id);

    if (memberIndex !== -1) {
      session.members.splice(memberIndex, 1);
      session.updatedAt = new Date();

      this.addAuditEntry(session, 'member_left', {
        memberId: this.currentMember.id,
        memberName: this.currentMember.name,
      });

      // If owner leaves and there are other members, transfer ownership
      if (session.owner === this.currentMember.id && session.members.length > 0) {
        const newOwner = session.members.find(m => m.role === 'admin') || session.members[0];
        session.owner = newOwner.id;
        newOwner.role = 'owner';

        this.addAuditEntry(session, 'ownership_transferred', {
          newOwnerId: newOwner.id,
          newOwnerName: newOwner.name,
        });
      }

      // If no members left, close session
      if (session.members.length === 0) {
        session.state.isActive = false;
        this.addAuditEntry(session, 'session_closed', {});
      }

      await this.saveSession(session);
    }

    this.disconnectWebSocket();
    this.emit('session:left', { sessionId: session.id });
    this.currentSession = null;
  }

  /**
   * Invite member to session
   */
  async inviteMember(email: string, role: TeamMember['role'] = 'viewer'): Promise<string> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    if (!this.hasPermission('share')) {
      throw new Error('No permission to invite members');
    }

    const inviteCode = this.generateShareCode();

    // Store invite
    const invitePath = path.join(this.sessionsDir, 'invites', `${inviteCode}.json`);
    await fs.ensureDir(path.dirname(invitePath));
    await fs.writeJSON(invitePath, {
      sessionId: this.currentSession.id,
      email,
      role,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });

    this.addAuditEntry(this.currentSession, 'member_invited', { email, role });
    await this.saveSession(this.currentSession);

    this.emit('member:invited', { email, inviteCode });

    return inviteCode;
  }

  /**
   * Update member role
   */
  async updateMemberRole(memberId: string, newRole: TeamMember['role']): Promise<void> {
    if (!this.currentSession || !this.currentMember) {
      throw new Error('No active session');
    }

    // Only owner and admins can change roles
    if (this.currentMember.role !== 'owner' && this.currentMember.role !== 'admin') {
      throw new Error('Insufficient permissions');
    }

    // Can't change owner's role
    if (memberId === this.currentSession.owner) {
      throw new Error("Cannot change owner's role");
    }

    const member = this.currentSession.members.find(m => m.id === memberId);
    if (!member) {
      throw new Error('Member not found');
    }

    const oldRole = member.role;
    member.role = newRole;
    this.currentSession.updatedAt = new Date();

    this.addAuditEntry(this.currentSession, 'role_changed', {
      memberId,
      memberName: member.name,
      oldRole,
      newRole,
    });

    await this.saveSession(this.currentSession);
    this.emit('member:roleChanged', { member, oldRole, newRole });
  }

  /**
   * Remove member from session
   */
  async removeMember(memberId: string): Promise<void> {
    if (!this.currentSession || !this.currentMember) {
      throw new Error('No active session');
    }

    if (this.currentMember.role !== 'owner' && this.currentMember.role !== 'admin') {
      throw new Error('Insufficient permissions');
    }

    if (memberId === this.currentSession.owner) {
      throw new Error('Cannot remove session owner');
    }

    const memberIndex = this.currentSession.members.findIndex(m => m.id === memberId);
    if (memberIndex === -1) {
      throw new Error('Member not found');
    }

    const member = this.currentSession.members[memberIndex];
    this.currentSession.members.splice(memberIndex, 1);
    this.currentSession.updatedAt = new Date();

    this.addAuditEntry(this.currentSession, 'member_removed', {
      memberId,
      memberName: member.name,
      removedBy: this.currentMember.name,
    });

    await this.saveSession(this.currentSession);
    this.emit('member:removed', { member });
  }

  /**
   * Share a message with the team
   */
  async shareMessage(content: string, type: 'user' | 'assistant' = 'user'): Promise<void> {
    if (!this.currentSession || !this.currentMember) {
      throw new Error('No active session');
    }

    const message: ConversationMessage = {
      id: this.generateId(),
      memberId: this.currentMember.id,
      memberName: this.currentMember.name,
      content,
      timestamp: new Date(),
      type,
    };

    this.currentSession.state.sharedContext.conversationHistory.push(message);
    this.currentSession.updatedAt = new Date();

    await this.saveSession(this.currentSession);
    this.broadcastUpdate('message', message);

    this.emit('message:shared', { message });
  }

  /**
   * Share a file with the team
   */
  async shareFile(filePath: string): Promise<void> {
    if (!this.currentSession || !this.currentMember) {
      throw new Error('No active session');
    }

    if (!this.currentSession.state.sharedContext.sharedFiles.includes(filePath)) {
      this.currentSession.state.sharedContext.sharedFiles.push(filePath);
      this.currentSession.updatedAt = new Date();

      this.addAuditEntry(this.currentSession, 'file_shared', {
        filePath,
        sharedBy: this.currentMember.name,
      });

      await this.saveSession(this.currentSession);
      this.broadcastUpdate('file_shared', { filePath });

      this.emit('file:shared', { filePath });
    }
  }

  /**
   * Add annotation to a file
   */
  async addAnnotation(file: string, line: number, content: string): Promise<Annotation> {
    if (!this.currentSession || !this.currentMember) {
      throw new Error('No active session');
    }

    const annotation: Annotation = {
      id: this.generateId(),
      memberId: this.currentMember.id,
      file,
      line,
      content,
      createdAt: new Date(),
      resolved: false,
    };

    this.currentSession.state.sharedContext.annotations.push(annotation);
    this.currentSession.updatedAt = new Date();

    await this.saveSession(this.currentSession);
    this.broadcastUpdate('annotation', annotation);

    this.emit('annotation:added', { annotation });

    return annotation;
  }

  /**
   * Update cursor position
   */
  updateCursorPosition(file: string, line: number, column: number): void {
    if (!this.currentSession || !this.currentMember) {
      return;
    }

    const position: CursorPosition = {
      memberId: this.currentMember.id,
      file,
      line,
      column,
    };

    this.currentSession.state.cursorPositions.set(this.currentMember.id, position);
    this.broadcastUpdate('cursor', position);
  }

  /**
   * Submit a change for approval
   */
  async submitChange(
    type: PendingChange['type'],
    target: string,
    content?: string
  ): Promise<PendingChange> {
    if (!this.currentSession || !this.currentMember) {
      throw new Error('No active session');
    }

    const change: PendingChange = {
      id: this.generateId(),
      memberId: this.currentMember.id,
      type,
      target,
      content,
      timestamp: new Date(),
      status: 'pending',
    };

    // If member has write permission, auto-approve
    if (this.hasPermission('write')) {
      change.status = 'approved';
      change.approvedBy = this.currentMember.id;
    }

    this.currentSession.state.pendingChanges.push(change);
    this.currentSession.updatedAt = new Date();

    await this.saveSession(this.currentSession);
    this.broadcastUpdate('change_submitted', change);

    this.emit('change:submitted', { change });

    return change;
  }

  /**
   * Approve a pending change
   */
  async approveChange(changeId: string): Promise<void> {
    if (!this.currentSession || !this.currentMember) {
      throw new Error('No active session');
    }

    if (this.currentMember.role === 'viewer') {
      throw new Error('Viewers cannot approve changes');
    }

    const change = this.currentSession.state.pendingChanges.find(c => c.id === changeId);
    if (!change) {
      throw new Error('Change not found');
    }

    change.status = 'approved';
    change.approvedBy = this.currentMember.id;
    this.currentSession.updatedAt = new Date();

    this.addAuditEntry(this.currentSession, 'change_approved', {
      changeId,
      approvedBy: this.currentMember.name,
    });

    await this.saveSession(this.currentSession);
    this.broadcastUpdate('change_approved', { changeId, approvedBy: this.currentMember.id });

    this.emit('change:approved', { change });
  }

  /**
   * Reject a pending change
   */
  async rejectChange(changeId: string, reason?: string): Promise<void> {
    if (!this.currentSession || !this.currentMember) {
      throw new Error('No active session');
    }

    if (this.currentMember.role === 'viewer') {
      throw new Error('Viewers cannot reject changes');
    }

    const change = this.currentSession.state.pendingChanges.find(c => c.id === changeId);
    if (!change) {
      throw new Error('Change not found');
    }

    change.status = 'rejected';
    this.currentSession.updatedAt = new Date();

    this.addAuditEntry(this.currentSession, 'change_rejected', {
      changeId,
      rejectedBy: this.currentMember.name,
      reason,
    });

    await this.saveSession(this.currentSession);
    this.broadcastUpdate('change_rejected', { changeId, reason });

    this.emit('change:rejected', { change, reason });
  }

  /**
   * Check if current member has permission
   */
  hasPermission(action: Permission['actions'][number]): boolean {
    if (!this.currentSession || !this.currentMember) {
      return false;
    }

    // Owner and admin have all permissions
    if (this.currentMember.role === 'owner' || this.currentMember.role === 'admin') {
      return true;
    }

    // Editor can read, write, execute
    if (this.currentMember.role === 'editor') {
      return ['read', 'write', 'execute'].includes(action);
    }

    // Viewer can only read
    if (this.currentMember.role === 'viewer') {
      return action === 'read';
    }

    return false;
  }

  /**
   * Add entry to audit log
   */
  private addAuditEntry(session: SharedSession, action: string, details: Record<string, unknown>): void {
    session.auditLog.push({
      id: this.generateId(),
      timestamp: new Date(),
      memberId: this.currentMember?.id || 'system',
      memberName: this.currentMember?.name || 'System',
      action,
      details,
    });

    // Keep only last 1000 entries
    if (session.auditLog.length > 1000) {
      session.auditLog = session.auditLog.slice(-1000);
    }
  }

  /**
   * Save session to disk
   */
  private async saveSession(session: SharedSession): Promise<void> {
    const sessionPath = path.join(this.sessionsDir, `${session.id}.json`);

    // Convert Map to object for serialization
    const serializable = {
      ...session,
      state: {
        ...session.state,
        cursorPositions: Object.fromEntries(session.state.cursorPositions),
      },
    };

    if (this.config.enableEncryption && this.config.encryptionKey) {
      const encrypted = this.encrypt(JSON.stringify(serializable));
      await fs.writeFile(sessionPath, encrypted);
    } else {
      await fs.writeJSON(sessionPath, serializable, { spaces: 2 });
    }
  }

  /**
   * Load session from disk
   */
  private async loadSession(sessionId: string): Promise<SharedSession | null> {
    const sessionPath = path.join(this.sessionsDir, `${sessionId}.json`);

    if (!await fs.pathExists(sessionPath)) {
      return null;
    }

    try {
      let data: string | object;

      if (this.config.enableEncryption && this.config.encryptionKey) {
        const encrypted = await fs.readFile(sessionPath, 'utf-8');
        data = JSON.parse(this.decrypt(encrypted));
      } else {
        data = await fs.readJSON(sessionPath);
      }

      const session = data as SharedSession;

      // Convert object back to Map
      session.state.cursorPositions = new Map(
        Object.entries((session.state as any).cursorPositions || {})
      );

      // Convert date strings to Date objects
      session.createdAt = new Date(session.createdAt);
      session.updatedAt = new Date(session.updatedAt);
      if (session.expiresAt) {
        session.expiresAt = new Date(session.expiresAt);
      }

      return session;
    } catch {
      return null;
    }
  }

  /**
   * Encrypt data
   */
  private encrypt(data: string): string {
    if (!this.config.encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(this.config.encryptionKey, 'salt', 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return JSON.stringify({
      iv: iv.toString('hex'),
      data: encrypted,
      tag: authTag.toString('hex'),
    });
  }

  /**
   * Decrypt data
   */
  private decrypt(encryptedData: string): string {
    if (!this.config.encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    const { iv, data, tag } = JSON.parse(encryptedData);
    const key = crypto.scryptSync(this.config.encryptionKey, 'salt', 32);
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'hex')
    );

    decipher.setAuthTag(Buffer.from(tag, 'hex'));

    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Connect to WebSocket server for real-time updates
   */
  private connectWebSocket(sessionId: string): void {
    if (!this.config.serverUrl) {
      return;
    }

    try {
      this.ws = new WebSocket(`${this.config.serverUrl}/sessions/${sessionId}`);

      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.emit('ws:connected');
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(message);
        } catch {
          // Invalid message
        }
      });

      this.ws.on('close', () => {
        this.stopHeartbeat();
        this.emit('ws:disconnected');

        if (this.config.autoReconnect && this.reconnectAttempts < this.config.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => {
            this.connectWebSocket(sessionId);
          }, this.config.reconnectInterval);
        }
      });

      this.ws.on('error', (error) => {
        this.emit('error', error);
      });
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Disconnect WebSocket
   */
  private disconnectWebSocket(): void {
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Handle WebSocket message
   */
  private handleWebSocketMessage(message: { type: string; payload: any }): void {
    switch (message.type) {
      case 'member_joined':
        if (this.currentSession) {
          this.currentSession.members.push(message.payload);
          this.emit('member:joined', { member: message.payload });
        }
        break;

      case 'member_left':
        if (this.currentSession) {
          const idx = this.currentSession.members.findIndex(m => m.id === message.payload.id);
          if (idx !== -1) {
            this.currentSession.members.splice(idx, 1);
            this.emit('member:left', { member: message.payload });
          }
        }
        break;

      case 'cursor':
        if (this.currentSession) {
          this.currentSession.state.cursorPositions.set(message.payload.memberId, message.payload);
          this.emit('cursor:updated', { position: message.payload });
        }
        break;

      case 'message':
        if (this.currentSession) {
          this.currentSession.state.sharedContext.conversationHistory.push(message.payload);
          this.emit('message:received', { message: message.payload });
        }
        break;

      default:
        this.emit('ws:message', message);
    }
  }

  /**
   * Broadcast update to all members
   */
  private broadcastUpdate(type: string, payload: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  /**
   * Get current session
   */
  getCurrentSession(): SharedSession | null {
    return this.currentSession;
  }

  /**
   * Get current member
   */
  getCurrentMember(): TeamMember | null {
    return this.currentMember;
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<SharedSession[]> {
    const sessions: SharedSession[] = [];
    const files = await fs.readdir(this.sessionsDir);

    for (const file of files) {
      if (file.endsWith('.json')) {
        const sessionId = file.replace('.json', '');
        const session = await this.loadSession(sessionId);
        if (session) {
          sessions.push(session);
        }
      }
    }

    return sessions;
  }

  /**
   * Get session audit log
   */
  getAuditLog(): AuditEntry[] {
    return this.currentSession?.auditLog || [];
  }

  /**
   * Export session
   */
  async exportSession(format: 'json' | 'markdown' = 'json'): Promise<string> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    if (format === 'json') {
      return JSON.stringify(this.currentSession, null, 2);
    }

    // Markdown format
    let md = `# Session: ${this.currentSession.name}\n\n`;
    md += `**Created:** ${this.currentSession.createdAt.toISOString()}\n`;
    md += `**Members:** ${this.currentSession.members.length}\n\n`;

    md += `## Conversation\n\n`;
    for (const msg of this.currentSession.state.sharedContext.conversationHistory) {
      md += `### ${msg.memberName} (${msg.timestamp})\n`;
      md += `${msg.content}\n\n`;
    }

    md += `## Shared Files\n\n`;
    for (const file of this.currentSession.state.sharedContext.sharedFiles) {
      md += `- ${file}\n`;
    }

    return md;
  }

  /**
   * Format session status
   */
  formatStatus(): string {
    if (!this.currentSession) {
      return 'No active session. Use /team create <name> to start one.';
    }

    const session = this.currentSession;
    const lines = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║                    👥 TEAM SESSION                           ║',
      '╠══════════════════════════════════════════════════════════════╣',
      `║ Name:     ${session.name.padEnd(49)}║`,
      `║ ID:       ${session.id.slice(0, 20).padEnd(49)}║`,
      `║ Status:   ${session.state.isActive ? '🟢 Active' : '🔴 Inactive'}${''.padEnd(40)}║`,
      '╠══════════════════════════════════════════════════════════════╣',
      '║ MEMBERS                                                      ║',
    ];

    for (const member of session.members) {
      const status = member.status === 'online' ? '🟢' : member.status === 'away' ? '🟡' : '⚪';
      const role = member.role.toUpperCase().padEnd(6);
      lines.push(`║ ${status} ${member.name.padEnd(20)} [${role}]${''.padEnd(27)}║`);
    }

    lines.push('╠══════════════════════════════════════════════════════════════╣');
    lines.push(`║ Shared Files: ${session.state.sharedContext.sharedFiles.length}${''.padEnd(45)}║`);
    lines.push(`║ Messages:     ${session.state.sharedContext.conversationHistory.length}${''.padEnd(45)}║`);
    lines.push(`║ Annotations:  ${session.state.sharedContext.annotations.length}${''.padEnd(45)}║`);
    lines.push('╠══════════════════════════════════════════════════════════════╣');
    lines.push('║ /team invite <email> | /team leave | /team export            ║');
    lines.push('╚══════════════════════════════════════════════════════════════╝');

    return lines.join('\n');
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.disconnectWebSocket();
    this.removeAllListeners();
  }
}

// Singleton
let sessionManagerInstance: TeamSessionManager | null = null;

export function getTeamSessionManager(config?: Partial<TeamSessionConfig>): TeamSessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new TeamSessionManager(config);
  }
  return sessionManagerInstance;
}

export function resetTeamSessionManager(): void {
  if (sessionManagerInstance) {
    sessionManagerInstance.dispose();
  }
  sessionManagerInstance = null;
}
