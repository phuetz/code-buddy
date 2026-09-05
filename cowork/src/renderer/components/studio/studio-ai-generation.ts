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
import { findStack } from './generation-stacks.js';
import { APP_STUDIO_PLAN_PROMPT_MARKER } from './dev-plan.js';

export const APP_STUDIO_DESIGN_GUIDE = `CONTRAT DE DESIGN — exécute chaque règle :
- Direction et palette : définis une palette tirée du sujet (ou du système de design explicitement choisi), avec 3 à 5 couleurs sémantiques en variables CSS ; aucun choix générique par défaut.
- Typographie : choisis deux familles de polices distinctes et donne un seul rôle à chacune — display/titres pour la première, corps/interface pour la seconde. Déclare les fallbacks. Inter par défaut est interdit.
- Hiérarchie typographique : rends display, h1, h2, corps et légende visiblement distincts par taille, graisse, interlignage et espacement ; la page doit rester lisible au premier balayage.
- Contraste vérifié : respecte WCAG AA (4.5:1 pour le texte courant, 3:1 pour grand texte et composants) et vérifie les états normal, hover, focus et disabled.
- Livre les thèmes clair ET sombre, cohérents et complets, avec préférence système et bascule utilisable ; ne simule pas le sombre par un filtre d'inversion.
- Interdits nommés : aucun dégradé violet sur fond blanc, ne pas tout centrer, pas de coins arrondis sur tous les éléments, aucun emoji comme puce ou icône. Utilise alignements, bordures, rayons et SVG avec intention.`;

export const APP_STUDIO_COMPONENT_CATALOG_GUIDE = `CATALOGUE DE COMPOSANTS (optionnel, réseau seulement) :
- Pour un composant React/Tailwind important, tu peux consulter le catalogue public https://21st.dev/community/components avec \`web_search\` (charge-le via \`tool_search("web_search")\` s'il est absent), puis adapter l'idée et le code aux jetons locaux.
- Ne bloque jamais la génération sur 21st.dev, n'exige ni compte, ni clé, ni CLI, et n'ajoute aucune dépendance uniquement pour consulter le catalogue. Si le réseau, la recherche ou le composant est indisponible, continue immédiatement avec les primitives locales.`;

export function buildAiGenerationPrompt(req: StudioScaffoldRequest): string {
  const stack = findStack(req.stack)!;
  const lines: string[] = [];
  lines.push(`Génère une application complète et fonctionnelle (${stack.label}) : ${req.prompt}`);
  lines.push('');

  // bolt.new's plan step, LLM edition: the agent opens with a machine-readable
  // plan block that App Studio renders as the "Plan de vol" card (parsed by
  // dev-plan.ts parsePlanBlock; hidden from the chat bubble).
  lines.push(`${APP_STUDIO_PLAN_PROMPT_MARKER} (JSON strict) :`);
  lines.push('```plan');
  lines.push(
    '{"title":"<nom court de l\'app>","stack":"' + stack.planStack + '","steps":[' +
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

  if (req.materializedAssets?.length) {
    lines.push('Assets créatifs sélectionnés (copies locales safe + approved, à utiliser dans l’application) :');
    for (const asset of req.materializedAssets) {
      const reference = stack.id === 'react-vite' || stack.id === 'vue-vite'
        ? `/${asset.relativePath.replace(/^public\//, '')}`
        : stack.id === 'expo'
          ? `require('./${asset.relativePath}')`
          : asset.relativePath;
      lines.push(`- ${asset.name} : ${reference}`);
    }
    lines.push("N'invente aucun chemin absolu et conserve ces fichiers dans le livrable final.");
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
      "détaillé par image, cohérent avec le design choisi. N'intègre jamais directement un chemin privé " +
      "`.codebuddy/media-generation/...` dans l'application publiée. Utilise en priorité les assets matérialisés listés ci-dessus. " +
      "Si le moteur ne fournit pas un asset déjà placé dans le dossier public adapté à la stack, continue sans lui " +
      "(dégradé propre, pas d'app cassée).",
  );
  lines.push(
    "- VIDÉOS : si l'utilisateur demande de la vidéo OU si une vidéo d'ambiance sert vraiment le design (héros " +
      "plein écran d'une vitrine, démo produit), GÉNÈRE-la avec l'outil `video_generate` (charge-le via " +
      '`tool_search("video_generate")`) : un prompt anglais détaillé, UNE seule vidéo courte maximum (la génération ' +
      "prend ~1 min). N'intègre jamais un chemin privé `.codebuddy` au livrable : utilise uniquement un média " +
      'matérialisé dans le dossier public adapté à la stack. ' +
      "En cas d'échec, dégrade proprement (image ou fond CSS à la place).",
  );
  lines.push(`- ${stack.guidance}`);
  lines.push(`- Preview : ${stack.previewNote}`);
  lines.push(APP_STUDIO_DESIGN_GUIDE);
  if (stack.id === 'react-vite') lines.push(APP_STUDIO_COMPONENT_CATALOG_GUIDE);
  lines.push("- Termine par un court résumé de ce que tu as créé et comment ouvrir l'app (ouvrir index.html).");

  return lines.join('\n');
}
