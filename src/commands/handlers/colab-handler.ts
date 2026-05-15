/**
 * Colab Command Handler
 * Handles /colab commands for AI collaboration workflow
 */

import { getAIColabManager } from '../../collaboration/ai-colab-manager.js';

export interface ColabCommandResult {
  success: boolean;
  output: string;
  action?: string;
  data?: unknown;
}

/**
 * Handle /colab commands
 */
export async function handleColabCommand(args: string[]): Promise<ColabCommandResult> {
  const manager = getAIColabManager();
  const action = args[0]?.toLowerCase() || 'status';

  switch (action) {
    case 'status':
      return handleStatus(manager);

    case 'tasks':
      return handleTasks(manager);

    case 'start':
      return handleStart(manager, args.slice(1));

    case 'complete':
      return handleComplete(manager, args.slice(1));

    case 'log':
      return handleLog(manager, args.slice(1));

    case 'handoff':
      return handleHandoff(manager, args.slice(1));

    case 'init':
      return handleInit(manager);

    case 'instructions':
      return handleInstructions(manager, args.slice(1));

    case 'create':
      return handleCreate(manager, args.slice(1));

    case 'help':
    default:
      return handleHelp();
  }
}

function handleStatus(manager: ReturnType<typeof getAIColabManager>): ColabCommandResult {
  return {
    success: true,
    output: manager.getStatus(),
    action: 'status'
  };
}

function handleTasks(manager: ReturnType<typeof getAIColabManager>): ColabCommandResult {
  return {
    success: true,
    output: manager.listTasks(),
    action: 'tasks'
  };
}

function handleStart(manager: ReturnType<typeof getAIColabManager>, args: string[]): ColabCommandResult {
  const taskId = args[0];
  const agentName = args[1] || 'AI Agent';

  if (!taskId) {
    return {
      success: false,
      output: 'Usage: /colab start <task-id> [agent-name]\n\nUse /colab tasks to see available tasks.'
    };
  }

  const result = manager.startTask(taskId, agentName);

  if (!result.success) {
    return {
      success: false,
      output: `Failed to start task: ${result.error}`
    };
  }

  const task = result.task!;
  return {
    success: true,
    output: `## Task Started: ${task.title}

**ID:** ${task.id}
**Agent:** ${agentName}
**Priority:** ${task.priority.toUpperCase()}
**Max Files:** ${task.maxFiles}

### Description
${task.description}

### Files to Modify
${task.filesToModify.map(f => `- \`${f}\``).join('\n')}

### Acceptance Criteria
${task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

### Proof of Functionality
\`\`\`bash
${task.proofOfFunctionality.join('\n')}
\`\`\`

---
**Reminder:** Maximum ${task.maxFiles} files per iteration. Document your work with \`/colab log\`.
`,
    action: 'start',
    data: task
  };
}

