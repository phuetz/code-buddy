/**
 * First-use hints (comparatif plan P4, optional part).
 *
 * A short contextual tip shown ONCE per profile, the first time the user meets
 * a surprising behaviour: a command unavailable on this surface, a message
 * queued behind a running turn, a tool output shortened for the model (exact
 * output recoverable through restore_context).
 *
 * Persistence: one marker file per hint under ~/.codebuddy/hints/ created with
 * O_EXCL, so concurrent processes (CLI + Cowork) show a hint at most once.
 * `CODEBUDDY_HINTS=off` disables every hint. Never throws: an unwritable
 * profile means no hint rather than a repeated one.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type FirstUseHintId = 'surface_unavailable' | 'message_queued' | 'restore_context';

export const FIRST_USE_HINTS: Readonly<Record<FirstUseHintId, { en: string; fr: string }>> = Object.freeze({
  surface_unavailable: {
    en: 'Tip: greyed-out commands are not available on this surface yet; run them in the terminal with `buddy`.',
    fr: 'Astuce : les commandes grisées ne sont pas encore pilotables ici ; lance-les dans un terminal avec `buddy`.',
  },
  message_queued: {
    en: 'Tip: this message was queued while Buddy was busy and runs now; messages sent during a turn always run in order.',
    fr: 'Astuce : un message envoyé pendant un tour est mis en file et partira à la fin du tour en cours.',
  },
  restore_context: {
    en: 'Tip: long tool outputs are shortened for the model; the exact output stays recoverable with restore_context.',
    fr: 'Astuce : les longues sorties d’outils sont raccourcies pour le modèle ; la sortie exacte reste récupérable avec restore_context.',
  },
});

export function firstUseHintsDir(): string {
  return process.env.CODEBUDDY_HINTS_DIR || path.join(os.homedir(), '.codebuddy', 'hints');
}

/**
 * Return the hint text the first time `id` is requested in this profile, then
 * null forever. The marker is created before the text is returned.
 */
export function takeFirstUseHint(id: FirstUseHintId, lang: 'en' | 'fr' = 'en', dir = firstUseHintsDir()): string | null {
  if ((process.env.CODEBUDDY_HINTS ?? '').toLowerCase() === 'off') return null;
  const hint = FIRST_USE_HINTS[id];
  if (!hint) return null;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, id), `${new Date().toISOString()}\n`, { flag: 'wx', mode: 0o600 });
    return hint[lang];
  } catch {
    return null;
  }
}

export function resetFirstUseHints(dir = firstUseHintsDir()): void {
  for (const id of Object.keys(FIRST_USE_HINTS)) {
    fs.rmSync(path.join(dir, id), { force: true });
  }
}
