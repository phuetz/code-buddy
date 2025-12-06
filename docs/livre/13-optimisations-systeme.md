# Chapitre 13 : Optimisations Système — Performance et Économie à l'Échelle

---

## Scène d'ouverture : Le Coût de la Croissance

*Trois mois après le lancement de Grok-CLI en production...*

Lina fixait le tableau de bord des coûts avec une expression préoccupée. Ce qui avait commencé comme un projet expérimental était devenu un outil utilisé par toute son équipe — et les factures API suivaient la même trajectoire ascendante.

— "15 000 euros ce mois-ci," murmura-t-elle. "C'est trois fois plus que le mois dernier."

Karim, le responsable infrastructure, s'approcha de son bureau.

— "J'ai aussi remarqué quelque chose," dit-il en montrant les métriques de performance. "Les temps de réponse augmentent. Certains développeurs se plaignent d'attendre 10 secondes pour des réponses simples."

Lina ouvrit le journal des requêtes. Le diagnostic était clair : chaque interaction, même la plus triviale, utilisait le modèle le plus puissant. Les outils s'exécutaient séquentiellement, créant des goulots d'étranglement. Et le démarrage de l'application prenait maintenant 3 secondes à cause de tous les modules chargés.

— "On a construit quelque chose de puissant," admit-elle, "mais pas quelque chose d'efficace. Il est temps d'optimiser au niveau système."

Elle ouvrit une nouvelle branche Git : `feature/system-optimizations`.

---

## 13.1 Le Problème de l'Échelle

### 13.1.1 Les Trois Dimensions du Gaspillage

Quand un agent LLM passe du prototype à la production, trois formes de gaspillage émergent :

```
┌─────────────────────────────────────────────────────────────┐
│              TRIANGLE DU GASPILLAGE LLM                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                        COÛT ($)                             │
│                          /\                                 │
│                         /  \                                │
│                        /    \                               │
│                       /      \                              │
│                      / Modèle \                             │
│                     / trop     \                            │
│                    / puissant   \                           │
│                   /______________\                          │
│                  /                \                         │
│                 /                  \                        │
│                /                    \                       │
│               /______________________\                      │
│            LATENCE                  RESSOURCES              │
│            (secondes)               (CPU/RAM)               │
│                                                             │
│   - Exécution séquentielle      - Chargement complet        │
│   - Pas de cache                - Modules inutilisés        │
│   - Attente réseau              - Connexions non poolées    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 13.1.2 Profil d'une Session Typique Non-Optimisée

```typescript
// Analyse d'une session de 30 minutes
interface SessionProfile {
  totalRequests: number;          // 45 requêtes
  gptTokensUsed: number;          // 2.3M tokens
  averageLatency: number;         // 4.2 secondes
  costBreakdown: {
    gpt4o: number;                // 89% du coût
    gpt4oMini: number;            // 11% du coût
  };
  toolExecutions: {
    total: number;                // 156 exécutions
    sequential: number;           // 142 (91%)
    parallel: number;             // 14 (9%)
  };
  wastedTime: {
    sequentialTools: number;      // +45 secondes
    redundantCalls: number;       // +23 secondes
    coldStarts: number;           // +12 secondes
  };
}

// Diagnostic : 80 secondes gaspillées sur 30 minutes
// Coût : 3x plus élevé que nécessaire
```

### 13.1.3 Objectifs d'Optimisation

Lina définit des objectifs mesurables :

| Métrique | Avant | Objectif | Amélioration |
|----------|-------|----------|--------------|
| Coût par session | $2.50 | $0.75 | -70% |
| Latence moyenne | 4.2s | 1.5s | -64% |
| Temps de démarrage | 3.0s | <100ms | -97% |
| Requêtes API | 100% | 32% | -68% (cache) |

---

## 13.2 Model Routing : L'Art de Choisir le Bon Modèle

### 13.2.1 L'Intuition derrière FrugalGPT

La recherche de Stanford sur FrugalGPT (2023) révèle une vérité contre-intuitive : les modèles les plus puissants ne sont pas toujours les meilleurs choix.

```
┌─────────────────────────────────────────────────────────────┐
│                 PRINCIPE FRUGALGPT                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Coût par requête                                           │
│       │                                                     │
│  $0.10│                              ┌─────┐                │
│       │                              │GPT-4│ ← Overkill     │
│       │                              │ Pro │   pour 70%     │
│  $0.05│                    ┌─────┐   └─────┘   des tâches   │
│       │                    │GPT-4│                          │
│       │          ┌─────┐   │  o  │                          │
│  $0.01│ ┌─────┐  │ 4o  │   └─────┘                          │
│       │ │Mini │  │Mini │                                    │
│       │ │ 8B  │  │128K │                                    │
│  $0.00└─┴─────┴──┴─────┴────────────────────────────────►   │
│         Simple   Moyen    Complexe   Expert                 │
│                                                             │
│  ✓ 60% des tâches → Mini (économie 95%)                     │
│  ✓ 30% des tâches → Standard (économie 50%)                 │
│  ✓ 10% des tâches → Pro (qualité maximale)                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 13.2.2 Architecture du Model Router

