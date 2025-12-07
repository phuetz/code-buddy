# 🏗️ Chapitre 15 : Architecture Complète — Grok-CLI de A à Z

---

## 🎬 Scène d'ouverture : La Vue d'Ensemble

*Un an après le premier commit...*

Lina se tenait devant l'écran de la salle de conférence. Derrière elle, le schéma complet de Grok-CLI occupait tout le mur — des dizaines de composants interconnectés, le fruit d'une année de développement itératif.

— "Et voilà où nous en sommes," dit-elle à l'équipe réunie. "Ce qui a commencé comme un simple wrapper autour de l'API Grok est devenu... ça."

Elle désigna le diagramme. Les nouveaux développeurs écarquillèrent les yeux.

— "Ne vous inquiétez pas," ajouta-t-elle avec un sourire. "Chaque pièce a une raison d'être. Aujourd'hui, je vais vous montrer comment tout s'assemble."

Marcus, l'un des nouveaux, leva la main.

— "Par où on commence ?"

— "Par le haut," répondit Lina. "Six couches. Une à la fois."

---

## 📋 Table des Matières

| Section | Titre | Description |
|---------|-------|-------------|
| 15.1 | 🌍 Vue Aérienne | Les 6 couches et le flux de données |
| 15.2 | 🖥️ Couche Interface | React/Ink, streaming, composants UI |
| 15.3 | 🎯 Couche Orchestration | GrokAgent, boucle agentique, multi-agent |
| 15.4 | 🧠 Couche Raisonnement | ToT, MCTS, Repair, stratégies hybrides |
| 15.5 | 💾 Couche Contexte & Mémoire | RAG, compression, mémoire unifiée |
| 15.6 | ⚡ Couche Actions | 41 outils, registre, MCP |
| 15.7 | 🔒 Couche Sécurité | Permissions, sandbox, audit |
| 15.8 | 📊 Intégration Complète | Diagramme global, configuration |
| 15.9 | 📈 Métriques & Monitoring | Dashboard, statistiques |
| 15.10 | 📝 Points Clés | Synthèse du chapitre |
| 15.11 | 🔬 De la Recherche à l'Implémentation | Mapping articles → code |
| 15.12 | 🏠 LLM Local en JavaScript | WebLLM, Transformers.js, node-llama-cpp |

---

## 15.1 🌍 Vue Aérienne de l'Architecture

### 15.1.1 Les Six Couches

L'architecture de Grok-CLI suit le principe de **séparation des responsabilités**. Chaque couche a un rôle précis et communique uniquement avec ses voisines immédiates.

![Architecture Grok-CLI](images/grok-architecture-layers.svg)

| Couche | Responsabilité | Composants Clés |
|--------|----------------|-----------------|
| 🖥️ Interface | Interaction utilisateur | ChatInterface, StreamingText, ToolProgress |
| 🎯 Orchestration | Coordination globale | GrokAgent, MultiAgentCoordinator |
| 🧠 Raisonnement | Stratégies de résolution | ToT, MCTS, IterativeRepair |
| 💾 Contexte | Gestion de l'information | RAGPipeline, ContextCompressor, UnifiedMemory |
| ⚡ Actions | Exécution des tâches | ToolRegistry, ParallelExecutor, MCPClient |
| 🔒 Sécurité | Protection système | ApprovalModes, Sandbox, DataRedaction |

### 15.1.2 Flux de Données Principal

![Flux de données](images/data-flow.svg)

**Étapes du flux :**

1. **Parse & Hooks** — L'entrée utilisateur est analysée et les hooks pré-exécution sont déclenchés
2. **Security Check** — Vérification des permissions et détection de patterns dangereux
3. **Context Enrichment** — RAG, mémoires, et profil utilisateur sont ajoutés au contexte
4. **Model Routing** — Sélection du modèle optimal (FrugalGPT)
5. **Agent Loop** — Boucle agentique avec max 30 itérations
6. **Tool Execution** — Exécution parallèle des outils demandés
7. **Render Results** — Formatage et streaming vers l'utilisateur
8. **Memory Update** — Apprentissage et mise à jour des mémoires

---

## 15.2 🖥️ Couche Interface (UI)

### 15.2.1 Stack Technologique

La couche UI utilise **React 18** avec **Ink 4** pour créer une interface terminal riche et réactive.