function handleComplete(manager: ReturnType<typeof getAIColabManager>, args: string[]): ColabCommandResult {
  const taskId = args.find(arg => !arg.startsWith('--'));
  const confirmed = args.includes('--confirm');

  if (!taskId) {
    // Find current in-progress task
    const inProgress = manager.getTasksByStatus('in_progress');
    if (inProgress.length === 0) {
      return {
        success: false,
        output: 'No task in progress. Use /colab start <task-id> to start a task.'
      };
    }

    return {
      success: false,
      output: `## Complete a Task

Current tasks in progress:
${inProgress.map(t => `- **${t.id}**: ${t.title} (${t.assignedAgent})`).join('\n')}

Usage: /colab complete <task-id>

**Note:** Before completing, make sure to:
1. All acceptance criteria are met
2. Tests are passing
3. Work is documented with /colab log
`
    };
  }

  const task = manager.getTasks().find(t => t.id === taskId);
  if (!task) {
    return {
      success: false,
      output: `Task ${taskId} not found. Use /colab tasks to see available tasks.`
    };
  }

  if (confirmed) {
    if (task.status === 'completed') {
      return {
        success: false,
        output: `Task ${taskId} is already completed.`
      };
    }

    if (task.status !== 'in_progress') {
      return {
        success: false,
        output: `Task ${taskId} is ${task.status}. Start it with /colab start ${taskId} before completing it.`
      };
    }

    const matchingLogs = manager.getRecentWorkLog(50).filter(entry => entry.taskId === taskId);
    const latestLog = matchingLogs[matchingLogs.length - 1];
    if (!latestLog) {
      return {
        success: false,
        output: `Task ${taskId} cannot be completed without a matching work log. Add one with /colab log add --task ${taskId} ...`
      };
    }

    if (latestLog.filesModified.length > task.maxFiles) {
      return {
        success: false,
        output: `Task ${taskId} modifies ${latestLog.filesModified.length} files, above the task limit of ${task.maxFiles}. Split the work before completing it.`
      };
    }

    if (!latestLog.proofOfFunctionality.trim()) {
      return {
        success: false,
        output: `Task ${taskId} cannot be completed without proof of functionality. Add --proof "npm test ..." to the work log.`
      };
    }

    manager.updateTaskStatus(taskId, 'completed');
    return {
      success: true,
      output: `## Task Completed: ${task.title}

**ID:** ${task.id}
**Agent:** ${task.assignedAgent || latestLog.agent}
**Proof:** ${latestLog.proofOfFunctionality}
`,
      action: 'complete',
      data: manager.getTasks().find(t => t.id === taskId)
    };
  }

  return {
    success: true,
    output: `## Complete Task: ${taskId}

To complete this task, provide a work log entry:

\`\`\`
/colab log
Agent: [Your name]
Summary: [What was accomplished]
Files: file1.ts, file2.ts
Tests: test1.test.ts (10 tests)
Proof: npm test -- tests/unit/...
Issues: [Any problems encountered]
Next: [Recommendations for next steps]
\`\`\`

Then run: /colab complete ${taskId} --confirm
`,
    action: 'complete-prompt'
  };
}

function handleLog(manager: ReturnType<typeof getAIColabManager>, args: string[]): ColabCommandResult {
  if (args.length === 0) {
    // Show recent log
    const recent = manager.getRecentWorkLog(5);

    if (recent.length === 0) {
      return {
        success: true,
        output: `## Work Log

No entries yet. Add an entry with:

\`\`\`
/colab log add --agent "Claude" --summary "Description of work" --files "file1.ts,file2.ts" --tests "test.test.ts:10"
\`\`\`
`
      };
    }

    return {
      success: true,
      output: `## Recent Work Log

${recent.map(e => `### ${e.date.toISOString().split('T')[0]} - ${e.summary}
**Agent:** ${e.agent}
**Files:** ${e.filesModified.map(f => f.file).join(', ') || '(none)'}
**Tests:** ${e.testsAdded.map(t => `${t.file} (${t.count})`).join(', ') || '(none)'}
`).join('\n---\n')}
`,
      action: 'log-list'
    };
  }

  if (args[0] === 'add') {
    // Parse log entry from args
    const entry = parseLogArgs(args.slice(1));

    if (!entry.agent || !entry.summary) {
      return {
        success: false,
        output: `## Add Work Log Entry

Usage: /colab log add --agent "Name" --summary "Description" [options]

Options:
  --agent <name>     Agent name (required)
  --summary <text>   Summary of work (required)
  --task <id>        Associated task ID
  --files <list>     Comma-separated files modified
  --tests <list>     Tests added (format: file.test.ts:count)
  --proof <cmd>      Proof of functionality command
  --issues <list>    Issues encountered
  --next <list>      Next steps

Example:
\`\`\`
/colab log add --agent "Claude" --summary "Implemented base agent" --files "src/agent/base.ts,src/agent/index.ts" --tests "tests/unit/base-agent.test.ts:15" --proof "npm test -- tests/unit/base-agent.test.ts"
\`\`\`
`
      };
    }

    const logEntry = manager.addWorkLogEntry({
      agent: entry.agent,
      taskId: entry.taskId,
      summary: entry.summary,
      filesModified: entry.files.map(f => ({ file: f, changes: 'modified' })),
      testsAdded: entry.tests,
      proofOfFunctionality: entry.proof || '',
      issues: entry.issues,
      nextSteps: entry.nextSteps
    });

    return {
      success: true,
      output: `## Work Log Entry Added

**ID:** ${logEntry.id}
**Date:** ${logEntry.date.toISOString().split('T')[0]}
**Agent:** ${logEntry.agent}
**Summary:** ${logEntry.summary}

Entry has been added to COLAB.md.
`,
      action: 'log-add',
      data: logEntry
    };
  }

  return {
    success: false,
    output: 'Unknown log action. Use /colab log or /colab log add'
  };
}