```typescript
// src/optimization/model-routing.ts

import { createHash } from 'crypto';

/**
 * Tiers de modèles disponibles
 */
export enum ModelTier {
  FAST = 'fast',       // grok-3-mini, gpt-4o-mini
  BALANCED = 'balanced', // grok-3, gpt-4o
  POWERFUL = 'powerful'  // grok-3-pro, gpt-4-turbo
}

/**
 * Configuration des modèles par tier
 */
interface ModelConfig {
  model: string;
  costPer1kTokens: number;
  maxTokens: number;
  latencyMs: number;
  capabilities: Set<string>;
}

const MODEL_CONFIGS: Record<ModelTier, ModelConfig> = {
  [ModelTier.FAST]: {
    model: 'grok-3-mini',
    costPer1kTokens: 0.0001,
    maxTokens: 8192,
    latencyMs: 200,
    capabilities: new Set([
      'simple_qa',
      'formatting',
      'summarization',
      'translation'
    ])
  },
  [ModelTier.BALANCED]: {
    model: 'grok-3',
    costPer1kTokens: 0.002,
    maxTokens: 32768,
    latencyMs: 500,
    capabilities: new Set([
      'code_generation',
      'analysis',
      'planning',
      'multi_step_reasoning'
    ])
  },
  [ModelTier.POWERFUL]: {
    model: 'grok-3-pro',
    costPer1kTokens: 0.01,
    maxTokens: 128000,
    latencyMs: 1500,
    capabilities: new Set([
      'complex_architecture',
      'security_analysis',
      'mathematical_proof',
      'novel_algorithms'
    ])
  }
};

/**
 * Model Router intelligent basé sur FrugalGPT
 */
export class ModelRouter {
  private taskHistory: Map<string, TaskPerformance> = new Map();
  private classifier: TaskClassifier;
  private cascadeEnabled: boolean;

  constructor(options: RouterOptions = {}) {
    this.cascadeEnabled = options.enableCascade ?? true;
    this.classifier = new TaskClassifier();
  }

  /**
   * Sélectionne le tier optimal pour une tâche
   */
  async selectTier(task: TaskDescription): Promise<RoutingDecision> {
    // 1. Classification de la tâche
    const classification = await this.classifyTask(task);

    // 2. Vérification de l'historique
    const historicalTier = this.checkHistory(task);
    if (historicalTier) {
      return {
        tier: historicalTier,
        reason: 'historical_success',
        confidence: 0.9
      };
    }

    // 3. Sélection basée sur la classification
    const selectedTier = this.selectBasedOnClassification(classification);

    // 4. Ajustement selon le contexte
    const adjustedTier = this.adjustForContext(selectedTier, task);

    return {
      tier: adjustedTier,
      reason: classification.primaryCategory,
      confidence: classification.confidence,
      estimatedCost: this.estimateCost(adjustedTier, task),
      estimatedLatency: MODEL_CONFIGS[adjustedTier].latencyMs
    };
  }

  /**
   * Classification de la complexité de la tâche
   */
  private async classifyTask(task: TaskDescription): Promise<TaskClassification> {
    const features = this.extractFeatures(task);

    // Indicateurs de complexité
    const complexityScore = this.calculateComplexityScore(features);

    // Catégorie primaire
    const category = this.determineCategory(features);

    return {
      complexityScore,
      primaryCategory: category,
      confidence: this.calculateConfidence(features),
      features
    };
  }

  /**
   * Extraction des caractéristiques de la tâche
   */
  private extractFeatures(task: TaskDescription): TaskFeatures {
    const content = task.prompt.toLowerCase();

    return {
      // Longueur et structure
      promptLength: task.prompt.length,
      hasCodeBlocks: /```[\s\S]*```/.test(task.prompt),
      hasMultipleQuestions: (content.match(/\?/g) || []).length > 1,

      // Indicateurs de complexité
      mentionsArchitecture: /architect|design|pattern|structure/i.test(content),
      mentionsSecurity: /security|vulnerab|exploit|auth/i.test(content),
      mentionsPerformance: /optimi|performance|latency|throughput/i.test(content),
      requiresMultiStep: /then|after|finally|step|phase/i.test(content),

      // Indicateurs de simplicité
      isFormatting: /format|indent|style|lint/i.test(content),
      isTranslation: /translate|convert|transform/i.test(content),
      isSimpleQuestion: content.length < 100 && (content.match(/\?/g) || []).length === 1,

      // Contexte
      filesReferenced: (content.match(/\.(ts|js|py|go|rs|java)/g) || []).length,
      toolsRequired: task.requiredTools?.length || 0
    };
  }

  /**
   * Calcul du score de complexité (0-1)
   */
  private calculateComplexityScore(features: TaskFeatures): number {
    let score = 0;

    // Facteurs positifs (augmentent la complexité)
    if (features.mentionsArchitecture) score += 0.25;
    if (features.mentionsSecurity) score += 0.3;
    if (features.mentionsPerformance) score += 0.2;
    if (features.requiresMultiStep) score += 0.15;
    if (features.hasCodeBlocks && features.promptLength > 500) score += 0.1;
    if (features.filesReferenced > 3) score += 0.1;
    if (features.toolsRequired > 5) score += 0.1;

    // Facteurs négatifs (réduisent la complexité)
    if (features.isSimpleQuestion) score -= 0.3;
    if (features.isFormatting) score -= 0.2;
    if (features.isTranslation) score -= 0.15;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Sélection du tier basée sur le score
   */
  private selectBasedOnClassification(
    classification: TaskClassification
  ): ModelTier {
    const { complexityScore } = classification;

    if (complexityScore < 0.3) {
      return ModelTier.FAST;
    } else if (complexityScore < 0.7) {
      return ModelTier.BALANCED;
    } else {
      return ModelTier.POWERFUL;
    }
  }

  /**
   * Ajustement contextuel du tier
   */
  private adjustForContext(
    tier: ModelTier,
    task: TaskDescription
  ): ModelTier {
    // Forcer POWERFUL pour certaines tâches critiques
    if (task.isCritical || task.requiresAccuracy > 0.99) {
      return ModelTier.POWERFUL;
    }

    // Budget limité : downgrade si possible
    if (task.budgetConstraint && tier === ModelTier.POWERFUL) {
      return ModelTier.BALANCED;
    }

    // Latence critique : upgrade si nécessaire
    if (task.latencyConstraint && tier === ModelTier.POWERFUL) {
      return ModelTier.BALANCED;
    }

    return tier;
  }

  /**
   * Exécution avec cascade (fallback vers tier supérieur)
   */
  async executeWithCascade<T>(
    task: TaskDescription,
    executor: (model: string) => Promise<CascadeResult<T>>
  ): Promise<T> {
    const tiers = [ModelTier.FAST, ModelTier.BALANCED, ModelTier.POWERFUL];
    const initialDecision = await this.selectTier(task);
    const startIndex = tiers.indexOf(initialDecision.tier);

    for (let i = startIndex; i < tiers.length; i++) {
      const tier = tiers[i];
      const config = MODEL_CONFIGS[tier];

      try {
        const result = await executor(config.model);

        // Vérification de la qualité
        if (result.quality >= task.minQuality || i === tiers.length - 1) {
          // Enregistrer le succès pour l'apprentissage
          this.recordSuccess(task, tier, result.quality);
          return result.value;
        }

        // Qualité insuffisante, essayer le tier suivant
        console.log(
          `Quality ${result.quality.toFixed(2)} < ${task.minQuality}, ` +
          `escalating from ${tier} to ${tiers[i + 1]}`
        );

      } catch (error) {
        if (i === tiers.length - 1) {
          throw error;
        }
        // Erreur, essayer le tier suivant
        console.log(`Error in ${tier}, cascading to ${tiers[i + 1]}`);
      }
    }

    throw new Error('All tiers failed');
  }

  /**
   * Estimation du coût
   */
  private estimateCost(tier: ModelTier, task: TaskDescription): number {
    const config = MODEL_CONFIGS[tier];
    const estimatedTokens = this.estimateTokens(task);
    return (estimatedTokens / 1000) * config.costPer1kTokens;
  }

  /**
   * Estimation des tokens
   */
  private estimateTokens(task: TaskDescription): number {
    // Approximation : 4 caractères = 1 token
    const inputTokens = Math.ceil(task.prompt.length / 4);
    const outputTokens = task.expectedOutputLength || inputTokens * 2;
    return inputTokens + outputTokens;
  }

  /**
   * Enregistrement du succès pour l'apprentissage
   */
  private recordSuccess(
    task: TaskDescription,
    tier: ModelTier,
    quality: number
  ): void {
    const taskHash = this.hashTask(task);

    this.taskHistory.set(taskHash, {
      tier,
      quality,
      timestamp: Date.now(),
      taskType: task.type
    });

    // Nettoyage des anciennes entrées
    this.cleanOldEntries();
  }

  /**
   * Hash de la tâche pour l'historique
   */
  private hashTask(task: TaskDescription): string {
    const normalized = task.type + ':' +
      task.prompt.slice(0, 100).toLowerCase().replace(/\s+/g, ' ');
    return createHash('md5').update(normalized).digest('hex').slice(0, 16);
  }

  /**
   * Vérification de l'historique
   */
  private checkHistory(task: TaskDescription): ModelTier | null {
    const taskHash = this.hashTask(task);
    const history = this.taskHistory.get(taskHash);

    if (history && Date.now() - history.timestamp < 24 * 60 * 60 * 1000) {
      return history.tier;
    }

    return null;
  }

  /**
   * Nettoyage des entrées obsolètes
   */
  private cleanOldEntries(): void {
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 jours
    const now = Date.now();

    for (const [hash, entry] of this.taskHistory) {
      if (now - entry.timestamp > maxAge) {
        this.taskHistory.delete(hash);
      }
    }
  }

  /**
   * Statistiques de routage
   */
  getStatistics(): RouterStatistics {
    const stats = {
      total: 0,
      byTier: {
        [ModelTier.FAST]: 0,
        [ModelTier.BALANCED]: 0,
        [ModelTier.POWERFUL]: 0
      },
      averageQuality: 0,
      estimatedSavings: 0
    };

    for (const entry of this.taskHistory.values()) {
      stats.total++;
      stats.byTier[entry.tier]++;
      stats.averageQuality += entry.quality;
    }

    if (stats.total > 0) {
      stats.averageQuality /= stats.total;

      // Calcul des économies estimées
      const fastSavings = stats.byTier[ModelTier.FAST] * 0.95;
      const balancedSavings = stats.byTier[ModelTier.BALANCED] * 0.5;
      stats.estimatedSavings = (fastSavings + balancedSavings) / stats.total;
    }

    return stats;
  }
}

// Types de support
interface TaskDescription {
  prompt: string;
  type: string;
  requiredTools?: string[];
  isCritical?: boolean;
  requiresAccuracy?: number;
  budgetConstraint?: boolean;
  latencyConstraint?: boolean;
  minQuality?: number;
  expectedOutputLength?: number;
}

interface RoutingDecision {
  tier: ModelTier;
  reason: string;
  confidence: number;
  estimatedCost?: number;
  estimatedLatency?: number;
}

interface CascadeResult<T> {
  value: T;
  quality: number;
}

interface TaskPerformance {
  tier: ModelTier;
  quality: number;
  timestamp: number;
  taskType: string;
}
```

### 13.2.3 Intégration dans l'Agent

```typescript
// src/agent/grok-agent.ts (extrait)

import { ModelRouter, ModelTier } from '../optimization/model-routing.js';

export class GrokAgent {
  private modelRouter: ModelRouter;

  constructor(config: AgentConfig) {
    this.modelRouter = new ModelRouter({
      enableCascade: config.enableCascade ?? true
    });
  }

  async processMessage(message: string): Promise<AgentResponse> {
    // Classification de la tâche
    const taskDescription = {
      prompt: message,
      type: this.detectTaskType(message),
      requiredTools: this.predictRequiredTools(message),
      minQuality: 0.8
    };

    // Routage vers le bon modèle
    const routing = await this.modelRouter.selectTier(taskDescription);

    console.log(
      `[Router] Using ${routing.tier} (${routing.reason}, ` +
      `confidence: ${(routing.confidence * 100).toFixed(0)}%)`
    );

    // Exécution avec le modèle sélectionné
    return this.executeWithModel(
      MODEL_CONFIGS[routing.tier].model,
      message
    );
  }

  /**
   * Exécution avec cascade automatique
   */
  async processWithCascade(message: string): Promise<AgentResponse> {
    return this.modelRouter.executeWithCascade(
      {
        prompt: message,
        type: this.detectTaskType(message),
        minQuality: 0.85
      },
      async (model) => {
        const response = await this.executeWithModel(model, message);
        const quality = await this.evaluateResponseQuality(response);
        return { value: response, quality };
      }
    );
  }

  /**
   * Évaluation de la qualité de la réponse
   */
  private async evaluateResponseQuality(
    response: AgentResponse
  ): Promise<number> {
    let score = 1.0;

    // Pénalités
    if (response.error) score -= 0.5;
    if (response.content.length < 50) score -= 0.2;
    if (response.toolCalls?.some(t => t.failed)) score -= 0.3;

    // Bonus
    if (response.toolCalls?.every(t => t.succeeded)) score += 0.1;
    if (response.codeBlocks?.length > 0) score += 0.1;

    return Math.max(0, Math.min(1, score));
  }
}
```

### 13.2.4 Résultats du Model Routing