| Technologie | Rôle | Avantage |
|-------------|------|----------|
| React 18 | Framework UI | Composants réutilisables, hooks |
| Ink 4 | Rendu terminal | Flexbox pour terminal, composants natifs |
| Streaming | Affichage progressif | Feedback immédiat, UX fluide |
| Error Boundaries | Résilience | Crash gracieux, récupération |

```typescript
// src/ui/chat-interface.tsx

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { ErrorBoundary } from './components/error-boundary.js';
import { StreamingText } from './components/streaming-text.js';

/**
 * 🖥️ Interface principale du chat
 *
 * Responsabilités :
 * - Gestion des entrées clavier
 * - Affichage des messages (user/assistant)
 * - Streaming des réponses
 * - Progression des outils
 */
export function ChatInterface({ agent, config }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const { exit } = useApp();

  // ⌨️ Gestion des entrées clavier
  useInput((inputChar, key) => {
    if (key.escape) exit();
    if (key.return && !isProcessing) handleSubmit();
  });

  const handleSubmit = useCallback(async () => {
    if (!input.trim()) return;

    const userMessage = input;
    setInput('');
    setIsProcessing(true);

    // Ajout du message utilisateur
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      // 📡 Streaming de la réponse
      for await (const chunk of agent.processStream(userMessage)) {
        if (chunk.type === 'text') {
          setStreamingContent(prev => prev + chunk.content);
        }
      }

      // ✅ Finalisation
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: streamingContent
      }]);
      setStreamingContent('');

    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'error',
        content: String(error)
      }]);
    } finally {
      setIsProcessing(false);
    }
  }, [input, agent, streamingContent]);

  return (
    <ErrorBoundary fallback={<ErrorFallback />}>
      <Box flexDirection="column" height="100%">
        {/* 📊 En-tête avec status */}
        <StatusBar
          model={config.model}
          mode={config.mode}
          memorySize={agent.memorySize}
        />

        {/* 💬 Zone des messages */}
        <Box flexDirection="column" flexGrow={1}>
          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}

          {streamingContent && (
            <StreamingText content={streamingContent} />
          )}
        </Box>

        {/* ⌨️ Zone de saisie */}
        <Box borderStyle="single" paddingX={1}>
          <Text color="cyan">{'>'} </Text>
          <TextInput value={input} onChange={setInput} />
        </Box>
      </Box>
    </ErrorBoundary>
  );
}
```

### 15.2.2 Composants Spécialisés

```typescript
// src/ui/components/tool-progress.tsx

/**
 * ⚙️ Affichage de la progression des outils
 */
export function ToolProgress({ tool, status, duration }: ToolProgressProps) {
  // 🎨 Icônes et couleurs selon le status
  const config = {
    running: { icon: '⟳', color: 'yellow' },
    success: { icon: '✓', color: 'green' },
    error:   { icon: '✗', color: 'red' },
    pending: { icon: '○', color: 'gray' }
  }[status];

  return (
    <Box>
      <Text color={config.color}>{config.icon} </Text>
      <Text>{tool}</Text>
      {duration && <Text dimColor> ({duration}ms)</Text>}
    </Box>
  );
}

// src/ui/components/error-boundary.tsx

/**
 * 🛡️ Capture des erreurs React pour éviter les crashs
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state = { hasError: false, error: undefined };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[UI Error]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
```

---

## 15.3 🎯 Couche Orchestration

### 15.3.1 L'Agent Central

Le **GrokAgent** est le chef d'orchestre du système. Il coordonne toutes les autres couches et gère la boucle agentique principale.

![Grok Agent](images/grok-agent.svg)

