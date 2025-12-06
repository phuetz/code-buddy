# Chapitre 5 — Monte-Carlo Tree Search (MCTS)

---

> **Scène**
>
> *Lina a implémenté Tree-of-Thought. Ça marche mieux qu'avant, mais elle remarque un problème : parfois, l'agent explore trop de mauvaises pistes avant de trouver la bonne.*
>
> *"C'est comme jouer aux échecs en testant tous les coups possibles," réalise-t-elle. "Ce qu'il faudrait, c'est jouer comme AlphaGo."*
>
> *Elle se souvient du documentaire sur DeepMind. AlphaGo n'explorait pas toutes les possibilités — il simulait des parties, apprenait lesquelles fonctionnaient, et concentrait son exploration sur les coups prometteurs.*
>
> *"MCTS," murmure-t-elle. "Monte-Carlo Tree Search."*

---

## Introduction

Tree-of-Thought explore l'espace des solutions, mais peut s'égarer dans des branches peu prometteuses. **Monte-Carlo Tree Search (MCTS)** résout ce problème en utilisant des simulations pour guider intelligemment l'exploration.

MCTS est l'algorithme derrière les victoires d'AlphaGo. Adapté aux LLMs, il permet de trouver des solutions de haute qualité avec moins d'exploration que ToT.

---

## 5.1 Pourquoi MCTS pour les LLMs ?

### 5.1.1 Le problème de l'exploration aveugle

ToT explore en évaluant chaque pensée localement. Mais une pensée qui semble bonne localement peut mener à une impasse, et vice versa.

```
Exemple : Debugging

ToT évalue :
├─ "Vérifier les logs" → Score local : 0.8 (semble prometteur)
│   └─ ... mais les logs ne montrent rien d'utile
│
└─ "Reproduire le bug" → Score local : 0.5 (semble basique)
    └─ ... mais mène directement à la cause root !

Problème : L'évaluation locale ne prédit pas le succès final.
```

### 5.1.2 L'intuition MCTS

MCTS ne se contente pas d'évaluer localement — il **simule** jusqu'au bout :

```
MCTS :
├─ "Vérifier les logs"
│   └─ Simulation complète → Échec (pas d'info utile)
│   └─ Score mis à jour : 0.3
│
└─ "Reproduire le bug"
    └─ Simulation complète → Succès (bug trouvé et corrigé)
    └─ Score mis à jour : 0.9

Résultat : MCTS apprend que "reproduire" est meilleur que "logs"
           malgré l'apparence initiale.
```

### 5.1.3 Les quatre phases de MCTS

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CYCLE MCTS                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐            │
│   │   SELECT    │───▶│   EXPAND    │───▶│  SIMULATE   │            │
│   │             │    │             │    │  (Rollout)  │            │
│   └─────────────┘    └─────────────┘    └──────┬──────┘            │
│         ▲                                      │                    │
│         │                                      ▼                    │
│         │                              ┌─────────────┐              │
│         └──────────────────────────────│ BACKPROPAGATE│              │
│                                        └─────────────┘              │
│                                                                      │
│   Répéter N fois (budget de simulations)                            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

1. SELECT    : Choisir le nœud le plus prometteur (UCB1)
2. EXPAND    : Ajouter un enfant non exploré
3. SIMULATE  : Jouer jusqu'au bout (rollout)
4. BACKPROP  : Remonter le résultat dans l'arbre
```

---

## 5.2 La Formule UCB1

### 5.2.1 Le dilemme exploration/exploitation

- **Exploitation** : Aller vers ce qu'on sait être bon
- **Exploration** : Essayer des chemins peu visités

MCTS balance les deux avec la formule **UCB1** (Upper Confidence Bound) :

```
UCB1(node) = W/N + C × √(ln(P) / N)

Où :
- W = Nombre de "victoires" (simulations réussies)
- N = Nombre de visites du nœud
- P = Nombre de visites du parent
- C = Constante d'exploration (typiquement √2 ≈ 1.41)
```

### 5.2.2 Intuition de la formule

```
UCB1 = Exploitation + Exploration

        W/N                    C × √(ln(P) / N)
        ───                    ─────────────────
    Taux de succès           Bonus pour les nœuds
    observé                   peu visités

