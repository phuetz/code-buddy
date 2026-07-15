import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repairVoiceIncident } from '../../src/companion/voice-incident-repair.js';

const FROM = '2026-07-15T06:04:00.000Z';
const TO = '2026-07-15T09:45:00.000Z';
const INCIDENT_MS = Date.parse('2026-07-15T07:00:00.000Z');

async function fixture(): Promise<{
  conversationPath: string;
  perceptsPath: string;
  guidancePath: string;
  relationshipStatePath: string;
  improvementStatePath: string;
  conversationQualityStatePath: string;
  userModelPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'voice-incident-repair-'));
  const paths = {
    conversationPath: join(root, 'lisa.jsonl'),
    perceptsPath: join(root, 'percepts.jsonl'),
    guidancePath: join(root, 'voice-guidance.json'),
    relationshipStatePath: join(root, 'relationship-state.json'),
    improvementStatePath: join(root, 'voice-improvement-state.json'),
    conversationQualityStatePath: join(root, 'conversation-quality-state.json'),
    userModelPath: join(root, 'user-model.json'),
  };
  await writeFile(
    paths.conversationPath,
    [
      { timestamp: '2026-07-15T05:30:00.000Z', role: 'user', origin: 'voice', content: 'before' },
      { timestamp: '2026-07-15T07:00:00.000Z', role: 'user', origin: 'voice', content: 'echo' },
      { timestamp: '2026-07-15T07:01:00.000Z', role: 'user', origin: 'channel', content: 'telegram' },
    ].map((value) => JSON.stringify(value)).join('\n') + '\n',
  );
  await writeFile(
    paths.perceptsPath,
    [
      { timestamp: '2026-07-15T07:00:00.000Z', modality: 'hearing', payload: { responded: true } },
      { timestamp: '2026-07-15T07:00:01.000Z', modality: 'vision', payload: {} },
    ].map((value) => JSON.stringify(value)).join('\n') + '\n',
  );
  await writeFile(paths.guidancePath, JSON.stringify([{ text: 'polluted', at: INCIDENT_MS }]));
  await writeFile(
    paths.relationshipStatePath,
    JSON.stringify({
      firstSeenAt: 1,
      lastPresentAt: 2,
      celebratedMilestones: [7],
      mood: 42,
      traits: { warmth: 90, humor: 10, depth: 99, energy: 2 },
      sessions: 3,
    }),
  );
  await writeFile(paths.improvementStatePath, '{"lastFingerprint":"polluted"}');
  await writeFile(
    paths.conversationQualityStatePath,
    '{"issueStreaks":{"repetitive":10}}',
  );
  await writeFile(
    paths.userModelPath,
    JSON.stringify({
      schemaVersion: 1,
      observations: [
        { id: 'incident', status: 'pending', createdAt: INCIDENT_MS, content: 'polluted' },
        { id: 'accepted', status: 'accepted', createdAt: INCIDENT_MS, content: 'keep' },
        { id: 'later', status: 'pending', createdAt: Date.parse('2026-07-15T10:00:00Z'), content: 'keep' },
      ],
    }),
  );
  return paths;
}

describe('voice incident repair', () => {
  it('reports a raw-free dry-run without changing files', async () => {
    const paths = await fixture();
    const before = await readFile(paths.conversationPath, 'utf8');
    const report = repairVoiceIncident({
      ...paths,
      from: FROM,
      to: TO,
      now: Date.parse('2026-07-15T11:00:00Z'),
    });

    expect(report).toMatchObject({
      mode: 'dry-run',
      conversation: { total: 3, quarantined: 1, retained: 2 },
      percepts: { total: 2, quarantined: 1, retained: 1 },
      guidanceCleared: 1,
      pendingObservationsDiscarded: 1,
      backups: [],
      quarantines: [],
    });
    expect(JSON.stringify(report)).not.toContain('echo');
    expect(JSON.stringify(report)).not.toContain('polluted');
    expect(await readFile(paths.conversationPath, 'utf8')).toBe(before);
  });

  it('backs up, quarantines, resets learning, and preserves relationship history', async () => {
    const paths = await fixture();
    const report = repairVoiceIncident({
      ...paths,
      from: FROM,
      to: TO,
      now: Date.parse('2026-07-15T11:00:00Z'),
      apply: true,
    });

    expect(report.mode).toBe('apply');
    expect(report.backups).toHaveLength(7);
    expect(report.quarantines).toHaveLength(2);
    const activeConversation = await readFile(paths.conversationPath, 'utf8');
    expect(activeConversation).toContain('before');
    expect(activeConversation).toContain('telegram');
    expect(activeConversation).not.toContain('echo');
    expect(await readFile(report.quarantines[0]!, 'utf8')).toContain('echo');
    expect(JSON.parse(await readFile(paths.guidancePath, 'utf8'))).toEqual([]);

    const relationship = JSON.parse(await readFile(paths.relationshipStatePath, 'utf8')) as {
      firstSeenAt: number;
      celebratedMilestones: number[];
      sessions: number;
      mood: number;
      traits: Record<string, number>;
    };
    expect(relationship).toMatchObject({
      firstSeenAt: 1,
      celebratedMilestones: [7],
      sessions: 3,
      mood: 60,
      traits: { warmth: 62, humor: 52, depth: 55, energy: 55 },
    });

    const userModel = JSON.parse(await readFile(paths.userModelPath, 'utf8')) as {
      observations: Array<{ id: string; status: string; reviewedBy?: string }>;
    };
    expect(userModel.observations).toEqual([
      expect.objectContaining({
        id: 'incident',
        status: 'discarded',
        reviewedBy: 'voice-incident-repair',
      }),
      expect.objectContaining({ id: 'accepted', status: 'accepted' }),
      expect.objectContaining({ id: 'later', status: 'pending' }),
    ]);
    expect(JSON.parse(await readFile(paths.improvementStatePath, 'utf8'))).toEqual({});
    expect(JSON.parse(await readFile(paths.conversationQualityStatePath, 'utf8'))).toEqual({
      issueStreaks: {},
    });
  });
});
