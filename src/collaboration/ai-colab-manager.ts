/**
 * AI Collaboration Manager
 * Manages multi-AI collaboration workflow following COLAB.md methodology
 */

import fs from 'fs';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked';
export type TaskPriority = 'high' | 'medium' | 'low';

export interface ColabTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  maxFiles: number;
  estimatedTests: number;
  filesToModify: string[];
  acceptanceCriteria: string[];
  proofOfFunctionality: string[];
  assignedAgent?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface WorkLogEntry {
  id: string;
  date: Date;
  agent: string;
  taskId?: string;
  summary: string;
  filesModified: Array<{ file: string; changes: string }>;
  testsAdded: Array<{ file: string; count: number }>;
  proofOfFunctionality: string;
  issues: string[];
  nextSteps: string[];
}

export interface ColabConfig {
  project: string;
  version: string;
  maxFilesPerIteration: number;
  targetCoverage: number;
  currentCoverage: number;
  lastUpdated: Date;
}

export interface HandoffInfo {
  fromAgent: string;
  toAgent: string;
  date: Date;
  currentTask: string;
  taskStatus: TaskStatus;
  context: string;
  filesInProgress: Array<{ file: string; state: string }>;
  blockers: string[];
  recommendedNextSteps: string[];
}

type SerializedDate = Date | number | string;

type SerializedColabTask = Omit<ColabTask, 'startedAt' | 'completedAt'> & {
  startedAt?: SerializedDate;
  completedAt?: SerializedDate;
};

type SerializedWorkLogEntry = Omit<WorkLogEntry, 'date'> & {
  date?: SerializedDate;
};

type SerializedColabConfig = Partial<Omit<ColabConfig, 'lastUpdated'>> & {
  lastUpdated?: SerializedDate;
};

// ============================================================================
// AI Collaboration Manager
// ============================================================================

export class AIColabManager {
  private colabFilePath: string;
  private tasksFilePath: string;
  private workLogFilePath: string;
  private config: ColabConfig;
  private tasks: Map<string, ColabTask> = new Map();
  private workLog: WorkLogEntry[] = [];

  constructor(workingDirectory: string = process.cwd()) {
    this.colabFilePath = path.join(workingDirectory, 'COLAB.md');
    this.tasksFilePath = path.join(workingDirectory, '.codebuddy', 'colab-tasks.json');
    this.workLogFilePath = path.join(workingDirectory, '.codebuddy', 'colab-worklog.json');

    this.config = {
      project: 'Code Buddy',
      version: '1.0.0',
      maxFilesPerIteration: 10,
      targetCoverage: 80,
      currentCoverage: 49,
      lastUpdated: new Date()
    };

    this.loadData();
  }

  // --------------------------------------------------------------------------
  // Data Management
  // --------------------------------------------------------------------------

