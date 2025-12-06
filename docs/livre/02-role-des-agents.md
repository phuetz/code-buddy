# Chapitre 2 — Le Rôle des Agents dans l'Écosystème IA

---

> **Scène**
>
> *Lina présente son prototype à son équipe. Un chatbot amélioré qui peut lire des fichiers.*
>
> *"C'est cool," dit Marc, le lead tech, "mais AutoGPT fait déjà ça, non ? Et Claude Code, et Cursor, et Copilot..."*
>
> *Lina hésite. Elle sait que son prototype est différent, mais comment l'expliquer ?*
>
> *"La différence," commence-t-elle, "c'est qu'un chatbot te donne une réponse. Un assistant te donne de l'aide. Mais un agent... un agent résout le problème."*

---

## Introduction

Le terme "agent IA" est devenu un buzzword en 2024. Tout le monde prétend en avoir un. Mais qu'est-ce qu'un agent, vraiment ? Ce chapitre établit une taxonomie claire des systèmes IA, retrace l'évolution qui nous a menés aux agents modernes, et présente les travaux de recherche fondamentaux qui ont façonné le domaine.

---

## 2.1 Taxonomie des Systèmes IA

### 2.1.1 Les quatre niveaux d'intelligence artificielle appliquée

Tous les systèmes basés sur des LLMs ne sont pas égaux. Voici une classification pragmatique :

```
┌─────────────────────────────────────────────────────────────────────┐
│                    NIVEAUX D'IA APPLIQUÉE                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  NIVEAU 4 : MULTI-AGENTS                                            │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Plusieurs agents collaborent                                │    │
│  │  • MetaGPT, CrewAI, AutoGen                                 │    │
│  │  • Spécialisation des rôles                                 │    │
│  │  • Coordination complexe                                     │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                          ▲                                           │
│  NIVEAU 3 : AGENT AUTONOME                                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Reasoning + Action + Mémoire + Apprentissage               │    │
│  │  • AutoGPT, Grok-CLI, Devin                                 │    │
│  │  • Boucle autonome                                          │    │
│  │  • Résolution de bout en bout                               │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                          ▲                                           │
│  NIVEAU 2 : ASSISTANT AUGMENTÉ                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  LLM + Contexte + Quelques outils                           │    │
│  │  • Claude (avec code interpreter), ChatGPT Plus             │    │
│  │  • GitHub Copilot, Cursor                                   │    │
│  │  • Aide mais ne résout pas seul                             │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                          ▲                                           │
│  NIVEAU 1 : CHATBOT                                                 │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  LLM brut avec prompt                                       │    │
│  │  • ChatGPT vanilla, chatbots de support                     │    │
│  │  • Conversation simple                                      │    │
│  │  • Pas d'action réelle                                      │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.1.2 Tableau comparatif détaillé

| Aspect | Chatbot | Assistant | Agent | Multi-Agent |
|--------|---------|-----------|-------|-------------|
| **Mémoire** | Session | Session + docs | Persistante | Partagée |
| **Outils** | 0 | 1-5 | 10-50+ | Spécialisés |
| **Autonomie** | Aucune | Guidée | Boucle autonome | Coordination |
| **Reasoning** | Linéaire | Chain-of-thought | ToT, MCTS | Distribué |
| **Feedback** | Aucun | Utilisateur | Auto-évaluation | Inter-agents |
| **Exemple** | FAQ bot | Copilot | Grok-CLI | MetaGPT |

### 2.1.3 Le spectre de l'autonomie

```
Aucune autonomie ◄────────────────────────────────────────► Autonomie totale

     │                    │                    │                    │
     ▼                    ▼                    ▼                    ▼
┌─────────┐         ┌─────────┐         ┌─────────┐         ┌─────────┐
│ Chatbot │         │Assistant│         │  Agent  │         │  AGI    │
│         │         │         │         │         │         │  (?)    │
│ Répond  │         │ Aide    │         │ Résout  │         │ Décide  │
└─────────┘         └─────────┘         └─────────┘         └─────────┘

Humain décide       Humain guide        Humain supervise    Humain... ?
tout                les étapes          le résultat
```

---

## 2.2 L'Évolution vers les Agents (2020-2025)

### 2.2.1 Chronologie des innovations

```
2020 ──────────────────────────────────────────────────────────────────►

     │ GPT-3          │ InstructGPT    │ ChatGPT       │ GPT-4
     │ Completion     │ RLHF           │ Dialogue      │ Multimodal
     │ only           │                │               │ + Function calls
     ▼                ▼                ▼               ▼
   ┌───┐            ┌───┐           ┌───┐           ┌───┐
   │   │            │   │           │   │           │   │
   └───┘            └───┘           └───┘           └───┘
   2020             2022            Nov 2022        Mars 2023


