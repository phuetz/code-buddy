# Analyse des fonctions avancées : skills, forge et Darwin Gödel Machine

13 septembre 2026. Source : branche `codex/audit-ameliorations-2026-09-13`, base `d1e2f0e15`, worktree `~/DEV/cb-audit-ameliorations-2026-09-13`. Audit de code et expériences synthétiques isolées ; aucun changement de production, aucun cycle LLM lancé, aucune variante fusionnée.

> Correctifs livrés dans la tranche suivante : [rapport de correction](CORRECTIONS-SKILLS-DGM-2026-09-13.md). La sonde vérifie désormais les comportements corrigés ; les constats ci-dessous décrivent la base auditée.

## Conclusion

Code Buddy possède une architecture d'auto-extension et d'évolution effectivement implémentée. Son point faible est la continuité entre **création, chargement, évaluation et promotion**. Certaines protections existent dans une voie et sont absentes dans une autre. Le signal d'évaluation du code est trop limité pour piloter une amélioration continue lorsque les tests sont déjà verts.

La DGM originale combine modification du code, mesure sur des tâches de programmation et exploration d'une archive de variantes. Code Buddy reprend ces mécanismes, avec une intégration humaine des changements de code. Cela ne démontre pas qu'il reproduit les gains de la publication : aucune campagne comparative de ce type n'a été exécutée dans cet audit. [Source primaire Sakana AI](https://sakana.ai/dgm/).

## Carte des capacités réellement présentes

| Fonction | Chemin réel | Validation et état |
|---|---|---|
| Création directe d'un skill | `create_skill` → `CreateSkillExecuteTool` → `CreateSkillTool` | Génère un fichier Markdown, scan du corps ; chemin et YAML défectueux dans les cas reproduits ci-dessous. |
| Forge pendant une conversation | `extension_forge` → `LiveSkillMutator` ou gate d'outil | Skill : scan et chargement immédiat explicite, sans mesure comportementale. Outil : préfixe `authored__`, scan et cas visibles/cachés. |
| Génération de skills depuis un programme d'apprentissage | `buddy improve skills` → `SkillImprovementEngine` → proposer → SG1–SG4 | Propositions persistées puis réévaluées lors de l'application. Sécurité statique et couverture lexicale ; pas de preuve que l'agent applique correctement les instructions. |
| Bibliothèque de skills | `SkillRegistry`, parser, matching de `CodeBuddyAgent` | Priorités workspace/managed/bundled, chargement dynamique, cache, watchers, injection des skills retenus dans le contexte. |
| Entretien des skills générés | `LiveSkillMutator`, consolidator, commandes `skills-*` | Mise à jour, patch, épinglage, archivage, restauration et consolidation. La création contourne toutefois l'épinglage. |
| Leçons apprises | `improve cycle/loop`, empirical gate, `LearningStore` | Snapshot, ajout transitoire, score de récupération, rollback, archive et versions Git isolées. Le score mesure la disponibilité d'un conseil, pas sa vérité. |
| Règles et validation comportementale | execution gate, paired gate, corpus | Règles évaluées sur trajectoires ; essai apparié avec/sans leçon sur réponses du modèle. Le test apparié n'est pas la validation systématique de tous les skills. |
| Stratégies | strategy engine/store/runtime | Paramètres de coût, tours, raisonnement et directives. L'overlay est branché dans l'entrée headless de `src/index.ts`, sous opt-in. Ne pas supposer une application identique à toutes les surfaces. |
| Évolution du code | `buddy evolve run/list/tree/review/keep` | Mutations sur branches/worktrees, chemins d'évaluation protégés, score, archive avec SHA et filiation, sélection de parents, niches de diversité, filtre de nouveauté AST et bandit de modèles optionnel. |
| Sources d'expérience | expériences de runs, journaux de délégation, notes du changelog, faiblesses issues d'evals/hotspots/recherche | Plusieurs sources locales et options sont câblées. La source sensorielle reste une interface ; le changelog décrit une évolution déjà réalisée, il ne la réalise pas lui-même. |

## Défauts reproduits

La sonde `tests/audit/skills-dgm-2026-09-13.mjs` documente les comportements actuels : ses assertions démontrent les défauts et devront être inversées après correction. Données fictives exclusivement, HOME et cwd temporaires.