Exemple :
─────────
Nœud A : W=8, N=10, P=100
UCB1(A) = 8/10 + 1.41 × √(ln(100)/10)
        = 0.8 + 1.41 × √(4.6/10)
        = 0.8 + 0.96
        = 1.76

Nœud B : W=1, N=2, P=100
UCB1(B) = 1/2 + 1.41 × √(ln(100)/2)
        = 0.5 + 1.41 × √(2.3)
        = 0.5 + 2.14
        = 2.64  ← Sélectionné ! (peu visité)
```

### 5.2.3 Comportement au fil du temps

```
Début (peu de visites) :
┌────────────────────────────────────┐
│  Exploration domine               │
│  → Visite beaucoup de nœuds       │
│  → Construit une image large      │
└────────────────────────────────────┘

Milieu :
┌────────────────────────────────────┐
│  Équilibre                        │
│  → Explore les prometteurs        │
│  → Abandonne les mauvais          │
└────────────────────────────────────┘

Fin (beaucoup de visites) :
┌────────────────────────────────────┐
│  Exploitation domine              │
│  → Concentre sur les meilleurs    │
│  → Affine la solution             │
└────────────────────────────────────┘
```

---

## 5.3 Adaptation aux LLMs : RethinkMCTS

### 5.3.1 Différences avec MCTS classique

| Aspect | MCTS Jeux | MCTS LLM |
|--------|-----------|----------|
| Actions | Discrètes (coups) | Continues (texte) |
| Simulation | Rapide (règles du jeu) | Lente (appel LLM) |
| Récompense | Victoire/défaite | Qualité de la solution |
| État terminal | Fin de partie | Solution trouvée |

### 5.3.2 Le rollout LLM

Au lieu de simuler une partie, on demande au LLM de "simuler" une résolution complète :

```typescript
async function llmRollout(node: MCTSNode, problem: string): Promise<number> {
  const prompt = `
    Problème : ${problem}

    Chemin actuel :
    ${getPath(node).map(n => `→ ${n.action}`).join('\n')}

    Continue cette approche jusqu'à la résolution.
    Sois concis mais montre chaque étape.

    Ensuite, évalue le succès de 0 à 1 :
    - 0 : Échec total, mauvaise direction
    - 0.5 : Partiellement résolu
    - 1.0 : Complètement résolu

    Format :
    [Étapes de résolution]
    ...
    SCORE: X.X
  `;

  const response = await llm.complete(prompt, { temperature: 0.7 });
  return parseScore(response);
}
```

### 5.3.3 Le rollout avec exécution réelle

Pour le code, on peut exécuter réellement et obtenir un feedback objectif :

```typescript
async function executionRollout(
  node: MCTSNode,
  context: CodeContext
): Promise<number> {
  // Générer le code complet basé sur le chemin
  const code = await generateCode(node, context);

  try {
    // Exécuter dans une sandbox
    await sandbox.execute(code);

    // Lancer les tests
    const testResult = await runTests(context.testFile);

    // Score basé sur les tests
    return testResult.passed / testResult.total;
  } catch (error) {
    // Erreur = mauvaise solution
    return 0.1;
  }
}
```

---

## 5.4 Algorithme Complet

### 5.4.1 Structure de données

```typescript
interface MCTSNode {
  id: string;
  action: string;           // L'action/pensée de ce nœud
  parent: MCTSNode | null;
  children: MCTSNode[];

  // Statistiques MCTS
  visits: number;           // N
  totalReward: number;      // Somme des récompenses
  meanReward: number;       // W/N

  // Métadonnées
  depth: number;
  isTerminal: boolean;
  isFullyExpanded: boolean;
}

interface MCTSConfig {
  explorationConstant: number;  // C (default √2)
  maxIterations: number;        // Budget de simulations
  maxDepth: number;
  rolloutMethod: 'llm' | 'execution' | 'hybrid';
  expansionWidth: number;       // Nombre d'enfants par expansion
}
```

### 5.4.2 Pseudo-code complet

```typescript
class MCTS {
  private root: MCTSNode;
  private config: MCTSConfig;

