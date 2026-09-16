/**
 * "Which LLM is good at what" — shared by the council
 * (`src/council/council-engine.ts`) and the latency-aware selector
 * (`model-selector.ts`). Kept in `fleet/` (not in the command) so the selector
 * doesn't pull the whole council → CodeBuddyClient graph just to classify a
 * model name, and so the dependency direction stays command → fleet.
 *
 * `inferStrengths` is a thin delegate to `getModelStrengths()` in
 * `config/model-tools.ts` — the single source of truth for per-model
 * capabilities (it used to be an independent regex layer that contradicted
 * the config booleans; see that module for the precedence rules).
 *
 * @module fleet/model-capability-heuristics
 */

import { getModelStrengths } from '../config/model-tools.js';
import { inferLiteraryTaskType, type TaskType } from '../council/task-types.js';
import type { ModelStrength } from './types.js';

export type { KnownTaskType, TaskType } from '../council/task-types.js';

/** Derive a model's likely strengths from its id (config-backed, see model-tools.ts). */
export function inferStrengths(model: string): ModelStrength[] {
  return getModelStrengths(model);
}

/**
 * Classify a task from its text. Literary categories are checked first;
 * generic code/reasoning/language categories remain backward-compatible.
 *
 * Accents indicate the LANGUAGE of the task, not its TYPE: a technical task
 * written in French must route `code` (Architect/Implementer/Reviewer roles),
 * not `french` — observed live: "…sessions en fichiers JSON… migrer vers
 * SQLite ?" was classified `french` because 'SQLite' missed the old `\bsql\b`
 * and none of the technical vocabulary was French. The accent fallback stays,
 * but LAST, and only after a broadened bilingual technical vocabulary.
 */
export function inferTaskType(task: string): TaskType {
  const literary = inferLiteraryTaskType(task);
  if (literary) return literary;

  const t = task.toLowerCase();
  if (
    /\b(code|coder|fonction|function|bug|refactor|impl[ée]ment\w*|classe|class|api|script|compile|regex|sql\w*|json|ya?ml|cli|node(\.js)?|npm|git|docker|typescript|javascript|python|rust|serveur|server|backend|frontend|endpoint|database|db|bdd|stockage|storage|migr(er|ation)|d[ée]ploi\w*|deploy\w*|fichier\w*)\b/.test(
      t,
    )
  )
    return 'code';
  if (/\bbase de donn[ée]es\b/.test(t)) return 'code';
  if (/\b(prouve|d[ée]montre|raisonn\w*|reason\w*|prove|analyse|strat[ée]gie|pourquoi|math|calcul|optimi\w*)\b/.test(t))
    return 'reasoning';
  if (/\b(image|photo|capture|screenshot|diagram|graph)\b/.test(t)) return 'vision';
  if (/[éèàçùêîô]/.test(task) || /\b(fran[çc]ais|france|french)\b/.test(t)) return 'french';
  return 'general';
}