function handleHandoff(manager: ReturnType<typeof getAIColabManager>, args: string[]): ColabCommandResult {
  const toAgent = args[0];

  if (!toAgent) {
    return {
      success: false,
      output: `## Create Handoff

Usage: /colab handoff <to-agent> [options]

Options:
  --from <agent>     Your agent name
  --task <id>        Current task ID
  --context <text>   Context description
  --blockers <list>  Blockers (comma-separated)
  --next <list>      Next steps (comma-separated)

Example:
\`\`\`
/colab handoff "Gemini" --from "Claude" --task "task-123" --context "Implementing base agent" --next "Complete tests,Update docs"
\`\`\`
`
    };
  }

  // Parse handoff args
  const handoffArgs = parseHandoffArgs(args);

  const handoffMarkdown = manager.createHandoff({
    fromAgent: handoffArgs.from || 'AI Agent',
    toAgent: toAgent,
    currentTask: handoffArgs.task || '(none)',
    taskStatus: 'in_progress',
    context: handoffArgs.context || 'Continuing development work',
    filesInProgress: handoffArgs.files.map(f => ({ file: f, state: 'in progress' })),
    blockers: handoffArgs.blockers,
    recommendedNextSteps: handoffArgs.nextSteps
  });

  return {
    success: true,
    output: `## Handoff Created

${handoffMarkdown}

---

**Instructions for ${toAgent}:**

Copy and share this handoff with the next agent. They should:
1. Read COLAB.md for full context
2. Run \`/colab status\` to see current state
3. Continue with the recommended next steps
`,
    action: 'handoff'
  };
}

function handleInit(manager: ReturnType<typeof getAIColabManager>): ColabCommandResult {
  manager.initializeDefaultTasks();

  return {
    success: true,
    output: `## Collaboration Initialized

Default tasks have been created:
${manager.listTasks()}

**Next Steps:**
1. Review tasks with \`/colab tasks\`
2. Start a task with \`/colab start <task-id>\`
3. Document work with \`/colab log\`
`,
    action: 'init'
  };
}

function handleInstructions(manager: ReturnType<typeof getAIColabManager>, args: string[]): ColabCommandResult {
  const agentName = args.join(' ') || 'New AI Agent';

  return {
    success: true,
    output: manager.generateAgentInstructions(agentName),
    action: 'instructions'
  };
}

function handleCreate(manager: ReturnType<typeof getAIColabManager>, args: string[]): ColabCommandResult {
  if (args.length < 2) {
    return {
      success: false,
      output: `## Create New Task

Usage: /colab create "<title>" "<description>" [options]

Options:
  --priority <level>   high, medium, low (default: medium)
  --max-files <n>      Max files per iteration (default: 10)
  --files <list>       Files to modify (comma-separated)

Example:
\`\`\`
/colab create "Add logging system" "Implement structured logging across the application" --priority high --files "src/logging/index.ts,src/utils/logger.ts"
\`\`\`
`
    };
  }

  const title = args[0];
  const description = args[1];
  const options = parseCreateArgs(args.slice(2));

  const task = manager.createTask({
    title,
    description,
    status: 'not_started',
    priority: options.priority || 'medium',
    maxFiles: options.maxFiles || 10,
    estimatedTests: 10,
    filesToModify: options.files,
    acceptanceCriteria: ['Implementation complete', 'Tests passing', 'Documentation updated'],
    proofOfFunctionality: ['npm test', 'npm run typecheck']
  });

  return {
    success: true,
    output: `## Task Created

**ID:** ${task.id}
**Title:** ${task.title}
**Priority:** ${task.priority}
**Max Files:** ${task.maxFiles}

Start this task with: \`/colab start ${task.id}\`
`,
    action: 'create',
    data: task
  };
}

