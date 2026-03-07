/**
 * Agent Teams v2
 *
 * Enhanced agent teams with shared task list, mailbox, tmux support,
 * delegate mode, and plan approval.
 */

import { logger } from '../../utils/logger.js';
import { randomUUID } from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface TeamTask {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'claimed' | 'in_progress' | 'completed' | 'failed';
  assignee?: string;
  dependencies: string[];
  lockedFiles: string[];
  createdAt: number;
  completedAt?: number;
  failReason?: string;
}

export interface MailboxMessage {
  id: string;
  from: string;
  to: string | 'broadcast';
  content: string;
  timestamp: number;
  read: boolean;
}

export type TeammateMode = 'auto' | 'in-process' | 'tmux';

export interface TeamConfig {
  name: string;
  leadAgent: string;
  teammates: string[];
  mode: TeammateMode;
  delegateMode: boolean;
  planApproval: boolean;
  configPath: string;
}

// ============================================================================
// Team Task List
// ============================================================================

export class TeamTaskList {
  private tasks: Map<string, TeamTask> = new Map();

  constructor() {}

  /**
   * Add a new task
   */
  addTask(title: string, description: string, dependencies: string[] = []): TeamTask {
    const task: TeamTask = {
      id: randomUUID(),
      title,
      description,
      status: 'pending',
      dependencies,
      lockedFiles: [],
      createdAt: Date.now(),
    };

    this.tasks.set(task.id, task);
    logger.debug(`Task added: ${task.id} - ${title}`);
    return task;
  }

  /**
   * Claim a task for an agent
   */
  claimTask(taskId: string, agentName: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status !== 'pending') return false;

    // Check dependencies are completed
    for (const depId of task.dependencies) {
      const dep = this.tasks.get(depId);
      if (!dep || dep.status !== 'completed') {
        return false;
      }
    }

    task.status = 'claimed';
    task.assignee = agentName;
    logger.debug(`Task ${taskId} claimed by ${agentName}`);
    return true;
  }

  /**
   * Complete a task
   */
  completeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status !== 'claimed' && task.status !== 'in_progress') return false;

    task.status = 'completed';
    task.completedAt = Date.now();

    // Unlock all files
    task.lockedFiles = [];
    logger.debug(`Task ${taskId} completed`);
    return true;
  }

  /**
   * Fail a task
   */
  failTask(taskId: string, reason: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status !== 'claimed' && task.status !== 'in_progress') return false;

    task.status = 'failed';
    task.failReason = reason;
    task.completedAt = Date.now();
    task.lockedFiles = [];
    logger.debug(`Task ${taskId} failed: ${reason}`);
    return true;
  }

  /**
   * Get tasks available for an agent (pending with satisfied deps)
   */
  getAvailableTasks(_agentName: string): TeamTask[] {
    const available: TeamTask[] = [];
    const tasks = Array.from(this.tasks.values());
    for (const task of tasks) {
      if (task.status !== 'pending') continue;

      const depsOk = task.dependencies.every(depId => {
        const dep = this.tasks.get(depId);
        return dep && dep.status === 'completed';
      });

      if (depsOk) {
        available.push(task);
      }
    }
    return available;
  }

  /**
   * Get tasks assigned to an agent
   */
  getTasksByAgent(agentName: string): TeamTask[] {
    const result: TeamTask[] = [];
    const tasks = Array.from(this.tasks.values());
    for (const task of tasks) {
      if (task.assignee === agentName) {
        result.push(task);
      }
    }
    return result;
  }

  /**
   * Lock a file for a task
   */
  lockFile(taskId: string, file: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // Check if file is already locked by another task
    const allTasks = Array.from(this.tasks.values());
    for (const other of allTasks) {
      if (other.id === taskId) continue;
      if (other.lockedFiles.includes(file)) {
        return false;
      }
    }

    if (!task.lockedFiles.includes(file)) {
      task.lockedFiles.push(file);
    }
    return true;
  }

  /**
   * Check if a file is locked
   */
  isFileLocked(file: string): { locked: boolean; byTask?: string } {
    const tasks = Array.from(this.tasks.values());
    for (const task of tasks) {
      if (task.lockedFiles.includes(file)) {
        return { locked: true, byTask: task.id };
      }
    }
    return { locked: false };
  }

  /**
   * Unlock a file for a task
   */
  unlockFile(taskId: string, file: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const idx = task.lockedFiles.indexOf(file);
    if (idx === -1) return false;

    task.lockedFiles.splice(idx, 1);
    return true;
  }

  /**
   * Get all tasks
   */
  getAllTasks(): TeamTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get pending task count
   */
  getPendingCount(): number {
    let count = 0;
    const tasks = Array.from(this.tasks.values());
    for (const task of tasks) {
      if (task.status === 'pending') count++;
    }
    return count;
  }

  /**
   * Get completed task count
   */
  getCompletedCount(): number {
    let count = 0;
    const tasks = Array.from(this.tasks.values());
    for (const task of tasks) {
      if (task.status === 'completed') count++;
    }
    return count;
  }
}