  async search(problem: string): Promise<Solution> {
    this.root = this.createNode(problem, null);

    for (let i = 0; i < this.config.maxIterations; i++) {
      // Phase 1 : SELECT
      const selected = this.select(this.root);

      // Phase 2 : EXPAND
      const expanded = await this.expand(selected, problem);

      // Phase 3 : SIMULATE (Rollout)
      const reward = await this.simulate(expanded, problem);

      // Phase 4 : BACKPROPAGATE
      this.backpropagate(expanded, reward);
    }

    // Retourner le meilleur chemin
    return this.getBestPath();
  }

  // Phase 1 : Descendre l'arbre avec UCB1
  private select(node: MCTSNode): MCTSNode {
    while (!node.isTerminal && node.isFullyExpanded) {
      node = this.bestChild(node);
    }
    return node;
  }

  private bestChild(node: MCTSNode): MCTSNode {
    let bestScore = -Infinity;
    let bestChild: MCTSNode | null = null;

    for (const child of node.children) {
      const ucb1 = this.ucb1(child, node);
      if (ucb1 > bestScore) {
        bestScore = ucb1;
        bestChild = child;
      }
    }

    return bestChild!;
  }

  private ucb1(node: MCTSNode, parent: MCTSNode): number {
    if (node.visits === 0) {
      return Infinity; // Priorité aux non-visités
    }

    const exploitation = node.meanReward;
    const exploration = this.config.explorationConstant *
      Math.sqrt(Math.log(parent.visits) / node.visits);

    return exploitation + exploration;
  }

  // Phase 2 : Ajouter un nouvel enfant
  private async expand(node: MCTSNode, problem: string): Promise<MCTSNode> {
    if (node.isTerminal) {
      return node;
    }

    // Générer des actions possibles
    const actions = await this.generateActions(node, problem);

    // Filtrer celles déjà essayées
    const existingActions = new Set(node.children.map(c => c.action));
    const newActions = actions.filter(a => !existingActions.has(a));

    if (newActions.length === 0) {
      node.isFullyExpanded = true;
      return node;
    }

    // Créer un nouvel enfant
    const action = newActions[0]; // Ou random
    const child = this.createNode(action, node);
    node.children.push(child);

    if (node.children.length >= this.config.expansionWidth) {
      node.isFullyExpanded = true;
    }

    return child;
  }

  private async generateActions(
    node: MCTSNode,
    problem: string
  ): Promise<string[]> {
    const prompt = `
      Problème : ${problem}

      Chemin actuel :
      ${this.getPath(node).map(n => `→ ${n.action}`).join('\n')}

      Génère ${this.config.expansionWidth} actions/approches possibles
      pour continuer. Chaque action doit être distincte.

      Format : Une action par ligne
    `;

    const response = await this.llm.complete(prompt, { temperature: 0.8 });
    return response.split('\n').filter(line => line.trim().length > 0);
  }

  // Phase 3 : Simuler jusqu'au bout
  private async simulate(node: MCTSNode, problem: string): Promise<number> {
    switch (this.config.rolloutMethod) {
      case 'llm':
        return this.llmRollout(node, problem);
      case 'execution':
        return this.executionRollout(node);
      case 'hybrid':
        return this.hybridRollout(node, problem);
    }
  }

  private async llmRollout(node: MCTSNode, problem: string): Promise<number> {
    const prompt = `
      Problème : ${problem}

      Approche choisie :
      ${this.getPath(node).map(n => `→ ${n.action}`).join('\n')}

      Simule la résolution complète avec cette approche.
      À la fin, donne un score de succès entre 0 et 1.

      SCORE:
    `;

    const response = await this.llm.complete(prompt);
    const match = response.match(/SCORE:\s*([\d.]+)/i);
    return match ? parseFloat(match[1]) : 0.5;
  }

  // Phase 4 : Remonter la récompense
  private backpropagate(node: MCTSNode, reward: number): void {
    let current: MCTSNode | null = node;

    while (current !== null) {
      current.visits++;
      current.totalReward += reward;
      current.meanReward = current.totalReward / current.visits;
      current = current.parent;
    }
  }

