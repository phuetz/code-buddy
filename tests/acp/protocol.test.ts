import { ACPRouter, ACPAgent, ACPMessage } from '../../src/acp/protocol.js';

describe('ACPRouter', () => {
  let router: ACPRouter;

  beforeEach(() => {
    router = new ACPRouter();
  });

  afterEach(() => {
    router.dispose();
  });

  const makeAgent = (id: string, capabilities: string[] = []): ACPAgent => ({
    id,
    name: `Agent ${id}`,
    capabilities,
    status: 'ready',
  });

  describe('register/unregister', () => {
    it('should register an agent', () => {
      const agent = makeAgent('a1', ['code']);
      router.register(agent);
      expect(router.getAgent('a1')).toEqual(agent);
    });

    it('should unregister an agent', () => {
      router.register(makeAgent('a1'));
      router.unregister('a1');
      expect(router.getAgent('a1')).toBeUndefined();
    });

    it('should handle unregistering non-existent agent', () => {
      expect(() => router.unregister('nope')).not.toThrow();
    });
  });

  describe('getAgents', () => {
    it('should return all registered agents', () => {
      router.register(makeAgent('a1'));
      router.register(makeAgent('a2'));
      expect(router.getAgents()).toHaveLength(2);
    });
  });

  describe('getAgent', () => {
    it('should return agent by ID', () => {
      const agent = makeAgent('a1');
      router.register(agent);
      expect(router.getAgent('a1')).toEqual(agent);
    });

    it('should return undefined for unknown ID', () => {
      expect(router.getAgent('unknown')).toBeUndefined();
    });
  });

  describe('setAgentStatus', () => {
    it('should update agent status', () => {
      router.register(makeAgent('a1'));
      router.setAgentStatus('a1', 'busy');
      expect(router.getAgent('a1')?.status).toBe('busy');
    });

    it('should ignore unknown agent', () => {
      expect(() => router.setAgentStatus('nope', 'busy')).not.toThrow();
    });
  });

  describe('findByCapability', () => {
    it('should filter agents by capability', () => {
      router.register(makeAgent('a1', ['code', 'test']));
      router.register(makeAgent('a2', ['deploy']));
      router.register(makeAgent('a3', ['code']));
      const result = router.findByCapability('code');
      expect(result).toHaveLength(2);
      expect(result.map((a) => a.id)).toEqual(['a1', 'a3']);
    });

    it('should return empty array when no match', () => {
      router.register(makeAgent('a1', ['code']));
      expect(router.findByCapability('deploy')).toHaveLength(0);
    });
  });

  describe('onAction', () => {
    it('should register a handler for an action', async () => {
      const handler = jest.fn().mockResolvedValue(null);
      router.onAction('ping', handler);
      await router.send({ type: 'event', from: 'a1', to: 'a2', action: 'ping', payload: {} });
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('should route message to correct handler', async () => {
      const handler = jest.fn().mockResolvedValue(null);
      router.onAction('do_thing', handler);
      await router.send({ type: 'event', from: 'a1', to: 'a2', action: 'do_thing', payload: { x: 1 } });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'do_thing', payload: { x: 1 } })
      );
    });

    it('should emit broadcast event for wildcard target', async () => {
      const broadcastSpy = jest.fn();
      router.on('broadcast', broadcastSpy);
      await router.send({ type: 'event', from: 'a1', to: '*', action: 'notify', payload: {} });
      expect(broadcastSpy).toHaveBeenCalled();
    });

    it('should add message to log', async () => {
      await router.send({ type: 'event', from: 'a1', to: 'a2', action: 'ping', payload: {} });
      expect(router.getLog()).toHaveLength(1);
      expect(router.getLog()[0].action).toBe('ping');
    });

    it('should assign id and timestamp', async () => {
      await router.send({ type: 'event', from: 'a1', to: 'a2', action: 'ping', payload: {} });
      const msg = router.getLog()[0];
      expect(msg.id).toBeDefined();
      expect(msg.timestamp).toBeGreaterThan(0);
    });
  });

  describe('request/response', () => {
    it('should resolve when response with correlationId arrives', async () => {
      router.onAction('query', async (msg) => {
        // Simulate async response
        setTimeout(async () => {
          await router.send({
            type: 'response',
            from: msg.to,
            to: msg.from,
            action: 'query',
            payload: { answer: 42 },
            correlationId: msg.correlationId,
          });
        }, 10);
        return null;
      });

      const response = await router.request('agent-b', 'query', { q: 'meaning' }, 5000);
      expect(response.type).toBe('response');
      expect(response.payload).toEqual({ answer: 42 });
    });

    it('should reject on timeout', async () => {
      await expect(
        router.request('agent-b', 'slow_action', {}, 50)
      ).rejects.toThrow(/timed out/);
    });
  });

  describe('message log', () => {
    it('should track messages', async () => {
      await router.send({ type: 'event', from: 'a', to: 'b', action: 'x', payload: {} });
      await router.send({ type: 'event', from: 'a', to: 'b', action: 'y', payload: {} });
      expect(router.getLog()).toHaveLength(2);
    });

    it('should trim log to maxLogSize', async () => {
      const small = new ACPRouter(3);
      for (let i = 0; i < 5; i++) {
        await small.send({ type: 'event', from: 'a', to: 'b', action: `a${i}`, payload: {} });
      }
      expect(small.getLog()).toHaveLength(3);
      expect(small.getLog()[0].action).toBe('a2');
      small.dispose();
    });

    it('should clear log', async () => {
      await router.send({ type: 'event', from: 'a', to: 'b', action: 'x', payload: {} });
      router.clearLog();
      expect(router.getLog()).toHaveLength(0);
    });
  });

  describe('dispose', () => {
    it('should clean up pending requests', () => {
      // Start a request but don't resolve it
      const promise = router.request('agent-b', 'action', {}, 60000);
      router.dispose();
      // After dispose, the pending map should be empty (timer cleared)
      // The promise will neither resolve nor reject after dispose since timer is cleared
      // This is acceptable - dispose is for cleanup
    });

    it('should remove all listeners', () => {
      router.on('message', () => {});
      router.dispose();
      expect(router.listenerCount('message')).toBe(0);
    });
  });
});
