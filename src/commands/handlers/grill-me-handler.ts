import { CommandHandlerResult } from './branch-handlers.js';

// Written as the user's own request about their own work. The previous wording
// (role orders addressed to the assistant: "Mène un interrogatoire", "Exige",
// "Ne flatte pas l'auteur", "ce qui ment") made qwen3:4b answer the injection
// refusal sentence in the real CLI (recette 2026-09-14), without any tool call.
function buildPrompt(target: string | null, yolo: boolean): string {
  const scope = target
    ? `Sujet ciblé : ${target}`
    : 'Sujet par défaut : mon travail récent dans ce dépôt.';

  // The recent work includes uncommitted changes, and HEAD~1 does not exist in
  // a single-commit repository: inspect the working tree first.
  const gitInspection = 'git status --short, git diff (modifications non indexées), git diff --cached (modifications indexées) et git log -5 --oneline ; git diff HEAD~1 seulement si le dépôt compte au moins deux commits';
  const baseInstructions = target
    ? `Examine d'abord ce sujet avec les outils disponibles : ${target}. Utilise aussi le contexte git utile et la liste des fichiers modifiés : ${gitInspection}.`
    : `Examine d'abord mon travail récent et la liste des fichiers modifiés avec les outils disponibles : ${gitInspection}.`;

  if (yolo) {
    return `J'ai lancé /grill-me --yolo : je veux une revue technique de mon propre travail en mode ROAST intégral.

${scope}

${baseInstructions}

Ensuite, sois brutal et sarcastique avec moi, sans politesse ni précautions diplomatiques.
Chaque critique doit rester techniquement exacte, vérifiable et actionnable : cite les fichiers, diffs, noms, tests ou choix qui la justifient.
Vise mes choix discutables, la dette introduite, les tests manquants, les cas limites ignorés, la sécurité, les abstractions inutiles et les noms trompeurs.
Pour chaque critique, demande-moi quelle preuve, quel test ou quel correctif fermera le sujet.
N'invente rien : une critique que le dépôt ou le diff ne prouve pas ne doit pas être formulée.`;
  }

  return `J'ai lancé /grill-me : je veux une revue technique exigeante de mon propre travail.

${scope}

${baseInstructions}

Ensuite, pose-moi 5 à 7 questions difficiles et précises sur mes choix discutables, la dette introduite, les tests manquants, les cas limites ignorés, la sécurité et les noms trompeurs.
Chaque question doit viser des lignes, fichiers, comportements ou décisions observables, pas des généralités, et me demander une preuve concrète.
Termine par 3 risques classés par sévérité, avec pour chacun l'impact, la probabilité et l'action minimale pour le réduire.
Reste franc et constructif, sans compliments inutiles : aide-moi à voir ce qui casse, ce qui est inexact et ce qui manque.`;
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