  private getBestPath(): Solution {
    const path: MCTSNode[] = [];
    let current = this.root;

    // Suivre les enfants les plus visités (pas UCB1)
    while (current.children.length > 0) {
      current = current.children.reduce((best, child) =>
        child.visits > best.visits ? child : best
      );
      path.push(current);
    }

    return {
      path: path.map(n => n.action),
      score: path[path.length - 1]?.meanReward ?? 0,
      totalSimulations: this.root.visits
    };
  }
}
```

---

## 5.5 Implémentation Grok-CLI

### 5.5.1 Architecture du module

```
src/agent/reasoning/
├── mcts.ts                  # Implémentation principale
├── mcts-node.ts             # Classe MCTSNode
├── rollout/
│   ├── llm-rollout.ts       # Simulation par LLM
│   ├── execution-rollout.ts # Simulation par exécution
│   └── hybrid-rollout.ts    # Combinaison des deux
├── selection/
│   ├── ucb1.ts              # Formule UCB1
│   └── puct.ts              # Variante PUCT (AlphaGo style)
└── config.ts                # Configuration
```

### 5.5.2 Code principal

```typescript
// src/agent/reasoning/mcts.ts
import { LLMClient } from '../../grok/client';
import { MCTSNode, MCTSConfig, Solution } from './types';
import { UCB1Selector } from './selection/ucb1';
import { LLMRollout } from './rollout/llm-rollout';
import { ExecutionRollout } from './rollout/execution-rollout';

export class MonteCarloTreeSearch {
  private llm: LLMClient;
  private config: MCTSConfig;
  private selector: UCB1Selector;
  private rollout: LLMRollout | ExecutionRollout;

  constructor(llm: LLMClient, config: Partial<MCTSConfig> = {}) {
    this.llm = llm;
    this.config = {
      explorationConstant: Math.sqrt(2),
      maxIterations: 50,
      maxDepth: 6,
      rolloutMethod: 'hybrid',
      expansionWidth: 4,
      earlyStopThreshold: 0.95,
      ...config
    };

    this.selector = new UCB1Selector(this.config.explorationConstant);
    this.rollout = this.config.rolloutMethod === 'execution'
      ? new ExecutionRollout()
      : new LLMRollout(llm);
  }

  async search(problem: string, context?: CodeContext): Promise<Solution> {
    const root = new MCTSNode({
      action: problem,
      parent: null,
      depth: 0
    });

    let bestSolution: Solution | null = null;

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      // SELECT
      let node = root;
      while (!node.isTerminal && node.isFullyExpanded && node.hasChildren()) {
        node = this.selector.select(node);
      }

      // EXPAND
      if (!node.isTerminal && !node.isFullyExpanded) {
        const newNode = await this.expand(node, problem);
        if (newNode !== node) {
          node = newNode;
        }
      }

      // SIMULATE
      const reward = await this.simulate(node, problem, context);

      // BACKPROPAGATE
      this.backpropagate(node, reward);

      // Early stopping si on trouve une excellente solution
      if (reward >= this.config.earlyStopThreshold) {
        const solution = this.extractSolution(node);
        if (!bestSolution || solution.score > bestSolution.score) {
          bestSolution = solution;

          // Vérifier si la solution est vraiment bonne
          if (context && await this.verifySolution(solution, context)) {
            console.log(`Early stop at iteration ${iteration}`);
            return solution;
          }
        }
      }
    }

