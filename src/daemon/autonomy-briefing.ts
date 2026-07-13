/**
 * Evidence-first morning briefing for the always-on autonomy daemon.
 *
 * Every tick is appended to a small, local JSONL ledger. A deterministic
 * Markdown/JSON briefing is then rebuilt from that ledger plus the fleet queue
 * and worklog. The reporter is deliberately passive: it never claims a task,
 * calls a provider, publishes anything, or changes project files.
 *
 * The reporting day rolls over at 18:00 local time. Consequently, activity
 * from Saturday evening and Sunday before dawn appears in Sunday's briefing.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  ColabTask,
  ColabWorklogEntry,
  FleetColabStore,
} from '../fleet/colab-store.js';
import { FleetColabStore as DefaultFleetColabStore } from '../fleet/colab-store.js';
import { scrubSecrets } from '../security/secret-scrubber.js';
import type { TickResult } from './autonomous-loop.js';

const EVENING_ROLLOVER_HOUR = 18;
const MAX_LEDGER_EVENTS = 2_000;
const MAX_NOTABLE_EVENTS = 12;
const MAX_OPPORTUNITIES = 5;
const MAX_TEXT_LENGTH = 600;

export interface AutonomyBriefingEvent {
  schemaVersion: 1;
  at: string;
  briefingDate: string;
  tickNumber: number;
  outcome: TickResult['outcome'];
  taskId?: string;
  taskTitle?: string;
  detail?: string;
  model?: {
    tier: string;
    model: string;
    paid: boolean;
  };
}

export type MorningOpportunityKind =
  | 'operator_approval'
  | 'review_blocked'
  | 'unblock_dependency'
  | 'ready_work'
  | 'follow_up'
  | 'review_improvement';

export interface MorningOpportunity {
  kind: MorningOpportunityKind;
  title: string;
  reason: string;
  evidence: string;
  taskId?: string;
  safeNextStep: string;
}

export interface AutonomyMorningBrief {
  kind: 'codebuddy_autonomy_morning_brief';
  schemaVersion: 1;
  briefingDate: string;
  generatedAt: string;
  window: { from: string; to: string };
  sourceDir: string;
  ledgerPath: string;
  summary: {
    observedTicks: number;
    completed: number;
    failed: number;
    selfImproved: number;
    /** Idle maintenance cycles that ran but intentionally kept no artifact. */
    maintenanceChecks: number;
    goalContinuations: number;
    paidModelRuns: number;
    worklogEntries: number;
  };
  queue: {
    total: number;
    open: number;
    inProgress: number;
    completed: number;
    blocked: number;
    criticalAwaitingOperator: number;
  };
  notableEvents: AutonomyBriefingEvent[];
  worklog: ColabWorklogEntry[];
  opportunities: MorningOpportunity[];
  guardrails: string[];
}

export interface AutonomyBriefingJournalConfig {
  /** Fleet directory containing colab-tasks.json and colab-worklog.json. */
  dir: string;
  /** Read seam for tests. Defaults to a FleetColabStore over dir. */
  store?: Pick<
    FleetColabStore,
    'listTasks' | 'listWorklog' | 'listPresence' | 'unmetDependencies'
  >;
  /** Local wall clock seam. */
  now?: () => Date;
  /** Reporter output directory. Defaults to <dir>/briefings. */
  outputDir?: string;
}

export interface BriefingWriteResult {
  ok: boolean;
  brief?: AutonomyMorningBrief;
  markdownPath?: string;
  jsonPath?: string;
  error?: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The morning that owns this event: after 18:00, tomorrow morning. */
export function resolveBriefingDate(now: Date): string {
  const morning = new Date(now);
  if (morning.getHours() >= EVENING_ROLLOVER_HOUR) {
    morning.setDate(morning.getDate() + 1);
  }
  return localDateKey(morning);
}

function briefingWindow(briefingDate: string): { from: Date; to: Date } {
  const [year, month, day] = briefingDate.split('-').map(Number);
  const morning = new Date(year!, month! - 1, day!, 0, 0, 0, 0);
  const from = new Date(morning);
  from.setDate(from.getDate() - 1);
  from.setHours(EVENING_ROLLOVER_HOUR, 0, 0, 0);
  const to = new Date(morning);
  to.setHours(EVENING_ROLLOVER_HOUR, 0, 0, 0);
  return { from, to };
}

function boundedText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const scrubbed = scrubSecrets(value).replace(/[\r\n\t]+/g, ' ').trim();
  if (!scrubbed) return undefined;
  return scrubbed.slice(0, MAX_TEXT_LENGTH);
}

