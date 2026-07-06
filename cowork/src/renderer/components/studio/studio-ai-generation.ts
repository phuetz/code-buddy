/**
 * Builds the seeded prompt for App Studio's "Générer avec IA" mode.
 *
 * Instead of a static template scaffold, AI generation starts a project-scoped
 * agent session (cwd = target dir) with this prompt: the agent reads the chosen
 * design system's guidance via the `design_system` tool and writes a complete,
 * branded custom app with its file tools. The "avoid dangerous shell" guidance
 * keeps the turn away from hard-blocked commands (rm/chmod/curl/sh -c…) that
 * would otherwise stall a headless turn.
 */

import type { StudioScaffoldRequest } from './StudioComposer.js';
import { findDesignSystem } from './design-systems-catalog.js';

export function buildAiGenerationPrompt(req: StudioScaffoldRequest): string {
  const lines: string[] = [];
  lines.push(`Génère une application web complète et fonctionnelle : ${req.prompt}`);
  lines.push('');

  // bolt.new's plan step, LLM edition: the agent opens with a machine-readable
  // plan block that App Studio renders as the "Plan de vol" card (parsed by
  // dev-plan.ts parsePlanBlock; hidden from the chat bubble).
  lines.push('COMMENCE ta réponse par un plan de développement dans un bloc ```plan (JSON strict) :');
  lines.push('```plan');
  lines.push(
    '{"title":"<nom court de l\'app>","stack":"HTML/CSS/JS","steps":[' +
      '{"id":"scaffold","title":"Créer la structure (index.html, style.css, app.js)"},' +
      '{"id":"<kebab-case>","title":"<étape fonctionnelle>","detail":"<détail court>","match":["<mot-clé de fichier>"]}]}',
  );
  lines.push('```');
  lines.push(
    "3 à 6 étapes fonctionnelles SPÉCIFIQUES à cette app (pas de générique) ; `match` = mots-clés de chemins de fichiers " +
      'qui marqueront l\'étape faite. N\'inclus PAS d\'étapes "run"/"verify" (ajoutées automatiquement). Après le bloc, construis l\'app.',
  );
  lines.push('');

  if (req.designSystem) {
    const ds = findDesignSystem(req.designSystem);
    const name = ds?.name ?? req.designSystem;
    lines.push(
      `Applique fidèlement le système de design « ${name} ». AVANT d'écrire le CSS, appelle ` +
        `l'outil \`design_system\` avec action="get" et id="${req.designSystem}" pour lire sa ` +
        `guidance (couleurs exactes, typographie, géométrie, ombres), puis respecte-la partout dans l'interface.`,
    );
    lines.push('');
  }

  lines.push('Contraintes STRICTES :');
  lines.push(
    "- N'utilise PAS l'outil bash / shell / terminal. Zéro commande. Crée l'app UNIQUEMENT en écrivant des fichiers.",
  );
  lines.push(
    "- Utilise `create_file` pour créer chaque fichier (il crée le fichier s'il n'existe pas), puis `str_replace` / `write_file` pour éditer. Écris directement dans le dossier de travail courant.",
  );
  lines.push(
    "- IMAGES : si l'app gagne à être illustrée (héros, galerie, logo, fond), GÉNÈRE de vraies images avec l'outil " +
      '`image_generate` (charge-le via `tool_search("image_generate")` s\'il n\'est pas dans ta liste) : un prompt anglais ' +
      "détaillé par image, cohérent avec le design choisi. L'outil renvoie un chemin de sortie SOUS le dossier du projet " +
      "(`.codebuddy/media-generation/images/…`) — référence ce chemin RELATIF tel quel dans le HTML/CSS " +
      '(ex. `<img src=".codebuddy/media-generation/images/xxx.jpg">`), ne tente PAS de copier le binaire. ' +
      "Si la génération d'image échoue, continue sans elle (dégradé propre, pas d'app cassée).",
  );
  lines.push(
    "- VIDÉOS : si l'utilisateur demande de la vidéo OU si une vidéo d'ambiance sert vraiment le design (héros " +
      "plein écran d'une vitrine, démo produit), GÉNÈRE-la avec l'outil `video_generate` (charge-le via " +
      '`tool_search("video_generate")`) : un prompt anglais détaillé, UNE seule vidéo courte maximum (la génération ' +
      "prend ~1 min). Même règle de chemin : référence la sortie RELATIVE telle quelle " +
      '(ex. `<video autoplay muted loop src=".codebuddy/media-generation/videos/xxx.mp4">`), ne copie pas le binaire. ' +
      "En cas d'échec, dégrade proprement (image ou fond CSS à la place).",
  );
  lines.push(
    "- Stack : HTML/CSS/JS statique (index.html + style.css + app.js) qui s'ouvre directement dans un navigateur, SANS build ni installation. (Pas de framework sauf demande explicite.)",
  );
  lines.push("- L'application doit être fonctionnelle ET soignée visuellement selon la guidance de design.");
  lines.push("- Termine par un court résumé de ce que tu as créé et comment ouvrir l'app (ouvrir index.html).");

  return lines.join('\n');
}