    return bestSolution ?? this.extractBestPath(root);
  }

  private async expand(node: MCTSNode, problem: string): Promise<MCTSNode> {
    // Générer des actions candidates
    const prompt = `
      Problème : ${problem}

      Chemin exploré jusqu'ici :
      ${node.getPath().map(n => `  → ${n.action}`).join('\n')}

      Propose ${this.config.expansionWidth} nouvelles approches ou étapes
      pour continuer. Sois créatif et explore des directions différentes.

      Format : Une approche par ligne, numérotées.
    `;

    const response = await this.llm.complete(prompt, {
      temperature: 0.9, // Plus de créativité pour l'exploration
      maxTokens: 500
    });

    const actions = this.parseActions(response);
    const existingActions = new Set(node.children.map(c => c.action));

    // Ajouter les nouvelles actions comme enfants
    for (const action of actions) {
      if (!existingActions.has(action)) {
        const child = new MCTSNode({
          action,
          parent: node,
          depth: node.depth + 1
        });
        node.addChild(child);

        // Vérifier si terminal
        if (child.depth >= this.config.maxDepth) {
          child.isTerminal = true;
        }
      }
    }

    // Marquer comme fully expanded si on a assez d'enfants
    if (node.children.length >= this.config.expansionWidth) {
      node.isFullyExpanded = true;
    }

    // Retourner un enfant non visité
    const unvisited = node.children.filter(c => c.visits === 0);
    return unvisited.length > 0 ? unvisited[0] : node;
  }

  private async simulate(
    node: MCTSNode,
    problem: string,
    context?: CodeContext
  ): Promise<number> {
    if (this.config.rolloutMethod === 'hybrid' && context) {
      // D'abord LLM pour évaluer rapidement
      const llmScore = await this.rollout.simulate(node, problem);

      // Si prometteur, vérifier avec exécution
      if (llmScore >= 0.7) {
        const execRollout = new ExecutionRollout();
        return execRollout.simulate(node, context);
      }

      return llmScore;
    }

    return this.rollout.simulate(node, problem);
  }

  private backpropagate(node: MCTSNode, reward: number): void {
    let current: MCTSNode | null = node;

    while (current !== null) {
      current.visits++;
      current.totalReward += reward;
      current.meanReward = current.totalReward / current.visits;

      // Mettre à jour la meilleure récompense vue
      if (reward > current.bestReward) {
        current.bestReward = reward;
      }

      current = current.parent;
    }
  }

  private extractBestPath(root: MCTSNode): Solution {
    const path: string[] = [];
    let current = root;

    while (current.hasChildren()) {
      // Sélectionner l'enfant avec le plus de visites (robuste)
      current = current.children.reduce((best, child) =>
        child.visits > best.visits ? child : best
      );
      path.push(current.action);
    }

    return {
      path,
      score: current.meanReward,
      confidence: current.visits / root.visits,
      totalIterations: root.visits
    };
  }

  private parseActions(response: string): string[] {
    return response
      .split('\n')
      .map(line => line.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter(line => line.length > 0);
  }
}
```

### 5.5.3 Variante PUCT (style AlphaGo)

```typescript
// src/agent/reasoning/selection/puct.ts
export class PUCTSelector {
  private cPuct: number;

  constructor(cPuct: number = 1.0) {
    this.cPuct = cPuct;
  }

  select(node: MCTSNode): MCTSNode {
    let bestScore = -Infinity;
    let bestChild: MCTSNode | null = null;

    const sqrtParentVisits = Math.sqrt(node.visits);

    for (const child of node.children) {
      // PUCT inclut une prior probability P(a)
      // Dans notre cas, on peut utiliser le score LLM initial
      const prior = child.priorProbability ?? 1 / node.children.length;

      const exploitation = child.meanReward;
      const exploration = this.cPuct * prior * sqrtParentVisits / (1 + child.visits);

      const puct = exploitation + exploration;

      if (puct > bestScore) {
        bestScore = puct;
        bestChild = child;
      }
    }

    return bestChild!;
  }
}
```

---

## 5.6 Combinaison ToT + MCTS

### 5.6.1 Quand utiliser quoi ?

| Situation | Recommandation | Raison |
|-----------|----------------|--------|
| Problème avec solution connue | ToT | Exploration large suffisante |
| Problème ouvert/créatif | MCTS | Besoin de simulation profonde |
| Budget API limité | ToT | MCTS plus coûteux |
| Code avec tests | MCTS | Feedback objectif par exécution |
| Architecture/design | Hybride | ToT pour générer, MCTS pour évaluer |

### 5.6.2 Architecture hybride

```typescript
// src/agent/reasoning/hybrid-reasoner.ts
export class HybridReasoner {
  private tot: TreeOfThought;
  private mcts: MonteCarloTreeSearch;

  async solve(problem: string, context: CodeContext): Promise<Solution> {
    // Phase 1 : ToT pour générer des candidats rapidement
    const candidates = await this.tot.solve(problem);

    // Si ToT trouve une excellente solution, l'utiliser
    if (candidates[0]?.score >= 0.9) {
      return candidates[0];
    }

    // Phase 2 : MCTS pour affiner les meilleurs candidats
    const mctsRoots = candidates.slice(0, 3).map(c => ({
      action: c.path.join(' → '),
      initialScore: c.score
    }));

    const mctsSolutions = await Promise.all(
      mctsRoots.map(root =>
        this.mcts.search(problem, {
          ...context,
          initialPath: root.action
        })
      )
    );

    // Retourner la meilleure solution MCTS
    return mctsSolutions.reduce((best, sol) =>
      sol.score > best.score ? sol : best
    );
  }
}
```

---

## 5.7 Cas Pratiques

### 5.7.1 Cas 1 : Bug de concurrence

```
Problème : "Le compteur de connexions devient négatif parfois"

