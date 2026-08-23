/**
 * Pure aggregation + presentation for `buddy improve digest`.
 *
 * I/O deliberately lives in `digest-sources.ts`: callers inject archive,
 * learning-store and benchmark snapshots here, which keeps period filtering,
 * de-duplication and score-delta semantics deterministic in tests.
 *
 * @module agent/self-improvement/digest
 */

import { scrubSecrets } from '../../security/secret-scrubber.js';

export const IMPROVEMENT_DIGEST_SCHEMA_VERSION = 1;
export const DEFAULT_IMPROVEMENT_DIGEST_SINCE = '7d';

export type DigestArchiveMode = 'accepted-only' | 'all-cycles';

/** The current archive shape plus optional fields understood from richer ledgers. */
export interface DigestArchiveRecord {
  createdAt?: string;
  startedAt?: string;
  proposalId?: string;
  cycleId?: string;
  kind?: string;
  targetScenarioId?: string;
  appliedRef?: string;
  absorbedInto?: string;
  /** Current archive entries omit this because every entry is accepted. */
  accepted?: boolean;
  rejectionReason?: string;
  gate?: {
    accepted?: boolean;
    rejectionReason?: string;
  } | null;
}

export interface DigestLessonSnapshot {
  id?: string;
  category?: string;
  content: string;
  context?: string;
}

/** One git-versioned learning-store snapshot, normalised by the I/O adapter. */
export interface DigestLearningStoreVersion {
  id: string;
  createdAt: string;
  reason?: string;
  scenarioId?: string;
  delta?: number;
  score?: number | null;
  lessons?: readonly DigestLessonSnapshot[];
}

/** Per-scenario or already-aggregated benchmark observation. */
export interface DigestBenchmarkRecord {
  runId?: string;
  model: string;
  score: number;
  ts: string;
  scenario?: string;
  source?: string;
}

export type DigestArtifactKind = 'tool' | 'authored-skill' | 'imported-skill';

/** Filesystem fallback for artifacts whose archive does not carry a timestamp. */
export interface DigestArtifactRecord {
  name: string;
  kind: DigestArtifactKind;
  createdAt: string;
  estimated?: boolean;
}

export interface ImprovementDigestSources {
  archive?: readonly DigestArchiveRecord[];
  /** `accepted-only` is the truthful mode of archive.json schema v1. */
  archiveMode?: DigestArchiveMode;
  learningStore?: readonly DigestLearningStoreVersion[];
  benchmark?: readonly DigestBenchmarkRecord[];
  artifacts?: readonly DigestArtifactRecord[];
  /** Current lessons only enrich archive references; they are never counted alone. */
  currentLessons?: readonly DigestLessonSnapshot[];
}

export interface ImprovementDigestOptions {
  since: Date;
  until: Date;
}

export interface DigestNamedItems {
  count: number;
  names: string[];
}

export interface DigestLessonItem {
  id?: string;
  category?: string;
  content: string;
  learnedAt: string;
}

export interface DigestBenchmarkModel {
  model: string;
  source: string;
  runs: number;
  startScore: number;
  endScore: number;
  /** Ratio delta (0.2 = +20 percentage points), null with only one observation. */
  delta: number | null;
  deltaPercentPoints: number | null;
}

export interface ImprovementDigest {
  schemaVersion: typeof IMPROVEMENT_DIGEST_SCHEMA_VERSION;
  kind: 'self_improvement_digest';
  generatedAt: string;
  period: {
    since: string;
    until: string;
  };
  hasActivity: boolean;
  tools: DigestNamedItems;
  skills: {
    authored: DigestNamedItems;
    imported: DigestNamedItems;
    total: number;
  };
  lessons: {
    count: number;
    items: DigestLessonItem[];
  };
  benchmark: {
    available: boolean;
    primaryModel: string | null;
    runs: number;
    startScore: number | null;
    endScore: number | null;
    delta: number | null;
    deltaPercentPoints: number | null;
    models: DigestBenchmarkModel[];
  };
  cycles: {
    launched: number;
    complete: boolean;
  };
  gates: {
    passed: number;
    rejected: number;
    complete: boolean;
    rejectionReasons: Array<{ reason: string; count: number }>;
  };
  learningStoreVersions: number;
  sources: {
    archive: boolean;
    learningStore: boolean;
    benchmark: boolean;
  };
  notes: string[];
}

