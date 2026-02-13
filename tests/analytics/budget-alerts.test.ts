import { BudgetAlertManager, BudgetAlert } from '../../src/analytics/budget-alerts.js';

describe('BudgetAlertManager', () => {
  let manager: BudgetAlertManager;

  beforeEach(() => {
    manager = new BudgetAlertManager();
  });

  afterEach(() => {
    manager.removeAllListeners();
  });

  describe('constructor', () => {
    it('should use default thresholds when no config is provided', () => {
      const config = manager.getConfig();
      expect(config.warningThreshold).toBe(0.7);
      expect(config.criticalThreshold).toBe(0.9);
    });

    it('should accept custom thresholds', () => {
      const custom = new BudgetAlertManager({
        warningThreshold: 0.5,
        criticalThreshold: 0.8,
      });

      const config = custom.getConfig();
      expect(config.warningThreshold).toBe(0.5);
      expect(config.criticalThreshold).toBe(0.8);
    });

    it('should allow partial config overrides', () => {
      const custom = new BudgetAlertManager({ warningThreshold: 0.6 });
      const config = custom.getConfig();
      expect(config.warningThreshold).toBe(0.6);
      expect(config.criticalThreshold).toBe(0.9);
    });
  });

  describe('check()', () => {
    it('should return null when cost is below warning threshold', () => {
      const result = manager.check(5.0, 10.0);
      expect(result).toBeNull();
    });

    it('should return warning alert at 70% of budget', () => {
      const result = manager.check(7.0, 10.0);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('warning');
      expect(result!.percentage).toBe(70);
    });

    it('should return critical alert at 90% of budget', () => {
      const result = manager.check(9.0, 10.0);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('critical');
      expect(result!.percentage).toBe(90);
    });

    it('should return limit_reached alert at 100% of budget', () => {
      const result = manager.check(10.0, 10.0);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('limit_reached');
      expect(result!.percentage).toBe(100);
    });

    it('should return limit_reached when cost exceeds budget', () => {
      const result = manager.check(15.0, 10.0);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('limit_reached');
      expect(result!.percentage).toBe(150);
    });

    it('should return null when limit is zero', () => {
      const result = manager.check(5.0, 0);
      expect(result).toBeNull();
    });

    it('should return null when limit is negative', () => {
      const result = manager.check(5.0, -10.0);
      expect(result).toBeNull();
    });

    it('should deduplicate warning alerts', () => {
      const first = manager.check(7.0, 10.0);
      const second = manager.check(7.5, 10.0);

      expect(first).not.toBeNull();
      expect(first!.type).toBe('warning');
      expect(second).toBeNull();
    });

    it('should deduplicate critical alerts', () => {
      // First trigger warning
      manager.check(7.0, 10.0);
      // Then trigger critical
      const first = manager.check(9.0, 10.0);
      const second = manager.check(9.5, 10.0);

      expect(first).not.toBeNull();
      expect(first!.type).toBe('critical');
      expect(second).toBeNull();
    });

    it('should deduplicate limit_reached alerts', () => {
      // Trigger all levels
      manager.check(7.0, 10.0); // warning
      manager.check(9.0, 10.0); // critical
      const first = manager.check(10.0, 10.0);
      const second = manager.check(11.0, 10.0);

      expect(first).not.toBeNull();
      expect(first!.type).toBe('limit_reached');
      expect(second).toBeNull();
    });

    it('should escalate from warning to critical', () => {
      const warning = manager.check(7.0, 10.0);
      const critical = manager.check(9.0, 10.0);

      expect(warning!.type).toBe('warning');
      expect(critical!.type).toBe('critical');
    });

    it('should escalate from warning to critical to limit_reached', () => {
      const warning = manager.check(7.0, 10.0);
      const critical = manager.check(9.0, 10.0);
      const limitReached = manager.check(10.0, 10.0);

      expect(warning!.type).toBe('warning');
      expect(critical!.type).toBe('critical');
      expect(limitReached!.type).toBe('limit_reached');
    });

    it('should include currentCost and limit in alerts', () => {
      const result = manager.check(7.5, 10.0);
      expect(result!.currentCost).toBe(7.5);
      expect(result!.limit).toBe(10.0);
    });

    it('should include a human-readable message', () => {
      const result = manager.check(7.0, 10.0);
      expect(result!.message).toBeTruthy();
      expect(typeof result!.message).toBe('string');
      expect(result!.message.length).toBeGreaterThan(0);
    });

    it('should work with custom thresholds', () => {
      const custom = new BudgetAlertManager({
        warningThreshold: 0.5,
        criticalThreshold: 0.8,
      });

      const noAlert = custom.check(4.0, 10.0);
      expect(noAlert).toBeNull();

      const warning = custom.check(5.0, 10.0);
      expect(warning!.type).toBe('warning');

      const critical = custom.check(8.0, 10.0);
      expect(critical!.type).toBe('critical');
    });

    it('should handle very small budgets', () => {
      const result = manager.check(0.007, 0.01);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('warning');
    });

    it('should handle zero cost', () => {
      const result = manager.check(0, 10.0);
      expect(result).toBeNull();
    });
  });

  describe('getAlerts()', () => {
    it('should return empty array when no alerts have been emitted', () => {
      expect(manager.getAlerts()).toEqual([]);
    });

    it('should return all emitted alerts', () => {
      manager.check(7.0, 10.0); // warning
      manager.check(9.0, 10.0); // critical
      manager.check(10.0, 10.0); // limit_reached

      const alerts = manager.getAlerts();
      expect(alerts).toHaveLength(3);
      expect(alerts[0].type).toBe('warning');
      expect(alerts[1].type).toBe('critical');
      expect(alerts[2].type).toBe('limit_reached');
    });

    it('should return a copy of the alerts array', () => {
      manager.check(7.0, 10.0);

      const alerts1 = manager.getAlerts();
      const alerts2 = manager.getAlerts();

      expect(alerts1).not.toBe(alerts2);
      expect(alerts1).toEqual(alerts2);
    });

    it('should not include deduplicated attempts', () => {
      manager.check(7.0, 10.0); // warning
      manager.check(7.5, 10.0); // deduplicated warning

      expect(manager.getAlerts()).toHaveLength(1);
    });
  });

  describe('reset()', () => {
    it('should clear all alerts', () => {
      manager.check(7.0, 10.0);
      manager.check(9.0, 10.0);
      manager.check(10.0, 10.0);

      expect(manager.getAlerts()).toHaveLength(3);

      manager.reset();

      expect(manager.getAlerts()).toHaveLength(0);
    });

    it('should allow alerts to fire again after reset', () => {
      const first = manager.check(7.0, 10.0);
      expect(first!.type).toBe('warning');

      const deduplicated = manager.check(7.5, 10.0);
      expect(deduplicated).toBeNull();

      manager.reset();

      const afterReset = manager.check(7.0, 10.0);
      expect(afterReset).not.toBeNull();
      expect(afterReset!.type).toBe('warning');
    });

    it('should reset all threshold deduplication tracking', () => {
      manager.check(7.0, 10.0);  // warning
      manager.check(9.0, 10.0);  // critical
      manager.check(10.0, 10.0); // limit_reached

      manager.reset();

      // All should fire again
      const w = manager.check(7.0, 10.0);
      const c = manager.check(9.0, 10.0);
      const l = manager.check(10.0, 10.0);

      expect(w!.type).toBe('warning');
      expect(c!.type).toBe('critical');
      expect(l!.type).toBe('limit_reached');
    });
  });

  describe('event emission', () => {
    it('should emit alert event when warning threshold is crossed', (done) => {
      manager.on('alert', (alert: BudgetAlert) => {
        expect(alert.type).toBe('warning');
        done();
      });

      manager.check(7.0, 10.0);
    });

    it('should emit alert event when critical threshold is crossed', (done) => {
      // Trigger warning first (to move past it)
      manager.check(7.0, 10.0);

      manager.on('alert', (alert: BudgetAlert) => {
        if (alert.type === 'critical') {
          done();
        }
      });

      manager.check(9.0, 10.0);
    });

    it('should emit alert event when limit is reached', (done) => {
      // Trigger warning and critical first
      manager.check(7.0, 10.0);
      manager.check(9.0, 10.0);

      manager.on('alert', (alert: BudgetAlert) => {
        if (alert.type === 'limit_reached') {
          done();
        }
      });

      manager.check(10.0, 10.0);
    });

    it('should not emit event when alert is deduplicated', () => {
      const listener = jest.fn();
      manager.on('alert', listener);

      manager.check(7.0, 10.0); // first warning
      manager.check(7.5, 10.0); // deduplicated

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should not emit event when cost is below threshold', () => {
      const listener = jest.fn();
      manager.on('alert', listener);

      manager.check(5.0, 10.0);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('updateConfig()', () => {
    it('should update warning threshold', () => {
      manager.updateConfig({ warningThreshold: 0.5 });
      const config = manager.getConfig();
      expect(config.warningThreshold).toBe(0.5);
      expect(config.criticalThreshold).toBe(0.9);
    });

    it('should update critical threshold', () => {
      manager.updateConfig({ criticalThreshold: 0.95 });
      const config = manager.getConfig();
      expect(config.warningThreshold).toBe(0.7);
      expect(config.criticalThreshold).toBe(0.95);
    });

    it('should affect subsequent checks', () => {
      // At default 70%, 60% should not trigger
      const noAlert = manager.check(6.0, 10.0);
      expect(noAlert).toBeNull();

      // Lower warning threshold to 50%
      manager.updateConfig({ warningThreshold: 0.5 });
      manager.reset();

      const alert = manager.check(6.0, 10.0);
      expect(alert).not.toBeNull();
      expect(alert!.type).toBe('warning');
    });
  });

  describe('getConfig()', () => {
    it('should return a copy of the config', () => {
      const config1 = manager.getConfig();
      const config2 = manager.getConfig();
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });
});
