/**
 * Team Mode with Shared Context (Item 101)
 * Enables team collaboration with shared AI context
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

export interface TeamMember {
  id: string;
  name: string;
  role: 'admin' | 'member' | 'viewer';
  joinedAt: Date;
  lastActive: Date;
}

export interface SharedTeamContext {
  projectInfo: { name: string; path: string; description: string };
  sharedKnowledge: Map<string, string>;
  codePatterns: string[];
  conventions: string[];
  history: TeamAction[];
}

export interface TeamAction {
  id: string;
  memberId: string;
  type: 'query' | 'edit' | 'commit' | 'review';
  summary: string;
  timestamp: Date;
}

export interface TeamConfig {
  teamId: string;
  syncInterval?: number;
  maxMembers?: number;
  retentionDays?: number;
}

export class TeamModeManager extends EventEmitter {
  private config: Required<TeamConfig>;
  private members: Map<string, TeamMember> = new Map();
  private context: SharedTeamContext;
  private syncTimer: NodeJS.Timeout | null = null;

  constructor(config: TeamConfig) {
    super();
    this.config = {
      syncInterval: 30000,
      maxMembers: 50,
      retentionDays: 30,
      ...config,
    };
    this.context = {
      projectInfo: { name: '', path: '', description: '' },
      sharedKnowledge: new Map(),
      codePatterns: [],
      conventions: [],
      history: [],
    };
  }

  addMember(name: string, role: TeamMember['role'] = 'member'): TeamMember {
    if (this.members.size >= this.config.maxMembers) {
      throw new Error('Team is at capacity');
    }
    const member: TeamMember = {
      id: crypto.randomBytes(8).toString('hex'),
      name,
      role,
      joinedAt: new Date(),
      lastActive: new Date(),
    };
    this.members.set(member.id, member);
    this.emit('member-joined', member);
    return member;
  }

  removeMember(memberId: string): boolean {
    const deleted = this.members.delete(memberId);
    if (deleted) this.emit('member-left', memberId);
    return deleted;
  }

  addKnowledge(key: string, value: string): void {
    this.context.sharedKnowledge.set(key, value);
    this.emit('knowledge-updated', { key, value });
  }

  addPattern(pattern: string): void {
    if (!this.context.codePatterns.includes(pattern)) {
      this.context.codePatterns.push(pattern);
    }
  }

  addConvention(convention: string): void {
    if (!this.context.conventions.includes(convention)) {
      this.context.conventions.push(convention);
    }
  }

  recordAction(memberId: string, type: TeamAction['type'], summary: string): TeamAction {
    const action: TeamAction = {
      id: crypto.randomBytes(8).toString('hex'),
      memberId,
      type,
      summary,
      timestamp: new Date(),
    };
    this.context.history.push(action);
    this.emit('action-recorded', action);
    return action;
  }

  getContext(): SharedTeamContext {
    return this.context;
  }

  getMembers(): TeamMember[] {
    return Array.from(this.members.values());
  }

  startSync(): void {
    this.syncTimer = setInterval(() => {
      this.emit('sync', this.context);
    }, this.config.syncInterval);
  }

  stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  dispose(): void {
    this.stopSync();
    this.members.clear();
    this.removeAllListeners();
  }
}

export function createTeamMode(config: TeamConfig): TeamModeManager {
  return new TeamModeManager(config);
}

export default TeamModeManager;