```
┌─────────────────────────────────────────────────────────────┐
│            IMPACT DU MODEL ROUTING                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Distribution des tâches (avant)    Distribution (après)    │
│                                                             │
│  ┌──────────────────────┐          ┌──────────────────────┐ │
│  │████████████████████│ 100%      │████████            │ 40% │
│  │       GPT-4o       │           │    GPT-4o          │     │
│  └──────────────────────┘          │                    │     │
│                                    │████████████████   │ 50% │
│                                    │   GPT-4o-mini     │     │
│                                    │                    │     │
│                                    │████              │ 10%  │
│                                    │  GPT-4-turbo     │     │
│                                    └──────────────────────┘ │
│                                                             │
│  Économies réalisées:                                       │
│  ├─ Coût moyen par requête : $0.025 → $0.008 (-68%)         │
│  ├─ Latence moyenne : 850ms → 420ms (-51%)                  │
│  └─ Qualité maintenue : 94% → 93% (-1%)                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 13.3 Exécution Parallèle des Outils

### 13.3.1 Le Problème de l'Exécution Séquentielle

Par défaut, les agents exécutent les outils un par un :

```
┌─────────────────────────────────────────────────────────────┐
│           EXÉCUTION SÉQUENTIELLE (NAÏVE)                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Temps ────────────────────────────────────────────────►    │
│                                                             │
│  ┌─────────┐                                                │
│  │ Read A  │ 200ms                                          │
│  └─────────┘                                                │
│            ┌─────────┐                                      │
│            │ Read B  │ 200ms                                │
│            └─────────┘                                      │
│                      ┌─────────┐                            │
│                      │ Read C  │ 200ms                      │
│                      └─────────┘                            │
│                                ┌─────────┐                  │
│                                │ Search  │ 300ms            │
│                                └─────────┘                  │
│                                          ┌─────────┐        │
│                                          │ Analyze │ 150ms  │
│                                          └─────────┘        │
│                                                             │
│  Total : 200 + 200 + 200 + 300 + 150 = 1050ms               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 13.3.2 LLMCompiler : Analyse des Dépendances

L'idée de LLMCompiler (Berkeley, 2023) est d'analyser les dépendances entre outils pour paralléliser automatiquement :

```
┌─────────────────────────────────────────────────────────────┐
│           EXÉCUTION PARALLÈLE (LLMCompiler)                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Temps ────────────────────────────────────────────────►    │
│                                                             │
│  ┌─────────┐┌─────────┐┌─────────┐┌─────────┐               │
│  │ Read A  ││ Read B  ││ Read C  ││ Search  │ Niveau 0      │
│  └─────────┘└─────────┘└─────────┘└─────────┘ (parallèle)   │
│  200ms      200ms      200ms      300ms                     │
│                                                             │
│                                   ┌─────────┐               │
│                                   │ Analyze │ Niveau 1      │
│                                   └─────────┘ (séquentiel)  │
│                                   150ms                     │
│                                                             │
│  Total : max(200, 200, 200, 300) + 150 = 450ms              │
│  Speedup : 1050 / 450 = 2.3x                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 13.3.3 Implémentation du Parallel Executor

```typescript
// src/optimization/parallel-executor.ts

/**
 * Graphe de dépendances des outils
 */
interface DependencyGraph {
  nodes: Map<string, ToolNode>;
  edges: Map<string, Set<string>>; // toolId -> dependsOn
}

interface ToolNode {
  id: string;
  tool: ToolCall;
  level: number;  // Profondeur dans le graphe
  inputs: string[];
  outputs: string[];
}

interface ExecutionPlan {
  levels: ToolNode[][];  // Outils groupés par niveau
  totalLevels: number;
  parallelizableTools: number;
  sequentialTools: number;
}

/**
 * Exécuteur parallèle basé sur LLMCompiler
 */
export class ParallelExecutor {
  private maxConcurrency: number;
  private dependencyAnalyzer: DependencyAnalyzer;

  constructor(options: ExecutorOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 10;
    this.dependencyAnalyzer = new DependencyAnalyzer();
  }

  /**
   * Exécute un ensemble d'outils avec parallélisation maximale
   */
  async executeTools(
    tools: ToolCall[],
    executor: ToolExecutor
  ): Promise<ToolResult[]> {
    // 1. Construction du graphe de dépendances
    const graph = this.buildDependencyGraph(tools);

    // 2. Création du plan d'exécution
    const plan = this.createExecutionPlan(graph);

    console.log(
      `[ParallelExecutor] Plan: ${plan.totalLevels} levels, ` +
      `${plan.parallelizableTools}/${tools.length} parallelizable`
    );

    // 3. Exécution niveau par niveau
    const results: Map<string, ToolResult> = new Map();

    for (let level = 0; level < plan.levels.length; level++) {
      const levelTools = plan.levels[level];

      // Exécution parallèle des outils du niveau
      const levelResults = await this.executeLevelParallel(
        levelTools,
        executor,
        results
      );

      // Stockage des résultats
      for (const result of levelResults) {
        results.set(result.toolId, result);
      }
    }

    // 4. Retour dans l'ordre original
    return tools.map(tool => results.get(tool.id)!);
  }

  /**
   * Construction du graphe de dépendances
   */
  private buildDependencyGraph(tools: ToolCall[]): DependencyGraph {
    const nodes = new Map<string, ToolNode>();
    const edges = new Map<string, Set<string>>();

    // Création des noeuds
    for (const tool of tools) {
      const inputs = this.extractInputs(tool);
      const outputs = this.extractOutputs(tool);

      nodes.set(tool.id, {
        id: tool.id,
        tool,
        level: -1,  // Sera calculé
        inputs,
        outputs
      });

      edges.set(tool.id, new Set());
    }

    // Détection des dépendances
    for (const [id, node] of nodes) {
      for (const [otherId, otherNode] of nodes) {
        if (id === otherId) continue;

        // Dépendance si les outputs de l'autre sont nos inputs
        const hasDependency = otherNode.outputs.some(
          output => node.inputs.includes(output)
        );

        if (hasDependency) {
          edges.get(id)!.add(otherId);
        }
      }
    }

    // Calcul des niveaux (tri topologique)
    this.calculateLevels(nodes, edges);

    return { nodes, edges };
  }

  /**
   * Extraction des inputs d'un outil
   */
  private extractInputs(tool: ToolCall): string[] {
    const inputs: string[] = [];

    switch (tool.name) {
      case 'Read':
        // Pas d'input externe
        break;

      case 'Edit':
        // Dépend de la lecture du fichier
        inputs.push(`file:${tool.params.path}`);
        break;

      case 'Bash':
        // Analyse des références de fichiers dans la commande
        const fileRefs = tool.params.command.match(/\$\{?(\w+)\}?/g);
        if (fileRefs) {
          inputs.push(...fileRefs);
        }
        break;

      case 'Analyze':
        // Dépend des fichiers à analyser
        if (tool.params.files) {
          inputs.push(...tool.params.files.map(f => `file:${f}`));
        }
        break;
    }

    return inputs;
  }

  /**
   * Extraction des outputs d'un outil
   */
  private extractOutputs(tool: ToolCall): string[] {
    const outputs: string[] = [];

    switch (tool.name) {
      case 'Read':
        outputs.push(`file:${tool.params.path}`);
        break;

      case 'Search':
        outputs.push(`search:${tool.params.pattern}`);
        break;

      case 'Bash':
        // Variable de sortie
        outputs.push(`bash:${tool.id}`);
        break;
    }

    return outputs;
  }

  /**
   * Calcul des niveaux par tri topologique
   */
  private calculateLevels(
    nodes: Map<string, ToolNode>,
    edges: Map<string, Set<string>>
  ): void {
    const inDegree = new Map<string, number>();

    // Initialisation des degrés entrants
    for (const id of nodes.keys()) {
      inDegree.set(id, edges.get(id)!.size);
    }

    // File des noeuds sans dépendances
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
        nodes.get(id)!.level = 0;
      }
    }

    // Parcours BFS
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentNode = nodes.get(current)!;

      // Mise à jour des successeurs
      for (const [id, deps] of edges) {
        if (deps.has(current)) {
          const newDegree = inDegree.get(id)! - 1;
          inDegree.set(id, newDegree);

          // Calcul du niveau
          const node = nodes.get(id)!;
          node.level = Math.max(node.level, currentNode.level + 1);

          if (newDegree === 0) {
            queue.push(id);
          }
        }
      }
    }
  }

  /**
   * Création du plan d'exécution
   */
  private createExecutionPlan(graph: DependencyGraph): ExecutionPlan {
    const levels: ToolNode[][] = [];
    let parallelizable = 0;
    let sequential = 0;

    // Regroupement par niveau
    const levelMap = new Map<number, ToolNode[]>();

    for (const node of graph.nodes.values()) {
      if (!levelMap.has(node.level)) {
        levelMap.set(node.level, []);
      }
      levelMap.get(node.level)!.push(node);
    }

    // Tri par niveau
    const sortedLevels = Array.from(levelMap.keys()).sort((a, b) => a - b);

    for (const level of sortedLevels) {
      const tools = levelMap.get(level)!;
      levels.push(tools);

      if (tools.length > 1) {
        parallelizable += tools.length;
      } else {
        sequential += tools.length;
      }
    }

    return {
      levels,
      totalLevels: levels.length,
      parallelizableTools: parallelizable,
      sequentialTools: sequential
    };
  }

  /**
   * Exécution parallèle d'un niveau
   */
  private async executeLevelParallel(
    tools: ToolNode[],
    executor: ToolExecutor,
    previousResults: Map<string, ToolResult>
  ): Promise<ToolResult[]> {
    // Limitation de la concurrence
    const semaphore = new Semaphore(this.maxConcurrency);

    const promises = tools.map(async (node) => {
      await semaphore.acquire();

      try {
        // Injection des résultats des dépendances
        const enrichedTool = this.injectDependencies(
          node.tool,
          node.inputs,
          previousResults
        );

        // Exécution
        const startTime = Date.now();
        const result = await executor.execute(enrichedTool);
        const duration = Date.now() - startTime;

        return {
          toolId: node.id,
          ...result,
          duration
        };

      } finally {
        semaphore.release();
      }
    });

    return Promise.all(promises);
  }

  /**
   * Injection des résultats des dépendances dans les paramètres
   */
  private injectDependencies(
    tool: ToolCall,
    inputs: string[],
    results: Map<string, ToolResult>
  ): ToolCall {
    // Pour chaque input, trouver le résultat correspondant
    const enrichedParams = { ...tool.params };

    for (const input of inputs) {
      for (const [toolId, result] of results) {
        if (result.outputs?.includes(input)) {
          // Injection du résultat
          enrichedParams[`_dep_${toolId}`] = result.value;
        }
      }
    }

    return {
      ...tool,
      params: enrichedParams
    };
  }
}

