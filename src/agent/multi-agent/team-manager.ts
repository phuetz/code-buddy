/**
 * Team Manager
 *
 * Lightweight coordination layer for Agent Teams.
 * Mirrors Claude Code's Agent Teams feature where one session acts as team lead
 * coordinating work, and teammates work independently with their own context
 * windows, communicating via a shared task list and mailbox system.
 */

import { EventEmitter } from 'events';
import { createId } from './base-agent.js';
import type {
  AgentRole,
  TaskStatus,
  TaskPriority,
  AgentMessage,
  SharedContext,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface TeamMember {
  id: string;
  role: AgentRole;
  label: string;
  status: 'idle' | 'working' | 'done' | 'error';
  currentTaskId: string | null;
  completedTasks: number;
  joinedAt: Date;
}

export interface MailboxMessage {
  id: string;
  from: string;       // member ID or 'lead'
  to: string;         // member ID or 'all'
  content: string;
  timestamp: Date;
  read: boolean;
}

export interface TeamTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedTo: string | null;  // member ID
  assignedRole: AgentRole | null;
  dependencies: string[];
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  result?: string;
  error?: string;
}

export type TeamStatus = 'inactive' | 'active' | 'paused' | 'dissolved';

// ============================================================================
// TeamManager
// ============================================================================

export class TeamManager extends EventEmitter {
  private status: TeamStatus = 'inactive';
  private leadId: string | null = null;
  private members: Map<string, TeamMember> = new Map();
  private tasks: Map<string, TeamTask> = new Map();
  private mailbox: MailboxMessage[] = [];
  private teamGoal: string = '';
  private startedAt: Date | null = null;

  constructor() {
    super();
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start a team session. The caller becomes the team lead.
   */
  start(goal: string = ''): { success: boolean; leadId: string; message: string } {
    if (this.status === 'active') {
      return { success: false, leadId: '', message: 'Team is already active. Use /team stop first.' };
    }

    this.leadId = createId('lead');
    this.status = 'active';
    this.teamGoal = goal;
    this.startedAt = new Date();
    this.members.clear();
    this.tasks.clear();
    this.mailbox = [];

    this.emit('team:started', { leadId: this.leadId, goal });

    return {
      success: true,
      leadId: this.leadId,
      message: `Team started. You are the team lead.${goal ? ` Goal: ${goal}` : ''}\nUse /team add <role> to add teammates.`,
    };
  }

  /**
   * Dissolve the team.
   */
  stop(): { success: boolean; message: string } {
    if (this.status !== 'active' && this.status !== 'paused') {
      return { success: false, message: 'No active team to stop.' };
    }

    const memberCount = this.members.size;
    const completedTasks = Array.from(this.tasks.values()).filter(t => t.status === 'completed').length;
    const totalTasks = this.tasks.size;

    this.status = 'dissolved';
    this.emit('team:stopped', { memberCount, completedTasks, totalTasks });

    // Reset
    this.members.clear();
    this.tasks.clear();
    this.mailbox = [];
    this.leadId = null;
    this.teamGoal = '';
    this.startedAt = null;
    this.status = 'inactive';

    return {
      success: true,
      message: `Team dissolved. ${completedTasks}/${totalTasks} tasks completed with ${memberCount} member(s).`,
    };
  }

  // ==========================================================================
  // Member Management
  // ==========================================================================

  /**
   * Add a teammate with a role.
   */
  addMember(role: AgentRole, label?: string): { success: boolean; memberId: string; message: string } {
    if (this.status !== 'active') {
      return { success: false, memberId: '', message: 'Team is not active. Use /team start first.' };
    }

    const validRoles: AgentRole[] = [
      'orchestrator', 'coder', 'reviewer', 'tester',
      'researcher', 'debugger', 'architect', 'documenter',
    ];

    if (!validRoles.includes(role)) {
      return {
        success: false,
        memberId: '',
        message: `Invalid role "${role}". Valid roles: ${validRoles.join(', ')}`,
      };
    }

    const memberId = createId('member');
    const member: TeamMember = {
      id: memberId,
      role,
      label: label || `${role}-${this.members.size + 1}`,
      status: 'idle',
      currentTaskId: null,
      completedTasks: 0,
      joinedAt: new Date(),
    };

    this.members.set(memberId, member);
    this.emit('team:member-added', member);

    return {
      success: true,
      memberId,
      message: `Added ${member.label} (${role}) to the team. ID: ${memberId}`,
    };
  }

  /**
   * Remove a teammate.
   */
  removeMember(memberId: string): { success: boolean; message: string } {
    const member = this.members.get(memberId);
    if (!member) {
      return { success: false, message: `Member ${memberId} not found.` };
    }

    // Unassign any tasks
    for (const task of this.tasks.values()) {
      if (task.assignedTo === memberId) {
        task.assignedTo = null;
        task.status = 'pending';
      }
    }

    this.members.delete(memberId);
    this.emit('team:member-removed', { memberId, role: member.role });

    return { success: true, message: `Removed ${member.label} (${member.role}) from the team.` };
  }

  // ==========================================================================
  // Task Management (Shared Task List)
  // ==========================================================================

  /**
   * Add a task to the shared task list.
   */
  addTask(
    title: string,
    description: string,
    options: {
      priority?: TaskPriority;
      assignedRole?: AgentRole;
      dependencies?: string[];
    } = {}
  ): TeamTask {
    const task: TeamTask = {
      id: createId('task'),
      title,
      description,
      status: 'pending',
      priority: options.priority || 'medium',
      assignedTo: null,
      assignedRole: options.assignedRole || null,
      dependencies: options.dependencies || [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.tasks.set(task.id, task);

    // Auto-assign if a role is specified
    if (task.assignedRole) {
      this.autoAssignTask(task);
    }

    this.emit('team:task-added', task);
    return task;
  }

  /**
   * Update a task's status.
   */
  updateTask(
    taskId: string,
    updates: {
      status?: TaskStatus;
      assignedTo?: string;
      result?: string;
      error?: string;
    }
  ): { success: boolean; message: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, message: `Task ${taskId} not found.` };
    }

    if (updates.status) task.status = updates.status;
    if (updates.assignedTo !== undefined) task.assignedTo = updates.assignedTo;
    if (updates.result) task.result = updates.result;
    if (updates.error) task.error = updates.error;
    task.updatedAt = new Date();

    if (updates.status === 'completed') {
      task.completedAt = new Date();
      // Update member stats
      if (task.assignedTo) {
        const member = this.members.get(task.assignedTo);
        if (member) {
          member.completedTasks++;
          member.status = 'idle';
          member.currentTaskId = null;
        }
      }
    }

    this.emit('team:task-updated', task);
    return { success: true, message: `Task ${taskId} updated: ${task.status}` };
  }

  /**
   * Assign a task to a specific member.
   */
  assignTask(taskId: string, memberId: string): { success: boolean; message: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, message: `Task ${taskId} not found.` };
    }

