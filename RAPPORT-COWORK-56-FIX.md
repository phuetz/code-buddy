# Rapport de correction — revue Cowork phases 5-6

- Branche : `feat/cowork-phases-5-6`
- Revue traitée : `REVUE-COWORK-5-6.md`
- Merge-base de référence : `f9a31a7e`
- Date de validation : 13 août 2026
- Résultat : les trois majeurs sont corrigés, dix mineurs sont corrigés, deux sont traités partiellement avec une limite explicitée et un réalignement historique est conservé. Les quatre suggestions ont été considérées et appliquées.

## Majeurs

### M1 — Compatibilité de `[model_pairs]`

**Constat.** Le chargement de `[model_pairs]` dans la nouvelle carte par tâche activait une configuration jusque-là dormante et changeait silencieusement le modèle du chat principal.

**Correction.** Une carte provenant du fichier ne reprend plus `model_pairs` par défaut. La compatibilité legacy n'est utilisée que sur opt-in explicite (`includeLegacyModelPairs`) ; l'appel programmatique historique `setModelPairs(...)` conserve cette possibilité. Le panneau présente les anciennes valeurs comme inactives et revient au modèle par défaut. La documentation et le changelog décrivent cette neutralité.

**Commit.** `f1a3fbe1 fix(routage): préserver la compatibilité de model_pairs`

**Tests.** Le test de non-régression dans `tests/agent/codebuddy-agent.test.ts` traverse l'entrée réelle d'un tour avec une configuration du merge-base contenant seulement `[model_pairs]` et affirme qu'aucun `setModel` ni routage automatique n'a lieu. Les cas d'opt-in, de priorité et de repli sont couverts dans `tests/config/task-models.test.ts` et `tests/agent/facades/task-model-routing.test.ts`.

### M2 — Rotation des secrets legacy

**Constat.** Un token en clair dans `channels.json` primait sur le coffre : enregistrer ou effacer un secret depuis le panneau pouvait afficher un succès tout en laissant l'ancienne valeur effectivement utilisée.

**Correction.** Le coffre est désormais consulté avant les littéraux legacy, pour le secret principal comme pour les secrets nommés. Après un enregistrement réussi, le littéral correspondant est purgé atomiquement de `channels.json`; l'effacement purge également le coffre et l'ancien champ clair. La présence d'un secret legacy est distinguée dans la vue IPC sans jamais exposer sa valeur.

**Commit.** `b1450fcc fix(cowork): rendre la rotation des secrets effective`

**Tests.** `tests/channels/resolve-channel-secret.test.ts` affirme qu'une valeur de coffre tournée gagne sur un token legacy. `cowork/tests/channels-ipc.test.ts` couvre la migration et la purge des secrets principaux et secondaires, ainsi que l'effacement après legacy.

### M3 — Lecture sans rechargement global

**Constat.** `taskModels.get()` appelait `ConfigManager.reload()` et pouvait écraser le profil ou les mutations runtime du singleton partagé lors d'une simple ouverture du panneau.

**Correction.** La lecture sans chemin explicite utilise `getConfig()` et n'a plus d'effet de bord. Le `reload()` reste réservé au chemin post-enregistrement.

**Commit.** `7132b49c fix(cowork): préserver la configuration runtime en lecture`

**Tests.** `tests/config/task-models-runtime-state.test.ts` installe un état runtime/profil, interdit tout appel à `reload()` et vérifie que la lecture restitue cet état sans le modifier.

## Mineurs