function escapeMarkdown(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/`/g, '\\`');
}

function readEvents(file: string): AutonomyBriefingEvent[] {
  try {
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    return lines.slice(-MAX_LEDGER_EVENTS).flatMap((line) => {
      try {
        const value = JSON.parse(line) as Partial<AutonomyBriefingEvent>;
        if (
          value.schemaVersion !== 1
          || typeof value.at !== 'string'
          || typeof value.briefingDate !== 'string'
          || typeof value.tickNumber !== 'number'
          || typeof value.outcome !== 'string'
        ) return [];
        return [value as AutonomyBriefingEvent];
      } catch {
        // A process killed between append syscalls may leave one partial line.
        return [];
      }
    });
  } catch {
    return [];
  }
}

function priorityRank(task: ColabTask): number {
  return ({ critical: 4, high: 3, medium: 2, low: 1 } as const)[task.priority];
}

function safeTaskTitle(task: ColabTask): string {
  return boundedText(task.title) ?? task.id;
}

function selectOpportunities(
  tasks: ColabTask[],
  worklog: ColabWorklogEntry[],
  events: AutonomyBriefingEvent[],
  store: Pick<FleetColabStore, 'unmetDependencies'>,
): MorningOpportunity[] {
  const opportunities: MorningOpportunity[] = [];
  const sorted = [...tasks].sort((a, b) => priorityRank(b) - priorityRank(a));

  for (const task of sorted.filter((item) => item.status === 'open' && item.priority === 'critical')) {
    opportunities.push({
      kind: 'operator_approval',
      title: safeTaskTitle(task),
      reason: 'Priorité critique : le daemon l’a volontairement laissée intacte pour décision humaine.',
      evidence: `fleet task ${task.id} (open, critical)`,
      taskId: task.id,
      safeNextStep: `Examiner puis lancer explicitement la tâche ${task.id} si son périmètre est validé.`,
    });
  }

  for (const task of sorted.filter((item) => item.status === 'blocked')) {
    opportunities.push({
      kind: 'review_blocked',
      title: safeTaskTitle(task),
      reason: boundedText(task.blockedReason) ?? 'La tâche est en attente de revue.',
      evidence: `fleet task ${task.id} (blocked, attempts=${task.attempts ?? 0})`,
      taskId: task.id,
      safeNextStep: `Lire les preuves et débloquer ${task.id} uniquement après correction de la cause.`,
    });
  }

  for (const task of sorted.filter((item) => item.status === 'open' && item.priority !== 'critical')) {
    const unmet = store.unmetDependencies(task, tasks);
    if (unmet.length > 0) {
      opportunities.push({
        kind: 'unblock_dependency',
        title: safeTaskTitle(task),
        reason: `Prête après résolution de ${unmet.length} dépendance(s).`,
        evidence: `fleet task ${task.id}; unmet=${unmet.join(',')}`,
        taskId: task.id,
        safeNextStep: `Terminer ou replanifier ${unmet.join(', ')} avant de relancer ${task.id}.`,
      });
    } else {
      opportunities.push({
        kind: 'ready_work',
        title: safeTaskTitle(task),
        reason: `Travail ${task.priority} déjà borné et auto-exécutable.`,
        evidence: `fleet task ${task.id} (open, ${task.priority})`,
        taskId: task.id,
        safeNextStep: 'Laisser la boucle autonome la prendre au prochain tick, ou la prioriser dans le Kanban.',
      });
    }
  }

  const seenSteps = new Set<string>();
  for (const entry of [...worklog].reverse()) {
    for (const rawStep of entry.nextSteps ?? []) {
      const step = boundedText(rawStep);
      if (!step || seenSteps.has(step)) continue;
      seenSteps.add(step);
      opportunities.push({
        kind: 'follow_up',
        title: step,
        reason: 'Suite proposée par un résultat autonome vérifié dans le worklog.',
        evidence: `worklog ${entry.id}${entry.taskId ? ` / task ${entry.taskId}` : ''}`,
        ...(entry.taskId ? { taskId: entry.taskId } : {}),
        safeNextStep: 'Confirmer cette suite dans le Kanban avant toute action à impact externe.',
      });
    }
  }

  const improvements = events.filter((event) => event.outcome === 'self_improved');
  if (improvements.length > 0) {
    opportunities.push({
      kind: 'review_improvement',
      title: `Relire ${improvements.length} amélioration(s) autonome(s) conservée(s)`,
      reason: 'Les gates ont accepté ces artefacts, mais une revue humaine reste utile avant usage sensible.',
      evidence: improvements.map((event) => event.detail ?? event.at).join(' · ').slice(0, MAX_TEXT_LENGTH),
      safeNextStep: 'Tester les nouveaux outils/skills sur un exemple sans effet externe avant de les généraliser.',
    });
  }

  const deduped = new Map<string, MorningOpportunity>();
  for (const opportunity of opportunities) {
    const key = `${opportunity.kind}:${opportunity.taskId ?? opportunity.title}`;
    if (!deduped.has(key)) deduped.set(key, opportunity);
  }
  return [...deduped.values()].slice(0, MAX_OPPORTUNITIES);
}

