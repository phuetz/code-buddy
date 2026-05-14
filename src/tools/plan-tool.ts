
import { BaseTool, ParameterDefinition } from './base-tool.js';
import { ToolResult } from '../types/index.js';
import fs from 'fs-extra';
import * as path from 'path';
import type { KnowledgeGraph } from '../knowledge/knowledge-graph.js';

/** Cached entity extractor — loaded lazily from context provider */
let _extractEntities: ((msg: string) => string[]) | null = null;
import('../knowledge/code-graph-context-provider.js')
  .then(mod => { _extractEntities = mod.extractEntities; })
  .catch(() => { /* optional */ });

/**
 * PlanTool
 *
 * Manages a persistent PLAN.md file to track complex task execution.
 * This aligns with the "Open Manus" / "CodeAct" philosophy of maintaining
 * a visible, persistent state of the agent's plan.
 *
 * Graph-aware: when a code graph is available, appended steps are enriched
 * with file metadata and impact info. The `suggest_order` action reorders
 * steps by dependency graph topological sort.
 */
export class PlanTool extends BaseTool {
  readonly name = 'plan';
  readonly description = 'Manage a persistent execution plan (PLAN.md). Use this to track progress on complex tasks.';

  private planPath: string;
  private graph: KnowledgeGraph | null = null;

  constructor(cwd: string = process.cwd()) {
    super();
    this.planPath = path.join(cwd, 'PLAN.md');
  }

  /**
   * Wire the code graph for file suggestions and dependency ordering.
   */
  setGraph(graph: KnowledgeGraph): void {
    this.graph = graph;
  }

  protected getParameters(): Record<string, ParameterDefinition> {
    return {
      action: {
        type: 'string',
        description: 'Action to perform: "init" (create new), "read" (view), "update" (mark step), "append" (add step), "suggest_order" (reorder by dependency).',
        enum: ['init', 'read', 'update', 'append', 'suggest_order'],
        required: true,
      },
      goal: {
        type: 'string',
        description: 'The main goal for "init" action.',
      },
      step: {
        type: 'string',
        description: 'The step description for "append" or the text to match for "update".',
      },
      status: {
        type: 'string',
        description: 'Status for "update" action: "pending" ([ ]), "in_progress" ([/]), "completed" ([x]), "failed" ([-]).',
        enum: ['pending', 'in_progress', 'completed', 'failed'],
      }
    };
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;

    try {
      if (action === 'init') {
        return this.initPlan(input.goal as string);
      } else if (action === 'read') {
        return this.readPlan();
      } else if (action === 'append') {
        return this.appendStep(input.step as string);
      } else if (action === 'update') {
        return this.updateStep(input.step as string, input.status as string);
      } else if (action === 'suggest_order') {
        return this.suggestOrder();
      } else {
        return this.error(`Unknown action: ${action}`);
      }
    } catch (err) {
      return this.error(`Plan operation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async initPlan(goal: string): Promise<ToolResult> {
    if (!goal) return this.error('Goal is required for init');

    // Inject relevant architecture context from docs if available
    let contextSection = '';
    try {
      const { getDocsContextProvider } = await import('../docs/docs-context-provider.js');
      const dp = getDocsContextProvider();
      if (dp.isLoaded) {
        const ctx = dp.getRelevantContext(goal, 800);
        if (ctx) {
          contextSection = `\n## Architecture Context\n\n${ctx}\n`;
        }
      }
    } catch { /* docs optional */ }

    const content = `# Execution Plan

**Goal:** ${goal}
${contextSection}
## Steps
`;
    await fs.writeFile(this.planPath, content);