```typescript
// src/agent/grok-agent.ts

/**
 * 🎯 Agent principal - Orchestrateur central
 */
export class GrokAgent extends EventEmitter {
  private client: GrokClient;
  private tools: ToolRegistry;
  private router: ModelRouter;
  private executor: ParallelExecutor;
  private memory: MemorySystem;
  private security: SecurityManager;
  private maxRounds = 30;

  /**
   * 🔄 Boucle agentique principale
   */
  async *processStream(input: string): AsyncGenerator<AgentChunk> {
    let currentRound = 0;

    // 1️⃣ Vérification sécurité
    const securityCheck = await this.security.checkInput(input);
    if (!securityCheck.allowed) {
      yield { type: 'error', content: securityCheck.reason };
      return;
    }

    // 2️⃣ Enrichissement du contexte
    const context = await this.buildContext(input);

    // 3️⃣ Sélection du modèle (FrugalGPT)
    const routing = await this.router.selectTier({
      prompt: input,
      type: this.detectTaskType(input)
    });
    yield { type: 'metadata', model: routing.tier };

    // 4️⃣ Boucle agentique
    let messages = this.buildInitialMessages(input, context);
    let continueLoop = true;

    while (continueLoop && currentRound < this.maxRounds) {
      currentRound++;

      // Appel au modèle
      const response = await this.client.chat({
        model: routing.tier,
        messages,
        tools: this.tools.getDefinitions(),
        stream: true
      });

      // Streaming du texte
      for await (const chunk of response) {
        if (chunk.type === 'text') {
          yield { type: 'text', content: chunk.content };
        }
      }

      // Vérification des appels d'outils
      const toolCalls = response.toolCalls;

      if (!toolCalls?.length) {
        continueLoop = false;
      } else {
        yield { type: 'tools_start', count: toolCalls.length };

        // Exécution parallèle
        const results = await this.executeTools(toolCalls);

        for (const result of results) {
          yield {
            type: 'tool_result',
            tool: result.tool,
            success: result.success,
            duration: result.duration
          };
        }

        messages = this.appendToolResults(messages, toolCalls, results);
      }
    }

    // 5️⃣ Post-traitement et mémoire
    await this.memory.remember('episodic', {
      input,
      rounds: currentRound,
      model: routing.tier
    });

    yield { type: 'complete', rounds: currentRound };
  }
}
```

### 15.3.2 Coordination Multi-Agent

Pour les tâches complexes, un **coordinateur multi-agent** décompose le travail en sous-tâches distribuées à des agents spécialisés.

![Multi-Agent Coordinator](images/multi-agent-coordinator.svg)

| Agent | Spécialisation | Dépendances |
|-------|----------------|-------------|
| 💻 Code | Implémentation | - |
| 🧪 Test | Tests unitaires/intégration | Code |
| 🔍 Review | Qualité et sécurité | Code |
| 📚 Doc | Documentation | Code, Test |
| 🔒 Security | Audit sécurité | Code, Review |

---

## 15.4 🧠 Couche Raisonnement

### 15.4.1 Moteur de Raisonnement Unifié

Le moteur de raisonnement sélectionne automatiquement la stratégie optimale selon la complexité du problème.

![Reasoning Engine](images/reasoning-engine.svg)

| Stratégie | Cas d'Usage | Chapitre |
|-----------|-------------|----------|
| Direct | Tâches simples (score < 0.3) | - |
| Tree-of-Thought | Exploration, "best solution" | Ch. 4 |
| MCTS | Grand espace de solutions | Ch. 5 |
| Iterative Repair | Bug fix avec tests | Ch. 6 |
| Hybrid | Complexité maximale | Combinaison |

```typescript
// src/agent/reasoning/reasoning-engine.ts

/**
 * 🧠 Moteur de raisonnement unifié
 */
export class ReasoningEngine {
  private tot: TreeOfThought;
  private mcts: MCTSReasoner;
  private repair: IterativeRepairEngine;

  /**
   * 🎯 Raisonnement adaptatif
   */
  async reason(problem: Problem, strategy?: ReasoningStrategy): Promise<Solution> {
    const selected = strategy ?? this.selectStrategy(problem);

    switch (selected) {
      case 'direct':
        return this.directReasoning(problem);
      case 'tree-of-thought':
        return this.tot.solve(problem);
      case 'mcts':
        return this.mcts.search(problem);
      case 'iterative-repair':
        return this.repair.repair(problem);
      case 'hybrid':
        return this.hybridReasoning(problem);
    }
  }

  /**
   * 📊 Sélection automatique de stratégie
   */
  private selectStrategy(problem: Problem): ReasoningStrategy {
    const complexity = this.assessComplexity(problem);

    if (complexity.score < 0.3) return 'direct';
    if (problem.hasTests && problem.type === 'bug_fix') return 'iterative-repair';
    if (complexity.branchingFactor > 5) return 'mcts';
    if (complexity.requiresExploration) return 'tree-of-thought';

    return 'direct';
  }

  /**
   * 🔀 Raisonnement hybride (ToT + MCTS + Repair)
   */
  private async hybridReasoning(problem: Problem): Promise<Solution> {
    // 1. Exploration avec ToT
    const candidates = await this.tot.explore(problem, { maxCandidates: 3 });

    // 2. Sélection avec MCTS
    const best = await this.mcts.selectBest(candidates);

    // 3. Raffinement avec Repair si nécessaire
    if (best.confidence < 0.9 && problem.hasTests) {
      return this.repair.refine(best, problem.tests);
    }

    return best;
  }
}
```