export function renderAutonomyMorningBrief(brief: AutonomyMorningBrief): string {
  const lines = [
    `# Briefing autonome — ${brief.briefingDate}`,
    '',
    `> Relève générée à ${brief.generatedAt}. Fenêtre observée : ${brief.window.from} → ${brief.window.to}.`,
    '',
    '## La nuit en un regard',
    '',
    `- ${brief.summary.observedTicks} tick(s) observé(s), ${brief.summary.completed} tâche(s) terminée(s), ${brief.summary.selfImproved} amélioration(s) conservée(s).`,
    `- ${brief.summary.maintenanceChecks} cycle(s) d’entretien sans changement : une absence de nouveauté reste une preuve, pas un succès inventé.`,
    `- ${brief.summary.failed} échec(s), ${brief.queue.blocked} tâche(s) en revue, ${brief.queue.criticalAwaitingOperator} décision(s) critique(s) laissée(s) à Patrice.`,
    `- ${brief.summary.paidModelRuns} exécution(s) sur un modèle payant ; ${brief.summary.worklogEntries} preuve(s) dans le worklog sur cette fenêtre.`,
    '',
    '## Résultats vérifiables',
    '',
  ];

  if (brief.notableEvents.length === 0 && brief.worklog.length === 0) {
    lines.push('Aucun événement notable : la boucle est restée disponible sans inventer de travail.', '');
  } else {
    lines.push('| Heure | Résultat | Preuve |', '|---|---|---|');
    for (const event of brief.notableEvents) {
      const result = [event.taskTitle, event.detail].filter(Boolean).join(' — ') || event.outcome;
      const evidence = event.taskId
        ? `task ${event.taskId}${event.model ? ` · ${event.model.tier}/${event.model.model}` : ''}`
        : event.model
          ? `${event.model.tier}/${event.model.model}`
          : `tick ${event.tickNumber}`;
      lines.push(`| ${escapeMarkdown(event.at)} | ${escapeMarkdown(`${event.outcome}: ${result}`)} | ${escapeMarkdown(evidence)} |`);
    }
    for (const entry of brief.worklog.slice(-MAX_NOTABLE_EVENTS)) {
      const evidence = entry.filesModified.length > 0
        ? entry.filesModified.map((file) => file.file).join(', ')
        : entry.taskId ? `task ${entry.taskId}` : `worklog ${entry.id}`;
      lines.push(`| ${escapeMarkdown(entry.date)} | ${escapeMarkdown(entry.summary)} | ${escapeMarkdown(evidence)} |`);
    }
    lines.push('');
  }

  lines.push('## Opportunités choisies', '');
  if (brief.opportunities.length === 0) {
    lines.push('Aucune intervention requise : la queue est saine et aucune suite prouvée n’est en attente.', '');
  } else {
    brief.opportunities.forEach((opportunity, index) => {
      lines.push(
        `${index + 1}. **${escapeMarkdown(opportunity.title)}** — ${escapeMarkdown(opportunity.reason)}`,
        `   - Preuve : ${escapeMarkdown(opportunity.evidence)}`,
        `   - Prochaine étape sûre : ${escapeMarkdown(opportunity.safeNextStep)}`,
      );
    });
    lines.push('');
  }

  lines.push(
    '## Garde-fous observés',
    '',
    ...brief.guardrails.map((guardrail) => `- ${guardrail}`),
    '',
    '## État au réveil',
    '',
    `Queue : ${brief.queue.open} open · ${brief.queue.inProgress} en cours · ${brief.queue.blocked} en revue · ${brief.queue.completed} terminée(s).`,
    '',
    `Sources : \`${brief.ledgerPath}\`, \`${path.join(brief.sourceDir, 'colab-tasks.json')}\`, \`${path.join(brief.sourceDir, 'colab-worklog.json')}\`.`,
    '',
  );
  return lines.join('\n');
}