    const member = this.members.get(memberId);
    if (!member) {
      return { success: false, message: `Member ${memberId} not found.` };
    }

    task.assignedTo = memberId;
    task.status = 'in_progress';
    task.updatedAt = new Date();
    member.status = 'working';
    member.currentTaskId = taskId;

    this.emit('team:task-assigned', { taskId, memberId, role: member.role });
    return { success: true, message: `Assigned "${task.title}" to ${member.label} (${member.role})` };
  }

  /**
   * Get the next available tasks (dependencies met, not assigned).
   */
  getAvailableTasks(): TeamTask[] {
    const completedIds = new Set(
      Array.from(this.tasks.values())
        .filter(t => t.status === 'completed')
        .map(t => t.id)
    );

    return Array.from(this.tasks.values()).filter(task => {
      if (task.status !== 'pending') return false;
      return task.dependencies.every(depId => completedIds.has(depId));
    });
  }

  /**
   * Auto-assign a task to an idle member with matching role.
   */
  private autoAssignTask(task: TeamTask): void {
    if (!task.assignedRole) return;

    for (const member of this.members.values()) {
      if (member.role === task.assignedRole && member.status === 'idle') {
        this.assignTask(task.id, member.id);
        return;
      }
    }
  }

  // ==========================================================================
  // Mailbox (Inter-member Communication)
  // ==========================================================================

  /**
   * Send a message to a team member or broadcast to all.
   */
  sendMessage(from: string, to: string, content: string): MailboxMessage {
    const msg: MailboxMessage = {
      id: createId('msg'),
      from,
      to,
      content,
      timestamp: new Date(),
      read: false,
    };

    this.mailbox.push(msg);
    this.emit('team:message', msg);
    return msg;
  }

  /**
   * Get unread messages for a member.
   */
  getUnreadMessages(memberId: string): MailboxMessage[] {
    return this.mailbox.filter(
      m => (m.to === memberId || m.to === 'all') && !m.read && m.from !== memberId
    );
  }

  /**
   * Get all messages for a member (inbox).
   */
  getInbox(memberId: string, limit: number = 20): MailboxMessage[] {
    return this.mailbox
      .filter(m => m.to === memberId || m.to === 'all' || m.from === memberId)
      .slice(-limit);
  }

  /**
   * Mark messages as read.
   */
  markRead(messageIds: string[]): void {
    const idSet = new Set(messageIds);
    for (const msg of this.mailbox) {
      if (idSet.has(msg.id)) {
        msg.read = true;
      }
    }
  }

  // ==========================================================================
  // Status & Reporting
  // ==========================================================================

  /**
   * Get comprehensive team status.
   */
  getStatus(): {
    status: TeamStatus;
    goal: string;
    memberCount: number;
    members: TeamMember[];
    taskSummary: { total: number; pending: number; inProgress: number; completed: number; failed: number };
    unreadMessages: number;
    uptime: string;
  } {
    const tasks = Array.from(this.tasks.values());
    const pending = tasks.filter(t => t.status === 'pending').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const failed = tasks.filter(t => t.status === 'failed').length;

    const unreadMessages = this.mailbox.filter(m => !m.read).length;

    let uptime = 'N/A';
    if (this.startedAt) {
      const seconds = Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
      if (seconds < 60) uptime = `${seconds}s`;
      else if (seconds < 3600) uptime = `${Math.floor(seconds / 60)}m`;
      else uptime = `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    }

    return {
      status: this.status,
      goal: this.teamGoal,
      memberCount: this.members.size,
      members: Array.from(this.members.values()),
      taskSummary: { total: tasks.length, pending, inProgress, completed, failed },
      unreadMessages,
      uptime,
    };
  }

  /**
   * Format team status for display.
   */
  formatStatus(): string {
    const s = this.getStatus();
    const lines: string[] = [];

    lines.push('='.repeat(60));
    lines.push('AGENT TEAM STATUS');
    lines.push('='.repeat(60));
    lines.push('');

    lines.push(`Status: ${s.status.toUpperCase()}`);
    if (s.goal) lines.push(`Goal: ${s.goal}`);
    lines.push(`Uptime: ${s.uptime}`);
    lines.push('');

    // Members
    lines.push(`TEAM MEMBERS (${s.memberCount})`);
    lines.push('-'.repeat(40));
    if (s.members.length === 0) {
      lines.push('  No members yet. Use /team add <role> to add teammates.');
    } else {
      for (const m of s.members) {
        const statusIcon = m.status === 'working' ? '[WORKING]' :
          m.status === 'done' ? '[DONE]' :
          m.status === 'error' ? '[ERROR]' : '[IDLE]';
        lines.push(`  ${m.label} (${m.role}) ${statusIcon} - ${m.completedTasks} tasks done`);
        if (m.currentTaskId) {
          const task = this.tasks.get(m.currentTaskId);
          if (task) lines.push(`    Current: ${task.title}`);
        }
      }
    }
    lines.push('');

    // Tasks
    lines.push(`SHARED TASK LIST (${s.taskSummary.total})`);
    lines.push('-'.repeat(40));
    lines.push(`  Pending: ${s.taskSummary.pending}  In Progress: ${s.taskSummary.inProgress}  Completed: ${s.taskSummary.completed}  Failed: ${s.taskSummary.failed}`);

    const activeTasks = Array.from(this.tasks.values()).filter(t => t.status !== 'completed');
    for (const task of activeTasks.slice(0, 10)) {
      const statusMark = task.status === 'in_progress' ? '[/]' :
        task.status === 'completed' ? '[x]' :
        task.status === 'failed' ? '[-]' : '[ ]';
      const assignee = task.assignedTo
        ? this.members.get(task.assignedTo)?.label || 'unknown'
        : 'unassigned';
      lines.push(`  ${statusMark} ${task.title} (${task.priority}) -> ${assignee}`);
    }
    lines.push('');

    // Mailbox
    if (s.unreadMessages > 0) {
      lines.push(`MAILBOX: ${s.unreadMessages} unread message(s)`);
      lines.push('');
    }

    lines.push('='.repeat(60));
    return lines.join('\n');
  }

  /**
   * Get the shared context for team coordination.
   */
  getSharedContext(): SharedContext {
    return {
      goal: this.teamGoal,
      relevantFiles: [],
      conversationHistory: this.mailbox.map<AgentMessage>(m => ({
        id: m.id,
        from: (this.members.get(m.from)?.role || 'orchestrator') as AgentRole,
        to: m.to === 'all' ? 'all' : (this.members.get(m.to)?.role || 'orchestrator') as AgentRole,
        type: 'status_update',
        content: m.content,
        timestamp: m.timestamp,
      })),
      artifacts: new Map(),
      decisions: [],
      constraints: [],
    };
  }

  // ==========================================================================
  // Accessors
  // ==========================================================================

  isActive(): boolean {
    return this.status === 'active';
  }

  getMembers(): TeamMember[] {
    return Array.from(this.members.values());
  }

  getMember(memberId: string): TeamMember | undefined {
    return this.members.get(memberId);
  }

  getTasks(): TeamTask[] {
    return Array.from(this.tasks.values());
  }

  getTask(taskId: string): TeamTask | undefined {
    return this.tasks.get(taskId);
  }

  getLeadId(): string | null {
    return this.leadId;
  }

  getTeamGoal(): string {
    return this.teamGoal;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let teamManagerInstance: TeamManager | null = null;

export function getTeamManager(): TeamManager {
  if (!teamManagerInstance) {
    teamManagerInstance = new TeamManager();
  }
  return teamManagerInstance;
}

export function resetTeamManager(): void {
  if (teamManagerInstance) {
    teamManagerInstance.removeAllListeners();
  }
  teamManagerInstance = null;
}