  private loadData(): void {
    // Load tasks
    if (fs.existsSync(this.tasksFilePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.tasksFilePath, 'utf-8')) as {
          config?: SerializedColabConfig;
          tasks?: SerializedColabTask[];
        };
        for (const task of data.tasks || []) {
          this.tasks.set(task.id, {
            ...task,
            startedAt: this.parseOptionalDate(task.startedAt),
            completedAt: this.parseOptionalDate(task.completedAt)
          });
        }
        if (data.config) {
          this.config = {
            ...this.config,
            ...data.config,
            lastUpdated: this.parseOptionalDate(data.config.lastUpdated) ?? this.config.lastUpdated
          };
        }
      } catch {
        // Ignore parse errors, use defaults
      }
    }

    // Load work log
    if (fs.existsSync(this.workLogFilePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.workLogFilePath, 'utf-8')) as {
          entries?: SerializedWorkLogEntry[];
        };
        this.workLog = (data.entries || []).map(entry => ({
          ...entry,
          date: this.parseOptionalDate(entry.date) ?? new Date()
        }));
      } catch {
        // Ignore parse errors, use defaults
      }
    }
  }

  private parseOptionalDate(value: SerializedDate | undefined): Date | undefined {
    if (value === undefined) {
      return undefined;
    }

    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private saveData(): void {
    const dir = path.dirname(this.tasksFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Save tasks
    fs.writeFileSync(this.tasksFilePath, JSON.stringify({
      config: this.config,
      tasks: Array.from(this.tasks.values())
    }, null, 2));

    // Save work log
    fs.writeFileSync(this.workLogFilePath, JSON.stringify({
      entries: this.workLog
    }, null, 2));
  }

  // --------------------------------------------------------------------------
  // Task Management
  // --------------------------------------------------------------------------

  /**
   * Get all tasks
   */
  getTasks(): ColabTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks by status
   */
  getTasksByStatus(status: TaskStatus): ColabTask[] {
    return this.getTasks().filter(t => t.status === status);
  }

  /**
   * Get next available task (highest priority, not started)
   */
  getNextTask(): ColabTask | null {
    const available = this.getTasksByStatus('not_started')
      .sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
    return available[0] || null;
  }

  /**
   * Create a new task
   */
  createTask(task: Omit<ColabTask, 'id'>): ColabTask {
    const id = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newTask: ColabTask = { ...task, id };
    this.tasks.set(id, newTask);
    this.saveData();
    return newTask;
  }

  /**
   * Update task status
   */
  updateTaskStatus(taskId: string, status: TaskStatus, agent?: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.status = status;
    if (status === 'in_progress') {
      task.assignedAgent = agent;
      task.startedAt = new Date();
    } else if (status === 'completed') {
      task.completedAt = new Date();
    }

    this.tasks.set(taskId, task);
    this.saveData();
    return true;
  }

  /**
   * Start working on a task
   */
  startTask(taskId: string, agent: string): { success: boolean; task?: ColabTask; error?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: `Task ${taskId} not found` };
    }
    if (task.status === 'in_progress') {
      return { success: false, error: `Task already in progress by ${task.assignedAgent}` };
    }
    if (task.status === 'completed') {
      return { success: false, error: 'Task already completed' };
    }

    this.updateTaskStatus(taskId, 'in_progress', agent);
    return { success: true, task: this.tasks.get(taskId) };
  }

  /**
   * Complete a task
   */
  completeTask(taskId: string, workLogEntry: Omit<WorkLogEntry, 'id' | 'date' | 'taskId'>): { success: boolean; error?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: `Task ${taskId} not found` };
    }

    // Validate max files constraint
    if (workLogEntry.filesModified.length > this.config.maxFilesPerIteration) {
      return {
        success: false,
        error: `Too many files modified (${workLogEntry.filesModified.length}). Max allowed: ${this.config.maxFilesPerIteration}`
      };
    }

    this.updateTaskStatus(taskId, 'completed');
    this.addWorkLogEntry({ ...workLogEntry, taskId });
    return { success: true };
  }

  // --------------------------------------------------------------------------
  // Work Log Management
  // --------------------------------------------------------------------------

  /**
   * Add a work log entry
   */
  addWorkLogEntry(entry: Omit<WorkLogEntry, 'id' | 'date'>): WorkLogEntry {
    const newEntry: WorkLogEntry = {
      ...entry,
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      date: new Date()
    };
    this.workLog.push(newEntry);
    this.saveData();
    this.updateColabMd(newEntry);
    return newEntry;
  }

  /**
   * Get recent work log entries
   */
  getRecentWorkLog(limit: number = 10): WorkLogEntry[] {
    return this.workLog.slice(-limit);
  }

  // --------------------------------------------------------------------------
  // Handoff Management
  // --------------------------------------------------------------------------

  /**
   * Create a handoff to another AI agent
   */
  createHandoff(info: Omit<HandoffInfo, 'date'>): string {
    const handoff: HandoffInfo = { ...info, date: new Date() };

    const markdown = this.formatHandoff(handoff);

    // Add to work log
    this.addWorkLogEntry({
      agent: info.fromAgent,
      taskId: info.currentTask,
      summary: `Handoff to ${info.toAgent}`,
      filesModified: info.filesInProgress.map(f => ({ file: f.file, changes: f.state })),
      testsAdded: [],
      proofOfFunctionality: '',
      issues: info.blockers,
      nextSteps: info.recommendedNextSteps
    });

    return markdown;
  }

  /**
   * Format handoff information as markdown
   */
  private formatHandoff(info: HandoffInfo): string {
    return `## Handoff from ${info.fromAgent} to ${info.toAgent}

**Date:** ${info.date.toISOString().split('T')[0]}
**Current Task:** ${info.currentTask} (${info.taskStatus})

### Context
${info.context}

### Files in Progress
${info.filesInProgress.map(f => `- \`${f.file}\` - ${f.state}`).join('\n')}

