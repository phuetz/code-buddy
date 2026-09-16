# Bilan — `buddy explain`

Date : 2026-08-16

Branche : `feat/explain-repo-2026-08-16`

Commit fonctionnel : `6c83c822` (`feat(cli): add repository explanation artifact`)

Publication distante : aucune

## Résultat livré

La commande racine suivante est active et lazy-loaded :

```text
buddy explain [chemin] [--out <fichier.md|.html>] [--depth quick|deep] [--html]
```

- Markdown est le format par défaut.
- Une extension `.html` ou `--html` produit un document autonome sans script ni ressource réseau.
- Sans `--out`, le fichier est créé dans le répertoire courant sous la forme `codebuddy-explain-<repo>.md` ou `.html`.
- La seule écriture persistante du parcours est le fichier de sortie demandé. Le rendu Mermaid utilise un répertoire temporaire système supprimé dans un `finally`.

L'artefact contient systématiquement :

1. le rôle du dépôt, ses langages, frameworks, dépendances structurantes et entrées principales ;
2. ses dossiers/modules clés et un diagramme Mermaid ;
3. les points chauds classés à partir de la complexité, de la taille, des cycles et, si disponible, du churn Git ;
4. un parcours de lecture vers la documentation, l'entrée primaire, les modules principaux et des tests représentatifs.

## Orchestration des actifs existants

Le collecteur `src/analytics/repo-explainer-collector.ts` orchestre, sans appel LLM :

- `RepoProfiler.inspect()` et sa cartographie pour les métadonnées, couches, imports et composants, sans cache `.codebuddy`, indexeur de fond ni mutation du graphe partagé ;
- `complexity-analyzer.ts` sur un ensemble borné de fichiers JavaScript/TypeScript prioritaires ;
- `codebase-heatmap.ts` et `code-evolution.ts` uniquement lorsque le chemin demandé est la racine exacte d'un worktree Git ;
- `doc-generator.ts` en lecture seule pour inventorier les exports des entrées ;
- Code Explorer si un index existe déjà, avec auto-index explicitement désactivé ;
- le rendu PNG local de `mermaid-render.ts`, en repli sur la source Mermaid si `mmdc` ou Chromium est indisponible ;
- le shell HTML autonome et le dernier passage de suppression des secrets de `session-share.ts`.

`src/analytics/repo-explainer.ts` reste pur : il reçoit l'arbre, les métriques et le graphe éventuel, puis renvoie une structure indépendante du rendu. La collecte, la synthèse et les rendus sont donc testables séparément.

Deux adaptations des actifs étaient nécessaires au parcours read-only :

- Code Explorer expose un diagramme Mermaid sur stdout et permet de désactiver son auto-index ;
- l'analyse Git historique utilise désormais `execFileSync` avec des arguments séparés, afin qu'un nom de fichier du dépôt ne soit jamais interprété par un shell.

Le correctif d'import par défaut de `fast-glob` dans l'analyseur de complexité évite aussi l'échec réel observé au premier smoke ESM (`fast-glob` n'expose pas l'export nommé `glob` dans ce runtime).

## Dégradation vérifiée

- Dépôt vide et non Git : un Markdown utile est produit, sans fichier ajouté au dépôt analysé.
- Collecteur entièrement en échec : la commande produit encore un artefact minimal et consigne la limite.
- Code Explorer absent ou non indexé : diagramme construit depuis les imports, puis depuis les dossiers si aucun import n'est exploitable.
- Mermaid Code Explorer contenant une directive réseau, une URL, du HTML ou une configuration d'initialisation : graphe refusé et repli local.
- Git absent : aucune valeur de churn n'est inventée.
- Évolution historique trop coûteuse : elle est omise au-delà de 120 fichiers source en mode `quick` et 350 en mode `deep`; la heatmap reste active.
- Rendu Mermaid local indisponible : le HTML conserve la source Mermaid lisible et reste autonome.

## Vérifications exécutées

### Contrats et tests

- `npm run typecheck` : succès, compilateur principal puis `typecheck:gpuNode-identity`, zéro erreur.
- Tests ciblés : **10 fichiers, 167 tests réussis, 0 échec**.
  - explainer pur et rendus ;
  - commande et dépôt minimal ;
  - RepoProfiler read-only ;
  - Code Explorer et fraîcheur ;
  - session-share ;
  - Mermaid local ;
  - heatmap, évolution et complexité.
- ESLint ciblé : sortie 0, zéro erreur. Un avertissement préexistant hors diff reste dans `src/index.ts:1494` (`no-explicit-any`).
- Prettier ciblé sur les nouveaux modules et tests : tous les fichiers vérifiés sont conformes.
- `git diff --check` : succès.

Commande de tests exacte :

```text
npx vitest run tests/analytics/repo-explainer.test.ts tests/commands/explain.test.ts tests/agent/repo-profiler.test.ts tests/plugins/code-explorer.test.ts tests/plugins/code-explorer-freshness.test.ts tests/sessions/session-share.test.ts tests/tools/video/mermaid-render.test.ts tests/unit/codebase-heatmap.test.ts tests/unit/code-evolution.test.ts tests/unit/complexity-analyzer.test.ts
```

La suite complète d'environ 27 000 tests n'a pas été lancée, conformément à la consigne de tests ciblés.

### Smokes CLI réels

- `npx tsx src/index.ts explain --help` : aide complète affichée après le chargement paresseux.
- Fixture : Markdown de 2 544 octets, quatre sections et aucune création de cache dans la fixture.
- Fixture HTML : 19 592 octets, PNG Mermaid local incorporé en `data:`, CSP `default-src 'none'`, aucune URL `http://` ou `https://`.
- Worktree Code Buddy en mode `quick` : artefact de 125 lignes / 5 978 octets, produit en 2,58 s lors du smoke ; diagramme d'imports, huit points chauds et parcours de lecture présents.

Tous les artefacts temporaires de smoke ont été placés dans `/tmp` puis envoyés à la corbeille. Aucun push n'a été effectué.

## Limites factuelles

- La compréhension reste statique et heuristique : elle ne remplace pas l'exécution du produit ni une lecture métier humaine.
- L'analyse de complexité existante couvre JavaScript et TypeScript ; les autres langages contribuent encore aux langages, modules, tailles, Git et points d'entrée.
- Le diagramme Code Explorer dépend d'un index et d'un binaire déjà présents. La commande ne crée ni ne rafraîchit cet index.
- Un HTML peut contenir du texte provenant de la description du dépôt, mais sa CSP interdit tout chargement réseau ; aucun CDN, script ou feuille de style distante n'est émis.
