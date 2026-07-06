import type { CodeBuddyClient, CodeBuddyMessage } from '../codebuddy/client.js';
import { parseJsonResponse } from '../utils/llm-retry.js';

export interface GoalPlanSubtask {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria: string[];
  /**
   * True quand le LLM n'a fourni aucun critère vérifiable et que le critère a
   * été auto-rempli à partir du titre (tautologique — « Evidence shows X is
   * complete »). Un plan sain n'en a aucun : `decomposeGoal` tente une passe
   * de réparation ciblée, et le dev-loop signale ceux qui restent.
   */
  criteriaAutoFilled?: boolean;
}

export interface GoalPlanTask extends GoalPlanSubtask {
  dependsOn: string[];
  subtasks: GoalPlanSubtask[];
}

export interface GoalPlan {
  summary: string;
  tasks: GoalPlanTask[];
  notes?: string[];
}

export interface DecomposeGoalOptions {
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

const DEFAULT_PLAN_MAX_TOKENS = 4096;
const DEFAULT_PLAN_TIMEOUT_MS = 45_000;
const MAX_TOP_LEVEL_TASKS = 8;
const MAX_SUBTASKS_PER_TASK = 6;
const MAX_CRITERIA_PER_ITEM = 6;
const MAX_NOTES = 6;
const MAX_FIELD_LENGTH = 500;

export function shouldAutoDecomposeGoal(goal: string): boolean {
  const text = goal.trim().toLowerCase();
  if (!text) return false;
  if (text.length >= 140) return true;

  const structuralHints = [
    /\bthen\b/,
    /\bfinally\b/,
    /\bfirst\b/,
    /\bsecond\b/,
    /\bthird\b/,
    /\bstep\s+\d+\b/,
    /\bsous[-\s]?t[aâ]che/,
    /\bsub[-\s]?task/,
    /\bdecompos/,
    /\bplan\b/,
    /\bdag\b/,
    /\bparallel/,
    /\bimpl[eé]ment.*test/,
    /\bresearch.*implement/,
  ];

  return structuralHints.some((pattern) => pattern.test(text));
}

export async function decomposeGoal(
  goal: string,
  client: CodeBuddyClient,
  options: DecomposeGoalOptions = {}
): Promise<GoalPlan | null> {
  const messages: CodeBuddyMessage[] = [
    {
      role: 'system',
      content:
        'You are a Hermes-style kanban orchestrator. Decompose a user goal into ' +
        'a durable task graph before execution. Extract independent work lanes, ' +
        'link only true dependencies, and add concrete acceptance criteria. ' +
        'Return only valid JSON.',
    },
    {
      role: 'user',
      content: buildGoalDecompositionPrompt(goal),
    },
  ];

  const response = await withTimeout(
    client.chat(messages, [], {
      ...(options.model ? { model: options.model } : {}),
      maxTokens: options.maxTokens ?? DEFAULT_PLAN_MAX_TOKENS,
      temperature: 0,
    }),
    options.timeoutMs ?? DEFAULT_PLAN_TIMEOUT_MS
  );
  const raw = response.choices?.[0]?.message?.content ?? '';
  const plan = parseGoalPlan(raw, goal);
  // Invariant (jarvis-OS validate_step, adapté) : chaque step doit porter un
  // critère de succès VÉRIFIABLE. Le plan étant advisory ici, on répare au
  // lieu de rejeter — une passe LLM ciblée sur les seuls items auto-remplis.
  if (plan && weakCriteriaItems(plan).length > 0) {
    return repairPlanCriteria(goal, plan, client, options);
  }
  return plan;
}

/** Tasks/subtasks dont le critère a été auto-rempli (non vérifiable). */
export function weakCriteriaItems(plan: GoalPlan): GoalPlanSubtask[] {
  const weak: GoalPlanSubtask[] = [];
  for (const task of plan.tasks) {
    if (task.criteriaAutoFilled) weak.push(task);
    for (const subtask of task.subtasks) {
      if (subtask.criteriaAutoFilled) weak.push(subtask);
    }
  }
  return weak;
}

const MAX_REPAIR_ITEMS = 12;
const REPAIR_MAX_TOKENS = 1024;
const REPAIR_TIMEOUT_MS = 20_000;

/**
 * Passe de réparation ciblée : demande des critères objectivement vérifiables
 * pour les seuls items auto-remplis, et les fusionne dans le plan (mutation en
 * place des items concernés). Fail-open : toute erreur rend le plan inchangé.
 */
export async function repairPlanCriteria(
  goal: string,
  plan: GoalPlan,
  client: CodeBuddyClient,
  options: DecomposeGoalOptions = {}
): Promise<GoalPlan> {
  const weak = weakCriteriaItems(plan).slice(0, MAX_REPAIR_ITEMS);
  if (weak.length === 0) return plan;
  try {
    const list = weak
      .map((w) => `- ${w.id}: ${w.title}${w.description ? ` — ${w.description}` : ''}`)
      .join('\n');
    const messages: CodeBuddyMessage[] = [
      {
        role: 'system',
        content:
          'You harden a task plan. For each listed task, provide 1-3 OBJECTIVELY ' +
          'VERIFIABLE acceptance criteria: a command whose exit code or output ' +
          'proves completion, a file that must exist with specific content, or an ' +
          'observable behavior. Never restate the task title as its own criterion. ' +
          'Return only valid JSON.',
      },
      {
        role: 'user',
        content:
          `Goal:\n${goal}\n\nTasks missing verifiable acceptance criteria:\n${list}\n\n` +
          `Return this exact JSON shape:\n{"criteria": {"<taskId>": ["criterion", "..."]}}`,
      },
    ];
    const response = await withTimeout(
      client.chat(messages, [], {
        ...(options.model ? { model: options.model } : {}),
        maxTokens: REPAIR_MAX_TOKENS,
        temperature: 0,
      }),
      REPAIR_TIMEOUT_MS
    );
    const raw = response.choices?.[0]?.message?.content ?? '';
    const parsed = parseJsonResponse(raw) as { criteria?: Record<string, unknown> } | null;
    const map =
      parsed && typeof parsed === 'object' && parsed.criteria && typeof parsed.criteria === 'object'
        ? (parsed.criteria as Record<string, unknown>)
        : {};
    const byId = new Map(weak.map((w) => [w.id, w]));
    for (const [id, value] of Object.entries(map)) {
      const target = byId.get(id);
      if (!target) continue;
      const values = cleanStringArray(value).slice(0, MAX_CRITERIA_PER_ITEM);
      if (!values.length) continue;
      target.acceptanceCriteria = values;
      delete target.criteriaAutoFilled;
    }
  } catch {
    /* fail-open : le plan garde ses critères de repli, marqués autoFilled */
  }
  return plan;
}

export function parseGoalPlan(raw: string, originalGoal: string = ''): GoalPlan | null {
  if (!raw.trim()) return null;

  let parsed: unknown;
  try {
    parsed = parseJsonResponse(raw);
  } catch {
    return null;
  }

  return normalizeGoalPlan(parsed, originalGoal);
}

export function normalizeGoalPlan(raw: unknown, originalGoal: string = ''): GoalPlan | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const rawTasks = Array.isArray(record.tasks) ? record.tasks : [];
  if (rawTasks.length === 0) return null;

