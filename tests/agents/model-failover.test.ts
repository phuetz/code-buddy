import { ModelFailoverChain, FailoverEntry } from '../../src/agents/model-failover.js';

describe('ModelFailoverChain', () => {
  let chain: ModelFailoverChain;

  beforeEach(() => {
    chain = new ModelFailoverChain();
  });

  it('should create chain with defaults', () => {
    const status = chain.getStatus();
    expect(status).toEqual([]);
    expect(chain.getNextProvider()).toBeNull();
  });

  it('should addProvider with healthy=true and consecutiveFailures=0', () => {
    chain.addProvider({ provider: 'grok', model: 'grok-3' });
    const status = chain.getStatus();
    expect(status).toEqual([
      { provider: 'grok', model: 'grok-3', healthy: true, failures: 0 },
    ]);
  });

  it('should getNextProvider returning first healthy provider', () => {
    chain.addProvider({ provider: 'grok', model: 'grok-3' });
    chain.addProvider({ provider: 'claude', model: 'claude-sonnet-4-20250514' });
    const provider = chain.getNextProvider();
    expect(provider).not.toBeNull();
    expect(provider!.provider).toBe('grok');
  });

  it('should markFailed increment consecutiveFailures and set healthy=false', () => {
    chain.addProvider({ provider: 'grok', model: 'grok-3' });
    chain.markFailed('grok', 'rate limited');
    const status = chain.getStatus();
    expect(status[0].healthy).toBe(false);
    expect(status[0].failures).toBe(1);

    chain.markFailed('grok', 'rate limited again');
    const status2 = chain.getStatus();
    expect(status2[0].failures).toBe(2);
  });

  it('should markHealthy reset consecutiveFailures and set healthy=true', () => {
    chain.addProvider({ provider: 'grok', model: 'grok-3' });
    chain.markFailed('grok', 'error');
    chain.markHealthy('grok');
    const status = chain.getStatus();
    expect(status[0].healthy).toBe(true);
    expect(status[0].failures).toBe(0);
  });

  it('should getNextProvider skip unhealthy providers', () => {
    chain.addProvider({ provider: 'grok', model: 'grok-3' });
    chain.addProvider({ provider: 'claude', model: 'claude-sonnet-4-20250514' });
    chain.markFailed('grok', 'down');
    const provider = chain.getNextProvider();
    expect(provider).not.toBeNull();
    expect(provider!.provider).toBe('claude');
  });

  it('should getNextProvider return null when all unhealthy', () => {
    chain.addProvider({ provider: 'grok', model: 'grok-3' });
    chain.addProvider({ provider: 'claude', model: 'claude-sonnet-4-20250514' });
    chain.markFailed('grok', 'down');
    chain.markFailed('claude', 'down');
    const provider = chain.getNextProvider();
    expect(provider).toBeNull();
  });

  it('should return provider after cooldown expires', () => {
    chain = new ModelFailoverChain([], { cooldownMs: 100 });
    chain.addProvider({ provider: 'grok', model: 'grok-3' });
    chain.markFailed('grok', 'down');

    // Manually set lastChecked in the past
    const status = chain.getStatus();
    expect(status[0].healthy).toBe(false);

    // Simulate cooldown expiry by manipulating lastChecked
    const entry = (chain as any).chain[0] as FailoverEntry;
    entry.lastChecked = Date.now() - 200;

    const provider = chain.getNextProvider();
    expect(provider).not.toBeNull();
    expect(provider!.provider).toBe('grok');
    expect(provider!.healthy).toBe(true);
  });

  it('should resetAll reset all providers', () => {
    chain.addProvider({ provider: 'grok', model: 'grok-3' });
    chain.addProvider({ provider: 'claude', model: 'claude-sonnet-4-20250514' });
    chain.markFailed('grok', 'down');
    chain.markFailed('claude', 'down');
    chain.resetAll();
    const status = chain.getStatus();
    expect(status.every(s => s.healthy && s.failures === 0)).toBe(true);
  });

  it('should getStatus return correct status array', () => {
    chain.addProvider({ provider: 'grok', model: 'grok-3' });
    chain.addProvider({ provider: 'claude', model: 'claude-sonnet-4-20250514' });
    chain.markFailed('grok', 'err');
    const status = chain.getStatus();
    expect(status).toEqual([
      { provider: 'grok', model: 'grok-3', healthy: false, failures: 1 },
      { provider: 'claude', model: 'claude-sonnet-4-20250514', healthy: true, failures: 0 },
    ]);
  });

  describe('fromEnvironment', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.GROK_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GROK_BASE_URL;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should build chain from env vars', () => {
      process.env.GROK_API_KEY = 'key1';
      process.env.ANTHROPIC_API_KEY = 'key2';
      const c = ModelFailoverChain.fromEnvironment();
      const status = c.getStatus();
      expect(status).toHaveLength(2);
      expect(status[0].provider).toBe('grok');
      expect(status[1].provider).toBe('claude');
    });

    it('should build empty chain when no keys set', () => {
      const c = ModelFailoverChain.fromEnvironment();
      expect(c.getStatus()).toHaveLength(0);
    });

    it('should include all four providers when all keys set', () => {
      process.env.GROK_API_KEY = 'k';
      process.env.ANTHROPIC_API_KEY = 'k';
      process.env.OPENAI_API_KEY = 'k';
      process.env.GOOGLE_API_KEY = 'k';
      const c = ModelFailoverChain.fromEnvironment();
      expect(c.getStatus()).toHaveLength(4);
      expect(c.getStatus().map(s => s.provider)).toEqual(['grok', 'claude', 'chatgpt', 'gemini']);
    });
  });
});