2023 ──────────────────────────────────────────────────────────────────►

     │ AutoGPT        │ Claude 2      │ Claude 3      │ Grok-2
     │ Premier agent  │ 100K context  │ 200K context  │ Reasoning
     │ viral          │               │               │ amélioré
     ▼                ▼               ▼               ▼
   ┌───┐            ┌───┐           ┌───┐           ┌───┐
   │   │            │   │           │   │           │   │
   └───┘            └───┘           └───┘           └───┘
   Avril 2023       Juillet 2023   Mars 2024        2024


2024-2025 ─────────────────────────────────────────────────────────────►

     │ Claude Code    │ MCP Protocol  │ Devin         │ Grok-CLI
     │ Agent dev      │ Standard      │ AI Engineer   │ Agent complet
     │ mainstream     │ outils        │               │ open-source
     ▼                ▼               ▼               ▼
   ┌───┐            ┌───┐           ┌───┐           ┌───┐
   │   │            │   │           │   │           │   │
   └───┘            └───┘           └───┘           └───┘
   2024             Nov 2024        Mars 2024       2025
```

### 2.2.2 Les catalyseurs clés

**1. Function Calling (2023)**

L'introduction du function calling dans GPT-4 a été révolutionnaire. Pour la première fois, le modèle pouvait demander explicitement l'exécution d'outils :

```json
{
  "function_call": {
    "name": "read_file",
    "arguments": "{\"path\": \"src/config.ts\"}"
  }
}
```

**2. Fenêtres de contexte étendues (2023-2024)**

| Modèle | Contexte | Impact |
|--------|----------|--------|
| GPT-3.5 | 4K tokens | Une fonction |
| GPT-4 | 8K → 128K | Fichiers entiers |
| Claude 3 | 200K | Projets complets |
| Grok-3 | 128K | Codebase RAG |

**3. Benchmarks agents (2023-2024)**

Des benchmarks standardisés ont permis de mesurer les progrès :

| Benchmark | Focus | Meilleur 2024 |
|-----------|-------|---------------|
| SWE-bench | Bug fixing réel | ~30% résolu |
| WebArena | Navigation web | ~35% succès |
| GAIA | Raisonnement général | ~55% succès |
| HumanEval | Code generation | ~95% pass |

**4. MCP Protocol (2024)**

Anthropic a standardisé comment les agents communiquent avec les outils :

```typescript
// Standard MCP pour exposer un outil
{
  name: "read_file",
  description: "Read contents of a file",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" }
    },
    required: ["path"]
  }
}
```

---

## 2.3 Les Travaux de Recherche Fondamentaux

### 2.3.1 Tree-of-Thought (Yao et al., 2023)

**Problème résolu** : Le raisonnement linéaire échoue sur les problèmes complexes.

**Innovation** : Explorer plusieurs chemins de pensée en parallèle.

```
Problème : "Game of 24 : Utiliser 4, 5, 6, 10 pour obtenir 24"

Raisonnement linéaire :
  4 + 5 = 9... 9 + 6 = 15... 15 + 10 = 25 ✗
  (Un seul chemin, échec)

Tree-of-Thought :
  ┌─ 4 + 5 = 9 ────── 9 + 6 = 15 ────── ✗
  │
  ├─ 4 × 5 = 20 ───── 20 + 6 = 26 ───── ✗
  │
  ├─ 6 - 4 = 2 ────── 2 × 10 = 20 ───── 20 + 5 = 25 ✗
  │
  └─ 10 - 4 = 6 ───── 6 × 5 = 30 ────── ✗
      │
      └─ (6 - 4) × 10 = 20 ───── 20 + 5 - 1 ?
          │
          └─ 4 × 6 = 24 ────── ✓ (trouvé !)
```

**Impact sur Grok-CLI** : Implémenté dans `src/agent/reasoning/tree-of-thought.ts`

### 2.3.2 RethinkMCTS (Zhang et al., 2024)

**Problème résolu** : ToT explore trop de mauvais chemins.

**Innovation** : Utiliser Monte-Carlo Tree Search pour guider l'exploration intelligemment.

```
MCTS pour code :

1. SELECT : Choisir le nœud le plus prometteur (UCB1)
2. EXPAND : Générer des variations de code
3. SIMULATE : Exécuter les tests
4. BACKPROPAGATE : Mettre à jour les scores

