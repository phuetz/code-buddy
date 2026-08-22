import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CollectiveKnowledgeGraph } from '../../src/memory/collective-knowledge-graph.js';
import { redactRememberInput } from '../../src/memory/ckg-redaction.js';

describe('CKG remember input redaction', () => {
  let tempDir: string;
  let ledgerPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cb-ckg-redaction-'));
    ledgerPath = path.join(tempDir, 'ledger.jsonl');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('redacts secrets in entity names and relation fields before persistence', async () => {
    const nameSecret = `ghp_${'A'.repeat(36)}`;
    const targetSecret = `sk-proj-${'B'.repeat(24)}`;
    const reasonSecret = `xoxb-${'C'.repeat(20)}`;
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });

    const stored = ckg.remember({
      name: `deployment-${nameSecret}`,
      text: 'Deployment credentials are linked to the rotation task.',
      relations: [{
        predicate: 'related_to',
        targetName: `rotation-${targetSecret}`,
        reason: `reported by ${reasonSecret}`,
      }],
    });

    expect(stored).not.toBeNull();
    const ledger = await readFile(ledgerPath, 'utf8');
    expect(ledger).not.toContain(nameSecret);
    expect(ledger).not.toContain(targetSecret);
    expect(ledger).not.toContain(reasonSecret);
    expect(ledger).toContain('[REDACTED:env-key]');
  });

  it('uses the same immutable helper for buddy-memory shaped inputs', () => {
    const secret = `ghp_${'D'.repeat(36)}`;
    const input = {
      name: secret,
      text: `token ${secret}`,
      relations: [{ predicate: 'related_to', targetName: secret, reason: secret }],
      source: 'test',
    };

    const redacted = redactRememberInput(input);

    expect(redacted).not.toBe(input);
    expect(JSON.stringify(redacted)).not.toContain(secret);
    expect(input.name).toBe(secret);
  });
});