  const tasks: GoalPlanTask[] = [];
  const seenIds = new Set<string>();
  const rawById = new Map<string, Record<string, unknown>>();

  for (let i = 0; i < rawTasks.length && tasks.length < MAX_TOP_LEVEL_TASKS; i++) {
    const rawTask = rawTasks[i];
    if (!rawTask || typeof rawTask !== 'object' || Array.isArray(rawTask)) continue;
    const taskRecord = rawTask as Record<string, unknown>;
    const fallbackId = `T${tasks.length + 1}`;
    const id = uniqueId(cleanId(taskRecord.id, fallbackId), seenIds);
    const title = cleanText(taskRecord.title, `Task ${tasks.length + 1}`);
    const description = cleanOptionalText(taskRecord.description);
    const { criteria: acceptanceCriteria, autoFilled } = cleanCriteria(taskRecord, title);
    const subtasks = cleanSubtasks(taskRecord.subtasks, id);

    tasks.push({
      id,
      title,
      ...(description ? { description } : {}),
      acceptanceCriteria,
      ...(autoFilled ? { criteriaAutoFilled: true } : {}),
      dependsOn: [],
      subtasks,
    });
    rawById.set(id, taskRecord);
  }

  if (tasks.length === 0) return null;

  const validIds = new Set(tasks.map((task) => task.id));
  for (const task of tasks) {
    const taskRecord = rawById.get(task.id);
    task.dependsOn = cleanDependsOn(taskRecord, task.id, validIds);
  }

  const summary = cleanText(
    record.summary,
    originalGoal ? `Decomposed plan for: ${originalGoal}` : 'Decomposed goal plan'
  );
  const notes = cleanStringArray(record.notes).slice(0, MAX_NOTES);
  return {
    summary,
    tasks,
    ...(notes.length ? { notes } : {}),
  };
}

export function goalPlanToCriteria(plan: GoalPlan | undefined, maxCriteria: number = 30): string[] {
  if (!plan) return [];

  const criteria: string[] = [];
  for (const task of plan.tasks) {
    const depends = task.dependsOn.length ? ` after ${task.dependsOn.join(', ')}` : '';
    const taskCriteria = task.acceptanceCriteria.length
      ? task.acceptanceCriteria.join('; ')
      : task.description || task.title;
    criteria.push(`${task.id} ${task.title}${depends}: ${taskCriteria}`);

    for (const subtask of task.subtasks) {
      const subtaskCriteria = subtask.acceptanceCriteria.length
        ? subtask.acceptanceCriteria.join('; ')
        : subtask.description || subtask.title;
      criteria.push(`${subtask.id} ${task.title} / ${subtask.title}: ${subtaskCriteria}`);
      if (criteria.length >= maxCriteria) return criteria;
    }

    if (criteria.length >= maxCriteria) return criteria;
  }
  return criteria;
}

