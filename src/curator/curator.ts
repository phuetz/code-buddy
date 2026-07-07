/**
 * Curator — nightly-style maintenance REPORT over the agent's learnable layer
 * (jarvis-OS Curator, clean-room concepts). Règle non négociable : il PROPOSE,
 * il n'APPLIQUE RIEN. Chaque proposition pointe vers la commande humaine
 * existante ; `applyCuratorPatch()` refuse par principe (le refus est du code
 * vivant, pas une doc).
 *
 * Cinq sections, chacune fail-open (une source cassée dégrade le rapport sans
 * le casser — pattern Command Center) :
 *  1. Mémoire persistante — candidats à l'oubli Ebbinghaus (dry-run pur via
 *     decideForgets ; l'archivage réel reste le job du dreaming opt-in).
 *  2. Skills authored — dormantes (mtime ancien, non épinglées) à réviser.
 *  3. CKG — proportion d'entités supersédées comme proxy d'instabilité.
 *  4. Leçons — candidates `pending` qui stagnent.
 *  5. Modèles — activité/coûts/échecs du ledger council (7 derniers jours).
 *
 * Chemins protégés : seules les skills `authored-*` sont proposables ; la
 * mémoire passe par decideForgets qui exclut déjà preferences/decisions/pinned
 * (re-filtré ici, défense en profondeur).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { decideForgets, resolveForgettingConfig } from '../memory/memory-forgetting.js';
import type { Memory, MemoryScope } from '../memory/persistent-memory.js';
import { isAuthoredSkillName, readPinned } from '../agent/self-improvement/skill-mutator.js';
import { logger } from '../utils/logger.js';

export type CuratorPatchKind =
  | 'ARCHIVE_MEMORY'
  | 'REVIEW_SKILL'
  | 'REVIEW_CONTRADICTIONS'
  | 'REVIEW_LESSON';

export interface CuratorPatch {
  kind: CuratorPatchKind;
  target: string;
  reason: string;
  /** Signal seulement (réversible + à faible risque) — le Curator n'applique JAMAIS. */
  autoAppliable: boolean;
  /** La commande/le chemin humain existant pour agir. */
  howToApply: string;
}

export interface CuratorSection {
  name: string;
  ok: boolean;
  summary: string;
  details?: string[];
}

export interface CuratorReport {
  generatedAt: string;
  cwd: string;
  sections: CuratorSection[];
  patches: CuratorPatch[];
  notes: string[];
}

/** Seam d'injection pour les tests — chaque source est optionnelle. */
export interface CuratorDeps {
  now?: Date;
  /** Énumération mémoire par scope (défaut : getMemoryManager initialisé). */
  listMemories?: (scope: MemoryScope) => Promise<Memory[]>;
  /** Répertoire des skills du projet (défaut : <cwd>/.codebuddy/skills). */
  skillsDir?: string;
  /** Stats CKG (défaut : getCollectiveKnowledgeGraph().getStats()). */
  ckgStats?: () => Promise<{ entities: number; superseded: number; relations: number }>;
  /** Leçons candidates pending (défaut : getLessonCandidateQueue(cwd)). */
  listPendingLessons?: () => Promise<Array<{ id: string; createdAt: string; category?: string }>>;
  /** Ledger de performance modèles (défaut : ~/.codebuddy/fleet-model-performance.jsonl). */
  modelLedgerPath?: string;
}

const STALE_SKILL_DAYS = 30;
const STALE_LESSON_DAYS = 7;
const MAX_INDIVIDUAL_LESSON_PATCHES = 5;
const CKG_SUPERSEDED_REVIEW_MIN = 10;
const CKG_SUPERSEDED_REVIEW_RATIO = 0.25;
const MODEL_LEDGER_WINDOW_DAYS = 7;
const MAX_MEMORY_PATCHES = 20;
const PROTECTED_MEMORY_CATEGORIES = new Set(['preferences', 'decisions']);
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Sections ────────────────────────────────────────────────────────────

