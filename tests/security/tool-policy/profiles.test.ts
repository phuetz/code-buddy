/**
 * Policy Profiles Tests
 */

import {
  PROFILES,
  getProfile,
  getProfileNames,
  getProfileRules,
  formatProfile,
  getProfileComparison,
} from '../../../src/security/tool-policy/profiles.js';
import { PolicyProfile } from '../../../src/security/tool-policy/types.js';

describe('Policy Profiles', () => {
  describe('PROFILES', () => {
    it('should have all four profiles defined', () => {
      expect(PROFILES.minimal).toBeDefined();
      expect(PROFILES.coding).toBeDefined();
      expect(PROFILES.messaging).toBeDefined();
      expect(PROFILES.full).toBeDefined();
    });

    it('should have descriptions for all profiles', () => {
      for (const profile of Object.values(PROFILES)) {
        expect(profile.description).toBeTruthy();
        expect(typeof profile.description).toBe('string');
      }
    });

    it('should have rules for all profiles', () => {
      for (const profile of Object.values(PROFILES)) {
        expect(profile.rules).toBeInstanceOf(Array);
        expect(profile.rules.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getProfile', () => {
    it('should return profile by name', () => {
      const profile = getProfile('coding');
      expect(profile.name).toBe('coding');
    });

    it('should throw for unknown profile', () => {
      expect(() => getProfile('unknown' as PolicyProfile)).toThrow();
    });
  });

  describe('getProfileNames', () => {
    it('should return all profile names', () => {
      const names = getProfileNames();
      expect(names).toContain('minimal');
      expect(names).toContain('coding');
      expect(names).toContain('messaging');
      expect(names).toContain('full');
      expect(names.length).toBe(4);
    });
  });

  describe('getProfileRules', () => {
    it('should return rules for a profile', () => {
      const rules = getProfileRules('coding');
      expect(rules.length).toBeGreaterThan(0);
    });

    it('should include rules for all major groups', () => {
      const rules = getProfileRules('coding');
      const groups = rules.map(r => r.group);

      expect(groups).toContain('group:fs:read');
      expect(groups).toContain('group:fs:write');
      expect(groups).toContain('group:runtime:shell');
    });
  });

  describe('Profile behavior', () => {
    describe('minimal profile', () => {
      it('should deny writes', () => {
        const rules = getProfileRules('minimal');
        const writeRule = rules.find(r => r.group === 'group:fs:write');
        expect(writeRule?.action).toBe('deny');
      });

      it('should deny runtime', () => {
        const rules = getProfileRules('minimal');
        const runtimeRule = rules.find(r => r.group === 'group:runtime');
        expect(runtimeRule?.action).toBe('deny');
      });

      it('should allow reads', () => {
        const rules = getProfileRules('minimal');
        const readRule = rules.find(r => r.group === 'group:fs:read');
        expect(readRule?.action).toBe('allow');
      });
    });

    describe('coding profile', () => {
      it('should allow reads', () => {
        const rules = getProfileRules('coding');
        const readRule = rules.find(r => r.group === 'group:fs:read');
        expect(readRule?.action).toBe('allow');
      });

      it('should allow writes', () => {
        const rules = getProfileRules('coding');
        const writeRule = rules.find(r => r.group === 'group:fs:write');
        expect(writeRule?.action).toBe('allow');
      });

      it('should confirm shell commands', () => {
        const rules = getProfileRules('coding');
        const shellRule = rules.find(r => r.group === 'group:runtime:shell');
        expect(shellRule?.action).toBe('confirm');
      });

      it('should confirm dangerous operations', () => {
        const rules = getProfileRules('coding');
        const dangerousRule = rules.find(r => r.group === 'group:dangerous');
        expect(dangerousRule?.action).toBe('confirm');
      });
    });

    describe('messaging profile', () => {
      it('should allow web operations', () => {
        const rules = getProfileRules('messaging');
        const webRule = rules.find(r => r.group === 'group:web');
        expect(webRule?.action).toBe('allow');
      });

      it('should deny git write', () => {
        const rules = getProfileRules('messaging');
        const gitWriteRule = rules.find(r => r.group === 'group:git:write');
        expect(gitWriteRule?.action).toBe('deny');
      });
    });

    describe('full profile', () => {
      it('should allow most operations', () => {
        const rules = getProfileRules('full');
        const fsRule = rules.find(r => r.group === 'group:fs');
        const runtimeRule = rules.find(r => r.group === 'group:runtime');
        const webRule = rules.find(r => r.group === 'group:web');

        expect(fsRule?.action).toBe('allow');
        expect(runtimeRule?.action).toBe('allow');
        expect(webRule?.action).toBe('allow');
      });

      it('should still confirm dangerous operations', () => {
        const rules = getProfileRules('full');
        const dangerousRule = rules.find(r => r.group === 'group:dangerous');
        expect(dangerousRule?.action).toBe('confirm');
      });
    });
  });

  describe('formatProfile', () => {
    it('should format profile with icon and description', () => {
      const formatted = formatProfile('coding');
      expect(formatted).toContain('coding');
      expect(formatted).toContain('💻');
    });
  });

  describe('getProfileComparison', () => {
    it('should return a comparison table', () => {
      const comparison = getProfileComparison();
      expect(comparison).toContain('minimal');
      expect(comparison).toContain('coding');
      expect(comparison).toContain('messaging');
      expect(comparison).toContain('full');
    });
  });
});