export function formatGoalPlan(plan: GoalPlan): string {
  const lines = [`Plan: ${plan.summary}`, `Tasks: ${plan.tasks.length}`];
  for (const task of plan.tasks) {
    lines.push(`- ${task.id}: ${task.title}`);
    if (task.dependsOn.length) {
      lines.push(`  depends on: ${task.dependsOn.join(', ')}`);
    }
    if (task.acceptanceCriteria.length) {
      lines.push(`  acceptance: ${task.acceptanceCriteria.join('; ')}`);
    }
    for (const subtask of task.subtasks) {
      lines.push(`  - ${subtask.id}: ${subtask.title}`);
      if (subtask.acceptanceCriteria.length) {
        lines.push(`    acceptance: ${subtask.acceptanceCriteria.join('; ')}`);
      }
    }
  }
  if (plan.notes?.length) {
    lines.push(`Notes: ${plan.notes.join('; ')}`);
  }
  return lines.join('\n');
}

function buildGoalDecompositionPrompt(goal: string): string {
  return `Goal:
${goal}

Decompose this goal into a task graph with sub-subtasks.

Use this exact JSON shape:
{
  "summary": "one sentence",
  "tasks": [
    {
      "id": "T1",
      "title": "short task title",
      "description": "what this task does",
      "dependsOn": [],
      "acceptanceCriteria": ["specific evidence required"],
      "subtasks": [
        {
          "id": "T1.1",
          "title": "short subtask title",
          "description": "what this subtask does",
          "acceptanceCriteria": ["specific evidence required"]
        }
      ]
    }
  ],
  "notes": ["optional orchestration notes"]
}

Rules:
1. Create 2-8 top-level tasks only when the goal is genuinely multi-step; otherwise return one task.
2. Treat independent lanes as parallel tasks with empty dependsOn.
3. Add dependsOn only when a task cannot start until another task's output exists.
4. Include final integration/review tasks only when useful, with dependsOn set in the original task object.
5. Each top-level task should include 1-5 concrete subtasks when there is real substructure.
6. Acceptance criteria must be observable evidence, not generic "done" statements.
7. Return only the JSON object.`;
}

function cleanSubtasks(raw: unknown, parentId: string): GoalPlanSubtask[] {
  if (!Array.isArray(raw)) return [];
  const subtasks: GoalPlanSubtask[] = [];
  const seenIds = new Set<string>();

  for (const item of raw) {
    if (subtasks.length >= MAX_SUBTASKS_PER_TASK) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const fallbackId = `${parentId}.${subtasks.length + 1}`;
    const id = uniqueId(cleanId(record.id, fallbackId), seenIds);
    const title = cleanText(record.title, `Subtask ${subtasks.length + 1}`);
    const description = cleanOptionalText(record.description);
    const { criteria, autoFilled } = cleanCriteria(record, title);
    subtasks.push({
      id,
      title,
      ...(description ? { description } : {}),
      acceptanceCriteria: criteria,
      ...(autoFilled ? { criteriaAutoFilled: true } : {}),
    });
  }

  return subtasks;
}

function cleanCriteria(
  record: Record<string, unknown>,
  fallbackTitle: string,
): { criteria: string[]; autoFilled: boolean } {
  const raw =
    record.acceptanceCriteria ??
    record.criteria ??
    record.acceptance ??
    record.doneWhen;
  const values = cleanStringArray(raw).slice(0, MAX_CRITERIA_PER_ITEM);
  if (values.length) return { criteria: values, autoFilled: false };
  // Repli tautologique — marqué pour la passe de réparation (invariant
  // jarvis-OS : un step sans critère vérifiable ne devrait pas exister).
  return { criteria: [`Evidence shows "${fallbackTitle}" is complete`], autoFilled: true };
}

function cleanDependsOn(
  record: Record<string, unknown> | undefined,
  ownId: string,
  validIds: Set<string>
): string[] {
  if (!record) return [];
  const raw = record.dependsOn ?? record.dependencies ?? record.parents;
  const seen = new Set<string>();
  return cleanStringArray(raw).filter((id) => {
    if (id === ownId || !validIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function cleanId(raw: unknown, fallback: string): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const cleaned = text.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 32);
  return cleaned || fallback;
}

function uniqueId(id: string, seen: Set<string>): string {
  if (!seen.has(id)) {
    seen.add(id);
    return id;
  }
  let suffix = 2;
  while (seen.has(`${id}-${suffix}`)) suffix += 1;
  const unique = `${id}-${suffix}`;
  seen.add(unique);
  return unique;
}

function cleanText(raw: unknown, fallback: string): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return (text || fallback).slice(0, MAX_FIELD_LENGTH);
}

function cleanOptionalText(raw: unknown): string | undefined {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text ? text.slice(0, MAX_FIELD_LENGTH) : undefined;
}

function cleanStringArray(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const value of values) {
    const text = String(value).trim().replace(/\s+/g, ' ').slice(0, MAX_FIELD_LENGTH);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    cleaned.push(text);
  }

  return cleaned;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`goal decomposition timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