Résultat : Converge vers la solution optimale
           avec moins d'explorations que ToT
```

**Amélioration** : +15% de succès sur les benchmarks de génération de code

**Impact sur Grok-CLI** : Implémenté dans `src/agent/reasoning/mcts.ts`

### 2.3.3 FrugalGPT (Chen et al., Stanford, 2023)

**Problème résolu** : Les meilleurs modèles coûtent cher.

**Innovation** : Router les requêtes vers le modèle approprié selon la complexité.

```
┌─────────────────────────────────────────────────────────┐
│                   FRUGALGPT ROUTING                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   Requête entrante                                      │
│         │                                                │
│         ▼                                                │
│   ┌───────────────┐                                     │
│   │  Classifier   │                                     │
│   │  (complexité) │                                     │
│   └───────┬───────┘                                     │
│           │                                              │
│     ┌─────┼─────┬─────────┐                             │
│     │     │     │         │                              │
│     ▼     ▼     ▼         ▼                              │
│   ┌───┐ ┌───┐ ┌───┐   ┌─────┐                          │
│   │ $ │ │$$ │ │$$$│   │$$$$ │                          │
│   │   │ │   │ │   │   │     │                          │
│   │GPT│ │GPT│ │GPT│   │GPT-4│                          │
│   │3.5│ │ 4 │ │4-T│   │+ToT │                          │
│   └───┘ └───┘ └───┘   └─────┘                          │
│                                                          │
│   Simple  Standard  Complexe  Critique                  │
│   "ls"    "refactor" "debug"   "architecture"           │
│                                                          │
│   Économie : 30-70% des coûts API                       │
└─────────────────────────────────────────────────────────┘
```

**Impact sur Grok-CLI** : Implémenté dans `src/optimization/model-routing.ts`

### 2.3.4 LLMCompiler (Kim et al., 2023)

**Problème résolu** : Les appels d'outils séquentiels sont lents.

**Innovation** : Analyser les dépendances et exécuter en parallèle.

```
Tâche : "Lis config.ts, types.ts, et utils.ts puis analyse-les"

Exécution séquentielle :
  read(config.ts) ──► read(types.ts) ──► read(utils.ts) ──► analyze
  Total : 4 × latence

Exécution LLMCompiler :
  ┌─ read(config.ts) ─┐
  │                   │
  ├─ read(types.ts) ──┼──► analyze
  │                   │
  └─ read(utils.ts) ──┘

  Total : 2 × latence (2.5x speedup)
```

**Amélioration mesurée** : 2.5-4.6x speedup selon les tâches

**Impact sur Grok-CLI** : Implémenté dans `src/optimization/parallel-executor.ts`

### 2.3.5 ChatRepair (Xia et al., ISSTA 2024)

**Problème résolu** : Les LLMs échouent souvent au premier essai de correction de bug.

**Innovation** : Boucle itérative avec feedback des tests.

```
┌─────────────────────────────────────────────────────────┐
│                   CHATREPAIR LOOP                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   Bug signalé                                           │
│        │                                                 │
│        ▼                                                 │
│   ┌─────────────┐                                       │
│   │ Localiser   │ ◄── Ochiai, DStar, Tarantula         │
│   │ la faute    │                                       │
│   └──────┬──────┘                                       │
│          │                                               │
│          ▼                                               │
│   ┌─────────────┐                                       │
│   │ Générer     │ ◄── LLM avec contexte                │
│   │ un patch    │                                       │
│   └──────┬──────┘                                       │
│          │                                               │
│          ▼                                               │
│   ┌─────────────┐                                       │
│   │ Exécuter    │                                       │
│   │ les tests   │                                       │
│   └──────┬──────┘                                       │
│          │                                               │
│     ┌────┴────┐                                         │
│     │ Succès? │                                         │
│     └────┬────┘                                         │
│      Non │  Oui                                         │
│          │   │                                          │
│          ▼   ▼                                          │
│      ┌──────┐ Terminé                                   │
│      │Feedback                                          │
│      │erreur │                                          │
│      └───┬──┘                                           │
│          │                                               │
│          └──────────► (retour à "Générer")              │
│                                                          │
│   Amélioration : +40% bugs résolus vs single-shot       │
└─────────────────────────────────────────────────────────┘
```

**Impact sur Grok-CLI** : Implémenté dans `src/agent/repair/iterative-repair.ts`

### 2.3.6 Context Compression (JetBrains Research, 2024)

**Problème résolu** : Le contexte long coûte cher et dilue l'attention.

**Innovation** : Compresser intelligemment en gardant l'essentiel.

```
Contexte original : 50,000 tokens

