/**
 * Curator — rapport d'entretien propose-only. Deps injectées + vrais fichiers
 * temporaires (skills authored, ledger modèles) ; aucune source globale.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  applyCuratorPatch,
  renderCuratorMarkdown,
  runCuratorScan,
  saveCuratorReport,
  type CuratorDeps,
} from '../../src/curator/curator.js';
import type { Memory } from '../../src/memory/persistent-memory.js';

const NOW = new Date('2026-07-07T03:10:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function memory(partial: Partial<Memory> & { key: string }): Memory {
  return {
    value: 'v',
    category: 'project',
    createdAt: daysAgo(100),
    updatedAt: daysAgo(100),
    accessCount: 0,
    ...partial,
  } as Memory;
}

/** Deps neutres : toutes les sections vides, à surcharger par test. */
function emptyDeps(overrides: Partial<CuratorDeps> = {}): CuratorDeps {
  return {
    now: NOW,
    listMemories: async () => [],
    skillsDir: '/nonexistent/skills',
    ckgStats: async () => ({ entities: 0, superseded: 0, relations: 0 }),
    listPendingLessons: async () => [],
    modelLedgerPath: '/nonexistent/ledger.jsonl',
    skillActivity: () => new Map(),
    scheduledSkills: async () => new Set(),
    ...overrides,
  };
}