/**
 * Sémaphore pour limiter la concurrence
 */
class Semaphore {
  private permits: number;
  private queue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.permits++;
    }
  }
}
```

### 13.3.4 Visualisation de l'Exécution

```typescript
// src/optimization/execution-visualizer.ts

export class ExecutionVisualizer {
  /**
   * Génère une représentation visuelle du plan d'exécution
   */
  visualize(plan: ExecutionPlan): string {
    const lines: string[] = [];

    lines.push('┌' + '─'.repeat(60) + '┐');
    lines.push('│' + ' EXECUTION PLAN'.padEnd(60) + '│');
    lines.push('├' + '─'.repeat(60) + '┤');

    let timeOffset = 0;

    for (let level = 0; level < plan.levels.length; level++) {
      const tools = plan.levels[level];
      const maxDuration = Math.max(...tools.map(t => t.estimatedDuration || 100));

      // Ligne du niveau
      lines.push('│' + ` Level ${level}:`.padEnd(60) + '│');

      // Barres de progression pour chaque outil
      for (const tool of tools) {
        const duration = tool.estimatedDuration || 100;
        const barLength = Math.round((duration / maxDuration) * 40);
        const bar = '█'.repeat(barLength) + '░'.repeat(40 - barLength);
        const label = `${tool.tool.name}`.padEnd(12);

        lines.push('│' + `  ${label} ${bar} ${duration}ms`.padEnd(60) + '│');
      }

      timeOffset += maxDuration;

      if (level < plan.levels.length - 1) {
        lines.push('│' + ' '.repeat(60) + '│');
        lines.push('│' + '  ↓ (wait for completion)'.padEnd(60) + '│');
        lines.push('│' + ' '.repeat(60) + '│');
      }
    }

    lines.push('├' + '─'.repeat(60) + '┤');
    lines.push('│' + ` Total estimated time: ${timeOffset}ms`.padEnd(60) + '│');
    lines.push('│' + ` Parallelization: ${plan.parallelizableTools}/${plan.totalLevels}`.padEnd(60) + '│');
    lines.push('└' + '─'.repeat(60) + '┘');

    return lines.join('\n');
  }
}
```

### 13.3.5 Résultats de la Parallélisation

```
┌─────────────────────────────────────────────────────────────┐
│         BENCHMARKS D'EXÉCUTION PARALLÈLE                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Scénario : Analyse de codebase (15 fichiers)               │
│                                                             │
│  Séquentiel:                                                │
│  ├─ 15 × Read: 200ms × 15 = 3000ms                          │
│  ├─ 5 × Search: 300ms × 5 = 1500ms                          │
│  ├─ 1 × Analyze: 500ms                                      │
│  └─ Total: 5000ms                                           │
│                                                             │
│  Parallèle:                                                 │
│  ├─ Niveau 0: max(15 × Read, 5 × Search) = 300ms            │
│  ├─ Niveau 1: Analyze = 500ms                               │
│  └─ Total: 800ms                                            │
│                                                             │
│  Speedup: 5000 / 800 = 6.25x                                │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Benchmarks par type de tâche:                              │
│                                                             │
│  ┌────────────────────┬───────────┬───────────┬───────────┐ │
│  │ Tâche              │ Séq. (ms) │ Par. (ms) │ Speedup   │ │
│  ├────────────────────┼───────────┼───────────┼───────────┤ │
│  │ Lecture multi-file │ 3200      │ 520       │ 6.15x     │ │
│  │ Recherche globale  │ 2400      │ 680       │ 3.53x     │ │
│  │ Refactoring        │ 4800      │ 1200      │ 4.00x     │ │
│  │ Test + Build       │ 8500      │ 3400      │ 2.50x     │ │
│  │ Multi-tool chain   │ 5600      │ 1800      │ 3.11x     │ │
│  └────────────────────┴───────────┴───────────┴───────────┘ │
│                                                             │
│  Moyenne: 3.86x speedup                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 13.4 Lazy Loading et Optimisation du Démarrage

### 13.4.1 Le Problème du Cold Start

Le temps de démarrage impacte directement l'expérience utilisateur :

```typescript
// Avant optimisation : chargement synchrone de tout
// Temps de démarrage : ~3 secondes

import { PDFProcessor } from './agents/pdf-processor';
import { ExcelProcessor } from './agents/excel-processor';
import { SQLAnalyzer } from './agents/sql-analyzer';
import { ImageProcessor } from './agents/image-processor';
import { AudioTranscriber } from './agents/audio-transcriber';
import { VideoAnalyzer } from './agents/video-analyzer';
import { ArchiveHandler } from './agents/archive-handler';
import { SemanticCache } from './utils/semantic-cache';
import { DependencyAnalyzer } from './tools/dependency-analyzer';
import { MCPClient } from './mcp/client';
// ... 50+ imports lourds

// Problème : tous ces modules sont chargés même pour un simple "hello"
```

### 13.4.2 Architecture de Lazy Loading

```typescript
// src/performance/lazy-loader.ts

type ModuleFactory<T> = () => Promise<{ default: T } | T>;

/**
 * Gestionnaire de chargement différé
 */
export class LazyLoader {
  private cache: Map<string, unknown> = new Map();
  private loading: Map<string, Promise<unknown>> = new Map();
  private loadTimes: Map<string, number> = new Map();

  /**
   * Charge un module à la demande avec déduplication
   */
  async load<T>(
    name: string,
    factory: ModuleFactory<T>
  ): Promise<T> {
    // Déjà en cache
    if (this.cache.has(name)) {
      return this.cache.get(name) as T;
    }

    // Déjà en cours de chargement (déduplication)
    if (this.loading.has(name)) {
      return this.loading.get(name) as Promise<T>;
    }

    // Nouveau chargement
    const startTime = Date.now();

    const loadPromise = (async () => {
      try {
        const module = await factory();
        const instance = 'default' in module ? module.default : module;

        this.cache.set(name, instance);
        this.loadTimes.set(name, Date.now() - startTime);

        return instance;
      } finally {
        this.loading.delete(name);
      }
    })();

    this.loading.set(name, loadPromise);
    return loadPromise;
  }

  /**
   * Précharge des modules en arrière-plan
   */
  async preload(modules: Array<{ name: string; factory: ModuleFactory<unknown> }>): Promise<void> {
    // Chargement parallèle sans bloquer
    await Promise.allSettled(
      modules.map(({ name, factory }) => this.load(name, factory))
    );
  }

  /**
   * Vérifie si un module est chargé
   */
  isLoaded(name: string): boolean {
    return this.cache.has(name);
  }

  /**
   * Statistiques de chargement
   */
  getStats(): LoaderStats {
    return {
      loaded: this.cache.size,
      loading: this.loading.size,
      loadTimes: Object.fromEntries(this.loadTimes)
    };
  }

  /**
   * Libère un module de la mémoire
   */
  unload(name: string): boolean {
    if (this.cache.has(name)) {
      this.cache.delete(name);
      return true;
    }
    return false;
  }

  /**
   * Libère tous les modules
   */
  clear(): void {
    this.cache.clear();
    this.loadTimes.clear();
  }
}

interface LoaderStats {
  loaded: number;
  loading: number;
  loadTimes: Record<string, number>;
}
```

### 13.4.3 Registre des Modules Différés

