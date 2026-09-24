/**
 * Décide si le texte renvoyé par un gestionnaire slash est un échec.
 * Le pont headless ne lit pas ce texte : le gestionnaire pose `failed`.
 * Une page d'aide qui commence par « Usage: » puis liste des actions reste un succès.
 */

const FAILURE_FIRST_LINE =
  /^(?:❌|⚠️)|^(?:Error\b|Failed\b|Invalid\b|Unknown\b|Could not\b|Unable to\b|Cannot\b|No .+ named\b|No .+ found (?:for|matching)\b|Multiple chat sessions active\b)|(?:\bnot found\b|\bintrouvable\b|\binvalid\b|\béchec\b|\berreur\b|\berror\b|\bfailed\b|\brejected\b|\bunreadable\b)/i;

const HELP_SECTION = /\n(?:Actions|Commands|Examples|Configure|Subcommands|Categories|Language Features|Builtins):/i;

export function announcesSlashFailure(content: string): boolean {
  const text = content.replace(/^\uFEFF/, '').trim();
  if (!text) return false;
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  if (isShortUsageError(text)) return true;
  return FAILURE_FIRST_LINE.test(first);
}

function isShortUsageError(text: string): boolean {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  if (!/^Usage:/i.test(first.trim())) return false;
  if (HELP_SECTION.test(text)) return false;
  if (text.length > 900) return false;
  return true;
}

/** Champ à étaler sur un CommandHandlerResult. Absent quand ce n'est pas un échec. */
export function failureFlag(content: string): { failed: true } | Record<string, never> {
  return announcesSlashFailure(content) ? { failed: true } : {};
}