### P1 — Création réussie, skill introuvable

`src/tools/create-skill-tool.ts` écrit `.codebuddy/skills/workspace/<slug>/SKILL.md`. Le registre utilise `.codebuddy/skills` et parcourt un seul niveau de sous-répertoires (`src/skills/registry.ts`, `findSkillFiles`). La sonde crée un skill valide puis charge le registre : il n'est pas découvert.

Le même outil construit son YAML par interpolation brute. Le nom ordinaire `Review: French` produit un document que le parser refuse alors que l'outil annonce le succès. L'adaptateur ignore également le contexte d'exécution et utilise le cwd global : constat de lecture, pas de reproduction multi-agent ici.

**Correction proposée :** unifier l'installation avec le chemin de la forge, recevoir explicitement le workspace, sérialiser le YAML, parser avant écriture et vérifier le chargement avant de déclarer le succès.

### P1 — Identité et épinglage contournables à la création

`LiveSkillMutator.create` vérifie `spec.name`, mais `ensureFrontmatter` conserve intégralement un frontmatter déjà fourni. La sonde utilise `spec.name=authored-container` et `name: synthetic-other-identity` dans le document : le registre charge cette seconde identité. La contrainte de namespace du chemin n'est donc pas celle de l'identité effective du skill.

Deuxième reproduction : créer un skill, l'épingler, puis rappeler `create` avec le même nom remplace son contenu. `update` protège l'épinglage ; `create` ne le fait pas. La forge utilise ce chemin. Un refus ultérieur de chargement ne constitue pas un rollback de l'écriture déjà faite.

**Correction proposée :** métadonnées canoniques obligatoires, contrôle des collisions et de l'épinglage dans l'unique point d'installation, publication atomique avec retour d'état réel du registre.

### P1 — Le runtime des outils générés n'est pas un confinement du système de fichiers

`authored-tool-runtime.ts` passe par `executeCode` avec HOME isolé, cwd temporaire et RPC désactivé. Cela supprime les secrets hérités de l'environnement, mais ne retire pas les droits du processus sur les chemins absolus.

La sonde fait passer un script de lecture par `inspectAuthoredCode`, puis l'exécute via `buildAuthoredTool` : il lit un fichier témoin situé hors de son répertoire temporaire. Aucun fichier personnel n'a été lu. Le commentaire « sandboxed » est donc plus fort que la protection réellement mesurée.

**Correction proposée :** droits explicites de lecture/écriture et réseau au niveau du processus ou du système, limites de ressources, puis mêmes contraintes pendant l'évaluation et l'exécution. Pour les outils de calcul pur, n'exposer que l'entrée structurée. L'isolation de HOME seule ne suffit pas.

### P2 — SG1–SG4 peuvent accepter une mauvaise procédure

Une proposition disant de ne jamais utiliser de filtre de chemin pour `npm test` et d'éviter les tests ciblés passe un scénario exigeant les mots `npm test`, `path filter` et `targeted`. SG3/SG4 font des recherches de sous-chaînes ; ils ne vérifient ni la négation ni l'application de la règle. SG1 vérifie une longueur minimale et un nom, pas un schéma complet de document comme le laisse entendre une partie de la documentation.

**Correction proposée :** conserver la couverture comme contrôle de pertinence, puis faire exécuter des tâches avec/sans le skill dans le harnais. Vérifier les actions et résultats, avec cas contradictoires, cas cachés et absence de régression. Réutiliser la couche de tests appariés sans la présenter comme une preuve tant que les trajectoires complètes ne sont pas évaluées.

### P2 — Mesure des tests erronée

`parseVitestCounts` dans `evolution/variant-fitness.ts` retient la première occurrence de `N passed`. Pour une sortie standard contenant `Test Files 2 passed` puis `Tests 92 passed`, il renvoie **2**, pas 92. Selon la sortie, il peut donc mesurer les fichiers plutôt que les cas, voire mélanger les deux unités.

**Correction proposée :** consommer le rapport JSON de Vitest et son décompte de cas ; refuser explicitement les rapports absents ou invalides.

### P1 fonctionnel — Score saturé : aucune progression possible depuis une base verte

