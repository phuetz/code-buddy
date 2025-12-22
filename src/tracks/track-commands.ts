/**
 * Track Commands - Slash commands for track management
 *
 * Commands:
 * - /track new - Create a new track with spec and plan
 * - /track implement - Implement the next task
 * - /track status - Show track status
 * - /track list - List all tracks
 * - /track revert - Revert track/phase/task
 */

import { TrackManager } from './track-manager.js';
import { TrackType, TrackStatus, Track, TrackMetadata, TrackPhase, TrackTask } from './types.js';

export interface TrackCommandResult {
  success: boolean;
  message: string;
  prompt?: string;
  track?: Track;
  tracks?: TrackMetadata[];
}

export class TrackCommands {
  private manager: TrackManager;

  constructor(workingDirectory: string = process.cwd()) {
    this.manager = new TrackManager(workingDirectory);
  }

  /**
   * Parse and execute a track command
   */
  async execute(args: string): Promise<TrackCommandResult> {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() || 'status';
    const subArgs = parts.slice(1).join(' ');

    switch (subcommand) {
      case 'new':
      case 'create':
        return this.handleNew(subArgs);

      case 'implement':
      case 'impl':
      case 'next':
        return this.handleImplement(subArgs);

      case 'status':
      case 'show':
        return this.handleStatus(subArgs);

      case 'list':
      case 'ls':
        return this.handleList(subArgs);

      case 'update':
        return this.handleUpdate(subArgs);

      case 'complete':
      case 'done':
        return this.handleComplete(subArgs);

      case 'setup':
      case 'init':
        return this.handleSetup();

      case 'context':
        return this.handleContext();

      default:
        return {
          success: false,
          message: `Unknown track command: ${subcommand}\n\nAvailable commands:\n` +
            '  /track new <name>     - Create a new track\n' +
            '  /track implement      - Implement next task\n' +
            '  /track status [id]    - Show track status\n' +
            '  /track list           - List all tracks\n' +
            '  /track complete <id>  - Mark track as complete\n' +
            '  /track setup          - Initialize track system\n' +
            '  /track context        - Show project context'
        };
    }
  }

  /**
   * /track new <name> - Create a new track
   */
  private async handleNew(args: string): Promise<TrackCommandResult> {
    if (!args.trim()) {
      // Return a prompt for the AI to ask questions
      return {
        success: true,
        message: 'Creating new track...',
        prompt: this.getNewTrackPrompt()
      };
    }

    // Parse inline arguments: /track new "Feature name" --type feature
    const nameMatch = args.match(/^["']?([^"']+)["']?/);
    const typeMatch = args.match(/--type\s+(\w+)/);

    if (!nameMatch) {
      return {
        success: false,
        message: 'Please provide a track name'
      };
    }

    const name = nameMatch[1].trim();
    const type = (typeMatch?.[1] || 'feature') as TrackType;

    try {
      const track = await this.manager.createTrack({ name, type });

      return {
        success: true,
        message: `Track "${track.metadata.id}" created successfully!`,
        track,
        prompt: this.getSpecPlanPrompt(track)
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create track: ${error}`
      };
    }
  }

  /**
   * /track implement [id] - Implement the next task
   */
  private async handleImplement(args: string): Promise<TrackCommandResult> {
    let trackId = args.trim();

    // If no track ID, find the first in-progress track
    if (!trackId) {
      const tracks = await this.manager.listTracks({ status: 'in_progress' });
      if (tracks.length === 0) {
        const planningTracks = await this.manager.listTracks({ status: 'planning' });
        if (planningTracks.length > 0) {
          trackId = planningTracks[0].id;
          // Update status to in_progress
          await this.manager.updateTrackStatus(trackId, 'in_progress');
        } else {
          return {
            success: false,
            message: 'No active tracks found. Create one with /track new'
          };
        }
      } else {
        trackId = tracks[0].id;
      }
    }

    const track = await this.manager.getTrack(trackId);
    if (!track) {
      return {
        success: false,
        message: `Track "${trackId}" not found`
      };
    }

    const nextTask = await this.manager.getNextTask(trackId);
    if (!nextTask) {
      return {
        success: true,
        message: `All tasks in track "${trackId}" are complete!`,
        prompt: this.getTrackCompletePrompt(track)
      };
    }

    return {
      success: true,
      message: `Implementing: ${nextTask.task.title}`,
      track,
      prompt: this.getImplementPrompt(track, nextTask.phase, nextTask.task)
    };
  }

  /**
   * /track status [id] - Show track status
   */
  private async handleStatus(args: string): Promise<TrackCommandResult> {
    const trackId = args.trim();

    if (trackId) {
      const track = await this.manager.getTrack(trackId);
      if (!track) {
        return {
          success: false,
          message: `Track "${trackId}" not found`
        };
      }

      return {
        success: true,
        message: this.formatTrackStatus(track),
        track
      };
    }

    // Show overview of all active tracks
    const tracks = await this.manager.listTracks();
    if (tracks.length === 0) {
      return {
        success: true,
        message: 'No tracks found. Create one with /track new'
      };
    }

    return {
      success: true,
      message: this.formatTrackList(tracks),
      tracks
    };
  }

  /**
   * /track list - List all tracks
   */
  private async handleList(args: string): Promise<TrackCommandResult> {
    const statusMatch = args.match(/--status\s+(\w+)/);
    const typeMatch = args.match(/--type\s+(\w+)/);

    const options: { status?: TrackStatus; type?: TrackType } = {};
    if (statusMatch) options.status = statusMatch[1] as TrackStatus;
    if (typeMatch) options.type = typeMatch[1] as TrackType;

    const tracks = await this.manager.listTracks(options);

    if (tracks.length === 0) {
      return {
        success: true,
        message: 'No tracks found matching criteria'
      };
    }

    return {
      success: true,
      message: this.formatTrackList(tracks),
      tracks
    };
  }

  /**
   * /track update <id> - Update track spec/plan
   */
  private async handleUpdate(args: string): Promise<TrackCommandResult> {
    const trackId = args.trim();
    if (!trackId) {
      return {
        success: false,
        message: 'Please provide a track ID'
      };
    }

    const track = await this.manager.getTrack(trackId);
    if (!track) {
      return {
        success: false,
        message: `Track "${trackId}" not found`
      };
    }

    return {
      success: true,
      message: `Updating track: ${track.metadata.name}`,
      track,
      prompt: this.getUpdatePrompt(track)
    };
  }

  /**
   * /track complete <id> - Mark track as complete
   */
  private async handleComplete(args: string): Promise<TrackCommandResult> {
    const trackId = args.trim();
    if (!trackId) {
      return {
        success: false,
        message: 'Please provide a track ID'
      };
    }

    try {
      await this.manager.updateTrackStatus(trackId, 'completed');
      return {
        success: true,
        message: `Track "${trackId}" marked as complete!`
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to complete track: ${error}`
      };
    }
  }

