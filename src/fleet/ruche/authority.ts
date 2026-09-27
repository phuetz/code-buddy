import { createHash } from 'node:crypto';
import { canonicalizeManifest } from '../../skills/skill-signing.js';
import { RucheJournal, validRucheEffect, type RucheEffect, type RucheEvent } from './journal.js';

export interface Lease {
  work: string;
  holder: string;
  token: number;
  expiresAt: number;
  grantHash: string;
}

interface Approval {
  request: RucheEvent;
  response?: RucheEvent;
  consumed: boolean;
}

const APPROVAL_MAX_MS = 300_000;
const APPROVAL_CLOCK_SKEW_MS = 5_000;

/** One serialized arbiter per work scope. Calls are deliberately synchronous. */
export class RucheAuthority {
  private readonly leases = new Map<string, Lease>();
  private readonly lastTokens = new Map<string, number>();
  private readonly approvals = new Map<string, Approval>();

  constructor(
    readonly journal: RucheJournal,
    private readonly pinnedArbiterId: string,
    private readonly now: () => number = Date.now,
    private readonly persistBeforeEffect: () => void = () => {},
  ) {
    for (const event of journal.events()) {
      const p = event.payload;
      if (event.type === 'lease.grant') {
        const work = p.work as string;
        const token = p.token as number;
        this.lastTokens.set(work, Math.max(this.lastTokens.get(work) ?? 0, token));
        this.leases.set(work, { work, holder: p.holder as string, token, expiresAt: p.expiresAt as number, grantHash: event.hash });
      } else if (event.type === 'lease.renew') {
        const old = this.leases.get(p.work as string);
        if (old && old.holder === p.holder && old.token === p.token) {
          this.leases.set(old.work, { ...old, expiresAt: p.expiresAt as number });
        }
      } else if (event.type === 'lease.release') {
        const old = this.leases.get(p.work as string);
        if (old && old.holder === p.holder && old.token === p.token) this.leases.delete(old.work);
      }
    }
    // Cross-author timestamps are not a causal order. Rebuild approvals by
    // reference in three passes so an equal-time response cannot be missed.
    for (const event of journal.events().filter((item) => item.type === 'approval.request')) {
      this.approvals.set(event.payload.effectId as string, { request: event, consumed: false });
    }
    for (const event of journal.events().filter((item) => item.type === 'approval.response')) {
      const approval = this.approvals.get(event.payload.effectId as string);
      if (approval && approval.request.hash === event.payload.requestHash) approval.response = event;
    }
    for (const event of journal.events().filter((item) => item.type === 'approval.consume')) {
      const approval = this.approvals.get(event.payload.effectId as string);
      if (approval && approval.request.hash === event.payload.requestHash && approval.response?.hash === event.payload.responseHash) {
        approval.consumed = true;
      }
    }
  }

  private assertArbiter(): void {
    if (this.journal.signerId !== this.pinnedArbiterId) {
      throw new Error('RUCHE_NOT_ARBITER');
    }
  }

  requestLease(request: RucheEvent): RucheEvent {
    this.assertArbiter();
    if (request.type !== 'lease.request') throw new Error('RUCHE_EXPECTED_LEASE_REQUEST');
    this.journal.ingest(request);
    const work = request.payload.work as string;
    const current = this.leases.get(work);
    if (current && current.expiresAt > this.now()) {
      return this.journal.append('lease.deny', {
        work, holder: request.agentId, requestHash: request.hash, reason: 'LEASE_HELD',
      });
    }
    const token = (this.lastTokens.get(work) ?? 0) + 1;
    const expiresAt = this.now() + (request.payload.ttlMs as number);
    const grant = this.journal.append('lease.grant', {
      work, holder: request.agentId, requestHash: request.hash, token, expiresAt,
    });
    this.lastTokens.set(work, token);
    this.leases.set(work, { work, holder: request.agentId, token, expiresAt, grantHash: grant.hash });
    return grant;
  }

  renew(request: RucheEvent): RucheEvent {
    this.assertArbiter();
    if (request.type !== 'lease.renew.request') throw new Error('RUCHE_EXPECTED_RENEW_REQUEST');
    this.journal.ingest(request);
    const work = request.payload.work as string;
    const holder = request.agentId;
    const token = request.payload.token as number;
    this.assertLease(work, holder, token);
    const expiresAt = this.now() + (request.payload.ttlMs as number);
    const event = this.journal.append('lease.renew', { work, holder, token, expiresAt, requestHash: request.hash });
    this.leases.set(work, { ...this.leases.get(work)!, expiresAt });
    return event;
  }

  release(request: RucheEvent): RucheEvent {
    this.assertArbiter();
    if (request.type !== 'lease.release.request') throw new Error('RUCHE_EXPECTED_RELEASE_REQUEST');
    this.journal.ingest(request);
    const work = request.payload.work as string;
    const holder = request.agentId;
    const token = request.payload.token as number;
    this.assertLease(work, holder, token);
    const event = this.journal.append('lease.release', { work, holder, token, requestHash: request.hash });
    this.leases.delete(work);
    return event;
  }