    return this.success(`Created new plan at ${this.planPath}`, { content });
  }

  private async readPlan(): Promise<ToolResult> {
    if (!await fs.pathExists(this.planPath)) {
      return this.error('No PLAN.md found. Initialize one first.');
    }
    const content = await fs.readFile(this.planPath, 'utf-8');
    return this.success(content);
  }

  private async appendStep(step: string): Promise<ToolResult> {
    if (!step) return this.error('Step description is required for append');
    if (!await fs.pathExists(this.planPath)) return this.error('No PLAN.md found.');

    // Enrich step with graph file metadata
    const fileMeta = this.resolveStepFiles(step);
    let line = `- [ ] ${step}\n`;
    if (fileMeta) {
      line = `- [ ] ${step}\n${fileMeta}\n`;
    }
    await fs.appendFile(this.planPath, line);

    return this.readPlan();
  }

  private async updateStep(stepMatch: string, status: string): Promise<ToolResult> {
    if (!stepMatch) return this.error('Step match text is required for update');
    if (!await fs.pathExists(this.planPath)) return this.error('No PLAN.md found.');

    const content = await fs.readFile(this.planPath, 'utf-8');
    const lines = content.split('\n');
    let updated = false;

    const marker = this.getStatusMarker(status);

    const newLines = lines.map(line => {
      // Simple fuzzy match: if the line contains the text and looks like a task
      if (line.includes(stepMatch) && line.trim().startsWith('- [')) {
        updated = true;
        // Replace the marker [ ] or [x] with new marker
        return line.replace(/- \[[^\]]*\]/, `- [${marker}]`);
      }
      return line;
    });

    if (!updated) {
      return this.error(`Could not find a task matching "${stepMatch}"`);
    }

    const newContent = newLines.join('\n');
    await fs.writeFile(this.planPath, newContent);
    return this.success(`Updated task status to ${status}\n\n${newContent}`);
  }

  /**
   * Reorder pending plan steps by dependency graph (dependencies first).
   */
  private async suggestOrder(): Promise<ToolResult> {
    if (!await fs.pathExists(this.planPath)) return this.error('No PLAN.md found.');
    if (!this.graph || this.graph.getStats().tripleCount === 0) {
      return this.error('No code graph available for dependency ordering.');
    }

    const content = await fs.readFile(this.planPath, 'utf-8');
    const lines = content.split('\n');

    // Extract pending step lines with their entities
    const stepLines: Array<{ index: number; line: string; entities: string[]; depScore: number }> = [];
    const graph = this.graph;

    if (!_extractEntities) {
      return this.error('Entity extraction not available.');
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim().startsWith('- [ ]') && !line.trim().startsWith('- [/]')) continue;

      const stepText = line.replace(/^-\s*\[[^\]]*\]\s*/, '');
      const entities = _extractEntities(stepText);

      // Compute dependency score: steps involving entities with more callers should come later
      let depScore = 0;
      for (const candidate of entities.slice(0, 4)) {
        const entity = graph.findEntity(candidate);
        if (!entity) continue;
        const callers = graph.query({ predicate: 'calls', object: entity });
        depScore += callers.length;
      }

      stepLines.push({ index: i, line, entities, depScore });
    }

    if (stepLines.length < 2) {
      return this.success('Plan has fewer than 2 pending steps — no reordering needed.\n\n' + content);
    }

    // Sort: lower depScore first (dependencies before dependents)
    stepLines.sort((a, b) => a.depScore - b.depScore);

    // Collect step positions, then place sorted steps at the original positions
    const stepIndices: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (stepLines.some(s => s.index === i)) {
        stepIndices.push(i);
      }
    }

    // Place sorted steps at the original step positions
    const newLines = [...lines];
    for (let i = 0; i < stepIndices.length && i < stepLines.length; i++) {
      newLines[stepIndices[i]] = stepLines[i].line;
    }

    const newContent = newLines.join('\n');
    await fs.writeFile(this.planPath, newContent);
    return this.success(`Reordered ${stepLines.length} steps by dependency graph.\n\n${newContent}`);
  }

  /**
   * Resolve files related to a step description from the code graph.
   * Returns a markdown metadata line or null.
   */
  private resolveStepFiles(stepDescription: string): string | null {
    if (!this.graph || this.graph.getStats().tripleCount === 0) return null;

    if (!_extractEntities) return null;

    const candidates = _extractEntities(stepDescription);
    if (candidates.length === 0) return null;

    const graph = this.graph;
    const files: string[] = [];
    let totalCallers = 0;
    const modules = new Set<string>();

    for (const candidate of candidates.slice(0, 6)) {
      const entity = graph.findEntity(candidate);
      if (!entity) continue;

      let filePath = '';
      if (entity.startsWith('mod:')) {
        filePath = entity.replace(/^mod:/, '');
      } else {
        const definedIn = graph.query({ subject: entity, predicate: 'definedIn' });
        if (definedIn.length > 0) filePath = definedIn[0].object.replace(/^mod:/, '');
      }
      if (filePath && !files.includes(filePath)) {
        files.push(filePath);
      }

      const callers = graph.query({ predicate: 'calls', object: entity });
      totalCallers += callers.length;

      const modPath = (filePath || entity).split('/').slice(0, 2).join('/');
      if (modPath) modules.add(modPath);
    }

    if (files.length === 0) return null;

    const fileList = files.slice(0, 5).join(', ');
    const impact = `${totalCallers} callers, ${modules.size} module${modules.size !== 1 ? 's' : ''}`;
    return `  Files: ${fileList}\n  Impact: ${impact}`;
  }

  private getStatusMarker(status: string): string {
    switch (status) {
      case 'completed': return 'x';
      case 'in_progress': return '/';
      case 'failed': return '-';
      default: return ' ';
    }
  }
}
