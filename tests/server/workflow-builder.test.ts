import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  createWorkflowBuilderRoutes,
  createWorkflowApiRouter,
  WorkflowStore,
  WorkflowRunTracker,
} from '../../src/server/routes/workflow-builder.js';
import type { LobsterWorkflow } from '../../src/workflows/lobster-engine.js';
import express from 'express';
import { createServer, type Server } from 'http';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock lobster engine for run tests
vi.mock('../../src/workflows/lobster-engine.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    LobsterEngine: {
      getInstance: () => ({
        executeWithApproval: vi.fn().mockResolvedValue({
          status: 'ok',
          output: [
            { stepId: 's1', status: 'success', stdout: 'done', exitCode: 0, duration: 10 },
          ],
        }),
      }),
    },
  };
});

// Mock AFlow optimizer for optimize tests
vi.mock('../../src/workflows/aflow-optimizer.js', () => ({
  AFlowOptimizer: class {
    constructor() {}
    async optimize() {
      return {
        bestConfig: { steps: [], estimatedDuration: 100, estimatedCost: 0.01 },
        score: 0.95,
        iterations: 50,
        improvements: ['Parallelized steps s1 and s2'],
        allConfigs: [],
      };
    }
  },
}));

// Helper to call a route handler
function makeRes() {
  let status = 0;
  let headers: Record<string, string> = {};
  let body = '';
  return {
    res: {
      writeHead: (s: number, h?: Record<string, string>) => { status = s; headers = h ?? {}; },
      end: (b?: string) => { body = b ?? ''; },
    },
    get status() { return status; },
    get headers() { return headers; },
    get body() { return body; },
    json() { return JSON.parse(body); },
  };
}

function findRoute(routes: ReturnType<typeof createWorkflowBuilderRoutes>, method: string, pathEnd: string) {
  return routes.find(r => r.method === method && r.path.endsWith(pathEnd))!;
}

