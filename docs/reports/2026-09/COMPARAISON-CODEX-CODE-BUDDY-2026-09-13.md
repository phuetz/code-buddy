# Améliorations de Code Buddy tirées du code de Codex

Audit du 13 septembre 2026, demandé par Patrice. **Quatre chantiers concrets retenus**, dont deux urgents dans l'exécution streaming. Ils sont proposés ici ; leur implémentation ne fait pas partie des quatre corrections sessions/mémoire déjà livrées dans `AUDIT-AMELIORATIONS-2026-09-13.md`.

## Source et méthode

Clone officiel : `git clone --depth 1 https://github.com/openai/codex.git ~/DEV/openai-codex-audit-2026-09-13`.

Révision examinée : **`dfaf451426868c22e6859f5494150fd6338c3257`**, datée du 13/09/2026 à 04:59:49 UTC. Clone propre, lecture seule ; aucun build ni test Rust lancé. Le fichier LICENSE indique Apache-2.0. Les propositions portent sur des mécanismes à adapter en TypeScript ; aucun code Rust n'est copié dans Code Buddy.

Comparaison avec Code Buddy, base `8b5c61def`, worktree `~/DEV/cb-audit-ameliorations-2026-09-13`, en tenant compte des correctifs sessions/mémoire en cours. Lecture ciblée des implémentations et de leurs raccords, plus une sonde réelle de troncature. Ce n'est ni un audit exhaustif ni une mesure comparative de performance.

| Ordre | Intégration proposée | Gain attendu | Taille relative |
| --- | --- | --- | --- |
| 1 — P1 | Borner les buffers de sortie dès la réception | Une commande bavarde ne fait plus croître indéfiniment la mémoire de l'agent | Moyen |
| 2 — P1 | Terminer explicitement le cycle des processus streaming | Annulation, expiration et erreur de lancement rendent toujours la main | Moyen |
| 3 — P2 | Préserver début et fin lors de la compression d'urgence | Conserver le diagnostic final d'un build ou d'un test | Petit |
| 4 — P2 | Rendre les erreurs de journal persistantes et visibles | Ne plus confondre événements observés en mémoire et réellement enregistrés | Moyen |

## 1. Borner les buffers dès la réception

