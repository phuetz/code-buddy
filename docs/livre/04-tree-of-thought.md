# Chapitre 4 — Tree-of-Thought (ToT)

---

> **Scène**
>
> *Lina fait face à un bug vicieux. Le test échoue de manière intermittente — parfois il passe, parfois non. Son chatbot propose une solution... qui ne fonctionne pas. Puis une autre. Puis une autre.*
>
> *"C'est comme si tu tirais au hasard," soupire-t-elle.*
>
> *Elle se souvient de comment elle résout ce genre de problème elle-même : elle formule des hypothèses, les teste mentalement, élimine les mauvaises pistes, explore les prometteuses.*
>
> *"Et si je t'apprenais à faire pareil ?" murmure-t-elle en ouvrant son éditeur.*

---

## Introduction

Le raisonnement linéaire — générer une réponse token par token — a une limite fondamentale : il ne permet pas de revenir en arrière. Si le modèle s'engage sur une mauvaise piste au token 50, il doit continuer sur cette piste jusqu'à la fin.

**Tree-of-Thought (ToT)** résout ce problème en permettant au modèle d'explorer plusieurs chemins de pensée en parallèle, d'évaluer leur promesse, et de backtracker si nécessaire.

---

## 4.1 Le Problème du Raisonnement Linéaire

### 4.1.1 Génération autorégressive : force et faiblesse

Rappel : les LLMs génèrent du texte token par token, chaque token dépendant des précédents.

```
"Le problème est que" → P(token₁) → "la" →
  P(token₂|token₁) → "fonction" →
    P(token₃|token₁,token₂) → "retourne" → ...
```

**Force** : Cohérence locale. Chaque token est cohérent avec son contexte immédiat.

**Faiblesse** : Pas de vision globale. Le modèle ne peut pas "voir" où mène un chemin avant de s'y engager.

### 4.1.2 Exemple : Le Game of 24

Le benchmark classique de ToT : utiliser quatre nombres et les opérations +, -, ×, ÷ pour obtenir 24.

```
Nombres : 4, 5, 6, 10

Raisonnement linéaire (Chain-of-thought) :
─────────────────────────────────────────
"Je vais essayer de combiner ces nombres...
4 + 5 = 9
9 + 6 = 15
15 + 10 = 25
Hmm, 25 ≠ 24. Recommençons...
4 × 5 = 20
20 + 6 = 26
Encore raté..."

→ Le modèle génère UNE séquence, espère qu'elle fonctionne.
→ Taux de succès : ~7%
```

```
Tree-of-thought :
─────────────────
Étape 1 : Générer plusieurs combinaisons initiales
  • 4 + 5 = 9
  • 4 × 5 = 20
  • 10 - 4 = 6
  • 6 × 4 = 24 ← Prometteur !

Étape 2 : Évaluer chaque branche
  • 9 → Peu de chemins vers 24
  • 20 → 24 - 20 = 4, possible
  • 6 → 6 × 4 = 24, très prometteur
  • 24 → Déjà 24 ! Vérifions...

Étape 3 : Développer les branches prometteuses
  • 6 × 4 = 24 ✓ Solution !

→ Taux de succès : ~74%
```

### 4.1.3 Pourquoi ça marche

ToT implémente ce que les humains font naturellement :

| Aspect | Humain | ToT |
|--------|--------|-----|
| Explorer | "Et si j'essayais X ?" | Générer N pensées |
| Évaluer | "Cette piste a l'air prometteuse" | Scorer chaque pensée |
| Sélectionner | "Je continue sur celle-ci" | Garder les meilleures |
| Backtracker | "Non, mauvaise idée, revenons" | Élaguer et recommencer |

---

## 4.2 L'Algorithme Tree-of-Thought

### 4.2.1 Structure de données

```typescript
// Représentation d'un nœud de l'arbre
interface ThoughtNode {
  id: string;
  content: string;           // Le contenu de cette pensée
  score: number;             // Évaluation de la promesse
  depth: number;             // Profondeur dans l'arbre
  parent: ThoughtNode | null;
  children: ThoughtNode[];
  state: 'pending' | 'expanded' | 'pruned' | 'solution';
  metadata: {
    generatedAt: Date;
    evaluatedBy: string;     // 'self' | 'external'
    confidence: number;
  };
}

// L'arbre complet
interface ThoughtTree {
  root: ThoughtNode;
  problem: string;
  maxDepth: number;
  branchingFactor: number;
  solutions: ThoughtNode[];
}
```