describe('WorkflowBuilderRoutes', () => {
  let routes: ReturnType<typeof createWorkflowBuilderRoutes>;

  beforeEach(() => {
    routes = createWorkflowBuilderRoutes();
  });

  it('should create all expected routes', () => {
    const paths = routes.map(r => `${r.method} ${r.path}`);
    expect(paths).toContain('GET /__codebuddy__/workflows/');
    expect(paths).toContain('GET /__codebuddy__/workflows/api/list');
    expect(paths).toContain('GET /__codebuddy__/workflows/api/get');
    expect(paths).toContain('POST /__codebuddy__/workflows/api/save');
    expect(paths).toContain('POST /__codebuddy__/workflows/api/validate');
    expect(paths).toContain('POST /__codebuddy__/workflows/api/order');
    expect(paths).toContain('GET /__codebuddy__/workflows/api/delete');
  });

  it('should serve the workflow builder HTML page', async () => {
    const route = findRoute(routes, 'GET', '/workflows/');
    const r = makeRes();
    await route.handler({}, r.res);
    expect(r.status).toBe(200);
    expect(r.headers['Content-Type']).toBe('text/html');
    expect(r.body).toContain('Workflow Builder');
    expect(r.body).toContain('<canvas');
  });

  describe('validate endpoint', () => {
    it('should validate a correct workflow', async () => {
      const route = findRoute(routes, 'POST', '/api/validate');
      const wf: LobsterWorkflow = {
        name: 'test', version: '1.0.0',
        steps: [
          { id: 'a', name: 'Step A', command: 'echo a' },
          { id: 'b', name: 'Step B', command: 'echo b', dependsOn: ['a'] },
        ],
      };
      const r = makeRes();
      await route.handler({}, r.res, JSON.stringify(wf));
      expect(r.json()).toEqual({ valid: true, errors: [] });
    });

    it('should detect missing fields', async () => {
      const route = findRoute(routes, 'POST', '/api/validate');
      const r = makeRes();
      await route.handler({}, r.res, JSON.stringify({ name: '', version: '', steps: [] }));
      const result = r.json();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect cycles', async () => {
      const route = findRoute(routes, 'POST', '/api/validate');
      const wf = {
        name: 'cyclic', version: '1.0.0',
        steps: [
          { id: 'a', name: 'A', command: 'x', dependsOn: ['b'] },
          { id: 'b', name: 'B', command: 'x', dependsOn: ['a'] },
        ],
      };
      const r = makeRes();
      await route.handler({}, r.res, JSON.stringify(wf));
      expect(r.json().valid).toBe(false);
      expect(r.json().errors).toContain('Workflow contains a dependency cycle');
    });

    it('should detect unknown dependencies', async () => {
      const route = findRoute(routes, 'POST', '/api/validate');
      const wf = {
        name: 'bad-dep', version: '1.0.0',
        steps: [{ id: 'a', name: 'A', command: 'x', dependsOn: ['nonexistent'] }],
      };
      const r = makeRes();
      await route.handler({}, r.res, JSON.stringify(wf));
      expect(r.json().valid).toBe(false);
    });

    it('should reject missing body', async () => {
      const route = findRoute(routes, 'POST', '/api/validate');
      const r = makeRes();
      await route.handler({}, r.res);
      expect(r.status).toBe(400);
    });
  });

  describe('order endpoint', () => {
    it('should return execution order', async () => {
      const route = findRoute(routes, 'POST', '/api/order');
      const wf: LobsterWorkflow = {
        name: 'ordered', version: '1.0.0',
        steps: [
          { id: 'build', name: 'Build', command: 'npm run build' },
          { id: 'test', name: 'Test', command: 'npm test', dependsOn: ['build'] },
          { id: 'deploy', name: 'Deploy', command: 'npm run deploy', dependsOn: ['test'] },
        ],
      };
      const r = makeRes();
      await route.handler({}, r.res, JSON.stringify(wf));
      const result = r.json();
      expect(result.order).toEqual(['build', 'test', 'deploy']);
    });

    it('should reject invalid workflow', async () => {
      const route = findRoute(routes, 'POST', '/api/order');
      const r = makeRes();
      await route.handler({}, r.res, JSON.stringify({ name: '', version: '', steps: [] }));
      expect(r.status).toBe(400);
    });
  });

  describe('save/list/get/delete', () => {
    it('should save and list workflows', async () => {
      const saveRoute = findRoute(routes, 'POST', '/api/save');
      const listRoute = findRoute(routes, 'GET', '/api/list');

      const wf = {
        name: 'saved-wf', version: '1.0.0',
        steps: [{ id: 's1', name: 'S1', command: 'echo 1' }],
      };

      const r1 = makeRes();
      await saveRoute.handler({}, r1.res, JSON.stringify({
        workflow: wf,
        positions: { s1: { x: 100, y: 200 } },
      }));
      expect(r1.status).toBe(200);
      const saved = r1.json();
      expect(saved.id).toBeTruthy();

      const r2 = makeRes();
      await listRoute.handler({}, r2.res);
      const list = r2.json();
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list[0].name).toBe('saved-wf');
    });

    it('should get a saved workflow by ID', async () => {
      const saveRoute = findRoute(routes, 'POST', '/api/save');
      const getRoute = findRoute(routes, 'GET', '/api/get');

      const wf = {
        name: 'get-me', version: '2.0.0',
        steps: [{ id: 'g1', name: 'G1', command: 'echo get' }],
      };

      const r1 = makeRes();
      await saveRoute.handler({}, r1.res, JSON.stringify({ workflow: wf, positions: {} }));
      const id = r1.json().id;

      const r2 = makeRes();
      await getRoute.handler({ url: `/api/get?id=${id}` }, r2.res);
      expect(r2.status).toBe(200);
      expect(r2.json().workflow.name).toBe('get-me');
    });

    it('should return 404 for unknown workflow', async () => {
      const getRoute = findRoute(routes, 'GET', '/api/get');
      const r = makeRes();
      await getRoute.handler({ url: '/api/get?id=unknown' }, r.res);
      expect(r.status).toBe(404);
    });

    it('should delete a workflow', async () => {
      const saveRoute = findRoute(routes, 'POST', '/api/save');
      const deleteRoute = findRoute(routes, 'GET', '/api/delete');

      const r1 = makeRes();
      await saveRoute.handler({}, r1.res, JSON.stringify({
        workflow: { name: 'del-me', version: '1.0.0', steps: [{ id: 'd1', name: 'D1', command: 'x' }] },
        positions: {},
      }));
      const id = r1.json().id;

      const r2 = makeRes();
      await deleteRoute.handler({ url: `/api/delete?id=${id}` }, r2.res);
      expect(r2.json().deleted).toBe(true);
    });

    it('should reject save with missing body', async () => {
      const saveRoute = findRoute(routes, 'POST', '/api/save');
      const r = makeRes();
      await saveRoute.handler({}, r.res);
      expect(r.status).toBe(400);
    });
  });
});