### Blockers
${info.blockers.length > 0 ? info.blockers.map(b => `- ${b}`).join('\n') : '(none)'}

### Recommended Next Steps
${info.recommendedNextSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
`;
  }

  // --------------------------------------------------------------------------
  // COLAB.md Management
  // --------------------------------------------------------------------------

  /**
   * Update COLAB.md with new work log entry
   */
  private updateColabMd(entry: WorkLogEntry): void {
    if (!fs.existsSync(this.colabFilePath)) return;

    try {
      let content = fs.readFileSync(this.colabFilePath, 'utf-8');

      const logEntry = this.formatWorkLogEntry(entry);

      // Find Work Log section and append
      const workLogMarker = '## Work Log';
      const markerIndex = content.indexOf(workLogMarker);

      if (markerIndex !== -1) {
        // Find the first entry after the marker (starts with ###)
        const afterMarker = content.substring(markerIndex + workLogMarker.length);
        const firstEntryMatch = afterMarker.match(/\n### /);

        if (firstEntryMatch && firstEntryMatch.index !== undefined) {
          const insertPosition = markerIndex + workLogMarker.length + firstEntryMatch.index;
          content = content.substring(0, insertPosition) + '\n\n' + logEntry + content.substring(insertPosition);
        } else {
          // No existing entries, add after marker
          content = content.substring(0, markerIndex + workLogMarker.length) + '\n\n' + logEntry + content.substring(markerIndex + workLogMarker.length);
        }

        fs.writeFileSync(this.colabFilePath, content);
      }
    } catch {
      // Ignore errors updating COLAB.md
    }
  }

  /**
   * Format work log entry as markdown
   */
  private formatWorkLogEntry(entry: WorkLogEntry): string {
    const dateStr = entry.date.toISOString().split('T')[0];
    return `### ${dateStr} - ${entry.summary}

**Agent:** ${entry.agent}
${entry.taskId ? `**Task:** ${entry.taskId}` : ''}

**Summary:**
${entry.summary}

**Files Modified:**
${entry.filesModified.map(f => `- \`${f.file}\` - ${f.changes}`).join('\n') || '(none)'}

**Tests Added:**
${entry.testsAdded.map(t => `- \`${t.file}\` (${t.count} tests)`).join('\n') || '(none)'}

**Proof of Functionality:**
\`\`\`bash
${entry.proofOfFunctionality || '# No proof provided'}
\`\`\`

${entry.issues.length > 0 ? `**Issues:**\n${entry.issues.map(i => `- ${i}`).join('\n')}` : ''}

**Next Steps:**
${entry.nextSteps.map((s, i) => `${i + 1}. ${s}`).join('\n') || '(none)'}

---
`;
  }

  // --------------------------------------------------------------------------
  // AI Instructions
  // --------------------------------------------------------------------------

  /**
   * Generate instructions for a new AI agent joining the collaboration
   */
  generateAgentInstructions(agentName: string): string {
    const nextTask = this.getNextTask();
    const recentLog = this.getRecentWorkLog(3);

    return `## Instructions de Collaboration - ${agentName}

### Contexte du Projet

Tu participes au développement collaboratif de **${this.config.project}** v${this.config.version}.
Couverture de tests actuelle: ${this.config.currentCoverage}% (objectif: ${this.config.targetCoverage}%)

### Fichiers importants

- \`COLAB.md\` - Document de coordination principal
- \`CLAUDE.md\` - Instructions de build et développement
- \`.codebuddy/colab-tasks.json\` - Tâches en cours
- \`.codebuddy/colab-worklog.json\` - Journal de travail

### Règles de Collaboration

1. **Maximum ${this.config.maxFilesPerIteration} fichiers** modifiés par itération
2. **Tests obligatoires** - Chaque modification nécessite des tests
3. **Preuve de fonctionnement** - Documente les commandes et résultats
4. **Pas de types \`any\`** - Maintiens la sécurité TypeScript
5. **Documente ton travail** - Utilise \`/colab log\` pour enregistrer

### Commandes disponibles

\`\`\`
/colab status     - Voir l'état actuel du projet
/colab tasks      - Lister les tâches disponibles
/colab start <id> - Commencer une tâche
/colab log        - Enregistrer une entrée de travail
/colab complete   - Marquer une tâche comme terminée
/colab handoff    - Préparer un transfert à un autre agent
\`\`\`

${nextTask ? `### Prochaine tâche suggérée

**${nextTask.id}**: ${nextTask.title}
- Priorité: ${nextTask.priority.toUpperCase()}
- Max fichiers: ${nextTask.maxFiles}
- Description: ${nextTask.description}

Pour commencer: \`/colab start ${nextTask.id}\`` : '### Aucune tâche disponible\n\nToutes les tâches sont en cours ou terminées.'}