---

## 15.5 💾 Couche Contexte & Mémoire

### 15.5.1 Pipeline RAG Complet

Le pipeline RAG intègre la récupération avec dépendances (Ch. 8), la compression (Ch. 9), et le cache sémantique (Ch. 12).

![RAG Pipeline](images/rag-pipeline.svg)

### 15.5.2 Mémoire Unifiée

La mémoire unifie les 4 types (Ch. 14) : épisodique, sémantique, procédurale, prospective.

```typescript
// src/memory/unified-memory.ts

/**
 * 💾 Gestionnaire de mémoire unifié
 */
export class UnifiedMemory {
  private episodic: EpisodicMemory;   // Conversations, erreurs
  private semantic: SemanticMemory;   // Faits, préférences
  private procedural: ProceduralMemory; // Workflows
  private prospective: ProspectiveMemory; // Rappels

  /**
   * 🔍 Rappel contextuel unifié
   */
  async recall(context: string): Promise<UnifiedRecall> {
    const [episodes, facts, procedure] = await Promise.all([
      this.episodic.recallSimilar(context, 3),
      this.semantic.getFactsAbout(context),
      this.procedural.findApplicable(context)
    ]);

    return {
      episodes,
      facts,
      suggestedProcedure: procedure,
      summary: this.summarize(episodes, facts, procedure)
    };
  }

  /**
   * 📝 Apprentissage unifié
   */
  async learn(event: LearningEvent): Promise<void> {
    // Enregistrement épisodique
    await this.episodic.record(event);

    // Extraction de faits
    await this.semantic.learnFromEpisode(event);

    // Apprentissage procédural si applicable
    if (event.toolSequence && event.success) {
      await this.procedural.learnFromSequence(
        event.toolSequence,
        event.context
      );
    }
  }
}
```

---

## 15.6 ⚡ Couche Actions (Outils)

### 15.6.1 Registre d'Outils

Le registre centralise les **41 outils** intégrés avec validation, métriques, et définitions API.

![Tool Registry](images/tool-registry.svg)

| Catégorie | Outils | Exemples |
|-----------|--------|----------|
| 📁 Fichiers | 8 | Read, Write, Edit, MultiEdit, Delete, Move, Copy, Mkdir |
| 🔍 Recherche | 6 | Glob, Grep, SymbolSearch, FindReferences, FindDefinition |
| ⚙️ Exécution | 4 | Bash, TestRunner, Npm, Git |
| 📊 Analyse | 5 | DependencyAnalyzer, ASTParser, TypeChecker, Linter |
| 🛠️ Refactoring | 6 | RenameSymbol, ExtractMethod, InlineVariable, MoveFile |
| 🔌 Intégration | 12+ | MCP servers, plugins dynamiques |

```typescript
// src/tools/registry.ts

/**
 * ⚡ Registre centralisé des outils
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private metrics: Map<string, ToolMetrics> = new Map();

  constructor() {
    this.registerBuiltinTools();  // 41 outils
  }

  /**
   * 📋 Définitions pour l'API (format OpenAI/Grok)
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.schema
      }
    }));
  }

  /**
   * 🚀 Exécution avec métriques
   */
  async execute(name: string, params: unknown): Promise<ToolResult> {
    const tool = this.get(name);
    const metrics = this.metrics.get(name)!;
    const startTime = Date.now();

    try {
      const validated = tool.validate(params);
      const result = await tool.execute(validated);

      metrics.calls++;
      metrics.successes++;
      metrics.totalDuration += Date.now() - startTime;

      return { success: true, value: result };

    } catch (error) {
      metrics.calls++;
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 📊 Statistiques globales
   */
  getStats(): ToolStats {
    const topTools = [...this.metrics.entries()]
      .sort((a, b) => b[1].calls - a[1].calls)
      .slice(0, 10)
      .map(([name, m]) => ({
        name,
        calls: m.calls,
        successRate: m.calls > 0 ? m.successes / m.calls : 0,
        avgDuration: m.calls > 0 ? m.totalDuration / m.calls : 0
      }));

    return { totalTools: this.tools.size, topTools };
  }
}
```

