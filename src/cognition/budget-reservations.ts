export interface CognitiveBudgetLimits {
  maxActivationsPerHour: number;
  maxUsdPerHour: number;
}

export interface CognitiveBudgetSnapshot {
  activations: number;
  committedUsd: number;
  reservedUsd: number;
  rejected: number;
}

interface BudgetEntry {
  id: string;
  specialistId: string;
  createdAt: number;
  estimatedUsd: number;
  actualUsd?: number;
  status: 'reserved' | 'committed';
}

export interface CognitiveBudgetReservation {
  id: string;
  commit(actualUsd: number): void;
  release(): void;
}

/** Atomic in-process admission budget. Free calls still consume activation quota. */
export class CognitiveBudgetLedger {
  private readonly entries = new Map<string, BudgetEntry>();
  private readonly rejected = new Map<string, number>();
  private sequence = 0;

  constructor(
    private readonly limits: CognitiveBudgetLimits,
    private readonly now: () => number = Date.now,
  ) {}

  reserve(specialistId: string, estimatedUsd: number): CognitiveBudgetReservation | null {
    const now = this.now();
    this.prune(now);
    const estimate = Math.max(0, Number.isFinite(estimatedUsd) ? estimatedUsd : 0);
    const current = [...this.entries.values()].filter((entry) => entry.specialistId === specialistId);
    const usd = current.reduce(
      (sum, entry) => sum + (entry.status === 'committed' ? entry.actualUsd ?? 0 : entry.estimatedUsd),
      0,
    );
    if (
      current.length >= Math.max(0, this.limits.maxActivationsPerHour) ||
      usd + estimate > Math.max(0, this.limits.maxUsdPerHour)
    ) {
      this.rejected.set(specialistId, (this.rejected.get(specialistId) ?? 0) + 1);
      return null;
    }

    const id = `cognitive_budget_${now}_${++this.sequence}`;
    this.entries.set(id, {
      id,
      specialistId,
      createdAt: now,
      estimatedUsd: estimate,
      status: 'reserved',
    });
    let settled = false;
    return {
      id,
      commit: (actualUsd) => {
        if (settled) return;
        settled = true;
        const entry = this.entries.get(id);
        if (!entry) return;
        entry.status = 'committed';
        entry.actualUsd = Math.max(0, Number.isFinite(actualUsd) ? actualUsd : estimate);
      },
      release: () => {
        if (settled) return;
        settled = true;
        this.entries.delete(id);
      },
    };
  }

  snapshot(specialistId: string): CognitiveBudgetSnapshot {
    this.prune(this.now());
    const current = [...this.entries.values()].filter((entry) => entry.specialistId === specialistId);
    return {
      activations: current.length,
      committedUsd: current.reduce((sum, entry) => sum + (entry.actualUsd ?? 0), 0),
      reservedUsd: current.reduce(
        (sum, entry) => sum + (entry.status === 'reserved' ? entry.estimatedUsd : 0),
        0,
      ),
      rejected: this.rejected.get(specialistId) ?? 0,
    };
  }

  private prune(now: number): void {
    const cutoff = now - 60 * 60_000;
    for (const [id, entry] of this.entries) {
      if (entry.createdAt < cutoff) this.entries.delete(id);
    }
  }
}
