/**
 * Collaborative Mode
 *
 * Enables real-time collaboration between multiple users:
 * - Shared session state
 * - Synchronized tool executions
 * - Role-based permissions
 * - Conflict resolution
 * - Activity streaming
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import WebSocket, { WebSocketServer } from 'ws';

// ============================================================================
// Types
// ============================================================================

export interface Collaborator {
  id: string;
  name: string;
  color: string;
  role: CollaboratorRole;
  cursor?: CursorPosition;
  lastSeen: number;
  status: 'online' | 'away' | 'offline';
}

export type CollaboratorRole = 'owner' | 'editor' | 'viewer';

export interface CursorPosition {
  file?: string;
  line?: number;
  column?: number;
}

export interface CollaborationSession {
  id: string;
  name: string;
  createdAt: number;
  createdBy: string;
  collaborators: Map<string, Collaborator>;
  state: SessionState;
  history: SessionEvent[];
  settings: SessionSettings;
}

export interface SessionState {
  activeFile?: string;
  openFiles: string[];
  pendingToolCalls: ToolCallState[];
  sharedVariables: Record<string, unknown>;
  lastModified: number;
}

export interface ToolCallState {
  id: string;
  name: string;
  args: Record<string, unknown>;
  initiatedBy: string;
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';
  approvals: string[];
  rejections: string[];
  result?: unknown;
}

export interface SessionEvent {
  id: string;
  type: EventType;
  timestamp: number;
  collaboratorId: string;
  data: unknown;
}

export type EventType =
  | 'join'
  | 'leave'
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'file_change'
  | 'cursor_move'
  | 'approval'
  | 'rejection'
  | 'state_sync';

export interface SessionSettings {
  requireApproval: boolean;
  approvalThreshold: number; // 0-1, percentage of collaborators needed
  allowViewerMessages: boolean;
  maxCollaborators: number;
  autoSyncInterval: number;
}

export interface CollaborationMessage {
  type: 'sync' | 'event' | 'request' | 'response' | 'ping' | 'pong';
  sessionId: string;
  senderId: string;
  timestamp: number;
  payload: unknown;
}

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_SETTINGS: SessionSettings = {
  requireApproval: true,
  approvalThreshold: 0.5,
  allowViewerMessages: true,
  maxCollaborators: 10,
  autoSyncInterval: 5000,
};

const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1',
];

// ============================================================================
// Collaboration Server
// ============================================================================

export class CollaborationServer extends EventEmitter {
  private sessions: Map<string, CollaborationSession> = new Map();
  private connections: Map<string, WebSocket> = new Map();
  private collaboratorSessions: Map<string, string> = new Map(); // collaboratorId -> sessionId
  private wss: WebSocketServer | null = null;

  /**
   * Start the collaboration server
   */
  start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port });

        this.wss.on('connection', (ws) => {
          const connectionId = this.generateId();

          ws.on('message', (data: Buffer) => {
            try {
              const message = JSON.parse(data.toString()) as CollaborationMessage;
              this.handleMessage(connectionId, ws, message);
            } catch (error) {
              this.sendError(ws, 'Invalid message format');
            }
          });

          ws.on('close', () => {
            this.handleDisconnect(connectionId);
          });

          ws.on('error', (error) => {
            this.emit('error', { connectionId, error });
          });

          // Send connection acknowledgment
          this.send(ws, {
            type: 'response',
            sessionId: '',
            senderId: 'server',
            timestamp: Date.now(),
            payload: { connectionId },
          });
        });

        this.wss.on('listening', () => {
          this.emit('listening', { port });
          resolve();
        });

        this.wss.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming message
   */
  private handleMessage(connectionId: string, ws: WebSocket, message: CollaborationMessage): void {
    switch (message.type) {
      case 'request':
        this.handleRequest(connectionId, ws, message);
        break;
      case 'event':
        this.handleEvent(connectionId, message);
        break;
      case 'ping':
        this.send(ws, { ...message, type: 'pong' });
        break;
    }
  }

  /**
   * Handle request message
   */
  private handleRequest(connectionId: string, ws: WebSocket, message: CollaborationMessage): void {
    const payload = message.payload as { action: string; data?: unknown };

    switch (payload.action) {
      case 'create_session':
        this.createSession(connectionId, ws, message.senderId, payload.data as { name: string });
        break;
      case 'join_session':
        this.joinSession(connectionId, ws, message.senderId, payload.data as { sessionId: string; name: string });
        break;
      case 'leave_session':
        this.leaveSession(connectionId, message.senderId);
        break;
      case 'get_state':
        this.sendState(ws, message.sessionId);
        break;
      case 'tool_call':
        this.handleToolCall(message.sessionId, message.senderId, payload.data as ToolCallState);
        break;
      case 'approve':
        this.handleApproval(message.sessionId, message.senderId, payload.data as { toolCallId: string });
        break;
      case 'reject':
        this.handleRejection(message.sessionId, message.senderId, payload.data as { toolCallId: string; reason?: string });
        break;
    }
  }

  /**
   * Handle event message
   */
  private handleEvent(_connectionId: string, message: CollaborationMessage): void {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    const event: SessionEvent = {
      id: this.generateId(),
      type: (message.payload as { type: EventType }).type,
      timestamp: message.timestamp,
      collaboratorId: message.senderId,
      data: (message.payload as { data: unknown }).data,
    };

    session.history.push(event);

    // Broadcast to all collaborators
    this.broadcast(message.sessionId, {
      type: 'event',
      sessionId: message.sessionId,
      senderId: 'server',
      timestamp: Date.now(),
      payload: event,
    }, message.senderId);
  }

  /**
   * Create a new session
   */
  private createSession(
    connectionId: string,
    ws: WebSocket,
    collaboratorId: string,
    data: { name: string }
  ): void {
    const sessionId = this.generateId();
    const color = COLORS[0];

    const session: CollaborationSession = {
      id: sessionId,
      name: data.name || `Session ${sessionId.slice(0, 8)}`,
      createdAt: Date.now(),
      createdBy: collaboratorId,
      collaborators: new Map(),
      state: {
        openFiles: [],
        pendingToolCalls: [],
        sharedVariables: {},
        lastModified: Date.now(),
      },
      history: [],
      settings: { ...DEFAULT_SETTINGS },
    };

    const collaborator: Collaborator = {
      id: collaboratorId,
      name: data.name,
      color,
      role: 'owner',
      lastSeen: Date.now(),
      status: 'online',
    };

    session.collaborators.set(collaboratorId, collaborator);
    this.sessions.set(sessionId, session);
    this.connections.set(collaboratorId, ws);
    this.collaboratorSessions.set(collaboratorId, sessionId);

    this.send(ws, {
      type: 'response',
      sessionId,
      senderId: 'server',
      timestamp: Date.now(),
      payload: {
        action: 'session_created',
        session: this.serializeSession(session),
        collaborator,
      },
    });

    this.emit('session:created', { sessionId, createdBy: collaboratorId });
  }

  /**
   * Join an existing session
   */
  private joinSession(
    connectionId: string,
    ws: WebSocket,
    collaboratorId: string,
    data: { sessionId: string; name: string }
  ): void {
    const session = this.sessions.get(data.sessionId);
    if (!session) {
      this.sendError(ws, 'Session not found');
      return;
    }

    if (session.collaborators.size >= session.settings.maxCollaborators) {
      this.sendError(ws, 'Session is full');
      return;
    }

    const colorIndex = session.collaborators.size % COLORS.length;
    const color = COLORS[colorIndex];

    const collaborator: Collaborator = {
      id: collaboratorId,
      name: data.name,
      color,
      role: 'editor',
      lastSeen: Date.now(),
      status: 'online',
    };

    session.collaborators.set(collaboratorId, collaborator);
    this.connections.set(collaboratorId, ws);
    this.collaboratorSessions.set(collaboratorId, data.sessionId);

    // Send join response
    this.send(ws, {
      type: 'response',
      sessionId: data.sessionId,
      senderId: 'server',
      timestamp: Date.now(),
      payload: {
        action: 'joined',
        session: this.serializeSession(session),
        collaborator,
      },
    });

    // Broadcast join event
    this.broadcast(data.sessionId, {
      type: 'event',
      sessionId: data.sessionId,
      senderId: 'server',
      timestamp: Date.now(),
      payload: {
        type: 'join',
        collaborator,
      },
    }, collaboratorId);

    this.emit('collaborator:joined', { sessionId: data.sessionId, collaborator });
  }

  /**
   * Leave session
   */
  private leaveSession(connectionId: string, collaboratorId: string): void {
    const sessionId = this.collaboratorSessions.get(collaboratorId);
    if (!sessionId) return;

    const session = this.sessions.get(sessionId);
    if (!session) return;

    const collaborator = session.collaborators.get(collaboratorId);
    session.collaborators.delete(collaboratorId);
    this.connections.delete(collaboratorId);
    this.collaboratorSessions.delete(collaboratorId);

    // Broadcast leave event
    this.broadcast(sessionId, {
      type: 'event',
      sessionId,
      senderId: 'server',
      timestamp: Date.now(),
      payload: {
        type: 'leave',
        collaboratorId,
        collaboratorName: collaborator?.name,
      },
    });

    // Clean up empty sessions
    if (session.collaborators.size === 0) {
      this.sessions.delete(sessionId);
      this.emit('session:ended', { sessionId });
    }

    this.emit('collaborator:left', { sessionId, collaboratorId });
  }

  /**
   * Handle disconnect
   */
  private handleDisconnect(connectionId: string): void {
    // Find collaborator by connection
    for (const [collaboratorId, ws] of this.connections) {
      // Check if this is the disconnected connection
      const sessionId = this.collaboratorSessions.get(collaboratorId);
      if (sessionId) {
        this.leaveSession(connectionId, collaboratorId);
        break;
      }
    }
  }

  /**
   * Handle tool call request
   */
  private handleToolCall(sessionId: string, initiatorId: string, toolCall: ToolCallState): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const collaborator = session.collaborators.get(initiatorId);
    if (!collaborator || collaborator.role === 'viewer') {
      return;
    }

    const state: ToolCallState = {
      ...toolCall,
      id: this.generateId(),
      initiatedBy: initiatorId,
      status: session.settings.requireApproval ? 'pending' : 'approved',
      approvals: session.settings.requireApproval ? [] : [initiatorId],
      rejections: [],
    };

    session.state.pendingToolCalls.push(state);

    // Broadcast tool call to all collaborators
    this.broadcast(sessionId, {
      type: 'event',
      sessionId,
      senderId: 'server',
      timestamp: Date.now(),
      payload: {
        type: 'tool_call',
        toolCall: state,
      },
    });

    // If no approval needed, execute immediately
    if (!session.settings.requireApproval) {
      this.emit('tool:execute', { sessionId, toolCall: state });
    }
  }

  /**
   * Handle approval
   */
  private handleApproval(sessionId: string, approverId: string, data: { toolCallId: string }): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const collaborator = session.collaborators.get(approverId);
    if (!collaborator || collaborator.role === 'viewer') {
      return;
    }

    const toolCall = session.state.pendingToolCalls.find(tc => tc.id === data.toolCallId);
    if (!toolCall || toolCall.status !== 'pending') {
      return;
    }

    if (!toolCall.approvals.includes(approverId)) {
      toolCall.approvals.push(approverId);
    }

    // Check if threshold is met
    const approvalRatio = toolCall.approvals.length / session.collaborators.size;
    if (approvalRatio >= session.settings.approvalThreshold) {
      toolCall.status = 'approved';
      this.emit('tool:execute', { sessionId, toolCall });
    }

    // Broadcast approval
    this.broadcast(sessionId, {
      type: 'event',
      sessionId,
      senderId: 'server',
      timestamp: Date.now(),
      payload: {
        type: 'approval',
        toolCallId: data.toolCallId,
        approverId,
        approvalCount: toolCall.approvals.length,
        threshold: Math.ceil(session.collaborators.size * session.settings.approvalThreshold),
        status: toolCall.status,
      },
    });
  }

  /**
   * Handle rejection
   */
  private handleRejection(
    sessionId: string,
    rejecterId: string,
    data: { toolCallId: string; reason?: string }
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const collaborator = session.collaborators.get(rejecterId);
    if (!collaborator || collaborator.role === 'viewer') {
      return;
    }

    const toolCall = session.state.pendingToolCalls.find(tc => tc.id === data.toolCallId);
    if (!toolCall || toolCall.status !== 'pending') {
      return;
    }

    toolCall.rejections.push(rejecterId);
    toolCall.status = 'rejected';

    // Broadcast rejection
    this.broadcast(sessionId, {
      type: 'event',
      sessionId,
      senderId: 'server',
      timestamp: Date.now(),
      payload: {
        type: 'rejection',
        toolCallId: data.toolCallId,
        rejecterId,
        reason: data.reason,
      },
    });
  }

  /**
   * Send state to client
   */
  private sendState(ws: WebSocket, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sendError(ws, 'Session not found');
      return;
    }

    this.send(ws, {
      type: 'sync',
      sessionId,
      senderId: 'server',
      timestamp: Date.now(),
      payload: {
        state: session.state,
        collaborators: Array.from(session.collaborators.values()),
      },
    });
  }

  /**
   * Broadcast message to all collaborators
   */
  private broadcast(sessionId: string, message: CollaborationMessage, excludeId?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    for (const [collaboratorId] of session.collaborators) {
      if (collaboratorId === excludeId) continue;

      const ws = this.connections.get(collaboratorId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        this.send(ws, message);
      }
    }
  }

  /**
   * Send message to client
   */
  private send(ws: WebSocket, message: CollaborationMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send error to client
   */
  private sendError(ws: WebSocket, error: string): void {
    this.send(ws, {
      type: 'response',
      sessionId: '',
      senderId: 'server',
      timestamp: Date.now(),
      payload: { error },
    });
  }

  /**
   * Serialize session for transmission
   */
  private serializeSession(session: CollaborationSession): unknown {
    return {
      id: session.id,
      name: session.name,
      createdAt: session.createdAt,
      createdBy: session.createdBy,
      collaborators: Array.from(session.collaborators.values()),
      state: session.state,
      settings: session.settings,
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): CollaborationSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getSessions(): CollaborationSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Stop the server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          this.sessions.clear();
          this.connections.clear();
          this.collaboratorSessions.clear();
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

// ============================================================================
// Collaboration Client
// ============================================================================

export class CollaborationClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private collaboratorId: string;
  private name: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(name: string) {
    super();
    this.collaboratorId = crypto.randomBytes(8).toString('hex');
    this.name = name;
  }

  /**
   * Connect to collaboration server
   */
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
          this.reconnectAttempts = 0;
          this.startPing();
          resolve();
        });

        this.ws.on('message', (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString()) as CollaborationMessage;
            this.handleMessage(message);
          } catch (error) {
            this.emit('error', error);
          }
        });

        this.ws.on('close', () => {
          this.stopPing();
          this.emit('disconnected');
          this.attemptReconnect(url);
        });

        this.ws.on('error', (error) => {
          reject(error);
          this.emit('error', error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming message
   */
  private handleMessage(message: CollaborationMessage): void {
    switch (message.type) {
      case 'response':
        this.handleResponse(message.payload);
        break;
      case 'event':
        this.emit('event', message.payload);
        break;
      case 'sync':
        this.emit('sync', message.payload);
        break;
      case 'pong':
        // Heartbeat acknowledged
        break;
    }
  }

  /**
   * Handle response
   */
  private handleResponse(payload: unknown): void {
    const response = payload as { action?: string; error?: string; session?: unknown; collaborator?: Collaborator };

    if (response.error) {
      this.emit('error', new Error(response.error));
      return;
    }

    switch (response.action) {
      case 'session_created':
      case 'joined':
        this.sessionId = (response.session as { id: string }).id;
        this.emit('session:joined', response.session);
        break;
    }
  }

  /**
   * Create a new session
   */
  createSession(name: string): void {
    this.send({
      type: 'request',
      sessionId: '',
      senderId: this.collaboratorId,
      timestamp: Date.now(),
      payload: { action: 'create_session', data: { name } },
    });
  }

  /**
   * Join an existing session
   */
  joinSession(sessionId: string): void {
    this.send({
      type: 'request',
      sessionId,
      senderId: this.collaboratorId,
      timestamp: Date.now(),
      payload: { action: 'join_session', data: { sessionId, name: this.name } },
    });
  }

  /**
   * Leave current session
   */
  leaveSession(): void {
    if (!this.sessionId) return;

    this.send({
      type: 'request',
      sessionId: this.sessionId,
      senderId: this.collaboratorId,
      timestamp: Date.now(),
      payload: { action: 'leave_session' },
    });

    this.sessionId = null;
  }

  /**
   * Request tool execution
   */
  requestToolCall(name: string, args: Record<string, unknown>): void {
    if (!this.sessionId) return;

    this.send({
      type: 'request',
      sessionId: this.sessionId,
      senderId: this.collaboratorId,
      timestamp: Date.now(),
      payload: {
        action: 'tool_call',
        data: { name, args },
      },
    });
  }

  /**
   * Approve tool call
   */
  approve(toolCallId: string): void {
    if (!this.sessionId) return;

    this.send({
      type: 'request',
      sessionId: this.sessionId,
      senderId: this.collaboratorId,
      timestamp: Date.now(),
      payload: {
        action: 'approve',
        data: { toolCallId },
      },
    });
  }

  /**
   * Reject tool call
   */
  reject(toolCallId: string, reason?: string): void {
    if (!this.sessionId) return;

    this.send({
      type: 'request',
      sessionId: this.sessionId,
      senderId: this.collaboratorId,
      timestamp: Date.now(),
      payload: {
        action: 'reject',
        data: { toolCallId, reason },
      },
    });
  }

  /**
   * Send event
   */
  sendEvent(type: EventType, data: unknown): void {
    if (!this.sessionId) return;

    this.send({
      type: 'event',
      sessionId: this.sessionId,
      senderId: this.collaboratorId,
      timestamp: Date.now(),
      payload: { type, data },
    });
  }

  /**
   * Send message
   */
  private send(message: CollaborationMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Start ping interval
   */
  private startPing(): void {
    this.pingInterval = setInterval(() => {
      this.send({
        type: 'ping',
        sessionId: this.sessionId || '',
        senderId: this.collaboratorId,
        timestamp: Date.now(),
        payload: null,
      });
    }, 30000);
  }

  /**
   * Stop ping interval
   */
  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Attempt reconnection
   */
  private attemptReconnect(url: string): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('reconnect:failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    setTimeout(() => {
      this.emit('reconnecting', { attempt: this.reconnectAttempts });
      this.connect(url).catch((err) => {
        this.emit('reconnect:error', {
          attempt: this.reconnectAttempts,
          error: err.message || String(err)
        });
        // Will retry on next close event
      });
    }, delay);
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Get collaborator ID
   */
  getCollaboratorId(): string {
    return this.collaboratorId;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createCollaborationServer(): CollaborationServer {
  return new CollaborationServer();
}

export function createCollaborationClient(name: string): CollaborationClient {
  return new CollaborationClient(name);
}
