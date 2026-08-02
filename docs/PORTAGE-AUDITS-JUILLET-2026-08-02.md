# Portage des audits de juillet — matrice de reprise

**État au 2 août 2026.** Ce document prépare le portage ; il n'autorise aucun
merge ou cherry-pick. Les branches sources et leurs rapports ont été protégés
par la sauvegarde P0 décrite dans
`/home/patrice/Backups/code-buddy/2026-08-02-p0/MANIFESTE.md`.

## Cible de reprise

La cible de fait est `feat/mysoulmate-media-pipeline`, observée à
`cdff16f05e837f390352762e94660430f19e5fd5`. Elle contient `origin/main` et le
`main` local ; elle est respectivement en avance de 183 et 179 commits. Elle est
en avance de 72 commits sur son propre upstream et diffère d'`origin/main` sur
512 fichiers.

Une nouvelle branche de portage devrait donc partir du dernier descendant de ce
HEAD, jamais de `main`, d'`origin/main`, d'`avatar-builder` ou d'`autopilot`.
Patrice doit encore confirmer cette cible avant toute intégration de code.

## Lot 1 — sécurité

Les sept patchs de `fix/security-audit` sont absents de la cible selon
`git cherry`. Cette preuve porte sur les patch-IDs ; elle ne suffit pas à exclure
une correction équivalente plus récente.

| Ordre | Commit | Objet | Traitement préparé |
|---:|---|---|---|
| 1 | `53cc9b22` | Bloquer `NODE_OPTIONS` et `NODE_PATH` dans les processus enfants | Porter avec `tests/security/env-blocklist.test.ts` et `tests/security/filtered-env.test.ts`. |
| 2 | `771fe700` | Expurger les secrets avant tampon et écriture du journal d'audit | Porter, puis étendre `tests/security/audit-logger.test.ts`. |
| — | `a08c5e1f` | Revalider chaque redirection HTTP | **Ne pas cherry-picker directement** : la cible contient déjà `599fca9e` (validation des redirections) et `9d72563d` (DNS pinning). Faire seulement une comparaison sémantique et compléter les tests s'il reste un cas absent. |
| 3 | `50fab813` | Faire échouer `isSafeUrlSync` de manière fermée et signaler la reconfiguration du garde SSRF | Porter après revue de l'API actuelle, avec tests dédiés. |
| 4 | `7a84b01f` | Faire refuser Guardian en autonomie ou sans terminal sur erreur/configuration absente | Porter avec cas YOLO, non interactif et erreur LLM. |
| 5 | `5e289a08` | Dériver une sous-clé HKDF par enregistrement et documenter le risque de `rotateKey()` | Porter avec compatibilité de lecture v1, round-trip v2 et avertissement de rotation. |
| 6 | `cb7eb9cd` | Rendre les identifiants d'approbation imprévisibles et lier la réponse à l'initiateur | Porter avec tests d'identité du répondant, UUID et refus d'un tiers. |

Seuls `53cc9b22` et le patch SSRF déjà remplacé ajoutaient des fichiers de test
dans la branche source. Les cinq autres patchs recommandés doivent donc être
portés avec une preuve de couverture adaptée au code courant.

## Lots suivants

| Ordre | Lot source | Tip | Patchs absents | Chevauchements estimés | Règle de reprise |
|---:|---|---|---:|---:|---|
| 2 | Tools/RAG | `064cdca1` | 14 | 24 | Porter annulation, sélection d'outils et correction JIT commit par commit ; réexaminer les deux correctifs de coût déjà partiellement remplacés. |
| 3 | Providers/context | `36ee15bd` | 11 | 19 | Prioriser compression des messages système, schémas `tools` et résultats synthétiques ; écarter les correctifs Gemini/annulation déjà équivalents. |
| 4 | Fleet | `efe36039` | 11 | 8 | Traiter `pong`, requêtes pendantes, purge des tâches et nettoyage des réponses de pairs avant les fonctions nouvelles. |
| 5 | Memory/self-improve | `d9b85fa0` | 10 | 10 | Porter les limites/gates et l'expurgation CKG ; ne pas intégrer la mémoire locale sale. |
| 6 | Sensory | `d4edc8f2` | 9 | 11 | Sécurité d'abord, puis états de vision ; exécuter aussi les trois tests Python concernés. |
| 7 | Voice | `5e388a64` | 8 | 20 | Compléter l'AEC courant par files audio, interruptions et faux vocatifs. |
| 8 | Cowork | `1afd1f6b` | 12 | 11 | Prioriser permissions distantes, masquage des clés provider et écritures atomiques des workflows. |
| 9 | CWM | `8958343c` | 1 | 1 | Lot autonome de 16 fichiers, avec ses deux suites dédiées. |
| 10 | CI Cowork | `6a7132c8` | 1 | à confirmer | Aligner les workflows Cowork sur Node 22 si la cible utilise toujours Node 20. |
| 11 | MetaHuman | `27944c63` puis `e2bc0f75` | à isoler | 116 pour la branche consolidée | Extraire le constructeur, puis adapter seulement la détection Unreal sur `D:` ; ne jamais merger la branche complète. |
| 12 | Autopilot | `ed5200c1` | 16 | 745 | Dernier recours, commit par commit. Ne jamais porter le checkpoint de 705 fichiers `c4efa9aa`. |

Les nombres de chevauchements sont des indicateurs de conflit contre le snapshot
audité, pas une garantie de conflit futur.

## Portes de validation

Pour chaque lot : créer une branche neuve depuis la cible confirmée, porter un
commit fonctionnel à la fois, ajouter les tests manquants, exécuter d'abord les
tests ciblés puis `npm run lint`, `npm run typecheck` et une validation élargie
proportionnée. Aucun lot ne doit importer les rapports non suivis, les symlinks
`node_modules`, les résultats d'outils ou `.codebuddy/autonomy.json`.

Baseline avant portage sur la cible :

```text
npm test -- tests/security/env-blocklist.test.ts \
  tests/security/audit-logger.test.ts \
  tests/security/ssrf-dns-pinning.test.ts \
  tests/tools/ssrf-redirect.test.ts

4 fichiers réussis, 36 tests réussis, 0 échec (2 août 2026).
```

Les branches `avatar-builder` et `autopilot` restent des inventaires. Elles ne
sont jamais des destinations ni des sources de merge global.