async function scanMemory(deps: CuratorDeps, now: Date): Promise<{ section: CuratorSection; patches: CuratorPatch[] }> {
  const listMemories =
    deps.listMemories ??
    (async (scope: MemoryScope) => {
      const { getMemoryManager } = await import('../memory/persistent-memory.js');
      const manager = getMemoryManager();
      await manager.initialize();
      return manager.listMemories(scope);
    });

  const config = resolveForgettingConfig();
  const patches: CuratorPatch[] = [];
  let total = 0;
  for (const scope of ['project', 'user'] as MemoryScope[]) {
    const memories = await listMemories(scope);
    total += memories.length;
    const candidates = decideForgets(memories, now, config);
    for (const c of candidates) {
      // decideForgets exclut déjà les catégories/tags protégés — re-filtre
      // par défense en profondeur (un patch mémoire protégé ne sort JAMAIS).
      if (PROTECTED_MEMORY_CATEGORIES.has(c.category)) continue;
      patches.push({
        kind: 'ARCHIVE_MEMORY',
        target: `${scope}:${c.key}`,
        reason: `rétention ${c.retention.toFixed(3)} (âge ${Math.round(c.ageDays)}j, rappelée ${c.accessCount}×)`,
        autoAppliable: true, // réversible : archive *.archive.md + /memory restore
        howToApply:
          'CODEBUDDY_MEMORY_FORGET=true (le prochain dreaming archive, restaurable via /memory restore)',
      });
    }
  }
  const proposed = patches.slice(0, MAX_MEMORY_PATCHES);
  return {
    section: {
      name: 'Mémoire persistante',
      ok: true,
      summary: `${total} souvenirs vivants, ${patches.length} candidat(s) à l'oubli (rétention < ${config.retentionThreshold})`,
      ...(patches.length > MAX_MEMORY_PATCHES
        ? { details: [`${patches.length - MAX_MEMORY_PATCHES} candidats supplémentaires tronqués du rapport`] }
        : {}),
    },
    patches: proposed,
  };
}

async function scanAuthoredSkills(deps: CuratorDeps, cwd: string, now: Date): Promise<{ section: CuratorSection; patches: CuratorPatch[] }> {
  const skillsDir = deps.skillsDir ?? path.join(cwd, '.codebuddy', 'skills');
  const patches: CuratorPatch[] = [];
  let authored = 0;
  let pinned = 0;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(skillsDir);
  } catch {
    return {
      section: { name: 'Skills authored', ok: true, summary: 'aucun répertoire de skills (rien à curer)' },
      patches: [],
    };
  }
  for (const entry of entries) {
    // Chemins protégés : seules les skills authored-* sont curables.
    if (!isAuthoredSkillName(entry)) continue;
    const skillMd = path.join(skillsDir, entry, 'SKILL.md');
    try {
      const [stat, content] = await Promise.all([fs.stat(skillMd), fs.readFile(skillMd, 'utf-8')]);
      authored++;
      if (readPinned(content)) {
        pinned++;
        continue; // une skill épinglée n'est jamais proposée
      }
      const ageDays = (now.getTime() - stat.mtime.getTime()) / DAY_MS;
      if (ageDays >= STALE_SKILL_DAYS) {
        patches.push({
          kind: 'REVIEW_SKILL',
          target: entry,
          reason: `non modifiée depuis ${Math.round(ageDays)}j et non épinglée`,
          autoAppliable: false, // juger l'utilité d'une skill = décision humaine
          howToApply: `buddy improve skills-pin ${entry} (garder) ou buddy improve skills-consolidate (fusionner/archiver)`,
        });
      }
    } catch {
      continue; // dossier sans SKILL.md lisible — pas notre affaire
    }
  }
  return {
    section: {
      name: 'Skills authored',
      ok: true,
      summary: `${authored} authored (${pinned} épinglée(s)), ${patches.length} dormante(s) ≥ ${STALE_SKILL_DAYS}j à réviser`,
    },
    patches,
  };
}

