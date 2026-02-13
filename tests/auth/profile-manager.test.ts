/**
 * Auth Profile Manager Tests
 *
 * Covers: round-robin rotation, session stickiness, exponential backoff
 * cooldowns, billing failure handling, profile recovery, priority and
 * random strategies, persistence, and singleton lifecycle.
 */

import {
  AuthProfileManager,
  getAuthProfileManager,
  resetAuthProfileManager,
} from '../../src/auth/profile-manager.js';
import type { AuthProfile, AuthProfileManagerConfig } from '../../src/auth/profile-manager.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn().mockReturnValue('{}'),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProfile(overrides: Partial<AuthProfile> & { id: string }): AuthProfile {
  return {
    provider: 'test-provider',
    type: 'api-key',
    credentials: { apiKey: `key-${overrides.id}` },
    priority: 50,
    metadata: {},
    ...overrides,
  };
}

function createManager(
  profiles: AuthProfile[],
  configOverrides: Partial<AuthProfileManagerConfig> = {}
): AuthProfileManager {
  return new AuthProfileManager({
    profiles,
    cooldownMs: 1000,           // 1 second for faster tests
    billingCooldownMs: 5000,    // 5 seconds for faster tests
    maxCooldownMs: 20000,       // 20 seconds cap
    persistPath: '/tmp/test-auth-profiles.json',
    ...configOverrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthProfileManager', () => {
  let manager: AuthProfileManager;

  afterEach(() => {
    if (manager) {
      manager.shutdown();
    }
    resetAuthProfileManager();
  });

  // =========================================================================
  // Round-Robin Rotation
  // =========================================================================

  describe('round-robin rotation', () => {
    it('should cycle through profiles in order', () => {
      const profiles = [
        createProfile({ id: 'p1', priority: 50 }),
        createProfile({ id: 'p2', priority: 50 }),
        createProfile({ id: 'p3', priority: 50 }),
      ];
      manager = createManager(profiles, { sessionSticky: false });

      // All same type and priority, so order depends on round-robin index
      const selected1 = manager.getNextProfile();
      const selected2 = manager.getNextProfile();
      const selected3 = manager.getNextProfile();
      const selected4 = manager.getNextProfile(); // wraps around

      expect(selected1).not.toBeNull();
      expect(selected2).not.toBeNull();
      expect(selected3).not.toBeNull();
      expect(selected4).not.toBeNull();

      // After cycling through all 3, the 4th should be the same as the 1st
      expect(selected4!.id).toBe(selected1!.id);
    });

    it('should return all three distinct profiles in a full cycle', () => {
      const profiles = [
        createProfile({ id: 'a', priority: 50 }),
        createProfile({ id: 'b', priority: 50 }),
        createProfile({ id: 'c', priority: 50 }),
      ];
      manager = createManager(profiles, { sessionSticky: false });

      const ids = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const p = manager.getNextProfile();
        if (p) ids.add(p.id);
      }

      expect(ids.size).toBe(3);
    });

    it('should return null when no profiles are registered', () => {
      manager = createManager([]);
      expect(manager.getNextProfile()).toBeNull();
    });

    it('should skip profiles in cooldown during rotation', () => {
      const profiles = [
        createProfile({ id: 'healthy1', priority: 50 }),
        createProfile({ id: 'cooldown1', priority: 50 }),
        createProfile({ id: 'healthy2', priority: 50 }),
      ];
      manager = createManager(profiles, { sessionSticky: false });

      // Put cooldown1 in cooldown
      manager.markFailed('cooldown1', 'test error');

      // Collect selections over several rounds
      const selected: string[] = [];
      for (let i = 0; i < 4; i++) {
        const p = manager.getNextProfile();
        if (p) selected.push(p.id);
      }

      expect(selected).not.toContain('cooldown1');
      expect(selected.length).toBe(4);
    });
  });

  // =========================================================================
  // Priority Strategy
  // =========================================================================

  describe('priority strategy', () => {
    it('should always select highest priority profile', () => {
      const profiles = [
        createProfile({ id: 'low', priority: 10 }),
        createProfile({ id: 'high', priority: 100 }),
        createProfile({ id: 'mid', priority: 50 }),
      ];
      manager = createManager(profiles, {
        rotationStrategy: 'priority',
        sessionSticky: false,
      });

      for (let i = 0; i < 5; i++) {
        const p = manager.getNextProfile();
        expect(p).not.toBeNull();
        expect(p!.id).toBe('high');
      }
    });

    it('should prioritize oauth over api-key at same priority', () => {
      const profiles = [
        createProfile({ id: 'apikey', type: 'api-key', priority: 50 }),
        createProfile({ id: 'oauth', type: 'oauth', priority: 50 }),
      ];
      manager = createManager(profiles, {
        rotationStrategy: 'priority',
        sessionSticky: false,
      });

      const p = manager.getNextProfile();
      expect(p).not.toBeNull();
      expect(p!.id).toBe('oauth');
    });
  });

  // =========================================================================
  // Random Strategy
  // =========================================================================

  describe('random strategy', () => {
    it('should return a valid profile', () => {
      const profiles = [
        createProfile({ id: 'r1' }),
        createProfile({ id: 'r2' }),
        createProfile({ id: 'r3' }),
      ];
      manager = createManager(profiles, {
        rotationStrategy: 'random',
        sessionSticky: false,
      });

      for (let i = 0; i < 10; i++) {
        const p = manager.getNextProfile();
        expect(p).not.toBeNull();
        expect(['r1', 'r2', 'r3']).toContain(p!.id);
      }
    });
  });

  // =========================================================================
  // Session Stickiness
  // =========================================================================

  describe('session stickiness', () => {
    it('should return the same profile for the same session', () => {
      const profiles = [
        createProfile({ id: 's1', priority: 50 }),
        createProfile({ id: 's2', priority: 50 }),
        createProfile({ id: 's3', priority: 50 }),
      ];
      manager = createManager(profiles, { sessionSticky: true });

      const sessionId = 'session-abc';
      const first = manager.getNextProfile(sessionId);
      expect(first).not.toBeNull();

      // Subsequent calls with the same session should return the same profile
      for (let i = 0; i < 5; i++) {
        const p = manager.getNextProfile(sessionId);
        expect(p).not.toBeNull();
        expect(p!.id).toBe(first!.id);
      }
    });

    it('should assign different profiles to different sessions', () => {
      const profiles = [
        createProfile({ id: 'd1', priority: 50 }),
        createProfile({ id: 'd2', priority: 50 }),
      ];
      manager = createManager(profiles, { sessionSticky: true });

      const p1 = manager.getNextProfile('session-1');
      const p2 = manager.getNextProfile('session-2');

      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
      // Due to round-robin advancing, they should get different profiles
      expect(p1!.id).not.toBe(p2!.id);
    });

    it('should unbind session when profile enters cooldown', () => {
      const profiles = [
        createProfile({ id: 'sticky1', priority: 50 }),
        createProfile({ id: 'sticky2', priority: 50 }),
      ];
      manager = createManager(profiles, { sessionSticky: true });

      const sessionId = 'session-sticky';
      const first = manager.getNextProfile(sessionId);
      expect(first).not.toBeNull();

      // Put the sticky profile in cooldown
      manager.markFailed(first!.id, 'went down');

      // Next call should pick a different healthy profile
      const next = manager.getNextProfile(sessionId);
      expect(next).not.toBeNull();
      expect(next!.id).not.toBe(first!.id);
    });

    it('should return the bound profile via getProfileForSession', () => {
      const profiles = [
        createProfile({ id: 'bound1', priority: 50 }),
      ];
      manager = createManager(profiles, { sessionSticky: true });

      // Before binding
      expect(manager.getProfileForSession('sess-x')).toBeNull();

      // Bind
      manager.getNextProfile('sess-x');

      // After binding
      const bound = manager.getProfileForSession('sess-x');
      expect(bound).not.toBeNull();
      expect(bound!.id).toBe('bound1');
    });

    it('should release session binding via releaseSession', () => {
      const profiles = [
        createProfile({ id: 'rel1', priority: 50 }),
        createProfile({ id: 'rel2', priority: 50 }),
      ];
      manager = createManager(profiles, { sessionSticky: true });

      const sessionId = 'session-release';
      const first = manager.getNextProfile(sessionId);
      expect(first).not.toBeNull();

      // Release the session
      manager.releaseSession(sessionId);
      expect(manager.getProfileForSession(sessionId)).toBeNull();

      // Next selection may yield a different profile (round-robin advances)
      const next = manager.getNextProfile(sessionId);
      expect(next).not.toBeNull();
    });

    it('should not apply stickiness when sessionSticky is false', () => {
      const profiles = [
        createProfile({ id: 'ns1', priority: 50 }),
        createProfile({ id: 'ns2', priority: 50 }),
      ];
      manager = createManager(profiles, { sessionSticky: false });

      const sessionId = 'no-stick-session';
      const first = manager.getNextProfile(sessionId);
      const second = manager.getNextProfile(sessionId);

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      // Round-robin should advance, giving different profiles
      expect(first!.id).not.toBe(second!.id);
    });
  });

  // =========================================================================
  // Exponential Backoff Cooldowns
  // =========================================================================

  describe('exponential backoff cooldowns', () => {
    it('should put profile in cooldown after failure', () => {
      const profiles = [
        createProfile({ id: 'fail1', priority: 50 }),
        createProfile({ id: 'healthy', priority: 50 }),
      ];
      manager = createManager(profiles, { sessionSticky: false });

      manager.markFailed('fail1', 'connection timeout');

      const healthy = manager.getHealthyProfiles();
      const healthyIds = healthy.map(p => p.id);
      expect(healthyIds).not.toContain('fail1');
      expect(healthyIds).toContain('healthy');
    });

    it('should escalate cooldown exponentially (5x for normal failures)', () => {
      const profiles = [createProfile({ id: 'exp1' })];
      manager = createManager(profiles, {
        cooldownMs: 1000,
        sessionSticky: false,
      });

      const events: number[] = [];
      manager.on('profile:cooldown', (_id: string, cooldownMs: number) => {
        events.push(cooldownMs);
      });

      // 1st failure: 1000ms * 5^0 = 1000ms
      manager.markFailed('exp1', 'error 1');
      // 2nd failure: 1000ms * 5^1 = 5000ms
      manager.markFailed('exp1', 'error 2');
      // 3rd failure: 1000ms * 5^2 = 25000ms
      manager.markFailed('exp1', 'error 3');

      expect(events).toEqual([1000, 5000, 25000]);
    });

    it('should cap normal cooldown at 1 hour', () => {
      const profiles = [createProfile({ id: 'cap1' })];
      manager = createManager(profiles, {
        cooldownMs: 60000, // 1 minute base
        sessionSticky: false,
      });

      const events: number[] = [];
      manager.on('profile:cooldown', (_id: string, cooldownMs: number) => {
        events.push(cooldownMs);
      });

      // Fail many times to exceed the 1h cap
      for (let i = 0; i < 6; i++) {
        manager.markFailed('cap1', `error ${i}`);
      }

      // Last cooldown should be capped at 3,600,000 ms (1 hour)
      const lastCooldown = events[events.length - 1];
      expect(lastCooldown).toBeLessThanOrEqual(3_600_000);
    });

    it('should reset failure count on markSuccess', () => {
      const profiles = [createProfile({ id: 'reset1' })];
      manager = createManager(profiles, { sessionSticky: false });

      manager.markFailed('reset1', 'error');
      expect(manager.getHealthyProfiles().map(p => p.id)).not.toContain('reset1');

      manager.markSuccess('reset1');
      expect(manager.getHealthyProfiles().map(p => p.id)).toContain('reset1');
    });

    it('should emit profile:failed and profile:cooldown events', () => {
      const profiles = [createProfile({ id: 'evt1' })];
      manager = createManager(profiles, { sessionSticky: false });

      const failed: string[] = [];
      const cooldowns: string[] = [];
      manager.on('profile:failed', (id: string) => failed.push(id));
      manager.on('profile:cooldown', (id: string) => cooldowns.push(id));

      manager.markFailed('evt1', 'test error');

      expect(failed).toEqual(['evt1']);
      expect(cooldowns).toEqual(['evt1']);
    });

    it('should emit profile:selected event', () => {
      const profiles = [createProfile({ id: 'sel1' })];
      manager = createManager(profiles, { sessionSticky: false });

      const selected: string[] = [];
      manager.on('profile:selected', (id: string) => selected.push(id));

      manager.getNextProfile();
      expect(selected).toEqual(['sel1']);
    });

    it('should not fail when markFailed is called for unknown profile', () => {
      manager = createManager([]);
      expect(() => manager.markFailed('nonexistent', 'error')).not.toThrow();
    });
  });

  // =========================================================================
  // Billing Failure Separate Backoff
  // =========================================================================

  describe('billing failure backoff', () => {
    it('should use billing cooldown for billing failures', () => {
      const profiles = [createProfile({ id: 'bill1' })];
      manager = createManager(profiles, {
        billingCooldownMs: 5000,
        sessionSticky: false,
      });

      const events: number[] = [];
      manager.on('profile:cooldown', (_id: string, cooldownMs: number) => {
        events.push(cooldownMs);
      });

      // 1st billing failure: 5000ms * 2^0 = 5000ms
      manager.markFailed('bill1', 'billing error', true);

      expect(events).toEqual([5000]);
    });

    it('should escalate billing cooldown with 2x multiplier', () => {
      const profiles = [createProfile({ id: 'bill2' })];
      manager = createManager(profiles, {
        billingCooldownMs: 5000,
        maxCooldownMs: 100000,
        sessionSticky: false,
      });

      const events: number[] = [];
      manager.on('profile:cooldown', (_id: string, cooldownMs: number) => {
        events.push(cooldownMs);
      });

      // 1st: 5000 * 2^0 = 5000
      manager.markFailed('bill2', 'billing 1', true);
      // 2nd: 5000 * 2^1 = 10000
      manager.markFailed('bill2', 'billing 2', true);
      // 3rd: 5000 * 2^2 = 20000
      manager.markFailed('bill2', 'billing 3', true);

      expect(events).toEqual([5000, 10000, 20000]);
    });

    it('should cap billing cooldown at maxCooldownMs', () => {
      const profiles = [createProfile({ id: 'bill-cap' })];
      manager = createManager(profiles, {
        billingCooldownMs: 5000,
        maxCooldownMs: 15000,
        sessionSticky: false,
      });

      const events: number[] = [];
      manager.on('profile:cooldown', (_id: string, cooldownMs: number) => {
        events.push(cooldownMs);
      });

      // Fail enough times to exceed the cap
      for (let i = 0; i < 5; i++) {
        manager.markFailed('bill-cap', `billing ${i}`, true);
      }

      // All values should be <= maxCooldownMs
      for (const ms of events) {
        expect(ms).toBeLessThanOrEqual(15000);
      }
      // The last should be exactly the cap
      expect(events[events.length - 1]).toBe(15000);
    });
  });

  // =========================================================================
  // Profile Recovery After Cooldown
  // =========================================================================

  describe('profile recovery after cooldown', () => {
    it('should recover profile after cooldown expires (via timer)', (done) => {
      const profiles = [createProfile({ id: 'rec1' })];
      manager = createManager(profiles, {
        cooldownMs: 100, // Very short for test
        sessionSticky: false,
      });

      manager.on('profile:recovered', (id: string) => {
        expect(id).toBe('rec1');

        const healthy = manager.getHealthyProfiles();
        expect(healthy.map(p => p.id)).toContain('rec1');
        done();
      });

      manager.markFailed('rec1', 'temp error');

      // Profile should be in cooldown now
      expect(manager.getHealthyProfiles().map(p => p.id)).not.toContain('rec1');
    }, 5000);

    it('should recover profile when checked after cooldown expiry', () => {
      const profiles = [createProfile({ id: 'rec2' })];
      manager = createManager(profiles, {
        cooldownMs: 1, // 1ms cooldown
        sessionSticky: false,
      });

      manager.markFailed('rec2', 'brief error');

      // Wait a tiny bit to ensure cooldown expires
      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy-wait to pass the 1ms cooldown
      }

      // getHealthyProfiles should detect the expired cooldown and recover
      const healthy = manager.getHealthyProfiles();
      expect(healthy.map(p => p.id)).toContain('rec2');
    });

    it('should keep failureCount after recovery (escalates on next failure)', () => {
      const profiles = [createProfile({ id: 'rec3' })];
      manager = createManager(profiles, {
        cooldownMs: 1,
        sessionSticky: false,
      });

      const events: number[] = [];
      manager.on('profile:cooldown', (_id: string, cooldownMs: number) => {
        events.push(cooldownMs);
      });

      // First failure: 1ms * 5^0 = 1ms
      manager.markFailed('rec3', 'error 1');

      // Wait for cooldown to expire
      const start = Date.now();
      while (Date.now() - start < 5) { /* busy wait */ }

      // Trigger recovery check
      manager.getHealthyProfiles();

      // Second failure: should escalate (1ms * 5^1 = 5ms)
      manager.markFailed('rec3', 'error 2');

      expect(events[0]).toBe(1);
      expect(events[1]).toBe(5);
    });

    it('should fully reset failureCount on markSuccess', () => {
      const profiles = [createProfile({ id: 'rec4' })];
      manager = createManager(profiles, {
        cooldownMs: 1,
        sessionSticky: false,
      });

      const events: number[] = [];
      manager.on('profile:cooldown', (_id: string, cooldownMs: number) => {
        events.push(cooldownMs);
      });

      // Fail twice to escalate
      manager.markFailed('rec4', 'error 1');

      const start = Date.now();
      while (Date.now() - start < 5) { /* busy wait */ }

      manager.getHealthyProfiles(); // recover
      manager.markFailed('rec4', 'error 2');

      // Now markSuccess to fully reset
      manager.markSuccess('rec4');

      // Next failure should be back at base cooldown
      manager.markFailed('rec4', 'error 3');

      // events[0] = 1 (first failure, 5^0)
      // events[1] = 5 (second failure, 5^1)
      // events[2] = 1 (third failure after reset, 5^0)
      expect(events[2]).toBe(1);
    });
  });

  // =========================================================================
  // Profile Management
  // =========================================================================

  describe('profile management', () => {
    it('should add and retrieve profiles', () => {
      manager = createManager([]);

      manager.addProfile(createProfile({ id: 'add1', provider: 'openai' }));
      const p = manager.getProfile('add1');
      expect(p).toBeDefined();
      expect(p!.provider).toBe('openai');
    });

    it('should remove profiles and clean up bindings', () => {
      const profiles = [createProfile({ id: 'rm1' })];
      manager = createManager(profiles, { sessionSticky: true });

      // Bind to a session
      manager.getNextProfile('session-rm');

      // Remove the profile
      expect(manager.removeProfile('rm1')).toBe(true);
      expect(manager.getProfile('rm1')).toBeUndefined();
      expect(manager.getProfileForSession('session-rm')).toBeNull();
    });

    it('should return false when removing nonexistent profile', () => {
      manager = createManager([]);
      expect(manager.removeProfile('nonexistent')).toBe(false);
    });

    it('should list all profiles', () => {
      const profiles = [
        createProfile({ id: 'all1' }),
        createProfile({ id: 'all2' }),
      ];
      manager = createManager(profiles);

      expect(manager.getAllProfiles().length).toBe(2);
    });
  });

  // =========================================================================
  // Status / Diagnostics
  // =========================================================================

  describe('status and diagnostics', () => {
    it('should report status for all profiles', () => {
      const profiles = [
        createProfile({ id: 'stat1', provider: 'grok', type: 'api-key', priority: 100 }),
        createProfile({ id: 'stat2', provider: 'openai', type: 'oauth', priority: 80 }),
      ];
      manager = createManager(profiles, { sessionSticky: false });

      manager.markFailed('stat1', 'down');

      const status = manager.getStatus();
      expect(status.length).toBe(2);

      const stat1 = status.find(s => s.profileId === 'stat1')!;
      expect(stat1.healthy).toBe(false);
      expect(stat1.inCooldown).toBe(true);
      expect(stat1.failureCount).toBe(1);
      expect(stat1.lastError).toBe('down');
      expect(stat1.cooldownRemainingMs).toBeGreaterThan(0);

      const stat2 = status.find(s => s.profileId === 'stat2')!;
      expect(stat2.healthy).toBe(true);
      expect(stat2.inCooldown).toBe(false);
      expect(stat2.failureCount).toBe(0);
      expect(stat2.cooldownRemainingMs).toBe(0);
    });
  });

  // =========================================================================
  // Singleton
  // =========================================================================

  describe('singleton', () => {
    it('should return the same instance from getAuthProfileManager', () => {
      const instance1 = getAuthProfileManager({
        persistPath: '/tmp/test-singleton.json',
      });
      const instance2 = getAuthProfileManager();

      expect(instance1).toBe(instance2);

      resetAuthProfileManager();
    });

    it('should create a new instance after resetAuthProfileManager', () => {
      const instance1 = getAuthProfileManager({
        persistPath: '/tmp/test-singleton-reset.json',
      });
      resetAuthProfileManager();

      const instance2 = getAuthProfileManager({
        persistPath: '/tmp/test-singleton-reset.json',
      });

      expect(instance1).not.toBe(instance2);

      resetAuthProfileManager();
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  describe('edge cases', () => {
    it('should return null when all profiles are in cooldown', () => {
      const profiles = [
        createProfile({ id: 'ec1' }),
        createProfile({ id: 'ec2' }),
      ];
      manager = createManager(profiles, { sessionSticky: false });

      manager.markFailed('ec1', 'error');
      manager.markFailed('ec2', 'error');

      expect(manager.getNextProfile()).toBeNull();
    });

    it('should handle getNextProfile with unknown sessionId gracefully', () => {
      const profiles = [createProfile({ id: 'unk1' })];
      manager = createManager(profiles, { sessionSticky: true });

      const p = manager.getNextProfile('never-seen-session');
      expect(p).not.toBeNull();
    });

    it('should handle releaseSession for unknown session gracefully', () => {
      manager = createManager([]);
      expect(() => manager.releaseSession('unknown')).not.toThrow();
    });

    it('should handle markSuccess for unknown profile gracefully', () => {
      manager = createManager([]);
      expect(() => manager.markSuccess('unknown')).not.toThrow();
    });

    it('should handle shutdown idempotently', () => {
      manager = createManager([createProfile({ id: 'sd1' })]);
      manager.shutdown();
      expect(() => manager.shutdown()).not.toThrow();
    });
  });
});
