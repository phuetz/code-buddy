import { CommandHandlerResult } from './branch-handlers.js';

function buildPrompt(target: string | null, yolo: boolean): string {
  const scope = target
    ? `Sujet ciblé par l'utilisateur : ${target}`
    : 'Sujet par défaut : le travail récent du dépôt.';

  const baseInstructions = target
    ? `Examine d'abord ce sujet précis avec les outils disponibles : ${target}. Utilise aussi le contexte git pertinent si nécessaire, notamment git log -5, git diff HEAD~1 et les fichiers modifiés.`
    : 'Examine d\'abord le travail récent avec les outils disponibles : git log -5, git diff HEAD~1 et la liste des fichiers modifiés.';

  if (yolo) {
    return `${scope}

${baseInstructions}

Tu es en mode ROAST intégral pour /grill-me --yolo.
Interroge techniquement l'auteur sans aucune complaisance : brutal, sarcastique, aucune politesse, aucun coussin diplomatique.
Chaque pique DOIT rester techniquement exacte, vérifiable et actionnable : cite les fichiers, diffs, noms, tests ou choix qui justifient l'attaque.
Grille l'auteur sur les choix discutables, la dette introduite, les tests manquants, les cas limites ignorés, la sécurité, les abstractions inutiles et les noms mensongers.
Exige des réponses concrètes, pas des excuses : pour chaque accusation, demande quelle preuve, quel test ou quel correctif va fermer le sujet.
Si une critique n'est pas étayée par le dépôt ou le diff, ne la formule pas.`;
  }

  return `${scope}

${baseInstructions}

Mène un interrogatoire technique ferme mais constructif.
Après examen, pose 5 à 7 questions dures et précises sur les choix discutables, la dette introduite, les tests manquants, les cas limites ignorés, la sécurité et les noms mensongers.
Les questions doivent viser des lignes, fichiers, comportements ou décisions observables, pas des généralités.
Exige des réponses et des preuves concrètes, pas des excuses.
Ajoute ensuite 3 risques classés par sévérité, avec pour chacun l'impact, la probabilité et l'action minimale pour le réduire.
Ne flatte pas l'auteur : aide-le à voir ce qui casse, ce qui ment et ce qui manque.`;
}

export async function handleGrillMe(args: string[]): Promise<CommandHandlerResult> {
  const remainingArgs = args.filter(arg => arg !== '--yolo');
  const yolo = remainingArgs.length !== args.length;
  const target = remainingArgs.join(' ').trim() || null;

  return {
    handled: true,
    passToAI: true,
    prompt: buildPrompt(target, yolo),
  };
}
