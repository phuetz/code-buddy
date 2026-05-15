import {
  formatTaskFailureOutput,
  TaskGraph,
  PlannedTask,
  TaskResult,
} from '../../src/agent/planner/task-graph.js';

describe('TaskGraph', () => {
  it('should create an empty graph', () => {
    const graph = new TaskGraph();
    expect(graph.getAllTasks()).toHaveLength(0);
  });

  it('should add tasks', () => {
    const graph = new TaskGraph();
    graph.addTask({ id: 't1', description: 'Task 1', dependencies: [], status: 'pending' });
    expect(graph.getAllTasks()).toHaveLength(1);
    expect(graph.getTask('t1')?.description).toBe('Task 1');
  });

  it('should return ready tasks (no dependencies)', () => {
    const graph = new TaskGraph([
      { id: 't1', description: 'Task 1', dependencies: [], status: 'pending' },
      { id: 't2', description: 'Task 2', dependencies: ['t1'], status: 'pending' },
    ]);

    const ready = graph.getReady();
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe('t1');
  });

  it('should unblock dependent tasks after completion', () => {
    const graph = new TaskGraph([
      { id: 't1', description: 'Task 1', dependencies: [], status: 'pending' },
      { id: 't2', description: 'Task 2', dependencies: ['t1'], status: 'pending' },
    ]);

    graph.markComplete('t1');
    const ready = graph.getReady();
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe('t2');
  });

  it('should skip dependents on failure', () => {
    const graph = new TaskGraph([
      { id: 't1', description: 'Task 1', dependencies: [], status: 'pending' },
      { id: 't2', description: 'Task 2', dependencies: ['t1'], status: 'pending' },
      { id: 't3', description: 'Task 3', dependencies: ['t2'], status: 'pending' },
    ]);

    graph.markFailed('t1', 'error');
    expect(graph.getTask('t1')?.result?.output).toBe('Task failed: error');
    expect(graph.getTask('t2')?.status).toBe('skipped');
    expect(graph.getTask('t3')?.status).toBe('skipped');
  });

  it('should format task failures without empty output', () => {
    expect(formatTaskFailureOutput('boom')).toBe('Task failed: boom');
    expect(formatTaskFailureOutput('')).toBe('Task failed without output or error details.');
  });

  it('should detect cycles', () => {
    const graph = new TaskGraph([
      { id: 't1', description: 'Task 1', dependencies: ['t2'], status: 'pending' },
      { id: 't2', description: 'Task 2', dependencies: ['t1'], status: 'pending' },
    ]);
    expect(graph.hasCycle()).toBe(true);
  });

  it('should detect no cycle in DAG', () => {
    const graph = new TaskGraph([
      { id: 't1', description: 'Task 1', dependencies: [], status: 'pending' },
      { id: 't2', description: 'Task 2', dependencies: ['t1'], status: 'pending' },
    ]);
    expect(graph.hasCycle()).toBe(false);
  });

  it('should topological sort', () => {
    const graph = new TaskGraph([
      { id: 't2', description: 'Task 2', dependencies: ['t1'], status: 'pending' },
      { id: 't1', description: 'Task 1', dependencies: [], status: 'pending' },
      { id: 't3', description: 'Task 3', dependencies: ['t2'], status: 'pending' },
    ]);

    const sorted = graph.topologicalSort();
    const ids = sorted.map(t => t.id);
    expect(ids.indexOf('t1')).toBeLessThan(ids.indexOf('t2'));
    expect(ids.indexOf('t2')).toBeLessThan(ids.indexOf('t3'));
  });

  it('should throw on topological sort with cycle', () => {
    const graph = new TaskGraph([
      { id: 't1', description: 'Task 1', dependencies: ['t2'], status: 'pending' },
      { id: 't2', description: 'Task 2', dependencies: ['t1'], status: 'pending' },
    ]);
    expect(() => graph.topologicalSort()).toThrow(/cycle/);
  });

  it('should execute tasks in dependency order', async () => {
    const graph = new TaskGraph([
      { id: 't1', description: 'Task 1', dependencies: [], status: 'pending' },
      { id: 't2', description: 'Task 2', dependencies: ['t1'], status: 'pending' },
    ]);

    const order: string[] = [];
    const result = await graph.execute(async (task) => {
      order.push(task.id);
      return { success: true, output: task.id, duration: 10 };
    });

    expect(result.success).toBe(true);
    expect(result.completedCount).toBe(2);
    expect(order).toEqual(['t1', 't2']);
  });

  it('should execute parallel tasks', async () => {
    const graph = new TaskGraph([
      { id: 't1', description: 'Task 1', dependencies: [], status: 'pending' },
      { id: 't2', description: 'Task 2', dependencies: [], status: 'pending' },
      { id: 't3', description: 'Task 3', dependencies: ['t1', 't2'], status: 'pending' },
    ]);

    const result = await graph.execute(async (task) => {
      return { success: true, output: task.id, duration: 10 };
    });

    expect(result.success).toBe(true);
    expect(result.completedCount).toBe(3);
  });

  it('should keep failed executor results visible', async () => {
    const graph = new TaskGraph([
      { id: 't1', description: 'Task 1', dependencies: [], status: 'pending' },
    ]);

    const result = await graph.execute(async () => ({
      success: false,
      output: '',
      duration: 0,
      error: 'boom',
    }));

    expect(result.success).toBe(false);
    expect(result.results.get('t1')?.output).toBe('Task failed: boom');
    expect(graph.getTask('t1')?.result?.output).toBe('Task failed: boom');
  });

  it('should report progress', () => {
    const graph = new TaskGraph([
      { id: 't1', description: 'Task 1', dependencies: [], status: 'pending' },
      { id: 't2', description: 'Task 2', dependencies: [], status: 'pending' },
    ]);

    graph.markComplete('t1');
    const progress = graph.getProgress();
    expect(progress.total).toBe(2);
    expect(progress.completed).toBe(1);
    expect(progress.pending).toBe(1);
  });
});