```typescript
// src/performance/module-registry.ts

import { LazyLoader } from './lazy-loader.js';

/**
 * Définition d'un module différé
 */
interface LazyModule<T = unknown> {
  name: string;
  factory: () => Promise<T>;
  priority: 'critical' | 'high' | 'medium' | 'low';
  preloadTrigger?: string[];  // Événements déclenchant le préchargement
}

/**
 * Registre centralisé des modules
 */
export class ModuleRegistry {
  private loader: LazyLoader;
  private modules: Map<string, LazyModule> = new Map();

  constructor() {
    this.loader = new LazyLoader();
    this.registerBuiltinModules();
  }

  /**
   * Enregistrement des modules intégrés
   */
  private registerBuiltinModules(): void {
    // Agents spécialisés (chargés à la demande)
    this.register({
      name: 'PDFProcessor',
      factory: async () => {
        const { PDFProcessor } = await import('../agent/specialized/pdf-processor.js');
        return new PDFProcessor();
      },
      priority: 'low',
      preloadTrigger: ['file.pdf.detected']
    });

    this.register({
      name: 'ExcelProcessor',
      factory: async () => {
        const { ExcelProcessor } = await import('../agent/specialized/excel-processor.js');
        return new ExcelProcessor();
      },
      priority: 'low',
      preloadTrigger: ['file.xlsx.detected', 'file.csv.detected']
    });

    this.register({
      name: 'SQLAnalyzer',
      factory: async () => {
        const { SQLAnalyzer } = await import('../agent/specialized/sql-analyzer.js');
        return new SQLAnalyzer();
      },
      priority: 'low',
      preloadTrigger: ['file.sql.detected', 'database.connection']
    });

    // Optimisations (chargées selon le mode)
    this.register({
      name: 'SemanticCache',
      factory: async () => {
        const { SemanticCache } = await import('../utils/semantic-cache.js');
        return new SemanticCache();
      },
      priority: 'medium',
      preloadTrigger: ['session.start']
    });

    this.register({
      name: 'ParallelExecutor',
      factory: async () => {
        const { ParallelExecutor } = await import('./parallel-executor.js');
        return new ParallelExecutor();
      },
      priority: 'high',
      preloadTrigger: ['agent.ready']
    });

    // MCP (chargé si configuré)
    this.register({
      name: 'MCPClient',
      factory: async () => {
        const { MCPClient } = await import('../mcp/client.js');
        return new MCPClient();
      },
      priority: 'medium',
      preloadTrigger: ['mcp.config.found']
    });

    // Tree-of-Thought (chargé pour les tâches complexes)
    this.register({
      name: 'TreeOfThought',
      factory: async () => {
        const { TreeOfThought } = await import('../agent/reasoning/tree-of-thought.js');
        return new TreeOfThought();
      },
      priority: 'low',
      preloadTrigger: ['task.complex.detected']
    });
  }

  /**
   * Enregistre un module
   */
  register<T>(module: LazyModule<T>): void {
    this.modules.set(module.name, module as LazyModule);
  }

  /**
   * Charge un module
   */
  async get<T>(name: string): Promise<T> {
    const module = this.modules.get(name);
    if (!module) {
      throw new Error(`Module not registered: ${name}`);
    }
    return this.loader.load(name, module.factory) as Promise<T>;
  }

  /**
   * Précharge les modules pour un événement
   */
  async triggerPreload(event: string): Promise<void> {
    const toPreload = Array.from(this.modules.values())
      .filter(m => m.preloadTrigger?.includes(event));

    if (toPreload.length > 0) {
      console.log(`[LazyLoad] Preloading ${toPreload.length} modules for ${event}`);
      await this.loader.preload(
        toPreload.map(m => ({ name: m.name, factory: m.factory }))
      );
    }
  }

  /**
   * Précharge les modules critiques au démarrage
   */
  async preloadCritical(): Promise<void> {
    const critical = Array.from(this.modules.values())
      .filter(m => m.priority === 'critical');

    await this.loader.preload(
      critical.map(m => ({ name: m.name, factory: m.factory }))
    );
  }

  /**
   * Statistiques
   */
  getStats() {
    return {
      registered: this.modules.size,
      ...this.loader.getStats()
    };
  }
}

// Singleton global
export const moduleRegistry = new ModuleRegistry();
```

### 13.4.4 Intégration dans le Démarrage

```typescript
// src/index.ts (optimisé)

import { moduleRegistry } from './performance/module-registry.js';

async function main() {
  const startTime = Date.now();

  // 1. Chargement minimal synchrone
  console.log('Starting Grok-CLI...');

  // 2. Configuration de base (léger)
  const config = await loadConfig();  // ~5ms

  // 3. Interface utilisateur (critique)
  const { ChatInterface } = await import('./ui/chat-interface.js');  // ~20ms
  const ui = new ChatInterface(config);

  // 4. Agent minimal (critique)
  const { GrokAgent } = await import('./agent/grok-agent.js');  // ~10ms
  const agent = new GrokAgent(config);

  // Temps de démarrage visible : ~37ms
  console.log(`Ready in ${Date.now() - startTime}ms`);

  // 5. Préchargement en arrière-plan (non-bloquant)
  setImmediate(async () => {
    await moduleRegistry.triggerPreload('session.start');
    await moduleRegistry.triggerPreload('agent.ready');
  });

  // 6. Boucle principale
  ui.on('message', async (message) => {
    // Préchargement contextuel
    if (message.includes('.pdf')) {
      moduleRegistry.triggerPreload('file.pdf.detected');
    }
    if (message.includes('sql') || message.includes('database')) {
      moduleRegistry.triggerPreload('database.connection');
    }

    await agent.process(message);
  });

  await ui.start();
}

main().catch(console.error);
```

### 13.4.5 Résultats du Lazy Loading

```
┌─────────────────────────────────────────────────────────────┐
│          IMPACT DU LAZY LOADING                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Temps de démarrage:                                        │
│                                                             │
│  AVANT:                                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │████████████████████████████████████████████████████│   │
│  │              3000ms (tous modules)                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  APRÈS:                                                     │
│  ┌───┐                                                      │
│  │███│ 37ms (modules critiques)                             │
│  └───┘                                                      │
│       └─ Réduction: 98.8%                                   │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Mémoire initiale:                                          │
│  ├─ Avant: 245 MB                                           │
│  ├─ Après: 48 MB                                            │
│  └─ Réduction: 80.4%                                        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Premier message:                                           │
│  ├─ Avant: 3000ms + 500ms = 3500ms                          │
│  ├─ Après: 37ms + 500ms = 537ms (cache warm)                │
│  │         37ms + 150ms = 187ms (modules préchargés)        │
│  └─ Amélioration: 85-95%                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 13.5 Optimisation de la Latence

### 13.5.1 L'Importance du Flow State

La recherche sur l'interaction humain-IA montre que la latence impacte directement la productivité :

```
┌─────────────────────────────────────────────────────────────┐
│           LATENCE ET FLOW STATE                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Latence          Perception           Impact               │
│                                                             │
│  < 100ms          Instantané           Flow parfait         │
│  100-300ms        Rapide               Flow maintenu        │
│  300-1000ms       Perceptible          Flow fragile         │
│  1-3s             Attente              Flow interrompu      │
│  > 3s             Frustration          Abandon fréquent     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Productivité relative:                                     │
│                                                             │
│  100│ ████████████████████████████                          │
│   80│ ██████████████████████                                │
│   60│ ███████████████                                       │
│   40│ ███████                                               │
│   20│ ███                                                   │
│     └────────────────────────────────────────────►          │
│       100ms    500ms    1s      2s      3s                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 13.5.2 Stratégies d'Optimisation de Latence

