import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { ContextManagerV2 } from '../../src/context/context-manager-v2.js';
import { SegmentArchive } from '../../src/context/segment-archive.js';

const tempHomes: string[] = [];
let previousZoom: string | undefined;
let previousQuota: string | undefined;

async function tempHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codebuddy-context-zoom-'));
  tempHomes.push(directory);
  return directory;
}

beforeEach(() => {
  previousZoom = process.env.CODEBUDDY_CONTEXT_ZOOM;
  previousQuota = process.env.CODEBUDDY_CONTEXT_ZOOM_MAX_MB;
  delete process.env.CODEBUDDY_CONTEXT_ZOOM;
  delete process.env.CODEBUDDY_CONTEXT_ZOOM_MAX_MB;
});

afterEach(async () => {
  if (previousZoom === undefined) delete process.env.CODEBUDDY_CONTEXT_ZOOM;
  else process.env.CODEBUDDY_CONTEXT_ZOOM = previousZoom;
  if (previousQuota === undefined) delete process.env.CODEBUDDY_CONTEXT_ZOOM_MAX_MB;
  else process.env.CODEBUDDY_CONTEXT_ZOOM_MAX_MB = previousQuota;
  vi.restoreAllMocks();
  await Promise.all(tempHomes.splice(0).map(directory => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })));
});

describe('SegmentArchive', () => {
  it('round-trips exact messages and generates stable content ids', async () => {
    const home = await tempHome();
    const archive = new SegmentArchive(home);
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'Keep this exact request.' },
      { role: 'assistant', content: 'Keep this exact response.' },
    ];

    const first = archive.archive('session-round-trip', messages, 'Short summary');
    const second = archive.archive('session-round-trip', structuredClone(messages), 'Updated summary');

    expect(first).toMatch(/^[a-f0-9]{16}$/);
    expect(second).toBe(first);
    expect(archive.get('session-round-trip', first!)).toMatchObject({
      segmentId: first,
      sessionId: 'session-round-trip',
      messages,
      summaryPreview: 'Short summary',
    });
    expect(archive.list('session-round-trip')).toHaveLength(1);
  });

  it('cleans the temporary file when atomic rename fails', async () => {
    const home = await tempHome();
    const archive = new SegmentArchive(home, () => {
      throw new Error('simulated crash before rename');
    });

    expect(() => archive.archive(
      'session-atomic',
      [{ role: 'user', content: 'atomic payload' }],
      'summary',
    )).not.toThrow();
    expect(archive.list('session-atomic')).toEqual([]);
    const directory = join(home, '.codebuddy', 'context-archive', 'session-atomic');
    expect(await readdir(directory)).toEqual([]);
  });

  it('purges least-recently-used segments above the per-session quota', async () => {
    const home = await tempHome();
    const archive = new SegmentArchive(home);
    process.env.CODEBUDDY_CONTEXT_ZOOM_MAX_MB = '0.002';

    const first = archive.archive(
      'session-lru',
      [{ role: 'user', content: `first-${'a'.repeat(1200)}` }],
      'first',
    );
    expect(first).not.toBeNull();
    const firstPath = join(home, '.codebuddy', 'context-archive', 'session-lru', `${first}.json`);
    await utimes(firstPath, new Date(1), new Date(1));

    const second = archive.archive(
      'session-lru',
      [{ role: 'user', content: `second-${'b'.repeat(1200)}` }],
      'second',
    );

    expect(second).not.toBeNull();
    expect(archive.get('session-lru', first!)).toBeNull();
    expect(archive.get('session-lru', second!)).not.toBeNull();
  });

  it('refuses to list a segment whose stored hash does not match its content', async () => {
    const home = await tempHome();
    const archive = new SegmentArchive(home);
    const messages: CodeBuddyMessage[] = [{ role: 'user', content: 'original payload' }];
    const segmentId = archive.archive('session-integrity', messages, 'summary');
    expect(segmentId).toBeTruthy();
    const filePath = join(home, '.codebuddy', 'context-archive', 'session-integrity', `${segmentId}.json`);
    const record = JSON.parse(await (await import('node:fs/promises')).readFile(filePath, 'utf8')) as {
      messages: CodeBuddyMessage[];
    };
    record.messages = [{ role: 'user', content: 'tampered payload' }];
    await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`);
    expect(() => archive.list('session-integrity')).toThrow(/integrity/i);
  });

  it('never throws when its archive directory cannot be written', async () => {
    // A home underneath a regular FILE: no mkdir can succeed below it on any OS
    // (`/sys` is read-only on Linux only; `C:\sys` is creatable on Windows).
    const blocker = join(await tempHome(), 'blocker-file');
    await writeFile(blocker, 'not a directory');
    const archive = new SegmentArchive(join(blocker, 'home'));
    let result: string | null = 'not-called';

    expect(() => {
      result = archive.archive(
        'session-read-only',
        [{ role: 'user', content: 'must not break compaction' }],
        'summary',
      );
    }).not.toThrow();
    expect(result).toBeNull();
  });
});

describe('ContextManagerV2 context zoom wiring', () => {
  const messages: CodeBuddyMessage[] = [
    { role: 'user', content: 'first request' },
    { role: 'assistant', content: 'second response' },
    { role: 'user', content: 'third request' },
    { role: 'assistant', content: 'fourth response' },
    { role: 'user', content: 'fifth request' },
    { role: 'assistant', content: 'sixth response' },
    { role: 'user', content: 'recent request' },
    { role: 'assistant', content: 'recent response' },
  ];

  function manager(archive: SegmentArchive): ContextManagerV2 {
    return new ContextManagerV2({
      maxContextTokens: 900,
      responseReserveTokens: 100,
      recentMessagesCount: 2,
      enableSummarization: true,
      enableEnhancedCompression: false,
      compressionRatio: 2,
      model: 'gpt-4',
    }, archive);
  }

  it('keeps legacy summary text byte-identical when the feature flag is absent', async () => {
    const archive = new SegmentArchive(await tempHome());
    const contextManager = manager(archive);

    const compacted = contextManager.prepareMessages(messages);
    const summary = compacted.find(message =>
      typeof message.content === 'string' && message.content.includes('[Conversation Summary]'),
    );

    expect(summary?.content).toBe(
      '[Conversation Summary]\n' +
      'User: first request\n' +
      'Assistant: second response\n' +
      'User: third request',
    );
    expect(archive.list(contextManager.getSessionId())).toEqual([]);
    contextManager.dispose();
  });

  it('prefixes the summary and archives its originals when enabled', async () => {
    process.env.CODEBUDDY_CONTEXT_ZOOM = 'true';
    const archive = new SegmentArchive(await tempHome());
    const contextManager = manager(archive);

    const compacted = contextManager.prepareMessages(messages);
    const summary = compacted.find(message =>
      typeof message.content === 'string' && message.content.includes('[Conversation Summary]'),
    );
    expect(summary?.content).toMatch(/^\[segment:([a-f0-9]{16})\] \[Conversation Summary\]\n/);

    const segmentId = /^\[segment:([a-f0-9]{16})\]/.exec(String(summary?.content))?.[1];
    expect(segmentId).toBeDefined();
    expect(archive.get(contextManager.getSessionId(), segmentId!)?.messages).toEqual(messages.slice(0, -2));
    contextManager.dispose();
  });
});
