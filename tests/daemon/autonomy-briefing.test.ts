import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FleetColabStore } from '../../src/fleet/colab-store.js';
import {
  AutonomyBriefingJournal,
  renderAutonomyMorningBrief,
  resolveBriefingDate,
} from '../../src/daemon/autonomy-briefing.js';

describe('AutonomyBriefingJournal — evidence-first night watch', () => {
  let dir: string;
  let now: Date;
  let store: FleetColabStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'autonomy-briefing-'));
    now = new Date(2026, 6, 11, 22, 15, 0, 0);
    store = new FleetColabStore({ dir, now: () => now.getTime() });
    writeFileSync(join(dir, 'colab-tasks.json'), JSON.stringify({
      version: '0.1',
      tasks: [
        { id: 'critical-1', title: 'Publier le roman', status: 'open', priority: 'critical', claimedBy: null },
        { id: 'blocked-1', title: 'Réparer le pipeline', status: 'blocked', priority: 'high', blockedReason: 'verification failed', attempts: 3 },
        { id: 'parent-1', title: 'Préparer les données', status: 'open', priority: 'medium', claimedBy: null },
        { id: 'child-1', title: 'Créer la bande-annonce', status: 'open', priority: 'medium', claimedBy: null, dependsOn: ['parent-1'] },
      ],
    }, null, 2));
    writeFileSync(join(dir, 'colab-worklog.json'), JSON.stringify({
      version: '0.1',
      entries: [{
        id: 'wl-1',
        date: new Date(2026, 6, 11, 21, 30).toISOString(),
        agent: 'robot/code-buddy',
        taskId: 'done-1',
        summary: 'Index narratif préparé',
        filesModified: [{ file: 'story-index.json', changes: 'created' }],
        issues: [],
        nextSteps: ['Valider les trois scènes fortes'],
      }],
    }, null, 2));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('groups evening and pre-dawn activity into the same morning handover', () => {
    expect(resolveBriefingDate(new Date(2026, 6, 11, 17, 59))).toBe('2026-07-11');
    expect(resolveBriefingDate(new Date(2026, 6, 11, 18, 0))).toBe('2026-07-12');
    expect(resolveBriefingDate(new Date(2026, 6, 12, 5, 30))).toBe('2026-07-12');
  });

  it('persists a redacted ledger and materializes human + machine-readable briefings', () => {
    const journal = new AutonomyBriefingJournal({ dir, store, now: () => new Date(now) });
    const token = 'Bearer abcdefghijklmnopqrstuvwxyz123456';

    const result = journal.recordTick({
      outcome: 'self_improved',
      detail: `authored story-scene-ranker using ${token}`,
      model: { model: 'qwen-local', tier: 'local', paid: false, reason: 'free-first' },
    }, 17);

    expect(result.ok).toBe(true);
    expect(result.brief?.briefingDate).toBe('2026-07-12');
    expect(result.brief?.summary).toMatchObject({ observedTicks: 1, selfImproved: 1, paidModelRuns: 0, worklogEntries: 1 });
    expect(result.brief?.queue.criticalAwaitingOperator).toBe(1);
    expect(result.brief?.opportunities.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'operator_approval',
      'review_blocked',
      'ready_work',
    ]));

    const paths = journal.getPaths('2026-07-12');
    const persisted = [
      readFileSync(paths.ledgerPath, 'utf-8'),
      readFileSync(paths.markdownPath, 'utf-8'),
      readFileSync(paths.jsonPath, 'utf-8'),
      readFileSync(paths.latestMarkdownPath, 'utf-8'),
    ].join('\n');
    expect(persisted).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
    expect(persisted).toContain('[REDACTED:bearer_token]');
    expect(persisted).toContain('Publier le roman');
    expect(persisted).toContain('critical-1');
  });

  it('counts idle availability without flooding the notable-results table', () => {
    const journal = new AutonomyBriefingJournal({ dir, store, now: () => new Date(now) });
    journal.recordTick({ outcome: 'idle', detail: 'self-improve on cooldown' }, 1);
    now = new Date(now.getTime() + 60_000);
    const result = journal.recordTick({ outcome: 'completed', taskId: 'parent-1', taskTitle: 'Préparer les données' }, 2);

    expect(result.brief?.summary.observedTicks).toBe(2);
    expect(result.brief?.summary.completed).toBe(1);
    expect(result.brief?.notableEvents).toHaveLength(1);
    expect(result.brief?.notableEvents[0]?.outcome).toBe('completed');
    expect(result.brief?.summary.maintenanceChecks).toBe(0);
  });

  it('keeps a bounded no-op maintenance result as honest evidence', () => {
    const journal = new AutonomyBriefingJournal({ dir, store, now: () => new Date(now) });
    const result = journal.recordTick({
      outcome: 'idle',
      detail: 'all seed tool + skill scenarios already covered',
    }, 9);

    expect(result.brief?.summary.maintenanceChecks).toBe(1);
    expect(result.brief?.notableEvents).toHaveLength(1);
    expect(result.brief?.notableEvents[0]?.detail).toContain('already covered');
  });

  it('renders explicit evidence, opportunities and structural guardrails', () => {
    const journal = new AutonomyBriefingJournal({ dir, store, now: () => new Date(now) });
    const result = journal.recordTick({
      outcome: 'failed',
      taskId: 'blocked-1',
      taskTitle: 'Réparer le pipeline',
      detail: 'acceptance gate failed',
      model: { model: 'cloud-x', tier: 'escalated', paid: true, reason: 'failover' },
    }, 3);
    const markdown = renderAutonomyMorningBrief(result.brief!);

    expect(markdown).toContain('Résultats vérifiables');
    expect(markdown).toContain('Opportunités choisies');
    expect(markdown).toContain('Garde-fous observés');
    expect(markdown).toContain('1 exécution(s) payante(s)');
    expect(markdown).toContain('jamais maquillées en succès');
  });

  it('refreshes safely from the queue even before the first recorded tick', () => {
    const journal = new AutonomyBriefingJournal({ dir, store, now: () => new Date(now) });
    const result = journal.refresh();

    expect(result.ok).toBe(true);
    expect(result.brief?.summary.observedTicks).toBe(0);
    expect(result.brief?.opportunities[0]).toMatchObject({ kind: 'operator_approval', taskId: 'critical-1' });
  });
});