```typescript
// src/optimization/latency-optimizer.ts

/**
 * Configuration des seuils de latence
 */
interface LatencyConfig {
  targetP50: number;   // 300ms
  targetP95: number;   // 1000ms
  targetP99: number;   // 2000ms
  maxAcceptable: number; // 5000ms
}

/**
 * Optimiseur de latence multi-stratégie
 */
export class LatencyOptimizer {
  private config: LatencyConfig;
  private measurements: LatencyMeasurement[] = [];
  private strategies: LatencyStrategy[] = [];

  constructor(config: Partial<LatencyConfig> = {}) {
    this.config = {
      targetP50: config.targetP50 ?? 300,
      targetP95: config.targetP95 ?? 1000,
      targetP99: config.targetP99 ?? 2000,
      maxAcceptable: config.maxAcceptable ?? 5000
    };

    this.initializeStrategies();
  }

  /**
   * Initialisation des stratégies
   */
  private initializeStrategies(): void {
    this.strategies = [
      new StreamingStrategy(),
      new PredictivePrefetchStrategy(),
      new ConnectionPoolStrategy(),
      new ResponseCachingStrategy(),
      new ProgressiveRenderingStrategy()
    ];
  }

  /**
   * Optimise une requête
   */
  async optimizeRequest<T>(
    request: () => Promise<T>,
    context: RequestContext
  ): Promise<OptimizedResult<T>> {
    const startTime = Date.now();

    // Sélection des stratégies applicables
    const applicableStrategies = this.strategies.filter(
      s => s.isApplicable(context)
    );

    // Application des optimisations pré-requête
    for (const strategy of applicableStrategies) {
      await strategy.preRequest(context);
    }

    try {
      // Exécution avec timeout
      const result = await this.executeWithTimeout(
        request,
        this.config.maxAcceptable
      );

      const latency = Date.now() - startTime;

      // Enregistrement de la mesure
      this.recordMeasurement({
        latency,
        context,
        strategies: applicableStrategies.map(s => s.name),
        success: true
      });

      // Application des optimisations post-requête
      for (const strategy of applicableStrategies) {
        await strategy.postRequest(context, result, latency);
      }

      return {
        value: result,
        latency,
        cached: context.wasServedFromCache ?? false,
        strategies: applicableStrategies.map(s => s.name)
      };

    } catch (error) {
      const latency = Date.now() - startTime;

      this.recordMeasurement({
        latency,
        context,
        strategies: applicableStrategies.map(s => s.name),
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    }
  }

  /**
   * Exécution avec timeout
   */
  private async executeWithTimeout<T>(
    request: () => Promise<T>,
    timeout: number
  ): Promise<T> {
    return Promise.race([
      request(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), timeout);
      })
    ]);
  }

  /**
   * Enregistrement d'une mesure
   */
  private recordMeasurement(measurement: LatencyMeasurement): void {
    this.measurements.push(measurement);

    // Limite la taille de l'historique
    if (this.measurements.length > 10000) {
      this.measurements = this.measurements.slice(-5000);
    }
  }

  /**
   * Calcul des percentiles
   */
  getPercentiles(): LatencyPercentiles {
    if (this.measurements.length === 0) {
      return { p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...this.measurements]
      .filter(m => m.success)
      .map(m => m.latency)
      .sort((a, b) => a - b);

    const len = sorted.length;

    return {
      p50: sorted[Math.floor(len * 0.5)] ?? 0,
      p95: sorted[Math.floor(len * 0.95)] ?? 0,
      p99: sorted[Math.floor(len * 0.99)] ?? 0
    };
  }

  /**
   * Vérification des objectifs
   */
  checkTargets(): LatencyHealth {
    const percentiles = this.getPercentiles();

    return {
      p50Met: percentiles.p50 <= this.config.targetP50,
      p95Met: percentiles.p95 <= this.config.targetP95,
      p99Met: percentiles.p99 <= this.config.targetP99,
      overall: percentiles.p50 <= this.config.targetP50 &&
               percentiles.p95 <= this.config.targetP95,
      recommendations: this.generateRecommendations(percentiles)
    };
  }

  /**
   * Génération de recommandations
   */
  private generateRecommendations(
    percentiles: LatencyPercentiles
  ): string[] {
    const recommendations: string[] = [];

    if (percentiles.p50 > this.config.targetP50) {
      recommendations.push('Enable response caching for common queries');
      recommendations.push('Consider using a faster model tier for simple tasks');
    }

    if (percentiles.p95 > this.config.targetP95) {
      recommendations.push('Implement streaming for long-running requests');
      recommendations.push('Add connection pooling to reduce connection overhead');
    }

    if (percentiles.p99 > this.config.targetP99) {
      recommendations.push('Add circuit breaker for slow endpoints');
      recommendations.push('Implement request timeout with fallback');
    }

    return recommendations;
  }
}

/**
 * Stratégie de streaming pour réponses longues
 */
class StreamingStrategy implements LatencyStrategy {
  name = 'streaming';

  isApplicable(context: RequestContext): boolean {
    return context.expectedResponseSize > 1000 ||
           context.requestType === 'generation';
  }

  async preRequest(context: RequestContext): Promise<void> {
    context.useStreaming = true;
    context.onFirstToken = () => {
      context.timeToFirstToken = Date.now() - context.startTime;
    };
  }

  async postRequest(): Promise<void> {
    // Pas d'action post-requête
  }
}

/**
 * Stratégie de préchargement prédictif
 */
class PredictivePrefetchStrategy implements LatencyStrategy {
  name = 'predictive-prefetch';
  private predictionCache: Map<string, string[]> = new Map();

  isApplicable(context: RequestContext): boolean {
    return context.userPattern !== undefined;
  }

  async preRequest(context: RequestContext): Promise<void> {
    // Précharge les ressources probables
    const predictions = this.predictNextActions(context);
    for (const prediction of predictions) {
      this.prefetch(prediction);
    }
  }

  private predictNextActions(context: RequestContext): string[] {
    // Analyse des patterns de l'utilisateur
    const pattern = context.userPattern!;
    return this.predictionCache.get(pattern) ?? [];
  }

  private async prefetch(resource: string): Promise<void> {
    // Préchargement en arrière-plan
    setImmediate(() => {
      // Logique de préchargement
    });
  }

  async postRequest(
    context: RequestContext,
    _result: unknown,
    _latency: number
  ): Promise<void> {
    // Mise à jour des prédictions
    if (context.userPattern) {
      const next = context.nextAction;
      if (next) {
        const existing = this.predictionCache.get(context.userPattern) ?? [];
        if (!existing.includes(next)) {
          existing.push(next);
          this.predictionCache.set(context.userPattern, existing.slice(-5));
        }
      }
    }
  }
}

/**
 * Stratégie de pool de connexions
 */
class ConnectionPoolStrategy implements LatencyStrategy {
  name = 'connection-pool';
  private pool: Map<string, Connection[]> = new Map();
  private maxConnections = 10;

  isApplicable(): boolean {
    return true; // Toujours applicable
  }

  async preRequest(context: RequestContext): Promise<void> {
    context.connection = await this.getConnection(context.endpoint);
  }

  private async getConnection(endpoint: string): Promise<Connection> {
    const available = this.pool.get(endpoint)?.filter(c => !c.inUse);

    if (available && available.length > 0) {
      const conn = available[0];
      conn.inUse = true;
      return conn;
    }

    // Créer une nouvelle connexion si possible
    const poolSize = this.pool.get(endpoint)?.length ?? 0;
    if (poolSize < this.maxConnections) {
      const conn = await this.createConnection(endpoint);
      const pool = this.pool.get(endpoint) ?? [];
      pool.push(conn);
      this.pool.set(endpoint, pool);
      return conn;
    }

    // Attendre une connexion disponible
    return this.waitForConnection(endpoint);
  }

  private async createConnection(endpoint: string): Promise<Connection> {
    return {
      endpoint,
      inUse: true,
      createdAt: Date.now()
    };
  }

  private async waitForConnection(endpoint: string): Promise<Connection> {
    // Implémentation de l'attente
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const available = this.pool.get(endpoint)?.find(c => !c.inUse);
        if (available) {
          clearInterval(interval);
          available.inUse = true;
          resolve(available);
        }
      }, 10);
    });
  }

  async postRequest(context: RequestContext): Promise<void> {
    if (context.connection) {
      context.connection.inUse = false;
    }
  }
}

// Types
interface LatencyStrategy {
  name: string;
  isApplicable(context: RequestContext): boolean;
  preRequest(context: RequestContext): Promise<void>;
  postRequest(
    context: RequestContext,
    result: unknown,
    latency: number
  ): Promise<void>;
}

interface RequestContext {
  endpoint: string;
  requestType: string;
  expectedResponseSize: number;
  userPattern?: string;
  useStreaming?: boolean;
  startTime: number;
  timeToFirstToken?: number;
  onFirstToken?: () => void;
  connection?: Connection;
  wasServedFromCache?: boolean;
  nextAction?: string;
}

interface Connection {
  endpoint: string;
  inUse: boolean;
  createdAt: number;
}

interface LatencyMeasurement {
  latency: number;
  context: RequestContext;
  strategies: string[];
  success: boolean;
  error?: string;
}

interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
}

interface LatencyHealth {
  p50Met: boolean;
  p95Met: boolean;
  p99Met: boolean;
  overall: boolean;
  recommendations: string[];
}

interface OptimizedResult<T> {
  value: T;
  latency: number;
  cached: boolean;
  strategies: string[];
}
```

### 13.5.3 Streaming pour Réponses Longues

```typescript
// src/optimization/streaming-handler.ts

/**
 * Gestionnaire de streaming pour améliorer le TTFB
 */
export class StreamingHandler {
  private bufferSize: number;

  constructor(bufferSize = 10) {
    this.bufferSize = bufferSize;
  }

  /**
   * Transforme une requête en stream avec indicateur de progression
   */
  async *streamWithProgress<T>(
    stream: AsyncIterable<T>,
    onProgress: (progress: StreamProgress) => void
  ): AsyncIterable<T> {
    let tokenCount = 0;
    let startTime = Date.now();
    let firstTokenTime: number | null = null;

    for await (const chunk of stream) {
      if (firstTokenTime === null) {
        firstTokenTime = Date.now();
        onProgress({
          phase: 'first_token',
          timeToFirstToken: firstTokenTime - startTime,
          tokenCount: 1
        });
      }

      tokenCount++;

      // Rapport de progression tous les N tokens
      if (tokenCount % this.bufferSize === 0) {
        onProgress({
          phase: 'streaming',
          tokenCount,
          tokensPerSecond: tokenCount / ((Date.now() - startTime) / 1000)
        });
      }

      yield chunk;
    }

    onProgress({
      phase: 'complete',
      tokenCount,
      totalTime: Date.now() - startTime,
      timeToFirstToken: firstTokenTime ? firstTokenTime - startTime : 0
    });
  }

  /**
   * Buffer pour affichage progressif
   */
  createDisplayBuffer(
    onFlush: (content: string) => void
  ): DisplayBuffer {
    let buffer = '';
    let timer: NodeJS.Timeout | null = null;
    const flushInterval = 16; // ~60fps

    const flush = () => {
      if (buffer.length > 0) {
        onFlush(buffer);
        buffer = '';
      }
      timer = null;
    };

    return {
      add: (content: string) => {
        buffer += content;
        if (!timer) {
          timer = setTimeout(flush, flushInterval);
        }
      },
      flush: () => {
        if (timer) {
          clearTimeout(timer);
        }
        flush();
      }
    };
  }
}

interface StreamProgress {
  phase: 'first_token' | 'streaming' | 'complete';
  tokenCount: number;
  timeToFirstToken?: number;
  tokensPerSecond?: number;
  totalTime?: number;
}

interface DisplayBuffer {
  add: (content: string) => void;
  flush: () => void;
}
```

---

## 13.6 Request Batching et Déduplication

### 13.6.1 Optimisation des Appels Réseau

