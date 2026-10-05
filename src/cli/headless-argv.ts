/**
 * `buddy -p -m <modèle> "prompt"` est l'ordre de la flotte.
 * Commander prend le jeton suivant comme valeur obligatoire de `-p`, donc
 * `-m` devient le texte du prompt et le modèle n'est jamais posé. La session
 * retombe alors sur le fournisseur détecté (ChatGPT OAuth s'il est connecté)
 * tout en lisant encore `-m` dans `process.argv` pour le nom du modèle.
 * On détache le commutateur headless quand le jeton suivant est une option.
 */

const HEADLESS_SWITCHES = new Set(['-p', '--prompt', '--print']);

function isFollowingOption(token: string | undefined): boolean {
  if (!token) return false;
  return token === '--' || /^--?[A-Za-z]/.test(token);
}

export function detachHeadlessSwitchFromFollowingOption(argv: readonly string[]): string[] {
  const executablePrefix = argv.slice(0, 2);
  const tokens = argv.slice(2);
  const rewritten: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--') {
      rewritten.push(...tokens.slice(index));
      break;
    }
    const next = tokens[index + 1];
    if (token !== undefined && HEADLESS_SWITCHES.has(token) && isFollowingOption(next)) {
      rewritten.push('--headless');
      continue;
    }
    if (token !== undefined) rewritten.push(token);
  }

  return [...executablePrefix, ...rewritten];
}
