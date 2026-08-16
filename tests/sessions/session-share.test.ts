import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionFacade } from '../../src/agent/facades/session-facade.js';
import { CheckpointManager } from '../../src/checkpoints/checkpoint-manager.js';
import { createShareCommand } from '../../src/commands/share.js';
import { exportSessionShareHtml } from '../../src/export/session-share.js';
import { SessionStore, type Session } from '../../src/persistence/session-store.js';
import { SessionTimeline, type TimelineEntry } from '../../src/sessions/timeline.js';
import { logger } from '../../src/utils/logger.js';

const OPENAI_SECRET = `sk-${'a'.repeat(48)}`;
const GOOGLE_SECRET = `AIza${'b'.repeat(35)}`;
const BEARER_SECRET = `Bearer ${'c'.repeat(40)}`;

function sessionFixture(id = 'share-fixture'): Session {
  return {
    id,
    name: 'Session de démonstration',
    workingDirectory: '/workspace/demo',
    model: 'gpt-5.6-sol',
    createdAt: new Date('2026-08-16T08:00:00.000Z'),
    lastAccessedAt: new Date('2026-08-16T08:05:00.000Z'),
    metadata: {
      tokenCount: 321,
      totalCost: 0.0042,
    },
    messages: [
      {
        type: 'user',
        content: 'Construis une page de démonstration élégante',
        timestamp: '2026-08-16T08:00:00.000Z',
      },
      {
        type: 'reasoning',
        content: 'Je vérifie le contrat avant de modifier les fichiers.',
        timestamp: '2026-08-16T08:00:01.000Z',
      },
      {
        type: 'assistant',
        content: `Je prépare le composant sans exposer ${GOOGLE_SECRET}. <script>alert('x')</script>`,
        timestamp: '2026-08-16T08:00:02.000Z',
      },
      {
        type: 'tool_result',
        content: `Fichier mis à jour avec ${OPENAI_SECRET}.`,
        timestamp: '2026-08-16T08:00:03.000Z',
        toolCallName: 'apply_patch',
        toolCallSuccess: true,
      },
      {
        type: 'diff_preview',
        content: [
          'diff --git a/src/app.ts b/src/app.ts',
          '--- a/src/app.ts',
          '+++ b/src/app.ts',
          '@@ -1 +1 @@',
          '-const ready = false;',
          '+const ready = true;',
        ].join('\n'),
        timestamp: '2026-08-16T08:00:04.000Z',
      },
      {
        type: 'user',
        content: 'Ajoute maintenant un second état',
        timestamp: '2026-08-16T08:04:00.000Z',
      },
      {
        type: 'assistant',
        content: 'Le second état est prêt.',
        timestamp: '2026-08-16T08:04:01.000Z',
      },
    ],
  };
}

function timelineFixture(): TimelineEntry[] {
  return [
    {
      turn: 1,
      ts: '2026-08-16T08:00:05.000Z',
      role: 'assistant',
      textPreview: 'Je prépare le composant.',
      toolCalls: [
        {
          name: 'apply_patch',
          ok: true,
          arguments: {
            patch: 'src/app.ts',
            authorization: BEARER_SECRET,
          },
        },
      ],
      filesTouched: ['src/app.ts'],
      model: 'gpt-5.6-sol',
      usage: { inputTokens: 120, outputTokens: 45, costUsd: 0.0012 },
    },
    {
      turn: 2,
      ts: '2026-08-16T08:04:02.000Z',
      role: 'assistant',
      textPreview: 'Le second état est prêt.',
      toolCalls: [],
      filesTouched: [],
    },
  ] as unknown as TimelineEntry[];
}

