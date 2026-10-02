# Reprise de l'intégration Jules du 2 octobre 2026

Branche `jules/lot-cb-2026-10-02-matin-2`, départ `55fef0a3d`.

La relecture indépendante avait trouvé un test du manifeste cassé et trois réserves sur les tests ou le contrat CLI. Cette reprise conserve les décisions d'intégration initiales : quatre patchs appliqués, patch de validation de l'enveloppe rejeté car contraire au contrat de `--output-schema`, et patch Ollama reconnu comme doublon fonctionnel.

| Point de la revue | Traitement | Preuve |
| --- | --- | --- |
| B1 : identité du manifeste masquée par l'absence du snapshot | Le fixture d'identité crée désormais `dist/config/models-snapshot.json`. Aucun test existant supprimé, renommé ou affaibli. | Avant : 6/7 selon la revue, échec `missing dist/config/models-snapshot.json`. Sonde directe avant/après sur le fixture : erreur snapshot puis erreur attendue `corePackage.version does not match package.json`. |
| Test de copie dépendant de `dist` | Copie exportée pour un test sur répertoire temporaire neuf ; contrôle de l'absence de source et des skills conservé. | 3/3 tests packaging passent même après déplacement temporaire de `dist` ; `npm pack --dry-run --json --ignore-scripts` recense 5611 entrées, dont le snapshot, et aucune source map. |
| Détection du coût dans `index.ts` non testée et fragile | Raison structurée `session_cost_limit` sur les résultats d'outil sautés ; fonction de synthèse utilisée par `index.ts` et testée avec l'exécuteur réel. La limite après tour reste donnée par l'état de l'agent. | Mutation temporaire supprimant la métadonnée : test d'exécuteur rouge 1/1 ; remise : 227/227 tests ciblés et voisins verts. Test d'erreur en texte libre : aucune fausse détection. |
| `--output-schema` court-circuité par la limite de coût | Validation inconditionnelle de la réponse finale ; si elle échoue en même temps que la limite, sortie 3 et aucun fichier de sortie invalide. Contrat documenté. | Test JSON invalide avec limite : validation échoue, code 3 ; sans limite : code 1 ; JSON valide avec limite : validation réussit. |

Vérifications : build et typecheck passent ; vérification du manifeste construit passe. Huit fichiers de tests ciblés et voisins : 227 tests verts. ESLint ciblé : aucune erreur, 27 avertissements existants dans le grand test d'exécuteur. `git diff --check` passe. La revue avait validé `headless-output-flags` 7/7 et relevé un rouge de `headless-exit-code` également présent sur `origin/main`.

## Ce que je n'ai pas pu vérifier

Dans ce bac à sable, `runtime-manifest.test.ts` et `headless-output-flags.test.ts` ne peuvent pas être rejoués complètement : leurs sous-processus échouent avec `spawnSync EPERM` ou leur serveur local avec `listen EPERM`. `check:pack` rencontre le même refus de sous-processus npm (9 contrôles sur 11 passent) ; le `npm pack --dry-run` direct passe. La suite complète (~27 000 tests), l'installation npm dans un environnement séparé, Windows, macOS, Docker, le réseau et un Ollama réel n'ont pas été exécutés. Ce dépôt TypeScript n'a pas de commande .NET ou de GUI Avalonia concernée.