MCTS Exploration (50 itérations) :
──────────────────────────────────

Itération 1-10 : Exploration large
├─ "Race condition sur l'incrémentation" (3 visites, reward 0.4)
├─ "Décrémentation appelée deux fois" (2 visites, reward 0.3)
├─ "Overflow integer" (2 visites, reward 0.1)
└─ "Bug dans la logique de cleanup" (3 visites, reward 0.6)

Itération 11-30 : Focus sur les prometteurs
├─ "Race condition" → "Ajouter mutex"
│   └─ Simulation : Tests passent mais deadlock possible
│   └─ Reward : 0.5
├─ "Bug cleanup" → "Vérifier la séquence de déconnexion"
│   └─ Simulation : Reproduit le bug !
│   └─ Reward : 0.8
└─ "Bug cleanup" → "Ajouter log avant décrémentation"
    └─ Simulation : Montre décrémentation sans connexion
    └─ Reward : 0.9

Itération 31-50 : Convergence
└─ "Bug cleanup" → "Vérifier état avant décrémenter"
    └─ Simulation : `if (connections > 0) connections--;`
    └─ Tests : 100% passent
    └─ Reward : 1.0 ← Early stop !

Solution trouvée en 42 itérations
```

### 5.7.2 Cas 2 : Optimisation de query SQL

```
Problème : "Query lente (5s) sur la table users avec 10M rows"

MCTS Exploration :
─────────────────

Phase Exploration :
├─ "Ajouter index" (reward moyen : 0.6)
├─ "Réécrire avec JOIN" (reward moyen : 0.4)
├─ "Partitionner la table" (reward moyen : 0.5)
├─ "Utiliser EXPLAIN ANALYZE" (reward moyen : 0.8)
└─ "Cacher les résultats" (reward moyen : 0.3)

Focus sur "EXPLAIN ANALYZE" :
├─ "Seq Scan détecté sur WHERE status = 'active'"
│   └─ "Ajouter index sur status" → 5s → 200ms ✓
│   └─ Reward : 0.95
└─ Solution validée par exécution réelle

Résultat : Index créé, 25x amélioration
```

### 5.7.3 Cas 3 : Génération d'algorithme

```
Problème : "Implémenter un algorithme de tri stable en O(n log n)"

MCTS avec 100 itérations :
─────────────────────────

Candidats générés :
├─ "Merge Sort" (reward : 0.95)
│   └─ Stable ✓, O(n log n) ✓
├─ "Tim Sort" (reward : 0.92)
│   └─ Stable ✓, O(n log n) ✓, plus complexe
├─ "Quick Sort" (reward : 0.3)
│   └─ Pas stable ✗
└─ "Heap Sort" (reward : 0.4)
    └─ Pas stable ✗

Exploration Merge Sort :
├─ "Version récursive classique" (0.90)
├─ "Version itérative bottom-up" (0.85)
├─ "Version avec insertion sort pour petits tableaux" (0.95)
│   └─ Implémentation générée et testée
│   └─ Tous les tests passent
│   └─ Early stop !

Solution : Merge sort hybride avec insertion sort pour n < 16
```

---

## 5.8 Optimisations Avancées

### 5.8.1 Parallelisation des rollouts

```typescript
async function parallelMCTS(problem: string, numWorkers: number = 4): Promise<Solution> {
  const root = createRoot(problem);

  // Pool de workers pour les simulations
  const workers = Array(numWorkers).fill(null).map(() =>
    new MCTSWorker(root)
  );

  // Exécuter en parallèle avec synchronisation
  await Promise.all(workers.map(async worker => {
    for (let i = 0; i < iterationsPerWorker; i++) {
      const node = worker.selectAndExpand();

      // Les rollouts peuvent être parallèles
      const reward = await worker.simulate(node);

      // Backprop avec lock (virtual loss pendant la simulation)
      worker.backpropagate(node, reward);
    }
  }));

  return extractBestPath(root);
}
```

### 5.8.2 Progressive widening

Limiter le nombre d'enfants progressivement :

```typescript
function shouldExpand(node: MCTSNode, alpha: number = 0.5): boolean {
  // Nombre max d'enfants selon les visites
  const maxChildren = Math.ceil(Math.pow(node.visits, alpha));
  return node.children.length < maxChildren;
}
```

### 5.8.3 Transposition table

Éviter de recalculer pour des états identiques :

```typescript
const transpositionTable = new Map<string, MCTSNode>();

