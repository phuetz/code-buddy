# Hermes Agent et OpenClaw : adaptations utiles pour Code Buddy

Comparaison documentaire du 13 septembre 2026. Base locale : `9b117b3dc`, branche `codex/audit-ameliorations-2026-09-13`. Les publications officielles ont été consultées en ligne ; les mécanismes locaux ci-dessous ont été lus. Aucun runtime externe installé ou testé. Les idées proposées ne sont pas des correctifs déjà implémentés.

## Versions observées

- Hermes Agent **v0.21.2**, tag **v2026.9.11**, publication du 11 septembre : robustesse de state.db, séparation des profils et conservation du cache entre interfaces. Une panne de l’index de recherche doit pouvoir dégrader la recherche sans sacrifier les conversations. [Publication officielle](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.9.11).
- OpenClaw **v2026.9.4**, publiée le **11 septembre** : le numéro du tag n’est pas sa date de publication. [Publication officielle](https://github.com/openclaw/openclaw/releases/tag/v2026.9.4). Le changelog décrit notamment la réutilisation des préfixes de prompts et la qualification des mises à jour avant activation. [Changelog officiel](https://raw.githubusercontent.com/openclaw/openclaw/main/CHANGELOG/2026.9.4.md).
- La fenêtre précédente apporte aussi la continuation Code Mode et des améliorations de reprise des réponses. [Versions OpenClaw](https://github.com/openclaw/openclaw/releases).

## Ce qui existe déjà

Ne pas recréer ces fonctionnalités sous un autre nom :

- `src/scheduler/watchdog-handlers.ts` exécute des contrôles sans LLM. `src/daemon/cron-agent-bridge.ts` utilise déjà `preCheck` et une empreinte pour éviter du travail inchangé.
- `src/fleet/peer-session-store.ts` conserve les conversations ; son contrat est explicitement limité à un processus. `src/fleet/saga-store.ts` représente les étapes et identifie les sagas à reprendre.
- `src/tools/code-exec-tool.ts` garde le processus JavaScript pendant les appels asynchrones d’une cellule et possède un stockage explicite entre cellules. `src/harness/tool-harness.ts` fournit découverte, appel et attente. Cela ne constitue pas une reprise durable après arrêt du processus hôte.
- `src/optimization/prompt-cache.ts` et `cache-breakpoints.ts` gèrent déjà des aspects du cache. Leur présence ne prouve pas la stabilité du préfixe sur chaque changement d’interface ou continuation.
- `src/memory/memory-consolidation.ts` conserve une source dans ses objets et produit une mémoire condensée. Une source textuelle ne suffit pas à établir toute la provenance de chaque affirmation.
- Nos derniers correctifs journalisent l’application d’un skill avant installation, rapprochent la preuve après interruption et refusent les archives corrompues en écriture.

## Chantiers proposés, par ordre pratique

| Priorité | Adaptation proposée | Point d’entrée local | Preuve attendue |
|---|---|---|---|
| 1 | Missions longues avec identifiant durable, propriétaire temporaire, résultat conservé et accusé de réception | `fleet-supervisor.ts`, sagas, journal des runs | Interrompre le pilote avant/après résultat, reprendre avec un second pilote ; aucun lancement en double et aucun résultat perdu. Un effet externe ambigu doit rester à réconcilier. |
| 2 | Mesure de stabilité du préfixe envoyé au fournisseur | Construction des messages, cache, continuations d’outils | Comparer les messages réellement émis sur deux tours et après reprise ; compter les changements inutiles, puis mesurer les tokens de cache si le fournisseur les expose. |
| 3 | Vérification TypeScript facultative des programmes d’outils, avec déclarations issues du catalogue autorisé | `code-exec-tool.ts`, catalogue scoped | Programme invalide rejeté avant tout effet ; aucun outil caché révélé ; programme valide identique sans vérification. |
| 4 | Carnet borné par tâche planifiée et dernier résultat effectivement traité | Scheduler et bridge cron | Redémarrage conservant le carnet ; isolation entre tâches ; échec d’une exécution suivi d’une vraie nouvelle tentative malgré une empreinte inchangée. |
| 5 | Mémoire vérifiable et reconstruction des seuls index dérivés | Consolidation, stockage et recherche mémoire | Chaque souvenir renvoie à ses éléments source ; index corrompu reconstruit sans modifier les originaux ; contradiction conservée plutôt qu’effacée silencieusement. |

Les priorités sont notre appréciation pour Code Buddy, pas un classement publié par les projets.

La vérification facultative et les déclarations d’outils sont détaillées dans la [PR OpenClaw 141265](https://github.com/openclaw/openclaw/pull/141265). La rétention de VM pendant les appels rapides y est un mécanisme distinct des checkpoints lors d’une suspension. Code Buddy en couvre déjà une partie ; recopier l’architecture entière ne serait pas justifié.

Le carnet durable par tâche est décrit dans la [PR Hermes 81139](https://github.com/NousResearch/hermes-agent/pull/81139). Il compléterait nos contrôles sans LLM ; il ne faut pas les remplacer par un agent systématique.

## Limites et prochaine tranche

Le superviseur natif livré dans `9b117b3dc` exécute des opérations fixes et bornées : il sert déjà à Code Explorer et lm-resizer, mais ne fournit pas encore le cycle durable d’une délégation longue. C’est le premier chantier proposé pour deux pilotes. Le défaut observé d’indexation en arrière-plan après fermeture d’un agent complet mérite aussi une correction dédiée.

Cette comparaison n’établit pas une absence globale de fonctionnalités : elle cible les points d’entrée lus. Avant implémentation, rechercher les autres contrats existants et réserver la zone correspondante. Aucun changement de sécurité, aucune mise à jour de dépendances ou copie de code externe dans cette tranche.

Validation : consultation de sources primaires ; lecture locale ciblée ; Code Explorer exécuté via `buddy fleet supervise … impact --json`, résultat réussi. Les 418 tests / 52 fichiers du superviseur précédent restent une preuve de cette livraison, pas une validation des propositions ci-dessus.

## Complément demandé : Liza

Dépôt officiel https://github.com/liza-mas/liza, clone local en lecture seule, commit `8f3e62665354f837bb504ac2cb10ec0bf979891f`. Aucun code exécuté ni dépendance installée.

Liza organise la livraison autour de rôles d’auteur et de relecteur, d’un tableau d’état auditable et de contraintes exécutables. Son usage des CLIs fournisseurs est compatible avec une organisation fondée sur des abonnements existants. [Présentation officielle](https://github.com/liza-mas/liza).

Trois mécanismes vérifiés par lecture méritent une adaptation ciblée :

1. **Réservation avec autorité versionnée.** `internal/ops/claim_task.go` sépare validation, préparation du worktree et validation finale sous verrou ; il transporte une expiration et vérifie de nouveau le HEAD avant certaines attributions. Une génération d’autorité protège les mutations des anciennes incarnations d’un agent. Pour Code Buddy : une réservation durable par tâche, avec renouvellement et rejet des résultats d’un propriétaire périmé. Test décisif : deux pilotes réclament la même tâche ; un seul gagne, puis le premier ne peut plus écrire après transmission.
2. **Passation structurée.** `internal/ops/handoff.go` transporte réussites, échecs, hypothèse, fichiers utiles, impasses et prochaine étape ; la transition de tâche et celle de l’agent sont groupées. Pour nous : une capsule courte, liée au commit et aux preuves, consommable par Fable ou un futur modèle sans relire tout le dialogue. Test : après redémarrage, la prochaine action et les fichiers modifiés restent accessibles, les impasses ne sont pas réessayées par défaut.
3. **Intégration conditionnée à l’état attendu.** L’ADR 0022 décrit la mise à jour Git conditionnelle pour éviter qu’une intégration concurrente écrase une autre progression. Pour Code Buddy : lier la revue au SHA exact et invalider l’approbation si le candidat change. Cela complète nos contrôles de promotion DGM, sans autoriser de fusion automatique nouvelle. Test : modifier le candidat après revue, vérifier le refus d’intégration.

Sources de code figées : [réservation](https://github.com/liza-mas/liza/blob/8f3e62665354f837bb504ac2cb10ec0bf979891f/internal/ops/claim_task.go), [passation](https://github.com/liza-mas/liza/blob/8f3e62665354f837bb504ac2cb10ec0bf979891f/internal/ops/handoff.go), [concurrence et intégration](https://github.com/liza-mas/liza/blob/8f3e62665354f837bb504ac2cb10ec0bf979891f/specs/architecture/ADR/0022-concurrency-hardening-singleton-blackboard-and-cas-merges.md).

**Choix proposé :** combiner les réservations et passations de Liza avec notre superviseur natif, puis les garanties de reprise et d’économie de contexte repérées chez Hermes/OpenClaw. Ne pas ajouter un second orchestrateur complet. Notre tableau Markdown reste la convention humaine ; les propriétés critiques doivent progressivement devenir des contrôles du harnais.