function handleHelp(): ColabCommandResult {
  return {
    success: true,
    output: `## AI Collaboration Commands

Manage multi-AI collaboration workflow for development.

### Commands

| Command | Description |
|---------|-------------|
| \`/colab status\` | Show current collaboration status |
| \`/colab tasks\` | List all tasks |
| \`/colab start <id>\` | Start working on a task |
| \`/colab complete <id>\` | Mark a task as completed |
| \`/colab log\` | View or add work log entries |
| \`/colab handoff <agent>\` | Create handoff to another AI |
| \`/colab init\` | Initialize default tasks |
| \`/colab instructions [agent]\` | Generate instructions for an AI |
| \`/colab create <title> <desc>\` | Create a new task |

### Workflow

1. **Init**: \`/colab init\` - Set up default tasks
2. **Start**: \`/colab start <task-id>\` - Begin working
3. **Work**: Implement with max 10 files per iteration
4. **Log**: \`/colab log add ...\` - Document work
5. **Complete**: \`/colab complete <task-id>\` - Finish task
6. **Handoff**: \`/colab handoff <agent>\` - Pass to next AI

### Rules

- Maximum **10 files** modified per iteration
- **Tests required** for all changes
- **Document work** in the log
- **No \`any\` types** - maintain type safety

See COLAB.md for full documentation.
`,
    action: 'help'
  };
}

// ============================================================================
// Argument Parsing Helpers
// ============================================================================

interface LogEntryArgs {
  agent: string;
  summary: string;
  taskId?: string;
  files: string[];
  tests: Array<{ file: string; count: number }>;
  proof?: string;
  issues: string[];
  nextSteps: string[];
}

function parseLogArgs(args: string[]): LogEntryArgs {
  const result: LogEntryArgs = {
    agent: '',
    summary: '',
    files: [],
    tests: [],
    issues: [],
    nextSteps: []
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];

    switch (arg) {
      case '--agent':
        result.agent = value || '';
        i++;
        break;
      case '--summary':
        result.summary = value || '';
        i++;
        break;
      case '--task':
        result.taskId = value;
        i++;
        break;
      case '--files':
        result.files = (value || '').split(',').map(f => f.trim()).filter(Boolean);
        i++;
        break;
      case '--tests':
        result.tests = (value || '').split(',').map(t => {
          const [file, count] = t.trim().split(':');
          return { file, count: parseInt(count) || 0 };
        }).filter(t => t.file);
        i++;
        break;
      case '--proof':
        result.proof = value;
        i++;
        break;
      case '--issues':
        result.issues = (value || '').split(',').map(i => i.trim()).filter(Boolean);
        i++;
        break;
      case '--next':
        result.nextSteps = (value || '').split(',').map(s => s.trim()).filter(Boolean);
        i++;
        break;
    }
  }

  return result;
}

interface HandoffArgs {
  from: string;
  task: string;
  context: string;
  files: string[];
  blockers: string[];
  nextSteps: string[];
}

function parseHandoffArgs(args: string[]): HandoffArgs {
  const result: HandoffArgs = {
    from: '',
    task: '',
    context: '',
    files: [],
    blockers: [],
    nextSteps: []
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];

    switch (arg) {
      case '--from':
        result.from = value || '';
        i++;
        break;
      case '--task':
        result.task = value || '';
        i++;
        break;
      case '--context':
        result.context = value || '';
        i++;
        break;
      case '--files':
        result.files = (value || '').split(',').map(f => f.trim()).filter(Boolean);
        i++;
        break;
      case '--blockers':
        result.blockers = (value || '').split(',').map(b => b.trim()).filter(Boolean);
        i++;
        break;
      case '--next':
        result.nextSteps = (value || '').split(',').map(s => s.trim()).filter(Boolean);
        i++;
        break;
    }
  }

  return result;
}

interface CreateTaskArgs {
  priority: 'high' | 'medium' | 'low';
  maxFiles: number;
  files: string[];
}

function parseCreateArgs(args: string[]): CreateTaskArgs {
  const result: CreateTaskArgs = {
    priority: 'medium',
    maxFiles: 10,
    files: []
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];

    switch (arg) {
      case '--priority':
        if (value === 'high' || value === 'medium' || value === 'low') {
          result.priority = value;
        }
        i++;
        break;
      case '--max-files':
        result.maxFiles = parseInt(value) || 10;
        i++;
        break;
      case '--files':
        result.files = (value || '').split(',').map(f => f.trim()).filter(Boolean);
        i++;
        break;
    }
  }

  return result;
}
