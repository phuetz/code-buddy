import { describe, expect, it } from 'vitest';
import { CognitiveBudgetLedger } from '../../src/cognition/budget-reservations.js';

describe('CognitiveBudgetLedger', () => {
  it('admits atomically up to the activation boundary and counts free work', () => {
    const ledger = new CognitiveBudgetLedger({ maxActivationsPerHour: 2, maxUsdPerHour: 0 });
    expect(ledger.reserve('reflector', 0)).not.toBeNull();
    expect(ledger.reserve('reflector', 0)).not.toBeNull();
    expect(ledger.reserve('reflector', 0)).toBeNull();
    expect(ledger.snapshot('reflector')).toMatchObject({ activations: 2, rejected: 1 });
  });

  it('releases failed reservations and reconciles committed cost', () => {
    const ledger = new CognitiveBudgetLedger({ maxActivationsPerHour: 3, maxUsdPerHour: 1 });
    const failed = ledger.reserve('critic', 0.4)!;
    failed.release();
    expect(ledger.snapshot('critic').activations).toBe(0);

    const success = ledger.reserve('critic', 0.4)!;
    success.commit(0.25);
    expect(ledger.snapshot('critic')).toMatchObject({
      activations: 1,
      committedUsd: 0.25,
      reservedUsd: 0,
    });
  });

  it('expires the hourly window', () => {
    let now = 1_000;
    const ledger = new CognitiveBudgetLedger(
      { maxActivationsPerHour: 1, maxUsdPerHour: 1 },
      () => now,
    );
    ledger.reserve('planner', 0.1)?.commit(0.1);
    expect(ledger.reserve('planner', 0.1)).toBeNull();
    now += 60 * 60_000 + 1;
    expect(ledger.reserve('planner', 0.1)).not.toBeNull();
  });
});