```typescript
// src/performance/request-optimizer.ts

/**
 * Optimiseur de requêtes avec batching et déduplication
 */
export class RequestOptimizer {
  private pendingRequests: Map<string, PendingRequest[]> = new Map();
  private batchWindow: number;
  private maxBatchSize: number;

  constructor(options: OptimizerOptions = {}) {
    this.batchWindow = options.batchWindow ?? 50; // 50ms
    this.maxBatchSize = options.maxBatchSize ?? 10;
  }

  /**
   * Requête avec déduplication automatique
   */
  async request<T>(
    key: string,
    executor: () => Promise<T>
  ): Promise<T> {
    // Vérifier si une requête identique est en cours
    const pending = this.pendingRequests.get(key);
    if (pending) {
      // Réutiliser la requête en cours
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    }

    // Nouvelle requête
    const newPending: PendingRequest[] = [];
    this.pendingRequests.set(key, newPending);

    try {
      const result = await executor();

      // Résoudre toutes les requêtes en attente
      for (const { resolve } of newPending) {
        resolve(result);
      }

      return result;

    } catch (error) {
      // Rejeter toutes les requêtes en attente
      for (const { reject } of newPending) {
        reject(error);
      }
      throw error;

    } finally {
      this.pendingRequests.delete(key);
    }
  }

  /**
   * Batching de requêtes similaires
   */
  async batch<I, O>(
    items: I[],
    batchExecutor: (batch: I[]) => Promise<O[]>,
    getKey: (item: I) => string
  ): Promise<O[]> {
    const results: Map<string, O> = new Map();
    const batches: I[][] = [];
    let currentBatch: I[] = [];

    // Création des batches
    for (const item of items) {
      const key = getKey(item);

      // Déduplication
      if (results.has(key)) {
        continue;
      }

      currentBatch.push(item);

      if (currentBatch.length >= this.maxBatchSize) {
        batches.push(currentBatch);
        currentBatch = [];
      }
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    // Exécution parallèle des batches
    const batchResults = await Promise.all(
      batches.map(batch => batchExecutor(batch))
    );

    // Collecte des résultats
    let resultIndex = 0;
    for (const batch of batches) {
      const batchResult = batchResults[batches.indexOf(batch)];
      for (let i = 0; i < batch.length; i++) {
        const key = getKey(batch[i]);
        results.set(key, batchResult[i]);
      }
    }

    // Retour dans l'ordre original
    return items.map(item => results.get(getKey(item))!);
  }

  /**
   * Debounce avec fusion des requêtes
   */
  createDebouncer<T>(
    executor: (merged: T) => Promise<void>,
    merger: (a: T, b: T) => T,
    delay: number
  ): Debouncer<T> {
    let pending: T | null = null;
    let timer: NodeJS.Timeout | null = null;

    return {
      add: (item: T) => {
        if (pending === null) {
          pending = item;
        } else {
          pending = merger(pending, item);
        }

        if (timer) {
          clearTimeout(timer);
        }

        timer = setTimeout(async () => {
          if (pending !== null) {
            const toExecute = pending;
            pending = null;
            timer = null;
            await executor(toExecute);
          }
        }, delay);
      },
      flush: async () => {
        if (timer) {
          clearTimeout(timer);
        }
        if (pending !== null) {
          const toExecute = pending;
          pending = null;
          timer = null;
          await executor(toExecute);
        }
      }
    };
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

interface OptimizerOptions {
  batchWindow?: number;
  maxBatchSize?: number;
}

interface Debouncer<T> {
  add: (item: T) => void;
  flush: () => Promise<void>;
}
```

### 13.6.2 Exemple d'Utilisation : Lecture de Fichiers

```typescript
// Exemple : lecture optimisée de multiples fichiers

const optimizer = new RequestOptimizer({ maxBatchSize: 20 });

// Sans optimisation : 50 requêtes séquentielles
async function readFilesNaive(paths: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const path of paths) {
    const content = await fs.readFile(path, 'utf-8');
    results.push(content);
  }
  return results; // ~500ms pour 50 fichiers
}

// Avec optimisation : batching + déduplication
async function readFilesOptimized(paths: string[]): Promise<string[]> {
  return optimizer.batch(
    paths,
    async (batch) => {
      // Lecture parallèle du batch
      return Promise.all(
        batch.map(path => fs.readFile(path, 'utf-8'))
      );
    },
    (path) => path // Clé de déduplication
  ); // ~100ms pour 50 fichiers (5x speedup)
}

// Avec déduplication : requêtes identiques fusionnées
async function searchWithDedup(query: string): Promise<SearchResult[]> {
  return optimizer.request(
    `search:${query}`,
    async () => {
      return searchEngine.search(query);
    }
  );
}

// 10 composants appellent searchWithDedup("test") simultanément
// → 1 seule requête réelle, résultat partagé
```

---

## 13.7 Tableau de Bord des Performances

### 13.7.1 Métriques Unifiées

```typescript
// src/performance/performance-manager.ts

import { ModelRouter } from '../optimization/model-routing.js';
import { ParallelExecutor } from '../optimization/parallel-executor.js';
import { LatencyOptimizer } from '../optimization/latency-optimizer.js';
import { moduleRegistry } from './module-registry.js';

/**
 * Gestionnaire central des performances
 */
export class PerformanceManager {
  private modelRouter: ModelRouter;
  private parallelExecutor: ParallelExecutor;
  private latencyOptimizer: LatencyOptimizer;

  private metrics: PerformanceMetrics = {
    totalRequests: 0,
    totalCost: 0,
    totalLatency: 0,
    cacheHits: 0,
    cacheMisses: 0,
    parallelizedTools: 0,
    sequentialTools: 0
  };

  constructor() {
    this.modelRouter = new ModelRouter();
    this.parallelExecutor = new ParallelExecutor();
    this.latencyOptimizer = new LatencyOptimizer();
  }

  /**
   * Génère un rapport de performance complet
   */
  generateReport(): PerformanceReport {
    const routerStats = this.modelRouter.getStatistics();
    const latencyHealth = this.latencyOptimizer.checkTargets();
    const percentiles = this.latencyOptimizer.getPercentiles();
    const moduleStats = moduleRegistry.getStats();

    // Calculs dérivés
    const cacheHitRate = this.metrics.cacheHits /
      (this.metrics.cacheHits + this.metrics.cacheMisses) || 0;

    const parallelizationRate = this.metrics.parallelizedTools /
      (this.metrics.parallelizedTools + this.metrics.sequentialTools) || 0;

    const averageLatency = this.metrics.totalLatency /
      this.metrics.totalRequests || 0;

    const averageCost = this.metrics.totalCost /
      this.metrics.totalRequests || 0;

    return {
      summary: {
        totalRequests: this.metrics.totalRequests,
        totalCost: this.metrics.totalCost,
        averageCost,
        averageLatency,
        cacheHitRate,
        parallelizationRate
      },

      modelRouting: {
        distribution: routerStats.byTier,
        estimatedSavings: routerStats.estimatedSavings,
        averageQuality: routerStats.averageQuality
      },

      latency: {
        percentiles,
        health: latencyHealth,
        recommendations: latencyHealth.recommendations
      },

      modules: {
        loaded: moduleStats.loaded,
        loadTimes: moduleStats.loadTimes
      },

      optimization: {
        costReduction: this.calculateCostReduction(routerStats),
        latencyReduction: this.calculateLatencyReduction(percentiles),
        throughputImprovement: parallelizationRate * 100
      }
    };
  }

  /**
   * Affichage formaté du rapport
   */
  formatReport(): string {
    const report = this.generateReport();

    const lines: string[] = [
      '┌' + '─'.repeat(60) + '┐',
      '│' + ' PERFORMANCE DASHBOARD'.padEnd(60) + '│',
      '├' + '─'.repeat(60) + '┤',
      '│' + ' Summary'.padEnd(60) + '│',
      '│' + `   Requests: ${report.summary.totalRequests}`.padEnd(60) + '│',
      '│' + `   Total Cost: $${report.summary.totalCost.toFixed(2)}`.padEnd(60) + '│',
      '│' + `   Avg Latency: ${report.summary.averageLatency.toFixed(0)}ms`.padEnd(60) + '│',
      '│' + `   Cache Hit Rate: ${(report.summary.cacheHitRate * 100).toFixed(1)}%`.padEnd(60) + '│',
      '├' + '─'.repeat(60) + '┤',
      '│' + ' Model Routing'.padEnd(60) + '│',
      '│' + `   Fast tier: ${report.modelRouting.distribution.fast || 0} requests`.padEnd(60) + '│',
      '│' + `   Balanced: ${report.modelRouting.distribution.balanced || 0} requests`.padEnd(60) + '│',
      '│' + `   Powerful: ${report.modelRouting.distribution.powerful || 0} requests`.padEnd(60) + '│',
      '│' + `   Est. Savings: ${(report.modelRouting.estimatedSavings * 100).toFixed(0)}%`.padEnd(60) + '│',
      '├' + '─'.repeat(60) + '┤',
      '│' + ' Latency'.padEnd(60) + '│',
      '│' + `   P50: ${report.latency.percentiles.p50}ms ${report.latency.health.p50Met ? '✓' : '✗'}`.padEnd(60) + '│',
      '│' + `   P95: ${report.latency.percentiles.p95}ms ${report.latency.health.p95Met ? '✓' : '✗'}`.padEnd(60) + '│',
      '│' + `   P99: ${report.latency.percentiles.p99}ms ${report.latency.health.p99Met ? '✓' : '✗'}`.padEnd(60) + '│',
      '├' + '─'.repeat(60) + '┤',
      '│' + ' Improvements'.padEnd(60) + '│',
      '│' + `   Cost Reduction: ${report.optimization.costReduction.toFixed(0)}%`.padEnd(60) + '│',
      '│' + `   Latency Reduction: ${report.optimization.latencyReduction.toFixed(0)}%`.padEnd(60) + '│',
      '│' + `   Throughput Boost: ${report.optimization.throughputImprovement.toFixed(0)}%`.padEnd(60) + '│',
      '└' + '─'.repeat(60) + '┘'
    ];

    return lines.join('\n');
  }

  /**
   * Enregistrement d'une métrique
   */
  record(metric: Partial<PerformanceMetrics>): void {
    if (metric.totalRequests) this.metrics.totalRequests += metric.totalRequests;
    if (metric.totalCost) this.metrics.totalCost += metric.totalCost;
    if (metric.totalLatency) this.metrics.totalLatency += metric.totalLatency;
    if (metric.cacheHits) this.metrics.cacheHits += metric.cacheHits;
    if (metric.cacheMisses) this.metrics.cacheMisses += metric.cacheMisses;
    if (metric.parallelizedTools) this.metrics.parallelizedTools += metric.parallelizedTools;
    if (metric.sequentialTools) this.metrics.sequentialTools += metric.sequentialTools;
  }

  /**
   * Calcul de la réduction de coût
   */
  private calculateCostReduction(stats: RouterStatistics): number {
    // Comparaison avec le coût si tout était en tier "powerful"
    const baseCost = stats.total * 0.01; // $0.01 per request
    const actualCost =
      (stats.byTier.fast || 0) * 0.0001 +
      (stats.byTier.balanced || 0) * 0.002 +
      (stats.byTier.powerful || 0) * 0.01;

    return baseCost > 0 ? ((baseCost - actualCost) / baseCost) * 100 : 0;
  }

  /**
   * Calcul de la réduction de latence
   */
  private calculateLatencyReduction(percentiles: LatencyPercentiles): number {
    // Baseline : 2000ms sans optimisation
    const baseline = 2000;
    return ((baseline - percentiles.p50) / baseline) * 100;
  }

  /**
   * Réinitialisation des métriques
   */
  reset(): void {
    this.metrics = {
      totalRequests: 0,
      totalCost: 0,
      totalLatency: 0,
      cacheHits: 0,
      cacheMisses: 0,
      parallelizedTools: 0,
      sequentialTools: 0
    };
  }
}

// Types
interface PerformanceMetrics {
  totalRequests: number;
  totalCost: number;
  totalLatency: number;
  cacheHits: number;
  cacheMisses: number;
  parallelizedTools: number;
  sequentialTools: number;
}

interface PerformanceReport {
  summary: {
    totalRequests: number;
    totalCost: number;
    averageCost: number;
    averageLatency: number;
    cacheHitRate: number;
    parallelizationRate: number;
  };
  modelRouting: {
    distribution: Record<string, number>;
    estimatedSavings: number;
    averageQuality: number;
  };
  latency: {
    percentiles: LatencyPercentiles;
    health: LatencyHealth;
    recommendations: string[];
  };
  modules: {
    loaded: number;
    loadTimes: Record<string, number>;
  };
  optimization: {
    costReduction: number;
    latencyReduction: number;
    throughputImprovement: number;
  };
}
```