  assertLease(work: string, holder: string, token: number): Lease {
    this.assertArbiter();
    const lease = this.leases.get(work);
    if (!lease || lease.holder !== holder || lease.token !== token || lease.expiresAt <= this.now()) {
      throw new Error('RUCHE_LEASE_REQUIRED');
    }
    return lease;
  }

  status(work: string): Lease | null {
    const lease = this.leases.get(work);
    return lease && lease.expiresAt > this.now() ? { ...lease } : null;
  }

  activeLeases(): Lease[] {
    return [...this.leases.keys()].map((work) => this.status(work)).filter((lease): lease is Lease => lease !== null);
  }

  private approvalRequestIsTimely(request: RucheEvent): boolean {
    const now = this.now();
    const expiresAt = request.payload.expiresAt as number;
    return request.at <= now + APPROVAL_CLOCK_SKEW_MS
      && expiresAt > now && expiresAt <= now + APPROVAL_MAX_MS;
  }

  receiveApprovalRequest(request: RucheEvent): void {
    if (request.type !== 'approval.request') throw new Error('RUCHE_EXPECTED_APPROVAL_REQUEST');
    const effectId = request.payload.effectId as string;
    if (this.approvals.has(effectId)) throw new Error('RUCHE_EFFECT_REPLAY');
    if (!this.approvalRequestIsTimely(request)) throw new Error('RUCHE_INVALID_DEADLINE');
    this.journal.ingest(request);
    this.approvals.set(effectId, { request, consumed: false });
  }

  receiveApprovalResponse(response: RucheEvent): void {
    if (response.type !== 'approval.response') throw new Error('RUCHE_EXPECTED_APPROVAL_RESPONSE');
    const approval = this.approvals.get(response.payload.effectId as string);
    if (!approval || approval.consumed || approval.response
      || approval.request.hash !== response.payload.requestHash
      || approval.request.payload.revision !== response.payload.revision
      || !this.approvalRequestIsTimely(approval.request)) {
      throw new Error('RUCHE_APPROVAL_INVALID');
    }
    this.journal.ingest(response);
    approval.response = response;
  }

  /** Call immediately before an outbound effect. The approval is consumed first. */
  async withApproval<T>(effectId: string, revision: string, descriptor: RucheEffect, effect: () => Promise<T>): Promise<T> {
    this.assertArbiter();
    const approval = this.approvals.get(effectId);
    const response = approval?.response;
    if (!approval || approval.consumed
      || approval.request.payload.revision !== revision
      || !this.approvalRequestIsTimely(approval.request)
      || !response || response.payload.approved !== true) {
      throw new Error('RUCHE_APPROVAL_REQUIRED');
    }
    if (!validRucheEffect(descriptor)
      || canonicalizeManifest(approval.request.payload.effect) !== canonicalizeManifest(descriptor)) {
      throw new Error('RUCHE_APPROVAL_EFFECT_MISMATCH');
    }
    this.journal.append('approval.consume', {
      effectId, requestHash: approval.request.hash, responseHash: response.hash,
    });
    this.persistBeforeEffect();
    approval.consumed = true;
    return effect();
  }
}

/** Refuse a claimed verdict when either the revision or log bytes differ. */
export function recordVerdict(
  journal: RucheJournal,
  input: { revision: string; expectedRevision: string; command: string; exitCode: number; log: Buffer | string; logHash: string; report: Buffer | string; reportHash: string },
): RucheEvent {
  if (!/^[a-f0-9]{40}([a-f0-9]{24})?$/.test(input.revision) || input.revision !== input.expectedRevision) {
    throw new Error('RUCHE_REVISION_MISMATCH');
  }
  const actualHash = createHash('sha256').update(input.log).digest('hex');
  if (actualHash !== input.logHash) throw new Error('RUCHE_LOG_MISMATCH');
  if (createHash('sha256').update(input.report).digest('hex') !== input.reportHash) {
    throw new Error('RUCHE_REPORT_MISMATCH');
  }
  return journal.append('verdict', {
    revision: input.revision, command: input.command, exitCode: input.exitCode, logHash: input.logHash,
    reportHash: input.reportHash,
  });
}

export function laneIsActive(journal: RucheJournal, lane: string, now: number): boolean {
  const last = journal.events().filter((event) => event.type === 'heartbeat' && event.payload.lane === lane)
    .sort((a, b) => a.at - b.at || a.seq - b.seq).at(-1);
  return Boolean(last && last.at <= now + 5_000 && last.at >= now - 60_000
    && (last.payload.expiresAt as number) > now);
}

export function laneStatuses(journal: RucheJournal, now: number): Array<{ lane: string; active: boolean }> {
  const lanes = new Set(journal.events()
    .filter((event) => event.type === 'heartbeat')
    .map((event) => event.payload.lane as string));
  return [...lanes].sort().map((lane) => ({ lane, active: laneIsActive(journal, lane, now) }));
}