interface AggregateRun {
  model: string;
  source: string;
  ts: number;
  score: number;
}

const DURATION_MS: Record<string, number> = {
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
  w: 7 * 24 * 60 * 60_000,
};

function dateMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inPeriod(value: string | undefined, sinceMs: number, untilMs: number): boolean {
  const parsed = dateMs(value);
  return parsed !== null && parsed >= sinceMs && parsed <= untilMs;
}

function recordDate(record: DigestArchiveRecord): string | undefined {
  return record.startedAt ?? record.createdAt;
}

function archiveAccepted(record: DigestArchiveRecord): boolean {
  return record.gate?.accepted ?? record.accepted ?? archiveRejectionReason(record) === undefined;
}

function archiveRejectionReason(record: DigestArchiveRecord): string | undefined {
  return record.gate?.rejectionReason ?? record.rejectionReason;
}

function safeText(value: string, maxLength = 220): string {
  const compact = scrubSecrets(value).replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function safeName(value: string): string {
  return safeText(value, 120) || 'sans nom';
}

function lessonFingerprint(lesson: DigestLessonSnapshot): string {
  return [lesson.category ?? '', lesson.content.trim(), lesson.context?.trim() ?? ''].join(
    '\u0000'
  );
}

function sortNames(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function looksLikeImprovementVersion(version: DigestLearningStoreVersion): boolean {
  return (
    version.scenarioId !== undefined ||
    version.delta !== undefined ||
    /(?:^|\b)improve(?:ment)?(?:\b|[(:])/i.test(version.reason ?? '')
  );
}

function aggregateBenchmarkRecords(records: readonly DigestBenchmarkRecord[]): AggregateRun[] {
  const groups = new Map<string, DigestBenchmarkRecord[]>();
  records.forEach((record, index) => {
    if (!Number.isFinite(record.score) || dateMs(record.ts) === null || !record.model.trim())
      return;
    const source = record.source?.trim() || 'continuous';
    const runId = record.runId?.trim() || `${record.ts}:${record.scenario ?? index}`;
    const key = `${source}\u0000${record.model}\u0000${runId}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  });

  return Array.from(groups.values())
    .map((group) => {
      const first = group[0]!;
      const timestamps = group.map((record) => dateMs(record.ts)!).filter(Number.isFinite);
      return {
        model: safeName(first.model),
        source: safeName(first.source?.trim() || 'continuous'),
        ts: Math.max(...timestamps),
        score: group.reduce((sum, record) => sum + record.score, 0) / group.length,
      };
    })
    .sort((a, b) => a.ts - b.ts || a.model.localeCompare(b.model));
}

function buildBenchmark(
  sources: ImprovementDigestSources,
  learningVersions: readonly DigestLearningStoreVersion[],
  sinceMs: number,
  untilMs: number
): ImprovementDigest['benchmark'] {
  const records: DigestBenchmarkRecord[] = [...(sources.benchmark ?? [])];
  for (const version of learningVersions) {
    if (typeof version.score !== 'number' || !Number.isFinite(version.score)) continue;
    records.push({
      runId: version.id,
      model: 'couche-apprenable',
      source: 'learning-store',
      score: version.score,
      ts: version.createdAt,
    });
  }

  const bySeries = new Map<string, AggregateRun[]>();
  for (const run of aggregateBenchmarkRecords(records)) {
    const key = `${run.source}\u0000${run.model}`;
    const series = bySeries.get(key) ?? [];
    series.push(run);
    bySeries.set(key, series);
  }

  const models: DigestBenchmarkModel[] = [];
  for (const series of bySeries.values()) {
    const periodRuns = series.filter((run) => run.ts >= sinceMs && run.ts <= untilMs);
    if (periodRuns.length === 0) continue;
    const before = series.filter((run) => run.ts < sinceMs).at(-1);
    const first = before ?? periodRuns[0]!;
    const last = periodRuns.at(-1)!;
    const comparable = before !== undefined || periodRuns.length >= 2;
    const delta = comparable ? last.score - first.score : null;
    models.push({
      model: first.model,
      source: first.source,
      runs: periodRuns.length,
      startScore: first.score,
      endScore: last.score,
      delta,
      deltaPercentPoints: delta === null ? null : delta * 100,
    });
  }
  models.sort((a, b) => {
    const comparableOrder = Number(b.delta !== null) - Number(a.delta !== null);
    if (comparableOrder !== 0) return comparableOrder;
    const learningOrder =
      Number(b.source === 'learning-store') - Number(a.source === 'learning-store');
    return learningOrder || a.model.localeCompare(b.model);
  });
  const primary = models[0];

  return {
    available: primary !== undefined,
    primaryModel: primary?.model ?? null,
    runs: models.reduce((sum, model) => sum + model.runs, 0),
    startScore: primary?.startScore ?? null,
    endScore: primary?.endScore ?? null,
    delta: primary?.delta ?? null,
    deltaPercentPoints: primary?.deltaPercentPoints ?? null,
    models,
  };
}

/**
 * Parse a relative duration (`7d`, `24h`, `2w`, `30m`) or an absolute ISO date.
 * The clock is injected so tests and callers get a stable period boundary.
 */
export function parseDigestSince(value: string | undefined, now: Date): Date {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('La date courante du digest est invalide.');
  const raw = (value ?? DEFAULT_IMPROVEMENT_DIGEST_SINCE).trim();
  const duration = raw.match(/^(\d+(?:\.\d+)?)([mhdw])$/i);
  if (duration) {
    const amount = Number(duration[1]);
    const unitMs = DURATION_MS[duration[2]!.toLowerCase()];
    if (!Number.isFinite(amount) || amount <= 0 || unitMs === undefined) {
      throw new Error(`Période invalide : "${raw}".`);
    }
    return new Date(nowMs - amount * unitMs);
  }

  const absolute = Date.parse(raw);
  if (!Number.isFinite(absolute) || absolute > nowMs) {
    throw new Error(
      `Période invalide : "${raw}". Utilisez par exemple 7d, 24h, 2w ou une date ISO passée.`
    );
  }
  return new Date(absolute);
}

/** Aggregate injected sources over one inclusive period. */
export function buildImprovementDigest(
  sources: ImprovementDigestSources,
  options: ImprovementDigestOptions
): ImprovementDigest {
  const sinceMs = options.since.getTime();
  const untilMs = options.until.getTime();
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || sinceMs > untilMs) {
    throw new Error('Invalid self-improvement digest period.');
  }

  const archiveMode = sources.archiveMode ?? 'accepted-only';
  const allArchive = sources.archive ?? [];
  const archive = allArchive.filter((record) => inPeriod(recordDate(record), sinceMs, untilMs));
  const knownArchiveNames = {
    tools: new Set(
      allArchive
        .filter((record) => archiveAccepted(record) && record.kind === 'tool' && record.appliedRef)
        .map((record) => safeName(record.appliedRef!))
    ),
    skills: new Set(
      allArchive
        .filter((record) => archiveAccepted(record) && record.kind === 'skill' && record.appliedRef)
        .map((record) => safeName(record.appliedRef!))
    ),
  };

  const gateGroups = new Map<string, { accepted: boolean; rejectionReason?: string }>();
  archive.forEach((record, index) => {
    const id = record.cycleId ?? record.proposalId ?? `${recordDate(record) ?? 'unknown'}:${index}`;
    const accepted = archiveAccepted(record);
    const rejectionReason = archiveRejectionReason(record);
    const existing = gateGroups.get(id);
    gateGroups.set(id, {
      accepted: existing ? existing.accepted && accepted : accepted,
      ...(rejectionReason
        ? { rejectionReason: safeText(rejectionReason, 100) }
        : existing?.rejectionReason
          ? { rejectionReason: existing.rejectionReason }
          : {}),
    });
  });

  const toolNames = new Set<string>();
  const authoredSkillNames = new Set<string>();
  const importedSkillNames = new Set<string>();
  for (const record of archive) {
    if (!archiveAccepted(record)) continue;
    const label = safeName(
      record.appliedRef ?? record.proposalId ?? record.targetScenarioId ?? 'sans nom'
    );
    if (record.kind === 'tool') toolNames.add(label);
    if (record.kind === 'skill') authoredSkillNames.add(label);
  }

  let usedEstimatedArtifactDate = false;
  for (const artifact of sources.artifacts ?? []) {
    if (!inPeriod(artifact.createdAt, sinceMs, untilMs)) continue;
    const name = safeName(artifact.name);
    let contributed = false;
    if (artifact.kind === 'tool' && !knownArchiveNames.tools.has(name)) {
      toolNames.add(name);
      contributed = true;
    }
    if (artifact.kind === 'authored-skill' && !knownArchiveNames.skills.has(name)) {
      authoredSkillNames.add(name);
      contributed = true;
    }
    if (artifact.kind === 'imported-skill') {
      importedSkillNames.add(name);
      contributed = true;
    }
    usedEstimatedArtifactDate ||= contributed && artifact.estimated === true;
  }

  const learningVersions = [...(sources.learningStore ?? [])]
    .filter((version) => dateMs(version.createdAt) !== null)
    .sort((a, b) => dateMs(a.createdAt)! - dateMs(b.createdAt)! || a.id.localeCompare(b.id));
  const periodLearningVersions = learningVersions.filter((version) =>
    inPeriod(version.createdAt, sinceMs, untilMs)
  );
  const seenLessons = new Set<string>();
  const learned = new Map<string, DigestLessonItem>();
  for (const version of learningVersions) {
    const timestamp = dateMs(version.createdAt)!;
    if (timestamp > untilMs) break;
    for (const lesson of version.lessons ?? []) {
      if (!lesson.content.trim()) continue;
      const fingerprint = lessonFingerprint(lesson);
      if (timestamp >= sinceMs && !seenLessons.has(fingerprint)) {
        learned.set(fingerprint, {
          ...(lesson.id ? { id: safeName(lesson.id) } : {}),
          ...(lesson.category ? { category: safeName(lesson.category) } : {}),
          content: safeText(lesson.content),
          learnedAt: version.createdAt,
        });
      }
      seenLessons.add(fingerprint);
    }
  }

  // A kept --no-commit cycle is present in archive.json but not in the git
  // store. Use the current tracker only to resolve that archive reference.
  const currentById = new Map(
    (sources.currentLessons ?? [])
      .filter((lesson) => lesson.id)
      .map((lesson) => [lesson.id!, lesson] as const)
  );
  for (const record of archive) {
    if (record.kind !== 'lesson' || !archiveAccepted(record)) continue;
    const current = record.appliedRef ? currentById.get(record.appliedRef) : undefined;
    // When version snapshots already supplied lesson content, only a matching
    // live reference proves this is an additional --no-commit lesson. With no
    // snapshot additions, the archive's scenario is still a useful fallback.
    if (!current && learned.size > 0) continue;
    const content =
      current?.content ?? record.targetScenarioId ?? record.appliedRef ?? record.proposalId;
    if (!content) continue;
    const item: DigestLessonSnapshot = current ?? { content };
    const fingerprint = lessonFingerprint(item);
    learned.set(fingerprint, {
      ...(current?.id ? { id: safeName(current.id) } : {}),
      ...(current?.category ? { category: safeName(current.category) } : {}),
      content: safeText(content),
      learnedAt: recordDate(record)!,
    });
  }

  const archivePassed = Array.from(gateGroups.values()).filter((gate) => gate.accepted).length;
  const archiveRejected = gateGroups.size - archivePassed;
  const learningCycles = periodLearningVersions.filter(looksLikeImprovementVersion).length;
  const complete = archiveMode === 'all-cycles';
  const launched = complete ? gateGroups.size : Math.max(gateGroups.size, learningCycles);
  const passed = complete ? archivePassed : Math.max(archivePassed, learningCycles);
  const rejectionCounts = new Map<string, number>();
  for (const gate of gateGroups.values()) {
    if (gate.accepted) continue;
    const reason = gate.rejectionReason ?? 'raison non précisée';
    rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
  }

  const benchmark = buildBenchmark(sources, learningVersions, sinceMs, untilMs);
  const tools = { count: toolNames.size, names: sortNames(toolNames) };
  const authored = { count: authoredSkillNames.size, names: sortNames(authoredSkillNames) };
  const imported = { count: importedSkillNames.size, names: sortNames(importedSkillNames) };
  const lessonItems = Array.from(learned.values()).sort(
    (a, b) => a.learnedAt.localeCompare(b.learnedAt) || a.content.localeCompare(b.content)
  );
  const hasActivity =
    tools.count > 0 ||
    authored.count > 0 ||
    imported.count > 0 ||
    lessonItems.length > 0 ||
    launched > 0 ||
    benchmark.available ||
    periodLearningVersions.length > 0;
  const notes: string[] = [];
  if (!complete && launched > 0) {
    notes.push(
      'archive v1 partielle : elle historise les améliorations appliquées, pas les cycles sans application ni tous les rejets ; les comptes de cycles et de gates sont donc des minima observés'
    );
  }
  if (usedEstimatedArtifactDate) {
    notes.push(
      "la date des artifacts absents de l'archive provient des métadonnées du fichier et peut être approximative"
    );
  }

  return {
    schemaVersion: IMPROVEMENT_DIGEST_SCHEMA_VERSION,
    kind: 'self_improvement_digest',
    generatedAt: options.until.toISOString(),
    period: {
      since: options.since.toISOString(),
      until: options.until.toISOString(),
    },
    hasActivity,
    tools,
    skills: { authored, imported, total: authored.count + imported.count },
    lessons: { count: lessonItems.length, items: lessonItems },
    benchmark,
    cycles: { launched, complete },
    gates: {
      passed,
      rejected: archiveRejected,
      complete,
      rejectionReasons: Array.from(rejectionCounts, ([reason, count]) => ({ reason, count })).sort(
        (a, b) => b.count - a.count || a.reason.localeCompare(b.reason)
      ),
    },
    learningStoreVersions: periodLearningVersions.length,
    sources: {
      archive: sources.archive !== undefined,
      learningStore: sources.learningStore !== undefined,
      benchmark:
        sources.benchmark !== undefined ||
        learningVersions.some((version) => version.score !== null && version.score !== undefined),
    },
    notes,
  };
}

function markdownCode(value: string): string {
  return `\`${value.replace(/`/g, "'")}\``;
}

function formatDate(value: string): string {
  return value.slice(0, 10);
}

function formatScore(value: number): string {
  return `${(value * 100).toFixed(1).replace(/\.0$/, '')} %`;
}

function formatDelta(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1).replace(/\.0$/, '')} points`;
}

function namesOrNone(items: DigestNamedItems): string {
  return items.names.length > 0 ? items.names.map(markdownCode).join(', ') : 'aucun';
}

function digestNarrative(digest: ImprovementDigest): string {
  const skillCount = digest.skills.total;
  const gateQualifier = digest.gates.complete ? '' : 'au moins ';
  const benchmark =
    digest.benchmark.deltaPercentPoints === null
      ? ''
      : ` Le benchmark a ${digest.benchmark.deltaPercentPoints >= 0 ? 'gagné' : 'perdu'} ${Math.abs(digest.benchmark.deltaPercentPoints).toFixed(1).replace(/\.0$/, '')} points.`;
  return (
    `Sur cette période, l’agent a écrit ${digest.tools.count} tool${digest.tools.count === 1 ? '' : 's'}, ` +
    `ajouté ${skillCount} skill${skillCount === 1 ? '' : 's'} et appris ${digest.lessons.count} leçon${digest.lessons.count === 1 ? '' : 's'}.` +
    `${benchmark} ${gateQualifier}${digest.gates.passed} gate${digest.gates.passed === 1 ? '' : 's'} passée${digest.gates.passed === 1 ? '' : 's'}, ${digest.gates.rejected} rejetée${digest.gates.rejected === 1 ? '' : 's'} observée${digest.gates.rejected === 1 ? '' : 's'}.`
  );
}

/** Human-readable Markdown is the default CLI presentation. */
export function renderImprovementDigestMarkdown(digest: ImprovementDigest): string {
  const period = `${formatDate(digest.period.since)} → ${formatDate(digest.period.until)}`;
  const partial = digest.cycles.complete ? '' : ' (minimum observé)';
  const lines = ['# Digest d’auto-amélioration', '', `_Période : ${period}_`, ''];

  if (!digest.hasActivity) {
    lines.push(
      '> Rien à rapporter sur cette période. Le self-improvement ne laisse encore aucune activité lisible dans les sources disponibles.',
      '',
      `Sources : archive ${digest.sources.archive ? 'disponible' : 'absente'} · learning-store ${digest.sources.learningStore ? 'disponible' : 'absent'} · benchmark ${digest.sources.benchmark ? 'disponible' : 'absent'}.`
    );
    return lines.join('\n');
  }

  lines.push(
    digestNarrative(digest),
    '',
    '## Cette période',
    '',
    `- **Tools écrits : ${digest.tools.count}** — ${namesOrNone(digest.tools)}`,
    `- **Skills authored : ${digest.skills.authored.count}** — ${namesOrNone(digest.skills.authored)}`,
    `- **Skills importées : ${digest.skills.imported.count}** — ${namesOrNone(digest.skills.imported)}`,
    `- **Leçons apprises : ${digest.lessons.count}**`,
    `- **Cycles lancés : ${digest.cycles.launched}${partial}**`,
    `- **Gates : ${digest.gates.passed} passée${digest.gates.passed === 1 ? '' : 's'} · ${digest.gates.rejected} rejetée${digest.gates.rejected === 1 ? '' : 's'}${digest.gates.complete ? '' : ' (historique partiel)'}`
  );

  if (!digest.benchmark.available) {
    lines.push('- **Benchmark :** aucune mesure sur la période');
  } else if (digest.benchmark.deltaPercentPoints === null) {
    lines.push(
      `- **Benchmark :** dernier score ${formatScore(digest.benchmark.endScore!)} (${markdownCode(digest.benchmark.primaryModel!)}), delta indisponible avec une seule mesure`
    );
  } else {
    lines.push(
      `- **Benchmark :** ${formatScore(digest.benchmark.startScore!)} → ${formatScore(digest.benchmark.endScore!)} (**${formatDelta(digest.benchmark.deltaPercentPoints)}**, ${markdownCode(digest.benchmark.primaryModel!)})`
    );
  }

  if (digest.lessons.items.length > 0) {
    lines.push('', '## Leçons apprises', '');
    for (const lesson of digest.lessons.items) {
      const category = lesson.category ? `**[${lesson.category}]** ` : '';
      lines.push(`- ${category}${lesson.content}`);
    }
  }

  if (digest.benchmark.models.length > 1) {
    lines.push('', '## Benchmarks par modèle', '');
    for (const model of digest.benchmark.models) {
      const evolution =
        model.deltaPercentPoints === null
          ? `${formatScore(model.endScore)} · delta indisponible`
          : `${formatScore(model.startScore)} → ${formatScore(model.endScore)} (${formatDelta(model.deltaPercentPoints)})`;
      lines.push(
        `- ${markdownCode(model.model)} : ${evolution} · ${model.runs} run${model.runs === 1 ? '' : 's'}`
      );
    }
  }

  if (digest.notes.length > 0) {
    lines.push('', '## Limites des données', '');
    for (const note of digest.notes) lines.push(`- ${note}`);
  }

  return lines.join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHtmlNames(items: DigestNamedItems): string {
  if (items.names.length === 0) return '<span class="muted">Aucun</span>';
  return `<ul>${items.names.map((name) => `<li><code>${escapeHtml(name)}</code></li>`).join('')}</ul>`;
}

/** Static, CSP-locked, single-file HTML card: no scripts, fonts, images or CDN. */
export function renderImprovementDigestHtml(digest: ImprovementDigest): string {
  const benchmarkValue = !digest.benchmark.available
    ? '—'
    : digest.benchmark.deltaPercentPoints === null
      ? formatScore(digest.benchmark.endScore!)
      : formatDelta(digest.benchmark.deltaPercentPoints);
  const benchmarkDetail = !digest.benchmark.available
    ? 'Aucune mesure sur la période'
    : digest.benchmark.deltaPercentPoints === null
      ? 'Une seule mesure, delta indisponible'
      : `${formatScore(digest.benchmark.startScore!)} → ${formatScore(digest.benchmark.endScore!)}`;
  const empty = digest.hasActivity
    ? ''
    : '<section class="empty"><strong>Rien à rapporter</strong><p>Le self-improvement ne laisse aucune activité lisible sur cette période.</p></section>';
  const lessons =
    digest.lessons.items.length === 0
      ? '<p class="muted">Aucune leçon nouvelle.</p>'
      : `<ul class="lessons">${digest.lessons.items.map((lesson) => `<li>${lesson.category ? `<span>${escapeHtml(lesson.category)}</span>` : ''}${escapeHtml(lesson.content)}</li>`).join('')}</ul>`;
  const notes =
    digest.notes.length === 0
      ? ''
      : `<section class="notes"><h2>Limites des données</h2><ul>${digest.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul></section>`;

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>Digest d’auto-amélioration — Code Buddy</title>
  <style>
    :root { color-scheme: dark; --bg:#080b10; --panel:#121720; --soft:#19212c; --line:#293545; --text:#eef4fb; --muted:#91a0b2; --cyan:#5addff; --violet:#ac91ff; --green:#69e6a8; --red:#ff8190; --amber:#f4c86b; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; color:var(--text); background:radial-gradient(circle at 15% 0,rgba(90,221,255,.13),transparent 34rem),radial-gradient(circle at 90% 10%,rgba(172,145,255,.12),transparent 30rem),var(--bg); font:15px/1.6 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { width:min(980px,calc(100% - 28px)); margin:0 auto; padding:64px 0; }
    .brand { color:var(--cyan); font-size:12px; font-weight:800; letter-spacing:.16em; text-transform:uppercase; }
    h1 { margin:18px 0 8px; font-size:clamp(34px,6vw,62px); line-height:1.04; letter-spacing:-.045em; }
    .dek { max-width:760px; margin:18px 0 0; color:#c3cedb; font-size:17px; }
    .period,.muted { color:var(--muted); }
    .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:34px 0; }
    .metric,.panel,.empty,.notes { border:1px solid var(--line); border-radius:18px; background:linear-gradient(145deg,rgba(25,33,44,.94),rgba(13,18,25,.96)); box-shadow:0 22px 70px rgba(0,0,0,.28); }
    .metric { min-height:132px; padding:18px; }
    .metric .label { color:var(--muted); font-size:11px; font-weight:800; letter-spacing:.11em; text-transform:uppercase; }
    .metric strong { display:block; margin:10px 0 3px; font-size:30px; line-height:1.1; }
    .metric small { color:var(--muted); }
    .metric.good strong { color:var(--green); } .metric.bad strong { color:var(--red); } .metric.bench strong { color:var(--amber); }
    .columns { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
    .panel { padding:22px; }
    h2 { margin:0 0 14px; font-size:17px; }
    ul { margin:0; padding-left:20px; }
    li + li { margin-top:7px; }
    code { color:#c8eeff; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; overflow-wrap:anywhere; }
    .lessons li span { display:inline-block; margin-right:8px; border-radius:999px; padding:2px 7px; color:var(--violet); background:rgba(172,145,255,.1); font-size:10px; font-weight:800; }
    .empty,.notes { margin-top:14px; padding:22px; }
    .empty strong { color:var(--cyan); font-size:20px; } .empty p { margin:5px 0 0; color:var(--muted); }
    footer { margin-top:28px; padding-top:18px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; }
    @media (max-width:760px) { main{padding:38px 0}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.columns{grid-template-columns:1fr} }
    @media (max-width:480px) { .grid{grid-template-columns:1fr} }
    @media print { :root{color-scheme:light;--bg:#fff;--panel:#fff;--soft:#fff;--line:#d8dee7;--text:#17202b;--muted:#5d6877} body{background:#fff}.metric,.panel,.empty,.notes{box-shadow:none;break-inside:avoid} }
  </style>
</head>
<body>
  <main>
    <header><div class="brand">Code Buddy · Darwin–Gödel loop</div><h1>Digest d’auto-amélioration</h1><div class="period">${escapeHtml(formatDate(digest.period.since))} → ${escapeHtml(formatDate(digest.period.until))}</div>${digest.hasActivity ? `<p class="dek">${escapeHtml(digestNarrative(digest))}</p>` : ''}</header>
    ${empty}
    <section class="grid">
      <article class="metric"><div class="label">Tools écrits</div><strong>${digest.tools.count}</strong><small>${digest.tools.count === 1 ? 'outil' : 'outils'} sur la période</small></article>
      <article class="metric"><div class="label">Skills</div><strong>${digest.skills.total}</strong><small>${digest.skills.authored.count} authored · ${digest.skills.imported.count} importées</small></article>
      <article class="metric"><div class="label">Leçons</div><strong>${digest.lessons.count}</strong><small>nouvelle${digest.lessons.count === 1 ? '' : 's'} leçon${digest.lessons.count === 1 ? '' : 's'}</small></article>
      <article class="metric"><div class="label">Cycles observés</div><strong>${digest.cycles.launched}${digest.cycles.complete ? '' : '+'}</strong><small>${digest.cycles.complete ? 'historique complet' : 'minimum observable'}</small></article>
      <article class="metric good"><div class="label">Gates passées</div><strong>${digest.gates.passed}</strong><small>${digest.gates.complete ? 'comptage complet' : 'historique partiel'}</small></article>
      <article class="metric ${digest.gates.rejected > 0 ? 'bad' : ''}"><div class="label">Gates rejetées</div><strong>${digest.gates.rejected}</strong><small>${digest.gates.complete ? 'comptage complet' : 'rejets observés seulement'}</small></article>
      <article class="metric bench"><div class="label">Benchmark</div><strong>${escapeHtml(benchmarkValue)}</strong><small>${escapeHtml(benchmarkDetail)}</small></article>
    </section>
    <section class="columns">
      <article class="panel"><h2>Tools</h2>${renderHtmlNames(digest.tools)}<h2 style="margin-top:22px">Skills authored</h2>${renderHtmlNames(digest.skills.authored)}<h2 style="margin-top:22px">Skills importées</h2>${renderHtmlNames(digest.skills.imported)}</article>
      <article class="panel"><h2>Leçons apprises</h2>${lessons}</article>
    </section>
    ${notes}
    <footer>Généré le ${escapeHtml(digest.generatedAt)} · HTML autonome, sans ressource réseau.</footer>
  </main>
</body>
</html>`;
}