| N° | Traitement | Commit | Preuve |
|---:|---|---|---|
| 1 | Corrigé : la résolution du chemin de `channels.listConfig` est dans le contrat never-throw. | `48058dd3` | Test IPC avec `configPath` invalide. |
| 2 | Corrigé : une valeur vide envoie `null`, et `null` désaffecte les options autorisées, y compris numériques. | `48058dd3` | Tests du schéma, de l'IPC et du formulaire. |
| 3 | Corrigé avec M1 : effacer une association revient au défaut, sans résurrection de `[model_pairs]`. | `f1a3fbe1` | Tests de carte effective et du panneau. |
| 4 | Durci dans le périmètre Cowork : les variables inutilisées sont maintenant des erreurs ESLint et cinq éléments morts ont été supprimés. Les deux options TypeScript restent désactivées, car le programme Cowork inclut des modules racine transitifs et leur activation révèle environ cinquante erreurs préexistantes hors périmètre. | `0fcb7a61` | Typecheck Cowork et contrôle ESLint passants après nettoyage. |
| 5 | Corrigé : le catalogue statique reste disponible si `channels.json` est corrompu. | `48058dd3` | Test IPC du fichier JSON corrompu. |
| 6 | Corrigé : les opérations asynchrones sont terminées avant la section synchrone lecture-modification-écriture. | `48058dd3` | Test de deux mutations IPC concurrentes sans perte de champ. |
| 7 | Corrigé : l'overload ambigu à deux arguments de `setSecret` est supprimé. | `b1450fcc` | Typecheck du preload et tests IPC du contrat à trois arguments. |
| 8 | Corrigé : un fichier existant conserve son mode et ses fins de ligne CRLF/LF ; seul un nouveau fichier reçoit le mode `0600`. | `48058dd3` | Test de sauvegarde d'un TOML CRLF en mode `0640`. |
| 9 | Corrigé à la frontière exposée : le renderer ne peut plus fournir de `configPath` aux API channels/taskModels. Le paramètre interne au main process est conservé comme seam de test et pour les appelants de confiance. | `48058dd3` | Typecheck du contrat preload et tests IPC sur fichiers temporaires. |
| 10 | Corrigé : le classifieur reconnaît les formulations françaises usuelles de revue, recherche, planification et édition. | `98ddd87a` | Tests de classification, dont « Relis cette PR ». |
| 11 | Corrigé : une sélection par carte alimente `lastRoutingDecision` avec le type de tâche, sans facturer un appel d'auto-routage. | `98ddd87a` | Tests agent et façade sur la décision enregistrée et l'usage. |
| 12 | Partiellement corrigé : les identifiants valides contenant `@` ou `+` ne sont plus supprimés. Un identifiant direct inconnu reste accepté volontairement, car les providers personnalisés peuvent exposer des modèles absents du registre local ; le GUI continue de valider ses choix contre les modèles actifs. | `48058dd3` | Tests de parsing des identifiants exotiques et validation GUI existante. |
| 13 | Conservé : les réalignements de tests de `e8146294` corrigent des attentes déjà rouges au merge-base et sont nécessaires au gate intégral. Réécrire l'historique publié de la branche ou les annuler recréerait cette dérive sans améliorer la production. | `e8146294` | Suite Cowork intégrale verte : 2 946 tests. |

Les mineurs ont été regroupés dans deux lots fonctionnels supplémentaires : `48058dd3 fix(cowork): fiabiliser les configurations éditables` et `98ddd87a fix(routage): tracer et franciser les choix par tâche`. Le lot qualité et traduction est `0fcb7a61 fix(cowork): traduire le panneau et bloquer le code mort`.

## Choix sur les suggestions

1. **Purge et signalement des secrets legacy : appliqué.** La purge accompagne `setSecret` et `deleteSecret`; l'IPC expose uniquement le booléen `legacyPlaintextSecrets` et le panneau invite à sauvegarder pour migrer.
2. **Clés i18n `taskModels.*` : appliqué.** Le panneau utilise les traductions complètes en anglais, français et chinois, avec test de rendu.
3. **Effacement du brouillon secret au repli : appliqué.** Replier une ligne vide son état React local ; un test vérifie que la saisie ne réapparaît pas.
4. **Documentation de M1 : appliqué.** `CHANGELOG.md`, `docs/configuration.md`, `docs/providers.md` et `RAPPORT-COWORK-PHASES-5-6.md` indiquent que `[model_pairs]` reste inactif sans opt-in.

## Gates finaux

Exécutés après le dernier changement de production :

| Gate | Résultat |
|---|---|
| Racine — `npm run typecheck` | PASS |
| `cowork` — `npx tsc --noEmit` | PASS |
| `cowork` — `npx vitest run` | PASS — 527 fichiers réussis, 9 ignorés ; 2 946 tests réussis, 12 ignorés |
| `cowork` — `npx vite build` | PASS — renderer, main et preload construits ; avertissements Vite de chunks/imports dynamiques non bloquants |

## Inventaire des commits de correction

1. `f1a3fbe1` — M1, compatibilité de routage.
2. `b1450fcc` — M2, priorité du coffre et migration.
3. `7132b49c` — M3, lecture sans effet de bord.
4. `48058dd3` — robustesse des configurations éditables.
5. `98ddd87a` — classification et traçabilité du routage.
6. `0fcb7a61` — qualité Cowork et traductions.
7. Présent commit — rapport de correction et résultats des gates.

COWORK56 FIX TERMINEE 7