async function scanCkg(deps: CuratorDeps): Promise<{ section: CuratorSection; patches: CuratorPatch[] }> {
  const getStats =
    deps.ckgStats ??
    (async () => {
      const { getCollectiveKnowledgeGraph } = await import('../memory/collective-knowledge-graph.js');
      return getCollectiveKnowledgeGraph().getStats();
    });
  const stats = await getStats();
  const ratio = stats.entities > 0 ? stats.superseded / (stats.entities + stats.superseded) : 0;
  const patches: CuratorPatch[] = [];
  if (stats.superseded >= CKG_SUPERSEDED_REVIEW_MIN && ratio >= CKG_SUPERSEDED_REVIEW_RATIO) {
    // Proxy jarvis-OS : beaucoup de supersessions = un sujet qui change vite
    // OU un extracteur instable qui réécrit les mêmes faits — à l'œil humain.
    patches.push({
      kind: 'REVIEW_CONTRADICTIONS',
      target: 'ckg-ledger',
      reason: `${stats.superseded} entités supersédées (${(ratio * 100).toFixed(0)}% du graphe) — possible instabilité d'extraction`,
      autoAppliable: false,
      howToApply: 'buddy research stats puis inspection des faits supersédés récents',
    });
  }
  return {
    section: {
      name: 'CKG (mémoire collective)',
      ok: true,
      summary: `${stats.entities} entités, ${stats.relations} relations, ${stats.superseded} supersédées (${(ratio * 100).toFixed(0)}%)`,
    },
    patches,
  };
}

async function scanLessons(deps: CuratorDeps, cwd: string, now: Date): Promise<{ section: CuratorSection; patches: CuratorPatch[] }> {
  const listPending =
    deps.listPendingLessons ??
    (async () => {
      const { getLessonCandidateQueue } = await import('../agent/lesson-candidate-queue.js');
      return getLessonCandidateQueue(cwd)
        .list('pending')
        .map((c) => ({ id: c.id, createdAt: c.createdAt, category: c.category }));
    });
  const pending = await listPending();
  const stale: Array<{ id: string; ageDays: number; category?: string }> = [];
  for (const lesson of pending) {
    const ageDays = (now.getTime() - new Date(lesson.createdAt).getTime()) / DAY_MS;
    if (Number.isFinite(ageDays) && ageDays >= STALE_LESSON_DAYS) {
      stale.push({ id: lesson.id, ageDays, ...(lesson.category ? { category: lesson.category } : {}) });
    }
  }
  // Au-delà de quelques items, un patch par leçon noie le rapport (vérifié
  // live : 28 lignes identiques) — on agrège en une seule proposition.
  const patches: CuratorPatch[] =
    stale.length > MAX_INDIVIDUAL_LESSON_PATCHES
      ? [
          {
            kind: 'REVIEW_LESSON',
            target: `${stale.length} candidates`,
            reason: `${stale.length} candidates en attente ≥ ${STALE_LESSON_DAYS}j (la plus ancienne : ${Math.round(Math.max(...stale.map((s) => s.ageDays)))}j)`,
            autoAppliable: false, // approuver une leçon = la SEULE écriture, humaine
            howToApply: 'buddy lessons (approuver ou rejeter les candidates en lot)',
          },
        ]
      : stale.map((s) => ({
          kind: 'REVIEW_LESSON' as const,
          target: s.id,
          reason: `candidate en attente depuis ${Math.round(s.ageDays)}j${s.category ? ` (${s.category})` : ''}`,
          autoAppliable: false, // approuver une leçon = la SEULE écriture, humaine
          howToApply: 'buddy lessons (approuver ou rejeter la candidate)',
        }));
  return {
    section: {
      name: 'Leçons',
      ok: true,
      summary: `${pending.length} candidate(s) pending, ${stale.length} qui stagnent ≥ ${STALE_LESSON_DAYS}j`,
    },
    patches,
  };
}

async function scanModelLedger(deps: CuratorDeps, now: Date): Promise<{ section: CuratorSection; patches: CuratorPatch[] }> {
  const ledgerPath =
    deps.modelLedgerPath ?? path.join(os.homedir(), '.codebuddy', 'fleet-model-performance.jsonl');
  let raw = '';
  try {
    raw = await fs.readFile(ledgerPath, 'utf-8');
  } catch {
    return {
      section: { name: 'Modèles (council)', ok: true, summary: 'pas de ledger de performance (rien à agréger)' },
      patches: [],
    };
  }
  const cutoff = now.getTime() - MODEL_LEDGER_WINDOW_DAYS * DAY_MS;
  let runs = 0;
  let cost = 0;
  let failures = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { at?: string; costUsd?: number; failed?: boolean };
      if (!entry.at || new Date(entry.at).getTime() < cutoff) continue;
      runs++;
      cost += typeof entry.costUsd === 'number' ? entry.costUsd : 0;
      if (entry.failed) failures++;
    } catch {
      continue; // ligne corrompue — on agrège ce qui se lit
    }
  }
  return {
    section: {
      name: 'Modèles (council)',
      ok: true,
      summary: `${runs} run(s) sur ${MODEL_LEDGER_WINDOW_DAYS}j, $${cost.toFixed(4)}, ${failures} échec(s) de fan-out`,
    },
    patches: [],
  };
}

