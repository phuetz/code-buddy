# Ruche — rapport de mission

État initial : branche `feat/ruche-agents-2026-09-25`, base `6715ab53d`, worktree propre. État candidat : commits locaux `782d331bc`, `df03cdb36`, `4f65648f8`, sans push ni fusion. État déployé : aucun.

Snapshot du diff avant travail : vide (`git status --porcelain=v1` sans sortie). Patch delta initial : vide. Patch delta du candidat : `RUCHE.patch` dans le dossier de livraison de la mission ; il contient uniquement le diff depuis `6715ab53d`.

Les tests doivent suivre rouge → vert → mutant, avec profil jetable. La barrière Docker demandée par les règles communes n'est pas accessible depuis cette session (permission refusée sur le socket Docker) ; la tentative de barrière locale sans réseau échoue aussi au prévol réseau. **Aucun test, typecheck, build ou mutant n'a été exécuté.** Le candidat ne peut donc pas être déclaré validé.

Le prototype ajoute le journal Ed25519 chaîné par auteur, l'arbitre de baux avec refus signé et jeton de fencing, les verdicts liés à une révision, au journal et au rapport, la porte d'approbation à clé humaine épinglée, le statut stale des heartbeats, les méthodes RPC opt-in et la CLI JSON. Les oracles ciblés sont dans `tests/fleet/ruche.test.ts` et `tests/commands/ruche-command.test.ts`. La revue statique a conduit au commit `4f65648f8`, qui refuse les champs de charge non prévus par le schéma avant la vérification canonique.

Limites : la protection d'un worktree et des effets sortants exige que chaque écrivain et chaque outil concerné utilise le garde Ruche ; cette intégration globale n'est pas réalisée. Le lanceur existant ne consomme pas encore le statut de lane. Une tête de journal doit être conservée hors du profil pour prouver qu'aucune fin de chaîne n'a été tronquée. Voir le rapport de livraison pour le protocole de recette à deux machines.