---

## 15.7 🔒 Couche Sécurité

### 15.7.1 Gestionnaire de Sécurité Unifié

La sécurité est intégrée à chaque niveau avec 4 composants principaux.

![Security Manager](images/security-manager.svg)

| Composant | Responsabilité | Configuration |
|-----------|----------------|---------------|
| 🚦 Approval Modes | 3 niveaux de permission | `.grok/approval-mode.json` |
| 📦 Sandbox | Isolation des commandes | Conteneur/chroot |
| 🔐 Data Redaction | Masquage données sensibles | Patterns regex |
| 📋 Audit Logger | Journalisation complète | `.grok/audit.log` |

**Les 3 modes d'approbation :**

| Mode | Outils Lecture | Outils Écriture | Bash |
|------|----------------|-----------------|------|
| 🔴 read-only | ✅ Auto | ❌ Bloqué | ❌ Bloqué |
| 🟡 auto | ✅ Auto | ⚠️ Règles | ⚠️ Règles |
| 🟢 full-access | ✅ Auto | ✅ Auto | ✅ Auto |

```typescript
// src/security/index.ts

/**
 * 🔒 Gestionnaire de sécurité centralisé
 */
export class SecurityManager {
  private approval: ApprovalModeManager;
  private sandbox: SandboxManager;
  private redactor: DataRedactor;
  private audit: AuditLogger;

  /**
   * 🔍 Vérification d'un appel d'outil
   */
  async checkTool(toolCall: ToolCall): Promise<SecurityCheck> {
    const mode = this.approval.getCurrentMode();

    // 🔴 Mode read-only : bloquer les écritures
    if (mode === 'read-only' && this.isWriteTool(toolCall.name)) {
      return {
        allowed: false,
        reason: `Tool ${toolCall.name} blocked in read-only mode`,
        requiresApproval: true
      };
    }

    // 🟡 Mode auto : vérifier les règles
    if (mode === 'auto') {
      const autoCheck = this.approval.checkAutoRules(toolCall);
      if (!autoCheck.allowed) {
        return { ...autoCheck, requiresApproval: true };
      }
    }

    // 📦 Sandbox pour Bash
    if (toolCall.name === 'Bash') {
      const sandboxCheck = await this.sandbox.check(toolCall.params.command);
      if (!sandboxCheck.allowed) {
        return sandboxCheck;
      }
    }

    // 📋 Journalisation
    await this.audit.log('tool_check', {
      tool: toolCall.name,
      allowed: true
    });

    return { allowed: true };
  }

  /**
   * ⚠️ Détection des patterns dangereux
   */
  private detectDangerousPatterns(input: string): string[] {
    const patterns = [
      { regex: /rm\s+-rf\s+\//, name: 'recursive delete root' },
      { regex: /:\(\)\{\s*:\|:\s*&\s*\}/, name: 'fork bomb' },
      { regex: /curl.*\|\s*bash/, name: 'remote script execution' }
    ];

    return patterns
      .filter(p => p.regex.test(input))
      .map(p => p.name);
  }
}
```

---

## 15.8 📊 Diagramme d'Intégration Complet

![Architecture Complète](images/complete-architecture.svg)

---

## 15.9 📈 Configuration et Démarrage

### 15.9.1 Fichiers de Configuration

| Fichier | Portée | Contenu |
|---------|--------|---------|
| `.grok/settings.json` | Projet | Modèle, rounds, mémoire, outils |
| `~/.grok/user-settings.json` | Utilisateur | Thème, éditeur, préférences |
| `.grok/mcp.json` | Projet | Serveurs MCP |
| `.grok/hooks.json` | Projet | Hooks d'événements |
| `.grok/approval-mode.json` | Projet | Mode de sécurité actuel |

```json
// .grok/settings.json
{
  "model": "grok-3",
  "maxRounds": 30,
  "approvalMode": "auto",
  "memory": {
    "enabled": true,
    "consolidation": "daily"
  },
  "optimization": {
    "modelRouting": true,
    "parallelExecution": true,
    "caching": true
  }
}
```