### 4.2.2 Les quatre phases

```
┌─────────────────────────────────────────────────────────────────────┐
│                      ALGORITHME TREE-OF-THOUGHT                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  PHASE 1 : DÉCOMPOSITION                                            │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Identifier les étapes du problème                          │    │
│  │  "Pour débugger, je dois : localiser, comprendre, corriger" │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                               │                                      │
│                               ▼                                      │
│  PHASE 2 : GÉNÉRATION                                               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Pour chaque nœud, générer N pensées candidates             │    │
│  │  Nœud: "Localiser le bug"                                   │    │
│  │  → Pensée 1: "Vérifier les logs"                            │    │
│  │  → Pensée 2: "Analyser le stack trace"                      │    │
│  │  → Pensée 3: "Ajouter des console.log"                      │    │
│  │  → Pensée 4: "Utiliser le debugger"                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                               │                                      │
│                               ▼                                      │
│  PHASE 3 : ÉVALUATION                                               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Scorer chaque pensée (0-1)                                 │    │
│  │  → "Vérifier les logs" : 0.8 (souvent utile)                │    │
│  │  → "Analyser stack trace" : 0.9 (erreur avec trace)         │    │
│  │  → "console.log" : 0.5 (basique mais lent)                  │    │
│  │  → "Debugger" : 0.7 (puissant mais setup)                   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                               │                                      │
│                               ▼                                      │
│  PHASE 4 : SÉLECTION                                                │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Garder les K meilleures pensées, élaguer le reste          │    │
│  │  → Garde : "stack trace" (0.9), "logs" (0.8)                │    │
│  │  → Élague : "console.log", "debugger"                       │    │
│  │  → Continue avec les branches sélectionnées                 │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                               │                                      │
│                               ▼                                      │
│                    Répéter jusqu'à solution                         │
│                    ou profondeur max atteinte                       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2.3 Pseudo-code

```typescript
async function treeOfThought(
  problem: string,
  config: ToTConfig
): Promise<Solution[]> {
  // Initialiser l'arbre
  const tree: ThoughtTree = {
    root: {
      id: 'root',
      content: problem,
      score: 1.0,
      depth: 0,
      parent: null,
      children: [],
      state: 'pending'
    },
    problem,
    maxDepth: config.maxDepth,
    branchingFactor: config.branchingFactor,
    solutions: []
  };

  // File de nœuds à explorer
  const frontier: ThoughtNode[] = [tree.root];

  while (frontier.length > 0 && tree.solutions.length < config.maxSolutions) {
    // Prendre le nœud le plus prometteur
    const node = frontier.shift()!;

    if (node.depth >= config.maxDepth) {
      // Profondeur max atteinte, évaluer comme solution potentielle
      if (await isSolution(node, problem)) {
        node.state = 'solution';
        tree.solutions.push(node);
      }
      continue;
    }

    // PHASE 2 : Générer des pensées candidates
    const thoughts = await generateThoughts(node, config.branchingFactor);

    // PHASE 3 : Évaluer chaque pensée
    for (const thought of thoughts) {
      thought.score = await evaluateThought(thought, problem);
      thought.parent = node;
      thought.depth = node.depth + 1;
    }

    // PHASE 4 : Sélectionner les meilleures
    const selected = selectBest(thoughts, config.beamWidth);

    // Ajouter à la frontière
    node.children = selected;
    node.state = 'expanded';

    for (const child of selected) {
      if (child.score >= config.threshold) {
        frontier.push(child);
      } else {
        child.state = 'pruned';
      }
    }

    // Trier la frontière par score
    frontier.sort((a, b) => b.score - a.score);
  }

  return tree.solutions;
}
```

---

## 4.3 Les Stratégies de Recherche

### 4.3.1 Breadth-First Search (BFS)

Explorer tous les nœuds d'un niveau avant de passer au suivant.

```
                    Problème
                       │
         ┌─────────────┼─────────────┐
         │             │             │
       Pensée 1    Pensée 2     Pensée 3      ← Niveau 1 (complet)
         │             │             │
     ┌───┴───┐     ┌───┴───┐     ┌───┴───┐
     1.1   1.2     2.1   2.2     3.1   3.2    ← Niveau 2 (complet)