describe('WorkflowStore', () => {
  let store: WorkflowStore;

  beforeEach(() => {
    store = new WorkflowStore();
  });

  it('should save and retrieve a workflow', () => {
    const wf: LobsterWorkflow = {
      name: 'test', version: '1.0.0',
      steps: [{ id: 's1', name: 'S1', command: 'echo hi' }],
    };
    const stored = store.save(wf, { s1: { x: 0, y: 0 } });
    expect(stored.id).toMatch(/^wf_/);
    expect(store.get(stored.id)).toBe(stored);
  });

  it('should list workflows in order', () => {
    store.save({ name: 'first', version: '1', steps: [{ id: 'a', name: 'A', command: 'x' }] }, {});
    store.save({ name: 'second', version: '1', steps: [{ id: 'b', name: 'B', command: 'y' }] }, {});
    const list = store.list();
    expect(list.length).toBe(2);
    const names = list.map(w => w.workflow.name);
    expect(names).toContain('first');
    expect(names).toContain('second');
  });

  it('should delete a workflow', () => {
    const stored = store.save({ name: 'del', version: '1', steps: [{ id: 'c', name: 'C', command: 'z' }] }, {});
    expect(store.delete(stored.id)).toBe(true);
    expect(store.get(stored.id)).toBeUndefined();
  });

  it('should update existing workflow by ID', () => {
    const stored = store.save({ name: 'v1', version: '1', steps: [{ id: 'd', name: 'D', command: 'a' }] }, {});
    const updated = store.save({ name: 'v2', version: '2', steps: [{ id: 'd', name: 'D', command: 'b' }] }, {}, stored.id);
    expect(updated.id).toBe(stored.id);
    expect(updated.workflow.name).toBe('v2');
    expect(updated.createdAt).toEqual(stored.createdAt);
  });
});

describe('WorkflowRunTracker', () => {
  let tracker: WorkflowRunTracker;

  beforeEach(() => {
    tracker = new WorkflowRunTracker();
  });

  it('should create a run record', () => {
    const run = tracker.create('wf_1');
    expect(run.runId).toMatch(/^run_/);
    expect(run.workflowId).toBe('wf_1');
    expect(run.status).toBe('pending');
    expect(run.startedAt).toBeInstanceOf(Date);
  });

  it('should get a run by ID', () => {
    const run = tracker.create('wf_1');
    expect(tracker.get(run.runId)).toBe(run);
    expect(tracker.get('nonexistent')).toBeUndefined();
  });

  it('should list runs by workflow', () => {
    tracker.create('wf_1');
    tracker.create('wf_1');
    tracker.create('wf_2');
    expect(tracker.getByWorkflow('wf_1').length).toBe(2);
    expect(tracker.getByWorkflow('wf_2').length).toBe(1);
    expect(tracker.getByWorkflow('wf_3').length).toBe(0);
  });

  it('should update a run record', () => {
    const run = tracker.create('wf_1');
    tracker.update(run.runId, { status: 'running' });
    expect(tracker.get(run.runId)!.status).toBe('running');
    tracker.update(run.runId, { status: 'success', finishedAt: new Date() });
    expect(tracker.get(run.runId)!.status).toBe('success');
    expect(tracker.get(run.runId)!.finishedAt).toBeInstanceOf(Date);
  });

  it('should silently ignore updates for nonexistent runs', () => {
    // Should not throw
    tracker.update('nonexistent', { status: 'failed' });
  });
});