### 15.9.2 Séquence de Démarrage

![Startup Sequence](images/startup-sequence.svg)

### 15.9.3 Dashboard de Métriques

![Dashboard Metrics](images/dashboard-metrics.svg)

---

## 📝 15.10 Points Clés du Chapitre

| Concept | Description | Impact |
|---------|-------------|--------|
| 🏗️ 6 Couches | Interface, Orchestration, Raisonnement, Contexte, Actions, Sécurité | Séparation des responsabilités |
| 🎯 GrokAgent | Orchestrateur central avec boucle agentique | Max 30 rounds, streaming |
| 👥 Multi-Agent | Décomposition en sous-tâches spécialisées | Parallélisme, expertise |
| 🧠 Raisonnement | Sélection automatique ToT/MCTS/Repair | Adaptation à la complexité |
| 💾 Mémoire Unifiée | 4 types : épisodique, sémantique, procédurale, prospective | Apprentissage continu |
| ⚡ 41 Outils | Registre centralisé avec métriques | Extensibilité, monitoring |
| 🔒 3 Modes | read-only, auto, full-access | Sécurité par défaut |
| 🚀 Démarrage | 40ms visible, preload async | UX fluide |

![Récapitulatif Architecture](images/architecture-summary.svg)

---

## 🔬 15.11 De la Recherche à l'Implémentation

Un aspect clé de Grok-CLI est son ancrage dans la **recherche académique récente**. Chaque optimisation majeure est inspirée d'un article scientifique.

### 15.11.1 Tableau de Mapping Recherche → Code

![Mapping Recherche](images/research-mapping.svg)

| Technique | Article de Recherche | Fichier Grok-CLI | Amélioration |
|-----------|---------------------|------------------|--------------|
| **Context Compression** | JetBrains Research (2024) | `context-compressor.ts` | -7% coûts, +2.6% succès |
| **Iterative Repair** | ChatRepair (ISSTA 2024, Distinguished Paper) | `iterative-repair.ts` | Boucle feedback tests |
| **Dependency-Aware RAG** | CodeRAG (arXiv 2024) | `dependency-aware-rag.ts` | Graphe de dépendances |
| **Observation Masking** | JetBrains / AgentCoder | `observation-masking.ts` | Filtrage sémantique |
| **Semantic Caching** | API optimization research | `semantic-cache.ts` | 68% réduction API |
| **Model Routing** | FrugalGPT (Stanford 2023) | `model-routing.ts` | 30-70% réduction coûts |
| **Parallel Execution** | LLMCompiler (Berkeley 2023) | `parallel-executor.ts` | 2.5-4.6x speedup |
| **MCTS Reasoning** | RethinkMCTS (arXiv 2024) | `mcts-reasoning.ts` | Correction d'erreurs |
| **Tree-of-Thought** | Yao et al. (NeurIPS 2023) | `tot-reasoning.ts` | Exploration multi-chemins |
| **ReAct Pattern** | Yao et al. (2022) | `grok-agent.ts` | Boucle Reason + Act |

### 15.11.2 Comment Lire un Article et l'Implémenter

```
┌─────────────────────────────────────────────────────────────────┐
│            PROCESSUS : Article → Implémentation                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. LECTURE CRITIQUE                                            │
│     ├── Abstract : Problème résolu ?                           │
│     ├── Results : Gains quantifiés ?                           │
│     └── Method : Algorithme clair ?                            │
│                                                                 │
│  2. PROTOTYPE                                                   │
│     ├── Implémenter le cas simple                              │
│     ├── Tester sur exemples du paper                           │
│     └── Valider les métriques                                  │
│                                                                 │
│  3. ADAPTATION                                                  │
│     ├── Adapter au contexte Grok-CLI                           │
│     ├── Gérer les cas edge                                     │
│     └── Optimiser pour la production                           │
│                                                                 │
│  4. INTÉGRATION                                                 │
│     ├── Interface TypeScript typée                             │
│     ├── Tests unitaires et intégration                         │
│     └── Documentation inline                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 15.11.3 Exemple : Implémenter FrugalGPT

L'article **FrugalGPT** (Chen et al., Stanford 2023) propose de router les requêtes vers le modèle le moins cher capable de les traiter.

**Extrait de l'article :**
> "FrugalGPT can match GPT-4's performance with up to 98% cost reduction by learning to route queries to appropriate LLMs."

**Implémentation dans Grok-CLI :**

```typescript
// src/optimization/model-routing.ts