export class AutonomyBriefingJournal {
  private readonly dir: string;
  private readonly outputDir: string;
  private readonly store: Pick<
    FleetColabStore,
    'listTasks' | 'listWorklog' | 'listPresence' | 'unmetDependencies'
  >;
  private readonly now: () => Date;

  constructor(config: AutonomyBriefingJournalConfig) {
    this.dir = path.resolve(config.dir);
    this.outputDir = path.resolve(config.outputDir ?? path.join(this.dir, 'briefings'));
    this.store = config.store ?? new DefaultFleetColabStore({ dir: this.dir });
    this.now = config.now ?? (() => new Date());
  }

  getPaths(briefingDate = resolveBriefingDate(this.now())): {
    ledgerPath: string;
    markdownPath: string;
    jsonPath: string;
    latestMarkdownPath: string;
    latestJsonPath: string;
  } {
    return {
      ledgerPath: path.join(this.outputDir, `events-${briefingDate}.jsonl`),
      markdownPath: path.join(this.outputDir, `morning-brief-${briefingDate}.md`),
      jsonPath: path.join(this.outputDir, `morning-brief-${briefingDate}.json`),
      latestMarkdownPath: path.join(this.outputDir, 'latest.md'),
      latestJsonPath: path.join(this.outputDir, 'latest.json'),
    };
  }

  /** Append one tick and refresh the briefing. Never throws into the daemon. */
  recordTick(result: TickResult, tickNumber: number): BriefingWriteResult {
    try {
      const now = this.now();
      const briefingDate = resolveBriefingDate(now);
      const paths = this.getPaths(briefingDate);
      fs.mkdirSync(this.outputDir, { recursive: true, mode: 0o700 });
      const event: AutonomyBriefingEvent = {
        schemaVersion: 1,
        at: now.toISOString(),
        briefingDate,
        tickNumber,
        outcome: result.outcome,
        ...(boundedText(result.taskId) ? { taskId: boundedText(result.taskId)! } : {}),
        ...(boundedText(result.taskTitle) ? { taskTitle: boundedText(result.taskTitle)! } : {}),
        ...(boundedText(result.detail) ? { detail: boundedText(result.detail)! } : {}),
        ...(result.model ? {
          model: {
            tier: boundedText(result.model.tier) ?? 'unknown',
            model: boundedText(result.model.model) ?? 'unknown',
            paid: result.model.paid,
          },
        } : {}),
      };
      fs.appendFileSync(paths.ledgerPath, `${JSON.stringify(event)}\n`, { encoding: 'utf-8', mode: 0o600 });
      return this.writeBrief(briefingDate);
    } catch (error) {
      return { ok: false, error: boundedText(error instanceof Error ? error.message : String(error)) ?? 'briefing write failed' };
    }
  }

  /** Rebuild a briefing from existing evidence without recording a synthetic tick. */
  refresh(briefingDate = resolveBriefingDate(this.now())): BriefingWriteResult {
    try {
      fs.mkdirSync(this.outputDir, { recursive: true, mode: 0o700 });
      return this.writeBrief(briefingDate);
    } catch (error) {
      return { ok: false, error: boundedText(error instanceof Error ? error.message : String(error)) ?? 'briefing refresh failed' };
    }
  }

