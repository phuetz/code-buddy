# Rapport de mission — App Studio de Cowork, leçons de bolt.diy (27/09/2026)

Branche `opus/cowork-app-builder-bolt-2026-09-27`, départ `origin/main` `8a2891851`.
Référence étudiée : bolt.diy (MIT, © 2024 StackBlitz, Inc. and bolt.diy contributors),
révision `2e254ac19a696394030601bc602f54945b12bfc4`. Aucun code de bolt.diy n'est repris
tel quel : seules les idées sont transposées.

## Constat de départ (lecture du code)

- La génération IA d'App Studio lance une session d'agent Code Buddy (outils fichiers,
  shell interdit par le prompt), puis `npm install` + serveur de dev, puis une boucle de
  correction plafonnée à 3 (`auto-build-model.ts`).
- Le seul critère de succès de cette boucle est « le serveur de dev répond ». Vite répond
  200 même quand l'application ne peut pas s'afficher (import introuvable, erreur de
  syntaxe, exception non rattrapée, `#root` vide) : la boucle ne se déclenchait donc pas
  sur les pannes réelles.
- `ensureInstalled` ne réinstallait jamais après la première installation (marqueur
  `node_modules/.package-lock.json`) : une correction qui ajoute une dépendance était
  relancée sans elle.

## Changements

1. Sonde de santé de l'aperçu (`preview-health-model.ts`, `main/studio/preview-probe-*.ts`) :
   passe `vite build` dans un dossier jetable + chargement de l'URL loopback dans une
   fenêtre Electron cachée et cloisonnée ; un aperçu cassé relance la boucle de
   correction avec l'erreur réelle.
2. Réinstallation quand une dépendance déclarée manque (`use-app-studio.ts`).
3. Squelette de départ React/Vue + Vite écrit dans un dossier VIDE avant le tour d'agent
   (`starter-templates.ts`), annoncé au modèle.
4. Prompt de génération plus directif pour les piles npm (fichiers complets, imports
   résolubles, dépendances déclarées) et étape de plan correcte par pile.

## Mesures

Banc hors Electron (modules purs de Cowork + `buddy -p`, modèle local Ollama `qwen3.8`, 0 $),
une seule paire mesurée (todo list React + Vite), tours arrêtés vers 45 min :

| | Avant | Après |
|---|---|---|
| Critère historique « le serveur répond » | prêt, 0 correction | — |
| `vite build` | échec (`Could not resolve "./App"`) | réussi |
| `tsc --noEmit` | 1 erreur | 0 |
| Rendu | overlay Vite, `#root` vide | squelette non remplacé (la sonde le classe KO) |

Sonde en vraie fenêtre Electron 35 (Xvfb, Vite réel), 3 exécutions : squelette non remplacé,
exception à l'exécution et import manquant passent le critère historique, la sonde les classe
KO ; l'application saine est OK. Défaut trouvé ainsi : `innerText` vaut 0 dans une fenêtre
cachée, la sonde lit `textContent`.

Non mesuré : tableau de bord et jeu ; interface Electron complète ; pile `static`. Le gain du
squelette sur « l'app s'affiche » reste à prouver avec un modèle rapide (n = 1).