interface ModelTier {
  name: string;
  cost: number;        // $ per 1M tokens
  capability: number;  // 0-100 score
  latency: number;     // ms average
}

const MODEL_TIERS: ModelTier[] = [
  { name: 'grok-2-mini', cost: 0.5, capability: 70, latency: 200 },
  { name: 'grok-2', cost: 2, capability: 85, latency: 500 },
  { name: 'grok-3', cost: 10, capability: 95, latency: 1000 },
];

export function routeToOptimalModel(task: TaskAnalysis): string {
  // Complexité estimée par heuristiques
  const complexity = estimateComplexity(task);

  // Sélectionner le modèle le moins cher suffisant
  for (const tier of MODEL_TIERS) {
    if (tier.capability >= complexity.requiredCapability) {
      return tier.name;
    }
  }

  return MODEL_TIERS[MODEL_TIERS.length - 1].name; // Fallback au meilleur
}
```

---

## 🏠 15.12 LLM Local en JavaScript/TypeScript

Grok-CLI utilise principalement l'API Grok (cloud), mais peut également fonctionner avec des **LLM locaux** pour la confidentialité ou le mode hors-ligne.

### 15.12.1 Solutions Disponibles

![LLM Local JavaScript](images/local-js-llm.svg)

| Solution | Type | Usage | Performance |
|----------|------|-------|-------------|
| **node-llama-cpp** | Node.js native | Production serveur | ⭐⭐⭐⭐ Excellente |
| **Transformers.js** | ONNX/WASM | Embeddings, petits modèles | ⭐⭐⭐ Bonne |
| **WebLLM** | WebGPU browser | Applications web | ⭐⭐⭐ Variable |
| **Ollama + API** | HTTP localhost | Polyvalent | ⭐⭐⭐⭐ Excellente |

### 15.12.2 node-llama-cpp : LLM Natif pour Node.js

```bash
# Installation
npm install node-llama-cpp

# Télécharger un modèle GGUF
# https://huggingface.co/models?search=gguf
```

```typescript
// src/providers/local-llm.ts

import { LlamaModel, LlamaContext, LlamaChatSession } from 'node-llama-cpp';

export class LocalLLMProvider {
  private model: LlamaModel;
  private context: LlamaContext;

  async initialize(modelPath: string) {
    this.model = new LlamaModel({ modelPath });
    this.context = new LlamaContext({ model: this.model });
  }

  async chat(messages: Message[]): Promise<string> {
    const session = new LlamaChatSession({ context: this.context });

    // Convertir au format attendu
    for (const msg of messages) {
      if (msg.role === 'user') {
        const response = await session.prompt(msg.content);
        return response;
      }
    }

    throw new Error('No user message found');
  }