describe('Workflow REST API Router', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/workflows', createWorkflowApiRouter());

    await new Promise<void>((resolve) => {
      server = createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  const sampleWorkflow: LobsterWorkflow = {
    name: 'ci-pipeline',
    version: '1.0.0',
    steps: [
      { id: 'build', name: 'Build', command: 'npm run build' },
      { id: 'test', name: 'Test', command: 'npm test', dependsOn: ['build'] },
      { id: 'deploy', name: 'Deploy', command: 'npm run deploy', dependsOn: ['test'] },
    ],
  };

  async function createWorkflow(wf?: LobsterWorkflow): Promise<{ id: string }> {
    const resp = await fetch(`${baseUrl}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow: wf ?? sampleWorkflow, positions: {} }),
    });
    return resp.json() as Promise<{ id: string }>;
  }

  describe('POST /api/workflows (create)', () => {
    it('should create a workflow and return 201', async () => {
      const resp = await fetch(`${baseUrl}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow: sampleWorkflow, positions: { build: { x: 0, y: 0 } } }),
      });
      expect(resp.status).toBe(201);
      const data = await resp.json() as Record<string, unknown>;
      expect(data.id).toBeTruthy();
      expect(data.name).toBe('ci-pipeline');
      expect(data.stepCount).toBe(3);
    });

    it('should reject missing workflow field', async () => {
      const resp = await fetch(`${baseUrl}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(resp.status).toBe(400);
    });

    it('should reject invalid workflow (cycle)', async () => {
      const resp = await fetch(`${baseUrl}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow: {
            name: 'cyclic', version: '1.0.0',
            steps: [
              { id: 'a', name: 'A', command: 'x', dependsOn: ['b'] },
              { id: 'b', name: 'B', command: 'y', dependsOn: ['a'] },
            ],
          },
        }),
      });
      expect(resp.status).toBe(400);
      const data = await resp.json() as { errors: string[] };
      expect(data.errors).toContain('Workflow contains a dependency cycle');
    });
  });

  describe('GET /api/workflows (list)', () => {
    it('should list all workflows', async () => {
      await createWorkflow();
      const resp = await fetch(`${baseUrl}/api/workflows`);
      expect(resp.status).toBe(200);
      const data = await resp.json() as Array<Record<string, unknown>>;
      expect(data.length).toBeGreaterThanOrEqual(1);
      expect(data[0].name).toBe('ci-pipeline');
    });
  });

  describe('GET /api/workflows/:id (get)', () => {
    it('should get a workflow by ID', async () => {
      const { id } = await createWorkflow();
      const resp = await fetch(`${baseUrl}/api/workflows/${id}`);
      expect(resp.status).toBe(200);
      const data = await resp.json() as { workflow: LobsterWorkflow };
      expect(data.workflow.name).toBe('ci-pipeline');
      expect(data.workflow.steps.length).toBe(3);
    });

    it('should return 404 for unknown workflow', async () => {
      const resp = await fetch(`${baseUrl}/api/workflows/nonexistent`);
      expect(resp.status).toBe(404);
    });
  });

  describe('PUT /api/workflows/:id (update)', () => {
    it('should update an existing workflow', async () => {
      const { id } = await createWorkflow();
      const updated: LobsterWorkflow = {
        name: 'ci-pipeline-v2', version: '2.0.0',
        steps: [
          { id: 'build', name: 'Build', command: 'npm run build' },
          { id: 'lint', name: 'Lint', command: 'npm run lint', dependsOn: ['build'] },
        ],
      };
      const resp = await fetch(`${baseUrl}/api/workflows/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow: updated }),
      });
      expect(resp.status).toBe(200);
      const data = await resp.json() as Record<string, unknown>;
      expect(data.name).toBe('ci-pipeline-v2');
      expect(data.stepCount).toBe(2);
      expect(data.id).toBe(id);
    });

    it('should return 404 for unknown workflow', async () => {
      const resp = await fetch(`${baseUrl}/api/workflows/nonexistent`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow: sampleWorkflow }),
      });
      expect(resp.status).toBe(404);
    });

    it('should reject invalid workflow on update', async () => {
      const { id } = await createWorkflow();
      const resp = await fetch(`${baseUrl}/api/workflows/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow: { name: '', version: '', steps: [] },
        }),
      });
      expect(resp.status).toBe(400);
    });
  });

  describe('DELETE /api/workflows/:id (delete)', () => {
    it('should delete a workflow', async () => {
      const { id } = await createWorkflow();
      const resp = await fetch(`${baseUrl}/api/workflows/${id}`, { method: 'DELETE' });
      expect(resp.status).toBe(200);
      const data = await resp.json() as { deleted: boolean };
      expect(data.deleted).toBe(true);

      // Verify it's gone
      const resp2 = await fetch(`${baseUrl}/api/workflows/${id}`);
      expect(resp2.status).toBe(404);
    });

    it('should return 404 for unknown workflow', async () => {
      const resp = await fetch(`${baseUrl}/api/workflows/nonexistent`, { method: 'DELETE' });
      expect(resp.status).toBe(404);
    });
  });

  describe('POST /api/workflows/validate', () => {
    it('should validate a correct workflow', async () => {
      const resp = await fetch(`${baseUrl}/api/workflows/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleWorkflow),
      });
      expect(resp.status).toBe(200);
      const data = await resp.json() as { valid: boolean; order: string[]; parallelGroups: string[][] };
      expect(data.valid).toBe(true);
      expect(data.order).toEqual(['build', 'test', 'deploy']);
      expect(data.parallelGroups).toEqual([['build'], ['test'], ['deploy']]);
    });

    it('should detect cycles in validation', async () => {
      const resp = await fetch(`${baseUrl}/api/workflows/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'cyclic', version: '1.0.0',
          steps: [
            { id: 'a', name: 'A', command: 'x', dependsOn: ['b'] },
            { id: 'b', name: 'B', command: 'y', dependsOn: ['a'] },
          ],
        }),
      });
      const data = await resp.json() as { valid: boolean; errors: string[] };
      expect(data.valid).toBe(false);
      expect(data.errors).toContain('Workflow contains a dependency cycle');
    });

    it('should include parallel groups for valid workflow with parallel steps', async () => {
      const resp = await fetch(`${baseUrl}/api/workflows/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'parallel', version: '1.0.0',
          steps: [
            { id: 'a', name: 'A', command: 'x' },
            { id: 'b', name: 'B', command: 'y' },
            { id: 'c', name: 'C', command: 'z', dependsOn: ['a', 'b'] },
          ],
        }),
      });
      const data = await resp.json() as { parallelGroups: string[][] };
      // a and b should be in the same parallel group
      expect(data.parallelGroups[0]).toContain('a');
      expect(data.parallelGroups[0]).toContain('b');
      expect(data.parallelGroups[1]).toEqual(['c']);
    });

    it('should reject missing body', async () => {
      const resp = await fetch(`${baseUrl}/api/workflows/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(resp.status).toBe(400);
    });
  });

  describe('POST /api/workflows/:id/run', () => {
    it('should execute a workflow and return run result', async () => {
      const { id } = await createWorkflow();
      const resp = await fetch(`${baseUrl}/api/workflows/${id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(resp.status).toBe(200);
      const data = await resp.json() as { runId: string; status: string; workflowId: string };
      expect(data.runId).toMatch(/^run_/);
      expect(data.status).toBe('success');
      expect(data.workflowId).toBe(id);
    });

    it('should return 404 for unknown workflow', async () => {
      const resp = await fetch(`${baseUrl}/api/workflows/nonexistent/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(resp.status).toBe(404);
    });
  });

  describe('GET /api/workflows/:id/status', () => {
    it('should return status with no runs', async () => {
      const { id } = await createWorkflow();
      const resp = await fetch(`${baseUrl}/api/workflows/${id}/status`);
      expect(resp.status).toBe(200);
      const data = await resp.json() as { workflowId: string; totalRuns: number; latestRun: unknown };
      expect(data.workflowId).toBe(id);
      expect(data.totalRuns).toBe(0);
      expect(data.latestRun).toBeNull();
    });

    it('should return status after a run', async () => {
      const { id } = await createWorkflow();
      // Execute the workflow
      await fetch(`${baseUrl}/api/workflows/${id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const resp = await fetch(`${baseUrl}/api/workflows/${id}/status`);
      const data = await resp.json() as {
        totalRuns: number;
        latestRun: { runId: string; status: string };
        runs: Array<{ runId: string }>;
      };
      expect(data.totalRuns).toBe(1);
      expect(data.latestRun).not.toBeNull();
      expect(data.latestRun.status).toBe('success');
      expect(data.runs.length).toBe(1);
    });

    it('should return 404 for unknown workflow', async () => {
      const resp = await fetch(`${baseUrl}/api/workflows/nonexistent/status`);
      expect(resp.status).toBe(404);
    });
  });

  describe('GET /api/workflows/:id/optimize', () => {
    it('should run AFlow optimization', async () => {
      const { id } = await createWorkflow();
      const resp = await fetch(`${baseUrl}/api/workflows/${id}/optimize`);
      expect(resp.status).toBe(200);
      const data = await resp.json() as {
        workflowId: string;
        workflowName: string;
        optimization: { score: number; iterations: number };
      };
      expect(data.workflowId).toBe(id);
      expect(data.workflowName).toBe('ci-pipeline');
      expect(data.optimization.score).toBe(0.95);
      expect(data.optimization.iterations).toBe(50);
    });

    it('should return 404 for unknown workflow', async () => {
      const resp = await fetch(`${baseUrl}/api/workflows/nonexistent/optimize`);
      expect(resp.status).toBe(404);
    });
  });
});
