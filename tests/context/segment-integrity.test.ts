/**
 * R29 D5 — le nom hashé d'un segment n'est pas une preuve d'intégrité.
 * À la restauration, recalculer le hash du contenu et refuser un segment altéré.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import {
  SegmentArchive,
  SegmentIntegrityError,
} from '../../src/context/segment-archive.js';
import { ContextExpandTool } from '../../src/tools/context-expand-tool.js';

const tempHomes: string[] = [];
let previousZoom: string | undefined;

async function tempHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codebuddy-segment-integrity-'));
  tempHomes.push(directory);
  return directory;
}

beforeEach(() => {
  previousZoom = process.env.CODEBUDDY_CONTEXT_ZOOM;
  process.env.CODEBUDDY_CONTEXT_ZOOM = 'true';
});

afterEach(async () => {
  if (previousZoom === undefined) delete process.env.CODEBUDDY_CONTEXT_ZOOM;
  else process.env.CODEBUDDY_CONTEXT_ZOOM = previousZoom;
  await Promise.all(tempHomes.splice(0).map(directory => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })));
});

describe('R29 D5 — intégrité des segments archivés', () => {
  const sessionId = 'session-integrity';
  const originalMessages: CodeBuddyMessage[] = [
    { role: 'user', content: 'What was the exact value?' },
    { role: 'assistant', content: 'The exact value was alpha-42.' },
  ];

  async function archived(home: string): Promise<{
    archive: SegmentArchive;
    segmentId: string;
    filePath: string;
  }> {
    const archive = new SegmentArchive(home);
    const segmentId = archive.archive(sessionId, originalMessages, 'value summary');
    if (!segmentId) throw new Error('archive failed');
    return {
      archive,
      segmentId,
      filePath: join(home, '.codebuddy', 'context-archive', sessionId, `${segmentId}.json`),
    };
  }

  it('refuses a shape-valid segment whose messages were altered on disk', async () => {
    const { archive, segmentId, filePath } = await archived(await tempHome());
    const record = JSON.parse(await readFile(filePath, 'utf8')) as {
      messages: CodeBuddyMessage[];
    };
    record.messages[0] = { role: 'user', content: 'The exact value is attacker-replaced.' };
    await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`);

    expect(() => archive.get(sessionId, segmentId)).toThrow(SegmentIntegrityError);
    expect(() => archive.get(sessionId, segmentId)).toThrow(/integrity check/i);

    const tool = new ContextExpandTool({ archive });
    const result = await tool.execute(
      { segment_id: segmentId },
      { cwd: process.cwd(), sessionId },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/integrity check/i);
    expect(result.output ?? '').not.toContain('attacker-replaced');
  });

  it('rewrites a corrupt existing file instead of treating its name as proof', async () => {
    const { archive, segmentId, filePath } = await archived(await tempHome());
    await writeFile(filePath, '{"corrupt":true}\n');

    const reused = archive.archive(sessionId, originalMessages, 'value summary');
    expect(reused).toBe(segmentId);
    expect(archive.get(sessionId, segmentId)?.messages).toEqual(originalMessages);
  });
});