describe('session share HTML exporter', () => {
  it('renders every turn without network assets and redacts secrets', () => {
    const html = exportSessionShareHtml(sessionFixture(), timelineFixture(), {
      exportedAt: new Date('2026-08-16T09:00:00.000Z'),
    });

    expect(html).toContain(
      '<title>Construis une page de démonstration élégante — Code Buddy</title>'
    );
    expect(html).toContain('Tour 1');
    expect(html).toContain('Tour 2');
    expect(html).toContain('Construis une page de démonstration élégante');
    expect(html).toContain('Le second état est prêt.');
    expect(html).toContain('Raisonnement enregistré');
    expect(html).toContain('apply_patch');
    expect(html).toContain('Arguments résumés');
    expect(html).toContain('src/app.ts');
    expect(html).toContain('<span class="diff-add">+const ready = true;</span>');
    expect(html).toContain('165 tokens');
    expect(html).toContain('&lt;script&gt;alert(&#039;x&#039;)&lt;/script&gt;');

    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toContain('<link');
    expect(html).not.toContain('<script src=');
    expect(html).not.toContain(OPENAI_SECRET);
    expect(html).not.toContain(GOOGLE_SECRET);
    expect(html).not.toContain(BEARER_SECRET);
    expect(html).toContain('[REDACTED:openai_key]');
    expect(html).toContain('[REDACTED:google_api_key]');
    expect(html).toContain('Bearer [REDACTED:bearer_token]');
  });

  it('merges the current preview-only timeline tool with its saved result', () => {
    const session = sessionFixture();
    const timeline = timelineFixture();
    timeline[0]!.toolCalls = [{ name: 'apply_patch', ok: true }];

    const html = exportSessionShareHtml(session, timeline);

    expect(html.match(/class="tool-card"/g)).toHaveLength(1);
    expect(html).toContain('Fichier mis à jour');
    expect(html).toContain('Arguments non conservés dans cette sauvegarde.');
  });
});

describe('buddy share', () => {
  let tempDir: string;
  let sessionsDir: string;
  let previousSessionsDir: string | undefined;
  let previousTimelineGate: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buddy-share-'));
    sessionsDir = path.join(tempDir, 'sessions');
    await fs.mkdir(sessionsDir, { recursive: true });
    previousSessionsDir = process.env.CODEBUDDY_SESSIONS_DIR;
    previousTimelineGate = process.env.CODEBUDDY_TIMELINE;
    process.env.CODEBUDDY_SESSIONS_DIR = sessionsDir;
    delete process.env.CODEBUDDY_TIMELINE;
  });

  afterEach(async () => {
    if (previousSessionsDir === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
    else process.env.CODEBUDDY_SESSIONS_DIR = previousSessionsDir;
    if (previousTimelineGate === undefined) delete process.env.CODEBUDDY_TIMELINE;
    else process.env.CODEBUDDY_TIMELINE = previousTimelineGate;
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('exports --last from saved history without the timeline gate and opens best-effort', async () => {
    const older = sessionFixture('older-session');
    older.lastAccessedAt = new Date('2026-08-15T08:00:00.000Z');
    const recent = sessionFixture('recent-session');
    recent.messages[0]!.content = 'La session la plus récente';
    recent.lastAccessedAt = new Date('2026-08-16T08:00:00.000Z');
    for (const session of [older, recent]) {
      await fs.writeFile(
        path.join(sessionsDir, `${session.id}.json`),
        JSON.stringify({
          ...session,
          createdAt: session.createdAt.toISOString(),
          lastAccessedAt: session.lastAccessedAt.toISOString(),
        })
      );
    }

    const store = new SessionStore({ useSQLite: false });
    const facade = new SessionFacade({
      checkpointManager: new CheckpointManager(),
      sessionStore: store,
    });
    const openFile = vi.fn(async () => undefined);
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const outputPath = path.join(tempDir, 'codebuddy-session-recent-session.html');

    await createShareCommand({
      sessionFacade: facade,
      timeline: new SessionTimeline({ directory: path.join(tempDir, 'timelines') }),
      cwd: tempDir,
      now: () => new Date('2026-08-16T09:00:00.000Z'),
      openFile,
    })
      .exitOverride()
      .parseAsync(['node', 'share', '--last', '--open']);

    const html = await fs.readFile(outputPath, 'utf8');
    expect(html).toContain('La session la plus récente');
    expect(html).toContain('Le second état est prêt.');
    expect(await fs.stat(outputPath)).toMatchObject({ isFile: expect.any(Function) });
    expect(openFile).toHaveBeenCalledWith(outputPath);
    expect(info).toHaveBeenCalledWith(`Session partagée : ${outputPath}`);
  });
});