Compression intelligente :
┌────────────────────────────────────────────────────────┐
│  Priorité haute (garder intégralement)                 │
│  • Code modifié récemment                              │
│  • Fonctions référencées dans la question              │
│  • Types et interfaces utilisés                        │
├────────────────────────────────────────────────────────┤
│  Priorité moyenne (résumer)                            │
│  • Imports et dépendances                              │
│  • Documentation                                        │
│  • Tests existants                                      │
├────────────────────────────────────────────────────────┤
│  Priorité basse (supprimer)                            │
│  • Code non lié                                         │
│  • Commentaires redondants                             │
│  • Historique de conversation ancien                   │
└────────────────────────────────────────────────────────┘

Contexte compressé : 15,000 tokens

Résultat : -7% coûts, +2.6% taux de succès
```

**Impact sur Grok-CLI** : Implémenté dans `src/context/context-compressor.ts`

### 2.3.7 CodeRAG (2024)

**Problème résolu** : Le RAG classique ignore les dépendances du code.

**Innovation** : Construire un graphe de dépendances et retriever les fichiers liés.

```
Query : "Comment fonctionne GrokAgent ?"

RAG classique :
  → Recherche "GrokAgent" dans les embeddings
  → Retourne : grok-agent.ts
  → Manque : types.ts, tools.ts, client.ts (dépendances)

CodeRAG (Dependency-Aware) :
  → Recherche "GrokAgent"
  → Analyse les imports de grok-agent.ts
  → Retourne :
    • grok-agent.ts (query match)
    • types.ts (import direct)
    • tools.ts (import direct)
    • client.ts (import transitif)
  → Contexte complet pour comprendre
```

**Impact sur Grok-CLI** : Implémenté dans `src/context/dependency-aware-rag.ts`

---

## 2.4 Tableau Récapitulatif des Recherches

| Publication | Année | Problème | Solution | Amélioration | Fichier Grok-CLI |
|-------------|-------|----------|----------|--------------|------------------|
| Tree-of-Thought | 2023 | Reasoning linéaire | Multi-chemins | +30% problèmes complexes | `tree-of-thought.ts` |
| RethinkMCTS | 2024 | Exploration inefficace | MCTS guidé | +15% génération code | `mcts.ts` |
| FrugalGPT | 2023 | Coûts API | Model routing | -30-70% coûts | `model-routing.ts` |
| LLMCompiler | 2023 | Latence tools | Parallélisation | 2.5-4.6x speedup | `parallel-executor.ts` |
| ChatRepair | 2024 | Réparation single-shot | Boucle itérative | +40% bugs résolus | `iterative-repair.ts` |
| JetBrains | 2024 | Contexte coûteux | Compression | -7% coûts, +2.6% succès | `context-compressor.ts` |
| CodeRAG | 2024 | RAG sans dépendances | Graphe imports | +25% pertinence | `dependency-aware-rag.ts` |

---

## 2.5 L'Écosystème des Agents en 2025

### 2.5.1 Agents de développement

| Agent | Type | Forces | Faiblesses |
|-------|------|--------|------------|
| **GitHub Copilot** | Assistant | Intégration IDE, vitesse | Pas autonome |
| **Cursor** | Assistant+ | Context-aware, multi-fichier | Limité à l'IDE |
| **Claude Code** | Agent | Autonome, sécurisé | Fermé |
| **Devin** | Agent | Full-stack, autonome | Coût, accès limité |
| **Grok-CLI** | Agent | Open-source, complet | Moins mature |
| **Aider** | Agent | Simple, efficace | Moins de features |

### 2.5.2 Frameworks multi-agents

| Framework | Paradigme | Cas d'usage |
|-----------|-----------|-------------|
| **LangChain** | Chaîne d'outils | Prototypage rapide |
| **LangGraph** | Graphe d'états | Workflows complexes |
| **AutoGen** | Multi-agent | Collaboration agents |
| **CrewAI** | Équipes spécialisées | Projets structurés |
| **MetaGPT** | Rôles d'entreprise | Simulation orga |

### 2.5.3 Standards émergents

```
┌─────────────────────────────────────────────────────────┐
│               STANDARDS AGENTS 2025                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   MCP (Model Context Protocol)                          │
│   └─ Standard Anthropic pour les outils                 │
│   └─ Transport : stdio, HTTP, SSE                       │
│   └─ Découverte dynamique des capacités                 │
│                                                          │
│   OpenAI Function Calling                               │
│   └─ JSON Schema pour les paramètres                    │
│   └─ Parallel function calling                          │
│   └─ Adopté par la plupart des providers                │
│                                                          │
│   A2A (Agent-to-Agent) - Émergent                       │
│   └─ Communication inter-agents                         │
│   └─ Délégation de tâches                               │
│   └─ Pas encore standardisé                             │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 2.6 Pourquoi Construire son Propre Agent ?

