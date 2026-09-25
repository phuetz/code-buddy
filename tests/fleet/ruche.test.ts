import { createHash, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publicKeyId } from '../../src/skills/skill-signing.js';
import { RucheAuthority, laneIsActive, laneStatuses, recordVerdict } from '../../src/fleet/ruche/authority.js';
import { ingestRuchePage, pullRuchePage, unwireRucheBridge, wireRucheBridge } from '../../src/fleet/ruche/bridge.js';
import { GENESIS, RucheJournal, type RucheIdentity, type RucheTrust } from '../../src/fleet/ruche/journal.js';
import { withLocalRuche } from '../../src/fleet/ruche/local-store.js';
import { getPeerMethodHandler } from '../../src/server/websocket/peer-method-registry.js';

function identity(): RucheIdentity {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return { id: publicKeyId(publicKey), publicKey, privateKey: pair.privateKey };
}

function fixture() {
  let now = 1_000_000;
  const a = identity();
  const b = identity();
  const arbiter = identity();
  const human = identity();
  const trust = new Map<string, RucheTrust>([
    [a.id, { publicKey: a.publicKey, role: 'agent' }],
    [b.id, { publicKey: b.publicKey, role: 'agent' }],
    [arbiter.id, { publicKey: arbiter.publicKey, role: 'arbitre' }],
    [human.id, { publicKey: human.publicKey, role: 'humain' }],
  ]);
  const clock = () => now;
  const ja = new RucheJournal(a, trust, clock);
  const jb = new RucheJournal(b, trust, clock);
  const jArbiter = new RucheJournal(arbiter, trust, clock);
  const jHuman = new RucheJournal(human, trust, clock);
  const authority = new RucheAuthority(jArbiter, clock);
  return { a, b, arbiter, human, ja, jb, jArbiter, jHuman, authority, clock, advance: (ms: number) => { now += ms; } };
}

