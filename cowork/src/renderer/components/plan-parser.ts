/**
 * Plan-then-act parsing (new shell, cowork/REDESIGN.md slice 2b).
 *
 * The "act" half is driven entirely through the PROVEN submit path (useIPC.continueSession) — no new
 * IPC, no out-of-session LLM client, no core-loop pause (which would hit the CLI). The flow is
 * conversational (the Cline Plan/Act model): send a planning-framed turn, parse the assistant's
 * free-text reply into an editable step list, then on approval send an "execute this plan" turn.
 *
 * Free-text (not TaskPlan JSON) is deliberate: it's robust to how any model formats a plan and
 * doesn't depend on a JSON parse succeeding. These helpers are pure + unit-tested.
 */

/** Instruction that frames a turn as PLAN-ONLY (no tools, no edits). Prepended to the user's task. */
export function planRequestPrompt(task: string): string {
  return (
    "Propose un plan d'action numéroté, concret et court pour la tâche ci-dessous. " +
    "Ne fais RIEN d'autre pour l'instant : pas d'outils, pas de modifications de fichiers, pas de commandes — " +
    'renvoie UNIQUEMENT le plan, une étape par ligne, numérotées.\n\n' +
    `Tâche : ${task.trim()}`
  );
}

/** Compose the execution turn from the approved (possibly edited) steps. */
export function buildExecutionPrompt(task: string, steps: string[]): string {
  const list = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return `Voici le plan que j'ai approuvé pour : ${task.trim()}\n\n${list}\n\nExécute-le étape par étape.`;
}

const STEP_LINE = /^\s*(?:\d+[.)]|[-*•])\s+(.*\S)\s*$/;

/**
 * Extract concrete steps from a free-text plan reply. Accepts numbered (`1.` / `1)`) and bulleted
 * (`-`/`*`/`•`) lines; strips markdown emphasis and a trailing colon; drops empty lines, headers, and
 * lead-in prose ("Voici le plan :"). Falls back to non-empty prose lines only if no list is found.
 */
export function parsePlanSteps(reply: string): string[] {
  if (!reply || typeof reply !== 'string') return [];
  const lines = reply.split(/\r?\n/);
  const steps: string[] = [];
  for (const raw of lines) {
    const m = raw.match(STEP_LINE);
    if (!m) continue;
    const step = cleanStep(m[1] ?? '');
    if (step) steps.push(step);
  }
  if (steps.length > 0) return steps;
  // No list markers — treat each substantive line as a step (skip obvious headers/lead-ins).
  return lines
    .map((l) => cleanStep(l))
    .filter((l) => l.length > 0 && !/^(voici|plan|voilà|here'?s|the plan)\b.*[:：]?$/i.test(l));
}

function cleanStep(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\s*[-*•]\s+/, '')
    .replace(/\s+/g, ' ')
    .replace(/[:：]\s*$/, '')
    .trim();
}