// ============================================================================
// Team Mailbox
// ============================================================================

export class TeamMailbox {
  private messages: MailboxMessage[] = [];

  constructor() {}

  /**
   * Send a message to a specific agent
   */
  send(from: string, to: string, content: string): MailboxMessage {
    const msg: MailboxMessage = {
      id: randomUUID(),
      from,
      to,
      content,
      timestamp: Date.now(),
      read: false,
    };

    this.messages.push(msg);
    logger.debug(`Message from ${from} to ${to}`);
    return msg;
  }

  /**
   * Broadcast a message to all agents
   */
  broadcast(from: string, content: string): MailboxMessage {
    const msg: MailboxMessage = {
      id: randomUUID(),
      from,
      to: 'broadcast',
      content,
      timestamp: Date.now(),
      read: false,
    };

    this.messages.push(msg);
    logger.debug(`Broadcast from ${from}`);
    return msg;
  }

  /**
   * Get messages for an agent (direct + broadcasts, excluding own)
   */
  getMessages(agentName: string): MailboxMessage[] {
    return this.messages.filter(
      m => (m.to === agentName || m.to === 'broadcast') && m.from !== agentName
    );
  }

  /**
   * Get unread messages for an agent
   */
  getUnread(agentName: string): MailboxMessage[] {
    return this.getMessages(agentName).filter(m => !m.read);
  }

  /**
   * Mark a message as read
   */
  markRead(messageId: string): boolean {
    const msg = this.messages.find(m => m.id === messageId);
    if (!msg) return false;
    msg.read = true;
    return true;
  }

  /**
   * Mark all messages for an agent as read
   */
  markAllRead(agentName: string): number {
    let count = 0;
    for (const msg of this.getMessages(agentName)) {
      if (!msg.read) {
        msg.read = true;
        count++;
      }
    }
    return count;
  }

  /**
   * Get total message count
   */
  getMessageCount(): number {
    return this.messages.length;
  }
}

// ============================================================================
// Team Manager v2
// ============================================================================

export class TeamManagerV2 {
  private config: TeamConfig;
  private taskList: TeamTaskList;
  private mailbox: TeamMailbox;

  constructor(config: TeamConfig) {
    this.config = { ...config };
    this.taskList = new TeamTaskList();
    this.mailbox = new TeamMailbox();
    logger.info(`TeamManagerV2 created: ${config.name}`);
  }

  getTaskList(): TeamTaskList {
    return this.taskList;
  }

  getMailbox(): TeamMailbox {
    return this.mailbox;
  }

  getConfig(): TeamConfig {
    return { ...this.config };
  }

  /**
   * Set teammate mode
   */
  setMode(mode: TeammateMode): void {
    this.config.mode = mode;
    logger.info(`Team mode set to: ${mode}`);
  }

  getMode(): TeammateMode {
    return this.config.mode;
  }

  /**
   * Set delegate mode (lead restricted to coordination only)
   */
  setDelegateMode(enabled: boolean): void {
    this.config.delegateMode = enabled;
    logger.info(`Delegate mode: ${enabled}`);
  }

  isDelegateMode(): boolean {
    return this.config.delegateMode;
  }

  /**
   * Add a teammate
   */
  addTeammate(name: string): boolean {
    if (this.config.teammates.includes(name)) return false;
    this.config.teammates.push(name);
    logger.info(`Added teammate: ${name}`);
    return true;
  }

  /**
   * Remove a teammate
   */
  removeTeammate(name: string): boolean {
    const idx = this.config.teammates.indexOf(name);
    if (idx === -1) return false;
    this.config.teammates.splice(idx, 1);
    logger.info(`Removed teammate: ${name}`);
    return true;
  }

  /**
   * Get all teammates
   */
  getTeammates(): string[] {
    return [...this.config.teammates];
  }

  /**
   * Generate a simple tmux-style layout summary string
   */
  generateTmuxLayout(): string {
    const panes = [this.config.leadAgent, ...this.config.teammates];
    const lines = panes.map((name, i) => `pane-${i}: ${name}`);
    return `tmux layout for "${this.config.name}":\n${lines.join('\n')}`;
  }

  /**
   * Serialize config to JSON
   */
  serializeConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * Deserialize config from JSON
   */
  static deserializeConfig(json: string): TeamConfig {
    const parsed = JSON.parse(json);
    if (!parsed.name || !parsed.leadAgent) {
      throw new Error('Invalid team config: missing name or leadAgent');
    }
    return {
      name: parsed.name,
      leadAgent: parsed.leadAgent,
      teammates: parsed.teammates || [],
      mode: parsed.mode || 'auto',
      delegateMode: parsed.delegateMode ?? false,
      planApproval: parsed.planApproval ?? false,
      configPath: parsed.configPath || '',
    };
  }
}