  // API compatible OpenAI pour intégration facile
  async chatCompletion(request: ChatRequest): Promise<ChatResponse> {
    const content = await this.chat(request.messages);
    return {
      choices: [{ message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
  }
}
```

### 15.12.3 WebLLM : LLM dans le Navigateur

Pour les applications web, **WebLLM** permet d'exécuter des LLM directement dans le navigateur avec WebGPU.

```typescript
// Pour une extension ou app web
import * as webllm from '@mlc-ai/web-llm';

const engine = new webllm.MLCEngine();
await engine.reload('Llama-3.1-8B-Instruct-q4f16_1-MLC');

const response = await engine.chat.completions.create({
  messages: [{ role: 'user', content: 'Hello!' }],
  stream: true
});

for await (const chunk of response) {
  console.log(chunk.choices[0]?.delta?.content || '');
}
```

### 15.12.4 Configuration Hybride dans Grok-CLI

```typescript
// src/config/llm-provider.ts

type ProviderType = 'grok-api' | 'ollama' | 'local-llama' | 'webllm';

interface LLMConfig {
  provider: ProviderType;
  model: string;
  endpoint?: string;
  modelPath?: string;
}

export function createProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'grok-api':
      return new GrokAPIProvider(config.model);

    case 'ollama':
      return new OllamaProvider(config.endpoint || 'http://localhost:11434');

    case 'local-llama':
      return new LocalLLMProvider(config.modelPath!);

    case 'webllm':
      return new WebLLMProvider(config.model);

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
```

```json
// .grok/settings.json - Configuration locale
{
  "provider": "local-llama",
  "modelPath": "./models/llama-3.1-8b-q4_k_m.gguf",
  "fallback": {
    "provider": "grok-api",
    "model": "grok-2"
  }
}
```

### 15.12.5 Comparaison des Approches

| Critère | API Cloud (Grok) | Ollama | node-llama-cpp |
|---------|------------------|--------|----------------|
| **Setup** | 5 min | 15 min | 30 min |
| **Qualité** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Latence** | 200-2000ms | 50-500ms | 50-300ms |
| **Confidentialité** | ⚠️ Cloud | ✅ Local | ✅ Local |
| **Coût** | $/token | Gratuit | Gratuit |
| **GPU requis** | Non | Recommandé | Recommandé |
| **Mode hors-ligne** | ❌ | ✅ | ✅ |

---

## 🏋️ Exercices

### Exercice 1 : Ajouter un Nouvel Outil
Créez un outil `JsonValidator` qui valide un fichier JSON contre un schéma.

### Exercice 2 : Agent Spécialisé
Implémentez un agent spécialisé pour l'analyse de performance (profiling).

### Exercice 3 : Hook Personnalisé
Créez un hook `postToolUse` qui mesure la durée des outils et alerte si > 5s.

### Exercice 4 : Mode de Sécurité
Ajoutez un mode `team` avec approbation multi-utilisateur.

### Exercice 5 : Dashboard Étendu
Étendez le dashboard avec des graphiques de tendance (latence, coûts).

---

## 📚 Références

| Source | Description |
|--------|-------------|
| React + Ink | [Ink Documentation](https://github.com/vadimdemedes/ink) |
| OpenAI Tool Use | [Function Calling Guide](https://platform.openai.com/docs/guides/function-calling) |
| MCP Protocol | [Model Context Protocol Spec](https://spec.modelcontextprotocol.io) |
| AgentBench | Benchmark agents LLM (2024) |
| Claude Code | Architecture de référence |

---

## 🌅 Épilogue : Le Voyage Continue

Lina ferma la dernière diapositive. L'équipe restait silencieuse.

— "C'est... beaucoup," admit Marcus.

Lina sourit.

— "Ça l'est. Mais souviens-toi : tout a commencé par quelques lignes de code. Un appel API. Une boucle while. Ce n'est que l'accumulation de petites décisions qui a créé cet ensemble."

Elle regarda par la fenêtre.

— "Et ce n'est pas fini. De nouveaux modèles arrivent. De nouvelles techniques émergent. Les utilisateurs trouvent des cas d'usage auxquels nous n'avions jamais pensé."

Elle se tourna vers l'équipe.

— "L'architecture que vous voyez n'est pas une destination. C'est un instantané d'un voyage en cours. Demain, nous ajouterons quelque chose de nouveau. Dans un an, le schéma sera différent."

Elle fit une pause.

— "C'est ça, construire un agent LLM moderne. Pas une course vers la perfection, mais un apprentissage continu. Exactement comme l'agent lui-même."

---

## 🎓 Conclusion du Livre

À travers ces quinze chapitres, nous avons parcouru le voyage complet de construction d'un agent LLM moderne.

**Les 5 leçons clés :**

| # | Leçon | Application |
|---|-------|-------------|
| 1 | Les LLMs ne sont que le début | La valeur vient de l'architecture : outils, mémoire, raisonnement |
| 2 | L'itération bat la perfection | Chaque fonctionnalité résout un problème réel |
| 3 | La recherche informe la pratique | ToT, MCTS, ChatRepair, FrugalGPT = solutions concrètes |
| 4 | La sécurité n'est pas optionnelle | Intégrée dès le début, pas en afterthought |
| 5 | L'apprentissage est continu | Comme l'agent lui-même |

Le code de Grok-CLI est open-source. Explorez-le. Modifiez-le. Construisez dessus.

*Fin.*

---

*Merci d'avoir lu "Construire un Agent LLM Moderne — De la Théorie à Grok-CLI".*

---

[⬅️ Chapitre 14 : Apprentissage Persistant](14-apprentissage-persistant.md) | [📚 Table des Matières](README.md)
