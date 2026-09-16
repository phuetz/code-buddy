# Corrections des fonctions avancées : skills et DGM

13 septembre 2026. Branche `codex/audit-ameliorations-2026-09-13`, base `d48e1c39f`, worktree `~/DEV/cb-audit-ameliorations-2026-09-13`.

Commits de code : `8d4c989eb` (confinement), `67607d978` (skills), `adac52513` (évaluation et promotion).

## Changements

| Constat de l'audit | Correction et preuve |
|---|---|
| Skill créé mais introuvable | `create_skill` utilise le même installateur que la forge, au chemin `.codebuddy/skills/authored-*/SKILL.md`. Test du vrai outil, puis rechargement du vrai registre. |
| YAML invalide avec un nom contenant `:` | Sérialisation YAML, nom canonique et validation avant écriture ; cas `Review: French` vérifié. |
| Workspace déduit du cwd global | L'adaptateur reçoit `context.cwd`. Le moteur de skills utilise aussi son `workDir` pour l'installation. |
| Frontmatter pouvant substituer une identité | Nom du document obligatoirement identique au nom demandé ; refus avant écriture. |
| Écrasement d'un skill épinglé | Création et mise à jour passent par la même vérification ; overwrite explicite, épinglage prioritaire, restauration du fichier si le chargement échoue. |
| Mauvais conseil validé par ses mots-clés | Structure et couverture restent des contrôles préliminaires. L'installation par la gate d'amélioration exige une preuve comportementale ; le moteur compare des tâches avec/sans le skill dans le vrai harnais. Les contenus de fichiers, suppressions, préservation et ordre des effets sont vérifiés. Un exemple contenant tous les mots attendus mais supprimant sans sauvegarde est rejeté. |
| Outil généré pouvant lire hors du runtime | Landlock et seccomp dans un bootstrap Linux : accès limités aux bibliothèques système et au répertoire temporaire, sockets et création de processus refusées, capacités supprimées, limites CPU/mémoire/fichiers/descripteurs. Lectures et écritures extérieures refusées en exécution réelle. |
| Compteur Vitest confondant fichiers et tests | Rapport JSON séparé, validé et borné ; les logs des sous-processus ne polluent plus le calcul. Compatibilité du parser texte restreinte à la ligne `Tests`. |
| Score plafonné par les contrôles de validité | TypeScript et tests sont des conditions bloquantes de poids nul pour le score d'évolution. L'objectif par défaut mesure 17 tâches réelles du harnais ; succès partiel possible et progression mesurable, sans baisse d'une tâche précédemment réussie. |
| Mauvaise référence évaluée | Résolution de la référence en SHA, puis évaluation dans un worktree temporaire indépendant du checkout courant, y compris lorsqu'il contient des changements non commités. |
| Branche fusionnée différente du commit évalué | Refus si la branche a bougé, si les contrôles échouent ou si une régression est présente. La fusion cible le SHA évalué. Tests de la commande réelle dans des dépôts temporaires. |

Deux corrections connexes : le nettoyage des worktrees utilise leur propre dépôt, et le préambule RPC JavaScript emploie des imports dynamiques dans un bloc pour ne plus entrer en collision avec les imports du script. Les répertoires privés d'exécution des outils générés sont supprimés après l'appel.

L'archive de skills conserve les résultats appariés et les empreintes du document installé et du benchmark. Le store de variantes conserve le SHA de base et le rapport détaillé des composantes. Le confinement et le runtime des outils générés rejoignent les chemins protégés de l'évolution.

## Validation

- `npm run validate` ciblé : **776 tests verts, 3 ignorés**, 75 fichiers verts et un ignoré ; lint sans erreur, typecheck principal/GPU/companion-core et dix tests de packaging verts.
- Essais de confinement réels en JavaScript, TypeScript et Python ; refus des lectures/écritures hors périmètre, sockets et sous-processus ; calcul normal et nettoyage vérifiés.
- Cinq tests Git réels : référence figée, refus de branche déplacée, refus de contrôles rouges/régressions, fusion du SHA exact. Ils opèrent exclusivement dans des dépôts temporaires.
- Sonde historique convertie en non-régression : les comportements fautifs sont désormais refusés, et 92 tests sont bien comptés comme 92. L'égalité de scores reste rejetée : le correctif porte sur l'objectif gradué, pas sur un assouplissement du critère de gain.
- Le benchmark hors ligne mesure **16/17 tâches réussies** sur ce checkout : la formulation de recherche « voir le contenu » n'est pas classée première. Il s'agit d'une mesure de qualité, séparée des tests bloquants, et d'une piste pour un futur cycle d'évolution ; aucun gain obtenu par génération LLM n'est revendiqué ici.
- Deux cas supplémentaires (rollback du chargement et exigence de preuve comportementale) ont ensuite été ajoutés : leur suite de 17 tests est verte. Total distinct : **778 tests ciblés verts**, plus dix tests de packaging.
- Build final exit 0. Smoke du code compilé : exécution d'un calcul confiné et comptage de vrais tests via le rapport JSON, tous deux réussis (`skills-dgm-fix-compiled-smoke.log`).
- Privacy : 39/40, mêmes cinq chemins préexistants que la base, aucun nouveau fichier signalé. Journaux `_qa/audit/skills-dgm-fix-*`.

## Conditions et limites pratiques

- Confinement actuel : Linux, Python 3, Landlock ABI ≥3, seccomp ; architectures x86_64 et aarch64 (x86_64 testé ici). En dehors de ces conditions, les outils générés refusent l'exécution au lieu de revenir à un mode non confiné. Les bibliothèques système restent lisibles, le reste du système de fichiers ne devient pas accessible via un chemin absolu.
- `improve skills --apply` ajoute jusqu'à quatre appels de modèle par scénario de départ, pour deux tâches comparées avec/sans skill. Sans fournisseur ou sans gain observé sans régression, rien n'est installé. Ces petites fixtures ne prouvent pas une amélioration générale ni une significativité statistique ; les preuves concernent les tâches exécutées.
- La création explicite par `create_skill`/forge produit un skill créé et chargé, pas une amélioration démontrée. Elle ne déclenche pas automatiquement une campagne LLM. Les anciens fichiers du sous-dossier `workspace/` ne sont ni activés ni déplacés automatiquement.
- L'objectif DGM par défaut est hors ligne ; `--eval-task <ids...>` sélectionne explicitement les tâches LLM, qui nécessitent un fournisseur accessible depuis l'environnement d'évaluation. Les variantes de code restent soumises à revue et à confirmation avant intégration.
- Aucun cycle LLM, service, push, fusion de la branche de travail ou modification de données personnelles durant cette correction.