```

**Avantages** : Ne rate pas de solution proche de la racine.
**Inconvénients** : Coûteux en mémoire et appels API.

### 4.3.2 Depth-First Search (DFS)

Explorer une branche jusqu'au bout avant d'en essayer une autre.

```
                    Problème
                       │
                   Pensée 1 ← Exploré en premier
                       │
                      1.1
                       │
                     1.1.1 ← Profondeur max
                       │
              (backtrack vers Pensée 2)
```

**Avantages** : Économe en mémoire.
**Inconvénients** : Peut s'enliser dans une mauvaise branche.

### 4.3.3 Beam Search (Recommandé)

Garder les K meilleures branches à chaque niveau.

```
                    Problème
                       │
         ┌─────────────┼─────────────┐
         │             │             │
       P1(0.9)      P2(0.7)      P3(0.4)
         │             │             ✗ élagué
     ┌───┴───┐     ┌───┴───┐
   1.1(0.85) 1.2  2.1(0.6) 2.2
         │         ✗ élagué
        ...

Beam width K = 2 : Garde les 2 meilleurs à chaque niveau
```

**Avantages** : Bon compromis exploration/exploitation.
**Inconvénients** : Peut élaguer une branche qui deviendrait bonne.

### 4.3.4 Configuration recommandée par tâche

| Tâche | Stratégie | Branching | Depth | Beam |
|-------|-----------|-----------|-------|------|
| Bug simple | BFS | 3 | 2 | 3 |
| Bug complexe | Beam | 4 | 4 | 3 |
| Refactoring | DFS | 2 | 6 | 2 |
| Architecture | Beam | 5 | 3 | 4 |

---

## 4.4 L'Évaluation des Pensées

### 4.4.1 Auto-évaluation (Self-evaluation)

Le LLM évalue ses propres pensées :

```typescript
async function selfEvaluate(thought: ThoughtNode, problem: string): Promise<number> {
  const prompt = `
    Problème original : ${problem}

    Pensée à évaluer : ${thought.content}

    Évalue cette pensée sur une échelle de 0 à 1 :
    - 0 : Complètement hors sujet ou fausse
    - 0.3 : Partiellement pertinente mais peu prometteuse
    - 0.5 : Pertinente, mérite exploration
    - 0.7 : Prometteuse, probablement sur la bonne piste
    - 1.0 : Excellente, très probablement la solution

    Réponds avec un seul nombre entre 0 et 1.
  `;

  const response = await llm.complete(prompt);
  return parseFloat(response);
}
```

**Avantage** : Simple, pas de modèle supplémentaire.
**Inconvénient** : Le modèle peut être biaisé vers ses propres idées.

### 4.4.2 Évaluation par vote

Générer plusieurs évaluations et voter :

```typescript
async function voteEvaluate(
  thought: ThoughtNode,
  problem: string,
  numVotes: number = 3
): Promise<number> {
  const scores: number[] = [];

  for (let i = 0; i < numVotes; i++) {
    const score = await selfEvaluate(thought, problem);
    scores.push(score);
  }

  // Moyenne ou médiane
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
```

### 4.4.3 Évaluation par exécution (pour le code)

La meilleure évaluation : exécuter et vérifier !

```typescript
async function executionEvaluate(
  thought: ThoughtNode,
  context: CodeContext
): Promise<number> {
  // Si la pensée propose du code
  if (thought.content.includes('```')) {
    const code = extractCode(thought.content);

    try {
      // Tenter d'exécuter
      const result = await sandbox.execute(code);

      // Vérifier contre les tests
      const testResult = await runTests(context.tests);

      if (testResult.allPassed) {
        return 1.0;  // Solution !
      } else {
        // Score basé sur le pourcentage de tests passés
        return testResult.passed / testResult.total;
      }
    } catch (error) {
      // Erreur de syntaxe ou d'exécution
      return 0.1;
    }
  }

  // Sinon, fallback sur self-evaluation
  return selfEvaluate(thought, context.problem);
}
```

---

## 4.5 Implémentation Grok-CLI

### 4.5.1 Architecture du module

```
src/agent/reasoning/
├── index.ts                 # Point d'entrée
├── tree-of-thought.ts       # Implémentation principale
├── thought-generator.ts     # Génération de pensées
├── thought-evaluator.ts     # Évaluation
├── search-strategies.ts     # BFS, DFS, Beam
└── prompts/
    ├── decompose.ts         # Prompts de décomposition
    ├── generate.ts          # Prompts de génération
    └── evaluate.ts          # Prompts d'évaluation
```

### 4.5.2 Code principal

```typescript
// src/agent/reasoning/tree-of-thought.ts
import { LLMClient } from '../../grok/client';
import { ThoughtNode, ToTConfig, Solution } from './types';

export class TreeOfThought {
  private llm: LLMClient;
  private config: ToTConfig;

  constructor(llm: LLMClient, config: Partial<ToTConfig> = {}) {
    this.llm = llm;
    this.config = {
      maxDepth: config.maxDepth ?? 4,
      branchingFactor: config.branchingFactor ?? 3,
      beamWidth: config.beamWidth ?? 3,
      threshold: config.threshold ?? 0.3,
      maxSolutions: config.maxSolutions ?? 1,
      searchStrategy: config.searchStrategy ?? 'beam',
      evaluationMethod: config.evaluationMethod ?? 'self',
      ...config
    };
  }

  async solve(problem: string): Promise<Solution[]> {
    // Créer la racine
    const root = this.createNode(problem, 0);

    // Décomposer le problème si complexe
    const decomposition = await this.decompose(problem);
    if (decomposition.steps.length > 1) {
      this.config.maxDepth = Math.max(
        this.config.maxDepth,
        decomposition.steps.length + 1
      );
    }

    // Exécuter la recherche
    const solutions = await this.search(root, decomposition);

    // Trier par score
    solutions.sort((a, b) => b.score - a.score);

    return solutions.map(node => ({
      path: this.getPath(node),
      content: node.content,
      score: node.score,
      depth: node.depth
    }));
  }

  private async decompose(problem: string): Promise<Decomposition> {
    const prompt = `
      Analyse ce problème et décompose-le en étapes de raisonnement :

      Problème : ${problem}

      Format de réponse (JSON) :
      {
        "isComplex": true/false,
        "steps": ["étape 1", "étape 2", ...],
        "hints": ["indice potentiel 1", ...]
      }
    `;

    const response = await this.llm.complete(prompt, { temperature: 0.3 });
    return JSON.parse(response);
  }

  private async generateThoughts(
    node: ThoughtNode,
    count: number
  ): Promise<ThoughtNode[]> {
    const prompt = `
      Contexte : ${this.getPath(node).map(n => n.content).join(' → ')}

      Génère ${count} pensées/approches différentes pour continuer.
      Chaque pensée doit être distincte et explorer une direction différente.

      Format : Une pensée par ligne, numérotées 1. 2. 3. etc.
    `;

    const response = await this.llm.complete(prompt, { temperature: 0.8 });

    // Parser les pensées
    const lines = response.split('\n').filter(l => /^\d+\./.test(l));

    return lines.map((line, i) => this.createNode(
      line.replace(/^\d+\.\s*/, ''),
      node.depth + 1,
      node
    ));
  }

  private async evaluateThought(
    thought: ThoughtNode,
    problem: string
  ): Promise<number> {
    switch (this.config.evaluationMethod) {
      case 'self':
        return this.selfEvaluate(thought, problem);
      case 'vote':
        return this.voteEvaluate(thought, problem);
      case 'execution':
        return this.executionEvaluate(thought);
      default:
        return this.selfEvaluate(thought, problem);
    }
  }

  private async selfEvaluate(
    thought: ThoughtNode,
    problem: string
  ): Promise<number> {
    const prompt = `
      Problème : ${problem}
      Chemin actuel : ${this.getPath(thought).map(n => n.content).join(' → ')}

      Évalue si cette pensée nous rapproche de la solution.
      Réponds avec un nombre entre 0 et 1.
      - 0.0-0.2 : Mauvaise direction
      - 0.3-0.5 : Potentiel mais incertain
      - 0.6-0.8 : Prometteur
      - 0.9-1.0 : Très probablement correct

      Score :
    `;

    const response = await this.llm.complete(prompt, { temperature: 0 });
    const score = parseFloat(response.match(/[\d.]+/)?.[0] ?? '0.5');
    return Math.max(0, Math.min(1, score));
  }

  private async search(
    root: ThoughtNode,
    decomposition: Decomposition
  ): Promise<ThoughtNode[]> {
    const solutions: ThoughtNode[] = [];
    const frontier: ThoughtNode[] = [root];

    while (frontier.length > 0 && solutions.length < this.config.maxSolutions) {
      // Sélectionner selon la stratégie
      const node = this.selectNext(frontier);
      if (!node) break;

      // Vérifier si c'est une solution
      if (node.depth >= this.config.maxDepth || await this.isSolution(node)) {
        if (node.score >= 0.7) {
          solutions.push(node);
        }
        continue;
      }

      // Générer des enfants
      const children = await this.generateThoughts(
        node,
        this.config.branchingFactor
      );

      // Évaluer
      for (const child of children) {
        child.score = await this.evaluateThought(child, root.content);
      }

      // Sélectionner les meilleurs
      const selected = children
        .filter(c => c.score >= this.config.threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, this.config.beamWidth);

      // Ajouter à la frontière
      node.children = selected;
      frontier.push(...selected);

      // Maintenir la taille de la frontière (beam)
      if (this.config.searchStrategy === 'beam') {
        frontier.sort((a, b) => b.score - a.score);
        frontier.length = Math.min(
          frontier.length,
          this.config.beamWidth * 2
        );
      }
    }

    return solutions;
  }

  private selectNext(frontier: ThoughtNode[]): ThoughtNode | null {
    if (frontier.length === 0) return null;

    switch (this.config.searchStrategy) {
      case 'bfs':
        return frontier.shift()!; // Premier (plus ancien)
      case 'dfs':
        return frontier.pop()!;   // Dernier (plus profond)
      case 'beam':
      default:
        return frontier.shift()!; // Meilleur score (trié)
    }
  }

  private createNode(
    content: string,
    depth: number,
    parent: ThoughtNode | null = null
  ): ThoughtNode {
    return {
      id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      content,
      score: parent ? parent.score * 0.9 : 1.0, // Décroissance initiale
      depth,
      parent,
      children: [],
      state: 'pending',
      metadata: {
        generatedAt: new Date(),
        evaluatedBy: 'pending',
        confidence: 0
      }
    };
  }

  private getPath(node: ThoughtNode): ThoughtNode[] {
    const path: ThoughtNode[] = [];
    let current: ThoughtNode | null = node;

    while (current) {
      path.unshift(current);
      current = current.parent;
    }

    return path;
  }

  private async isSolution(node: ThoughtNode): Promise<boolean> {
    // Heuristique : une solution mentionne souvent "résolu", "solution", etc.
    const solutionKeywords = [
      'solution', 'résolu', 'corrigé', 'fonctionne',
      'solved', 'fixed', 'works', 'done'
    ];

    const content = node.content.toLowerCase();
    const hasSolutionKeyword = solutionKeywords.some(k => content.includes(k));

    if (hasSolutionKeyword && node.score >= 0.8) {
      return true;
    }

    return false;
  }
}
```

### 4.5.3 Intégration avec les thinking keywords

```typescript
// src/agent/thinking-keywords.ts
import { TreeOfThought } from './reasoning/tree-of-thought';

export class ThinkingKeywordsManager {
  private tot: TreeOfThought;

  async processWithThinking(
    message: string,
    level: ThinkingLevel
  ): Promise<string> {
    switch (level) {
      case ThinkingLevel.DIRECT:
        // Pas de ToT, réponse directe
        return message;

      case ThinkingLevel.CHAIN_OF_THOUGHT:
        // CoT simple (profondeur 1)
        return this.chainOfThought(message);

      case ThinkingLevel.TREE_OF_THOUGHT:
        // ToT standard (megathink)
        const totResult = await this.tot.solve(message);
        return this.formatToTResult(totResult);

      case ThinkingLevel.MCTS:
        // MCTS (ultrathink) - chapitre suivant
        return this.mctsThink(message);
    }
  }

  private formatToTResult(solutions: Solution[]): string {
    if (solutions.length === 0) {
      return "Je n'ai pas trouvé de solution satisfaisante.";
    }

    const best = solutions[0];
    const reasoning = best.path.map((p, i) =>
      `${'  '.repeat(i)}→ ${p}`
    ).join('\n');

    return `
## Raisonnement

${reasoning}

## Solution (confiance: ${(best.score * 100).toFixed(0)}%)

${best.content}
    `.trim();
  }
}
```

---

## 4.6 Cas Pratiques

### 4.6.1 Cas 1 : Debugging d'une fonction

```
Problème : "La fonction calculateDiscount retourne parfois NaN"

ToT exploration :
─────────────────

Niveau 1 : Hypothèses initiales
├─ (0.8) "NaN vient souvent de division par 0"
├─ (0.7) "Peut-être un undefined dans les inputs"
├─ (0.5) "Conversion de type échouée"
└─ (0.4) "Problème d'arrondi flottant"

Niveau 2 : Développement de la meilleure hypothèse
├─ "Division par 0"
│   ├─ (0.85) "Vérifier si price peut être 0"
│   ├─ (0.75) "Vérifier si quantity peut être 0"
│   └─ (0.60) "Vérifier le diviseur dans la formule"

Niveau 3 : Investigation ciblée
├─ "Vérifier si price peut être 0"
│   ├─ (0.95) "Lire la fonction et chercher division par price"
│   └─ → TROUVÉ : `total / price` sans garde

Solution : Ajouter `if (price === 0) return 0;` avant la division
```

### 4.6.2 Cas 2 : Refactoring d'architecture

```
Problème : "Refactorer le monolithe UserService en modules séparés"

ToT exploration :
─────────────────

Niveau 1 : Stratégies de découpage
├─ (0.8) "Découper par domaine (auth, profile, settings)"
├─ (0.7) "Découper par couche (controller, service, repo)"
├─ (0.6) "Découper par feature (login, signup, password)"
└─ (0.5) "Microservices complets"

Niveau 2 : Développement "par domaine"
├─ "AuthModule"
│   ├─ (0.9) "login, logout, validateToken, refreshToken"
│   └─ Dépendances : UserRepository, TokenService
├─ "ProfileModule"
│   ├─ (0.85) "getProfile, updateProfile, uploadAvatar"
│   └─ Dépendances : UserRepository, StorageService
├─ "SettingsModule"
│   ├─ (0.80) "getSettings, updateSettings, deleteAccount"
│   └─ Dépendances : UserRepository, NotificationService

Niveau 3 : Plan d'implémentation
├─ Ordre : Auth (le plus critique) → Profile → Settings
├─ Migration : progressive avec feature flags
└─ Tests : ajouter tests d'intégration inter-modules

Solution : Plan de refactoring en 3 phases avec interfaces claires
```

### 4.6.3 Cas 3 : Optimisation de performance

```
Problème : "L'API /users est lente (2s de latence)"

ToT exploration :
─────────────────

Niveau 1 : Sources de lenteur possibles
├─ (0.85) "Query N+1 sur la base de données"
├─ (0.75) "Pas de cache"
├─ (0.65) "Serialisation JSON lourde"
├─ (0.55) "Trop de données retournées"
└─ (0.40) "Connexion DB non poolée"

Niveau 2 : Investigation "Query N+1"
├─ (0.90) "Logger les queries SQL"
│   └─ Résultat : 47 queries pour 10 users !
├─ (0.85) "Vérifier les relations Prisma/ORM"
│   └─ Résultat : include manquant sur posts, comments

Niveau 3 : Solution
├─ Ajouter : `include: { posts: true, comments: { take: 5 } }`
├─ Résultat : 3 queries au lieu de 47
└─ Latence : 2s → 200ms (10x amélioration)

Solution : Eager loading des relations avec limite
```

---

## 4.7 Optimisations et Bonnes Pratiques

### 4.7.1 Réduire les appels API

```typescript
// Batch les évaluations
async function batchEvaluate(
  thoughts: ThoughtNode[],
  problem: string
): Promise<void> {
  const prompt = `
    Problème : ${problem}

    Évalue chacune de ces pensées (0-1) :
    ${thoughts.map((t, i) => `${i + 1}. ${t.content}`).join('\n')}

    Réponds en JSON : { "scores": [0.8, 0.5, ...] }
  `;

  const response = await llm.complete(prompt);
  const { scores } = JSON.parse(response);

  thoughts.forEach((t, i) => {
    t.score = scores[i] ?? 0.5;
  });
}
```

### 4.7.2 Early stopping

```typescript
// Arrêter si on trouve une excellente solution tôt
if (node.score >= 0.95 && await verifySolution(node)) {
  return [node]; // Pas besoin d'explorer plus
}
```

### 4.7.3 Cache des pensées similaires

```typescript
const thoughtCache = new Map<string, number>();

async function evaluateWithCache(thought: ThoughtNode): Promise<number> {
  const key = thought.content.toLowerCase().trim();

  if (thoughtCache.has(key)) {
    return thoughtCache.get(key)!;
  }

  const score = await evaluate(thought);
  thoughtCache.set(key, score);
  return score;
}
```

### 4.7.4 Profondeur adaptative

```typescript
// Ajuster la profondeur selon la difficulté
function adaptDepth(problem: string, decomposition: Decomposition): number {
  const baseDepth = decomposition.steps.length;

  // Indicateurs de complexité
  const complexityIndicators = [
    'architecture', 'refactor', 'optimize', 'debug intermittent'
  ];

  const isComplex = complexityIndicators.some(ind =>
    problem.toLowerCase().includes(ind)
  );

  return isComplex ? baseDepth + 2 : baseDepth;
}
```

---

## 4.8 Limitations et Quand Ne Pas Utiliser ToT

### 4.8.1 Coût

ToT multiplie les appels API :
- Branching factor 3, depth 4 = jusqu'à 3⁴ = 81 appels
- Plus les évaluations

**Règle** : N'utilisez ToT que si le problème justifie le coût.

### 4.8.2 Tâches inadaptées

| Tâche | Utiliser ToT ? | Raison |
|-------|----------------|--------|
| "Quelle heure est-il ?" | ❌ | Trivial |
| "Crée un fichier README" | ❌ | Pas d'ambiguïté |
| "Formatte ce JSON" | ❌ | Déterministe |
| "Corrige ce bug de race condition" | ✅ | Plusieurs hypothèses |
| "Optimise cette architecture" | ✅ | Trade-offs complexes |

### 4.8.3 Risque de sur-exploration

ToT peut explorer des chemins absurdes si mal configuré :

```
Problème : "Ajoute un bouton"

ToT mal configuré :
├─ "Créer un bouton HTML"
│   ├─ "Avec quelle couleur ?"
│   │   ├─ "Rouge symbolise l'action"
│   │   ├─ "Bleu inspire confiance"
│   │   ├─ "Vert signifie succès"
│   │   │   ├─ "Vert foncé ou clair ?"
│   │   │   │   ├─ ... (exploration inutile)
```

**Solution** : Seuil de score élevé + early stopping.

---

## Résumé

Dans ce chapitre, nous avons vu :

| Concept | Point clé |
|---------|-----------|
| **Problème** | Le raisonnement linéaire ne backtrack pas |
| **Solution ToT** | Explorer plusieurs chemins en parallèle |
| **Phases** | Décomposer → Générer → Évaluer → Sélectionner |
| **Stratégies** | BFS, DFS, Beam Search |
| **Évaluation** | Self, Vote, Execution |
| **Implémentation** | `src/agent/reasoning/tree-of-thought.ts` |

---

## Exercices

1. **Implémentation** : Ajoutez une méthode `visualize()` qui affiche l'arbre en ASCII.

2. **Benchmark** : Comparez CoT vs ToT sur 10 bugs de votre codebase. Mesurez taux de succès et nombre d'appels API.

3. **Optimisation** : Implémentez le batching d'évaluations et mesurez la réduction d'appels.

4. **Extension** : Ajoutez la possibilité de "reprendre" un arbre partiellement exploré.

---

## Pour aller plus loin

- Yao, S., et al. (2023). "Tree of Thoughts: Deliberate Problem Solving with Large Language Models." arXiv:2305.10601
- Long, J. (2023). "Large Language Model Guided Tree-of-Thought." arXiv:2305.08291
- Grok-CLI : `src/agent/reasoning/tree-of-thought.ts`

---

*Prochainement : Chapitre 5 — Monte-Carlo Tree Search (MCTS)*