> *"Pourquoi ne pas juste utiliser Claude Code ?" demande Marc.*
>
> *Lina sourit. "Parce que Claude Code est une boîte noire. Je veux comprendre comment ça marche. Je veux pouvoir le modifier. Et surtout, je veux apprendre."*
>
> *"Et si un jour Anthropic change son pricing ou ses conditions ?"*
>
> *"Exactement."*

### 2.6.1 Avantages d'un agent custom

| Aspect | Agent commercial | Agent custom |
|--------|------------------|--------------|
| **Contrôle** | Limité | Total |
| **Coût** | Abonnement | API uniquement |
| **Customisation** | Plugins limités | Code source complet |
| **Données** | Chez le provider | Local |
| **Évolution** | Dépend du vendor | Vous décidez |
| **Apprentissage** | Aucun | Immense |

### 2.6.2 Cas d'usage pour un agent custom

1. **Besoins spécifiques** : Intégration avec des systèmes internes, outils propriétaires
2. **Sécurité** : Données sensibles qui ne peuvent pas quitter l'entreprise
3. **Coûts** : Volume important où le contrôle du routing est critique
4. **Recherche** : Expérimentation avec de nouvelles techniques
5. **Formation** : Comprendre le fonctionnement des agents

---

## 2.7 Référence Grok-CLI

Grok-CLI implémente toutes les techniques de recherche mentionnées dans ce chapitre. Voici la correspondance :

```
src/
├── agent/
│   ├── reasoning/
│   │   ├── tree-of-thought.ts    ◄── ToT (Yao 2023)
│   │   └── mcts.ts               ◄── RethinkMCTS (Zhang 2024)
│   └── repair/
│       ├── iterative-repair.ts   ◄── ChatRepair (Xia 2024)
│       └── fault-localization.ts ◄── Ochiai, DStar
├── context/
│   ├── dependency-aware-rag.ts   ◄── CodeRAG (2024)
│   ├── context-compressor.ts     ◄── JetBrains Research (2024)
│   └── observation-masking.ts    ◄── AgentCoder
├── optimization/
│   ├── model-routing.ts          ◄── FrugalGPT (Chen 2023)
│   ├── parallel-executor.ts      ◄── LLMCompiler (Kim 2023)
│   └── latency-optimizer.ts      ◄── Human-AI Flow Research
└── mcp/
    └── client.ts                 ◄── MCP Protocol (Anthropic 2024)
```

---

## Résumé

Dans ce chapitre, nous avons vu :

| Concept | Point clé |
|---------|-----------|
| **Taxonomie** | Chatbot → Assistant → Agent → Multi-Agent |
| **Évolution** | 2020-2025 : de GPT-3 aux agents autonomes |
| **Catalyseurs** | Function calling, contexte étendu, MCP |
| **Recherche** | ToT, MCTS, FrugalGPT, LLMCompiler, ChatRepair |
| **Écosystème** | Agents commerciaux vs custom |

---

## Exercices

1. **Classification** : Classez 5 produits IA que vous utilisez selon la taxonomie Chatbot/Assistant/Agent.

2. **Analyse** : Choisissez une publication du tableau et lisez l'abstract. Résumez en 3 phrases.

3. **Comparaison** : Installez Aider et Grok-CLI. Comparez-les sur une tâche simple de refactoring.

4. **Réflexion** : Quels outils spécifiques à votre domaine un agent custom devrait-il avoir ?

---

## Pour aller plus loin

- Yao, S., et al. (2023). "Tree of Thoughts: Deliberate Problem Solving with Large Language Models." arXiv:2305.10601
- Kim, S., et al. (2023). "LLMCompiler: An LLM Compiler for Parallel Function Calling." arXiv:2312.04511
- Chen, L., et al. (2023). "FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance." arXiv:2305.05176
- Anthropic. (2024). "Model Context Protocol Specification." https://modelcontextprotocol.io

---

*Prochainement : Chapitre 3 — Anatomie d'un Agent Autonome*

