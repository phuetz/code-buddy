/**
 * Track Manager - Context-Driven Development
 *
 * Manages tracks (features, bugs) with spec → plan → implement workflow.
 * Inspired by Conductor's "Measure twice, code once" philosophy.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import {
  Track,
  TrackMetadata,
  TrackSpec,
  TrackPlan,
  TrackPhase,
  TrackTask,
  TrackStatus,
  TaskStatus,
  TrackCreateOptions,
  TrackListOptions,
  ProjectContext
} from './types';

export class TrackManager {
  private workingDirectory: string;
  private codeBuddyDir: string;
  private tracksDir: string;
  private contextDir: string;

  constructor(workingDirectory: string = process.cwd()) {
    this.workingDirectory = workingDirectory;
    this.codeBuddyDir = path.join(workingDirectory, '.codebuddy');
    this.tracksDir = path.join(this.codeBuddyDir, 'tracks');
    this.contextDir = path.join(this.codeBuddyDir, 'context');
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  /**
   * Initialize the track system for a project
   */
  async initialize(): Promise<void> {
    await fs.ensureDir(this.tracksDir);
    await fs.ensureDir(this.contextDir);

    // Create default context files if they don't exist
    const defaultFiles = [
      { name: 'product.md', content: this.getDefaultProductTemplate() },
      { name: 'tech-stack.md', content: this.getDefaultTechStackTemplate() },
      { name: 'guidelines.md', content: this.getDefaultGuidelinesTemplate() },
      { name: 'workflow.md', content: this.getDefaultWorkflowTemplate() }
    ];

    for (const file of defaultFiles) {
      const filePath = path.join(this.contextDir, file.name);
      if (!await fs.pathExists(filePath)) {
        await fs.writeFile(filePath, file.content);
      }
    }

    // Create tracks index file
    const tracksIndexPath = path.join(this.codeBuddyDir, 'tracks.md');
    if (!await fs.pathExists(tracksIndexPath)) {
      await fs.writeFile(tracksIndexPath, this.getTracksIndexTemplate());
    }
  }

  /**
   * Check if track system is initialized
   */
  async isInitialized(): Promise<boolean> {
    return await fs.pathExists(this.tracksDir);
  }

  // ============================================================
  // TRACK CRUD OPERATIONS
  // ============================================================

  /**
   * Create a new track
   */
  async createTrack(options: TrackCreateOptions): Promise<Track> {
    await this.initialize();

    const id = this.generateTrackId(options.name);
    const trackDir = path.join(this.tracksDir, id);

    // Check if track already exists
    if (await fs.pathExists(trackDir)) {
      throw new Error(`Track "${id}" already exists`);
    }

    await fs.ensureDir(trackDir);

    const now = new Date().toISOString();
    const metadata: TrackMetadata = {
      id,
      name: options.name,
      type: options.type,
      status: 'planning',
      createdAt: now,
      updatedAt: now,
      description: options.description,
      progress: {
        totalTasks: 0,
        completedTasks: 0,
        percentage: 0
      }
    };

    const spec: TrackSpec = {
      overview: options.description || `Implementation of ${options.name}`,
      requirements: [],
      acceptanceCriteria: []
    };

    const plan: TrackPlan = {
      phases: []
    };

    const track: Track = { metadata, spec, plan };

    // Save files
    await this.saveTrackMetadata(id, metadata);
    await this.saveTrackSpec(id, spec);
    await this.saveTrackPlan(id, plan);

    // Update tracks index
    await this.updateTracksIndex(metadata);

    return track;
  }

  /**
   * Get a track by ID
   */
  async getTrack(trackId: string): Promise<Track | null> {
    const trackDir = path.join(this.tracksDir, trackId);

    if (!await fs.pathExists(trackDir)) {
      return null;
    }

    const metadata = await this.loadTrackMetadata(trackId);
    const spec = await this.loadTrackSpec(trackId);
    const plan = await this.loadTrackPlan(trackId);

    if (!metadata) return null;

    return { metadata, spec, plan };
  }

  /**
   * List all tracks
   */
  async listTracks(options: TrackListOptions = {}): Promise<TrackMetadata[]> {
    if (!await fs.pathExists(this.tracksDir)) {
      return [];
    }

    const dirs = await fs.readdir(this.tracksDir);
    const tracks: TrackMetadata[] = [];

    for (const dir of dirs) {
      const metadata = await this.loadTrackMetadata(dir);
      if (!metadata) continue;

      // Apply filters
      if (options.status && metadata.status !== options.status) continue;
      if (options.type && metadata.type !== options.type) continue;

      tracks.push(metadata);
    }

    // Sort by updatedAt descending
    tracks.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    // Apply limit
    if (options.limit) {
      return tracks.slice(0, options.limit);
    }

    return tracks;
  }

  /**
   * Update track status
   */
  async updateTrackStatus(trackId: string, status: TrackStatus): Promise<void> {
    const metadata = await this.loadTrackMetadata(trackId);
    if (!metadata) {
      throw new Error(`Track "${trackId}" not found`);
    }

    metadata.status = status;
    metadata.updatedAt = new Date().toISOString();

    if (status === 'completed') {
      metadata.completedAt = metadata.updatedAt;
    }

    await this.saveTrackMetadata(trackId, metadata);
    await this.updateTracksIndex(metadata);
  }

  /**
   * Delete a track
   */
  async deleteTrack(trackId: string): Promise<void> {
    const trackDir = path.join(this.tracksDir, trackId);

    if (!await fs.pathExists(trackDir)) {
      throw new Error(`Track "${trackId}" not found`);
    }

    await fs.remove(trackDir);
    await this.removeFromTracksIndex(trackId);
  }

  // ============================================================
  // SPEC & PLAN MANAGEMENT
  // ============================================================

  /**
   * Update track spec
   */
  async updateSpec(trackId: string, spec: Partial<TrackSpec>): Promise<void> {
    const currentSpec = await this.loadTrackSpec(trackId);
    const updatedSpec = { ...currentSpec, ...spec };
    await this.saveTrackSpec(trackId, updatedSpec);

    // Update metadata timestamp
    const metadata = await this.loadTrackMetadata(trackId);
    if (metadata) {
      metadata.updatedAt = new Date().toISOString();
      await this.saveTrackMetadata(trackId, metadata);
    }
  }

  /**
   * Update track plan
   */
  async updatePlan(trackId: string, plan: TrackPlan): Promise<void> {
    await this.saveTrackPlan(trackId, plan);
    await this.recalculateProgress(trackId);

    // Update metadata timestamp
    const metadata = await this.loadTrackMetadata(trackId);
    if (metadata) {
      metadata.updatedAt = new Date().toISOString();
      await this.saveTrackMetadata(trackId, metadata);
    }
  }

  /**
   * Update a task's status
   */
  async updateTaskStatus(
    trackId: string,
    phaseId: string,
    taskId: string,
    status: TaskStatus,
    commitSha?: string
  ): Promise<void> {
    const plan = await this.loadTrackPlan(trackId);

    const phase = plan.phases.find(p => p.id === phaseId);
    if (!phase) {
      throw new Error(`Phase "${phaseId}" not found`);
    }

    const task = this.findTask(phase.tasks, taskId);
    if (!task) {
      throw new Error(`Task "${taskId}" not found`);
    }

    task.status = status;
    if (commitSha) {
      task.commitSha = commitSha;
    }

    await this.saveTrackPlan(trackId, plan);
    await this.recalculateProgress(trackId);
  }

  /**
   * Get the next pending task
   */
  async getNextTask(trackId: string): Promise<{ phase: TrackPhase; task: TrackTask } | null> {
    const plan = await this.loadTrackPlan(trackId);

    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        if (task.status === 'pending') {
          return { phase, task };
        }
        // Check subtasks
        if (task.subtasks) {
          for (const subtask of task.subtasks) {
            if (subtask.status === 'pending') {
              return { phase, task: subtask };
            }
          }
        }
      }
    }

    return null;
  }

  // ============================================================
  // CONTEXT MANAGEMENT
  // ============================================================

  /**
   * Load project context files
   */
  async loadContext(): Promise<ProjectContext> {
    const context: ProjectContext = {};

    const files = ['product.md', 'tech-stack.md', 'guidelines.md', 'workflow.md'];

    for (const file of files) {
      const filePath = path.join(this.contextDir, file);
      if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath, 'utf-8');

        if (file === 'product.md') context.product = content;
        else if (file === 'tech-stack.md') context.techStack = content;
        else if (file === 'guidelines.md') context.guidelines = content;
        else if (file === 'workflow.md') context.workflow = content;
      }
    }

    return context;
  }

  /**
   * Update a context file
   */
  async updateContext(
    file: 'product' | 'tech-stack' | 'guidelines' | 'workflow',
    content: string
  ): Promise<void> {
    await fs.ensureDir(this.contextDir);
    const filePath = path.join(this.contextDir, `${file}.md`);
    await fs.writeFile(filePath, content);
  }

  /**
   * Get context as a string for injection into prompts
   */
  async getContextString(): Promise<string> {
    const context = await this.loadContext();
    const parts: string[] = [];

    if (context.product) {
      parts.push(`## Product Context\n${context.product}`);
    }
    if (context.techStack) {
      parts.push(`## Tech Stack\n${context.techStack}`);
    }
    if (context.guidelines) {
      parts.push(`## Guidelines\n${context.guidelines}`);
    }

    return parts.join('\n\n---\n\n');
  }

  // ============================================================
  // FILE I/O HELPERS
  // ============================================================

  private async saveTrackMetadata(trackId: string, metadata: TrackMetadata): Promise<void> {
    const filePath = path.join(this.tracksDir, trackId, 'metadata.json');
    await fs.writeJson(filePath, metadata, { spaces: 2 });
  }

  private async loadTrackMetadata(trackId: string): Promise<TrackMetadata | null> {
    const filePath = path.join(this.tracksDir, trackId, 'metadata.json');
    if (!await fs.pathExists(filePath)) return null;
    return await fs.readJson(filePath);
  }

  private async saveTrackSpec(trackId: string, spec: TrackSpec): Promise<void> {
    const filePath = path.join(this.tracksDir, trackId, 'spec.md');
    const content = this.specToMarkdown(spec);
    await fs.writeFile(filePath, content);
  }

  private async loadTrackSpec(trackId: string): Promise<TrackSpec> {
    const filePath = path.join(this.tracksDir, trackId, 'spec.md');
    if (!await fs.pathExists(filePath)) {
      return { overview: '', requirements: [], acceptanceCriteria: [] };
    }
    const content = await fs.readFile(filePath, 'utf-8');
    return this.markdownToSpec(content);
  }

  private async saveTrackPlan(trackId: string, plan: TrackPlan): Promise<void> {
    const filePath = path.join(this.tracksDir, trackId, 'plan.md');
    const content = this.planToMarkdown(plan);
    await fs.writeFile(filePath, content);
  }

  private async loadTrackPlan(trackId: string): Promise<TrackPlan> {
    const filePath = path.join(this.tracksDir, trackId, 'plan.md');
    if (!await fs.pathExists(filePath)) {
      return { phases: [] };
    }
    const content = await fs.readFile(filePath, 'utf-8');
    return this.markdownToPlan(content);
  }

  // ============================================================
  // MARKDOWN CONVERSION
  // ============================================================

  private specToMarkdown(spec: TrackSpec): string {
    const lines: string[] = [
      '# Specification',
      '',
      '## Overview',
      spec.overview,
      '',
      '## Requirements',
      ...spec.requirements.map(r => `- ${r}`),
      '',
      '## Acceptance Criteria',
      ...spec.acceptanceCriteria.map(c => `- [ ] ${c}`)
    ];

    if (spec.outOfScope?.length) {
      lines.push('', '## Out of Scope', ...spec.outOfScope.map(o => `- ${o}`));
    }

    if (spec.dependencies?.length) {
      lines.push('', '## Dependencies', ...spec.dependencies.map(d => `- ${d}`));
    }

    if (spec.technicalNotes) {
      lines.push('', '## Technical Notes', spec.technicalNotes);
    }

    return lines.join('\n');
  }

  private markdownToSpec(content: string): TrackSpec {
    const spec: TrackSpec = {
      overview: '',
      requirements: [],
      acceptanceCriteria: []
    };

    const sections = content.split(/^## /m);

    for (const section of sections) {
      const lines = section.trim().split('\n');
      const title = lines[0]?.toLowerCase();
      const body = lines.slice(1).join('\n').trim();

      if (title?.includes('overview')) {
        spec.overview = body;
      } else if (title?.includes('requirements')) {
        spec.requirements = this.extractListItems(body);
      } else if (title?.includes('acceptance')) {
        spec.acceptanceCriteria = this.extractListItems(body).map(i => i.replace(/^\[.\]\s*/, ''));
      } else if (title?.includes('out of scope')) {
        spec.outOfScope = this.extractListItems(body);
      } else if (title?.includes('dependencies')) {
        spec.dependencies = this.extractListItems(body);
      } else if (title?.includes('technical')) {
        spec.technicalNotes = body;
      }
    }

    return spec;
  }

  private planToMarkdown(plan: TrackPlan): string {
    const lines: string[] = ['# Implementation Plan', ''];

    for (const phase of plan.phases) {
      const checkpoint = phase.checkpointSha ? ` \`${phase.checkpointSha}\`` : '';
      lines.push(`## ${phase.title}${checkpoint}`, '');

      for (const task of phase.tasks) {
        lines.push(this.taskToMarkdown(task, 0));

        if (task.subtasks) {
          for (const subtask of task.subtasks) {
            lines.push(this.taskToMarkdown(subtask, 1));
          }
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  private taskToMarkdown(task: TrackTask, indent: number): string {
    const prefix = '  '.repeat(indent);
    const checkbox = task.status === 'completed' ? '[x]' :
                     task.status === 'in_progress' ? '[~]' :
                     task.status === 'skipped' ? '[-]' : '[ ]';
    const sha = task.commitSha ? ` \`${task.commitSha.slice(0, 7)}\`` : '';
    return `${prefix}- ${checkbox} ${task.title}${sha}`;
  }

  private markdownToPlan(content: string): TrackPlan {
    const plan: TrackPlan = { phases: [] };
    const phaseMatches = content.split(/^## /m).filter(s => s.trim());

    for (const phaseContent of phaseMatches) {
      if (phaseContent.startsWith('#')) continue; // Skip main title

      const lines = phaseContent.trim().split('\n');
      const titleLine = lines[0] || '';
      const shaMatch = titleLine.match(/`([a-f0-9]{7,})`/);

      const phase: TrackPhase = {
        id: this.slugify(titleLine.replace(/`[a-f0-9]+`/, '').trim()),
        title: titleLine.replace(/`[a-f0-9]+`/, '').trim(),
        tasks: [],
        checkpointSha: shaMatch?.[1]
      };

      let currentTask: TrackTask | null = null;

      for (const line of lines.slice(1)) {
        const taskMatch = line.match(/^(\s*)- \[([ x~-])\] (.+?)(?:\s*`([a-f0-9]{7,})`)?$/);
        if (!taskMatch) continue;

        const indent = taskMatch[1].length;
        const status = this.parseTaskStatus(taskMatch[2]);
        const title = taskMatch[3].trim();
        const commitSha = taskMatch[4];

        const task: TrackTask = {
          id: this.slugify(title),
          title,
          status,
          commitSha
        };

        if (indent === 0) {
          currentTask = task;
          phase.tasks.push(task);
        } else if (currentTask) {
          if (!currentTask.subtasks) currentTask.subtasks = [];
          currentTask.subtasks.push(task);
        }
      }

      if (phase.tasks.length > 0 || phase.title) {
        plan.phases.push(phase);
      }
    }

    return plan;
  }

  private parseTaskStatus(char: string): TaskStatus {
    switch (char) {
      case 'x': return 'completed';
      case '~': return 'in_progress';
      case '-': return 'skipped';
      default: return 'pending';
    }
  }

  // ============================================================
  // UTILITY METHODS
  // ============================================================

  private generateTrackId(name: string): string {
    const slug = this.slugify(name);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${slug}_${date}`;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30);
  }

  private extractListItems(content: string): string[] {
    const items: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const match = line.match(/^[-*]\s*(?:\[.\]\s*)?(.+)$/);
      if (match) {
        items.push(match[1].trim());
      }
    }

    return items;
  }

  private findTask(tasks: TrackTask[], taskId: string): TrackTask | null {
    for (const task of tasks) {
      if (task.id === taskId) return task;
      if (task.subtasks) {
        const found = this.findTask(task.subtasks, taskId);
        if (found) return found;
      }
    }
    return null;
  }

  private async recalculateProgress(trackId: string): Promise<void> {
    const plan = await this.loadTrackPlan(trackId);
    const metadata = await this.loadTrackMetadata(trackId);
    if (!metadata) return;

    let total = 0;
    let completed = 0;

    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        total++;
        if (task.status === 'completed') completed++;

        if (task.subtasks) {
          for (const subtask of task.subtasks) {
            total++;
            if (subtask.status === 'completed') completed++;
          }
        }
      }
    }

    metadata.progress = {
      totalTasks: total,
      completedTasks: completed,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0
    };

    await this.saveTrackMetadata(trackId, metadata);
  }

  private async updateTracksIndex(metadata: TrackMetadata): Promise<void> {
    const indexPath = path.join(this.codeBuddyDir, 'tracks.md');
    let content = await fs.readFile(indexPath, 'utf-8').catch(() => this.getTracksIndexTemplate());

    // Remove existing entry for this track
    const lines = content.split('\n');
    const filteredLines = lines.filter(line => !line.includes(`[${metadata.name}]`));

    // Add new entry
    const statusEmoji = this.getStatusEmoji(metadata.status);
    const entry = `| ${statusEmoji} | [${metadata.name}](tracks/${metadata.id}/) | ${metadata.type} | ${metadata.progress.percentage}% | ${metadata.updatedAt.slice(0, 10)} |`;

    // Find the table and insert
    const tableHeaderIndex = filteredLines.findIndex(l => l.includes('| Status |'));
    if (tableHeaderIndex >= 0) {
      filteredLines.splice(tableHeaderIndex + 2, 0, entry);
    }

    await fs.writeFile(indexPath, filteredLines.join('\n'));
  }

  private async removeFromTracksIndex(trackId: string): Promise<void> {
    const indexPath = path.join(this.codeBuddyDir, 'tracks.md');
    const content = await fs.readFile(indexPath, 'utf-8').catch(() => '');
    const lines = content.split('\n').filter(line => !line.includes(`tracks/${trackId}/`));
    await fs.writeFile(indexPath, lines.join('\n'));
  }

  private getStatusEmoji(status: TrackStatus): string {
    switch (status) {
      case 'planning': return '📝';
      case 'in_progress': return '🔄';
      case 'blocked': return '🚫';
      case 'completed': return '✅';
      case 'archived': return '📦';
      default: return '❓';
    }
  }

  // ============================================================
  // TEMPLATES
  // ============================================================

  private getTracksIndexTemplate(): string {
    return `# Tracks

Active work items organized by feature/bug/task.

| Status | Track | Type | Progress | Updated |
|--------|-------|------|----------|---------|
`;
  }

  private getDefaultProductTemplate(): string {
    return `# Product Context

## Project Name
[Your project name]

## Description
[Brief description of the project]

## Goals
- [Goal 1]
- [Goal 2]

## Target Users
- [User type 1]
- [User type 2]

## Key Features
- [Feature 1]
- [Feature 2]
`;
  }

  private getDefaultTechStackTemplate(): string {
    return `# Tech Stack

## Language
- TypeScript/JavaScript

## Runtime
- Node.js

## Key Dependencies
- [List main dependencies]

## Development Tools
- [List dev tools]

## Testing
- [Testing framework]

## Notes
[Any important technical decisions or constraints]
`;
  }

  private getDefaultGuidelinesTemplate(): string {
    return `# Development Guidelines

## Code Style
- Use TypeScript strict mode
- Prefer async/await over callbacks
- Use meaningful variable names

## Commit Messages
- Follow Conventional Commits (feat:, fix:, docs:, etc.)
- Keep messages concise but descriptive

## Testing
- Write tests for new features
- Maintain >80% code coverage

## Documentation
- Document public APIs
- Update README for significant changes
`;
  }

  private getDefaultWorkflowTemplate(): string {
    return `# Development Workflow

## Task Lifecycle

1. **Select Task**: Pick the next pending task from plan.md
2. **Mark In-Progress**: Update task status to [~]
3. **Implement**: Write the code
4. **Test**: Run tests, ensure they pass
5. **Commit**: Create a conventional commit
6. **Update Plan**: Mark task as [x] with commit SHA

## Phase Completion

When all tasks in a phase are complete:
1. Run full test suite
2. Create checkpoint commit
3. Update phase header with checkpoint SHA
4. Proceed to next phase

## Quality Gates

Before marking a task complete:
- [ ] Tests pass
- [ ] Code reviewed (self or peer)
- [ ] No linting errors
- [ ] Documentation updated if needed
`;
  }
}