function getOrCreateNode(state: string, parent: MCTSNode): MCTSNode {
  const key = hashState(state);

  if (transpositionTable.has(key)) {
    const existing = transpositionTable.get(key)!;
    // Ajouter le nouveau parent
    existing.addParent(parent);
    return existing;
  }

  const node = new MCTSNode(state, parent);
  transpositionTable.set(key, node);
  return node;
}
```

---

## 5.9 Métriques et Debugging

### 5.9.1 Métriques importantes

```typescript
interface MCTSMetrics {
  totalIterations: number;
  nodesExpanded: number;
  maxDepthReached: number;
  averageBranchingFactor: number;
  explorationRatio: number;      // % de visites sur nœuds peu visités
  effectiveBranchingFactor: number;
  convergenceIteration: number;  // Quand la solution s'est stabilisée
  rolloutTimeMs: number;
  selectionTimeMs: number;
}

function computeMetrics(root: MCTSNode): MCTSMetrics {
  // ... calculs
}
```

### 5.9.2 Visualisation de l'arbre

```typescript
function visualizeTree(root: MCTSNode, maxDepth: number = 3): string {
  const lines: string[] = [];

  function traverse(node: MCTSNode, prefix: string, isLast: boolean): void {
    const connector = isLast ? '└─' : '├─';
    const extension = isLast ? '  ' : '│ ';

    const stats = `[${node.visits}v, ${(node.meanReward * 100).toFixed(0)}%]`;
    const action = node.action.substring(0, 50);

    lines.push(`${prefix}${connector} ${action} ${stats}`);

    if (node.depth < maxDepth) {
      const children = node.children.sort((a, b) => b.visits - a.visits);
      children.forEach((child, i) => {
        traverse(child, prefix + extension, i === children.length - 1);
      });
    }
  }

  traverse(root, '', true);
  return lines.join('\n');
}

// Exemple de sortie :
// └─ Debug le bug de connexion [50v, 85%]
//    ├─ Race condition [12v, 40%]
//    │  └─ Ajouter mutex [5v, 50%]
//    └─ Bug cleanup [35v, 92%]
//       ├─ Vérifier état avant décrémenter [28v, 95%]
//       └─ Ajouter logging [7v, 70%]
```

---

## Résumé

Dans ce chapitre, nous avons vu :

| Concept | Point clé |
|---------|-----------|
| **Problème** | L'évaluation locale ne prédit pas le succès |
| **Solution MCTS** | Simuler jusqu'au bout avant de juger |
| **UCB1** | Balance exploration/exploitation |
| **4 phases** | Select → Expand → Simulate → Backpropagate |
| **Rollout LLM** | Simulation par génération de texte |
| **Rollout exécution** | Feedback objectif par tests |
| **Hybride ToT+MCTS** | ToT génère, MCTS affine |

---

## Exercices

1. **UCB1** : Implémentez une fonction qui visualise l'évolution des scores UCB1 au fil des itérations.

2. **Comparaison** : Comparez ToT vs MCTS sur 5 bugs avec tests. Mesurez : taux de succès, nombre d'itérations, temps.

3. **PUCT** : Implémentez la variante PUCT avec des prior probabilities basées sur l'évaluation LLM initiale.

4. **Parallelisation** : Ajoutez le support multi-thread avec virtual loss.

---

## Pour aller plus loin

- Silver, D., et al. (2016). "Mastering the game of Go with deep neural networks and tree search"
- Zhang, D., et al. (2024). "RethinkMCTS: Refining Erroneous Thoughts in Monte Carlo Tree Search for Code Generation." arXiv:2404.09932
- Grok-CLI : `src/agent/reasoning/mcts.ts`

---

*Prochainement : Chapitre 6 — Repair, Réflexion et Auto-Amélioration*