La CLI construit seulement `defaultDeterministicComponents()` : typecheck et tests de l'auto-amélioration. Ces deux composantes valent 1 quand elles passent. `beatsBaseline` exige ensuite un score strictement supérieur, tout en imposant que toutes les composantes passent.

La sonde confirme qu'une candidate à 1 ne bat pas une base à 1. Ce résultat découle de la politique ; le défaut est le choix du signal. Dans le chemin CLI par défaut, une amélioration du harnais, du raisonnement ou des outils ne peut pas être distinguée si ces contrôles restent verts. Ce moteur peut constater une réparation d'une base rouge, mais ne dispose pas alors d'un gradient d'amélioration au-delà.

**Correction proposée :** séparer des critères bloquants de non-régression (types/tests/sécurité) et une performance graduée sur tâches représentatives (réussite, exactitude, coût, latence). Ne pas assouplir simplement le `>` en `>=`, ce qui récompenserait les mutations sans gain.

## Deux autres défauts établis par lecture, sans expérience de fusion

- **Référence de comparaison incohérente :** `evolve-command.ts` annonce qu'il score `baselineRef`, mais appelle `computeFitness` sur `process.cwd()`. Les variantes sont créées depuis la référence demandée. Si la branche courante ou ses modifications diffèrent de cette référence, la comparaison ne porte pas sur la base annoncée. Évaluer un SHA fixé dans un checkout isolé et enregistrer les conditions de mesure.
- **Promotion non liée au code évalué :** `evolve keep` enregistre un SHA dans le store mais fusionne `v.branch`, sans comparer sa tête à `v.sha`. La commande ne bloque pas non plus sur `passedAll=false` ou des régressions. L'interdiction de fusionner directement sur main/master et `--confirm` existent bien ; elles ne garantissent pas que le contenu fusionné est celui qui a été évalué. Vérifier le SHA, la provenance et les résultats au moment de la promotion, et fusionner le commit évalué.

## Ordre recommandé des travaux

1. Réparer l'installation commune des skills : workspace, YAML, identité, collisions, épinglage, retour de chargement et rollback. Ajouter des tests passant par les outils publics jusqu'au registre.
2. Confinement effectif des outils générés et évaluation reproductible des variantes : environnement, SHA de base, SHA candidat et rapport JSON des tests.
3. Brancher un benchmark de tâches dans le harnais : discovery → appel d'outil → observation → résultat. Séparer validité, sécurité et gain mesuré.
4. Enrichir l'archive avec les preuves : hashes des artefacts et du benchmark, versions des dépendances, modèle, coût, nombre d'essais, résultats appariés. N'appliquer et ne restaurer que des artefacts cohérents avec ces preuves.
5. Unifier la documentation et les statuts utilisateur : créé, chargé, vérifié structurellement, vérifié comportementalement, proposé, appliqué. Un seul « succès » masque actuellement trop d'étapes.

## Vérifications et limites

- Suite existante ciblée : **46 fichiers, 355 tests verts** (`tests/agent/self-improvement`, registre skills, forge, garde CLI de promotion). Les tests marqués `real` restent exclus par la configuration par défaut ; il ne s'agit pas d'une campagne LLM réelle.
- Sonde isolée : huit observations confirmées, dont une exécution réelle d'un outil généré et des lectures du registre réel. Les premiers essais ont également rencontré une collision du nom importé `readFileSync` avec le préambule RPC du runner ; l'alias `auditRead` permet la reproduction de confinement. Ce problème annexe n'a pas été corrigé.
- Les rapports historiques DGM5 documentent des créations antérieures ; leur présence n'est pas une preuve d'installation ni d'activation dans l'environnement courant. Aucun accès aux stores personnels pour le vérifier.
- `npm run validate` ciblé : exit 0, lint sans erreur, TypeScript principal/GPU/companion-core et dix tests de packaging verts ; les 355 tests sont rejoués avec succès.
- Privacy : 39/40, mêmes cinq fichiers préexistants que lors de la tranche précédente ; aucun nouveau chemin signalé dans les artefacts de cet audit.
- Reproduction : `npx tsx tests/audit/skills-dgm-2026-09-13.mjs` depuis le worktree ; la sonde crée elle-même ses répertoires temporaires et désactive fetch.
- Journaux dans `_qa/audit/skills-dgm-{tests,probe}.log`. Pas de changement de code de production, service, push ni fusion.