describe('runCuratorScan — sections', () => {
  it('propose l\'archivage des souvenirs fanés mais JAMAIS des catégories protégées', async () => {
    const report = await runCuratorScan('/tmp', emptyDeps({
      listMemories: async (scope) =>
        scope === 'project'
          ? [
              memory({ key: 'vieux-fait', updatedAt: daysAgo(120) }),
              memory({ key: 'pref', category: 'preferences', updatedAt: daysAgo(400) }),
              memory({ key: 'epingle', tags: ['pinned'], updatedAt: daysAgo(400) }),
              memory({ key: 'frais', updatedAt: daysAgo(1) }),
            ]
          : [],
    }));

    const targets = report.patches.filter((p) => p.kind === 'ARCHIVE_MEMORY').map((p) => p.target);
    expect(targets).toEqual(['project:vieux-fait']);
    const memSection = report.sections.find((s) => s.name === 'Mémoire persistante');
    expect(memSection?.ok).toBe(true);
    expect(memSection?.summary).toContain('4 souvenirs');
  });

  it('propose la révision des skills authored dormantes, jamais les épinglées ni les non-authored', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'curator-skills-'));
    const mkSkill = async (name: string, pinned: boolean) => {
      const d = path.join(dir, name);
      await fs.mkdir(d, { recursive: true });
      const fm = pinned ? '---\nname: x\npinned: true\n---\n' : '---\nname: x\n---\n';
      await fs.writeFile(path.join(d, 'SKILL.md'), `${fm}\ncontenu`);
      // mtime ancien pour simuler la dormance
      const old = daysAgo(60);
      await fs.utimes(path.join(d, 'SKILL.md'), old, old);
    };
    await mkSkill('authored-dormante', false);
    await mkSkill('authored-gardee', true);
    await mkSkill('imported-externe', false); // non-authored : protégé

    const report = await runCuratorScan('/tmp', emptyDeps({ skillsDir: dir }));
    const skillPatches = report.patches.filter((p) => p.kind === 'REVIEW_SKILL');
    expect(skillPatches.map((p) => p.target)).toEqual(['authored-dormante']);
    expect(skillPatches[0]!.autoAppliable).toBe(false);
  });

  it('ancre la dormance sur la dernière activité et protège les skills planifiées (P2)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'curator-activity-'));
    const mkSkill = async (name: string, ageDays: number) => {
      const d = path.join(dir, name);
      await fs.mkdir(d, { recursive: true });
      await fs.writeFile(path.join(d, 'SKILL.md'), `---\nname: ${name}\n---\ncontenu`);
      const t = daysAgo(ageDays);
      await fs.utimes(path.join(d, 'SKILL.md'), t, t);
    };
    await mkSkill('authored-utilisee', 40);
    await mkSkill('authored-jamais', 40);
    await mkSkill('authored-recente', 3);
    await mkSkill('authored-planifiee', 90);

    const report = await runCuratorScan('/tmp', emptyDeps({
      skillsDir: dir,
      skillActivity: () => new Map([['authored-utilisee', { lastActivityAt: daysAgo(2).toISOString() }]]),
      scheduledSkills: async () => new Set(['authored-planifiee']),
    }));
    const review = report.patches.filter((p) => p.kind === 'REVIEW_SKILL');
    expect(review.map((p) => p.target)).toEqual(['authored-jamais']);
    expect(review[0]!.reason).toContain('jamais utilisée');
    expect(report.sections.find((s) => s.name === 'Skills authored')?.summary).toContain('1 planifiée(s)');
  });

  it('signale l\'instabilité CKG uniquement au-delà du seuil ET du ratio', async () => {
    const calm = await runCuratorScan('/tmp', emptyDeps({
      ckgStats: async () => ({ entities: 100, superseded: 5, relations: 50 }),
    }));
    expect(calm.patches.filter((p) => p.kind === 'REVIEW_CONTRADICTIONS')).toHaveLength(0);

    const unstable = await runCuratorScan('/tmp', emptyDeps({
      ckgStats: async () => ({ entities: 20, superseded: 15, relations: 10 }),
    }));
    expect(unstable.patches.filter((p) => p.kind === 'REVIEW_CONTRADICTIONS')).toHaveLength(1);
  });

  it('propose la revue des leçons pending qui stagnent', async () => {
    const report = await runCuratorScan('/tmp', emptyDeps({
      listPendingLessons: async () => [
        { id: 'l1', createdAt: daysAgo(10).toISOString(), category: 'workflow' },
        { id: 'l2', createdAt: daysAgo(1).toISOString() },
      ],
    }));
    const lessons = report.patches.filter((p) => p.kind === 'REVIEW_LESSON');
    expect(lessons.map((p) => p.target)).toEqual(['l1']);
    expect(lessons[0]!.howToApply).toContain('buddy lessons');
  });

  it('agrège le ledger modèles sur la fenêtre 7j (coûts + échecs)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'curator-ledger-'));
    const ledger = path.join(dir, 'perf.jsonl');
    const lines = [
      JSON.stringify({ at: daysAgo(1).toISOString(), costUsd: 0.5 }),
      JSON.stringify({ at: daysAgo(2).toISOString(), costUsd: 0.25, failed: true }),
      JSON.stringify({ at: daysAgo(30).toISOString(), costUsd: 99 }), // hors fenêtre
      'ligne corrompue{',
    ];
    await fs.writeFile(ledger, lines.join('\n'));

    const report = await runCuratorScan('/tmp', emptyDeps({ modelLedgerPath: ledger }));
    const section = report.sections.find((s) => s.name === 'Modèles (council)');
    expect(section?.summary).toContain('2 run(s)');
    expect(section?.summary).toContain('$0.7500');
    expect(section?.summary).toContain('1 échec(s)');
  });

  it('est fail-open par section : une source qui jette dégrade sans casser', async () => {
    const report = await runCuratorScan('/tmp', emptyDeps({
      ckgStats: async () => {
        throw new Error('ledger corrompu');
      },
    }));
    const ckg = report.sections.find((s) => s.name === 'CKG (mémoire collective)');
    expect(ckg?.ok).toBe(false);
    expect(report.sections).toHaveLength(5);
  });
});

describe('propose-only, rendu et persistance', () => {
  it('applyCuratorPatch refuse TOUJOURS (le refus est du code vivant)', () => {
    expect(() =>
      applyCuratorPatch({
        kind: 'ARCHIVE_MEMORY',
        target: 'x',
        reason: 'r',
        autoAppliable: true,
        howToApply: 'h',
      }),
    ).toThrow(/propose-only/);
  });

  it('rend un markdown avec badges et écrit report JSON + latest.md', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'curator-out-'));
    const report = await runCuratorScan(dir, emptyDeps({
      listPendingLessons: async () => [{ id: 'l1', createdAt: daysAgo(10).toISOString() }],
    }));
    const md = renderCuratorMarkdown(report);
    expect(md).toContain('🔴 `REVIEW_LESSON`');
    expect(md).toContain('AUTO-GÉNÉRÉ');

    const { jsonPath, mdPath } = await saveCuratorReport(report, dir);
    const saved = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
    expect(saved.patches).toHaveLength(1);
    expect(await fs.readFile(mdPath, 'utf-8')).toContain('Rapport Curator');
  });
});