  private writeBrief(briefingDate: string): BriefingWriteResult {
    const paths = this.getPaths(briefingDate);
    const now = this.now();
    const window = briefingWindow(briefingDate);
    const events = readEvents(paths.ledgerPath).filter((event) => event.briefingDate === briefingDate);
    const tasks = this.store.listTasks();
    const worklog = this.store.listWorklog().filter((entry) => {
      const at = Date.parse(entry.date);
      return Number.isFinite(at) && at >= window.from.getTime() && at < window.to.getTime();
    }).map((entry) => ({
      ...entry,
      summary: boundedText(entry.summary) ?? 'résultat sans résumé',
      filesModified: entry.filesModified.map((file) => ({
        file: boundedText(file.file) ?? '[chemin masqué]',
        changes: boundedText(file.changes) ?? '',
      })),
      issues: entry.issues.map((issue) => boundedText(issue) ?? '[détail masqué]'),
      nextSteps: entry.nextSteps.map((step) => boundedText(step) ?? '[détail masqué]'),
    }));
    const count = (outcome: TickResult['outcome']) => events.filter((event) => event.outcome === outcome).length;
    const queueCount = (status: ColabTask['status']) => tasks.filter((task) => task.status === status).length;
    const meaningfulIdle = (event: AutonomyBriefingEvent) => event.outcome === 'idle'
      && Boolean(event.detail)
      && event.detail !== 'self-improve on cooldown';
    const notableEvents = events
      .filter((event) => (event.outcome !== 'idle' && event.outcome !== 'disabled') || meaningfulIdle(event))
      .slice(-MAX_NOTABLE_EVENTS);
    const paidModelRuns = events.filter((event) => event.model?.paid).length;
    const criticalAwaitingOperator = tasks.filter(
      (task) => task.status === 'open' && task.priority === 'critical',
    ).length;

    const brief: AutonomyMorningBrief = {
      kind: 'codebuddy_autonomy_morning_brief',
      schemaVersion: 1,
      briefingDate,
      generatedAt: now.toISOString(),
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      sourceDir: this.dir,
      ledgerPath: paths.ledgerPath,
      summary: {
        observedTicks: events.length,
        completed: count('completed'),
        failed: count('failed') + count('goal_blocked'),
        selfImproved: count('self_improved'),
        maintenanceChecks: events.filter(meaningfulIdle).length,
        goalContinuations: count('goal_continue'),
        paidModelRuns,
        worklogEntries: worklog.length,
      },
      queue: {
        total: tasks.length,
        open: queueCount('open'),
        inProgress: queueCount('in_progress'),
        completed: queueCount('completed'),
        blocked: queueCount('blocked'),
        criticalAwaitingOperator,
      },
      notableEvents,
      worklog,
      opportunities: selectOpportunities(tasks, worklog, events, this.store),
      guardrails: [
        `${criticalAwaitingOperator} tâche(s) critique(s) laissée(s) intacte(s) : elles exigent une décision humaine.`,
        paidModelRuns === 0
          ? 'Aucun modèle payant observé dans le ledger de cette nuit.'
          : `${paidModelRuns} exécution(s) payante(s) tracée(s) explicitement dans le ledger.`,
        'Le briefing est passif : il lit la queue et le worklog, puis écrit uniquement dans le dossier briefings.',
        'Les secrets reconnus sont expurgés avant toute persistance dans le ledger ou le rapport.',
        'Les échecs restent visibles et les tâches bloquées sont proposées à la revue, jamais maquillées en succès.',
      ],
    };

    const markdown = renderAutonomyMorningBrief(brief);
    this.atomicWrite(paths.markdownPath, markdown);
    this.atomicWrite(paths.jsonPath, `${JSON.stringify(brief, null, 2)}\n`);
    this.atomicWrite(paths.latestMarkdownPath, markdown);
    this.atomicWrite(paths.latestJsonPath, `${JSON.stringify(brief, null, 2)}\n`);
    return { ok: true, brief, markdownPath: paths.markdownPath, jsonPath: paths.jsonPath };
  }

  private atomicWrite(file: string, content: string): void {
    const temp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, content, { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(temp, file);
    } catch (error) {
      try { fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
      throw error;
    }
  }
}
