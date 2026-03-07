import { describe, it, expect, beforeEach } from 'vitest';
import { createWorkflowBuilderRoutes, WorkflowStore } from '../../src/server/routes/workflow-builder.js';
import type { LobsterWorkflow } from '../../src/workflows/lobster-engine.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
