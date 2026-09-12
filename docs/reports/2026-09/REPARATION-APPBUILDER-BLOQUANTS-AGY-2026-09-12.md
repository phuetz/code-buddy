# Rapport de réparation : Bloquants App Builder (Cowork)

- **Date** : 2026-09-12
- **Branche** : `agy/appbuilder-bloquants-2026-09-12`
- **Base** : `integration/appbuilder-2026-09-12` (`695f57b6c`)
- **Auteur** : Antigravity (Advanced Agentic Coding)

---

## 1. Synthèse des interventions

Trois bloquants majeurs d'App Builder ont été identifiés, analysés, corrigés et vérifiés par des tests automatisés et des preuves d'exécution. Le point C1 d'internationalisation de l'interface a également été traité.

| Bloquant | Problème observé | Cause racine identifiée | Correction apportée | Statut |
|---|---|---|---|---|
| **B1** | Bouton « Stop » inopérant dans App Studio pendant une génération | `NewShell.tsx` instancie l'objet `chat` avec `onSend` mais omet `onStop`. `AppStudioView.tsx` et `StudioChatPanel.tsx` transmettaient et appelaient ce callback absent. | `useIPC.stopSession` branché sur `chat.onStop` dans `NewShell.tsx`. `data-testid` ajoutés. Test unitaire/rendu démontrant le déclenchement de l'arrêt. | **Fermé (Prouvé)** |
| **B2** | « Run » sur projet gabarit échoue avec `ERR_MODULE_NOT_FOUND: Cannot find package '@vitejs/plugin-react'` | `CommandRunner` transmettait l'environnement parent (dont `NODE_ENV=production`) sans forcer `NODE_ENV=development`. npm omettait donc les `devDependencies`. `use-app-studio.ts` considérait la présence de `.package-lock.json` comme suffisante sans vérifier l'arborescence. | `CommandRunner` force `NODE_ENV=development` par défaut pour les sous-commandes projets et supporte les surcharges d'environnement. `use-app-studio.ts` lance `npm install --include=dev` avec `NODE_ENV=development` et vérifie l'existence effective de toutes les dépendances déclarées avant de valider le cache. `TemplateEngine` configure également `NODE_ENV=development`. | **Fermé (Prouvé)** |
| **B3** | Bouton « Export » actif mais n'exporte rien | `use-app-studio.ts` fournissait `workingDir: options.projectRoot ?? ''` au lieu de la racine courante mise à jour par le scaffold (`projectRoot`). `AppStudioView.tsx` ignorait silencieusement quand `workingDir` était vide. | `viewProps.workingDir` synchronisé sur la racine courante `projectRoot`. Bouton Export désactivé si aucun dossier n'est présent avec avertissement explicite. Les commandes orphelines sans racine signalent l'erreur dans le terminal. | **Fermé (Prouvé)** |
| **C1** | Libellés en anglais résiduels (« New app », « Editor », « Preview », « Versions », « Run », « Export », « Deploy ») | Libellés en dur dans `AppStudioView.tsx`. | Clés i18n ajoutées sous `appStudio` dans `fr.json`, `en.json` et `zh.json`. `AppStudioView.tsx` branché sur `useTranslation()`. | **Fermé (Prouvé)** |

---

## 2. Détail des correctifs et preuves d'exécution

### B1 — Câblage du bouton « Stop » d'App Studio
- **Fichiers modifiés** :
  - `<clone>/cowork/src/renderer/components/NewShell.tsx`
  - `<clone>/cowork/src/renderer/components/studio-iterate/StudioChatPanel.tsx`
- **Preuve par test** :
  - Test : `<clone>/cowork/tests/app-studio-stop-session.test.tsx`
  - Résultat : 2/2 tests passés avec succès (`vitest`).

### B2 — Installation complète des `devDependencies` des projets générés
- **Fichiers modifiés** :
  - `<clone>/cowork/src/main/studio/command-runner.ts`
  - `<clone>/cowork/src/renderer/components/studio/studio-api.ts`
  - `<clone>/cowork/src/renderer/components/studio/use-app-studio.ts`
  - `<clone>/src/templates/project-scaffolding.ts`
- **Preuve par tests & exécution** :
  - `<clone>/cowork/tests/command-runner.test.ts` : 7/7 tests passés (propagation `NODE_ENV=development` même sous `process.env.NODE_ENV='production'`).
  - `<clone>/cowork/tests/app-studio-use-studio.test.ts` : 4/4 tests passés (vérification de dépendances, invalidation du cache quand un paquet dev manque).
  - `<clone>/cowork/tests/app-studio-b2-b3-proof.test.ts` : génération du gabarit React, validation des devDependencies, exécution du runner.

### B3 — Export de projet zip fonctionnel
- **Fichiers modifiés** :
  - `<clone>/cowork/src/renderer/components/studio/use-app-studio.ts`
  - `<clone>/cowork/src/renderer/components/studio/AppStudioView.tsx`
- **Preuve par exécution** :
  - Création de l'archive zip depuis le projet généré par le gabarit, validation de la taille (> 0 octets), et vérification de la liste des entrées (`package.json`, `vite.config.ts`, `src/App.tsx`, exclusion de `node_modules`).

### C1 — Internationalisation App Studio
- **Fichiers modifiés** :
  - `<clone>/cowork/src/renderer/components/studio/AppStudioView.tsx`
  - `<clone>/cowork/src/renderer/i18n/locales/fr.json`
  - `<clone>/cowork/src/renderer/i18n/locales/en.json`
  - `<clone>/cowork/src/renderer/i18n/locales/zh.json`

---

## 3. Portes de qualité

| Porte de qualité | Commande | Résultat |
|---|---|---|
| Typecheck global | `npm run typecheck` | 0 erreur (Succès) |
| Lint global | `npm run lint` | 0 erreur, 2 497 avertissements préexistants préservés |
| Tests Jest (fichiers touchés) | `npm test -- tests/templates/project-scaffolding.test.ts` | 7/7 passés (Succès) |
| Tests Vitest cowork (fichiers touchés) | `cd cowork && npx vitest run tests/app-studio-stop-session.test.tsx tests/app-studio-use-studio.test.ts tests/app-studio-b2-b3-proof.test.ts tests/command-runner.test.ts` | 14/14 passés (Succès) |
| Tests de non-régression Studio | `cd cowork && npx vitest run tests/studio-chat-adapter.test.ts tests/app-studio-template-parity.test.ts tests/studio-dev-server.test.ts tests/studio-files.test.ts tests/studio2-export.test.ts` | 12/12 passés (Succès) |
| Build Linux cowork | `cd cowork && npx vite build` | Code 0 (Succès) |

---

## 4. Bilan d'outillage

- **Outillage** : 6 appels Code Explorer (`status`, `analyze --incremental`, `context`, `impact`), 16 commandes exécutées via `lm-resizer`, 351 573 octets économisés.
- **Index Code Explorer** : à jour / réindexé.

---

VERDICT: 3/3 bloquants fermés ; témoin 0/0
===LANE_AGY_APPBUILDER_BLOQUANTS_TERMINE===
