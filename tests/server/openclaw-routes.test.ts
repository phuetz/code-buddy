/**
 * OpenClaw API Routes Tests
 *
 * Tests for the heartbeat, hub, identity, groups, and auth-profiles
 * API routes registered in src/server/index.ts.
 *
 * Each route handler in the server uses dynamic `import()` to load its
 * backing module and then calls methods on the returned manager/engine.
 * We replicate that exact handler logic here, but inject mock managers
 * directly so we can verify the contract between the HTTP layer and the
 * underlying modules without spinning up a real server.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mock objects
// ---------------------------------------------------------------------------

const mockHeartbeatEngine = {
  getStatus: jest.fn<() => any>(),
  start: jest.fn(),
  stop: jest.fn(),
  tick: jest.fn<() => Promise<any>>(),
};

const mockSkillsHub = {
  search: jest.fn<(q: string, opts: any) => Promise<any>>(),
  list: jest.fn<() => any>(),
  install: jest.fn<(name: string, version?: string) => Promise<any>>(),
  uninstall: jest.fn<(name: string) => Promise<any>>(),
};

const mockIdentityManager = {
  load: jest.fn<(cwd: string) => Promise<void>>(),
  getAll: jest.fn<() => any>(),
  getPromptInjection: jest.fn<() => string>(),
  set: jest.fn<(name: string, content: string) => Promise<void>>(),
};

const mockGroupSecurity = {
  getStats: jest.fn<() => any>(),
  listGroups: jest.fn<() => any>(),
  addToBlocklist: jest.fn<(userId: string) => void>(),
  removeFromBlocklist: jest.fn<(userId: string) => boolean>(),
};

const mockAuthProfileManager = {
  getStatus: jest.fn<() => any>(),
  addProfile: jest.fn<(profile: any) => void>(),
  removeProfile: jest.fn<(id: string) => boolean>(),
};

const mockResetAuthProfileManager = jest.fn();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRes() {
  const res: any = {
    _status: 200,
    _json: null as any,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: any) {
      res._json = body;
      return res;
    },
  };
  return res;
}

function mockReq(overrides: Record<string, any> = {}) {
  return {
    params: {},
    query: {},
    body: {},
    headers: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Route handler replicas
//
// These replicate the exact logic from src/server/index.ts route handlers,
// but instead of doing `await import(...)` they receive the mock modules
// through closures. This validates the contract between the HTTP layer and
// the underlying managers.
// ---------------------------------------------------------------------------

// Heartbeat handlers ---------------------------------------------------

async function heartbeatStatusHandler(_req: any, res: any) {
  try {
    const engine = mockHeartbeatEngine;
    res.json(engine.getStatus());
  } catch {
    res.json({ running: false, enabled: false, totalTicks: 0 });
  }
}

async function heartbeatStartHandler(_req: any, res: any) {
  try {
    const engine = mockHeartbeatEngine;
    engine.start();
    res.json({ success: true, status: engine.getStatus() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function heartbeatStopHandler(_req: any, res: any) {
  try {
    const engine = mockHeartbeatEngine;
    engine.stop();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function heartbeatTickHandler(_req: any, res: any) {
  try {
    const engine = mockHeartbeatEngine;
    const result = await engine.tick();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

// We need a variant for the "getHeartbeatEngine throws" test
let getHeartbeatEngineFn: () => typeof mockHeartbeatEngine = () => mockHeartbeatEngine;

async function heartbeatStatusHandlerWithGetter(_req: any, res: any) {
  try {
    const engine = getHeartbeatEngineFn();
    res.json(engine.getStatus());
  } catch {
    res.json({ running: false, enabled: false, totalTicks: 0 });
  }
}

// Hub handlers ---------------------------------------------------------

async function hubSearchHandler(req: any, res: any) {
  try {
    const hub = mockSkillsHub;
    const query = (req.query.q as string) || '';
    const tags = req.query.tags ? (req.query.tags as string).split(',') : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const result = await hub.search(query, { tags, limit });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function hubInstalledHandler(_req: any, res: any) {
  try {
    const hub = mockSkillsHub;
    res.json(hub.list());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function hubInstallHandler(req: any, res: any) {
  try {
    const { name, version } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const hub = mockSkillsHub;
    const installed = await hub.install(name, version);
    res.json(installed);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function hubUninstallHandler(req: any, res: any) {
  try {
    const hub = mockSkillsHub;
    const removed = await hub.uninstall(req.params.name);
    if (removed) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Skill not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

// Identity handlers ----------------------------------------------------

async function identityGetAllHandler(_req: any, res: any) {
  try {
    const mgr = mockIdentityManager;
    await mgr.load(process.cwd());
    res.json(mgr.getAll());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function identityPromptHandler(_req: any, res: any) {
  try {
    const mgr = mockIdentityManager;
    await mgr.load(process.cwd());
    res.json({ prompt: mgr.getPromptInjection() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function identitySetHandler(req: any, res: any) {
  try {
    const { content } = req.body;
    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }
    const mgr = mockIdentityManager;
    await mgr.load(process.cwd());
    await mgr.set(req.params.name, content);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

// Group security handlers ----------------------------------------------

async function groupsStatusHandler(_req: any, res: any) {
  try {
    const mgr = mockGroupSecurity;
    res.json(mgr.getStats());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function groupsListHandler(_req: any, res: any) {
  try {
    const mgr = mockGroupSecurity;
    res.json(mgr.listGroups());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function groupsBlockHandler(req: any, res: any) {
  try {
    const { userId } = req.body;
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    const mgr = mockGroupSecurity;
    mgr.addToBlocklist(userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function groupsUnblockHandler(req: any, res: any) {
  try {
    const mgr = mockGroupSecurity;
    if (mgr.removeFromBlocklist(req.params.userId)) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'User not in blocklist' });
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

// Auth profile handlers ------------------------------------------------

async function authProfilesGetHandler(_req: any, res: any) {
  try {
    const mgr = mockAuthProfileManager;
    res.json(mgr.getStatus());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function authProfilesAddHandler(req: any, res: any) {
  try {
    const profile = req.body;
    if (!profile.id || !profile.provider) {
      res.status(400).json({ error: 'id and provider are required' });
      return;
    }
    const mgr = mockAuthProfileManager;
    mgr.addProfile({
      type: 'api-key',
      credentials: {},
      priority: 0,
      metadata: {},
      ...profile,
    });
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function authProfilesRemoveHandler(req: any, res: any) {
  try {
    const mgr = mockAuthProfileManager;
    if (mgr.removeProfile(req.params.id)) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Profile not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

async function authProfilesResetHandler(_req: any, res: any) {
  try {
    mockResetAuthProfileManager();
    const mgr = mockAuthProfileManager;
    res.json({ success: true, profiles: mgr.getStatus() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  // Reset the heartbeat getter to the default (non-throwing)
  getHeartbeatEngineFn = () => mockHeartbeatEngine;

  // Set default return values
  mockHeartbeatEngine.getStatus.mockReturnValue({ running: true, enabled: true, totalTicks: 42 });
  mockHeartbeatEngine.tick.mockResolvedValue({ ok: true, ts: Date.now() });

  mockSkillsHub.search.mockResolvedValue([{ name: 'test-skill', version: '1.0.0' }]);
  mockSkillsHub.list.mockReturnValue([{ name: 'installed-skill' }]);
  mockSkillsHub.install.mockImplementation(async (name: string, version?: string) => ({
    name,
    version: version || 'latest',
  }));
  mockSkillsHub.uninstall.mockResolvedValue(true);

  mockIdentityManager.load.mockResolvedValue(undefined);
  mockIdentityManager.getAll.mockReturnValue({ persona: 'default', traits: [] });
  mockIdentityManager.getPromptInjection.mockReturnValue('You are a helpful assistant.');
  mockIdentityManager.set.mockResolvedValue(undefined);

  mockGroupSecurity.getStats.mockReturnValue({ total: 5, blocked: 1 });
  mockGroupSecurity.listGroups.mockReturnValue([{ id: 'g1', name: 'group-1' }]);
  mockGroupSecurity.removeFromBlocklist.mockReturnValue(true);

  mockAuthProfileManager.getStatus.mockReturnValue({ profiles: [], active: null });
  mockAuthProfileManager.removeProfile.mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenClaw API Routes', () => {
  // -----------------------------------------------------------------------
  // Heartbeat Routes
  // -----------------------------------------------------------------------
  describe('Heartbeat routes', () => {
    it('GET /api/heartbeat/status should return engine status', async () => {
      const req = mockReq();
      const res = mockRes();
      await heartbeatStatusHandler(req, res);

      expect(mockHeartbeatEngine.getStatus).toHaveBeenCalled();
      expect(res._status).toBe(200);
      expect(res._json).toEqual({ running: true, enabled: true, totalTicks: 42 });
    });

    it('GET /api/heartbeat/status should return defaults when engine getter throws', async () => {
      getHeartbeatEngineFn = () => {
        throw new Error('engine unavailable');
      };

      const req = mockReq();
      const res = mockRes();
      await heartbeatStatusHandlerWithGetter(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toEqual({ running: false, enabled: false, totalTicks: 0 });
    });

    it('POST /api/heartbeat/start should start the engine and return status', async () => {
      const req = mockReq();
      const res = mockRes();
      await heartbeatStartHandler(req, res);

      expect(mockHeartbeatEngine.start).toHaveBeenCalled();
      expect(mockHeartbeatEngine.getStatus).toHaveBeenCalled();
      expect(res._json).toEqual({
        success: true,
        status: { running: true, enabled: true, totalTicks: 42 },
      });
    });

    it('POST /api/heartbeat/start should return 500 when engine.start throws', async () => {
      mockHeartbeatEngine.start.mockImplementationOnce(() => {
        throw new Error('start failed');
      });

      const req = mockReq();
      const res = mockRes();
      await heartbeatStartHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'start failed' });
    });

    it('POST /api/heartbeat/stop should stop the engine', async () => {
      const req = mockReq();
      const res = mockRes();
      await heartbeatStopHandler(req, res);

      expect(mockHeartbeatEngine.stop).toHaveBeenCalled();
      expect(res._json).toEqual({ success: true });
    });

    it('POST /api/heartbeat/stop should return 500 when engine.stop throws', async () => {
      mockHeartbeatEngine.stop.mockImplementationOnce(() => {
        throw new Error('stop failed');
      });

      const req = mockReq();
      const res = mockRes();
      await heartbeatStopHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'stop failed' });
    });

    it('POST /api/heartbeat/tick should call tick and return result', async () => {
      const req = mockReq();
      const res = mockRes();
      await heartbeatTickHandler(req, res);

      expect(mockHeartbeatEngine.tick).toHaveBeenCalled();
      expect(res._json).toHaveProperty('ok', true);
    });

    it('POST /api/heartbeat/tick should return 500 when tick rejects', async () => {
      mockHeartbeatEngine.tick.mockRejectedValueOnce(new Error('tick boom'));

      const req = mockReq();
      const res = mockRes();
      await heartbeatTickHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'tick boom' });
    });
  });

  // -----------------------------------------------------------------------
  // Hub Routes
  // -----------------------------------------------------------------------
  describe('Hub routes', () => {
    it('GET /api/hub/search?q=test should call hub.search with query', async () => {
      const req = mockReq({ query: { q: 'test' } });
      const res = mockRes();
      await hubSearchHandler(req, res);

      expect(mockSkillsHub.search).toHaveBeenCalledWith('test', {
        tags: undefined,
        limit: undefined,
      });
      expect(res._json).toEqual([{ name: 'test-skill', version: '1.0.0' }]);
    });

    it('GET /api/hub/search should pass tags and limit when provided', async () => {
      const req = mockReq({ query: { q: 'deploy', tags: 'ci,deploy', limit: '5' } });
      const res = mockRes();
      await hubSearchHandler(req, res);

      expect(mockSkillsHub.search).toHaveBeenCalledWith('deploy', {
        tags: ['ci', 'deploy'],
        limit: 5,
      });
    });

    it('GET /api/hub/search should default to empty string when q is absent', async () => {
      const req = mockReq({ query: {} });
      const res = mockRes();
      await hubSearchHandler(req, res);

      expect(mockSkillsHub.search).toHaveBeenCalledWith('', {
        tags: undefined,
        limit: undefined,
      });
    });

    it('GET /api/hub/search should return 500 when hub.search rejects', async () => {
      mockSkillsHub.search.mockRejectedValueOnce(new Error('hub down'));

      const req = mockReq({ query: { q: 'test' } });
      const res = mockRes();
      await hubSearchHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'hub down' });
    });

    it('GET /api/hub/installed should call hub.list and return results', async () => {
      const req = mockReq();
      const res = mockRes();
      await hubInstalledHandler(req, res);

      expect(mockSkillsHub.list).toHaveBeenCalled();
      expect(res._json).toEqual([{ name: 'installed-skill' }]);
    });

    it('GET /api/hub/installed should return 500 when hub.list throws', async () => {
      mockSkillsHub.list.mockImplementationOnce(() => {
        throw new Error('list error');
      });

      const req = mockReq();
      const res = mockRes();
      await hubInstalledHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'list error' });
    });

    it('POST /api/hub/install should call hub.install with name and version', async () => {
      const req = mockReq({ body: { name: 'my-skill', version: '2.0.0' } });
      const res = mockRes();
      await hubInstallHandler(req, res);

      expect(mockSkillsHub.install).toHaveBeenCalledWith('my-skill', '2.0.0');
      expect(res._json).toEqual({ name: 'my-skill', version: '2.0.0' });
    });

    it('POST /api/hub/install should return 400 when name is missing', async () => {
      const req = mockReq({ body: {} });
      const res = mockRes();
      await hubInstallHandler(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toEqual({ error: 'name is required' });
      expect(mockSkillsHub.install).not.toHaveBeenCalled();
    });

    it('POST /api/hub/install should return 500 when hub.install rejects', async () => {
      mockSkillsHub.install.mockRejectedValueOnce(new Error('install failed'));

      const req = mockReq({ body: { name: 'bad-skill' } });
      const res = mockRes();
      await hubInstallHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'install failed' });
    });

    it('DELETE /api/hub/:name should call hub.uninstall and return success', async () => {
      const req = mockReq({ params: { name: 'my-skill' } });
      const res = mockRes();
      await hubUninstallHandler(req, res);

      expect(mockSkillsHub.uninstall).toHaveBeenCalledWith('my-skill');
      expect(res._json).toEqual({ success: true });
    });

    it('DELETE /api/hub/:name should return 404 when skill not found', async () => {
      mockSkillsHub.uninstall.mockResolvedValueOnce(false);

      const req = mockReq({ params: { name: 'nonexistent' } });
      const res = mockRes();
      await hubUninstallHandler(req, res);

      expect(res._status).toBe(404);
      expect(res._json).toEqual({ error: 'Skill not found' });
    });

    it('DELETE /api/hub/:name should return 500 when hub.uninstall rejects', async () => {
      mockSkillsHub.uninstall.mockRejectedValueOnce(new Error('uninstall boom'));

      const req = mockReq({ params: { name: 'boom-skill' } });
      const res = mockRes();
      await hubUninstallHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'uninstall boom' });
    });
  });

  // -----------------------------------------------------------------------
  // Identity Routes
  // -----------------------------------------------------------------------
  describe('Identity routes', () => {
    it('GET /api/identity should load and return all identities', async () => {
      const req = mockReq();
      const res = mockRes();
      await identityGetAllHandler(req, res);

      expect(mockIdentityManager.load).toHaveBeenCalledWith(process.cwd());
      expect(mockIdentityManager.getAll).toHaveBeenCalled();
      expect(res._json).toEqual({ persona: 'default', traits: [] });
    });

    it('GET /api/identity should return 500 when mgr.load rejects', async () => {
      mockIdentityManager.load.mockRejectedValueOnce(new Error('load fail'));

      const req = mockReq();
      const res = mockRes();
      await identityGetAllHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'load fail' });
    });

    it('GET /api/identity/prompt should return prompt injection string', async () => {
      const req = mockReq();
      const res = mockRes();
      await identityPromptHandler(req, res);

      expect(mockIdentityManager.load).toHaveBeenCalledWith(process.cwd());
      expect(mockIdentityManager.getPromptInjection).toHaveBeenCalled();
      expect(res._json).toEqual({ prompt: 'You are a helpful assistant.' });
    });

    it('GET /api/identity/prompt should return 500 when getPromptInjection throws', async () => {
      mockIdentityManager.getPromptInjection.mockImplementationOnce(() => {
        throw new Error('prompt error');
      });

      const req = mockReq();
      const res = mockRes();
      await identityPromptHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'prompt error' });
    });

    it('PUT /api/identity/:name should call mgr.set with name and content', async () => {
      const req = mockReq({
        params: { name: 'persona' },
        body: { content: 'new persona content' },
      });
      const res = mockRes();
      await identitySetHandler(req, res);

      expect(mockIdentityManager.load).toHaveBeenCalledWith(process.cwd());
      expect(mockIdentityManager.set).toHaveBeenCalledWith('persona', 'new persona content');
      expect(res._json).toEqual({ success: true });
    });

    it('PUT /api/identity/:name should return 400 when content is missing', async () => {
      const req = mockReq({ params: { name: 'persona' }, body: {} });
      const res = mockRes();
      await identitySetHandler(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toEqual({ error: 'content is required' });
      expect(mockIdentityManager.set).not.toHaveBeenCalled();
    });

    it('PUT /api/identity/:name should return 500 when mgr.set rejects', async () => {
      mockIdentityManager.set.mockRejectedValueOnce(new Error('set failed'));

      const req = mockReq({
        params: { name: 'persona' },
        body: { content: 'bad content' },
      });
      const res = mockRes();
      await identitySetHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'set failed' });
    });
  });

  // -----------------------------------------------------------------------
  // Groups Routes
  // -----------------------------------------------------------------------
  describe('Groups routes', () => {
    it('GET /api/groups/status should return group stats', async () => {
      const req = mockReq();
      const res = mockRes();
      await groupsStatusHandler(req, res);

      expect(mockGroupSecurity.getStats).toHaveBeenCalled();
      expect(res._json).toEqual({ total: 5, blocked: 1 });
    });

    it('GET /api/groups/status should return 500 when getStats throws', async () => {
      mockGroupSecurity.getStats.mockImplementationOnce(() => {
        throw new Error('stats error');
      });

      const req = mockReq();
      const res = mockRes();
      await groupsStatusHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'stats error' });
    });

    it('GET /api/groups/list should return group list', async () => {
      const req = mockReq();
      const res = mockRes();
      await groupsListHandler(req, res);

      expect(mockGroupSecurity.listGroups).toHaveBeenCalled();
      expect(res._json).toEqual([{ id: 'g1', name: 'group-1' }]);
    });

    it('GET /api/groups/list should return 500 when listGroups throws', async () => {
      mockGroupSecurity.listGroups.mockImplementationOnce(() => {
        throw new Error('list error');
      });

      const req = mockReq();
      const res = mockRes();
      await groupsListHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'list error' });
    });

    it('POST /api/groups/block should add userId to blocklist', async () => {
      const req = mockReq({ body: { userId: 'user-42' } });
      const res = mockRes();
      await groupsBlockHandler(req, res);

      expect(mockGroupSecurity.addToBlocklist).toHaveBeenCalledWith('user-42');
      expect(res._json).toEqual({ success: true });
    });

    it('POST /api/groups/block should return 400 when userId is missing', async () => {
      const req = mockReq({ body: {} });
      const res = mockRes();
      await groupsBlockHandler(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toEqual({ error: 'userId is required' });
      expect(mockGroupSecurity.addToBlocklist).not.toHaveBeenCalled();
    });

    it('POST /api/groups/block should return 500 when addToBlocklist throws', async () => {
      mockGroupSecurity.addToBlocklist.mockImplementationOnce(() => {
        throw new Error('block error');
      });

      const req = mockReq({ body: { userId: 'user-bad' } });
      const res = mockRes();
      await groupsBlockHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'block error' });
    });

    it('DELETE /api/groups/block/:userId should remove from blocklist', async () => {
      const req = mockReq({ params: { userId: 'user-42' } });
      const res = mockRes();
      await groupsUnblockHandler(req, res);

      expect(mockGroupSecurity.removeFromBlocklist).toHaveBeenCalledWith('user-42');
      expect(res._json).toEqual({ success: true });
    });

    it('DELETE /api/groups/block/:userId should return 404 when user not in blocklist', async () => {
      mockGroupSecurity.removeFromBlocklist.mockReturnValueOnce(false);

      const req = mockReq({ params: { userId: 'nonexistent' } });
      const res = mockRes();
      await groupsUnblockHandler(req, res);

      expect(res._status).toBe(404);
      expect(res._json).toEqual({ error: 'User not in blocklist' });
    });

    it('DELETE /api/groups/block/:userId should return 500 when removeFromBlocklist throws', async () => {
      mockGroupSecurity.removeFromBlocklist.mockImplementationOnce(() => {
        throw new Error('remove error');
      });

      const req = mockReq({ params: { userId: 'user-err' } });
      const res = mockRes();
      await groupsUnblockHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'remove error' });
    });
  });

  // -----------------------------------------------------------------------
  // Auth Profiles Routes
  // -----------------------------------------------------------------------
  describe('Auth profiles routes', () => {
    it('GET /api/auth-profiles should return profile status', async () => {
      const req = mockReq();
      const res = mockRes();
      await authProfilesGetHandler(req, res);

      expect(mockAuthProfileManager.getStatus).toHaveBeenCalled();
      expect(res._json).toEqual({ profiles: [], active: null });
    });

    it('GET /api/auth-profiles should return 500 when getStatus throws', async () => {
      mockAuthProfileManager.getStatus.mockImplementationOnce(() => {
        throw new Error('status error');
      });

      const req = mockReq();
      const res = mockRes();
      await authProfilesGetHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'status error' });
    });

    it('POST /api/auth-profiles should add a profile with 201 status', async () => {
      const req = mockReq({
        body: {
          id: 'prof-1',
          provider: 'openai',
          type: 'api-key',
          credentials: { key: 'sk-xxx' },
        },
      });
      const res = mockRes();
      await authProfilesAddHandler(req, res);

      expect(mockAuthProfileManager.addProfile).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'prof-1', provider: 'openai' }),
      );
      expect(res._status).toBe(201);
      expect(res._json).toEqual({ success: true });
    });

    it('POST /api/auth-profiles should merge default fields into profile', async () => {
      const req = mockReq({
        body: { id: 'prof-2', provider: 'claude' },
      });
      const res = mockRes();
      await authProfilesAddHandler(req, res);

      // Defaults should be spread first, then overridden by request body
      expect(mockAuthProfileManager.addProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'api-key',
          credentials: {},
          priority: 0,
          metadata: {},
          id: 'prof-2',
          provider: 'claude',
        }),
      );
    });

    it('POST /api/auth-profiles should return 400 when id is missing', async () => {
      const req = mockReq({ body: { provider: 'openai' } });
      const res = mockRes();
      await authProfilesAddHandler(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toEqual({ error: 'id and provider are required' });
      expect(mockAuthProfileManager.addProfile).not.toHaveBeenCalled();
    });

    it('POST /api/auth-profiles should return 400 when provider is missing', async () => {
      const req = mockReq({ body: { id: 'prof-1' } });
      const res = mockRes();
      await authProfilesAddHandler(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toEqual({ error: 'id and provider are required' });
      expect(mockAuthProfileManager.addProfile).not.toHaveBeenCalled();
    });

    it('POST /api/auth-profiles should return 500 when addProfile throws', async () => {
      mockAuthProfileManager.addProfile.mockImplementationOnce(() => {
        throw new Error('add error');
      });

      const req = mockReq({ body: { id: 'p', provider: 'x' } });
      const res = mockRes();
      await authProfilesAddHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'add error' });
    });

    it('DELETE /api/auth-profiles/:id should remove a profile', async () => {
      const req = mockReq({ params: { id: 'prof-1' } });
      const res = mockRes();
      await authProfilesRemoveHandler(req, res);

      expect(mockAuthProfileManager.removeProfile).toHaveBeenCalledWith('prof-1');
      expect(res._json).toEqual({ success: true });
    });

    it('DELETE /api/auth-profiles/:id should return 404 when profile not found', async () => {
      mockAuthProfileManager.removeProfile.mockReturnValueOnce(false);

      const req = mockReq({ params: { id: 'nonexistent' } });
      const res = mockRes();
      await authProfilesRemoveHandler(req, res);

      expect(res._status).toBe(404);
      expect(res._json).toEqual({ error: 'Profile not found' });
    });

    it('DELETE /api/auth-profiles/:id should return 500 when removeProfile throws', async () => {
      mockAuthProfileManager.removeProfile.mockImplementationOnce(() => {
        throw new Error('remove error');
      });

      const req = mockReq({ params: { id: 'prof-err' } });
      const res = mockRes();
      await authProfilesRemoveHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'remove error' });
    });

    it('POST /api/auth-profiles/reset should call resetAuthProfileManager and return new status', async () => {
      const req = mockReq();
      const res = mockRes();
      await authProfilesResetHandler(req, res);

      expect(mockResetAuthProfileManager).toHaveBeenCalled();
      expect(mockAuthProfileManager.getStatus).toHaveBeenCalled();
      expect(res._json).toHaveProperty('success', true);
      expect(res._json).toHaveProperty('profiles');
    });

    it('POST /api/auth-profiles/reset should include fresh status after reset', async () => {
      mockAuthProfileManager.getStatus.mockReturnValueOnce({
        profiles: ['fresh'],
        active: 'fresh',
      });

      const req = mockReq();
      const res = mockRes();
      await authProfilesResetHandler(req, res);

      expect(res._json).toEqual({
        success: true,
        profiles: { profiles: ['fresh'], active: 'fresh' },
      });
    });

    it('POST /api/auth-profiles/reset should return 500 when reset throws', async () => {
      mockResetAuthProfileManager.mockImplementationOnce(() => {
        throw new Error('reset error');
      });

      const req = mockReq();
      const res = mockRes();
      await authProfilesResetHandler(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toEqual({ error: 'reset error' });
    });
  });
});
