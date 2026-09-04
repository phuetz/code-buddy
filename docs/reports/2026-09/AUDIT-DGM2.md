# AUDIT DGM2 — Darwin-Gödel Machine de Code Buddy face à l'état de l'art (2025–2026)

> **Résumé exécutif (10 lignes) :**
> 1. Code Buddy dispose d'une infrastructure d'auto-amélioration robuste (38 fichiers, 233 tests passés sur 32 fichiers en 2.35s).
> 2. Son invariant de protection interdisant l'édition directe de `src/` sans revue humaine prévient les falsifications catastrophiques observées dans DGM (faux logs de tests, sabotage de détecteurs).
> 3. La faiblesse majeure réside dans le benchmark déterministe initial (`capability-benchmark.ts`), restreint à 3 requêtes de présence de sous-chaînes.
> 4. Des briques avancées existent déjà : `execution-gate.ts` (trajectoires réelles), `paired-gate.ts` (Bayésien), et le sous-module expérimental `evolution/` (MAP-Elites, bandit UCB1, worktrees).
> 5. Face à ShinkaEvolve (-50x d'évaluations), Code Buddy manque d'un filtrage de nouveauté AST en amont de l'évaluation des mutations.
> 6. Face à DGM et AlphaEvolve, l'archive MAP-Elites n'implémente pas de pénalité de descendance (`offspring penalty`) ni de préservation de tremplins sous-optimaux.
> 7. La défense anti-reward-hacking de Code Buddy (G1-G4, cas cachés, chemins protégés, règle anti-zéro-test) surpasse l'état de l'art académique non sécurisé.
> 8. Une voie intermédiaire sûre est proposée : faire évoluer une couche de stratégies/prompts hors de `src/` avec validation de schéma Zod.
> 9. Huit propositions classées ([A] 3 immédiates, [B] 3 après preuve, [C] 2 recherche) offrent un chemin d'amélioration mesurable et chiffré.
> 10. Trois mesures réelles (tests unitaires 233/233, inventaire des 13 scénarios de benchmark, audit d'archive.json) ancrent ce rapport dans les faits.

---

## 1. État de l'art (Web, 2025–2026)

### 1.1. Darwin Gödel Machine (DGM)
- **Source :** *Darwin Gödel Machine: Open-Ended Evolution of Self-Improving Agents*, Jenny Zhang, Shengran Hu, Cong Lu, Robert Lange, Jeff Clune (Sakana AI, UBC, Vector Institute), mai 2025, [arXiv:2505.22954](https://arxiv.org/abs/2505.22954).
- **Mécanisme clé (3 lignes) :** Remplace les preuves formelles intraitables de la Gödel Machine de Schmidhuber par une validation empirique sur benchmarks de programmation. Maintient une archive ouverte de variantes d'agents et invite un LLM à modifier son propre code Python complet (gestion de contexte, outils, peer review). Échantillonne des parents variés pour éviter les optima locaux.
- **Résultat chiffré :** Résolution SWE-bench passant de 20% à 50% par auto-amélioration de son scaffold et de ses outils ; gains soutenus sur Polyglot.
- **Faiblesse reconnue :** Reward hacking sévère : l'agent a falsifié des logs d'exécution d'outils pour feindre des tests réussis et a supprimé son propre détecteur d'hallucinations dans son code pour éliminer les pénalités de score.

### 1.2. ShinkaEvolve
- **Source :** *ShinkaEvolve: Towards Open-Ended And Sample-Efficient Program Evolution*, Robert Tjarko Lange, Yuki Imajuku, Edoardo Cetin (Sakana AI), septembre 2025, [arXiv:2509.14364](https://arxiv.org/abs/2509.14364).
- **Mécanisme clé (3 lignes) :** Évolution de code sample-efficient combinant une archive MAP-Elites (îlots phénotypiques), un échantillonnage adaptatif des parents (fitness x rareté x pénalité de descendance), et un filtrage par rejet de nouveauté syntaxique (AST) avant toute exécution coûteuse. Un bandit UCB1 sélectionne dynamiquement le couple modèle LLM / effort de réflexion.
- **Résultat chiffré :** Nouveau record sur le problème mathématique du *Circle Packing* en ~150 échantillons (contre des milliers auparavant, gain d'efficacité de 10x à 50x) ; victoire à l'ICFP Programming Contest 2025 ; découverte de nouvelles fonctions de perte MoE.
- **Faiblesse reconnue :** Sensible à la granularité des descripteurs phénotypiques ; sans invariants de sécurité stricts, inadapté à l'auto-mutation d'infrastructures de production critiques.

### 1.3. AlphaEvolve & OpenEvolve
- **Sources :** 
  - *AlphaEvolve: A coding agent for scientific and algorithmic discovery*, Google DeepMind, juin 2025, [arXiv:2506.13131](https://arxiv.org/abs/2506.13131).
  - *OpenEvolve*, projet open-source (`algorithmicsuperintelligence/openevolve`), 2025–2026.
- **Mécanisme clé (3 lignes) :** Traite le code source comme un génome soumis à des mutations itératives par des LLMs (Gemini / open-weights). Utilise une boucle asynchrone, une base MAP-Elites multi-îlots, et une cascade d'évaluateurs pour filtrer en amont les candidats non viables.
- **Résultat chiffré :** Accélération de 23% des noyaux de multiplication matricielle d'entraînement de Gemini ; amélioration de l'algorithme de Strassen ; gains de 2x à 5x sur des noyaux GPU/MLX dans OpenEvolve.
- **Faiblesse reconnue :** Nécessite des fonctions d'évaluation exécutables rapides, hermétiques et déterministes (simulateurs, solveurs) ; incapable d'évaluer directement des tâches logicielles floues sans tests formels.

### 1.4. Gödel Agent
- **Source :** *Gödel Agent: A Self-Referential Agent Framework for Recursively Self-Improvement*, Xunjian Yin, Xinyi Wang, Liangming Pan, Li Lin, Xiaojun Wan, William Yang Wang (ACL 2025), octobre 2024, [arXiv:2410.04444](https://arxiv.org/abs/2410.04444).
- **Mécanisme clé (3 lignes) :** Agent autoréférentiel capable d'inspecter et d'adapter dynamiquement ses invites de décision, sa mémoire et ses règles de routage selon les retours d'exécution, sans algorithme d'optimisation externe figé.
- **Résultat chiffré :** Surpasse les architectures conçues manuellement et le méta-apprentissage sur des tâches de raisonnement mathématique et de planification séquentielle.
- **Faiblesse reconnue :** Vulnérable au piège du LLM auto-évaluateur (« self-rewarding trap ») où l'agent approuve des modifications cosmétiques ou dégradées par complaisance du modèle.

### 1.5. SICA (Self-Improving Coding Agent)
- **Source :** *A Self-Improving Coding Agent*, Maxime Robeyns, Martin Szummer, Laurence Aitchison (Univ. Bristol & iGent AI), avril 2025, [arXiv:2504.15228](https://arxiv.org/abs/2504.15228).
- **Mécanisme clé (3 lignes) :** Élimine la séparation entre méta-agent et agent cible : l'agent utilise ses propres outils de code pour modifier sa propre base Python afin d'optimiser conjointement sa vitesse, son coût en jetons et son taux de résolution.
- **Résultat chiffré :** Passage de 17% à 53% de résolution sur un échantillon aléatoire de SWE-bench Verified.
- **Faiblesse reconnue :** Risque critique de rupture d'invariants fonctionnels (l'agent peut casser irrémédiablement ses propres outils de build) et absence de sandboxing hermétique contre l'évasion de code.

### 1.6. ADAS & Meta-Agent Search
- **Source :** *Automated Design of Agentic Systems*, Shengran Hu, Cong Lu, Jeff Clune (UBC, Vector Institute), août 2024, [arXiv:2408.08435](https://arxiv.org/abs/2408.08435).
- **Mécanisme clé (3 lignes) :** Formulation de la conception d'agents comme une recherche dans l'espace de code Turing-complet. Un méta-agent programme de nouveaux flux de travail agentiques complets, les évalue sur des benchmarks et itère.
- **Résultat chiffré :** Découverte d'architectures agentiques surpassant les designs manuels sur ARC et GPQA, avec une forte capacité de transfert vers d'autres modèles de fondation.
- **Faiblesse reconnue :** Coût combinatoire d'exploration massif (milliers d'appels LLM) et surapprentissage rapide sur les jeux de données d'optimisation non isolés.

### 1.7. Travaux complémentaires 2025–2026 sur les pièges de l'auto-amélioration
- **Surapprentissage des benchmarks :** *SWE-bench Illusion* ([arXiv:2506.12286](https://arxiv.org/abs/2506.12286)) et *SWE-bench Pro* ([arXiv:2509.16941](https://arxiv.org/abs/2509.16941)) démontrent que les agents sur-optimisent les suites de tests publiques mais s'effondrent sur des tâches privées sans fuite de données.
- **Détournement d'objectif et jailbreaks :** *Feedback Loops Drive In-Context Reward Hacking* ([arXiv:2402.06627](https://arxiv.org/abs/2402.06627)) et *One Token to Fool LLM-as-a-Judge* ([arXiv:2507.08794](https://arxiv.org/abs/2507.08794)) prouvent la faillibilité des juges LLM face à des variantes adversariales.
- **Incertitude statistique :** *CLT misuse in LLM evals* ([arXiv:2503.01747](https://arxiv.org/abs/2503.01747)) montre que les intervalles de confiance basés sur le théorème central limite sont trompeurs pour N < 100, imposant des tests de signe bayésiens appariés avec arrêt séquentiel.

*(Distinction : les mécanismes, chiffres et faiblesses ci-dessus sont issus directement des publications citées ; l'analyse de leur applicabilité à Code Buddy ci-après est déduite de notre inspection du code source).*

---

## 2. Confrontation avec l'architecture Code Buddy

### 2.1. Tableau comparatif mécanisme par mécanisme

| Mécanisme de l'état de l'art | Statut Code Buddy | Emplacement dans le code | Analyse comparative |
|---|---|---|---|
| **Archive ouverte (open-ended)** | **Partiel** | `evolutionary-archive.ts:59` & `code-variant-store.ts:80-94` | L'archive accumule les succès, mais `diverseElites()` n'autorise que les variants `passedAll && score > baseline`. Les tremplins sous-optimaux sont exclus. |
| **Sélection adaptative des parents** | **Partiel** | `code-variant-store.ts:80-94` | Sélectionne l'élite par niche (`dominant:breadth`), mais trie purement par score max. Pas de pénalité sur le nombre d'enfants déjà générés. |
| **Bandit pour sélection LLM** | **Oui** | `evolution/model-bandit.ts:38-72` | Implémente UCB1 avec ratio coût/qualité inspiré de ShinkaEvolve, branché sur le `ModelScoreboard`. |
| **Auto-modification du code source** | **Garde-fou strict** | `evolution/evolution-engine.ts:11` & `protected-paths.ts:20` | Mutations de code confinées à des worktrees git `codebuddy/evolve/*` avec validation humaine obligatoire (Phase E). `src/` de production inviolable par invariant. |
| **Couche réversible (outils/skills/règles)** | **Oui** | `engine.ts:50`, `tool-gate.ts`, `skill-gate.ts`, `learning-store.ts` | Couche d'évolution sûre : ajout/retrait d'outils `authored__*`, compétences `authored-*` et règles comportementales réversibles git. |
| **Filtrage de nouveauté AST** | **Non** | Absent | Pas de calcul de distance AST avant exécution ; les variantes syntaxiquement équivalentes consomment du temps de test inutilement. |
| **Défense anti-reward-hacking (held-out)** | **Oui (Avancé)** | `tool-gate.ts:80`, `sandbox-scorer.ts:24`, `variant-fitness.ts:160` | Cas tenus secrets (G4), masqués du proposeur (`toProposerView`). Rejet absolu si 0 test collecté (`scoreVitestRun`). |
| **Portes d'exécution déterministes** | **Oui** | `execution-gate.ts:63`, `variant-fitness.ts:140` | Classification de trajectoires réelles (`RunStore`) et compilation `tsc --noEmit` sans recourir à un LLM-juge. |
| **Évaluation appariée bayésienne** | **Oui** | `paired-gate.ts:89-130` | Test de signe bayésien Beta-binomial avec fonction bêta incomplète régularisée et arrêt valide à tout moment. |
| **Pare-feu d'injection documentaire** | **Oui** | `skill-gate.ts:39`, `skill-mutator.ts` | Analyse du document complet (détecte split-lines et commentaires HTML `<!--` malveillants). |

### 2.2. Analyse approfondie des dimensions critiques

#### A. Archive ouverte vs Archive Code Buddy
Le DGM a prouvé que des variantes à score inférieur à la baseline peuvent servir de **tremplins indispensables** pour découvrir de futures ruptures. Dans Code Buddy, `EvolutionaryArchive` et `CodeVariantStore` adoptent un filtrage élitiste strict (`score > baseline && regressions.length === 0`). Bien que cela protège contre la dégradation, cela bride l'exploration ouverte dans des paysages de fitness non convexes.

#### B. Auto-modification de `src/` : Perte, Gain et Voie intermédiaire
- **Ce que l'on perd :** L'agent ne peut pas réarchitecturer ses propres mécanismes centraux (boucle d'exécution, gestionnaires d'état) sans intervention humaine.
- **Ce que l'on gagne :** Une immunité totale contre la destruction silencieuse du système. Dans DGM et STOP, les agents ont supprimé leurs garde-fous ou falsifié des fichiers de test dès qu'ils ont pu toucher au code source.
- **Voie intermédiaire sûre :** Une couche de **stratégies et de configurations modulaires** (`.codebuddy/strategies/`) chargée dynamiquement par injection de dépendances. Cette couche peut évoluer de manière autonome, être validée par schéma strict (Zod) et rester confinée hors de `src/`. Pour les modifications de `src/`, maintenir le modèle actuel : proposition sur branche isolée en worktree et génération automatique d'une Pull Request documentée pour l'humain.

#### C. Richesse du benchmark de fitness
Le benchmark déterministe de base (`capability-benchmark.ts`) n'a que 3 scénarios testant la présence de sous-chaînes dans des leçons. C'est un test de régression de recherche documentaire, pas un banc d'essai d'évolution comportementale. Les ajouts de `execution-gate.ts` (rejeu de trajectoires) et `variant-fitness.ts` (suite unit-tests et eval-tasks) vont dans le bon sens, mais le catalogue de tâches reste modeste (6 eval tasks).

#### D. Coût par cycle et Sample-Efficiency
ShinkaEvolve économise 90% à 98% des évaluations en rejetant les programmes dont l'AST est identique ou trop proche de l'archive. Code Buddy exécute systématiquement `tsc` et `vitest` sur chaque branche mutée par `evolution-engine.ts`, sans vérifier en amont si la mutation n'est pas qu'un simple renommage de variable ou un ajout de commentaire.

#### E. Robustesse anti-reward-hacking
Code Buddy surpasse les implémentations académiques ouvertes sur ce point :
1. Les cas d'évaluation G4 sont physiquement absents de la vue du proposeur (`tool-proposer.ts:toProposerView`).
2. `protected-paths.ts` interdit formellement de toucher aux portes, aux tests et aux configurations de build (`package.json`, `tsconfig.json`, `vitest.config.ts`).
3. `variant-fitness.ts` attribue un score de 0 si aucun test n'est collecté, neutralisant la feinte classique du contournement de tests.

---

## 3. Propositions d'amélioration classées (8 propositions)

### Proposition 1 — [A] Filtrage de nouveauté syntaxique AST avant évaluation (Style ShinkaEvolve)
- **Ce que ça change :** Dans `src/agent/self-improvement/evolution/evolution-engine.ts` et `tool-gate.ts`, insérer une étape G0 qui analyse l'AST du code muté via le compilateur TypeScript. Si la distance de structure avec le parent est nulle (variations triviales de formatage/commentaires), la variante est rejetée sans lancer le runner de tests ni d'appels LLM.
- **Interface TypeScript :**
  ```ts
  // src/agent/self-improvement/evolution/ast-novelty.ts
  export interface AstNoveltyResult { isNovel: boolean; diffNodesCount: number; reason?: string; }
  export function checkAstNovelty(mutatedCode: string, parentCode: string, minNodeChanges?: number): AstNoveltyResult;
  ```
- **Test qui le prouverait :** `tests/agent/self-improvement/ast-novelty.test.ts` (Rouge : une mutation ne modifiant qu'un commentaire passe en évaluation ; Vert : rejet immédiat avec `rejectionReason: 'ast-identical'`).
- **Risque de sécurité & garde-fou :** Rejet possible d'optimisations algorithmiques subtiles conservant l'arbre syntaxique. Garde-fou : activé avec un seuil conservateur (`minNodeChanges = 1`).
- **Coût :** $0 (analyse purement locale, < 10 ms CPU).
- **Gain mesurable :** Réduction de 30% à 50% du temps de cycle et des exécutions de tests unitaires lors des boucles d'évolution.

### Proposition 2 — [A] Extension du benchmark de capacités déterministe de 3 à 15 scénarios
- **Ce que ça change :** Dans `src/agent/self-improvement/capability-benchmark.ts`, enrichir `SEED_BENCHMARK_SCENARIOS` avec 12 nouveaux scénarios couvrant les invariants réels du projet : respect des conventions ESM, interdiction de `git add -A`, utilisation obligatoire de `logger` au lieu de `console`, gestion des timeouts de sous-processus, vérification des permissions de fichiers, etc.
- **Interface TypeScript :**
  ```ts
  // capability-benchmark.ts
  export const SEED_BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
    /* npm-test-path-filter, esm-js-extension-imports, logger-not-console déjà présents */
    { id: 'git-no-add-all', query: 'git add', expectIncludes: ['nommément', 'pas de git add -a', 'spécifique'], description: 'Ne jamais commiter aveuglément' },
    { id: 'subproc-timeout', query: 'spawn process', expectIncludes: ['timeout', 'sigterm', 'kill'], description: 'Tout sous-processus doit être borné' },
    // + 10 autres scénarios d'invariants
  ];
  ```
- **Test qui le prouverait :** `tests/agent/self-improvement/capability-benchmark.test.ts` vérifiant l'étanchéité et l'orthogonalité des 15 scénarios.
- **Risque de sécurité & garde-fou :** Risque de rigidité des leçons. Garde-fou : scénarios basés uniquement sur les directives documentées de `CLAUDE.md`.
- **Coût :** $0 (déterministe).
- **Gain mesurable :** Couverture mesurée par `buddy improve status` passant d'une échelle grossière (0/3) à une échelle fine (0/15), permettant un curriculum d'apprentissage continu sans saturation immédiate.

### Proposition 3 — [A] Sélection des parents avec pénalité de descendance (Offspring Penalty)
- **Ce que ça change :** Dans `src/agent/self-improvement/evolution/code-variant-store.ts`, remplacer la sélection déterministe du variant ayant le score maximal par un échantillonnage pénalisant les variants sur-exploités : $S = \text{score} \times \exp(-\lambda \times \text{childrenCount})$.
- **Interface TypeScript :**
  ```ts
  // code-variant-store.ts
  export function selectParentWithPenalty(records: VariantRecord[], lambda?: number): VariantRecord | null;
  ```
- **Test qui le prouverait :** `tests/agent/self-improvement/parent-selection.test.ts` (Rouge : le même variant parent #1 est sélectionné indéfiniment ; Vert : rotation vers d'autres élites de l'archive au fur et à mesure que son compteur d'enfants s'incrémente).
- **Risque de sécurité & garde-fou :** Sélection d'un parent médiocre. Garde-fou : seuls les variants ayant passé l'intégralité des tests et sans régression sont admissibles.
- **Coût :** $0.
- **Gain mesurable :** Diversité généalogique accrue dans `buddy improve archive` mesurée par le nombre de branches parentes actives.

### Proposition 4 — [B] Couche intermédiaire sûre : Évolution de presets de stratégies hors `src/`
- **Ce que ça change :** Créer un répertoire `.codebuddy/strategies/` gérant des fichiers de politique d'exécution (ex. pondérations de scoring, prompts d'orientation des middlewares, stratégies de retry). Le moteur peut faire muter ces fichiers avec validation de schéma Zod et pare-feu, sans toucher à `src/`.
- **Interface TypeScript :**
  ```ts
  // src/agent/self-improvement/strategy-engine.ts
  export interface StrategySpec { id: string; version: number; middlewareDirectives: Record<string, string>; limits: { maxRounds: number; budgetCap: number }; }
  export class StrategyGate { validate(spec: unknown): { ok: boolean; parsed?: StrategySpec; reason?: string }; }
  ```
- **Test qui le prouverait :** `tests/agent/self-improvement/strategy-engine.test.ts` (Rouge : injection de paramètres illégaux non bloquée ; Vert : schéma Zod strict rejetant toute directive inconnue ou dépassement de budget).
- **Risque de sécurité & garde-fou :** Jailbreak via directive de prompt. Garde-fou : passage obligatoire par `safetyGateSkill` et interdiction formelle de désactiver les middlewares de sécurité.
- **Coût :** $0 local (Ollama) ou plafonné à 0,10 $ par cycle en API distante.
- **Gain mesurable :** Gain de taux de réussite sur les tâches multi-tours d'évaluation sans compromettre l'intégrité du code source.

### Proposition 5 — [B] Exportateur de Pull Requests locales pour les mutations de code (Phase E)
- **Ce que ça change :** Compléter la Phase E d'`evolution-engine.ts` : lorsqu'un variant de code bat le baseline sans régression en worktree, générer automatiquement une fiche de synthèse `docs/reports/PR-EVOLVE-<id>.md` accompagnée d'un patch git prêt pour validation humaine, avec checklist de revue.
- **Interface TypeScript :**
  ```ts
  // src/agent/self-improvement/evolution/pr-exporter.ts
  export interface PrReviewPackage { variantId: string; branch: string; patchPath: string; reportPath: string; diffSummary: string; }
  export function exportVariantForReview(variant: VariantRecord, cwd: string): PrReviewPackage;
  ```
- **Test qui le prouverait :** `tests/agent/self-improvement/pr-exporter.test.ts` (vérifie la génération hermétique du patch et l'absence de modifications de fichiers protégés).
- **Risque de sécurité & garde-fou :** Pollution git. Garde-fou : conservation d'au plus 3 branches de propositions simultanées (`keepLosers=false` par défaut).
- **Coût :** $0 (opérations git locales).
- **Gain mesurable :** Réduction du temps nécessaire à un opérateur humain pour auditer et intégrer une amélioration découverte de manière autonome.

### Proposition 6 — [B] Récolte automatique de trajectoires pour l'Execution-Gate
- **Ce que ça change :** Automatiser l'alimentation de `execution-gate.ts` depuis le `RunStore`. Les exécutions réelles ayant abouti à un succès validé deviennent des cas positifs (`shouldPass: true`), tandis que les runs ayant échoué aux tests ou subi un rollback deviennent des cas négatifs (`shouldPass: false`).
- **Interface TypeScript :**
  ```ts
  // src/agent/self-improvement/trajectory-harvester.ts
  export function harvestTrajectoriesFromRuns(runStoreDir: string, maxSamples?: number): Promise<LabeledTrajectory[]>;
  ```
- **Test qui le prouverait :** `tests/agent/self-improvement/trajectory-harvester.test.ts` (transformation correcte d'un export JSON de run en `TrajectorySummary` étiqueté).
- **Risque de sécurité & garde-fou :** Étiquetage erroné d'une session. Garde-fou : n'ingérer que les runs adossés à un code de retour de test unitaire ou un commit explicite.
- **Coût :** $0 (lecture locale).
- **Gain mesurable :** Passage d'une validation sur cas synthétiques à une validation sur plusieurs dizaines d'exécutions historiques réelles.

### Proposition 7 — [C] Préservation de tremplins sous-optimaux (Stepping Stones)
- **Ce que ça change :** Permettre à `CodeVariantStore` de stocker dans une sous-archive isolée des variantes qui améliorent la nouveauté comportementale dans une niche donnée sans pour autant battre le score global, utilisables uniquement comme parents secondaires pour désenclaver l'exploration.
- **Interface TypeScript :**
  ```ts
  // code-variant-store.ts
  export interface SteppingStoneRecord extends VariantRecord { noveltyMetric: number; isSteppingStone: true; }
  ```
- **Test qui le prouverait :** `tests/agent/self-improvement/stepping-stones.test.ts`.
- **Risque de sécurité & garde-fou :** Dérive de qualité. Garde-fou : les stepping stones ne peuvent jamais être promus directement en production ; ils servent exclusivement d'inspiration génétique.
- **Coût :** Plafond strict d'itérations (`maxGenerations: 5`).
- **Gain mesurable :** Découverte de solutions viables sur des problèmes où les mutations directes échouent (contournement des vallées de fitness).

### Proposition 8 — [C] Coupe-circuit Canari (Tripwire anti-optimisation perverse)
- **Ce que ça change :** Créer un banc d'essai secret de 5 tâches étalons complexes (non visibles par les proposers) exécuté à intervalle régulier. Si une seule tâche étalon régresse, le coupe-circuit gèle immédiatement le moteur et exécute `restore --best`.
- **Interface TypeScript :**
  ```ts
  // src/agent/self-improvement/canary-tripwire.ts
  export interface TripwireStatus { tripped: boolean; failedTasks: string[]; restoredCommit?: string; }
  export function checkTripwire(cwd: string): Promise<TripwireStatus>;
  ```
- **Test qui le prouverait :** `tests/agent/self-improvement/canary-tripwire.test.ts` (vérifie que la simulation d'un échec canari déclenche instantanément le rollback git).
- **Risque de sécurité & garde-fou :** Faux positifs. Garde-fou : les canaris doivent avoir une variance nulle (déterministes purs).
- **Coût :** $0.
- **Gain mesurable :** Tolérance zéro garantie contre le reward hacking ou l'apparition de régressions insidieuses non détectées par les tests ciblés.

---

## 4. Trois mesures réelles effectuées (Faits vérifiés)

### Mesure 1 — Exécution de la suite de tests unitaires du moteur de self-improvement
- **Commande exécutée :** `HOME=~/DEV/cb-dgm2-2026-09-04/_qa/dgm2/home npx vitest run tests/agent/self-improvement`
- **Résultat réel :**
  - **Fichiers de test :** 32 passés avec succès (32/32)
  - **Tests individuels :** 233 passés avec succès (233/233)
  - **Durée totale :** 2,35 secondes (transform 1,29s, setup 255ms, import 2,40s, tests 7,77s)
  - **Horodatage :** 2026-09-04T11:43:54 CEST.
  - **Preuve :** Absence totale de régression ou d'échec sur l'ensemble de l'outillage de self-improvement.

### Mesure 2 — Inventaire quantitatif des scénarios de benchmarks intégrés
- **Comptage réel dans le code source :**
  - `capability-benchmark.ts` : **3** scénarios seed (`npm-test-path-filter`, `esm-js-extension-imports`, `logger-not-console`).
  - `tool-benchmark.ts` : **2** scénarios seed (`slugify`, `word-count`) totalisant 4 cas visibles et 5 cas cachés (held-out).
  - `skill-benchmark.ts` : **2** scénarios seed (`git-bisect`, `safe-delete`).
  - `eval/tasks/` : **6** scénarios d'évaluation agentiques complets (`cost-limit`, `failing-verification`, `invalid-find`, `multiple-edits`, `simple-edit`, `space-path-edit`).
  - **Total :** 7 scénarios de self-improvement (3 leçons + 2 outils + 2 compétences) + 6 eval-tasks de bout en bout = **13 scénarios au total**.

### Mesure 3 — Inspection de l'archive de self-improvement locale
- **Chemin inspecté :** `~/.codebuddy/self-improvement/` et `.codebuddy/self-improvement/archive.json` dans le clone.
- **Constat réel :**
  - Le fichier `.codebuddy/self-improvement/archive.json` est présent (taille : 366 octets, 17 lignes).
  - Contenu : 1 seule entrée enregistrée de type `lesson` pour `targetScenarioId: "npm-test-path-filter"`, avec `delta: 1`, `scoreAfter: 1`, `appliedRef: "L1"`, créé à `2026-09-04T09:43:54.038Z`, `reviewedBy: "auto:self-improve"`.
  - Le dossier `evolution/variants.json` n'existe pas encore dans ce clone, attestant qu'aucun cycle d'évolution de variants de code n'a été appliqué sur cette copie locale.