**Codex.** [`HeadTailBuffer`](https://github.com/openai/codex/blob/dfaf451426868c22e6859f5494150fd6338c3257/codex-rs/core/src/unified_exec/head_tail_buffer.rs#L5) conserve un préfixe stable et une fin glissante dans une capacité bornée. Il compte les octets omis et les indique à la restitution. [`OutputHandles`](https://github.com/openai/codex/blob/dfaf451426868c22e6859f5494150fd6338c3257/codex-rs/core/src/unified_exec/process.rs#L62) utilise ce buffer pour les processus.

**Écart vérifié.** `src/tools/bash/streaming-executor.ts:217` concatène chaque chunk à `stdout` ou `stderr` et l'ajoute également à `chunks`. Aucune borne locale sur ces trois accumulations. Même avec un consommateur rapide, les chaînes finales gardent toute la sortie ; un consommateur lent ajoute une file croissante. Une troncature ultérieure du résultat ne borne pas cette consommation pendant l'exécution. Constat limité à ce chemin direct ; le backend sandbox a sa propre collecte.

**Adaptation.** Ajouter un buffer réutilisable début/fin avec comptage des octets, et borner séparément la file de streaming. Choisir une politique explicite de pression sur le producteur ou d'omission de chunks ; borner seulement la chaîne finale serait insuffisant. Conserver stdout/stderr et le statut de sortie séparément. Décoder les caractères UTF-8 coupés entre deux chunks sans les corrompre. Une sauvegarde complète éventuelle doit suivre la politique de rétention et de confidentialité, pas créer systématiquement un second log en clair.

**Validation attendue.** Processus local émettant un volume supérieur au budget, consommateur délibérément lent, gros chunk unique, UTF-8 fragmenté, stdout/stderr alternés. Vérifier les capacités retenues, les marqueurs, la présence du diagnostic final et le code de sortie. Aucun test de charge réel de ce type n'a été lancé dans cet audit.

## 2. Un cycle de vie explicite pour les processus streaming

**Codex.** [`ProcessState`](https://github.com/openai/codex/blob/dfaf451426868c22e6859f5494150fd6338c3257/codex-rs/core/src/unified_exec/process_state.rs#L1) distingue fin, code de sortie et erreur. [`process.rs`](https://github.com/openai/codex/blob/dfaf451426868c22e6859f5494150fd6338c3257/codex-rs/core/src/unified_exec/process.rs#L231) expose terminaison, interruption et propagation d'échec ; le gestionnaire orchestre ces opérations. C'est la séparation état/notification/nettoyage qui est intéressante à reprendre.

**Écarts statiques.** Dans `src/tools/bash/streaming-executor.ts`, l'expiration envoie SIGTERM au processus direct ; `killProcess()` utilisé pour l'annulation vise le groupe sur Unix. La boucle ne se termine que sur `close`. Un processus qui ignore SIGTERM peut donc la garder ouverte. Le nettoyage teste `proc.killed` avant SIGKILL : cet indicateur signifie qu'un signal a été envoyé, pas que le processus a fini. Enfin, ce chemin ne raccorde pas l'événement `error` du ChildProcess à un résultat d'outil.

**Adaptation.** Unifier expiration et annulation autour d'un état terminal unique : réveiller le consommateur, préserver la cause, terminer le groupe lorsque supporté, escalader après délai en fonction de la sortie réellement constatée, nettoyer timers/listeners une fois. Raccorder `error`, `close` et interruption anticipée du générateur. Garder une implémentation adaptée à Windows. Ne pas réécrire les règles d'approbation déjà centralisées dans `execution-policy.ts`.

**Validation attendue.** Erreur de spawn, processus ignorant SIGTERM, descendant gardant stdout ouvert, annulation pendant l'attente, arrêt anticipé du consommateur. Prouver une durée bornée, aucun descendant survivant et un seul résultat terminal. Ces défauts n'ont pas été reproduits en lançant des processus récalcitrants pendant cet audit : ils sont établis ici par lecture du chemin.

## 3. Garder le diagnostic final lors de la compression d'urgence

**Codex.** [`output-truncation`](https://github.com/openai/codex/blob/dfaf451426868c22e6859f5494150fd6338c3257/codex-rs/utils/output-truncation/src/lib.rs#L32) centralise une politique en octets/jetons et tronque au milieu. Les payloads d'outils structurés sont traités sans transformer le succès en texte.

**Écart reproduit.** `ContextManagerV2.truncateToolResults`, `src/context/context-manager-v2.ts:1003`, ne garde que les 500 premiers caractères. Sonde exécutée contre la méthode TypeScript réelle : log de compilation de 1 727 caractères avec `FINAL_ERROR: missing export` à la fin ; le résultat conserve l'identifiant de l'appel mais **perd le diagnostic final**. Preuve locale : `_qa/audit/codex-comparison-probe.log`.

Code Buddy possède déjà un aperçu début/fin dans `src/context/tool-output-masking.ts:49`, utilisé pour le vieillissement des résultats. Il faut unifier le contrat des deux chemins, pas ajouter un troisième mécanisme concurrent. Cet aperçu est fondé sur les lignes : sa réutilisation doit aussi imposer une borne pour une ligne géante.

**Adaptation.** Extraire une primitive commune avec budget explicite, préfixe, suffixe et marqueur d'omission. La stratégie d'urgence peut rester très restrictive, tout en préservant la fin. Ne pas changer l'identifiant d'appel ni découpler appel et résultat ; garder la réparation du transcript.

**Validation attendue.** Même log avant/après : erreur finale préservée dans le budget ; chaîne sans saut de ligne, emoji aux frontières, sortie courte byte-identique, paires d'outils intactes. C'est le premier petit lot recommandé une fois les urgences du streaming prises en charge.

## 4. Distinguer événement observé et événement enregistré

**Codex.** [`RolloutRecorder`](https://github.com/openai/codex/blob/dfaf451426868c22e6859f5494150fd6338c3257/codex-rs/rollout/src/recorder.rs#L132) sérialise ses commandes d'écriture, propose un `flush()` avec acquittement et garde une erreur terminale observable. Son writer tente une réouverture après une erreur. Cela ne constitue pas à lui seul une promesse de résistance à une coupure électrique.

**Existant Code Buddy.** `RunStore` possède déjà `events.jsonl`, une filiation des runs et un lecteur tolérant les lignes malformées. Ajouter simplement « des rollouts JSONL » serait redondant. Les sessions JSON et leur chiffrement restent un contrat distinct.

**Écart vérifié.** `src/observability/run-store.ts:342` journalise les erreurs de stream au niveau debug. `emit():420` ajoute l'événement en mémoire et incrémente le compteur sans acquittement d'écriture. `getEvents():658` privilégie ce buffer mémoire : il peut ainsi montrer un événement non enregistré sur disque. La fin de run ferme déjà le stream avant les analyseurs ; cette fermeture doit conserver et exposer l'état d'échec.

**Adaptation.** Ajouter un état de persistance par run (`pending`, `flushed`, `failed`) et un `flush` attendu aux frontières significatives. Une erreur disque doit rester consultable et visible au demandeur, sans bloquer toute conversation pour un journal d'observabilité optionnel. Séparer compte reçu et compte confirmé. Borner la file et définir le comportement après erreur avant d'ajouter un retry, pour éviter les doublons. Réutiliser les identifiants existants ou introduire une séquence explicite au besoin.

**Validation attendue.** Stream simulé avec erreur asynchrone après `write`, redémarrage/relecture réelle, file sous pression, arrêt pendant un flush, dernière ligne partielle. Vérifier que la vue mémoire ne peut pas annoncer une persistance réussie après échec. Pas de panne disque injectée dans cet audit.

## Ce que je ne propose pas de dupliquer

- Code Buddy a déjà contexte compressé, réparation des paires d'outils, forks de runs, PTY, sandbox et règles d'approbation. Leur seule présence dans Codex ne justifie pas une réécriture.
- Le fournisseur OpenAI et le protocole app-server de Codex ne doivent pas devenir des dépendances obligatoires d'un agent multi-fournisseur.
- La version d'historique et la rétention des instructions de Codex sont intéressantes, mais aucun défaut précis de concurrence de compaction n'a été établi ici dans Code Buddy : pas de chantier affirmé sans preuve.

Livrables : clone local intact, ce rapport et la sonde de troncature consignée dans les preuves QA. Aucune des quatre adaptations proposées ci-dessus n'est encore implémentée par cet audit comparatif. Les corrections précédentes de sessions/mémoire sont documentées séparément.