  /**
   * /track setup - Initialize track system
   */
  private async handleSetup(): Promise<TrackCommandResult> {
    try {
      await this.manager.initialize();
      return {
        success: true,
        message: 'Track system initialized! Created:\n' +
          '  .codebuddy/context/product.md\n' +
          '  .codebuddy/context/tech-stack.md\n' +
          '  .codebuddy/context/guidelines.md\n' +
          '  .codebuddy/context/workflow.md\n' +
          '  .codebuddy/tracks.md\n\n' +
          'Edit these files to configure your project context.',
        prompt: this.getSetupPrompt()
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to initialize: ${error}`
      };
    }
  }

  /**
   * /track context - Show project context
   */
  private async handleContext(): Promise<TrackCommandResult> {
    const context = await this.manager.getContextString();

    if (!context.trim()) {
      return {
        success: true,
        message: 'No context files found. Run /track setup to initialize.'
      };
    }

    return {
      success: true,
      message: '# Project Context\n\n' + context
    };
  }

  // ============================================================
  // FORMATTING HELPERS
  // ============================================================

  private formatTrackStatus(track: Track): string {
    const m = track.metadata;
    const lines = [
      `# Track: ${m.name}`,
      '',
      `**ID:** ${m.id}`,
      `**Type:** ${m.type}`,
      `**Status:** ${this.getStatusEmoji(m.status)} ${m.status}`,
      `**Progress:** ${m.progress.completedTasks}/${m.progress.totalTasks} (${m.progress.percentage}%)`,
      `**Created:** ${m.createdAt.slice(0, 10)}`,
      `**Updated:** ${m.updatedAt.slice(0, 10)}`,
      '',
      '## Specification',
      track.spec.overview,
      '',
      '## Plan'
    ];

    for (const phase of track.plan.phases) {
      lines.push(`### ${phase.title}`);
      for (const task of phase.tasks) {
        const status = task.status === 'completed' ? '✅' :
                       task.status === 'in_progress' ? '🔄' : '⬜';
        lines.push(`${status} ${task.title}`);
      }
    }

    return lines.join('\n');
  }

  private formatTrackList(tracks: TrackMetadata[]): string {
    const lines = [
      '# Tracks',
      '',
      '| Status | Name | Type | Progress | Updated |',
      '|--------|------|------|----------|---------|'
    ];

    for (const t of tracks) {
      const status = this.getStatusEmoji(t.status);
      const progress = `${t.progress.percentage}%`;
      const updated = t.updatedAt.slice(0, 10);
      lines.push(`| ${status} | ${t.name} | ${t.type} | ${progress} | ${updated} |`);
    }

    return lines.join('\n');
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
  // AI PROMPTS
  // ============================================================

  private getNewTrackPrompt(): string {
    return `You are helping create a new development track. Ask the user:

1. **What is the name of this feature/task?**
   - Get a clear, concise name

2. **What type of work is this?**
   - feature: New functionality
   - bugfix: Fixing an issue
   - refactor: Code improvement
   - docs: Documentation
   - chore: Maintenance

3. **Brief description:**
   - What should this accomplish?

Once you have the information, use the write_file tool to create:
1. .codebuddy/tracks/<track_id>/spec.md with:
   - Overview
   - Requirements (bullet points)
   - Acceptance Criteria (checkboxes)

2. .codebuddy/tracks/<track_id>/plan.md with:
   - Phases (## headers)
   - Tasks (- [ ] checkboxes)
   - Subtasks if needed (indented)

3. .codebuddy/tracks/<track_id>/metadata.json

Then update .codebuddy/tracks.md with the new track entry.`;
  }

  private getSpecPlanPrompt(track: Track): string {
    return `A new track "${track.metadata.name}" has been created.

Now help the user define the specification and implementation plan.

## Current Track
- ID: ${track.metadata.id}
- Type: ${track.metadata.type}
- Location: .codebuddy/tracks/${track.metadata.id}/

## Your Tasks

1. **Ask clarifying questions** to understand:
   - What exactly should be implemented?
   - What are the requirements?
   - What are the acceptance criteria?
   - Are there any dependencies or constraints?

2. **Generate spec.md** with:
   - Clear overview
   - Numbered requirements
   - Testable acceptance criteria
   - Out of scope items (if any)

3. **Generate plan.md** with:
   - Logical phases (2-4 phases)
   - Concrete tasks per phase (3-7 tasks)
   - Subtasks for complex items
   - All tasks as [ ] pending

4. **Update metadata.json** with the task count

Read the project context files first:
- .codebuddy/context/product.md
- .codebuddy/context/tech-stack.md
- .codebuddy/context/guidelines.md

This ensures the plan aligns with existing conventions.`;
  }

  private getImplementPrompt(track: Track, phase: TrackPhase, task: TrackTask): string {
    return `You are implementing a task from the development plan.

## Current Track
- **Track:** ${track.metadata.name}
- **Phase:** ${phase.title}
- **Task:** ${task.title}

## Task Details
Implement this task following the project workflow:

1. **Read the context:**
   - .codebuddy/context/tech-stack.md for technical decisions
   - .codebuddy/context/guidelines.md for coding standards
   - .codebuddy/context/workflow.md for process

2. **Implement the task:**
   - Write clean, tested code
   - Follow existing patterns in the codebase
   - Keep changes focused on this task

3. **After implementation:**
   - Run relevant tests
   - Create a commit with conventional message
   - Update the plan.md to mark task as [x] with commit SHA

## Spec Reference
${track.spec.overview}

## Remaining Tasks in Phase
${phase.tasks.filter((t: TrackTask) => t.status !== 'completed').map((t: TrackTask) =>
  `- ${t.status === 'in_progress' ? '[~]' : '[ ]'} ${t.title}`
).join('\n')}

Start by reading the relevant files to understand the current state.`;
  }

  private getTrackCompletePrompt(track: Track): string {
    return `All tasks in track "${track.metadata.name}" are complete!

## Summary
- Total tasks: ${track.metadata.progress.totalTasks}
- Completed: ${track.metadata.progress.completedTasks}

## Next Steps

1. **Review the implementation:**
   - Run the full test suite
   - Check for any remaining issues

2. **Update documentation:**
   - Update .codebuddy/context/product.md if features changed
   - Update .codebuddy/context/tech-stack.md if new deps added

3. **Mark track as complete:**
   - Run: /track complete ${track.metadata.id}

4. **Optional cleanup:**
   - Archive or delete the track folder
   - Consider a release if appropriate`;
  }

  private getUpdatePrompt(track: Track): string {
    return `You are updating track "${track.metadata.name}".

## Current Files
- Spec: .codebuddy/tracks/${track.metadata.id}/spec.md
- Plan: .codebuddy/tracks/${track.metadata.id}/plan.md

## Options

1. **Update spec** - Add/modify requirements or criteria
2. **Update plan** - Add/remove/reorder tasks
3. **Add notes** - Add technical notes to spec

Ask the user what they want to update, then make the changes using write_file.

Remember to keep the plan.md status markers intact when updating.`;
  }

  private getSetupPrompt(): string {
    return `The track system has been initialized. Help the user configure their project:

## Created Files

1. **.codebuddy/context/product.md** - Product vision and goals
2. **.codebuddy/context/tech-stack.md** - Technical decisions
3. **.codebuddy/context/guidelines.md** - Coding standards
4. **.codebuddy/context/workflow.md** - Development process

## Your Task

Read each file and ask the user to customize them:

1. **Product context:**
   - What is this project?
   - Who are the users?
   - What are the main goals?

2. **Tech stack:**
   - What languages/frameworks?
   - Key dependencies?
   - Database/infrastructure?

3. **Guidelines:**
   - Coding style preferences?
   - Testing requirements?
   - Documentation standards?

4. **Workflow:**
   - TDD or code-first?
   - Commit conventions?
   - Review process?

Update each file based on the user's answers.`;
  }
}

// Export singleton for easy use
let trackCommandsInstance: TrackCommands | null = null;

export function getTrackCommands(workingDirectory?: string): TrackCommands {
  if (!trackCommandsInstance || workingDirectory) {
    trackCommandsInstance = new TrackCommands(workingDirectory);
  }
  return trackCommandsInstance;
}
