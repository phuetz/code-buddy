import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import {
  SegmentArchive,
  SegmentIntegrityError,
  hashArchivedMessages,
} from '../../src/context/segment-archive.js';

const tempHomes: string[] = [];

async function tempHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codebuddy-revue-segment-'));
  tempHomes.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempHomes.splice(0).map(d => rm(d, { recursive: true, force: true })),
  );
});

describe('Mission G1 — Trou 4 : segment archivé puis restauré avec un hachage différent', () => {
  it('SegmentArchive.get doit lever SegmentIntegrityError si le segment sur disque a un segmentId différent du hash demandé', async () => {
    const home = await tempHome();
    const archive = new SegmentArchive(home);
    const sessionId = 'test-session-hash';

    const validMessages: CodeBuddyMessage[] = [
      { role: 'user', content: 'hello original' },
      { role: 'assistant', content: 'answer original' },
    ];

    const segmentId = archive.archive(sessionId, validMessages, 'original summary');
    expect(segmentId).toBeDefined();

    // Simuler une incohérence : le fichier porte le nom d'un hash demandé (par exemple 'target1234567890'),
    // mais son contenu interne record.segmentId est différent ('other12345678901').
    const targetId = 'target1234567890';
    const filePath = join(home, '.codebuddy', 'context-archive', sessionId, `${targetId}.json`);
    const recordContent = {
      segmentId: segmentId, // hash interne ne correspond pas au nom du fichier targetId
      sessionId,
      ts: new Date().toISOString(),
      messages: validMessages,
      tokenEstimate: 20,
      summaryPreview: 'preview',
    };

    await writeFile(filePath, JSON.stringify(recordContent, null, 2), 'utf8');

    // Invariant d'intégrité : toute discordance de hachage entre le segmentId demandé et le contenu
    // doit impérativement lever SegmentIntegrityError, et NON renvoyer null en silence.
    // ACTUELLEMENT : get() fait `if (record.segmentId !== segmentId) return null;` et avale la corruption !
    expect(() => archive.get(sessionId, targetId)).toThrow(SegmentIntegrityError);

    // ContextExpandTool doit également signaler une erreur d'intégrité
    const { ContextExpandTool } = await import('../../src/tools/context-expand-tool.js');
    const tool = new ContextExpandTool({ archive });
    const toolResult = await tool.execute({ segment_id: targetId }, { cwd: process.cwd(), sessionId });
    expect(toolResult.error).toMatch(/integrity/i);
  });

  it('hashArchivedMessages doit être invariant si un segment est sérialisé puis désérialisé avec des champs undefined', () => {
    // Un message contenant un champ optionnel undefined (ex: tool_calls: undefined ou name: undefined)
    // ne doit pas changer de hash avant vs après passage par le cycle d'archivage JSON
    const msgWithUndefined: CodeBuddyMessage = {
      role: 'assistant',
      content: 'hello',
      tool_calls: undefined,
    } as unknown as CodeBuddyMessage;

    const hashBefore = hashArchivedMessages([msgWithUndefined]);

    // Après round-trip JSON, la clé undefined est purgée par JSON.stringify
    const cloned = JSON.parse(JSON.stringify([msgWithUndefined])) as CodeBuddyMessage[];
    const hashAfter = hashArchivedMessages(cloned);

    // Les deux hashes doivent être strictement identiques
    expect(hashBefore).toBe(hashAfter);
  });
});