---

## 13.8 Exercices Pratiques

### Exercice 1 : Implémenter un Router de Modèle Simple

```typescript
/**
 * Exercice : Créer un router de modèle basé sur des règles
 *
 * Objectifs :
 * 1. Classifier les tâches en 3 catégories
 * 2. Router vers le modèle approprié
 * 3. Mesurer les économies réalisées
 */

class SimpleModelRouter {
  route(task: string): { model: string; reason: string } {
    // TODO: Implémenter la logique de routage
    // Indice : utiliser des mots-clés pour classifier

    throw new Error('Not implemented');
  }

  estimateSavings(tasks: string[]): number {
    // TODO: Calculer le pourcentage d'économies
    // Baseline : tout en GPT-4

    throw new Error('Not implemented');
  }
}

// Tests
const router = new SimpleModelRouter();

console.assert(
  router.route('format this JSON').model === 'gpt-4o-mini',
  'Simple formatting should use mini'
);

console.assert(
  router.route('design a microservices architecture').model === 'gpt-4-turbo',
  'Complex architecture should use turbo'
);
```

### Exercice 2 : Implémenter un Système de Lazy Loading

```typescript
/**
 * Exercice : Créer un système de lazy loading avec préchargement
 *
 * Objectifs :
 * 1. Charger les modules à la demande
 * 2. Précharger selon les événements
 * 3. Mesurer l'impact sur le temps de démarrage
 */

class SimpleLazyLoader {
  private cache: Map<string, unknown> = new Map();

  async load<T>(name: string, factory: () => Promise<T>): Promise<T> {
    // TODO: Implémenter le chargement différé
    throw new Error('Not implemented');
  }

  async preloadForEvent(event: string): Promise<void> {
    // TODO: Précharger les modules associés à l'événement
    throw new Error('Not implemented');
  }

  getLoadedCount(): number {
    return this.cache.size;
  }
}

// Test de performance
async function measureStartup(uselazyLoading: boolean): Promise<number> {
  const start = Date.now();

  if (uselazyLoading) {
    const loader = new SimpleLazyLoader();
    // Charger uniquement ce qui est nécessaire
  } else {
    // Charger tous les modules
  }

  return Date.now() - start;
}
```

### Exercice 3 : Construire un Exécuteur Parallèle Simplifié

```typescript
/**
 * Exercice : Créer un exécuteur de tâches avec parallélisation
 *
 * Objectifs :
 * 1. Analyser les dépendances entre tâches
 * 2. Paralléliser les tâches indépendantes
 * 3. Comparer avec l'exécution séquentielle
 */

interface Task {
  id: string;
  execute: () => Promise<void>;
  dependencies: string[];
}

class SimpleParallelExecutor {
  async execute(tasks: Task[]): Promise<ExecutionReport> {
    // TODO: Implémenter l'exécution avec parallélisation
    // 1. Construire le graphe de dépendances
    // 2. Identifier les niveaux parallèles
    // 3. Exécuter niveau par niveau

    throw new Error('Not implemented');
  }
}

interface ExecutionReport {
  totalTime: number;
  sequentialTime: number;
  speedup: number;
  levels: number;
}

// Test
const tasks: Task[] = [
  { id: 'a', execute: async () => delay(100), dependencies: [] },
  { id: 'b', execute: async () => delay(100), dependencies: [] },
  { id: 'c', execute: async () => delay(100), dependencies: ['a', 'b'] },
];

// Attendu : totalTime ~200ms (a+b en parallèle, puis c)
// Au lieu de : 300ms séquentiel
```

---

## 13.9 Points Clés du Chapitre

```
┌─────────────────────────────────────────────────────────────┐
│         RÉCAPITULATIF : OPTIMISATIONS SYSTÈME               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. MODEL ROUTING (FrugalGPT)                               │
│     ├─ Classification des tâches par complexité             │
│     ├─ Routage vers le tier approprié                       │
│     ├─ Cascade automatique si qualité insuffisante          │
│     └─ Économies : 30-70% des coûts API                     │
│                                                             │
│  2. PARALLEL EXECUTION (LLMCompiler)                        │
│     ├─ Analyse du graphe de dépendances                     │
│     ├─ Regroupement par niveaux                             │
│     ├─ Exécution parallèle des outils indépendants          │
│     └─ Speedup : 2.5-4.6x                                   │
│                                                             │
│  3. LAZY LOADING                                            │
│     ├─ Chargement différé des modules lourds                │
│     ├─ Préchargement contextuel                             │
│     ├─ Déduplication des imports                            │
│     └─ Démarrage : 3s → 37ms (-98.8%)                       │
│                                                             │
│  4. LATENCY OPTIMIZATION                                    │
│     ├─ Streaming pour réponses longues                      │
│     ├─ Pool de connexions                                   │
│     ├─ Préchargement prédictif                              │
│     └─ Objectif : P50 < 300ms pour flow state               │
│                                                             │
│  5. REQUEST BATCHING                                        │
│     ├─ Déduplication des requêtes identiques                │
│     ├─ Batching des opérations similaires                   │
│     ├─ Debounce avec fusion                                 │
│     └─ Réduction : 5x moins de requêtes                     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  IMPACT COMBINÉ                                             │
│  ├─ Coût : -68% (routage + cache)                           │
│  ├─ Latence : -64% (parallélisation + streaming)            │
│  ├─ Démarrage : -98.8% (lazy loading)                       │
│  └─ Throughput : +250% (parallélisation)                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Épilogue : L'Agent Optimisé

Lina contemplait le nouveau tableau de bord. Les métriques racontaient une histoire de transformation :

- **Coût mensuel** : de 15 000€ à 4 800€
- **Latence P50** : de 4.2s à 380ms
- **Temps de démarrage** : de 3s à 37ms
- **Satisfaction utilisateur** : de 68% à 94%

— "On a divisé les coûts par trois," résuma Karim, impressionné. "Sans sacrifier la qualité."

Lina hocha la tête.

— "Le secret, c'est de ne pas traiter tous les problèmes de la même façon. Une question simple n'a pas besoin d'un modèle de 200 milliards de paramètres. Des lectures de fichiers indépendantes n'ont pas besoin d'attendre les unes les autres. Et un module de traitement PDF n'a pas besoin d'être chargé pour dire 'bonjour'."

Elle ajouta le dernier commit :

```bash
git commit -m "perf: reduce costs by 68%, latency by 64%, startup by 98.8%"
```

L'agent Grok-CLI n'était plus seulement intelligent — il était efficace. Et dans le monde réel, où les budgets sont limités et les utilisateurs impatients, l'efficacité faisait toute la différence.

---

*Dans le prochain chapitre, nous explorerons comment un agent peut apprendre de ses expériences pour s'améliorer continuellement, transformant chaque interaction en opportunité d'apprentissage.*
