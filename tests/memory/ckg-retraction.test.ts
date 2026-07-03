/**
 * CKG retraction (append-only tombstone) — `getEntity` / `retract`.
 *
 * Real JSONL ledger in a temp dir, two instances sharing the same ledger to
 * model two agents/processes. The ledger only ever GROWS: a retraction is a
 * tombstone event, replay honors it, and a later remember() of the same node
 * revives it.
 */
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CollectiveKnowledgeGraph } from '../../src/memory/collective-knowledge-graph.js';

describe('CKG retraction', () => {
  let dir: string;
  let ledgerPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ckg-retract-'));
    ledgerPath = join(dir, 'ckg-ledger.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const ledgerLines = (): number => readFileSync(ledgerPath, 'utf8').split('\n').filter((l) => l.trim()).length;

  it('retract removes the node from recall/list; the ledger only grows', () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    ckg.remember({ type: 'fact', name: 'vitest-pool', text: 'vitest runs with pool forks in this repo' });
    const linesBefore = ledgerLines();
    expect(ckg.recall('vitest forks').length).toBe(1);

    const result = ckg.retract('vitest-pool', { reason: 'obsolete after migration' });
    expect(result.status).toBe('retracted');
    expect(result.id).toContain('vitest-pool');

    // Excluded from every current-view surface without touching those methods.
    expect(ckg.recall('vitest forks').length).toBe(0);
    expect(ckg.listEntities({}).some((e) => e.name === 'vitest-pool')).toBe(false);
    expect(ckg.getStats().entities).toBe(0);
    // Audit trail preserved: the version moved to superseded.
    expect(ckg.getStats().superseded).toBe(1);
    // Append-only: the tombstone ADDED a line, nothing was rewritten.
    expect(ledgerLines()).toBe(linesBefore + 1);
    expect(readFileSync(ledgerPath, 'utf8')).toContain('"kind":"retraction"');
  });

  it('getEntity reports current → retracted status with history', () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    ckg.remember({ type: 'fact', name: 'node-version', text: 'the repo targets node 18' });

    expect(ckg.getEntity('node-version').status).toBe('current');

    ckg.retract('node-version');
    const after = ckg.getEntity('node-version');
    expect(after.status).toBe('retracted');
    expect(after.entity?.text).toContain('node 18');
    expect(after.entity?.validTo).toBeTruthy();

    expect(ckg.getEntity('never-seen').status).toBe('not_found');
  });

  it('a retraction is visible to ANOTHER instance sharing the ledger (replay honors tombstones)', () => {
    const agentA = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'a/one' });
    agentA.remember({ type: 'fact', name: 'shared-fact', text: 'the gateway listens on 18789' });
    agentA.retract('shared-fact');

    const agentB = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'b/two' });
    expect(agentB.recall('gateway 18789').length).toBe(0);
    expect(agentB.getEntity('shared-fact').status).toBe('retracted');
  });

  it('a later remember() of the same node REVIVES it (append-only undo)', () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    ckg.remember({ type: 'fact', name: 'revivable', text: 'first life' });
    ckg.retract('revivable');
    expect(ckg.getEntity('revivable').status).toBe('retracted');

    ckg.remember({ type: 'fact', name: 'revivable', text: 'second life' });
    const revived = ckg.getEntity('revivable');
    expect(revived.status).toBe('current');
    expect(revived.entity?.text).toBe('second life');
    // The first life stays in the audit history.
    expect(revived.history.some((h) => h.text === 'first life')).toBe(true);

    // And a FRESH instance replaying the grown ledger agrees.
    const fresh = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'c/three' });
    expect(fresh.getEntity('revivable').status).toBe('current');
  });

  it('retract is idempotent and safe on unknowns', () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    expect(ckg.retract('missing').status).toBe('not_found');

    ckg.remember({ type: 'fact', name: 'once', text: 'retract me once' });
    expect(ckg.retract('once').status).toBe('retracted');
    const linesAfterFirst = ledgerLines();
    expect(ckg.retract('once').status).toBe('already_retracted');
    // The no-op did not append anything.
    expect(ledgerLines()).toBe(linesAfterFirst);
  });

  it('resolves by full id as well as by name', () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    const stored = ckg.remember({ type: 'fact', name: 'By Id', text: 'resolvable by id' });
    expect(stored).not.toBeNull();
    const byId = ckg.retract(stored!.id);
    expect(byId.status).toBe('retracted');
  });
});
