import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { CreateTodoListTool, GetTodoListTool, UpdateTodoListTool, resetTodoInstance } from '../../src/tools/registry/todo-tools.js';
import { TodoAttentionTool } from '../../src/tools/registry/attention-tools.js';
import { PlanTool } from '../../src/tools/plan-tool.js';
import { SubmitPlanTool } from '../../src/tools/submit-plan-tool.js';

describe('Verify Todo and Plan Tools', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-todo-plan-tools-test-'));
  });

  afterEach(async () => {
    await fs.remove(tempDir);
    vi.restoreAllMocks();
  });

  describe('TodoAttentionTool', () => {
    it('should add, update, and list attention todos', async () => {
      const tool = new TodoAttentionTool();
      
      const addResult = await tool.execute(
        { action: 'add', text: 'Focus on task A', priority: 'high' },
        { cwd: tempDir, sessionId: 's-123', toolCallId: 't-1' }
      );
      expect(addResult.success).toBe(true);
      expect(addResult.output).toContain('Focus on task A');

      // The ID is generated, so let's extract it from output which is like "Added: [ID] text"
      const match = typeof addResult.output === 'string' ? addResult.output.match(/Added: \[(.*?)\]/) : null;
      expect(match).not.toBeNull();
      const id = match![1];

      const updateResult = await tool.execute(
        { action: 'update', id, status: 'in_progress' },
        { cwd: tempDir, sessionId: 's-123', toolCallId: 't-2' }
      );
      expect(updateResult.success).toBe(true);
      expect(updateResult.output).toContain(`Updated: ${id}`);

      const listResult = await tool.execute(
        { action: 'list' },
        { cwd: tempDir, sessionId: 's-123', toolCallId: 't-3' }
      );
      expect(listResult.success).toBe(true);
      expect(listResult.output).toContain(`[${id}]`);
      expect(listResult.output).toContain('(in_progress/high)');
      expect(listResult.output).toContain('Focus on task A');

      const todoFileExists = await fs.pathExists(path.join(tempDir, 'todo.md'));
      expect(todoFileExists).toBe(true);
    });
  });

  describe('SubmitPlanTool', () => {
    it('should submit plan and write to .codebuddy/plans/current.md', async () => {
      const tool = new SubmitPlanTool();
      
      const originalCwd = process.cwd;
      process.cwd = () => tempDir;

      try {
        const result = await tool.execute({ plan_content: 'My great plan' });
        expect(result.success).toBe(true);
        expect(result.output).toContain('__PLAN_APPROVAL_REQUEST__');
        expect(result.output).toContain('My great plan');

        const currentPlanPath = path.join(tempDir, '.codebuddy', 'plans', 'current.md');
        const exists = await fs.pathExists(currentPlanPath);
        expect(exists).toBe(true);

        const content = await fs.readFile(currentPlanPath, 'utf8');
        expect(content).toBe('My great plan');
      } finally {
        process.cwd = originalCwd;
      }
    });
  });

  describe('PlanTool', () => {
    it('should init, append, update, and read plan', async () => {
      const tool = new PlanTool(tempDir);
      
      const initResult = await tool.execute({ action: 'init', goal: 'Build the feature' });
      expect(initResult.success).toBe(true);

      const appendResult = await tool.execute({ action: 'append', step: 'Write tests' });
      expect(appendResult.success).toBe(true);

      const updateResult = await tool.execute({ action: 'update', step: 'Write tests', status: 'completed' });
      expect(updateResult.success).toBe(true);

      const readResult = await tool.execute({ action: 'read' });
      expect(readResult.success).toBe(true);
      expect(String(readResult.output)).toContain('**Goal:** Build the feature');
      expect(String(readResult.output)).toContain('- [x] Write tests');

      const planPath = path.join(tempDir, 'PLAN.md');
      const planFileExists = await fs.pathExists(planPath);
      expect(planFileExists).toBe(true);
      const planOnDisk = await fs.readFile(planPath, 'utf8');
      expect(planOnDisk).toContain('**Goal:** Build the feature');
      expect(planOnDisk).toContain('- [x] Write tests');
    });
  });

  describe('TodoTool Adapters', () => {
    beforeEach(() => {
      resetTodoInstance();
    });

    it('should create, read and update todo list properly', async () => {
      const createTool = new CreateTodoListTool();
      const getTool = new GetTodoListTool();
      const updateTool = new UpdateTodoListTool();

      // 1. Create
      const createResult = await createTool.execute({
        todos: [
          { id: 'todo-1', content: 'Buy groceries', status: 'pending', priority: 'high' },
          { id: 'todo-2', content: 'Wash car', status: 'pending', priority: 'medium' }
        ]
      });
      expect(createResult.success).toBe(true);

      // 2. Read (should see the created items)
      let getResult = await getTool.execute({ filter: 'all' });
      expect(getResult.success).toBe(true);
      expect(getResult.output).toContain('Buy groceries');
      expect(getResult.output).toContain('Wash car');

      // 3. Update
      const updateResult = await updateTool.execute({
        updates: [
          { id: 'todo-1', status: 'completed' },
          { id: 'todo-2', priority: 'high' }
        ]
      });
      expect(updateResult.success).toBe(true);

      // 4. Read (should see the updated items)
      getResult = await getTool.execute({ filter: 'all' });
      expect(getResult.success).toBe(true);
      // The filter='completed' logic is defective (drops task lines because they lack checkmarks), so we test 'all'
      expect(getResult.output).toContain('Buy groceries');
      expect(getResult.output).toContain('🔴 Wash car');

      const completed = await getTool.execute({ filter: 'completed' });
      expect(completed.success).toBe(true);
      expect(String(completed.output)).toContain('Buy groceries');
      expect(String(completed.output)).not.toContain('Wash car');

      const pending = await getTool.execute({ filter: 'pending' });
      expect(pending.success).toBe(true);
      expect(String(pending.output)).toContain('Wash car');
      expect(String(pending.output)).not.toContain('Buy groceries');
      console.log('[get_todo_list completed]', completed.output);
      console.log('[get_todo_list pending]', pending.output);
    });
  });
});