describe('Ruche prototype', () => {
  beforeEach(() => vi.stubEnv('CODEBUDDY_RUCHE', 'true'));
  afterEach(() => { unwireRucheBridge(); vi.unstubAllEnvs(); });

  it('serializes two peers on one work and signs the refusal', () => {
    const f = fixture();
    const grant = f.authority.requestLease(f.ja.append('lease.request', { work: 'module-x', ttlMs: 1000 }));
    const denial = f.authority.requestLease(f.jb.append('lease.request', { work: 'module-x', ttlMs: 1000 }));
    expect(grant.type).toBe('lease.grant');
    expect(denial.type).toBe('lease.deny');
    expect(denial.payload.reason).toBe('LEASE_HELD');
    const replica = new RucheJournal(f.a, new Map([
      [f.a.id, { publicKey: f.a.publicKey, role: 'agent' }],
      [f.arbiter.id, { publicKey: f.arbiter.publicKey, role: 'arbitre' }],
    ]));
    // A fresh replica verifies the original grant and the signed refusal in sequence.
    expect(() => replica.ingest(grant)).not.toThrow();
    expect(() => replica.ingest(denial)).not.toThrow();
    expect(() => f.authority.assertLease('module-x', f.b.id, 1)).toThrow('RUCHE_LEASE_REQUIRED');
  });

  it('rejects tampering, replay, missing links and unknown signers', () => {
    const f = fixture();
    const first = f.ja.append('message', { text: 'salut' });
    expect(first.prevHash).toBe(GENESIS);
    f.jArbiter.ingest(first);
    expect(() => f.jArbiter.ingest(first)).toThrow('RUCHE_REPLAY_OR_FORK');
    const tampered = { ...f.ja.append('message', { text: 'suite' }), payload: { text: 'faux' } };
    expect(() => f.jArbiter.ingest(tampered)).toThrow('RUCHE_HASH_MISMATCH');
    const protoPayload = JSON.parse('{"text":"salut","__proto__":{"injected":true}}') as Record<string, unknown>;
    const fresh = new RucheJournal(f.arbiter, new Map([
      [f.arbiter.id, { publicKey: f.arbiter.publicKey, role: 'arbitre' }],
      [f.a.id, { publicKey: f.a.publicKey, role: 'agent' }],
    ]));
    expect(() => fresh.ingest({ ...first, payload: protoPayload })).toThrow('RUCHE_INVALID_EVENT');
    const third = f.ja.append('message', { text: 'trois' });
    expect(() => f.jArbiter.ingest(third)).toThrow('RUCHE_REPLAY_OR_FORK');
    const outsider = identity();
    const outsideTrust = new Map<string, RucheTrust>([[outsider.id, { publicKey: outsider.publicKey, role: 'agent' }]]);
    const outsideEvent = new RucheJournal(outsider, outsideTrust, f.clock).append('message', { text: 'intrus' });
    expect(() => f.jArbiter.ingest(outsideEvent)).toThrow('RUCHE_UNTRUSTED_AUTHOR');
  });

  it('expires and fences a lease before another peer takes it', () => {
    const f = fixture();
    const first = f.authority.requestLease(f.ja.append('lease.request', { work: 'module-x', ttlMs: 10 }));
    f.advance(10);
    const second = f.authority.requestLease(f.jb.append('lease.request', { work: 'module-x', ttlMs: 10 }));
    expect(second.type).toBe('lease.grant');
    expect(second.payload.token).toBe(2);
    expect(() => f.authority.assertLease('module-x', f.a.id, first.payload.token as number)).toThrow('RUCHE_LEASE_REQUIRED');
  });

  it('requires the holder signature and current token for renewal and release', () => {
    const f = fixture();
    const grant = f.authority.requestLease(f.ja.append('lease.request', { work: 'module-x', ttlMs: 10 }));
    const token = grant.payload.token as number;
    const foreign = f.jb.append('lease.release.request', { work: 'module-x', token });
    expect(() => f.authority.release(foreign)).toThrow('RUCHE_LEASE_REQUIRED');
    const renewal = f.ja.append('lease.renew.request', { work: 'module-x', token, ttlMs: 20 });
    expect(f.authority.renew(renewal).type).toBe('lease.renew');
    f.advance(10);
    expect(f.authority.assertLease('module-x', f.a.id, token).token).toBe(token);
    const release = f.ja.append('lease.release.request', { work: 'module-x', token });
    expect(f.authority.release(release).type).toBe('lease.release');
    expect(f.authority.status('module-x')).toBeNull();
  });

  it('binds a verdict to exact revision and log bytes', () => {
    const f = fixture();
    const revision = 'a'.repeat(40);
    const log = 'PASS real assertion';
    const logHash = createHash('sha256').update(log).digest('hex');
    const report = 'Rapport initial';
    const reportHash = createHash('sha256').update(report).digest('hex');
    expect(() => recordVerdict(f.ja, { revision, expectedRevision: 'b'.repeat(40), command: 'test', exitCode: 0, log, logHash, report, reportHash })).toThrow('RUCHE_REVISION_MISMATCH');
    expect(() => recordVerdict(f.ja, { revision, expectedRevision: revision, command: 'test', exitCode: 0, log: 'altered', logHash, report, reportHash })).toThrow('RUCHE_LOG_MISMATCH');
    expect(() => recordVerdict(f.ja, { revision, expectedRevision: revision, command: 'test', exitCode: 0, log, logHash, report: 'Rapport modifié', reportHash })).toThrow('RUCHE_REPORT_MISMATCH');
    const verdict = recordVerdict(f.ja, { revision, expectedRevision: revision, command: 'test', exitCode: 0, log, logHash, report, reportHash });
    expect(verdict.payload.logHash).toBe(logHash);
    expect(verdict.payload.reportHash).toBe(reportHash);
    expect(f.jArbiter.ingest(verdict).hash).toBe(verdict.hash);
  });

  it('blocks an outbound effect until a pinned human approves; silence expires', async () => {
    const f = fixture();
    const revision = 'a'.repeat(40);
    const request = f.ja.append('approval.request', { effectId: 'effect-1', effect: 'send artifact', revision, expiresAt: f.clock() + 10 });
    f.authority.receiveApprovalRequest(request);
    const effect = vi.fn(async () => 'sent');
    await expect(f.authority.withApproval('effect-1', revision, effect)).rejects.toThrow('RUCHE_APPROVAL_REQUIRED');
    expect(effect).not.toHaveBeenCalled();
    const response = f.jHuman.append('approval.response', { effectId: 'effect-1', revision, approved: true, requestHash: request.hash });
    const wrongRole = new RucheJournal(f.arbiter, new Map([
      [f.arbiter.id, { publicKey: f.arbiter.publicKey, role: 'arbitre' }],
      [response.agentId, { publicKey: f.human.publicKey, role: 'agent' }],
    ]));
    expect(() => wrongRole.ingest(response)).toThrow('RUCHE_WRONG_ROLE');
    f.authority.receiveApprovalResponse(response);
    expect(await f.authority.withApproval('effect-1', revision, effect)).toBe('sent');
    await expect(f.authority.withApproval('effect-1', revision, effect)).rejects.toThrow('RUCHE_APPROVAL_REQUIRED');
    const restarted = new RucheAuthority(f.jArbiter, f.clock);
    await expect(restarted.withApproval('effect-1', revision, effect)).rejects.toThrow('RUCHE_APPROVAL_REQUIRED');
    expect(effect).toHaveBeenCalledTimes(1);
    const expiring = f.ja.append('approval.request', { effectId: 'effect-2', effect: 'publish', revision, expiresAt: f.clock() + 10 });
    f.authority.receiveApprovalRequest(expiring);
    f.advance(10);
    await expect(f.authority.withApproval('effect-2', revision, effect)).rejects.toThrow('RUCHE_APPROVAL_REQUIRED');
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('pulls signed pages and marks an expired lane stale', () => {
    const f = fixture();
    f.ja.append('heartbeat', { lane: 'lane-1', expiresAt: f.clock() + 5 });
    const remote = new RucheJournal(f.b, new Map([
      [f.a.id, { publicKey: f.a.publicKey, role: 'agent' }],
      [f.b.id, { publicKey: f.b.publicKey, role: 'agent' }],
    ]), f.clock);
    expect(ingestRuchePage(remote, pullRuchePage(f.ja, f.a.id, 0))).toBe(1);
    expect(laneIsActive(remote, 'lane-1', f.clock())).toBe(true);
    expect(laneStatuses(remote, f.clock())).toEqual([{ lane: 'lane-1', active: true }]);
    f.advance(5);
    expect(laneIsActive(remote, 'lane-1', f.clock())).toBe(false);
    expect(laneStatuses(remote, f.clock())).toEqual([{ lane: 'lane-1', active: false }]);
  });

  it('does not run an outbound effect if approval consumption cannot be persisted', async () => {
    const f = fixture();
    const revision = 'a'.repeat(40);
    const request = f.ja.append('approval.request', { effectId: 'effect-disk', effect: 'publish', revision, expiresAt: f.clock() + 10 });
    f.authority.receiveApprovalRequest(request);
    const response = f.jHuman.append('approval.response', { effectId: 'effect-disk', revision, approved: true, requestHash: request.hash });
    f.authority.receiveApprovalResponse(response);
    const stopped = new RucheAuthority(f.jArbiter, f.clock, () => { throw new Error('disk full'); });
    const effect = vi.fn(async () => 'done');
    await expect(stopped.withApproval('effect-disk', revision, effect)).rejects.toThrow('disk full');
    expect(effect).not.toHaveBeenCalled();
  });

  it('keeps the RPC surface and journal disabled by default', () => {
    vi.stubEnv('CODEBUDDY_RUCHE', '');
    wireRucheBridge();
    expect(getPeerMethodHandler('peer.ruche.pull')).toBeUndefined();
    const f = fixture();
    expect(() => f.ja.append('message', { text: 'no' })).toThrow('RUCHE_DISABLED');
  });

  it('registers the pull and lease RPC only after opt-in', () => {
    wireRucheBridge();
    expect(getPeerMethodHandler('peer.ruche.pull')).toBeTypeOf('function');
    expect(getPeerMethodHandler('peer.ruche.bail')).toBeTypeOf('function');
    expect(getPeerMethodHandler('peer.ruche.renew')).toBeTypeOf('function');
    expect(getPeerMethodHandler('peer.ruche.release')).toBeTypeOf('function');
    expect(getPeerMethodHandler('peer.ruche.event')).toBeTypeOf('function');
    unwireRucheBridge();
    expect(getPeerMethodHandler('peer.ruche.pull')).toBeUndefined();
  });

  it('refuses a second profile acting as the pinned arbiter for the same work', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ruche-arbiter-'));
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    const arbiter = identity();
    fs.mkdirSync(path.join(a, 'ruche'), { recursive: true });
    fs.writeFileSync(path.join(a, 'ruche', 'arbiter.key.pem'), arbiter.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    fs.writeFileSync(path.join(a, 'ruche', 'arbiter.pub.pem'), arbiter.publicKey);
    vi.stubEnv('CODEBUDDY_RUCHE_ARBITER_PUBLIC_KEY', arbiter.publicKey);
    try {
      vi.stubEnv('CODEBUDDY_HOME', a);
      const first = withLocalRuche((state) => state.authority.requestLease(
        state.agent.append('lease.request', { work: 'shared', ttlMs: 1000 }),
      ));
      expect(first.type).toBe('lease.grant');
      vi.stubEnv('CODEBUDDY_HOME', b);
      expect(() => withLocalRuche((state) => state.authority.requestLease(
        state.agent.append('lease.request', { work: 'shared', ttlMs: 1000 }),
      ))).toThrow('RUCHE_NOT_ARBITER');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses substituting an unrelated effect without consuming the approval', async () => {
    const f = fixture();
    const revision = 'a'.repeat(40);
    const requested = { action: 'publish', target: 'public release' };
    const unrelated = { action: 'send', target: 'private email' };
    const request = f.ja.append('approval.request', { effectId: 'bound', effect: requested, revision, expiresAt: f.clock() + 10 });
    f.authority.receiveApprovalRequest(request);
    const response = f.jHuman.append('approval.response', { effectId: 'bound', revision, approved: true, requestHash: request.hash });
    f.authority.receiveApprovalResponse(response);
    const callback = vi.fn(async () => 'done');
    await expect(f.authority.withApproval('bound', revision, unrelated, callback)).rejects.toThrow('RUCHE_APPROVAL_EFFECT_MISMATCH');
    expect(callback).not.toHaveBeenCalled();
    expect(await f.authority.withApproval('bound', revision, requested, callback)).toBe('done');
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
