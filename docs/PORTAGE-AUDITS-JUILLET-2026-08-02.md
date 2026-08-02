# Portage des audits de juillet — matrice de reprise

**État au 2 août 2026.** Le lot sécurité, deux sous-lots Tools/RAG et le
sous-lot Fleet lifecycle sont portés et commités sur trois branches isolées ;
ce document n'autorise toujours aucun merge ou push. Les
branches sources et leurs rapports ont été protégés par la sauvegarde P0
décrite dans `/home/patrice/Backups/code-buddy/2026-08-02-p0/MANIFESTE.md`.

## Cible de reprise

La cible de fait est `feat/mysoulmate-media-pipeline`, prise au commit
`c0dfa4ba` pour le lot sécurité puis au commit documentaire `33a0a41c` pour les
lots Tools/RAG et Fleet. Aucun portage n'a été basé sur `main`, `origin/main`,
`avatar-builder` ou `autopilot`.

La branche `codex/portage-security-july-2026` part de `c0dfa4ba`. Les branches
`codex/portage-tools-rag-july-2026` et
`codex/portage-fleet-lifecycle-july-2026` partent de `33a0a41c`. Le « continue »
de Patrice a autorisé ces portages isolés, mais pas leur intégration dans la
branche média.

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

### Résultat du lot sécurité

Le portage a été adapté au code courant, sans cherry-pick aveugle, en trois
commits :

| Commit | Périmètre |
|---|---|
| `6dd8090e` | Blocage de `NODE_OPTIONS`/`NODE_PATH`, expurgation audit xAI/Groq/OpenRouter/npm, tests de casse et d'egress. |
| `43461520` | SSRF sync fermé avec état DNS provisoire, persistance sensory validée par DNS, Guardian fermé et schéma strict. |
| `17f8b299` | Approbations UUID liées à l'identité, routage A/B et nettoyage des canaux, HKDF v2/v1, rotation atomique avec recovery, verrou et contrôle d'instance stale. |

Preuves finales : 17 fichiers de test ciblés, **451/451 réussis** ; typecheck
principal et Darkstar réussis ; lint global sans erreur (avertissements
préexistants seulement) ; `git diff --check` propre. Trois contre-revues
indépendantes ont donné **GO** sur environnement/audit, SSRF/Guardian et
crypto/approbations. La branche active `feat/mysoulmate-media-pipeline` est
restée intacte, hormis la modification utilisateur préexistante et non suivie
dans le lot : `.codebuddy/autonomy.json`.

Réserves opérationnelles non bloquantes : la rotation de clé est une maintenance
single-writer ; un verrou `.rotation.lock` orphelin après crash doit être retiré
manuellement seulement après avoir vérifié qu'aucune rotation n'est encore
active.

Seuls `53cc9b22` et le patch SSRF déjà remplacé ajoutaient des fichiers de test
dans la branche source. Les cinq autres patchs retenus ont donc reçu une
couverture de régression adaptée au code courant pendant le portage.

## Lot 2 — Tools/RAG, premiers sous-lots

Deux sous-lots indépendants ont été adaptés depuis `fix/tools-audit` sur
`codex/portage-tools-rag-july-2026` :

| Commit | Périmètre |
|---|---|
| `02735e6d` | Bash repasse par le dispatch central gardé (permissions, hooks, RunStore et lane non parallèle) ; l'annulation empêche le spawn avant et après confirmation et atteint la précompaction. La sortie Bash dite streaming est désormais émise une fois terminée. |
| `fe04829f` | Enregistrement des outils externes idempotent, fréquences/IDF recalculées et cache invalidé ; index BM25 réutilisé à corpus équivalent, signature JSON déterministe et termes obsolètes purgés. |

Preuves : **559/559** tests Tools/Bash élargis pour le premier sous-lot ;
**136/136** tests Tools/RAG pour le second ; typecheck principal et Darkstar,
lint ciblé sans erreur et `git diff --check` réussis. Deux contre-revues
indépendantes ont donné **GO**. Le vrai flux stdout/stderr Bash reste une dette
fonctionnelle explicite : il ne devra être réintroduit qu'à travers la voie
gardée, jamais par appel direct à `BashTool`.

Restent à reprendre séparément : JIT context, feedback/options de sélection,
réponse finale vide et deltas de coût. La compression adaptative et l'ancienne
implémentation d'annulation AsyncLocalStorage sont déjà remplacées dans la cible.

## Lot 4 — Fleet lifecycle, premier sous-lot

Le sous-lot autonome est commité sur
`codex/portage-fleet-lifecycle-july-2026` :

| Commit | Périmètre |
|---|---|
| `5d0e1589` | Les pongs WebSocket rafraîchissent l'activité des listeners passifs ; une fermeture inattendue rejette immédiatement les requêtes pendantes avec `DISCONNECTED` ; les chunks tardifs sont couverts et ignorés après résolution. |

Preuves : **49/49** tests Fleet/lifecycle directs puis **95/95** tests WebSocket
élargis ; typecheck principal et Darkstar, lint ciblé et diff-check réussis.
Contre-revue indépendante : **GO**, sans double rejet, fuite de requête vers un
socket reconnecté, changement d'auth/scopes ou fuite de ressource de test.

Restent à reprendre séparément : saturation/rate-limit atomique, rétention
bornée, assainissement Council, multiplexage borné et scopes no-auth loopback.

## Lots suivants

| Ordre | Lot source | Tip | Patchs absents | Chevauchements estimés | Règle de reprise |
|---:|---|---|---:|---:|---|
| 2 | Tools/RAG | `064cdca1` | 14 | 24 | **Deux sous-lots portés** (`02735e6d`, `fe04829f`). Poursuivre par JIT, feedback/options, réponse vide et coûts, chacun séparément. |
| 3 | Providers/context | `36ee15bd` | 11 | 19 | Prioriser compression des messages système, schémas `tools` et résultats synthétiques ; écarter les correctifs Gemini/annulation déjà équivalents. |
| 4 | Fleet | `efe36039` | 11 | 8 | **Lifecycle porté** (`5d0e1589`). Poursuivre par saturation/rétention, nettoyage Council, multiplexage et scopes loopback. |
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