// ── API publique ────────────────────────────────────────────────────────

export async function runCuratorScan(cwd: string = process.cwd(), deps: CuratorDeps = {}): Promise<CuratorReport> {
  const now = deps.now ?? new Date();
  const sections: CuratorSection[] = [];
  const patches: CuratorPatch[] = [];
  const notes: string[] = [];

  const scans: Array<[string, () => Promise<{ section: CuratorSection; patches: CuratorPatch[] }>]> = [
    ['Mémoire persistante', () => scanMemory(deps, now)],
    ['Skills authored', () => scanAuthoredSkills(deps, cwd, now)],
    ['CKG (mémoire collective)', () => scanCkg(deps)],
    ['Leçons', () => scanLessons(deps, cwd, now)],
    ['Modèles (council)', () => scanModelLedger(deps, now)],
  ];

  for (const [name, scan] of scans) {
    try {
      const result = await scan();
      sections.push(result.section);
      patches.push(...result.patches);
    } catch (error) {
      // Fail-open par section : une source cassée dégrade, ne casse pas.
      sections.push({ name, ok: false, summary: `indisponible (${String(error).slice(0, 120)})` });
      logger.debug('curator section failed (fail-open)', { name, error: String(error) });
    }
  }

  notes.push(
    'Le Curator PROPOSE et n\'applique rien : chaque patch pointe vers la commande humaine existante.',
  );
  return { generatedAt: now.toISOString(), cwd, sections, patches, notes };
}

/**
 * Le refus matérialisé en code vivant (pattern jarvis-OS « apply ⇒ 403 ») :
 * tout chemin futur qui tenterait d'auto-appliquer un patch du Curator doit
 * passer par ici — et ici, c'est non.
 */
export function applyCuratorPatch(patch: CuratorPatch): never {
  throw new Error(
    `Curator est propose-only : le patch ${patch.kind}(${patch.target}) ne peut pas être auto-appliqué. ` +
      `Chemin humain : ${patch.howToApply}`,
  );
}

export function renderCuratorMarkdown(report: CuratorReport): string {
  const lines: string[] = [
    '<!-- AUTO-GÉNÉRÉ par `buddy curator scan` — NE PAS ÉDITER (régénéré à chaque scan) -->',
    `# Rapport Curator — ${report.generatedAt}`,
    '',
    `Projet : \`${report.cwd}\``,
    '',
    '## État',
    '',
  ];
  for (const s of report.sections) {
    lines.push(`- ${s.ok ? '✅' : '⚠️'} **${s.name}** — ${s.summary}`);
    for (const d of s.details ?? []) lines.push(`  - ${d}`);
  }
  lines.push('', `## Propositions (${report.patches.length}) — validation humaine requise`, '');
  if (report.patches.length === 0) {
    lines.push('Rien à proposer : la couche apprenante est saine.');
  }
  for (const p of report.patches) {
    lines.push(
      `- ${p.autoAppliable ? '🟢' : '🔴'} \`${p.kind}\` **${p.target}** — ${p.reason}`,
      `  - agir : ${p.howToApply}`,
    );
  }
  lines.push('', ...report.notes.map((n) => `> ${n}`), '');
  return lines.join('\n');
}

/** Persiste le rapport : JSON horodaté + latest.md (miroir humain écrasé). */
export async function saveCuratorReport(
  report: CuratorReport,
  cwd: string = report.cwd,
): Promise<{ jsonPath: string; mdPath: string }> {
  const dir = path.join(cwd, '.codebuddy', 'curator');
  await fs.mkdir(dir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = path.join(dir, `report-${stamp}.json`);
  const mdPath = path.join(dir, 'latest.md');
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  await fs.writeFile(mdPath, renderCuratorMarkdown(report), 'utf-8');
  return { jsonPath, mdPath };
}