${recentLog.length > 0 ? `### Activité récente

${recentLog.map(e => `- **${e.date.toISOString().split('T')[0]}** - ${e.agent}: ${e.summary}`).join('\n')}` : ''}

### Pour commencer

1. Lis \`COLAB.md\` pour comprendre le contexte complet
2. Exécute \`/colab status\` pour voir l'état actuel
3. Choisis une tâche avec \`/colab tasks\`
4. Commence avec \`/colab start <task-id>\`
`;
  }

  // --------------------------------------------------------------------------
  // Status and Reports
  // --------------------------------------------------------------------------

  /**
   * Get current collaboration status
   */
  getStatus(): string {
    const tasks = this.getTasks();
    const notStarted = tasks.filter(t => t.status === 'not_started').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const blocked = tasks.filter(t => t.status === 'blocked').length;

    const currentTasks = tasks.filter(t => t.status === 'in_progress');

    return `## Statut de Collaboration

**Projet:** ${this.config.project} v${this.config.version}
**Dernière mise à jour:** ${this.config.lastUpdated.toISOString().split('T')[0]}
**Couverture:** ${this.config.currentCoverage}% / ${this.config.targetCoverage}%

### Progression des tâches

| Statut | Nombre |
|--------|--------|
| Non commencées | ${notStarted} |
| En cours | ${inProgress} |
| Terminées | ${completed} |
| Bloquées | ${blocked} |
| **Total** | **${tasks.length}** |

${currentTasks.length > 0 ? `### Tâches en cours

${currentTasks.map(t => `- **${t.id}**: ${t.title} (${t.assignedAgent || 'non assigné'})`).join('\n')}` : ''}

### Règles actives

- Max fichiers par itération: ${this.config.maxFilesPerIteration}
- Tests requis: Oui
- Documentation requise: Oui
`;
  }

  /**
   * List all tasks formatted
   */
  listTasks(): string {
    const tasks = this.getTasks();

    if (tasks.length === 0) {
      return 'Aucune tâche définie. Utilisez `/colab create` pour créer une tâche.';
    }

    const byStatus: Record<TaskStatus, ColabTask[]> = {
      'not_started': [],
      'in_progress': [],
      'completed': [],
      'blocked': []
    };

    for (const task of tasks) {
      byStatus[task.status].push(task);
    }

    let output = '## Liste des tâches\n\n';

    const statusLabels: Record<TaskStatus, string> = {
      'not_started': '[ ] Non commencées',
      'in_progress': '[~] En cours',
      'completed': '[x] Terminées',
      'blocked': '[!] Bloquées'
    };

    for (const [status, label] of Object.entries(statusLabels)) {
      const statusTasks = byStatus[status as TaskStatus];
      if (statusTasks.length > 0) {
        output += `### ${label}\n\n`;
        for (const task of statusTasks) {
          output += `- **${task.id}**: ${task.title}\n`;
          output += `  - Priorité: ${task.priority} | Max fichiers: ${task.maxFiles}\n`;
          if (task.assignedAgent) {
            output += `  - Assigné à: ${task.assignedAgent}\n`;
          }
        }
        output += '\n';
      }
    }

    return output;
  }

  /**
   * Initialize default tasks from COLAB.md structure
   */
  initializeDefaultTasks(): void {
    const defaultTasks: Omit<ColabTask, 'id'>[] = [
      {
        title: 'Base Agent Extraction',
        description: 'Extract base agent class from CodeBuddyAgent',
        status: 'not_started',
        priority: 'high',
        maxFiles: 10,
        estimatedTests: 20,
        filesToModify: [
          'src/agent/codebuddy-agent.ts',
          'src/agent/base-agent.ts',
          'src/agent/index.ts',
          'src/types/agent.ts',
          'tests/unit/base-agent.test.ts'
        ],
        acceptanceCriteria: [
          'Base agent class created with core methods',
          'CodeBuddyAgent extends BaseAgent',
          'All existing tests pass',
          'New unit tests pass (coverage > 80%)',
          'Type safety maintained (no any)'
        ],
        proofOfFunctionality: [
          'npm test -- tests/unit/base-agent.test.ts',
          'npm run typecheck'
        ]
      },
      {
        title: 'Tool Registry Consolidation',
        description: 'Consolidate tool registration and selection into single registry',
        status: 'not_started',
        priority: 'high',
        maxFiles: 10,
        estimatedTests: 15,
        filesToModify: [
          'src/codebuddy/tools.ts',
          'src/tools/registry.ts',
          'src/tools/types.ts',
          'src/tools/index.ts',
          'tests/unit/tool-registry.test.ts'
        ],
        acceptanceCriteria: [
          'Single source of truth for tool definitions',
          'RAG-based selection preserved',
          'Tool caching maintained',
          'All existing functionality works'
        ],
        proofOfFunctionality: [
          'npm test -- tests/unit/tool-registry.test.ts',
          'buddy "list files"'
        ]
      },
      {
        title: 'Provider Interface Unification',
        description: 'Create unified provider interface for all AI services',
        status: 'not_started',
        priority: 'high',
        maxFiles: 10,
        estimatedTests: 20,
        filesToModify: [
          'src/providers/base-provider.ts',
          'src/providers/grok-provider.ts',
          'src/providers/claude-provider.ts',
          'src/providers/openai-provider.ts',
          'src/providers/gemini-provider.ts',
          'src/providers/index.ts',
          'tests/unit/providers.test.ts'
        ],
        acceptanceCriteria: [
          'All providers implement same interface',
          'Feature detection works (streaming, tools, vision)',
          'Fallback mechanisms in place',
          'Provider switching works at runtime'
        ],
        proofOfFunctionality: [
          'npm test -- tests/unit/providers.test.ts',
          'buddy provider list',
          'buddy provider switch claude'
        ]
      },
      {
        title: 'Error Handling Standardization',
        description: 'Standardize error handling across codebase',
        status: 'not_started',
        priority: 'medium',
        maxFiles: 8,
        estimatedTests: 15,
        filesToModify: [
          'src/errors/base-error.ts',
          'src/errors/agent-error.ts',
          'src/errors/tool-error.ts',
          'src/errors/provider-error.ts',
          'src/errors/index.ts',
          'tests/unit/errors.test.ts'
        ],
        acceptanceCriteria: [
          'Consistent error hierarchy',
          'Proper error codes',
          'Stack traces preserved',
          'User-friendly messages'
        ],
        proofOfFunctionality: [
          'npm test -- tests/unit/errors.test.ts'
        ]
      },
      {
        title: 'Increase Test Coverage to 80%',
        description: 'Add unit tests to reach 80% coverage target',
        status: 'in_progress',
        priority: 'high',
        maxFiles: 10,
        estimatedTests: 100,
        filesToModify: [
          'tests/unit/*.test.ts'
        ],
        acceptanceCriteria: [
          'Coverage reaches 80%',
          'All tests pass',
          'No flaky tests',
          'Good test isolation'
        ],
        proofOfFunctionality: [
          'npm run test:coverage'
        ]
      }
    ];

    for (const task of defaultTasks) {
      // Only add if not already exists (check by title)
      const existing = this.getTasks().find(t => t.title === task.title);
      if (!existing) {
        this.createTask(task);
      }
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let colabManagerInstance: AIColabManager | null = null;

export function getAIColabManager(workingDirectory?: string): AIColabManager {
  if (!colabManagerInstance) {
    colabManagerInstance = new AIColabManager(workingDirectory);
  }
  return colabManagerInstance;
}

export function resetAIColabManager(): void {
  colabManagerInstance = null;
}
